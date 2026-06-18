# ZCode 窗口透明模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增第三种 ZCode 背景模式——窗口透明模式，用 Win32 `SetLayeredWindowAttributes` 让 ZCode 主窗口半透明，能透过窗口看桌面；常驻 PowerShell 监听 `Ctrl+Alt+↑/↓` 步进调透明度、`Ctrl+Alt+0` 恢复并退出。

**Architecture:** 独立子系统，**不走 CDP**（透明是窗口层的事，和渲染层注入是两个域）。共享启动逻辑抽到 `bin/launch-zcode.bat`（根除重复，顺便修 start-zcode"启动+注入焊死"的隐患）。窗口选择纯逻辑抽到 `lib/windowselect.cjs` 做 JS 单测，PS 侧实现同一规则。

**Tech Stack:** Windows batch（`.bat`，ASCII-only）、PowerShell 5.1+（`.ps1`，Win32 P/Invoke）、Node.js（`.cjs`，纯函数测试）、`npm test` 串行的 7 个 `*test.cjs`。

**Spec:** `docs/superpowers/specs/2026-06-18-transparent-window-design.md`

---

## File Structure

| 文件 | 责任 | 任务 |
|---|---|---|
| `bin/launch-zcode.bat` | **新建**：共享启动逻辑（定位/杀/启动带 debug port/等就绪），`exit /b !rc!` 收尾，不 pause | Task 1 |
| `bin/start-zcode.bat` | **重构**：Step 0-3 委托给 launch-zcode.bat，自身只剩 Step 4 (inject) + hold | Task 1 |
| `lib/windowselect.cjs` | **新建**：`selectMainWindow(pids, windows)` 纯函数 + 同名 PS 规则 | Task 2 |
| `test/transparenttest.cjs` | **新建**：测 `selectMainWindow` + 测 `transparent.ps1` 用假窗口数据 | Task 2 |
| `lib/transparent.ps1` | **新建**：探测窗口 → SetLayeredWindowAttributes → RegisterHotKey 循环 → finally 恢复 | Task 3 |
| `bin/transparent.bat` | **新建**：入口（对已开窗口），调 transparent.ps1 -File | Task 4 |
| `bin/start-transparent.bat` | **新建**：入口（一键启动），调 launch-zcode.bat → transparent.bat | Task 4 |
| `lib/menu.cjs` | **改**：加场景 9/10 | Task 5 |
| `test/menutest.cjs` | **改**：8→10 场景断言 | Task 5 |
| `wallpaper.bat` | **改**：菜单分发加 9/10 | Task 5 |
| `package.json` | **改**：test 串加入 transparenttest | Task 5 |
| `AGENTS.md` | **改**：加"窗口透明模式"章节 | Task 6 |

---

## Task 1: 抽出 `bin/launch-zcode.bat`，重构 `bin/start-zcode.bat`

**Why first:** 所有后续任务依赖"能单独启动 ZCode 而不注入"。先做这个并保证向后兼容（双击 start-zcode.bat 行为不变），是后续一切的地基。

**Files:**
- Create: `bin/launch-zcode.bat`
- Modify: `bin/start-zcode.bat`（整体重写，但保持对外行为）

- [ ] **Step 1: 先确认基线绿**

Run: `npm test`
Expected: 全部 PASS（7 个测试文件全绿）。如果基线就不绿，停下来先修。

- [ ] **Step 2: 创建 `bin/launch-zcode.bat`**（从 start-zcode.bat 抽出 Step 0-3）

Create `bin/launch-zcode.bat`:

```bat
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
powershell -NoProfile -Command "$psi=New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName='%ZCODE_EXE%'; $psi.Arguments='--remote-debugging-port=%DEBUG_PORT%'; $psi.UseShellExecute=$false; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true; $p=[System.Diagnostics.Process]::Start($psi); $log='%WP_ROOT%\zcode-launch.log'; '' | Out-File -LiteralPath $log -Encoding utf8; Register-ObjectEvent -InputObject $p -EventName OutputDataReceived -Action { if($EventArgs.Data){ Add-Content -LiteralPath $log -Value $EventArgs.Data } } | Out-Null; Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived -Action { if($EventArgs.Data){ Add-Content -LiteralPath $log -Value $EventArgs.Data } } | Out-Null; $p.BeginOutputReadLine(); $p.BeginErrorReadLine(); Write-Output ('  PID:'+$p.Id)"
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
```

- [ ] **Step 3: 重写 `bin/start-zcode.bat`**（委托给 launch-zcode.bat，保留 Step 4 + hold）

Overwrite `bin/start-zcode.bat`:

```bat
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
```

- [ ] **Step 4: 验证 menutest 仍绿（没动菜单，但要确认没碰坏别的）**

Run: `node test/menutest.cjs`
Expected: 全 PASS。

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: 全部 PASS（7 个测试文件）。

- [ ] **Step 6: 人工冒烟（可选但强烈建议）**

