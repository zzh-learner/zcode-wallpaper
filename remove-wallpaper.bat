@echo off
REM  Remove the injected wallpaper, restoring ZCode's original look.
REM  Requires ZCode to have been started via start-zcode.bat (debug port).
node "%~dp0lib\inject.cjs" --remove
if errorlevel 1 (
  echo [wallpaper] Removal failed. Make sure ZCode was started via start-zcode.bat.
)
