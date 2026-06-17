# 启动时随机壁纸 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 取消固定路径/wallpaper.svg，改为 inject 时从 `wallpapers/` 随机选一张图；空目录则不注入，ZCode 保持默认外观。

**Architecture:** 职责重划——wallpaper.css 只留样式偏好（透明度/背景尺寸），inject.cjs 负责"用哪张图"（扫描+随机+动态追加 background-image 规则），setup.cjs 不再碰 CSS。inject.cjs 加 `require.main` 守卫以支持纯函数测试。

**Tech Stack:** Node.js (CommonJS .cjs)、Windows 批处理、CDP（Chrome DevTools Protocol）。

**参考 spec：** `docs/superpowers/specs/2026-06-18-random-wallpaper-design.md`

---

## 任务总览

- Task 1：inject.cjs 加 toFileUrl/listWallpapers/pickRandom 纯函数 + require.main 守卫
- Task 2：inject.cjs main() 加选图分支（空目录跳过、随机选图、追加规则）
- Task 3：selftest.cjs 加 5 项 inject 纯函数测试
- Task 4：wallpaper.css 删 background-image 行 + 更新注释
- Task 5：setup.cjs 删占位符机制（toFileUrl/hasPlaceholder/replacePlaceholder/Step 4），重编号
- Task 6：setuptest.cjs 删 5 项测试
- Task 7：删 wallpaper.svg + 清 .gitignore
- Task 8：README 更新
- Task 9：手动端到端验证 + 收尾

---

### Task 1: inject.cjs 纯函数 + require.main 守卫

**Files:**
- Modify: `inject.cjs`

- [ ] **Step 1: 在 inject.cjs 第 17 行（STYLE_ID 定义）之后插入常量 + 3 个纯函数**

在 `const STYLE_ID = "zcode-user-wallpaper";`（inject.cjs:17）之后、`let _callId = 0;` 之前插入：

```js
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];

// Convert a Windows absolute path to a file:/// URL.
// "C:\\a\\b" -> "file:///C:/a/b"  (prefix + backslash -> slash)
function toFileUrl(p) {
  return "file:///" + String(p).replace(/\\/g, "/");
}

// List image filenames in dir (by extension). Returns [] if dir missing/empty.
function listWallpapers(dir) {
  try {
    var entries = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  return entries.filter(function (name) {
    var ext = path.extname(name).toLowerCase();
    return IMAGE_EXTS.indexOf(ext) !== -1;
  });
}

// Pick a random item. Returns null for empty list.
function pickRandom(items) {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}
```

- [ ] **Step 2: 把 inject.cjs 末尾的顶层 main() 调用改成守卫 + 导出**

inject.cjs:179-182 现在是：
```js
main().catch((e) => {
  console.error("[wallpaper] FAILED:", e.message);
  process.exit(1);
});
```

在它**之前**插入导出，整段改为：
```js
module.exports = { toFileUrl, listWallpapers, pickRandom };

if (require.main === module) {
  main().catch((e) => {
    console.error("[wallpaper] FAILED:", e.message);
    process.exit(1);
  });
}
```

- [ ] **Step 3: 验证 inject.cjs 能被 require 而不触发 main()**

Run:
```bash
node -e "var i=require('./inject.cjs');console.log(typeof i.toFileUrl, typeof i.listWallpapers, typeof i.pickRandom)"
```
Expected: `function function function`（且不应有 `[wallpaper]` 日志输出，说明 main 没被触发）

- [ ] **Step 4: 提交**

```bash
git add inject.cjs
git commit -m "inject: add toFileUrl/listWallpapers/pickRandom + require.main guard"
```

---

### Task 2: inject.cjs main() 加选图分支

**Files:**
- Modify: `inject.cjs:121-127`（main 开头的 css 读取段）

- [ ] **Step 1: 替换 main() 开头的 css 读取段**

inject.cjs:121-127 现在是：
```js
async function main() {
  let css = "";
  if (MODE === "inject") {
    css = process.env.ZCODE_WP_CSS
      ? fs.readFileSync(process.env.ZCODE_WP_CSS, "utf8")
      : fs.readFileSync(path.join(__dirname, "wallpaper.css"), "utf8");
  }
```

