# 总入口菜单 `wallpaper.bat` 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `wallpaper.bat` 总入口，显示中文场景菜单，用户选编号后执行对应流程（复用现有 5 个 .bat / lib 下的 cjs），跑完返回菜单。

**Architecture:** 两个新文件分工：`wallpaper.bat` 负责 cmd 控制流（菜单循环、分支、错误检查、调用子脚本），ASCII-only；`lib/menu.cjs` 负责打印中文菜单和场景说明（绕开 OEM codepage 中文乱码）。组合场景（选项 1、3）直接调底层 `node lib/xxx.cjs` 绕过子 .bat 的 `pause`；单脚本场景（2、4、5、6）`call` 现有 .bat 保留其 pause。

**Tech Stack:** Windows batch (cmd.exe)、Node.js (CommonJS .cjs)。不加新依赖。

对应 spec：`docs/superpowers/specs/2026-06-18-menu-launcher-design.md`

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `lib/menu.cjs` | 新建 | 导出 `renderMenu()` 返回菜单字符串（可测试），并在直接 `node` 运行时打印菜单 |
| `wallpaper.bat` | 新建 | cmd 菜单循环：清屏 → 打印菜单 → 读输入 → 分支执行 → 返回菜单 |
| `test/menutest.cjs` | 新建 | 测 `renderMenu()` 的输出内容（6 场景 + 退出项 + 中文说明 + 调用脚本标注） |
| `package.json` | 修改 | `scripts.test` 链尾追加 `&& node test/menutest.cjs` |

不改任何现有 `.bat` / `.cjs` / `.ps1`。

---

## Task 1: 新建 `lib/menu.cjs`（含可测试的 renderMenu 函数）

**Files:**
- Create: `lib/menu.cjs`
- Test: `test/menutest.cjs`（Task 3 才建，这里先写实现让 Task 2 的失败测试有目标）

- [ ] **Step 1: 写 `lib/menu.cjs`**

```js
// Menu renderer for wallpaper.bat launcher.
// WHY a separate .cjs: AGENTS.md requires .bat files to stay ASCII-only;
// Chinese text printed from .bat echo would garble under OEM codepage.
// So wallpaper.bat calls `node lib/menu.cjs` to print the Chinese menu.
//
// renderMenu() returns the menu string (unit-tested by test/menutest.cjs).
// Running this file directly (`node lib/menu.cjs`) just prints it.

const SCENARIOS = [
  {
    key: "1",
    title: "新机器初始化",
    desc: "第一次用必跑。装依赖 + 缩图 + 启动带壁纸的 ZCode",
    calls: "setup → resize → start-zcode",
  },
  {
    key: "2",
    title: "日常启动带壁纸",
    desc: "ZCode 没开时，一键启动并注入壁纸",
    calls: "start-zcode",
  },
  {
    key: "3",
    title: "换壁纸图后重注入",
    desc: "放了新图到 wallpapers/，缩图后重新注入",
    calls: "resize → inject-only",
  },
  {
    key: "4",
    title: "只重新注入 CSS",
    desc: "ZCode 已经开着，改完 wallpaper.css 想立刻看效果",
    calls: "inject-only",
  },
  {
    key: "5",
    title: "移除壁纸",
    desc: "撤掉已注入的壁纸，恢复 ZCode 原样",
    calls: "remove-wallpaper",
  },
  {
    key: "6",
    title: "重装依赖",
    desc: "sharp/ws 坏了想重装",
    calls: "setup",
  },
];

function pad(str, len) {
  // pad to width (ASCII/Chinese-mixed: count code units, good enough for our fixed titles)
  while (str.length < len) str += " ";
  return str;
}

function renderMenu() {
  const lines = [];
  lines.push("================  ZCode 壁纸工具箱  ================");
  lines.push("");
  for (const s of SCENARIOS) {
    // "  1  新机器初始化        描述..."
    lines.push("  " + s.key + "  " + pad(s.title, 14) + s.desc);
    lines.push("                         (" + s.calls + ")");
    lines.push("");
  }
  lines.push("  0  退出");
  lines.push("");
  lines.push("======================================================");
  lines.push("请输入选项编号:");
  return lines.join("\n");
}

module.exports = { renderMenu, SCENARIOS };

if (require.main === module) {
  process.stdout.write(renderMenu() + "\n");
}
```

- [ ] **Step 2: 手动验证能跑、中文不乱码**

Run: `node lib/menu.cjs`
Expected: 打印完整菜单，6 个场景项 + 退出项 + "请输入选项编号:"，中文正常显示。

- [ ] **Step 3: 提交**

```bash
git add lib/menu.cjs
git commit -m "feat: add lib/menu.cjs menu renderer for wallpaper.bat launcher"
```

---

## Task 2: 写 `test/menutest.cjs` 失败测试

**Files:**
- Create: `test/menutest.cjs`

- [ ] **Step 1: 写测试文件**

照 `test/selftest.cjs` / `test/probetest.cjs` 风格：纯 `check(name, cond)` 计数，`process.exit(fail>0?1:0)`。