双击 `bin/start-zcode.bat`，确认：标题栏正常、Step 0-4 都走、ZCode 起来、图片壁纸注入成功、按任意键关闭。如果手头没有 ZCode 环境可跳过，但要心里有数 launch-zcode.bat 这步是没人工验过的。

- [ ] **Step 7: Commit**

```bash
git add bin/launch-zcode.bat bin/start-zcode.bat
git commit -m "refactor: 抽出 bin/launch-zcode.bat 共享启动逻辑

Step 0-3 (定位/杀/启动带 debug port/probe 等就绪) 从 start-zcode.bat
抽到 launch-zcode.bat，用 exit /b !rc! 传 rc，不 pause。start-zcode.bat
只剩 Step 4 (inject) + hold。

为透明模式铺路：透明是窗口层功能不走 CDP，需要'启动 ZCode 但不注入'，
现状把启动+注入焊死了。抽共享脚本根除重复（AGENTS.md 核心教训 1），
顺便修 start-zcode 的焊死隐患。

向后兼容：双击 start-zcode.bat 行为完全不变（启动→注入→hold）。
npm test 全绿。"
```

---

## Task 2: `lib/windowselect.cjs` + `test/transparenttest.cjs`（TDD）

**Why:** 窗口选择是透明模式唯一能纯函数测的逻辑（Win32 调用是 OS 行为，mock 没意义）。先 TDD 这块，钉死"面积最大 + PID 过滤 + visible/toplevel 过滤"规则。

**Files:**
- Create: `lib/windowselect.cjs`
- Create: `test/transparenttest.cjs`

- [ ] **Step 1: 写 `lib/windowselect.cjs`**（纯函数）

Create `lib/windowselect.cjs`:

```js
// Window-selection logic for transparent mode, as a PURE JS function.
//
// transparent.ps1 does the real Win32 work (EnumWindows etc.) and produces
// a list of candidate windows, but the SELECTION RULE — "which candidate is
// the main window?" — is duplicated here in JS so it can be unit-tested.
// The PS side MUST keep its rule identical to this one (see spec §5.3/§8.1).
//
// Rule (spec §5.3):
//   1. Filter to windows whose pid is in the target process's pid set.
//   2. Filter to visible AND toplevel (owner==0) windows.
//   3. Sort candidates by window area (width*height) descending.
//   4. If exactly 0 candidates -> return null (caller: error "no window").
//   5. If exactly 1 candidate -> return it (auto-pick).
//   6. If >1 candidates -> return {ambiguous: true, candidates}: caller
//      (PS side) will list them and read-host. We deliberately DON'T
//      auto-pick the largest when ambiguous, because DevTools maximized
//      could outrank the main window — user confirmation is safer.

/**
 * @param {Set<number>|number[]} pids - target process pids
 * @param {Array<{hwnd:number, pid:number, className:string, title:string,
 *               width:number, height:number, visible:boolean, toplevel:boolean}>} windows
 * @returns {{hwnd:number, ...}|null|{ambiguous:true, candidates:Array}}
 */
function selectMainWindow(pids, windows) {
  const pidSet = pids instanceof Set ? pids : new Set(pids);
  const candidates = windows.filter(
    (w) =>
      pidSet.has(w.pid) &&
      w.visible &&
      w.toplevel &&
      w.width > 0 &&
      w.height > 0
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Ambiguous: sort by area desc so caller can show the most-likely-first.
  const sorted = candidates
    .slice()
    .sort((a, b) => b.width * b.height - a.width * a.height);
  return { ambiguous: true, candidates: sorted };
}

module.exports = { selectMainWindow };
```

- [ ] **Step 2: 写 `test/transparenttest.cjs`**（对齐 selftest/menutest 风格）

Create `test/transparenttest.cjs`:

