@echo off
chcp 65001 >nul
setlocal
title ZCode Control Center Server

REM ============================================================
REM  ZCode Wallpaper - control-center HTTP server launcher.
REM  ----------------------------------------------------------
REM  Starts lib/control-server.cjs in a persistent window. The
REM  server serves the control-center SPA + reader SPA + status/
REM  action API. Close this window to stop the server.
REM  ASCII-only in this .bat (node prints Chinese itself).
REM ============================================================

echo [control] Checking for Node.js ...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [control] Node.js not found.
  echo [control] Please install Node.js LTS ^(v18+^) from https://nodejs.org
  echo.
  pause
  exit /b 1
)

set "WP_ROOT=%~dp0.."
echo [control] Starting control-center server ^(persistent window^) ...
echo [control] Close this window to stop it.
echo.

REM  Start in a NEW persistent window so the menu is not blocked.
REM  control-server.cjs prints the URL + copies it to the clipboard.
start "ZCode Control Center Server" cmd /k node "%WP_ROOT%\lib\control-server.cjs"

echo [control] Server launched in a separate window.
echo [control] ^(It printed the URL and copied it to your clipboard.^)
endlocal
