@echo off
chcp 65001 >nul
setlocal
title ZCode Reader Server

REM ============================================================
REM  ZCode Wallpaper - novel reader HTTP server launcher.
REM  ----------------------------------------------------------
REM  Starts lib/reader-server.cjs in a persistent window. The
REM  server scans novels/*.txt and serves the reader SPA + API.
REM  Close this window to stop the server.
REM  ASCII-only in this .bat (node prints Chinese itself).
REM ============================================================

echo [reader] Checking for Node.js ...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [reader] Node.js not found.
  echo [reader] Please install Node.js LTS ^(v18+^) from https://nodejs.org
  echo.
  pause
  exit /b 1
)

set "WP_ROOT=%~dp0.."
echo [reader] Starting reader server ^(persistent window^) ...
echo [reader] Close this window to stop it.
echo.

REM  Start in a NEW persistent window so the menu is not blocked.
REM  reader-server.cjs prints the URL + writes it to the clipboard.
start "ZCode Reader Server" cmd /k node "%WP_ROOT%\lib\reader-server.cjs"

echo [reader] Server launched in a separate window.
echo [reader] ^(It printed the URL and copied it to your clipboard.^)
endlocal
