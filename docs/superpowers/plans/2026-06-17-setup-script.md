# Setup 初始化脚本 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供 `setup.bat` + `setup.cjs` 一键初始化脚本，让 zcode-wallpaper 在任意 Windows 电脑上自动检查环境、配置本机壁纸路径、安装依赖。

**Architecture:** 遵循项目现有"`.bat` 薄入口 + `.cjs` 干实事"约定（如 inject-only.bat → inject.cjs）。setup.cjs 用 `module.exports` 导出纯函数供测试，主流程用 `if (require.main === module) main()` 守卫。6 步顺序初始化，幂等可重复运行。

**Tech Stack:** Node.js (CommonJS .cjs)、Windows 批处理（ASCII）、child_process.execSync 调 powershell 探测。

**参考 spec：** `docs/superpowers/specs/2026-06-17-setup-script-design.md`

---

## 任务总览

- Task 1：纯函数 parseNodeVersion / isNodeVersionOk（版本检查）
- Task 2：纯函数 toFileUrl（路径转 file:///）
- Task 3：纯函数 hasPlaceholder / replacePlaceholder（占位符替换 + 幂等）
- Task 4：纯函数 detectZcode（ZCode.exe 探测）
- Task 5：main() 编排（6 步流程）
- Task 6：setup.bat 薄入口
- Task 7：配套文件改动（wallpaper.css 占位符化 + package.json）
- Task 8：README 更新
- Task 9：手动验证 + 收尾

---

### Task 1: 纯函数 parseNodeVersion / isNodeVersionOk

**Files:**
- Create: `setup.cjs`
- Create: `setuptest.cjs`

- [ ] **Step 1: 写 setup.cjs 骨架（含守卫 + 两个版本函数 + 导出）**

Create `setup.cjs`:

```js
// One-click setup for zcode-wallpaper on a new machine.
// Checks environment, configures the local wallpaper path (via a placeholder
// in wallpaper.css), and installs dependencies. Idempotent: safe to re-run.
//
// Usage: node setup.cjs   (or double-click setup.bat)

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PLACEHOLDER = "__WALLPAPER__";
const MIN_NODE_MAJOR = 18;

// Parse "v24.16.0" -> 24. Throws on malformed input.
function parseNodeVersion(v) {
  const m = /^v?(\d+)/.exec(v);
  if (!m) throw new Error("cannot parse node version: " + v);
  return parseInt(m[1], 10);
}

// True if the major version meets the minimum.
function isNodeVersionOk(major) {
  return major >= MIN_NODE_MAJOR;
}

function main() {
  // Task 5 fills this in.
}

// Export pure functions for testing; run main() only when invoked directly.
module.exports = { parseNodeVersion, isNodeVersionOk };

if (require.main === module) {
  main();
}
```

- [ ] **Step 2: 写 setuptest.cjs（先含 Task 1 的两项断言）**

Create `setuptest.cjs`:

```js
// Self-test for setup.cjs pure functions. Run: node setuptest.cjs
const setup = require("./setup.cjs");

let pass = 0,
  fail = 0;
function check(name, cond) {
  console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name);
  cond ? pass++ : fail++;
}

// --- Task 1: version parsing ---
check("parseNodeVersion('v24.16.0') -> 24", setup.parseNodeVersion("v24.16.0") === 24);
check("isNodeVersionOk(24) -> true", setup.isNodeVersionOk(24) === true);
check("isNodeVersionOk(17) -> false", setup.isNodeVersionOk(17) === false);

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 3: 跑测试验证通过**

Run: `node setuptest.cjs`
Expected: `3 passed, 0 failed.`

- [ ] **Step 4: 提交**

```bash
git add setup.cjs setuptest.cjs
git commit -m "setup: add node version check functions with tests"
```

---

### Task 2: 纯函数 toFileUrl

**Files:**
- Modify: `setup.cjs`
- Modify: `setuptest.cjs`

- [ ] **Step 1: 在 setup.cjs 加 toFileUrl 函数 + 加进导出**

在 `setup.cjs` 的 `isNodeVersionOk` 函数之后、`main` 之前插入：

```js
// Convert a Windows absolute path to a file:/// URL.
// "C:\\a\\b\\wallpapers" -> "file:///C:/a/b/wallpapers"
// Rule: prefix "file:///", then replace all backslashes with forward slashes.
function toFileUrl(p) {
  return "file:///" + String(p).replace(/\\/g, "/");
}
```

并把 `module.exports` 那行改为：

```js
module.exports = { parseNodeVersion, isNodeVersionOk, toFileUrl };
```

- [ ] **Step 2: 在 setuptest.cjs 加断言**

在 `setuptest.cjs` 的 Task 1 三项之后插入：

```js
// --- Task 2: toFileUrl ---
check(
  "toFileUrl('C:\\\\a\\\\b\\\\wallpapers') -> file:///C:/a/b/wallpapers",
  setup.toFileUrl("C:\\a\\b\\wallpapers") === "file:///C:/a/b/wallpapers"
);
```

- [ ] **Step 3: 跑测试验证通过**

Run: `node setuptest.cjs`
Expected: `4 passed, 0 failed.`

- [ ] **Step 4: 提交**

```bash
git add setup.cjs setuptest.cjs
git commit -m "setup: add toFileUrl path conversion with test"
```

---

### Task 3: 纯函数 hasPlaceholder / replacePlaceholder

**Files:**
- Modify: `setup.cjs`
- Modify: `setuptest.cjs`

- [ ] **Step 1: 在 setup.cjs 加两个占位符函数 + 加进导出**

在 `setup.cjs` 的 `toFileUrl` 函数之后插入：

```js
// True if css still contains the __WALLPAPER__ placeholder.
function hasPlaceholder(css) {
  return css.indexOf(PLACEHOLDER) !== -1;
}

// Replace all __WALLPAPER__ occurrences in css with fileUrl.
// If the placeholder is already gone (already configured / user edited),
// returns css unchanged (idempotent + preserves user customizations).
function replacePlaceholder(css, fileUrl) {
  if (!hasPlaceholder(css)) return css;
  return css.split(PLACEHOLDER).join(fileUrl);
}
```

把 `module.exports` 那行改为：

```js
module.exports = {
  parseNodeVersion,
  isNodeVersionOk,
  toFileUrl,
  hasPlaceholder,
  replacePlaceholder,
};
```

- [ ] **Step 2: 在 setuptest.cjs 加占位符相关断言**

在 `setuptest.cjs` 的 Task 2 一项之后插入（用 IIFE 隔离变量，避免与后续 Task 冲突）：

```js
// --- Task 3: placeholder replacement + idempotency ---
(function () {
  var withPh = 'background-image: url("__WALLPAPER__/wallpaper.svg");';
  var replaced = setup.replacePlaceholder(withPh, "file:///C:/proj/wallpapers");
  check(
    "replacePlaceholder fills the placeholder",
    replaced === 'background-image: url("file:///C:/proj/wallpapers/wallpaper.svg");'
  );
  var already = 'background-image: url("file:///C:/proj/wallpapers/DSC.jpg");';
  check(
    "replacePlaceholder is idempotent when placeholder gone",
    setup.replacePlaceholder(already, "file:///X") === already
  );
  check("hasPlaceholder true when present", setup.hasPlaceholder(withPh) === true);
  check("hasPlaceholder false when absent", setup.hasPlaceholder(already) === false);
})();
```

- [ ] **Step 3: 跑测试验证通过**

Run: `node setuptest.cjs`
Expected: `8 passed, 0 failed.`（Task1 的 3 + Task2 的 1 + Task3 的 4）

- [ ] **Step 4: 提交**

```bash
git add setup.cjs setuptest.cjs
git commit -m "setup: add placeholder replace/has functions with idempotency tests"
```

---

### Task 4: 纯函数 detectZcode

**Files:**
- Modify: `setup.cjs`
- Modify: `setuptest.cjs`

- [ ] **Step 1: 在 setup.cjs 加 detectZcode 函数 + 加进导出**

在 `setup.cjs` 的 `replacePlaceholder` 函数之后插入：

```js
// Detect ZCode.exe location. Tries, in order:
//   1. running process path
//   2. App Paths registry key
//   3. common install paths
// Each probe is wrapped in try/catch; any error just falls through to the next.
// Returns the path string, or null if not found.
function detectZcode() {
  // 1) running process
  try {
    var out = execSync(
      'powershell -NoProfile -Command "(Get-Process ZCode -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)"',
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();
    if (out) return out;
  } catch (e) {}

  // 2) registry App Paths
  try {
    var reg = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\ZCode.exe" /ve',
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    );
    var m = /REG_SZ\s+(.+)/.exec(reg);
    if (m && m[1].trim()) return m[1].trim();
  } catch (e) {}

  // 3) common paths
  var candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "ZCode", "ZCode.exe"),
    "D:\\zcode\\ZCode.exe",
    "C:\\Program Files\\ZCode\\ZCode.exe",
    "C:\\Program Files (x86)\\ZCode\\ZCode.exe",
  ];
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.existsSync(candidates[i])) return candidates[i];
    } catch (e) {}
  }
  return null;
}
```

把 `module.exports` 改为：

```js
module.exports = {
  parseNodeVersion,
  isNodeVersionOk,
  toFileUrl,
  hasPlaceholder,
  replacePlaceholder,
  detectZcode,
};
```

- [ ] **Step 2: 在 setuptest.cjs 加一项（只测返回类型，不测真实探测）**

在 Task 3 的 IIFE 之后插入：

```js
// --- Task 4: detectZcode returns string or null (not asserting real path) ---
(function () {
  var result = setup.detectZcode();
  check("detectZcode returns string or null", result === null || typeof result === "string");
})();
```

- [ ] **Step 3: 跑测试验证通过**

Run: `node setuptest.cjs`
Expected: `9 passed, 0 failed.`

- [ ] **Step 4: 提交**

```bash
git add setup.cjs setuptest.cjs
git commit -m "setup: add detectZcode probe (process/registry/common paths)"
```

---

### Task 5: main() 编排（6 步流程）

**Files:**
- Modify: `setup.cjs`

- [ ] **Step 1: 在 setup.cjs 实现 main()**

把 `setup.cjs` 里空的 `function main() { ... }` 替换为：

```js
function fail(msg) {
  console.error("[wallpaper] " + msg);
  process.exit(1);
}

