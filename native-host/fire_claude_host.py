#!/usr/bin/env python3
"""
Native messaging host for Fire Claude extension.
Bridges Firefox extension to Claude Code CLI.
"""

import sys
import os
import json
import struct
import subprocess
import shutil
import threading
import time
import logging
import tempfile
from typing import Optional, Dict, Any

# Debug logging to file (helps diagnose timeout issues)
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fire_claude_debug.log')
logging.basicConfig(
    filename=LOG_FILE,
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# Track active processes for cancellation
active_processes: Dict[int, subprocess.Popen] = {}
process_lock = threading.Lock()

# Cache for claude path
_claude_path: Optional[str] = None

# Valid model aliases for Claude Code CLI
# Claude Code accepts simple aliases: 'sonnet', 'opus', 'haiku'
VALID_MODELS = {'sonnet', 'opus', 'haiku'}


def find_claude() -> Optional[str]:
    """Find the claude executable in common locations."""
    global _claude_path

    if _claude_path:
        return _claude_path

    # Try shutil.which first (checks PATH)
    path = shutil.which('claude')
    if path:
        _claude_path = path
        return path

    # On Windows, also try .cmd extension
    if sys.platform == 'win32':
        path = shutil.which('claude.cmd')
        if path:
            _claude_path = path
            return path

    # Common Windows locations for npm global packages
    if sys.platform == 'win32':
        appdata = os.environ.get('APPDATA', '')
        localappdata = os.environ.get('LOCALAPPDATA', '')
        userprofile = os.environ.get('USERPROFILE', '')

        possible_paths = [
            os.path.join(appdata, 'npm', 'claude.cmd'),
            os.path.join(appdata, 'npm', 'claude'),
            os.path.join(localappdata, 'npm', 'claude.cmd'),
            os.path.join(localappdata, 'npm', 'claude'),
            os.path.join(userprofile, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
            os.path.join(userprofile, 'AppData', 'Local', 'npm', 'claude.cmd'),
            # Node Version Manager (nvm) paths
            os.path.join(appdata, 'nvm', 'current', 'claude.cmd'),
            # Scoop
            os.path.join(userprofile, 'scoop', 'shims', 'claude.cmd'),
            # Chocolatey
            os.path.join(os.environ.get('ChocolateyInstall', 'C:\\ProgramData\\chocolatey'), 'bin', 'claude.cmd'),
        ]

        for p in possible_paths:
            if os.path.isfile(p):
                _claude_path = p
                return p

    # macOS/Linux locations
    else:
        home = os.path.expanduser('~')
        possible_paths = [
            '/usr/local/bin/claude',
            '/usr/bin/claude',
            os.path.join(home, '.npm-global', 'bin', 'claude'),
            os.path.join(home, '.nvm', 'current', 'bin', 'claude'),
        ]

        for p in possible_paths:
            if os.path.isfile(p):
                _claude_path = p
                return p

    return None


def read_message() -> Optional[Dict[str, Any]]:
    """Read a message from stdin using native messaging protocol."""
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        return None
    message_length = struct.unpack('@I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)


def send_message(message: Dict[str, Any]) -> None:
    """Send a message to stdout using native messaging protocol."""
    encoded = json.dumps(message, separators=(',', ':')).encode('utf-8')
    length = struct.pack('@I', len(encoded))
    sys.stdout.buffer.write(length)
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def query_claude(prompt: str, context: str = "", request_id: int = 0, model: str = "sonnet") -> Dict[str, Any]:
    """Send a query to Claude Code CLI and return response with metadata."""
    logging.info(f"query_claude called: request_id={request_id}, model={model}, context_len={len(context)}, prompt_len={len(prompt)}")

    full_prompt = f"{context}\n\n{prompt}" if context else prompt
    # Validate model, default to sonnet if invalid
    model_alias = model if model in VALID_MODELS else 'sonnet'

    logging.info(f"Full prompt size: {len(full_prompt)} chars")

    start_time = time.time()
    result_data = {
        'prompt_size': len(full_prompt),
        'prompt_preview': full_prompt[:500] + ('...' if len(full_prompt) > 500 else ''),
        'model_used': model_alias,  # Debug: show which model is being used
    }

    # Find claude executable
    claude_path = find_claude()
    logging.info(f"Claude path found: {claude_path}")
    if not claude_path:
        result_data['duration_ms'] = 0
        result_data['response'] = (
            "Error: Claude Code CLI not found.\n\n"
            "Searched locations:\n"
            f"- PATH directories\n"
            f"- %APPDATA%\\npm\n"
            f"- %LOCALAPPDATA%\\npm\n\n"
            "Please ensure Claude Code is installed:\n"
            "  npm install -g @anthropic-ai/claude-code\n\n"
            "Or specify the full path in the native host script."
        )
        result_data['success'] = False
        return result_data

    temp_file = None
    try:
        # Write prompt to temp file - this works when user can grant permission
        # (requires shell=True without CREATE_NO_WINDOW so permission dialog shows)
        temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8')
        temp_file.write(full_prompt)
        temp_file.close()
        logging.info(f"Wrote {len(full_prompt)} chars to temp file: {temp_file.name}")

        if sys.platform == 'win32':
            # On Windows, use 'type' to read the file and pipe to Claude's stdin
            # This avoids Claude's file permission prompt entirely!
            # type reads the file -> pipes to claude -p - (stdin mode)
            cmd = f'type "{temp_file.name}" | "{claude_path}" -p - --model {model_alias}'
            logging.info(f"Starting subprocess (type pipe): {cmd}")
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                shell=True,
            )
        else:
            # On Unix, use cat to pipe file content to stdin
            cmd = f'cat "{temp_file.name}" | "{claude_path}" -p - --model {model_alias}'
            logging.info(f"Starting subprocess (cat pipe): {cmd}")
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                shell=True,
            )

        logging.info(f"Subprocess started with PID: {process.pid}")

        # Track process for cancellation
        with process_lock:
            active_processes[request_id] = process

        try:
            logging.info("Waiting for subprocess to complete...")
            stdout, stderr = process.communicate(timeout=180)
            logging.info(f"Subprocess completed. stdout={len(stdout)} chars, stderr={len(stderr)} chars")
            duration = int((time.time() - start_time) * 1000)

            result_data['duration_ms'] = duration
            result_data['claude_path'] = claude_path  # Include for debugging

            if process.returncode == 0:
                result_data['response'] = stdout.strip()
                result_data['response_size'] = len(stdout)
                result_data['response_preview'] = stdout[:500] + ('...' if len(stdout) > 500 else '')
                result_data['success'] = True
            else:
                result_data['response'] = f"Error (exit code {process.returncode}): {stderr}"
                result_data['success'] = False

        except subprocess.TimeoutExpired:
            logging.error(f"Subprocess timed out after 180s!")
            process.kill()
            try:
                _, stderr_on_timeout = process.communicate(timeout=5)
                logging.error(f"Stderr on timeout: {stderr_on_timeout[:1000] if stderr_on_timeout else 'empty'}")
            except:
                pass
            duration = int((time.time() - start_time) * 1000)
            result_data['duration_ms'] = duration
            result_data['response'] = "Error: Claude Code request timed out (180s). This may indicate Claude Code CLI needs authentication or is prompting for input."
            result_data['success'] = False

        finally:
            with process_lock:
                active_processes.pop(request_id, None)

    except FileNotFoundError as e:
        duration = int((time.time() - start_time) * 1000)
        result_data['duration_ms'] = duration
        result_data['response'] = f"Error: Could not execute '{claude_path}': {e}"
        result_data['success'] = False
    except Exception as e:
        duration = int((time.time() - start_time) * 1000)
        result_data['duration_ms'] = duration
        result_data['response'] = f"Error: {str(e)}"
        result_data['success'] = False
    finally:
        # Clean up temp file
        if temp_file and os.path.exists(temp_file.name):
            try:
                os.unlink(temp_file.name)
                logging.info(f"Cleaned up temp file: {temp_file.name}")
            except Exception as e:
                logging.warning(f"Failed to clean up temp file: {e}")

    return result_data


def cancel_request(request_id: int) -> bool:
    """Cancel an active request by killing its subprocess."""
    with process_lock:
        process = active_processes.get(request_id)
        if process:
            try:
                process.kill()
                return True
            except Exception:
                pass
    return False


def handle_message(message: Dict[str, Any]) -> Dict[str, Any]:
    """Process incoming message and return response."""
    action = message.get('action')
    request_id = message.get('requestId', 0)
    logging.info(f"=== Received message: action={action}, requestId={request_id} ===")

    response = {
        'requestId': request_id,
        'success': False,
        'action': action
    }

    try:
        if action == 'cancel':
            target_id = message.get('targetRequestId', 0)
            cancelled = cancel_request(target_id)
            response['success'] = True
            response['cancelled'] = cancelled
            response['result'] = 'Request cancelled' if cancelled else 'No active request found'
            return response

        if action == 'summarize':
            content = message.get('content', '')
            model = message.get('model', 'sonnet')
            result = query_claude(
                "Summarize the following web page content concisely:",
                context=content,
                request_id=request_id,
                model=model
            )
            response.update(result)
            response['result'] = result['response']
            response['success'] = result['success']

        elif action == 'ask':
            question = message.get('question', '')
            content = message.get('content', '')
            model = message.get('model', 'sonnet')
            result = query_claude(
                question,
                context=f"Based on this web page content:\n{content}",
                request_id=request_id,
                model=model
            )
            response.update(result)
            response['result'] = result['response']
            response['success'] = result['success']

        elif action == 'explain':
            selection = message.get('selection', '')
            model = message.get('model', 'sonnet')
            result = query_claude(
                f"Explain the following text or code snippet:\n{selection}",
                request_id=request_id,
                model=model
            )
            response.update(result)
            response['result'] = result['response']
            response['success'] = result['success']

        elif action == 'analyze_network':
            network_data = message.get('networkData', [])
            model = message.get('model', 'sonnet')
            result = query_claude(
                "Analyze this network activity and identify what's consuming the most resources. Provide insights on potential performance issues:",
                context=json.dumps(network_data, indent=2),
                request_id=request_id,
                model=model
            )
            response.update(result)
            response['result'] = result['response']
            response['success'] = result['success']

        elif action == 'suggest_dom_changes':
            html = message.get('html', '')
            request = message.get('request', '')
            model = message.get('model', 'sonnet')
            result = query_claude(
                f"""User request: {request}

Suggest specific DOM changes as a JSON array. Each change should have:
- "action": one of "setText", "setHTML", "setAttribute", "addClass", "removeClass", "setStyle", "remove"
- "selector": CSS selector for the target element
- For setText/setHTML: "value" with the new content
- For setAttribute: "attribute" and "value"
- For addClass/removeClass: "className"
- For setStyle: "property" and "value"

Example response format:
```json
[
  {{"action": "setText", "selector": "h1.title", "value": "New Title"}},
  {{"action": "setStyle", "selector": ".sidebar", "property": "display", "value": "none"}}
]
```

Respond with ONLY the JSON array, no other text.""",
                context=f"Current HTML structure:\n{html[:20000]}",
                request_id=request_id,
                model=model
            )
            response.update(result)
            response['result'] = result['response']
            response['success'] = result['success']

        elif action == 'ping':
            # Also return claude path for debugging
            claude_path = find_claude()
            response['result'] = 'pong'
            response['claude_path'] = claude_path or 'NOT FOUND'
            response['success'] = True

        else:
            response['error'] = f'Unknown action: {action}'

    except Exception as e:
        response['error'] = str(e)

    return response


def main():
    """Main message loop."""
    while True:
        try:
            message = read_message()
            if message is None:
                break

            response = handle_message(message)
            send_message(response)

        except Exception as e:
            send_message({
                'success': False,
                'error': str(e)
            })


if __name__ == '__main__':
    main()
