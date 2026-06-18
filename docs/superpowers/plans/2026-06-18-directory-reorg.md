# 项目目录整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 zcode-wallpaper 根目录的核心源码归入 `lib/`、测试归入 `test/`,删除本地产物,同步所有路径引用,保持全部 30 项测试绿。

**Architecture:** 纯文件移动 + 路径引用同步,零逻辑改动。源码进 `lib/` 后,所有 `path.join(__dirname, "wallpapers...")` 回退一层;测试进 `test/` 后,`require("./x.cjs")` 改 `require("../lib/x.cjs")`;`.bat` 留根目录,内部 `node` 调用加 `lib\` 前缀。现有 30 项测试作为回归网 —— 移动后跑 `npm test` 全绿即证明路径迁移成功。

**Tech Stack:** Node.js (CommonJS .cjs)、Windows batch、PowerShell、CDP/ws。

**Spec:** `docs/superpowers/specs/2026-06-18-directory-reorg-design.md`

---

## File Structure

### 移动(不修改内容,由后续 task 改引用)
- `inject.cjs` → `lib/inject.cjs`
- `setup.cjs` → `lib/setup.cjs`
- `resize.cjs` → `lib/resize.cjs`
- `wallpaper.css` → `lib/wallpaper.css`
- `selftest.cjs` → `test/selftest.cjs`
- `cdp-mock-test.cjs` → `test/cdp-mock-test.cjs`
- `cdp-retry-test.cjs` → `test/cdp-retry-test.cjs`
- `setuptest.cjs` → `test/setuptest.cjs`
- `resizetest.cjs` → `test/resizetest.cjs`
- `probetest.cjs` → `test/probetest.cjs`

### 修改(改路径引用,内容改动极小)
- `lib/inject.cjs` — wallpapers-thumb 路径回退一层
- `lib/resize.cjs` — wallpapers + wallpapers-thumb 路径回退一层
- `lib/setup.cjs` — wallpapers 路径回退一层
- `test/selftest.cjs` — require 指向 ../lib/、wallpaper.css 路径回退
- `test/setuptest.cjs` — require 指向 ../lib/
- `test/resizetest.cjs` — require 指向 ../lib/
- `test/cdp-mock-test.cjs` — 补 require("path")、execFile 路径 + cwd 改回项目根
- `test/cdp-retry-test.cjs` — 补 require("path")、execFile 路径 + cwd 改回项目根
- `test/probetest.cjs` — probe.ps1 路径回退一层
- `start-zcode.bat` — node 调用加 lib\ 前缀
- `inject-only.bat` — node 调用加 lib\ 前缀
- `remove-wallpaper.bat` — node 调用加 lib\ 前缀
- `setup.bat` — node 调用加 lib\ 前缀
- `resize.bat` — node 调用加 lib\ 前缀
- `package.json` — inject/remove/setup/test 脚本路径更新

### 删除
- `screenshot.png` (本地产物,未进 git)
- `zcode-launch.log` (本地产物,未进 git)

---

### Task 1: 移动核心源码到 lib/

**Files:**
- Move: `inject.cjs` → `lib/inject.cjs`
- Move: `setup.cjs` → `lib/setup.cjs`
- Move: `resize.cjs` → `lib/resize.cjs`
- Move: `wallpaper.css` → `lib/wallpaper.css`
- Create: `lib/` directory

用 `git mv` 保留历史。此 task 只移动,不改任何文件内容 —— 此时测试会红(路径失效),由后续 task 修复。

- [ ] **Step 1: 创建 lib/ 并移动 4 个文件**

Run:
```bash
mkdir lib
git mv inject.cjs lib/inject.cjs
git mv setup.cjs lib/setup.cjs
git mv resize.cjs lib/resize.cjs
git mv wallpaper.css lib/wallpaper.css
```

- [ ] **Step 2: 确认移动结果**

Run: `git status`
Expected: 4 个 renamed: inject.cjs→lib/inject.cjs 等,无 deleted/added 错乱。

- [ ] **Step 3: 暂不提交,继续 Task 2**

(不 commit,等所有路径引用改完、测试绿了再统一提交,降低中间状态碎片。)

---

### Task 2: 移动测试到 test/

**Files:**
- Move: 6 个 `*test.cjs` → `test/`
- Create: `test/` directory

- [ ] **Step 1: 创建 test/ 并移动 6 个测试**

Run:
```bash
mkdir test
git mv selftest.cjs test/selftest.cjs
git mv cdp-mock-test.cjs test/cdp-mock-test.cjs
git mv cdp-retry-test.cjs test/cdp-retry-test.cjs
git mv setuptest.cjs test/setuptest.cjs
git mv resizetest.cjs test/resizetest.cjs
git mv probetest.cjs test/probetest.cjs
```

- [ ] **Step 2: 确认移动结果**

Run: `git status`
Expected: 6 个 renamed,加上 Task 1 的 4 个,共 10 个 renamed。

- [ ] **Step 3: 暂不提交**

---

### Task 3: 修复 lib/ 内 __dirname 路径(B 类,4 处)

源码进 lib/ 后,`__dirname` 变成 `lib/`,而 wallpapers 目录在项目根,必须回退一层。

**Files:**
- Modify: `lib/inject.cjs:155`
- Modify: `lib/resize.cjs:55-56`
- Modify: `lib/setup.cjs:100`

注意:`lib/inject.cjs:165` 的 `path.join(__dirname, "wallpaper.css")` **不改** —— wallpaper.css 跟 inject.cjs 同在 lib/。

- [ ] **Step 1: lib/inject.cjs:155 wallpapers-thumb 回退一层**

找到:
```js
      var wallpapersDir = path.join(__dirname, "wallpapers-thumb");