```js
// Test for lib/windowselect.cjs — the pure window-selection rule shared
// with lib/transparent.ps1 (which does the real Win32 work; this is the
// JS mirror so the rule can be unit-tested, see spec §8.1).
//
// Guards against rule drift: if someone changes PS to pick "first window"
// instead of "area-largest", or forgets the pid/visible/toplevel filters,
// these tests catch it (the JS mirror would also need to change, forcing
// a spec revisit).
//
// Run: node test/transparenttest.cjs

const { selectMainWindow } = require("../lib/windowselect.cjs");

let pass = 0,
  fail = 0;
function check(name, cond) {
  console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name);
  cond ? pass++ : fail++;
}

const PIDS = new Set([1234]);

// --- single candidate: auto-pick ---
check(
  "single candidate is auto-picked",
  selectMainWindow(PIDS, [
    { hwnd: 1, pid: 1234, className: "Chrome_WidgetWin_1", title: "ZCode", width: 800, height: 600, visible: true, toplevel: true },
  ]).hwnd === 1
);

// --- pid filter ---
check(
  "window with wrong pid is filtered out -> null",
  selectMainWindow(PIDS, [
    { hwnd: 2, pid: 9999, className: "X", title: "other", width: 800, height: 600, visible: true, toplevel: true },
  ]) === null
);

// --- visible filter ---
check(
  "non-visible window is filtered out -> null",
  selectMainWindow(PIDS, [
    { hwnd: 3, pid: 1234, className: "X", title: "hidden", width: 800, height: 600, visible: false, toplevel: true },
  ]) === null
);

// --- toplevel filter ---
check(
  "non-toplevel window (child/owned) is filtered out -> null",
  selectMainWindow(PIDS, [
    { hwnd: 4, pid: 1234, className: "X", title: "child", width: 800, height: 600, visible: true, toplevel: false },
  ]) === null
);

// --- zero-area filter ---
check(
  "zero-size window is filtered out -> null",
  selectMainWindow(PIDS, [
    { hwnd: 5, pid: 1234, className: "X", title: "zero", width: 0, height: 0, visible: true, toplevel: true },
  ]) === null
);

// --- empty input ---
check("empty windows list -> null", selectMainWindow(PIDS, []) === null);

// --- ambiguous: multiple candidates -> {ambiguous, candidates} sorted desc ---
const amb = selectMainWindow(PIDS, [
  { hwnd: 10, pid: 1234, className: "A", title: "small",  width: 400, height: 300, visible: true, toplevel: true },
  { hwnd: 11, pid: 1234, className: "B", title: "big",    width: 1200, height: 800, visible: true, toplevel: true },
  { hwnd: 12, pid: 1234, className: "C", title: "medium", width: 800, height: 600, visible: true, toplevel: true },
]);
check("multiple candidates -> ambiguous result", amb && amb.ambiguous === true);
check(
  "ambiguous candidates sorted by area desc",
  amb && amb.candidates.map((c) => c.hwnd).join(",") === "11,12,10"
);

// --- pids can be an array or a Set ---
check(
  "pids accepts array (not just Set)",
  selectMainWindow([1234], [
    { hwnd: 20, pid: 1234, className: "X", title: "x", width: 100, height: 100, visible: true, toplevel: true },
  ]).hwnd === 20
);

// --- mixed: one valid + some noise -> single valid auto-picked (NOT ambiguous) ---
check(
  "one valid + invisible noise -> single auto-pick, not ambiguous",
  selectMainWindow(PIDS, [
    { hwnd: 30, pid: 1234, className: "X", title: "main", width: 800, height: 600, visible: true, toplevel: true },
    { hwnd: 31, pid: 1234, className: "X", title: "hidden-noise", width: 2000, height: 2000, visible: false, toplevel: true },
  ]).hwnd === 30
);

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 3: 跑测试确认全 PASS**

Run: `node test/transparenttest.cjs`
Expected: 全 PASS（10 个 check）。

- [ ] **Step 4: Commit**

```bash
git add lib/windowselect.cjs test/transparenttest.cjs
git commit -m "feat(transparent): 窗口选择纯函数 + 单测

lib/windowselect.cjs: selectMainWindow(pids, windows) 纯函数，
规则对齐 spec §5.3（pid 过滤 + visible + toplevel + 零面积过滤；
单候选自动选，多候选返回 {ambiguous, candidates} 按 area 降序）。

lib/transparent.ps1 的探测会调真 Win32 拿数据，但选择规则必须和
这个 JS 版一致——把规则抽出来单测，防 PS 侧规则漂移（spec §8.1）。

Win32 调用本身不测（OS 行为，mock 真实 HWND 没意义）。"
```

---

## Task 3: `lib/transparent.ps1`（核心：探测 + 设透明 + 热键循环）

**Why:** 透明模式的核心。选择规则**必须**对齐 Task 2 的 `selectMainWindow`（pid 过滤 / visible / toplevel / 单候选自动选 / 多候选 read-host）。

**Files:**
- Create: `lib/transparent.ps1`

- [ ] **Step 1: 创建 `lib/transparent.ps1`**

Create `lib/transparent.ps1`:

```powershell
# ============================================================
# ZCode 窗口透明模式 —— 用 Win32 SetLayeredWindowAttributes 让
# ZCode 主窗口半透明，能透过窗口看桌面。
# ------------------------------------------------------------
# 这是独立子系统：不走 CDP（透明是窗口层的事，见 spec §6）。
# 常驻监听热键调透明度：
#   Ctrl+Alt+Up   变不透明 (+Step)
#   Ctrl+Alt+Down 变透明     (-Step)
#   Ctrl+Alt+0    恢复完全不透明 + 退出
#
# 窗口选择规则必须和 lib/windowselect.cjs 的 selectMainWindow 一致
# （spec §5.3/§8.1）：pid 过滤 + visible + toplevel + 零面积过滤；
# 单候选自动选，多候选 read-host 让用户选。
#
# 用法（必须 -File 跑，见 AGENTS.md 环境注意）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File lib/transparent.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File lib/transparent.ps1 -ProcessName ZCode -InitialAlpha 180
# ============================================================