替换为（加选图逻辑，保留 ZCODE_WP_CSS 环境变量覆盖能力）：
```js
async function main() {
  let css = "";
  if (MODE === "inject") {
    if (process.env.ZCODE_WP_CSS) {
      // 旁路：直接用指定 CSS 文件，跳过随机选图
      css = fs.readFileSync(process.env.ZCODE_WP_CSS, "utf8");
    } else {
      var wallpapersDir = path.join(__dirname, "wallpapers");
      var images = listWallpapers(wallpapersDir);
      if (images.length === 0) {
        console.log("[wallpaper] wallpapers/ 为空，不注入壁纸（ZCode 保持默认外观）。");
        console.log("[wallpaper] 把图片放进 " + wallpapersDir + " 后重跑 inject-only.bat。");
        process.exit(0);
      }
      var chosen = pickRandom(images);
      var fileUrl = toFileUrl(path.join(wallpapersDir, chosen));
      css = fs.readFileSync(path.join(__dirname, "wallpaper.css"), "utf8");
      css =
        css +
        "\n/* 本次启动随机选中的壁纸 */\n" +
        'body { background-image: url("' +
        fileUrl +
        '") !important; }\n';
      console.log("[wallpaper] 选中壁纸: " + chosen + " （共 " + images.length + " 张可选）");
    }
  }
```

- [ ] **Step 2: 验证语法正确（require 不报错）**

Run: `node -e "require('./inject.cjs')"`
Expected: 无输出、无报错（exit 0）。

- [ ] **Step 3: 提交**

```bash
git add inject.cjs
git commit -m "inject: select random wallpaper from wallpapers/ on inject"
```

---

### Task 3: selftest.cjs 加 5 项 inject 纯函数测试

**Files:**
- Modify: `selftest.cjs`

- [ ] **Step 1: 在 selftest.cjs 顶部 require 区加 inject 导入**

selftest.cjs:1-4 现在是：
```js
// Self-test for inject.cjs buildExpression logic against a fake DOM.
// Run: node selftest.cjs
const fs = require("fs");
const path = require("path");
```

在 `const path = require("path");` 之后加一行：
```js
const inject = require("./inject.cjs");
```

- [ ] **Step 2: 在 selftest.cjs 末尾（`console.log("\n" + pass...` 之前）插入 5 项测试**

在 selftest.cjs:113（`console.log("\n" + pass + " passed...`）之前插入：

```js
// --- Test 5: inject.cjs pure functions (toFileUrl / listWallpapers / pickRandom) ---
(function () {
  // toFileUrl
  check(
    "toFileUrl('C:\\\\a\\\\b') -> file:///C:/a/b",
    inject.toFileUrl("C:\\a\\b") === "file:///C:/a/b"
  );

  // listWallpapers: missing dir -> []
  check("listWallpapers on missing dir -> []", inject.listWallpapers("Z:\\no\\such\\dir").length === 0);

  // listWallpapers: real temp dir with mixed files
  var os = require("os");
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-wp-test-"));
  try {
    fs.writeFileSync(path.join(tmp, "a.jpg"), "x");
    fs.writeFileSync(path.join(tmp, "b.txt"), "x");
    fs.writeFileSync(path.join(tmp, "c.png"), "x");
    var imgs = inject.listWallpapers(tmp).sort();
    check("listWallpapers filters by extension", JSON.stringify(imgs) === JSON.stringify(["a.jpg", "c.png"]));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // pickRandom: empty -> null
  check("pickRandom([]) -> null", inject.pickRandom([]) === null);

  // pickRandom: result always in list
  var pool = ["x.jpg", "y.jpg", "z.jpg"];
  var ok = true;
  for (var i = 0; i < 20; i++) {
    if (pool.indexOf(inject.pickRandom(pool)) === -1) { ok = false; break; }
  }
  check("pickRandom returns an item from the list", ok);
})();
```

- [ ] **Step 3: 跑 selftest 验证 13 项全过**

Run: `node selftest.cjs`
Expected: `13 passed, 0 failed.`

- [ ] **Step 4: 提交**

```bash
git add selftest.cjs
git commit -m "test: add inject.cjs pure function tests (toFileUrl/listWallpapers/pickRandom)"
```

---

### Task 4: wallpaper.css 删 background-image 行 + 更新注释

**Files:**
- Modify: `wallpaper.css`

