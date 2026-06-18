@echo off
chcp 65001 >nul
setlocal
REM  Transparent-window entry: ZCode already running, make its main window
REM  translucent. Transparent is a window-layer feature (Win32), does NOT
REM  use CDP - runs against any running ZCode regardless of debug port.
REM  ASCII-only here (Chinese prompts printed by transparent.ps1).
set "WP_ROOT=%~dp0.."
echo [transparent] Make the running ZCode window translucent.
echo [transparent]   Ctrl+Alt+Up = more opaque   Ctrl+Alt+Down = more transparent   Ctrl+Alt+0 = restore and exit
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%WP_ROOT%\lib\transparent.ps1" %*
endlocal
