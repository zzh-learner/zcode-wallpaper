@echo off
REM  ============================================================
REM  Shared "launch ZCode with debug port" logic.
REM  ----------------------------------------------------------
REM  Extracted from start-zcode.bat so transparent mode can launch
REM  ZCode WITHOUT injecting a wallpaper (transparent is a window-
REM  layer feature, doesn't use CDP at all).
REM
REM  What it does (formerly start-zcode.bat Steps 0-3):
REM    Step 0: locate ZCode.exe
REM    Step 1: kill any running ZCode (single-instance lock)
REM    Step 2: launch with --remote-debugging-port=9222
REM    Step 3: probe.ps1 loop until debug port + page target ready
REM
REM  What it does NOT do: inject, or pause on exit. It exits with a
REM  return code so callers (start-zcode.bat / start-transparent.bat)
REM  decide what to do next.
REM
REM  Return codes (from probe.ps1, propagated via exit /b):
REM    0 = ready (port + page target up)
REM    1 = port never came up
REM    2 = port up but no page target
REM    3 = ZCode.exe not found / launch failed
REM
REM  ASCII-only in this .bat (node prints Chinese itself).
REM  ============================================================
chcp 65001 >nul
setlocal enabledelayedexpansion
title ZCode Launcher (shared)

set "WP_ROOT=%~dp0.."
set "DEBUG_PORT=9222"
set "ZCODE_EXE="

echo [wallpaper] Step 0: locate ZCode.exe
for /f "delims=" %%P in ('powershell -NoProfile -Command "(Get-Process ZCode -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)" 2^>nul') do set "ZCODE_EXE=%%P"
if not defined ZCODE_EXE for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\ZCode.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do set "ZCODE_EXE=%%B"
if not defined ZCODE_EXE for %%D in ("%LOCALAPPDATA%\Programs\ZCode\ZCode.exe" "D:\zcode\ZCode.exe" "C:\Program Files\ZCode\ZCode.exe" "C:\Program Files (x86)\ZCode\ZCode.exe") do if exist %%D set "ZCODE_EXE=%%~D"
if not defined ZCODE_EXE (
  echo [wallpaper]   ERROR: ZCode.exe not found.
  echo [wallpaper]   Edit start-zcode.bat and set ZCODE_EXE manually.
  exit /b 3
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
powershell -NoProfile -Command "$psi=New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName='%ZCODE_EXE%'; $psi.Arguments='--remote-debugging-port=%DEBUG_PORT% --autoplay-policy=no-user-gesture-required'; $psi.UseShellExecute=$false; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true; $p=[System.Diagnostics.Process]::Start($psi); $log='%WP_ROOT%\zcode-launch.log'; '' | Out-File -LiteralPath $log -Encoding utf8; Register-ObjectEvent -InputObject $p -EventName OutputDataReceived -Action { if($EventArgs.Data){ Add-Content -LiteralPath $log -Value $EventArgs.Data } } | Out-Null; Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived -Action { if($EventArgs.Data){ Add-Content -LiteralPath $log -Value $EventArgs.Data } } | Out-Null; $p.BeginOutputReadLine(); $p.BeginErrorReadLine(); Write-Output ('  PID:'+$p.Id)"
echo [wallpaper]   Started. Waiting for the window to be ready...

echo [wallpaper] Step 3: wait for the debug port + a page target
set /a tries=0
:wait_ready
set /a tries+=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0probe.ps1" -Port %DEBUG_PORT% >nul 2>nul
set rc=!errorlevel!
if "!rc!"=="0" goto ready
if %tries% lss 40 (
  REM  ping is used for delay (not timeout/nobreak) because timeout fails
  REM  when stdin is redirected in a double-clicked console.
  ping -n 2 127.0.0.1 >nul 2>nul
  goto wait_ready
)
echo [wallpaper]   Timeout after %tries% tries ^(rc=!rc!^).
echo [wallpaper]   If the window just opened slowly, run inject-only.bat or transparent.bat.
exit /b !rc!

:ready
echo [wallpaper]   Window ready after %tries% tries.
exit /b 0