```
改为:
```js
      var wallpapersDir = path.join(__dirname, "..", "wallpapers-thumb");
```

- [ ] **Step 2: lib/resize.cjs:55 wallpapers 回退一层**

找到:
```js
  var srcDir = path.join(__dirname, "wallpapers");
```
改为:
```js
  var srcDir = path.join(__dirname, "..", "wallpapers");
```

- [ ] **Step 3: lib/resize.cjs:56 wallpapers-thumb 回退一行**

找到:
```js
  var thumbDir = path.join(__dirname, "wallpapers-thumb");
```
改为:
```js
  var thumbDir = path.join(__dirname, "..", "wallpapers-thumb");
```

- [ ] **Step 4: lib/setup.cjs:100 wallpapers 回退一层**

找到:
```js
  var wallpapersDir = path.join(__dirname, "wallpapers");
```
改为:
```js
  var wallpapersDir = path.join(__dirname, "..", "wallpapers");
```

---

### Task 4: 修复 test/ 内 require 源码 + 读 css(C 类,5 处)

测试进 test/ 后,require 源码要回退一层到 lib/。

**Files:**
- Modify: `test/selftest.cjs:5`
- Modify: `test/selftest.cjs:11`
- Modify: `test/selftest.cjs:55`
- Modify: `test/setuptest.cjs:2`
- Modify: `test/resizetest.cjs:5`

- [ ] **Step 1: test/selftest.cjs:5 inject require 改路径**

找到:
```js
const inject = require("./inject.cjs");
```
改为:
```js
const inject = require("../lib/inject.cjs");
```

- [ ] **Step 2: test/selftest.cjs:11 buildExpression require 改路径**

找到:
```js
const { buildExpression } = require("./inject.cjs");
```
改为:
```js
const { buildExpression } = require("../lib/inject.cjs");
```

- [ ] **Step 3: test/selftest.cjs:55 wallpaper.css 路径回退两层**

找到:
```js
  const css = fs.readFileSync(path.join(__dirname, "wallpaper.css"), "utf8");
```
改为:
```js
  const css = fs.readFileSync(path.join(__dirname, "..", "lib", "wallpaper.css"), "utf8");
