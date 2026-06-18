@echo off
REM  Remove the injected wallpaper, restoring ZCode's original look.
REM  Requires ZCode to have been started via start-zcode.bat (debug port).
REM  Project root = parent of this script's dir (bin/ lives under root)
set "WP_ROOT=%~dp0.."
node "%WP_ROOT%\lib\inject.cjs" --remove
if errorlevel 1 (
  echo [wallpaper] Removal failed. Make sure ZCode was started via start-zcode.bat.
)
