@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
REM  Transparent-window entry: ZCode already running, make its main window
REM  translucent. Transparent is a window-layer feature (Win32), does NOT
REM  use CDP - runs against any running ZCode regardless of debug port.
REM  ASCII-only here (Chinese prompts printed by transparent.ps1).
REM
REM  Prompts for an opacity 0-100 (100=opaque, 0=fully transparent), then
REM  sets it once and returns. No hotkey loop, no spawned window. Set-and-done.
REM  To change later: re-run; to restore: enter 100.
REM
REM  Validation is CLAMP + warn, not a re-ask loop: out-of-range input is
REM  clamped to 0/100 with a notice. A `set /p` re-ask loop is fragile under
REM  piped/redirected stdin and adds no real value for a single number.
set "WP_ROOT=%~dp0.."

echo.
echo --- Transparency ---
echo   Enter opacity 0-100  (100=opaque, 50=half, 0=invisible. Default 78).
set "opacity="
set /p "opacity=Opacity (0-100) [78]: "
if not defined opacity set "opacity=78"

REM  Numeric check: `set /a` yields 0 for non-numeric; reject unless literal 0.
set /a "op_num=%opacity%" 2>nul
if "!op_num!"=="0" if not "%opacity%"=="0" (
  echo [transparent] '%opacity%' is not a number - using default 78.
  set "op_num=78"
)

REM  Clamp to 0-100 with a notice (no loop).
if !op_num! LSS 0 (
  echo [transparent] %opacity% below 0 - clamping to 0.
  set "op_num=0"
)
if !op_num! GTR 100 (
  echo [transparent] %opacity% above 100 - clamping to 100.
  set "op_num=100"
)

echo [transparent] Setting opacity to !op_num!%% ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%WP_ROOT%\lib\transparent.ps1" -Opacity !op_num! %OPACITY_EXTRA%
set rc=!errorlevel!
if not "!rc!"=="0" (
  echo [transparent] transparent.ps1 exited rc=!rc! - see message above.
)
endlocal
