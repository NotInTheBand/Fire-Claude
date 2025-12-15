# Fire Claude

A Firefox extension that provides AI-powered page analysis using your local Claude Code CLI installation.

## Features

- **Summarize Pages**: Get concise summaries of any web page
- **Ask Questions**: Chat with Claude about the current page content
- **Explain Selection**: Right-click any selected text to get an explanation
- **Network Analysis**: Analyze network requests to identify performance issues
- **Live DOM Changes**: Request changes to the page and apply them with one click

## Prerequisites

1. **Firefox** version 78.0 or higher
2. **Python** 3.7 or higher
3. **Claude Code CLI** installed and configured
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

## Installation

### Step 1: Install the Native Messaging Host

The extension communicates with Claude Code through a native messaging host.

1. Open a command prompt in the `native-host` directory
2. Run the installation script:
   ```batch
   install.bat
   ```
   This registers the native host with Firefox.

### Step 2: Load the Extension in Firefox

1. Open Firefox and navigate to `about:debugging`
2. Click **"This Firefox"** in the left sidebar
3. Click **"Load Temporary Add-on..."**
4. Navigate to the `extension` folder and select `manifest.json`

The Fire Claude icon should appear in your sidebar.

## Usage

### Opening the Sidebar

- Click the Fire Claude icon in the Firefox sidebar
- Or press `Ctrl+B` to toggle sidebars, then select Fire Claude

### Chat Features

- **Summarize Page**: Click the "Summarize Page" button to get a summary of the current page
- **Ask Questions**: Type a question in the chat input and press Enter or click Send
- **Suggest Changes**: Click "Suggest Changes" to request DOM modifications

### Context Menu

- Select any text on a page
- Right-click and choose **"Explain with Claude"**
- The explanation will appear in the sidebar

### Network Analysis

1. Switch to the "Network" tab in the sidebar
2. Click "Refresh" to see recorded network requests
3. Click "Analyze Network" to get Claude's analysis of resource usage

### Applying DOM Changes

1. Click "Suggest Changes" and describe what you want
2. Claude will suggest specific changes
3. Review the changes in the popup modal
4. Click "Apply Changes" to execute them

## Project Structure

```
Fire-Claude/
├── extension/                 # Firefox WebExtension
│   ├── manifest.json         # Extension manifest
│   ├── background/
│   │   └── background.js     # Background script
│   ├── sidebar/
│   │   ├── sidebar.html      # Sidebar UI
│   │   ├── sidebar.css       # Styles
│   │   └── sidebar.js        # Sidebar logic
│   ├── content/
│   │   └── content-script.js # Page content extraction
│   └── icons/
│       └── icon.svg          # Extension icon
├── native-host/              # Native messaging host
│   ├── fire_claude_host.py   # Python host script
│   ├── fire_claude_host.json # Native app manifest
│   ├── fire_claude_host.bat  # Launcher script
│   ├── install.bat           # Windows registry setup
│   └── uninstall.bat         # Registry cleanup
└── README.md
```

## Troubleshooting

### "Disconnected" status in sidebar

1. Make sure Python is installed and in your PATH
2. Verify Claude Code CLI is installed: `claude --version`
3. Re-run `install.bat` in the native-host folder
4. Check the Browser Console (`Ctrl+Shift+J`) for errors

### Context menu not appearing

1. Reload the extension in `about:debugging`
2. Refresh the web page

### Native host not found

1. Check that `install.bat` completed successfully
2. Verify the registry key exists:
   ```
   HKCU\Software\Mozilla\NativeMessagingHosts\fire_claude_host
   ```
3. Ensure the path in `fire_claude_host.json` is absolute

## Uninstallation

1. Remove the extension from `about:debugging`
2. Run `uninstall.bat` in the native-host folder to remove the registry entry

## Development

To modify the extension:

1. Make changes to files in the `extension` folder
2. Go to `about:debugging` > This Firefox
3. Click "Reload" next to Fire Claude

Changes to the native host (`fire_claude_host.py`) take effect immediately on the next request.

## License

MIT