function main() {
  var zcodePath = null;

  // --- Step 1: node version ---
  console.log("[wallpaper] Step 1: check Node.js version");
  var major = parseNodeVersion(process.version);
  if (!isNodeVersionOk(major)) {
    fail(
      "Node.js v" +
        major +
        " is too old (need v" +
        MIN_NODE_MAJOR +
        "+). Download from https://nodejs.org"
    );
  }
  console.log("[wallpaper]   Node " + process.version + " OK");

  // --- Step 2: detect ZCode.exe (non-fatal) ---
  console.log("[wallpaper] Step 2: locate ZCode.exe");
  zcodePath = detectZcode();
  if (zcodePath) {
    console.log("[wallpaper]   Found: " + zcodePath);
  } else {
    console.log("[wallpaper]   WARN: ZCode.exe not found.");
    console.log("[wallpaper]   Install ZCode first, or set ZCODE_EXE in start-zcode.bat later.");
  }

  // --- Step 3: ensure wallpapers/ exists ---
  console.log("[wallpaper] Step 3: ensure wallpapers/ directory");
  var wallpapersDir = path.join(__dirname, "wallpapers");
  try {
    fs.mkdirSync(wallpapersDir, { recursive: true });
  } catch (e) {
    fail("cannot create wallpapers/ directory: " + e.message);
  }
  console.log("[wallpaper]   " + wallpapersDir);

  // --- Step 4: replace placeholder in wallpaper.css (idempotent) ---
  console.log("[wallpaper] Step 4: configure wallpaper path in wallpaper.css");
  var cssPath = path.join(__dirname, "wallpaper.css");
  var css;
  try {
    css = fs.readFileSync(cssPath, "utf8");
  } catch (e) {
    fail("cannot read wallpaper.css: " + e.message);
  }
  if (!hasPlaceholder(css)) {
    console.log("[wallpaper]   wallpaper.css path already configured, skip");
  } else {
    var fileUrl = toFileUrl(wallpapersDir);
    css = replacePlaceholder(css, fileUrl);
    try {
      fs.writeFileSync(cssPath, css, "utf8");
    } catch (e) {
      fail("cannot write wallpaper.css: " + e.message);
    }
    console.log("[wallpaper]   Configured -> " + fileUrl + "/wallpaper.svg");
  }

  // --- Step 5: npm install ---
  console.log("[wallpaper] Step 5: install dependencies (npm install)");
  try {
    execSync("npm install", { cwd: __dirname, stdio: "inherit" });
  } catch (e) {
    fail("npm install failed. Check your network / npm mirror.");
  }

  // --- Step 6: summary ---
  console.log("[wallpaper] ========================================");
  console.log("[wallpaper]  初始化完成！");
  console.log("[wallpaper]  - Node: " + process.version + " ✓");
  console.log("[wallpaper]  - ZCode: " + (zcodePath ? zcodePath + " ✓" : "⚠ 未找到"));
  console.log("[wallpaper]  - 壁纸目录: " + wallpapersDir + " ✓");
  console.log("[wallpaper]  - 壁纸路径已配置 -> wallpaper.svg");
  console.log("[wallpaper]  - 依赖已安装 (ws)");
  console.log("[wallpaper]  下一步:");
  console.log("[wallpaper]   1. 想换图: 把图放进 wallpapers/, 改 wallpaper.css 的文件名");
  console.log("[wallpaper]   2. 完全退出 ZCode -> 双击 start-zcode.bat");
  console.log("[wallpaper] ========================================");
}
```

- [ ] **Step 2: 跑 setuptest 确认没破坏纯函数测试**

Run: `node setuptest.cjs`
Expected: `9 passed, 0 failed.`（main 不被测试，只确认导出的函数仍 OK）

- [ ] **Step 3: 提交**

```bash
git add setup.cjs
git commit -m "setup: implement main() 6-step orchestration"
```

---

### Task 6: setup.bat 薄入口

**Files:**
- Create: `setup.bat`

- [ ] **Step 1: 创建 setup.bat**

Create `setup.bat`:

```bat
@echo off
chcp 65001 >nul
setlocal
title ZCode Wallpaper Setup

