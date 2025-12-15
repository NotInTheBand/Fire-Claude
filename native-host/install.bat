@echo off
setlocal

set HOST_NAME=fire_claude_host
set SCRIPT_DIR=%~dp0
set MANIFEST_PATH=%SCRIPT_DIR%fire_claude_host.json

echo Installing Fire Claude native messaging host...
echo.

:: Update the manifest with absolute path
echo Updating manifest with absolute path...
powershell -Command "(Get-Content '%SCRIPT_DIR%fire_claude_host.json') -replace '\"path\": \"fire_claude_host.bat\"', '\"path\": \"%SCRIPT_DIR:\=\\%fire_claude_host.bat\"' | Set-Content '%MANIFEST_PATH%'"

:: Create registry key for Firefox
echo Creating registry entry...
reg add "HKCU\Software\Mozilla\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

if %errorlevel% equ 0 (
    echo.
    echo SUCCESS: Native messaging host registered successfully.
    echo.
    echo Manifest path: %MANIFEST_PATH%
    echo.
    echo Next steps:
    echo 1. Load the extension in Firefox via about:debugging
    echo 2. Open the Fire Claude sidebar
) else (
    echo.
    echo ERROR: Failed to register native messaging host.
    echo Try running this script as Administrator.
)

echo.
pause
