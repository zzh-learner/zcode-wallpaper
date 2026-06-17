@echo off
setlocal
REM  ZCode Wallpaper - Step 2 of 2: INJECT
REM  ----------------------------------------------------------
REM  Waits for the debug port to come up (up to ~30s), then
REM  injects the wallpaper CSS into every ZCode window.
REM
REM  Run this AFTER start-zcode.bat, once the ZCode window is open.
REM  ASCII-only on purpose (cmd.exe OEM codepage parsing).

set "WP_DIR=%~dp0"
set "WP_DIR=%WP_DIR:~0,-1%"
set "DEBUG_PORT=9222"

echo [wallpaper] Probing debug port %DEBUG_PORT% ...
set /a tries=0
:probe
set /a tries+=1
powershell -NoProfile -Command "try{$r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%DEBUG_PORT%/json' -TimeoutSec 2;$t=$r.Content|ConvertFrom-Json;if(($t|Where-Object {$_.type -eq 'page'}).Count -gt 0){exit 0}else{exit 2}}catch{exit 1}" >nul 2>nul
set rc=%errorlevel%
if "%rc%"=="0" goto inject
if %tries% lss 30 (
  ping -n 2 127.0.0.1 >nul 2>nul
  goto probe
)

echo.
echo [wallpaper] Could not reach ZCode debug port after %tries% tries.
if "%rc%"=="2" (
  echo [wallpaper] Port is open but no page window yet. Wait for the ZCode
  echo [wallpaper] window to fully load, then run this script again.
) else (
  echo [wallpaper] Port is not listening. Likely causes:
  echo [wallpaper]   1. ZCode was NOT started via start-zcode.bat.
  echo [wallpaper]   2. ZCode is still loading. Wait a few seconds and retry.
  echo [wallpaper]   3. A previous ZCode was still running and blocked launch.
)
echo.
pause
exit /b 1

:inject
echo [wallpaper] Port ready. Injecting wallpaper...
node "%WP_DIR%\inject.cjs"
set rc=%errorlevel%
echo.
if "%rc%"=="0" (
  echo [wallpaper] Done! Wallpaper applied.
) else (
  echo [wallpaper] Injection reported an issue ^(rc=%rc%^).
)
pause
endlocal
