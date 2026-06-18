@echo off
REM  Set the console to UTF-8 so Chinese-in-node-output shows right.
chcp 65001 >nul
setlocal enabledelayedexpansion
title ZCode Wallpaper Launcher

REM ============================================================
REM  ZCode Wallpaper - one-click launcher
REM  ----------------------------------------------------------
REM  - Auto-detects ZCode.exe location
REM  - Kills any running ZCode (single-instance lock)
REM  - Launches ZCode with --remote-debugging-port=9222
REM  - Waits for the page window, then injects the wallpaper
REM  - No interactive prompts; everything automatic.
REM  ASCII-only in this .bat (node prints Chinese itself).
REM ============================================================

set "WP_DIR=%~dp0"
set "WP_DIR=%WP_DIR:~0,-1%"
set "DEBUG_PORT=9222"
set "ZCODE_EXE="

echo [wallpaper] Step 0: locate ZCode.exe
for /f "delims=" %%P in ('powershell -NoProfile -Command "(Get-Process ZCode -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)" 2^>nul') do set "ZCODE_EXE=%%P"
if not defined ZCODE_EXE for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\ZCode.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do set "ZCODE_EXE=%%B"
if not defined ZCODE_EXE for %%D in ("%LOCALAPPDATA%\Programs\ZCode\ZCode.exe" "D:\zcode\ZCode.exe" "C:\Program Files\ZCode\ZCode.exe" "C:\Program Files (x86)\ZCode\ZCode.exe") do if exist %%D set "ZCODE_EXE=%%~D"
if not defined ZCODE_EXE (
  echo [wallpaper]   ERROR: ZCode.exe not found.
  echo [wallpaper]   Edit this .bat and set ZCODE_EXE manually.
  goto :hold
)
echo [wallpaper]   Found: %ZCODE_EXE%

echo [wallpaper] Step 1: stop any running ZCode (single-instance lock)
tasklist /fi "imagename eq ZCode.exe" 2>nul | find /i "ZCode.exe" >nul
if not errorlevel 1 (
  echo [wallpaper]   ZCode is running, killing it...
  taskkill /f /im ZCode.exe >nul 2>nul
  ping -n 3 127.0.0.1 >nul 2>nul
) else (
  echo [wallpaper]   No ZCode running, good.
)

echo [wallpaper] Step 2: launch ZCode with debug port %DEBUG_PORT% (output to zcode-launch.log)
powershell -NoProfile -Command "$psi=New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName='%ZCODE_EXE%'; $psi.Arguments='--remote-debugging-port=%DEBUG_PORT%'; $psi.UseShellExecute=$false; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true; $p=[System.Diagnostics.Process]::Start($psi); $log='%WP_DIR%\zcode-launch.log'; '' | Out-File -LiteralPath $log -Encoding utf8; Register-ObjectEvent -InputObject $p -EventName OutputDataReceived -Action { if($EventArgs.Data){ Add-Content -LiteralPath $log -Value $EventArgs.Data } } | Out-Null; Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived -Action { if($EventArgs.Data){ Add-Content -LiteralPath $log -Value $EventArgs.Data } } | Out-Null; $p.BeginOutputReadLine(); $p.BeginErrorReadLine(); Write-Output ('  PID:'+$p.Id)"
echo [wallpaper]   Started. Waiting for the window to be ready...

echo [wallpaper] Step 3: wait for the debug port + a page target
set /a tries=0
:wait_ready
set /a tries+=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%WP_DIR%\probe.ps1" -Port %DEBUG_PORT% >nul 2>nul
set rc=!errorlevel!
if "!rc!"=="0" goto inject
if %tries% lss 40 (
  REM  ping is used for delay (not timeout/nobreak) because timeout fails
  REM  when stdin is redirected in a double-clicked console.
  ping -n 2 127.0.0.1 >nul 2>nul
  goto wait_ready
)
echo [wallpaper]   Timeout after %tries% tries ^(rc=!rc!^).
echo [wallpaper]   If the window just opened slowly, double-click inject-only.bat.
goto :hold

:inject
echo [wallpaper] Step 4: inject wallpaper ^(window ready after %tries% tries^)
node "%WP_DIR%\lib\inject.cjs"
set rc=!errorlevel!
echo.
if "!rc!"=="0" (
  echo [wallpaper] ========================================
  echo [wallpaper]  Done! Wallpaper applied.
  echo [wallpaper]  - Change image: edit wallpaper.css [pic] then run inject-only.bat
  echo [wallpaper]  - Transparency: edit wallpaper.css [alpha]
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
