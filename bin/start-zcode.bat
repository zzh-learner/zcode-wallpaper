@echo off
REM  Set the console to UTF-8 so Chinese-in-node-output shows right.
chcp 65001 >nul
setlocal enabledelayedexpansion
title ZCode Wallpaper Launcher

REM  ============================================================
REM  ZCode Wallpaper - one-click launcher (image/video wallpaper).
REM  ----------------------------------------------------------
REM  Launch is delegated to bin/launch-zcode.bat (shared with
REM  start-transparent.bat). This script only adds Step 4 (inject)
REM  and the hold/pause, so transparent mode can reuse launch
REM  WITHOUT triggering image injection.
REM
REM  Optional arg "video" switches to video wallpaper (passes
REM  --video to inject.cjs). No arg = image wallpaper.
REM  ASCII-only in this .bat (node prints Chinese itself).
REM  ============================================================

set "WP_ROOT=%~dp0.."
set "MODE_FLAG="
if /i "%~1"=="video" set "MODE_FLAG=--video"

call "%~dp0launch-zcode.bat"
set rc=!errorlevel!
if not "!rc!"=="0" goto :hold

:inject
echo [wallpaper] Step 4: inject wallpaper
node "%WP_ROOT%\lib\inject.cjs" %MODE_FLAG%
set rc=!errorlevel!
echo.
if "!rc!"=="0" (
  echo [wallpaper] ========================================
  echo [wallpaper]  Done! Wallpaper applied.
  echo [wallpaper]  - Change image: edit wallpaper.css [pic] then run inject-only.bat
  echo [wallpaper]  - Remove: run remove-wallpaper.bat
  echo [wallpaper] ========================================
) else (
  echo [wallpaper] Injection reported an issue ^(rc=!rc!^).
  echo [wallpaper] Try running inject-only.bat again in a few seconds.
)

:hold
echo.
echo [wallpaper] Press any key to close this window...
pause >nul
endlocal
