@echo off
setlocal

set HOST_NAME=fire_claude_host

echo Uninstalling Fire Claude native messaging host...
echo.

reg delete "HKCU\Software\Mozilla\NativeMessagingHosts\%HOST_NAME%" /f

if %errorlevel% equ 0 (
    echo.
    echo SUCCESS: Native messaging host unregistered successfully.
) else (
    echo.
    echo Note: Registry key may not have existed.
)

echo.
pause