```js
// Test for lib/menu.cjs renderMenu().
// Verifies the launcher menu has all 6 scenarios + exit, each with a
// Chinese description and a "calls" annotation. Guard against accidental
// menu drift (someone deleting a scenario, breaking the call chain docs, etc.)
//
// Run: node test/menutest.cjs

const { renderMenu, SCENARIOS } = require("../lib/menu.cjs");

let pass = 0,
  fail = 0;
function check(name, cond) {
  console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name);
  cond ? pass++ : fail++;
}

const out = renderMenu();

// --- Structure ---
check("menu is a non-empty string", typeof out === "string" && out.length > 0);
check("menu has banner", out.indexOf("ZCode 壁纸工具箱") !== -1);
check("menu has prompt line", out.indexOf("请输入选项编号:") !== -1);
check("menu has exit option 0", out.indexOf("  0  退出") !== -1);

// --- Exactly 6 scenarios in order ---
check("SCENARIOS has 6 entries", SCENARIOS.length === 6);
check("scenario keys are 1..6", SCENARIOS.map((s) => s.key).join("") === "123456");

// --- Each scenario present in output with title, desc, calls ---
const requiredCalls = [
  "setup → resize → start-zcode",
  "start-zcode",
  "resize → inject-only",
  "inject-only",
  "remove-wallpaper",
  "setup",
];
SCENARIOS.forEach((s, i) => {
  check("scenario " + s.key + " title in output", out.indexOf(s.title) !== -1);
  check("scenario " + s.key + " desc in output", out.indexOf(s.desc) !== -1);
  check(
    "scenario " + s.key + " calls annotation correct",
    s.calls === requiredCalls[i] && out.indexOf(s.calls) !== -1
  );
});

// --- Call-chain coverage: every underlying script appears at least once ---
["setup", "resize", "start-zcode", "inject-only", "remove-wallpaper"].forEach((name) => {
  check("calls mention " + name, out.indexOf(name) !== -1);
});

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: 跑测试，确认通过（Task 1 已实现，这里应该全绿）**

Run: `node test/menutest.cjs`
Expected: 所有项 PASS，结尾 `N passed, 0 failed.`，退出码 0。

如果 Task 1 还没实现或实现有误，这里会 FAIL —— 修 `lib/menu.cjs` 而不是改测试。

- [ ] **Step 3: 暂不提交（和 package.json 改动一起在 Task 4 提交，保证 `npm test` 在那次提交后是绿的）**

---

## Task 3: 写 `wallpaper.bat`（cmd 菜单循环 + 分支调用）

**Files:**
- Create: `wallpaper.bat`

- [ ] **Step 1: 写 `wallpaper.bat`**

关键设计点（写在文件头注释里，方便后人维护）：
- ASCII-only：所有 `echo` 用英文，中文菜单靠 `node lib/menu.cjs` 打印。
- 组合场景（1、3）直接调 `node lib/xxx.cjs` 绕 pause；单脚本场景（2、4、5、6）`call` 现有 .bat 保留 pause。
- 场景 1 第三步 `call start-zcode.bat`，不复制其探测/注入逻辑（AGENTS.md 教训）。
- 每步检查 errorlevel，失败就停（不静默继续），呼应 AGENTS.md "命令链断在哪一环"。

```bat
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
REM  - Single-script scenarios (2, 4, 5, 6) `call` the sub-.bat so its
REM    own pause still lets the user read output before returning.
REM  - Scenario 1's last step `call`s start-zcode.bat (does NOT copy
REM    its probe+inject logic — see AGENTS.md "don't duplicate").
REM  - Each step checks errorlevel; on failure we stop and return to
REM    menu so the user can see exactly which link broke.
REM  ASCII-only in this .bat (node prints Chinese itself).
REM ============================================================

set "WP_DIR=%~dp0"
set "WP_DIR=%WP_DIR:~0,-1%"

:menu
cls
node "%WP_DIR%\lib\menu.cjs"
echo.
set "choice="
set /p "choice=Enter choice (0-6): "
if not defined choice goto menu

if "%choice%"=="1" goto scene_init
if "%choice%"=="2" goto scene_start
if "%choice%"=="3" goto scene_resize_inject
if "%choice%"=="4" goto scene_inject_only
if "%choice%"=="5" goto scene_remove
if "%choice%"=="6" goto scene_setup
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
call "%WP_DIR%\start-zcode.bat"
goto menu

REM ---------- Scenario 2: start-zcode ----------
:scene_start
call "%WP_DIR%\start-zcode.bat"
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
call "%WP_DIR%\inject-only.bat"
goto menu

REM ---------- Scenario 4: inject-only ----------
:scene_inject_only
call "%WP_DIR%\inject-only.bat"
goto menu

REM ---------- Scenario 5: remove-wallpaper ----------
:scene_remove
call "%WP_DIR%\remove-wallpaper.bat"
goto menu