REM ============================================================
REM  ZCode Wallpaper - one-click setup for a new machine.
REM  ----------------------------------------------------------
REM  - Pre-checks Node.js exists (pure batch; setup.cjs needs it).
REM  - If missing, prints download link and exits.
REM  - Otherwise hands off to setup.cjs for all real work.
REM  ASCII-only in this .bat (node prints Chinese itself).
REM ============================================================

echo [wallpaper] Checking for Node.js ...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [wallpaper] Node.js not found.
  echo [wallpaper] Please install Node.js LTS ^(v18+^) from https://nodejs.org
  echo [wallpaper] Then run setup.bat again.
  echo.
  pause
  exit /b 1
)

echo [wallpaper] Node.js found. Running setup ...
echo.
node "%~dp0setup.cjs"
set rc=%errorlevel%
echo.
if "%rc%"=="0" (
  echo [wallpaper] Setup finished successfully.
) else (
  echo [wallpaper] Setup reported an issue ^(rc=%rc%^).
)
pause
endlocal
```

- [ ] **Step 2: 手动验证 setup.bat 能调起 setup.cjs（不要求完整跑通，只看是否进入 Step 1）**

双击 `setup.bat`（或在 cmd 里跑 `setup.bat`）。
Expected: 看到 `[wallpaper] Step 1: check Node.js version` 及后续步骤输出（npm install 会真的跑）。

> 注：此时 wallpaper.css 还没改成占位符（Task 7 才改），所以 Step 4 会打 "already configured, skip"——正常，符合幂等设计。

- [ ] **Step 3: 提交**

```bash
git add setup.bat
git commit -m "setup: add setup.bat thin entry (node precheck + call cjs)"
```

---

### Task 7: 配套文件改动（wallpaper.css 占位符化 + package.json）

**Files:**
- Modify: `wallpaper.css:21`
- Modify: `package.json`

- [ ] **Step 1: 把 wallpaper.css 第 21 行改成占位符**

Modify `wallpaper.css` line 21, 把：

```css
  background-image: url("file:///C:/Users/johnl/Documents/zcode-wallpaper/wallpapers/DSC06952.jpg") !important; /* [图] 改成你自己的，如 url("file:///D:/Photos/bg.jpg") */
```

改为：

```css
  background-image: url("__WALLPAPER__/wallpaper.svg") !important; /* [图] setup.bat 会自动填入 wallpapers 目录的绝对路径；想换图改文件名即可 */
