@echo off
chcp 65001 >nul
setlocal
REM  Transparent-window entry: ZCode already running, make its main window
REM  translucent. Transparent is a window-layer feature (Win32), does NOT
REM  use CDP - runs against any running ZCode regardless of debug port.
REM  ASCII-only here (Chinese prompts printed by transparent.ps1).
REM
REM  Runs transparent.ps1 in a SEPARATE console window via `start`, so this
REM  bat returns immediately (non-blocking). The transparency hotkey loop is
REM  long-lived; blocking the caller would freeze the wallpaper.bat menu for
REM  the whole hotkey session. The spawned window prints the hotkey help and
REM  stays open until Ctrl+Alt+0 (or you close it).
set "WP_ROOT=%~dp0.."
echo [transparent] Opening transparency control in a new window...
echo [transparent]   Ctrl+Alt+Up = more opaque   Ctrl+Alt+Down = more transparent   Ctrl+Alt+0 = restore and exit
start "ZCode Transparency" powershell -NoProfile -ExecutionPolicy Bypass -File "%WP_ROOT%\lib\transparent.ps1" %*
endlocal
