@echo off
:: Add npm global path so we can find 'claude' command
set PATH=%PATH%;%APPDATA%\npm;%LOCALAPPDATA%\npm
python -u "%~dp0fire_claude_host.py"
