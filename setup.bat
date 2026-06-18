@echo off
chcp 65001 >nul
setlocal
title ZCode Wallpaper Setup

REM ============================================================
REM  ZCode Wallpaper - one-click setup for a new machine.
REM  ----------------------------------------------------------
REM  - Pre-checks Node.js exists (pure batch; setup.cjs needs it).
REM  - If missing, prints download link and exits.
REM  - Otherwise hands off to setup.cjs for all real work.
REM  ASCII-only in this .bat (node prints Chinese itself).
REM ============================================================

echo [wallpaper] Checking for Node.js ...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [wallpaper] Node.js not found.
  echo [wallpaper] Please install Node.js LTS ^(v18+^) from https://nodejs.org
  echo [wallpaper] Then run setup.bat again.
  echo.
  pause
  exit /b 1
)

echo [wallpaper] Node.js found. Running setup ...
echo.
node "%~dp0lib\setup.cjs"
set rc=%errorlevel%
echo.
if "%rc%"=="0" (
  echo [wallpaper] Setup finished successfully.
) else (
  echo [wallpaper] Setup reported an issue ^(rc=%rc%^).
)
pause
endlocal