param(
  [string]$ProcessName  = "ZCode",
  [int]   $InitialAlpha = 200,   # 0-255, 默认 ~78%（偏不透明保可读）
  [int]   $Step         = 25,
  [int]   $MinAlpha     = 30,    # 防止调到完全看不见
  [int]   $MaxAlpha     = 255
)

# Win32 P/Invoke。常量命名清楚，不在 C# 里裸写 magic number。
$win32Code = @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern int  GetWindowLong(IntPtr h, int nIndex);
  [DllImport("user32.dll")] public static extern int  SetWindowLong(IntPtr h, int nIndex, int dwNewLong);
  [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [StructLayout(LayoutKind.Sequential)]
  public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int pt_x; public int pt_y; }
  [DllImport("user32.dll")] public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
}
"@
Add-Type -TypeDefinition $win32Code -Language CSharp

# Win32 常量
$GWL_EXSTYLE     = -20
$WS_EX_LAYERED   = 0x00080000
$LWA_ALPHA       = 0x00000002
$MOD_CONTROL     = 0x0002
$MOD_ALT         = 0x0001
$VK_UP           = 0x26
$VK_DOWN         = 0x28
$VK_0            = 0x30
$WM_HOTKEY       = 0x0312
$HOTKEY_UP       = 1
$HOTKEY_DOWN     = 2
$HOTKEY_ZERO     = 3

# ---- 1) 找目标进程的 PID 集合 ----
$procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
if (-not $procs -or @($procs).Count -eq 0) {
  Write-Host "[transparent] 没找到进程 '$ProcessName'。" -ForegroundColor Yellow
  Write-Host "[transparent] 用 Get-Process 看真实进程名（Electron 应用可能叫别的），"
  Write-Host "[transparent] 然后: powershell -File transparent.ps1 -ProcessName <真实名>"
  exit 1
}
$pidSet = @($procs).Id

# ---- 2) 枚举顶层窗口，过滤候选 ----
# 用 Get-Process 的 MainWindowHandle + 一个枚举所有顶层窗口的小技巧：
# 通过 Add-Type 加一个 EnumWindows 委托。简单起见这里用 .NET API
# 过滤可见顶层窗口。
$enumCode = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnum {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<string> Dump(IntPtr[] pidFilter) {
    var pids = new HashSet<uint>();
    foreach (var p in pidFilter) pids.Add((uint)p);
    var lines = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid)) return true;
      RECT r; GetWindowRect(h, out r);
      var title = new StringBuilder(256); GetWindowText(h, title, 256);
      var cls   = new StringBuilder(256); GetClassName(h, cls, 256);
      // GW_OWNER = 4
      var owner = GetWindow(h, 4);
      lines.Add(h.ToInt64() + "|" + pid + "|" + cls + "|" + title + "|"
                + (r.Right - r.Left) + "x" + (r.Bottom - r.Top) + "|" + (owner == IntPtr.Zero ? "1" : "0"));
      return true;
    }, IntPtr.Zero);
    return lines;
  }
}
"@
Add-Type -TypeDefinition $enumCode -Language CSharp

$raw = [WinEnum]::Dump([IntPtr[]]($pidSet | ForEach-Object { [IntPtr]$_ }))
# 解析成对象数组（对齐 windowselect.cjs 的 shape）
$windows = foreach ($line in $raw) {
  $p = $line -split '\|'
  $size = $p[5] -split 'x'
  [pscustomobject]@{
    hwnd      = [long]$p[0]
    pid       = [int]$p[1]
    className = $p[2]
    title     = $p[3]
    width     = [int]$size[0]
    height    = [int]$size[1]
    visible   = $true       # EnumWindows+IsWindowVisible 已过滤
    toplevel  = ($p[6] -eq "1")
  }
}
# 应用 windowselect.cjs 同款规则：pid（已过滤）+ visible（已）+ toplevel + 面积>0
$candidates = @($windows | Where-Object { $_.toplevel -and $_.width -gt 0 -and $_.height -gt 0 })

if ($candidates.Count -eq 0) {
  Write-Host "[transparent] 进程 '$ProcessName' 在跑，但没找到可见顶层窗口。" -ForegroundColor Yellow
  exit 2
}

# 选择（对齐 windowselect.cjs：单候选自动选，多候选 read-host）
if ($candidates.Count -eq 1) {
  $chosen = $candidates[0]
  Write-Host "[transparent] 唯一候选窗口: '$($chosen.title)' ($($chosen.width)x$($chosen.height))"
} else {
  # 多候选：按面积降序列出，让用户选（对齐 windowselect.cjs 的 ambiguous 分支）
  $sorted = @($candidates | Sort-Object { $_.width * $_.height } -Descending)
  Write-Host "[transparent] 找到 $($sorted.Count) 个候选窗口，请选主窗口："
  for ($i = 0; $i -lt $sorted.Count; $i++) {
    $w = $sorted[$i]
    Write-Host ("  [{0}] '{1}'  {2}x{3}  (class={4})" -f $i, $w.title, $w.width, $w.height, $w.className)
  }
  $sel = Read-Host "输入序号 (0-$($sorted.Count - 1))"
  $idx = 0; if (-not [int]::TryParse($sel, [ref]$idx) -or $idx -lt 0 -or $idx -ge $sorted.Count) {
    Write-Host "[transparent] 无效序号，退出。" -ForegroundColor Yellow
    exit 3
  }
  $chosen = $sorted[$idx]
  Write-Host "[transparent] 已选: '$($chosen.title)'"
}
$hwnd = [IntPtr]$chosen.hwnd

