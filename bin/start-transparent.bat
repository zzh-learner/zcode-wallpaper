@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title ZCode Transparent Launcher

REM  ============================================================
REM  One-click: launch ZCode (shared logic) then make it transparent.
REM  ----------------------------------------------------------
REM  Reuses bin/launch-zcode.bat for launch WITHOUT injecting a wallpaper
REM  (transparent is window-layer, not CDP). On launch failure, hold so
REM  the user can read the error.
REM  ASCII-only in this .bat (node/PS print Chinese themselves).
REM  ============================================================
set "WP_ROOT=%~dp0.."

echo [transparent] Step 1/2: launch ZCode (no wallpaper injection) ...
call "%~dp0launch-zcode.bat"
set rc=!errorlevel!
if not "!rc!"=="0" (
  echo [transparent] ZCode launch not ready rc=!rc! - transparent mode not started.
  goto :hold
)

echo.
echo [transparent] Step 2/2: make ZCode window transparent ...
call "%~dp0transparent.bat" %*

:hold
echo.
echo Press any key to close this window...
pause >nul
endlocal