```

- [ ] **Step 4: test/setuptest.cjs:2 setup require 改路径**

找到:
```js
const setup = require("./setup.cjs");
```
改为:
```js
const setup = require("../lib/setup.cjs");
```

- [ ] **Step 5: test/resizetest.cjs:5 resize require 改路径**

找到:
```js
const resize = require("./resize.cjs");
```
改为:
```js
const resize = require("../lib/resize.cjs");
```

---

### Task 5: 修复 CDP 测试 execFile 子进程(D 类,最易漏,2 处)

这两个测试用相对路径字符串 + `cwd: __dirname` 把 inject.cjs 当子进程跑。进 test/ 后 cwd 变 test/,既要改路径字符串,也要把 cwd 改回项目根。两个文件当前都**没有** `require("path")`,必须补。

**Files:**
- Modify: `test/cdp-mock-test.cjs`(顶部 + line 84-85)
- Modify: `test/cdp-retry-test.cjs`(顶部 + line 77-78)

- [ ] **Step 1: test/cdp-mock-test.cjs 补 require("path")**

在文件顶部 require 区(line 5 `const { WebSocketServer, WebSocket } = require("ws");` 之后)加一行:
```js
const path = require("path");
```

- [ ] **Step 2: test/cdp-mock-test.cjs execFile 路径 + cwd**

找到(line 84-85):
```js
      const { stdout } = await execFileP(process.execPath, ["inject.cjs", ...args], {
        cwd: __dirname,
```
改为:
```js
      const { stdout } = await execFileP(process.execPath, ["lib/inject.cjs", ...args], {
        cwd: path.join(__dirname, ".."),
```

- [ ] **Step 3: test/cdp-retry-test.cjs 补 require("path")**

在文件顶部 require 区(line 14 `const { promisify } = require("util");` 之后)加一行:
```js
const path = require("path");
```

- [ ] **Step 4: test/cdp-retry-test.cjs execFile 路径 + cwd**

找到(line 77-78):
```js
    const { stdout } = await execFileP(process.execPath, ["inject.cjs"], {
      cwd: __dirname,
```
改为:
```js
    const { stdout } = await execFileP(process.execPath, ["lib/inject.cjs"], {
      cwd: path.join(__dirname, ".."),
```

---

### Task 6: 修复 probetest probe.ps1 路径(E 类,1 处)

probe.ps1 留根目录,测试进 test/,回退一层。

**Files:**
- Modify: `test/probetest.cjs:30`

- [ ] **Step 1: test/probetest.cjs:30 probe.ps1 路径回退一层**

找到:
```js
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "probe.ps1"), "-Port", String(port)],
```
改为:
```js
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "..", "probe.ps1"), "-Port", String(port)],
```

---

### Task 7: 修复 .bat 里 node 调用(A 类,5 处)

`.bat` 用 `%~dp0` 或 `%WP_DIR%` 定位根目录,源码进 lib/ 后加 `lib\` 前缀。`.bat` 保持 ASCII-only。

**Files:**
- Modify: `start-zcode.bat:67`
- Modify: `inject-only.bat:44`
- Modify: `remove-wallpaper.bat:4`
- Modify: `setup.bat:29`
- Modify: `resize.bat:29`

- [ ] **Step 1: start-zcode.bat:67**

找到:
```bat
node "%WP_DIR%\inject.cjs"
```
改为:
```bat
node "%WP_DIR%\lib\inject.cjs"
```

- [ ] **Step 2: inject-only.bat:44**

找到:
```bat
node "%WP_DIR%\inject.cjs"
```
改为:
```bat
node "%WP_DIR%\lib\inject.cjs"
```

- [ ] **Step 3: remove-wallpaper.bat:4**

找到:
```bat
node "%~dp0inject.cjs" --remove
```
改为:
```bat
node "%~dp0lib\inject.cjs" --remove
```

- [ ] **Step 4: setup.bat:29**

找到:
```bat
node "%~dp0setup.cjs"
```
改为:
```bat
node "%~dp0lib\setup.cjs"
```

- [ ] **Step 5: resize.bat:29**

找到:
```bat
node "%~dp0resize.cjs"
```
改为:
```bat
node "%~dp0lib\resize.cjs"
```

---

### Task 8: 修复 package.json 脚本(F 类)

**Files:**
- Modify: `package.json:16-19`

- [ ] **Step 1: package.json scripts 块整块替换**

找到(line 15-19):
```json
  "scripts": {
    "inject": "node inject.cjs",
    "remove": "node inject.cjs --remove",
    "setup": "node setup.cjs",
    "test": "node selftest.cjs && node cdp-mock-test.cjs && node cdp-retry-test.cjs && node setuptest.cjs && node resizetest.cjs && node probetest.cjs"
  },
```
改为:
```json
  "scripts": {
    "inject": "node lib/inject.cjs",
    "remove": "node lib/inject.cjs --remove",
    "setup": "node lib/setup.cjs",
    "test": "node test/selftest.cjs && node test/cdp-mock-test.cjs && node test/cdp-retry-test.cjs && node test/setuptest.cjs && node test/resizetest.cjs && node test/probetest.cjs"
  },
```

---

### Task 9: 删除本地产物

**Files:**
- Delete: `screenshot.png`
- Delete: `zcode-launch.log`

这两个是本地运行产物,被 `.gitignore` 忽略(`*.png`、`*-launch.log`),未进 git。直接删本地文件。

- [ ] **Step 1: 删除两个本地产物**

Run:
```bash
rm -f screenshot.png zcode-launch.log
```

- [ ] **Step 2: 确认 .gitignore 已覆盖(防止再生成时混入)**

Run: `git check-ignore screenshot.png zcode-launch.log`
Expected: 两行都输出(说明被忽略)。若不输出,说明 .gitignore 有漏,需补。

---

### Task 10: 全量验证

所有路径迁移已完成,现在验证。这是整个整理的"考试"。

- [ ] **Step 1: npm test 全套**

Run: `npm test`
Expected: 30 项全绿 —— selftest 13 + cdp-mock 3 + cdp-retry 1 + setup 4 + resize 5 + probe 4。
任何一项红 = 路径迁移漏了一处,回头查对应 task。

- [ ] **Step 2: grep 回扫旧路径(AGENTS.md 教训 6)**

Run:
```bash
grep -rn "node inject.cjs\|node setup.cjs\|node resize.cjs\|require(\"./inject.cjs\")\|require(\"./setup.cjs\")\|require(\"./resize.cjs\")\|path.join(__dirname, \"wallpapers" --include="*.cjs" --include="*.bat" --include="*.json" .
```
Expected: 仅注释/文档命中(`inject.cjs:7-9` 的 usage 注释、各 .cjs 顶部的 Usage 注释)。**代码行零残留**。若有代码行命中,说明漏改一处,回去修。

(注:lib/inject.cjs:7-9 是 `//   node inject.cjs` 注释,描述用法,不影响运行,保留。)

- [ ] **Step 3: 手动验证源码可独立运行(不依赖 .bat)**

Run:
```bash
node lib/setup.cjs
```
Expected: setup 正常跑完(检查环境、确认 wallpapers/ 存在、npm 依赖就绪),不因路径问题异常退出。看到 `[wallpaper] 完成` 类成功提示。

- [ ] **Step 4: 手动验证 resize 路径(若有 wallpapers/ 源图)**

Run:
```bash
node lib/resize.cjs
```
Expected: 若 wallpapers/ 有图,缩图到 ../wallpapers-thumb/ 成功;若无,提示"wallpapers/ 为空"。不报路径错。

---

### Task 11: 提交整理结果

全部验证通过后,统一提交。移动 + 引用修改作为一个完整的"目录整理"提交。

- [ ] **Step 1: 查看完整改动**

Run: `git status`
Expected: 10 个 renamed(inject/setup/resize/wallpaper.css 进 lib/,6 个测试进 test/),若干 modified(.bat、package.json、改了引用的 .cjs)。

- [ ] **Step 2: 提交**

Run:
```bash
git add -A
git commit -m "refactor: reorganize project structure (lib/ + test/)

Move core sources (inject/setup/resize.cjs + wallpaper.css) to lib/,
tests to test/. .bat launchers and probe.ps1 stay at root to preserve
the double-click UX. All path references updated (17 points + 4 script
lines per spec). Local artifacts (screenshot.png, zcode-launch.log)
removed. All 30 tests green."
```

- [ ] **Step 3: 确认提交结果**

Run: `git log --oneline -3`
Expected: 顶部是新提交,下面是之前的 fix(docs spec)、fix(buildExpression)。

---

## Self-Review 记录

(plan 写完后自审,问题已在写的过程中 inline 修正)
- ✅ Spec 覆盖:A-F 六类 + 删除本地产物,全部有对应 task。
- ✅ 无占位符:每步都有确切 find/replace 内容或确切命令。
- ✅ 类型/路径一致性:`../lib/inject.cjs`、`path.join(__dirname, "..", ...)` 写法全程统一。
- ✅ D 类标注了"补 require("path")",E 类 probetest 已有 require("path") 无需补(已在 spec 核实)。