# ---- 3) 设透明 ----
function Set-Alpha($h, $a) {
  $style = [Win32]::GetWindowLong($h, $GWL_EXSTYLE)
  [Win32]::SetWindowLong($h, $GWL_EXSTYLE, $style -bor $WS_EX_LAYERED) | Out-Null
  [Win32]::SetLayeredWindowAttributes($h, 0, $a, $LWA_ALPHA) | Out-Null
}

$script:alpha = $InitialAlpha
Set-Alpha $hwnd $script:alpha
Write-Host "[transparent] 已设透明 alpha=$script:alpha/255"

# ---- 4) 注册热键 ----
$okUp   = [Win32]::RegisterHotKey([IntPtr]::Zero, $HOTKEY_UP,   $MOD_CONTROL -bor $MOD_ALT, $VK_UP)
$okDown = [Win32]::RegisterHotKey([IntPtr]::Zero, $HOTKEY_DOWN, $MOD_CONTROL -bor $MOD_ALT, $VK_DOWN)
$okZero = [Win32]::RegisterHotKey([IntPtr]::Zero, $HOTKEY_ZERO, $MOD_CONTROL -bor $MOD_ALT, $VK_0)
if (-not $okUp -or -not $okDown -or -not $okZero) {
  Write-Warning "部分热键注册失败 (Up=$okUp Down=$okDown Zero=$okZero)，可能和其他软件冲突。"
}
Write-Host "[transparent] 热键: Ctrl+Alt+Up=变不透明  Ctrl+Alt+Down=变透明  Ctrl+Alt+0=恢复并退出"

# ---- 5) 消息循环 ----
$exitLoop = $false
try {
  while (-not $exitLoop) {
    $msg = New-Object Win32+MSG
    $ret = [Win32]::GetMessage([ref]$msg, [IntPtr]::Zero, 0, 0)
    if ($ret -le 0) { break }   # WM_QUIT 或出错
    if ($msg.message -eq $WM_HOTKEY) {
      switch ([int]$msg.wParam) {
        $HOTKEY_UP {
          $script:alpha = [Math]::Min($MaxAlpha, $script:alpha + $Step)
          Set-Alpha $hwnd $script:alpha
          Write-Host "[transparent] alpha = $script:alpha / 255"
        }
        $HOTKEY_DOWN {
          $script:alpha = [Math]::Max($MinAlpha, $script:alpha - $Step)
          Set-Alpha $hwnd $script:alpha
          Write-Host "[transparent] alpha = $script:alpha / 255"
        }
        $HOTKEY_ZERO {
          Write-Host "[transparent] 恢复不透明并退出..."
          $exitLoop = $true
        }
      }
    }
  }
}
finally {
  # 退出清理：即使 Ctrl+C 也恢复（PS 的 finally 在 trap/Ctrl+C 下会执行）
  [Win32]::UnregisterHotKey([IntPtr]::Zero, $HOTKEY_UP)   | Out-Null
  [Win32]::UnregisterHotKey([IntPtr]::Zero, $HOTKEY_DOWN) | Out-Null
  [Win32]::UnregisterHotKey([IntPtr]::Zero, $HOTKEY_ZERO) | Out-Null
  Set-Alpha $hwnd 255
  $style = [Win32]::GetWindowLong($hwnd, $GWL_EXSTYLE)
  [Win32]::SetWindowLong($hwnd, $GWL_EXSTYLE, $style -band (-bnot $WS_EX_LAYERED)) | Out-Null
  Write-Host "[transparent] 已恢复不透明并退出。"
}
```

- [ ] **Step 2: 语法检查（不实际跑，避免真改窗口）**

Run:
```
powershell -NoProfile -Command "$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw lib\transparent.ps1), [ref]$null); 'syntax OK'"
```
Expected: `syntax OK`。如果报错，修语法（不是逻辑——逻辑要靠 Task 6 人工验）。

- [ ] **Step 3: 确认 transparenttest 仍绿（没动 windowselect）**

Run: `node test/transparenttest.cjs`
Expected: 全 PASS。

- [ ] **Step 4: Commit**

```bash
git add lib/transparent.ps1
git commit -m "feat(transparent): transparent.ps1 探测+设透明+热键循环

Win32 P/Invoke: GetWindowLong/SetWindowLong/SetLayeredWindowAttributes
+ RegisterHotKey/UnregisterHotKey + GetMessage 消息循环。

