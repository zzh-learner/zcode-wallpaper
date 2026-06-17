@echo off
chcp 65001 >nul
setlocal
title ZCode Wallpaper Resizer

REM ============================================================
REM  ZCode Wallpaper - resize source images to renderable thumbs.
REM  ----------------------------------------------------------
REM  - Pre-checks Node.js exists.
REM  - Scales wallpapers/*.jpg to wallpapers-thumb/ (2560px, q85).
REM  - Incremental: skips already-resized images.
REM  ASCII-only in this .bat (node prints Chinese itself).
REM ============================================================

echo [wallpaper] Checking for Node.js ...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [wallpaper] Node.js not found.
  echo [wallpaper] Please install Node.js LTS ^(v18+^) from https://nodejs.org
  echo [wallpaper] Then run resize.bat again.
  echo.
  pause
  exit /b 1
)

echo [wallpaper] Node.js found. Resizing ...
echo.
node "%~dp0resize.cjs"
set rc=%errorlevel%
echo.
if "%rc%"=="0" (
  echo [wallpaper] Resize finished successfully.
) else (
  echo [wallpaper] Resize reported an issue ^(rc=%rc%^).
)
pause
endlocal