- [ ] **Step 1: 更新顶部注释段（[图] 说明改为由 inject 随机选）**

wallpaper.css:9-13 现在的注释段：
```css
   调参说明（下面每处都标了 [调这里]）：
   - [图]  把 url(...) 换成你的图。本机路径用 file:/// 形式
   - [透明度]  opacity:0.85 → 数字越小壁纸越明显，但字也越难看清
   - [模糊]  blur(0px) → 想要毛玻璃效果就调大，如 blur(8px)
```

替换为：
```css
   调参说明：
   - [背景图]  由 inject.cjs 启动时从 wallpapers/ 随机选一张，本文件不写图路径。
               换图只需往 wallpapers/ 加图/删图，不用改这里。
   - [透明度]  rgba(...,0.82) 最后一位 → 数字越小壁纸越明显，但字也越难看清
   - [模糊]  blur(0px) → 想要毛玻璃效果就调大，如 blur(8px)
```

- [ ] **Step 2: 删 background-image 行（wallpaper.css:21），保留其余 4 条**

把：
```css
body {
  background-image: url("file:///C:/Users/johnl/Documents/zcode-wallpaper/wallpapers/DSC02849_260319_231525.jpg") !important; /* [图] setup.bat 会自动填入 wallpapers 目录的绝对路径；想换图改文件名即可 */
  background-size: cover !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-attachment: fixed !important;
}
```

改为（删第一行 background-image）：
```css
body {
  background-size: cover !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-attachment: fixed !important;
}
```

> ⚠️ 注意：当前仓库的 wallpaper.css 第 21 行可能因本地未提交改动而是别的路径。以实际 Read 到的内容为准做 Edit，关键是要删掉 `background-image:` 那一行。如果当前第 21 行还是占位符 `__WALLPAPER__/wallpaper.svg` 形式，也一并删掉。

- [ ] **Step 3: 更新 body 段前面的注释（wallpaper.css:15-19）**

把：
```css
/* 1) 背景层：图挂在 body 上。
      [图] 把下面 url() 换成你自己的图。规则：
        - 开头 file:///，盘符后用正斜杠 /
        - 纯英文路径，别用中文/空格（file:// 加载中文路径可能失败）
      默认用自带的测试图 wallpaper.svg，换成你的图即可。 */
```

替换为：
```css
/* 1) 背景层样式：尺寸/定位/重复/固定。背景图由 inject.cjs 启动时
      从 wallpapers/ 随机选一张并动态追加 background-image 规则。
      文件名请用纯英文、别用中文/空格（file:// 加载中文路径可能失败）。 */
```

- [ ] **Step 4: 验证 selftest 仍通过（selftest 读 wallpaper.css 做 buildExpression 测试）**

Run: `node selftest.cjs`
Expected: `13 passed, 0 failed.`（删 background-image 行不影响 buildExpression 测试，那只是测 css 字符串能否被注入）

- [ ] **Step 5: 提交**

```bash
git add wallpaper.css
git commit -m "wallpaper.css: remove background-image, let inject pick randomly"
```

---

### Task 5: setup.cjs 删占位符机制 + 重编号

**Files:**
- Modify: `setup.cjs`

- [ ] **Step 1: 删常量 PLACEHOLDER（setup.cjs:11）**

删掉这一行：
```js
const PLACEHOLDER = "__WALLPAPER__";
```
（保留 `const MIN_NODE_MAJOR = 18;`）

- [ ] **Step 2: 删 toFileUrl 函数（setup.cjs:26-31）**

删掉整段：
```js
// Convert a Windows absolute path to a file:/// URL.
// "C:\\a\\b\\wallpapers" -> "file:///C:/a/b/wallpapers"
// Rule: prefix "file:///", then replace all backslashes with forward slashes.
function toFileUrl(p) {
  return "file:///" + String(p).replace(/\\/g, "/");
}
```

- [ ] **Step 3: 删 hasPlaceholder + replacePlaceholder 函数（setup.cjs:33-44）**

删掉整段：
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

- [ ] **Step 4: 删 main() 的 Step 4（占位符替换，setup.cjs:129-149）**

删掉整段（从 `// --- Step 4: replace placeholder...` 到 `console.log("[wallpaper]   Configured -> " + fileUrl + "/wallpaper.svg");` 然后是 `}`）：
```js
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
```

