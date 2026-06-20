@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title ZCode 一键启动 (调试模式 + 控制中心)

REM ============================================================
REM  ZCode Wallpaper - one-click entry point.
REM  ----------------------------------------------------------
REM  Double-click start.VBS (not this .bat) for a fully invisible run:
REM  no console windows at all, only ZCode appears. This .bat is what the
REM  .vbs launches hidden; it can also be double-clicked directly when you
REM  WANT to see the log output (e.g. debugging a failed launch).
REM
REM  Does THREE things:
REM    Step 0: kill any OLD control-server (so re-running this is clean — no
REM            need to hunt the old node in Task Manager)
REM    Step 1: pre-check Node.js (needed by launch probe + control-server)
REM    Step 2: launch ZCode WITH debug port (bin/launch-zcode.bat taskkills
REM            any running ZCode first, then starts with
REM            --remote-debugging-port=9222, waits for window+port ready)
REM    Step 3: start control-server HIDDEN (no console window). It serves
REM            the control-center SPA + reader SPA + status/action API and
REM            copies http://127.0.0.1:17890/control/ to the clipboard.
REM
REM  Stopping the server: just run start.vbs/start.bat again — Step 0 kills
REM  the old one. No Task Manager needed.
REM
REM  ASCII-only in this .bat (node prints Chinese itself).
REM ============================================================

set "WP_ROOT=%~dp0"
set "WP_ROOT=%WP_ROOT:~0,-1%"

REM ---------- Step 0: kill any old control-server (clean re-run) ----------
REM  Match node processes whose command line contains control-server.cjs.
REM  Precise — won't kill other node processes (ZCode's own, dev tools, etc).
echo [start] Step 0/3: stopping any old control-center server ...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*control-server.cjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul
echo [start]   done.

REM ---------- Step 1: Node pre-check ----------
echo [start] Step 1/3: checking Node.js ...
where node >nul 2>nul
if errorlevel 1 (
  echo [start]   Node.js not found.
  echo [start]   Install Node.js LTS from https://nodejs.org then run start.vbs again.
  echo.
  pause
  goto :eof
)
echo [start]   Node.js OK.

REM ---------- Step 2: launch ZCode with debug port ----------
echo [start] Step 2/3: launching ZCode in debug mode ^(may restart ZCode^) ...
call "%WP_ROOT%\bin\launch-zcode.bat"
set rc=!errorlevel!
if not "!rc!"=="0" (
  echo.
  echo [start] Step 2/3 FAILED ^(rc=!rc!^). ZCode did not come up with a debug port.
  echo [start] Possible causes: ZCode.exe not found, still loading, or another
  echo [start] ZCode blocked launch. See messages above from launch-zcode.bat.
  echo [start] Control center was NOT started. Fix the above and run start.vbs again.
  echo.
  pause
  goto :eof
)
echo [start]   ZCode ready with debug port 9222.

REM ---------- Step 3: start control-server HIDDEN (no console window) ----------
echo [start] Step 3/3: starting control-center server ^(hidden, no window^) ...
REM  Start-Process -WindowStyle Hidden: server runs in background with NO window.
REM  Verified: MainWindowHandle=0, no taskbar entry, but API still reachable.
REM  Clipboard write happens inside control-server.cjs as before.
powershell -NoProfile -Command "Start-Process -FilePath node -ArgumentList '\"\"%WP_ROOT%\\lib\\control-server.cjs\"\"' -WorkingDirectory '%WP_ROOT%' -WindowStyle Hidden" >nul 2>nul
REM  Give the server a moment to listen + write clipboard before we finish.
ping -n 3 127.0.0.1 >nul 2>nul
echo [start]   Control-center server started in background ^(no window^).
echo [start]   URL copied to clipboard.
echo.
echo [start] ========================================================
echo [start]  All done! Now in ZCode:
echo [start]    1. Open the browser panel ^(right side panel^)
echo [start]    2. Paste this URL into the address bar and press Enter:
echo [start]       http://127.0.0.1:17890/control/
echo [start]       ^(already in your clipboard^)
echo [start]  Then drive wallpaper / video / transparent / reader from there.
echo [start]  To stop the server: just run start.vbs/start.bat again.
echo [start] ========================================================
echo.
echo [start] NOTE: auto-opening the browser panel was tried but is unreliable
echo [start] ^(when the git tree has uncommitted changes, ZCode defaults the
echo [start] sidebar to the review panel, not browser^). So open it manually.

endlocal
