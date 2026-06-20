@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title ZCode 一键启动 (调试模式 + 控制中心)

REM ============================================================
REM  ZCode Wallpaper - one-click entry point.
REM  ----------------------------------------------------------
REM  Does THREE things in one double-click:
REM    Step 1: pre-check Node.js (needed by launch probe + control-server)
REM    Step 2: launch ZCode WITH debug port (delegates to bin/launch-zcode.bat,
REM            which taskkills any running ZCode first, then starts with
REM            --remote-debugging-port=9222, then waits for the window+port
REM            to be ready). This is the ONLY way to get CDP, which wallpaper
REM            injection + control center status both require.
REM    Step 3: start control-server in a PERSISTENT separate window
REM            (control-center SPA + reader SPA + status/action API). It prints
REM            the URL and copies http://127.0.0.1:17890/control/ to clipboard.
REM
REM  After this finishes: ZCode is open in debug mode + control-server is
REM  running. Paste the clipboard URL into ZCode's browser panel to open the
REM  control center, then drive everything (wallpaper/video/transparent/reader)
REM  from its buttons.
REM
REM  Why taskkill the old ZCode? Because ZCode started normally (double-click)
REM  has NO debug port, and Electron won't add it at runtime. The only way to
REM  get CDP is to relaunch with the flag, which requires killing the current
REM  instance (single-instance lock). Unavoidable cost of the CDP approach.
REM
REM  ASCII-only in this .bat (node prints Chinese itself).
REM ============================================================

set "WP_ROOT=%~dp0"
set "WP_ROOT=%WP_ROOT:~0,-1%"

REM ---------- Step 1: Node pre-check ----------
echo [start] Step 1/3: checking Node.js ...
where node >nul 2>nul
if errorlevel 1 (
  echo [start]   Node.js not found.
  echo [start]   Install Node.js LTS from https://nodejs.org then run start.bat again.
  echo.
  pause
  goto :hold
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
  echo [start] Control center was NOT started. Fix the above and run start.bat again.
  goto :hold
)
echo [start]   ZCode ready with debug port 9222.

REM ---------- Step 3: start control-server (persistent window) ----------
echo [start] Step 3/3: starting control-center server ^(persistent window^) ...
start "ZCode Control Center Server" cmd /k node "%WP_ROOT%\lib\control-server.cjs"
echo [start]   Control-center server launched in a separate window.
echo [start]   It will print the URL and copy it to your clipboard.
echo.
echo [start] ========================================================
echo [start]  All done! Next: in ZCode, open the browser panel and paste:
echo [start]    http://127.0.0.1:17890/control/
echo [start]  ^(already in your clipboard^)
echo [start]  Then drive wallpaper / video / transparent / reader from there.
echo [start]  Close the control-center server window to stop it.
echo [start] ========================================================

:hold
echo.
echo [start] Press any key to close this launcher window ...
pause >nul
endlocal
