#!/usr/bin/env python3
"""
Native messaging host for Fire Claude extension.
Bridges Firefox extension to Claude Code CLI.
"""

import sys
import json
import struct
import subprocess
from typing import Optional, Dict, Any


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


def query_claude(prompt: str, context: str = "") -> str:
    """Send a query to Claude Code CLI and return response."""
    full_prompt = f"{context}\n\n{prompt}" if context else prompt

    try:
        result = subprocess.run(
            ['claude', '--print', full_prompt],
            capture_output=True,
            text=True,
            timeout=120,
            shell=True
        )

        if result.returncode == 0:
            return result.stdout.strip()
        else:
            return f"Error: {result.stderr}"

    except subprocess.TimeoutExpired:
        return "Error: Claude Code request timed out"
    except FileNotFoundError:
        return "Error: Claude Code CLI not found. Please ensure it's installed and in PATH."
    except Exception as e:
        return f"Error: {str(e)}"


def handle_message(message: Dict[str, Any]) -> Dict[str, Any]:
    """Process incoming message and return response."""
    action = message.get('action')
    request_id = message.get('requestId')

    response = {'requestId': request_id, 'success': False}

    try:
        if action == 'summarize':
            content = message.get('content', '')
            result = query_claude(
                "Summarize the following web page content concisely:",
                context=content
            )
            response['result'] = result
            response['success'] = True

        elif action == 'ask':
            question = message.get('question', '')
            content = message.get('content', '')
            result = query_claude(
                question,
                context=f"Based on this web page content:\n{content}"
            )
            response['result'] = result
            response['success'] = True

        elif action == 'explain':
            selection = message.get('selection', '')
            result = query_claude(
                f"Explain the following text or code snippet:\n{selection}"
            )
            response['result'] = result
            response['success'] = True

        elif action == 'analyze_network':
            network_data = message.get('networkData', [])
            result = query_claude(
                "Analyze this network activity and identify what's consuming the most resources. Provide insights on potential performance issues:",
                context=json.dumps(network_data, indent=2)
            )
            response['result'] = result
            response['success'] = True

        elif action == 'suggest_dom_changes':
            html = message.get('html', '')
            request = message.get('request', '')
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
                context=f"Current HTML structure:\n{html[:20000]}"
            )
            response['result'] = result
            response['success'] = True

        elif action == 'ping':
            response['result'] = 'pong'
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