- [ ] **Step 5: 把原 Step 5/6 重编号为 Step 4/5**

原 setup.cjs:151 `console.log("[wallpaper] Step 5: install dependencies (npm install)");` 改为：
```js
  // --- Step 4: npm install ---
  console.log("[wallpaper] Step 4: install dependencies (npm install)");
```

- [ ] **Step 6: 更新总结文案（原 Step 6 → Step 5）**

原 setup.cjs:159-170 的总结段，把 `Step 6` 改 `Step 5`，并把：
```js
  console.log("[wallpaper]  - 壁纸路径已配置 -> wallpaper.svg");
```
改为：
```js
  console.log("[wallpaper]  - 壁纸目录就绪，inject 时从 wallpapers/ 随机选图");
```
把：
```js
  console.log("[wallpaper]   1. 想换图: 把图放进 wallpapers/, 改 wallpaper.css 的文件名");
```
改为：
```js
  console.log("[wallpaper]   1. 想换图: 把图放进 wallpapers/（启动时随机选一张）");
```

- [ ] **Step 7: 删 module.exports 里的 toFileUrl/hasPlaceholder/replacePlaceholder**

setup.cjs:173-181 现在是：
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
改为：
```js
module.exports = {
  parseNodeVersion,
  isNodeVersionOk,
  detectZcode,
};
```

- [ ] **Step 8: 更新文件头注释（不再说配置路径）**

setup.cjs:1-2 现在：
```js
// One-click setup for zcode-wallpaper on a new machine.
// Checks environment, configures the local wallpaper path (via a placeholder
// in wallpaper.css), and installs dependencies. Idempotent: safe to re-run.
```
改为：
```js
// One-click setup for zcode-wallpaper on a new machine.
// Checks environment, ensures the wallpapers/ directory, and installs
// dependencies. Idempotent: safe to re-run. Does NOT touch wallpaper.css.
```

- [ ] **Step 9: 验证 setup.cjs 语法正确**

Run: `node -e "require('./setup.cjs')"`
Expected: 无输出无报错。

- [ ] **Step 10: 提交**

```bash
git add setup.cjs
git commit -m "setup: remove placeholder mechanism (path now handled by inject)"
```

---

### Task 6: setuptest.cjs 删 5 项测试

**Files:**
- Modify: `setuptest.cjs`

- [ ] **Step 1: 删 Task 2（toFileUrl）测试块**

setuptest.cjs:16-20，删掉：
```js
// --- Task 2: toFileUrl ---
check(
  "toFileUrl('C:\\\\a\\\\b\\\\wallpapers') -> file:///C:/Users/johnl/Documents/zcode-wallpaper/wallpapers",
  setup.toFileUrl("C:\\a\\b\\wallpapers") === "file:///C:/Users/johnl/Documents/zcode-wallpaper/wallpapers"
);
```

- [ ] **Step 2: 删 Task 3（placeholder）整个 IIFE**

setuptest.cjs:22-37，删掉整段：
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

- [ ] **Step 3: 跑 setuptest 验证剩 4 项**

Run: `node setuptest.cjs`
Expected: `4 passed, 0 failed.`

- [ ] **Step 4: 提交**

```bash
git add setuptest.cjs
git commit -m "test: remove toFileUrl/placeholder tests from setuptest (moved to selftest)"
```

---

### Task 7: 删 wallpaper.svg + 清 .gitignore

**Files:**
- Delete: `wallpaper.svg`
- Modify: `.gitignore`

- [ ] **Step 1: 删除 wallpaper.svg 文件**

Run: `git rm wallpaper.svg`
（用 git rm 让删除直接进暂存区）

- [ ] **Step 2: 清 .gitignore 的 !wallpaper.svg 行**

.gitignore 现在有：
```
!wallpaper.svg
!EffectPreview.png
```
删掉 `!wallpaper.svg` 这一行，保留 `!EffectPreview.png`。

- [ ] **Step 3: 确认 wallpaper.svg 不再被跟踪**

Run: `git ls-files wallpaper.svg`
Expected: 无输出（文件已不在版本控制）。

- [ ] **Step 4: 提交**

```bash
git add .gitignore
git commit -m "remove bundled wallpaper.svg test image"
```

---

### Task 8: README 更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 重写「换自己的壁纸图」一节**