探测规则对齐 lib/windowselect.cjs 的 selectMainWindow：pid 过滤 +
visible + toplevel + 零面积过滤；单候选自动选，多候选 read-host
（对齐 ambiguous 分支）。

热键: Ctrl+Alt+Up/Down 步进 ±Step (默认25)，Ctrl+Alt+0 恢复+退出。
默认 alpha=200 (~78%，偏不透明保可读)。finally 块保证 Ctrl+C 也恢复。

独立子系统，不走 CDP（spec §6）。只过语法检查，逻辑靠 Task 6 人工验。"
```

---

## Task 4: `bin/transparent.bat` + `bin/start-transparent.bat`

**Files:**
- Create: `bin/transparent.bat`
- Create: `bin/start-transparent.bat`

- [ ] **Step 1: 创建 `bin/transparent.bat`**（入口：对已开窗口）

Create `bin/transparent.bat`:

```bat
@echo off
chcp 65001 >nul
setlocal
REM  Transparent-window entry: ZCode already running, make its main window
REM  translucent. Transparent is a window-layer feature (Win32), does NOT
REM  use CDP — runs against any running ZCode regardless of debug port.
set "WP_ROOT=%~dp0.."
echo [transparent] 对已运行的 ZCode 窗口设透明
echo [transparent]   Ctrl+Alt+Up = 变不透明   Ctrl+Alt+Down = 变透明   Ctrl+Alt+0 = 恢复并退出
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%WP_ROOT%\lib\transparent.ps1" %*
endlocal
```

- [ ] **Step 2: 创建 `bin/start-transparent.bat`**（入口：一键启动）

Create `bin/start-transparent.bat`:

```bat
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
  echo [transparent] ZCode 启动未就绪 (rc=!rc!)，透明模式不启动。
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
```

- [ ] **Step 3: 跑全量测试确认没碰坏（bat 本身没测试覆盖，靠 npm test 兜底）**

Run: `npm test`
Expected: 全 PASS（7 个测试文件）。

- [ ] **Step 4: Commit**

```bash
git add bin/transparent.bat bin/start-transparent.bat
git commit -m "feat(transparent): 入口脚本 transparent.bat + start-transparent.bat

bin/transparent.bat: 对已开窗口（对齐场景4/8 定位）。
bin/start-transparent.bat: 一键启动（对齐场景2/7 定位），
  调 launch-zcode.bat 启动 ZCode（不注入图片壁纸），成功后调 transparent.bat。

ASCII-only（AGENTS.md），中文由 PS 自己打印。"
```

---

## Task 5: 菜单集成 + 测试 + package.json

**Files:**
- Modify: `lib/menu.cjs`（加场景 9/10）
- Modify: `test/menutest.cjs`（8→10 断言）
- Modify: `wallpaper.bat`（分发加 9/10）
- Modify: `package.json`（test 串加入 transparenttest）

- [ ] **Step 1: 改 `lib/menu.cjs`**（加场景 9/10）

In `lib/menu.cjs`, after the scenario 8 object (the `inject-only(video)` one), add:

```js
  {
    key: "9",
    title: "启动带透明窗口",
    desc: "ZCode 没开时，一键启动并设窗口透明（能看桌面，Ctrl+Alt+↑/↓ 调）",
    calls: "start-transparent",
  },
  {
    key: "10",
    title: "对已开窗口设透明",
    desc: "ZCode 已经开着，把它的窗口设成半透明（看得到桌面）",
    calls: "transparent",
  },