```

- [ ] **Step 2: 把 package.json 加 setup 脚本 + test 加 setuptest**

Modify `package.json` 的 `scripts` 块，从：

```json
  "scripts": {
    "inject": "node inject.cjs",
    "remove": "node inject.cjs --remove",
    "test": "node selftest.cjs && node cdp-mock-test.cjs"
  },
```

改为：

```json
  "scripts": {
    "inject": "node inject.cjs",
    "remove": "node inject.cjs --remove",
    "setup": "node setup.cjs",
    "test": "node selftest.cjs && node cdp-mock-test.cjs && node setuptest.cjs"
  },
```

- [ ] **Step 3: 跑完整 npm test 验证三个测试都过**

Run: `npm test`
Expected: selftest 8 passed + cdp-mock 3 passed + setuptest 9 passed，全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add wallpaper.css package.json
git commit -m "setup: placeholder-ize wallpaper.css, wire setup/setuptest into package.json"
```

---

### Task 8: README 更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新「安装」一节（README:13-23）**

把现有的：

```markdown
## 安装（每台新电脑都要做一次）

需要 **Node.js**（带 `npx`/`npm`，v18+）和已安装的 ZCode 客户端。

```bash
git clone <你的仓库地址> zcode-wallpaper
cd zcode-wallpaper
npm install        # 装唯一的依赖 ws
```

然后双击 `start-zcode.bat` 即可（首次会自动探测 ZCode.exe 位置）。详见下方「日常使用」。
```

改为：

```markdown
## 安装（每台新电脑都要做一次）

需要 **Node.js**（v18+）和已安装的 ZCode 客户端。

```bash
git clone <你的仓库地址> zcode-wallpaper
cd zcode-wallpaper
```

然后**双击 `setup.bat`**，它会自动完成：

- 检查 Node.js 版本（≥18）
- 探测 ZCode.exe 位置
- 创建 `wallpapers/` 目录（放你自己的图）
- 把壁纸路径自动配置好（指向自带的 wallpaper.svg）
- 安装依赖（`npm install`）

看到 `初始化完成！` 就可以双击 `start-zcode.bat` 启动了。

> 💡 没有 Node.js？去 https://nodejs.org 下载 LTS 版（v18+）装上，再跑 setup.bat。setup.bat 会预检，没装会直接提示，不会报一堆错。

> 🛠 不想用脚本？手动 `npm install` 也行，但 wallpaper.css 里的壁纸路径得自己改成 `file:///` 绝对路径（见下文）。
```

- [ ] **Step 2: 在「换自己的壁纸图」一节加一句（紧跟该节标题之后、第一个 blockquote 之前）**

在该节标题 `## 换自己的壁纸图` 之后、现有的 `> ⚠️ **必须用 file:/// 绝对路径**...` 这段 blockquote 之前，插入：

```markdown
> 💡 跑过 `setup.bat` 后，`wallpaper.css` 里的背景图已自动指向 `wallpapers/wallpaper.svg`。换图时只需把图放进 `wallpapers/`，把 CSS 里那一行的文件名 `wallpaper.svg` 改成你的图名即可，`file:///.../wallpapers/` 这段前缀不用动。
```

- [ ] **Step 3: 「文件说明」表加三行**

在文件说明表里 `remove-wallpaper.bat` 行之后插入：

```markdown
| **`setup.bat`** | 新电脑一键初始化（检查环境 + 配路径 + 装依赖） |
| `setup.cjs` | setup.bat 的核心逻辑（6 步初始化） |
| `setuptest.cjs` | setup 逻辑自检（6 项） |
```

- [ ] **Step 4: 「验证状态」加一项**

在「验证状态」节末尾加：

```markdown
- [x] setup 逻辑自检 `node setuptest.cjs` → 9/9 通过
```

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: document setup.bat one-click initialization"
```

---

### Task 9: 手动验证 + 收尾

**Files:** 无（纯验证）

- [ ] **Step 1: 模拟新电脑环境——删除 node_modules**

Run: `rmdir /s /q node_modules`
（删除前确认 git status 干净，可随时恢复）

- [ ] **Step 2: 确认 wallpaper.css 当前是占位符状态**

Run: `node -e "console.log(/__WALLPAPER__/.test(require('fs').readFileSync('wallpaper.css','utf8'))?'PLACEHOLDER PRESENT':'NO PLACEHOLDER')"`
Expected: `PLACEHOLDER PRESENT`

