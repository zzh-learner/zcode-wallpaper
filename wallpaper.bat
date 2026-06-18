@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title ZCode Wallpaper Launcher (menu)

REM ============================================================
REM  ZCode Wallpaper - master launcher menu.
REM  ----------------------------------------------------------
REM  Shows a Chinese scenario menu (printed by lib/menu.cjs so the
REM  .bat itself stays ASCII-only per AGENTS.md), dispatches to the
REM  existing scripts, then loops back to the menu.
REM
REM  Dispatch rules:
REM  - Combo scenarios (1, 3) call node lib/xxx.cjs directly to skip
REM    the pause that each sub-.bat would force mid-combo.
REM  - Single-script scenarios (2, 4, 5, 6, 7, 8, 9, 10) `call` the sub-.bat so its
REM    own pause still lets the user read output before returning.
REM  - Scenarios 7 & 8 are the video-wallpaper variants of 2 & 4: they pass
REM    the literal arg "video" to start-zcode.bat / inject-only.bat, which
REM    forwards it as --video to inject.cjs (image mode by default otherwise).
REM  - Scenarios 9 & 10 are the WINDOW-TRANSPARENT mode (not wallpaper):
REM    9 = start-transparent.bat (launch ZCode then make window translucent),
REM    10 = transparent.bat (ZCode already running). Transparent is a Win32
REM    window-layer feature, does NOT use CDP - independent subsystem from
REM    the image/video wallpaper injection. See AGENTS.md "窗口透明模式".
REM  - Scenarios 11 & 12 are the NOVEL-READER subsystem (4th, independent of
REM    wallpaper/transparent): 11 = reader-server.bat (start the persistent
REM    HTTP server that serves the reader SPA + /api from novels/*.txt),
REM    12 = print usage help (no server start). Reader runs in ZCode's built-in
REM    browser webview panel, not via CDP. See AGENTS.md "小说阅读器".
REM  - Scenario 1's last step `call`s start-zcode.bat (does NOT copy
REM    its probe+inject logic — see AGENTS.md "don't duplicate").
REM  - Each node-direct step checks errorlevel; on failure we stop and
REM    return to menu so the user can see exactly which link broke.
REM    The `call`-bat steps don't need a check here because every sub-.bat
REM    echoes its own [wallpaper] error context and pauses before returning.
REM  - Node.js is a precondition (menu + setup/resize/inject are .cjs).
REM    On a node-less machine, run setup.bat first for the friendly
REM    download-link pre-check; a guard below re-points there if node
REM    is missing at startup.
REM  ASCII-only in this .bat (node prints Chinese itself).
REM ============================================================

set "WP_DIR=%~dp0"
set "WP_DIR=%WP_DIR:~0,-1%"

REM  Pre-check Node once at startup. The menu itself needs node, and so do
REM  all scenarios. setup.bat has the detailed download-link message; here we
REM  just detect absence and point there rather than letting `node` emit a
REM  cryptic "not recognized" error against a blank screen.
where node >nul 2>nul
if errorlevel 1 (
  echo [wallpaper] Node.js not found.
  echo [wallpaper] This launcher needs Node.js to run. Run setup.bat first
  echo [wallpaper] ^(it has the download link^), or install Node.js LTS from
  echo [wallpaper] https://nodejs.org then run wallpaper.bat again.
  echo.
  pause
  goto :eof
)

:menu
cls
node "%WP_DIR%\lib\menu.cjs"
echo.
set "choice="
set /p "choice=Enter choice (0-12): "
if not defined choice goto menu

if "%choice%"=="1" goto scene_init
if "%choice%"=="2" goto scene_start
if "%choice%"=="3" goto scene_resize_inject
if "%choice%"=="4" goto scene_inject_only
if "%choice%"=="5" goto scene_remove
if "%choice%"=="6" goto scene_setup
if "%choice%"=="7" goto scene_start_video
if "%choice%"=="8" goto scene_inject_video
if "%choice%"=="9" goto scene_start_transparent
if "%choice%"=="10" goto scene_transparent
if "%choice%"=="11" goto scene_reader_server
if "%choice%"=="12" goto scene_reader_help
if "%choice%"=="0" goto :eof
goto menu

REM ---------- Scenario 1: init (setup + resize + start-zcode) ----------
:scene_init
echo [wallpaper] Step 1/3: setup (install deps) ...
node "%WP_DIR%\lib\setup.cjs"
if errorlevel 1 (
  echo [wallpaper] Step 1/3 failed. Stopped. Return to menu.
  pause
  goto menu
)
echo [wallpaper] Step 2/3: resize (build thumbnails) ...
node "%WP_DIR%\lib\resize.cjs"
if errorlevel 1 (
  echo [wallpaper] Step 2/3 failed. Stopped. Return to menu.
  pause
  goto menu
)
echo [wallpaper] Step 3/3: start ZCode with wallpaper ...
call "%WP_DIR%\bin\start-zcode.bat"
goto menu

REM ---------- Scenario 2: start-zcode ----------
:scene_start
call "%WP_DIR%\bin\start-zcode.bat"
goto menu

REM ---------- Scenario 3: resize + inject-only ----------
:scene_resize_inject
echo [wallpaper] Step 1/2: resize ...
node "%WP_DIR%\lib\resize.cjs"
if errorlevel 1 (
  echo [wallpaper] Step 1/2 failed. Stopped. Return to menu.
  pause
  goto menu
)
echo [wallpaper] Step 2/2: inject ...
call "%WP_DIR%\bin\inject-only.bat"
goto menu

REM ---------- Scenario 4: inject-only ----------
:scene_inject_only
call "%WP_DIR%\bin\inject-only.bat"
goto menu

REM ---------- Scenario 5: remove-wallpaper ----------
:scene_remove
call "%WP_DIR%\bin\remove-wallpaper.bat"
goto menu

REM ---------- Scenario 6: setup ----------
:scene_setup
call "%WP_DIR%\bin\setup.bat"
goto menu

REM ---------- Scenario 7: start-zcode with video wallpaper ----------
:scene_start_video
call "%WP_DIR%\bin\start-zcode.bat" video
goto menu

REM ---------- Scenario 8: inject-only video wallpaper ----------
:scene_inject_video
call "%WP_DIR%\bin\inject-only.bat" video
goto menu

REM ---------- Scenario 9: start-transparent (launch + translucent) ----------
:scene_start_transparent
call "%WP_DIR%\bin\start-transparent.bat"
goto menu

REM ---------- Scenario 10: transparent (ZCode already running) ----------
:scene_transparent
call "%WP_DIR%\bin\transparent.bat"
goto menu

REM ---------- Scenario 11: reader-server (start persistent HTTP server) ----------
:scene_reader_server
call "%WP_DIR%\bin\reader-server.bat"
goto menu

REM ---------- Scenario 12: reader help (print usage, no server start) ----------
:scene_reader_help
node -e "var s=['小说阅读器使用说明：','','1. 启动：选场景 11（或直接双击 bin/reader-server.bat）','2. 把 .txt 放进 novels/ 目录','3. 启动后 URL 自动复制到剪贴板','4. 在 ZCode 右侧浏览器面板粘贴回车','5. 从书架选书，或直接拖 .txt 进面板','6. 关闭服务窗口即停止','','快捷键：←/→ 翻章，滚轮滚正文','字号 A−/A+，主题 🌙/☀/📜 三个循环']; console.log(s.join('\n'));"
pause
goto menu