```

- [ ] **Step 2: 改 `test/menutest.cjs`**（8→10）

In `test/menutest.cjs`:

- Line ~26: `check("SCENARIOS has 8 entries", SCENARIOS.length === 8);` → 改成 `=== 10`
- Line ~27: `SCENARIOS.map((s) => s.key).join("") === "12345678"` → 改成 `"12345678910"`
- In `requiredCalls` array, append `"start-transparent"` and `"transparent"` (so the array has 10 entries)
- In the call-chain coverage loop (line ~50), extend the array:
  ```js
  ["setup", "resize", "start-zcode", "inject-only", "remove-wallpaper", "start-transparent", "transparent", "launch-zcode"].forEach((name) => {
  ```
  (注：`launch-zcode` 在 calls 标注里不出现，但它存在 `bin/`，这里只检查 calls 文本里出现的脚本名。`launch-zcode` 不在 calls 里，应该从这行去掉——只留真正出现在 calls 里的：`["setup", "resize", "start-zcode", "inject-only", "remove-wallpaper", "start-transparent", "transparent"]`)

- [ ] **Step 3: 改 `wallpaper.bat`**（分发加 9/10）

In `wallpaper.bat`:

- Line 57: `set /p "choice=Enter choice (0-8): "` → 改成 `(0-10)`
- After line 67 (`if "%choice%"=="8" goto scene_inject_video`), add:
  ```bat
  if "%choice%"=="9" goto scene_start_transparent
  if "%choice%"=="10" goto scene_transparent
  ```
- After the `:scene_inject_video` block (before `:eof`/end), add:
  ```bat

  REM ---------- Scenario 9: start-transparent ----------
  :scene_start_transparent
  call "%WP_DIR%\bin\start-transparent.bat"
  goto menu

  REM ---------- Scenario 10: transparent (already running) ----------
  :scene_transparent
  call "%WP_DIR%\bin\transparent.bat"
  goto menu
  ```

- [ ] **Step 4: 改 `package.json`**（test 串加入 transparenttest）

In `package.json`, the `test` script: append `&& node test/transparenttest.cjs` to the end of the chain. Place it right after `menutest.cjs` (or at the end — either works; menutest should stay near the end since it depends on menu structure). Final:

```
node test/selftest.cjs && node test/cdp-mock-test.cjs && node test/cdp-retry-test.cjs && node test/setuptest.cjs && node test/resizetest.cjs && node test/probetest.cjs && node test/menutest.cjs && node test/transparenttest.cjs
```

- [ ] **Step 5: 跑 menutest 确认新断言通过**

Run: `node test/menutest.cjs`
Expected: 全 PASS，包含新增的 "scenario 9 title in output" / "scenario 10 calls annotation correct" 等。

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: 全 PASS（8 个测试文件，新增 transparenttest）。

- [ ] **Step 7: Commit**

```bash
git add lib/menu.cjs test/menutest.cjs wallpaper.bat package.json
git commit -m "feat(transparent): 菜单集成场景 9/10 + 测试

lib/menu.cjs: 场景9「启动带透明窗口」calls=start-transparent，
场景10「对已开窗口设透明」calls=transparent。
wallpaper.bat: 分发加 9/10，prompt 改 0-10。
test/menutest.cjs: 8→10 场景断言，calls 覆盖加 start-transparent/transparent。
package.json: test 串加入 transparenttest。"
```

---

## Task 6: 文档 + 人工验证

**Files:**
- Modify: `AGENTS.md`（加"窗口透明模式"章节）
- Manual: 人眼验透明真生效

- [ ] **Step 1: 在 `AGENTS.md` 加章节**（在"视频壁纸"章节之后）

在 `AGENTS.md` 的 `## 视频壁纸（--video 模式）` 整段之后，`## 测试` 之前，加：

```markdown
## 窗口透明模式（看桌面）

第三种背景。和图片/视频**完全不同的层**：那俩是渲染层（CDP 注入 CSS/DOM），
透明是**原生窗口层**——用 Win32 `SetLayeredWindowAttributes` 把 ZCode 主窗口
HWND 设半透明，能透过窗口看桌面。**不走 CDP，不需要 debug port**。

### 为什么不能复用图片/视频的 CDP 路径

**CDP 改不了窗口透明度**（spec §2.1，查过 Electron + CDP 官方文档）：
- Electron 的 `transparent:true` 只在窗口创建时设，运行时不能切；
- CDP 的 `Browser.setWindowBounds` 只有位置/大小/最小化，没 opacity；
- `Emulation.setDefaultBackgroundColorOverride` 只让页面背景透明，底层还是
  ZCode 窗口的不透明底色——看到的会是深色底不是桌面。

所以透明走独立的 `lib/transparent.ps1`，不碰 inject.cjs，不碰 CDP。
**两个子系统的唯一共享是 `bin/launch-zcode.bat`**（启动 ZCode 的逻辑，
那是公共前提）。别把透明塞进 inject.cjs 当个 mode——那是错的复用对象
（核心教训 1 要避免的不是这种跨域的分离）。

### alpha 是整个窗口均匀半透明（跷跷板）

`WS_EX_LAYERED + LWA_ALPHA` 对**整个窗口**均匀生效——代码字、菜单、背景
**一起按同一比例变淡**。完全透明 = 看不见 ZCode，没法用。必然是中间值，
且字越清楚桌面越糊。这是核心教训 2 的同型坑：**别假设能"背景透明字清晰"**，
Win32 没这个 API。

### 三件套

- `lib/transparent.ps1` —— 探测窗口 + 设透明 + 热键循环（Ctrl+Alt+↑/↓/0）
- `bin/transparent.bat` —— 入口（对已开窗口）
- `bin/start-transparent.bat` —— 入口（一键启动，调 launch-zcode.bat）
- `bin/launch-zcode.bat` —— 从 start-zcode.bat 抽出的共享启动逻辑，
  透明模式用它"启动 ZCode 但不注入图片壁纸"。**根除重复**（核心教训 1），
  顺便修了 start-zcode"启动+注入焊死"的隐患。

### 窗口选择规则（PS 和 JS 必须一致）

`lib/transparent.ps1` 探测窗口的选择规则**必须**和 `lib/windowselect.cjs`
的 `selectMainWindow` 一致：pid 过滤 + visible + toplevel + 零面积过滤；
单候选自动选，多候选 read-host。规则抽到 JS 单测（`test/transparenttest.cjs`）
防 PS 侧漂移。Win32 调用本身不测（OS 行为）。

### 已知遗留

- **多窗口可能选错**：DevTools 最大化时面积可能超主窗口。多候选时 read-host
  让用户选（对齐 ambiguous 分支），但每次重跑要重选（不持久化，YAGNI）。
- **窗口重建丢透明**：ZCode 重启后 HWND 变了，重跑 transparent.bat。
- **和图片/视频叠加**：透明不碰 CDP，所以可叠加（半透明窗口+里面有壁纸）。
  这是允许的。`--remove`（场景5）只清 CDP 注入，要关透明靠热键/关 PS。
- **热键冲突**：Ctrl+Alt+↑/↓/0 和别的软件撞会 RegisterHotKey 失败，
  脚本 Write-Warning 提示。
- **进程名不确定**：默认 `-ProcessName ZCode`，找不到时提示用户
  `Get-Process` 看真实名再用参数覆盖。

### PowerShell 必须写 .ps1（环境注意）

`lib/transparent.ps1` 一律 `-File` 跑，绝不内联 `-Command`——bash 会吞掉
PS 里的 `$hwnd`/`$alpha`/`$_` 变量（AGENTS.md"环境注意"已记录）。
`.bat` 里的 `powershell -Command` 不受影响（走 cmd 不是 bash）。
```

- [ ] **Step 2: 人工验证（关键，这步过了才算功能真做成）**

需要一台装了 ZCode 的 Windows 机器。

1. 启动 ZCode（正常打开，或双击 `bin/start-transparent.bat`）。
2. 双击 `bin/transparent.bat`（如果 ZCode 已开）。
3. 确认：
   - 控制台打印 "唯一候选窗口: '...'" 或候选列表。
   - ZCode 窗口**真的变半透明了**（能看到后面的桌面/窗口）。
   - 按 `Ctrl+Alt+Down` 几次：窗口变**更透明**（更看清桌面）。
   - 按 `Ctrl+Alt+Up` 几次：窗口变**更不透明**（字更清楚）。
   - 按 `Ctrl+Alt+0`：窗口**恢复完全不透明**，控制台打印 "已恢复不透明并退出"。
   - 关控制台窗口 / Ctrl+C：窗口也恢复不透明（finally 块生效）。

**如果第 3 步任何一项不成立**，这是真 bug，按 systematic-debugging 查（不要假设）。
常见坑：进程名不对（`-ProcessName` 覆盖）、热键被别的软件占用、多窗口选错。

- [ ] **Step 3: 跑全量测试最终确认**

Run: `npm test`
Expected: 全 PASS（8 个测试文件）。

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md 加'窗口透明模式'章节

第三种背景模式：Win32 SetLayeredWindowAttributes 让 ZCode 主窗口
半透明看桌面。独立子系统不走 CDP（透明是窗口层，spec §2.1/§6）。
alpha 是整个窗口均匀半透明（核心教训 2 同型坑）。
记录三件套、窗口选择规则（PS=JS 一致）、已知遗留。"
```

---

## Self-Review（writing-plans skill 要求）

**1. Spec coverage:**
- §1 目标（窗口透明看桌面）→ Task 3（transparent.ps1）+ Task 6 人工验 ✓
- §2.1 CDP 改不了透明 → Task 3 走独立 PS，不碰 inject.cjs ✓
- §2.2 alpha 整窗均匀 → Task 3 `Set-Alpha` + Task 6 验 ✓
- §2.3 PS 写 .ps1 → Task 3/4 全用 `-File` ✓
- §3 文件结构 → 全部在 File Structure 表 ✓
- §4 launch-zcode 抽取 → Task 1 ✓
- §5 transparent.ps1 逻辑 → Task 3 ✓
- §6 为什么独立子系统 → Task 3 commit msg + Task 6 AGENTS.md ✓
- §7 入口脚本 → Task 4 ✓
- §8 测试（transparenttest + menutest）→ Task 2 + Task 5 ✓
- §9 已知遗留 → Task 6 AGENTS.md ✓
- §10 实现顺序 → Task 1-6 顺序匹配 ✓

**2. Placeholder scan:** 无 TBD/TODO/"add error handling"。每步有完整代码或确切命令。Task 6 Step 2 的人工验证步骤列了具体检查项，不是"测试一下"。

**3. Type consistency:**
- `selectMainWindow(pids, windows)` 签名：Task 2 定义，Task 3 PS 侧规则对齐（没调 JS 函数，是规则一致）✓
- 热键常量 `$HOTKEY_UP=1/DOWN=2/ZERO=3` 在 Task 3 注册和 switch 里一致 ✓
- `WM_HOTKEY` / `wParam` 分发一致 ✓
- launch-zcode.bat 的 rc（0/1/2/3）在 start-zcode.bat 和 start-transparent.bat 都用 `if "!rc!"=="0"` 判断 ✓

无问题，plan 可执行。