读 README 当前「换自己的壁纸图」整节，把它替换为：

```markdown
## 壁纸图（随机轮播）

壁纸由 `inject.cjs` **每次启动时从 `wallpapers/` 目录随机选一张**。你只需要把图放进 `wallpapers/`、删掉不想要的图，不用改任何 CSS 或路径。

- `wallpapers/` 有图 → 每次双击 `start-zcode.bat` 启动 ZCode 时，随机选一张注入（同一次会话内固定这一张，下次启动换一张）
- `wallpapers/` 为空 → 不注入任何壁纸，ZCode 保持默认外观

### 加图 / 换图

1. 把图复制进 `wallpapers/`（项目根目录下的子目录，已被 `.gitignore` 忽略，私人照片不会提交）
2. 下次双击 `start-zcode.bat` 即自动从全部图里随机选一张

> ⚠️ 文件名请用**纯英文、别用中文/空格**（`file://` 加载中文路径可能失败）。支持 `.jpg .jpeg .png .webp .gif .svg`。
```

> 注：当前 README 的「换自己的壁纸图」一节是上一轮迭代写的（讲 file:/// 路径转换）。整节替换掉，包括标题改为「壁纸图（随机轮播）」。

- [ ] **Step 2: 更新「文件说明」表**

删掉 `wallpaper.svg` 行。把 `inject.cjs` 行描述改为：
```
| `inject.cjs` | 核心注入器（CDP + 从 wallpapers/ 随机选图） |
```
把 `wallpapers/` 行描述改为：
```
| `wallpapers/` | **放你的壁纸图**（inject 启动时随机选一张；`.gitignore` 已忽略） |
```

- [ ] **Step 3: 更新「安装」一节的 setup 列表**

把 setup.bat 列表里的：
```
- 把壁纸路径自动配置好（指向自带的 wallpaper.svg）
```
改为：
```
- 准备 `wallpapers/` 目录（inject 时从中随机选图）
```

- [ ] **Step 4: 更新「验证状态」的项数**

selftest 行改为 `→ 13/13 通过`，setuptest 行改为 `→ 4/4 通过`。

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: rewrite wallpaper section for random selection"
```

---

### Task 9: 手动端到端验证 + 收尾

**Files:** 无（纯验证）

- [ ] **Step 1: 完整测试套件**

Run: `npm test`
Expected: selftest 13 + cdp-mock 3 + setuptest 4 = 20 项全过。

- [ ] **Step 2: 确认 ZCode 带调试端口在运行**

Run: `powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9222/json/version' -TimeoutSec 2).StatusCode } catch { 'NO_PORT' }"`
Expected: `200`。如果是 NO_PORT，让用户先双击 start-zcode.bat 启动带端口的 ZCode，或用 `node inject.cjs` 时会自然报端口错误——这一步只是确认前提。

- [ ] **Step 3: 跑 inject 验证随机选图（wallpapers/ 有图）**

Run: `node inject.cjs`
Expected: 打印 `[wallpaper] 选中壁纸: XXXX.jpg （共 34 张可选）` + `注入 -> ZCode (ok)`。

- [ ] **Step 4: 用 CDP 探针验证 body 背景图指向真实存在的图**

写一个临时探针 `_probe.cjs`（内容见下方），运行，验证 `found:true` 且 `bodyBg` 指向 `file:///C:/Users/johnl/Documents/zcode-wallpaper/wallpapers/<某真实图>.jpg`，且该文件确实存在。

`_probe.cjs` 内容：
```js
var http = require("http");
var fs = require("fs");
var { WebSocket } = require("ws");
http.get({host:"127.0.0.1",port:9222,path:"/json",headers:{Host:"localhost"}},function(res){
  var d="";res.on("data",function(c){d+=c;});
  res.on("end",function(){
    var t=JSON.parse(d).filter(function(x){return x.type==="page";})[0];
    var wsUrl=t.webSocketDebuggerUrl.replace(/^ws:\/\/localhost\//i,"ws://127.0.0.1:9222/");
    var ws=new WebSocket(wsUrl),id=0,pend={};
    ws.on("message",function(r){var m=JSON.parse(r.toString());if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];}});
    ws.on("open",function(){
      pend[++id]=function(res){
        var v=JSON.parse(res.result.result.value);
        console.log("found:",v.found);
        console.log("bodyBg:",v.bodyBg);
        var m=/url\("([^"]+)"\)/.exec(v.bodyBg);
        console.log("file exists:", m?fs.existsSync(m[1].replace(/^file:\/\/\//,"").replace(/\//g,"\\")):"no match");
        ws.close();
      };
      ws.send(JSON.stringify({id:id,method:"Runtime.evaluate",params:{expression:'JSON.stringify({found:!!document.getElementById("zcode-user-wallpaper"),bodyBg:getComputedStyle(document.body).backgroundImage})',returnByValue:true}}));
    });
  });
});
```