REM ---------- Scenario 6: setup ----------
:scene_setup
call "%WP_DIR%\setup.bat"
goto menu
```

- [ ] **Step 2: 手动验证基础流程（不能自动测，照 spec 验证清单）**

逐一测（在真实 Windows cmd 双击或 `cmd /c` 调）：
- 双击 `wallpaper.bat` → 菜单正确显示中文，无乱码
- 输入 `0` → 退出
- 输入 `7`（非法）→ 回到菜单不崩
- 直接回车（空输入）→ 回到菜单不崩

这些靠人眼/手动，`.bat` 控制流不在 `npm test` 覆盖范围（参照 probetest 只测 .ps1 不测 .bat 的边界惯例）。

- [ ] **Step 3: 提交**

```bash
git add wallpaper.bat
git commit -m "feat: add wallpaper.bat master launcher with scenario menu"
```

---

## Task 4: 把 menutest 接入 `npm test`

**Files:**
- Modify: `package.json` (`scripts.test`)

- [ ] **Step 1: 改 package.json 的 test 脚本**

在现有 test 链尾追加 `&& node test/menutest.cjs`：

```json
"test": "node test/selftest.cjs && node test/cdp-mock-test.cjs && node test/cdp-retry-test.cjs && node test/setuptest.cjs && node test/resizetest.cjs && node test/probetest.cjs && node test/menutest.cjs"
```

- [ ] **Step 2: 跑完整 `npm test`，确认全部绿**

Run: `npm test`
Expected: 所有测试文件依次跑过，最后 menutest 输出 `N passed, 0 failed.`，整体退出码 0。

AGENTS.md 说现在 30 项，加 menutest 后应为 30 + (menutest 的 check 数) 项。menutest 的 check 数以实际输出为准（结构 4 + 6 场景×3 + 5 调用覆盖 = 27 项左右，具体数实测）。

- [ ] **Step 3: 提交**

```bash
git add package.json test/menutest.cjs
git commit -m "test: wire menutest into npm test"
```

---

## Task 5: 更新 AGENTS.md 记录新组件（可选但推荐）

**Files:**
- Modify: `AGENTS.md`

按 AGENTS.md 既有风格，在启动链路小节补一句 `wallpaper.bat` 是总入口，并在"测试"小节把 menutest 加进 `npm test` 列表。

- [ ] **Step 1: 读 AGENTS.md 相关段落，定位插入点**

Run: 读 `AGENTS.md` 的 "## 项目是什么" 启动链路代码块 + "## 测试" 小节。

- [ ] **Step 2: 在启动链路代码块顶部加一行 wallpaper.bat**

在现有 `setup.bat  → setup.cjs` 那块代码块前面加：

```
wallpaper.bat                 总入口菜单：场景化选择，调下面这些脚本
```

- [ ] **Step 3: 在"测试"小节把 menutest 加进 npm test 列表**

把 "`npm test` 跑：selftest → cdp-mock-test → cdp-retry-test → setuptest → resizetest → probetest" 改为追加 "→ menutest"，并补一句 menutest 测的是 `lib/menu.cjs` 的菜单输出。

- [ ] **Step 4: 提交**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md 记录 wallpaper.bat 总入口与 menutest"
```

---

## 完成后验证清单（spec 里的手动验证项）

实现完成后，照 spec `## 验证清单（实现后手动跑）` 逐条过：
1. 双击 `wallpaper.bat`，菜单正确显示中文，无乱码
2. 选 0 能退出
3. 选 6（重装依赖）能跑完 setup 并返回菜单
4. 选 2（日常启动）能跑完 start-zcode 并返回菜单
5. 组合场景中某步故意失败，能看到"第 N 步失败"提示并返回菜单，不继续往下跑

---

## Self-Review

**1. Spec 覆盖：**
- 新建 2 文件（wallpaper.bat + lib/menu.cjs）→ Task 1 + Task 3 ✓
- 菜单 6 场景 + 退出 + 中文说明 + 调用脚本标注 → Task 1 的 SCENARIOS + renderMenu ✓
- 组合场景绕 pause、单脚本场景留 pause → Task 3 的分支实现 ✓
- 场景 1 第三步 call start-zcode.bat → Task 3 :scene_init ✓
- 错误处理每步检查 errorlevel 失败即停 → Task 3 每个 scene ✓
- ASCII-only 约束 → Task 1 注释 + Task 3 注释 ✓
- 测试策略（测 renderMenu 输出）→ Task 2 ✓
- 不改现有 .bat/.cjs → 全计划遵守 ✓
- YAGNI 项（不加 --no-pause、不复制启动逻辑、不缓存选择）→ 全计划遵守 ✓

**2. 占位符扫描：** 无 TBD/TODO；每个代码步骤都给了完整代码。

**3. 类型/名字一致性：** `renderMenu` / `SCENARIOS` 在 Task 1 定义、Task 2 import、Task 3 不直接引用（只 `node lib/menu.cjs` 跑），名字一致。`wallpaper.bat` 里的 label（`:scene_init` 等）和 goto 目标一一对应。