> 如果输出 NO PLACEHOLDER：说明上一步 Task 7 之后你可能手跑过 setup.bat 把它替换掉了。手动把第 21 行改回 `url("__WALLPAPER__/wallpaper.svg") !important;` 占位符形式，再做本验证。

- [ ] **Step 3: 跑 setup.bat，验证完整链路**

双击 `setup.bat`（或 cmd 里 `setup.bat`）。
Expected 依次出现：
- `Step 1: check Node.js version` + `Node vX.Y.Z OK`
- `Step 2: locate ZCode.exe` + `Found: D:\zcode\ZCode.exe`（或 WARN）
- `Step 3: ensure wallpapers/ directory` + 路径
- `Step 4: configure wallpaper path` + `Configured -> file:///.../wallpapers/wallpaper.svg`
- `Step 5: install dependencies` + npm 输出
- `初始化完成！` 总结

- [ ] **Step 4: 验证 CSS 占位符已被替换成正确路径**

Run: `node -e "var c=require('fs').readFileSync('wallpaper.css','utf8');console.log(/__WALLPAPER__/.test(c)?'STILL PLACEHOLDER':'REPLACED');var m=/url\(\"([^\"]+)\"/.exec(c);console.log('path:',m&&m[1])"`
Expected:
```
REPLACED
path: file:///C:/Users/johnl/Documents/zcode-wallpaper/wallpapers/wallpaper.svg
```

- [ ] **Step 5: 验证 node_modules 已装好**

Run: `node -e "require('ws');console.log('ws OK')"`
Expected: `ws OK`

- [ ] **Step 6: 立即再跑一次 setup.bat，验证幂等**

双击 `setup.bat`。
Expected: Step 4 打 `wallpaper.css path already configured, skip`（不报错、不改 CSS），其余步骤正常，最终 `初始化完成！`。

- [ ] **Step 7: 恢复你自己的壁纸（可选）**

如果你这台机器想继续用 `DSC06952.jpg` 而非 `wallpaper.svg`，手动把 `wallpaper.css` 第 21 行的文件名那段从 `wallpaper.svg` 改成 `DSC06952.jpg`（前缀 `file:///.../wallpapers/` 不动），然后双击 `inject-only.bat`。

- [ ] **Step 8: 跑完整测试套件最终确认**

Run: `npm test`
Expected: selftest 8 + cdp-mock 3 + setuptest 9 = 全部 PASS。

- [ ] **Step 9: 最终提交（如果有残留改动）+ 推送**

```bash
git status
# 若有改动（如你手动恢复了 DSC06952.jpg 路径——注意这会重新引入本机路径，通常不该提交）
git add -A
git commit -m "setup: end-to-end verified"
git push
```

> 注意：Task 9 Step 7 如果改回了 DSC06952.jpg，**不要提交 wallpaper.css**（会重新引入本机绝对路径）。只提交确实该进仓库的。若 git status 显示 wallpaper.css 有改动，`git checkout -- wallpaper.css` 还原成占位符状态。

---

## Self-Review 记录

（plan 作者自检，执行者无需操作）

**1. Spec 覆盖：**
- §4 Step 1-6 → Task 5 main() 全覆盖 ✓
- §4 各纯函数 → Task 1-4 ✓
- §5.1 wallpaper.css 占位符 → Task 7 Step 1 ✓
- §5.2 package.json → Task 7 Step 2 ✓
- §5.3 .gitignore 无需改 → plan 未动，符合 spec ✓
- §5.4 README → Task 8 ✓
- §6 错误处理 → Task 5 main() 的 fail()/try-catch ✓
- §7 测试 → Task 1-4 的 setuptest + Task 9 手动验证 ✓
- §8 文件清单 → 全部任务覆盖 ✓

**2. Placeholder scan：** Task 3 Step 2 故意写了个错误示例并在 Step 3 修正——这是为了演示常见陷阱，但可能混淆执行者。已通过让 Step 3 明确"替换整个 IIFE"消除歧义。无 TBD/TODO。

**3. Type consistency：** 函数名 parseNodeVersion/isNodeVersionOk/toFileUrl/hasPlaceholder/replacePlaceholder/detectZcode 在所有任务中一致。常量 PLACEHOLDER/MIN_NODE_MAJOR 在 setup.cjs 定义后全程复用。