Run: `node _probe.cjs`
Expected: `found: true`，bodyBg 指向 wallpapers/ 下某图，`file exists: true`。

- [ ] **Step 5: 验证随机性——连跑 3 次，看是否换图**

Run: `node inject.cjs`（连跑 3 次，记录每次"选中壁纸"文件名）
Expected: 3 次中至少出现 2 个不同文件名（理论 34 张图，3 次全相同的概率极低）。若 3 次全相同，重跑几次确认是否真随机。

- [ ] **Step 6: 验证空目录行为——临时清空 wallpapers**

Run（临时改名 wallpapers，让 listWallpapers 返回空）:
```bash
ren wallpapers wallpapers-bak
node inject.cjs
ren wallpapers-bak wallpapers
```
Expected: 打印 `[wallpaper] wallpapers/ 为空，不注入壁纸（ZCode 保持默认外观）。` + `[wallpaper] 把图片放进 ... 后重跑 inject-only.bat。`，exit 0。

- [ ] **Step 7: 验证 --remove 不受空目录影响**

 wallpapers/ 已恢复（上一步 ren 回来了）。先注入一张，再 remove：
```bash
node inject.cjs
node inject.cjs --remove
```
Expected: inject 正常注入，remove 正常移除（打印 `移除 -> ZCode (removed)`）。

- [ ] **Step 8: 验证 setup.cjs 不再碰 wallpaper.css**

Run: `node setup.cjs`
Expected: 步骤里**没有** "configure wallpaper path" 那一步；Step 4 是 npm install。
然后 `git status` 检查 wallpaper.css 是否被改动：
Expected: wallpaper.css 不在 modified 列表（setup 没碰它）。

- [ ] **Step 9: 清理临时探针**

Run: 删除 `_probe.cjs`（如果 Step 4 建了的话）

- [ ] **Step 10: 推送全部改动**

```bash
git status   # 确认工作区干净（除可能的本机 wallpaper.css，但 Task 4 后它是占位符状态，应干净）
git log --oneline -10   # 确认提交历史
git push
```

---

## Self-Review 记录

（plan 作者自检，执行者无需操作）

**1. Spec 覆盖：**
- §4.1 toFileUrl/listWallpapers/pickRandom → Task 1 ✓
- §4.2 require.main 守卫 → Task 1 Step 2 ✓
- §4.3 main 选图分支 + 空目录 exit 0 → Task 2 ✓
- §5 wallpaper.css 删 background-image + 注释 → Task 4 ✓
- §6.1 setup.cjs 删 3 函数 + Step 4 + 重编号 → Task 5 ✓
- §6.2 setuptest 删 5 项 → Task 6 ✓
- §7 selftest 加 5 项 → Task 3 ✓
- §8 删 wallpaper.svg + gitignore → Task 7 ✓
- §9 README → Task 8 ✓
- §10 错误处理（空目录 exit 0、remove 守卫）→ Task 2/9 验证 ✓
- §11 测试（selftest 13 + cdp 3 + setuptest 4 = 20）→ Task 9 Step 1 ✓

**2. Placeholder scan：** Task 4 Step 2 有个 ⚠️ 注释说"以实际 Read 到的内容为准"——这是必要的健壮性提示（因为 wallpaper.css 第 21 行可能是占位符或本机路径，取决于本地状态），不是 plan placeholder。无 TBD/TODO。

**3. Type consistency：** toFileUrl/listWallpapers/pickRandom 在 Task 1 定义，Task 3 测试用同名（inject.toFileUrl 等），Task 2 main() 调用同名。函数签名一致 ✓。IMAGE_EXTS 常量 Task 1 定义、Task 3 listWallpapers 测试间接覆盖 ✓。
