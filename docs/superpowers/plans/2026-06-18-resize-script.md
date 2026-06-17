# 壁纸缩图脚本 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供缩图脚本，把 wallpapers/ 里的相机原图（30-39MB）批量缩成 Electron 能渲染的小图输出到 wallpapers-thumb/，inject 改读该目录。

**Architecture:** 独立 resize.bat + resize.cjs（sharp 库，2560px/质量85，增量缩图，统一输出 .jpg），inject.cjs 改读 wallpapers-thumb/。wallpapers/（源）与 wallpapers-thumb/（产物）分离。

**Tech Stack:** Node.js (CommonJS .cjs)、sharp 0.35.1（图片处理）、Windows 批处理。

**参考 spec：** `docs/superpowers/specs/2026-06-18-resize-script-design.md`

---

## 任务总览

- Task 1：加 sharp 依赖 + 装
- Task 2：resize.cjs 纯函数（listSourceImages / needsResize）
- Task 3：resize.cjs resizeOne + main() 完整流程
- Task 4：resizetest.cjs 5 项纯函数测试
- Task 5：resize.bat 薄入口
- Task 6：inject.cjs 改读 wallpapers-thumb/ + 提示文案
- Task 7：.gitignore + package.json test 串入 resizetest
- Task 8：README 更新
- Task 9：手动端到端验证 + 收尾

---

### Task 1: 加 sharp 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 在 package.json dependencies 加 sharp**

package.json 当前 dependencies：
```json
  "dependencies": {
    "ws": "^8.18.0"
  }
```
改为：
```json
  "dependencies": {
    "sharp": "^0.35.1",
    "ws": "^8.18.0"
  }
```
（sharp 加在 ws 前，按字母序）

- [ ] **Step 2: 安装依赖**

Run: `npm install`
Expected: 看到 sharp 被安装（可能下载预编译二进制，几十秒）。最终 `added N packages`。

- [ ] **Step 3: 验证 sharp 能加载**

Run: `node -e "var s=require('sharp');console.log('sharp ok', typeof s)"`
Expected: `sharp ok object`（无报错）

- [ ] **Step 4: 提交**

```bash
git add package.json package-lock.json
git commit -m "deps: add sharp for wallpaper resizing"
```

---

### Task 2: resize.cjs 纯函数（listSourceImages / needsResize）

**Files:**
- Create: `resize.cjs`

- [ ] **Step 1: 创建 resize.cjs（骨架 + 常量 + 2 个纯函数 + 导出 + 守卫）**

Create `resize.cjs`:

```js
// Resize wallpaper source images into thumbnails that Electron can render.
// Camera originals (30-39MB) are too big for background-image; this scales
// them to <=2560px long edge, JPEG quality 85, output to wallpapers-thumb/.
// Incremental: skips images already resized (mtime check).
//
// Usage: node resize.cjs   (or double-click resize.bat)

const fs = require("fs");
const path = require("path");

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"]; // raster only; no .gif/.svg
const MAX_WIDTH = 2560;
const JPEG_QUALITY = 85;

// List raster image filenames in dir. Returns [] if dir missing/empty.
function listSourceImages(dir) {
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

// True if src needs (re)resizing: thumb missing, or thumb older than src.
function needsResize(srcPath, thumbPath) {
  try {
    var srcStat = fs.statSync(srcPath);
    var thumbStat = fs.statSync(thumbPath);
    return thumbStat.mtimeMs < srcStat.mtimeMs;
  } catch (e) {
    return true; // thumb missing or stat failed -> resize
  }
}

// sharp is required lazily inside resizeOne so that listSourceImages /
// needsResize can be unit-tested without sharp installed.
async function resizeOne(srcPath, thumbPath) {
  const sharp = require("sharp");
  await sharp(srcPath)
    .resize({
      width: MAX_WIDTH,
      height: MAX_WIDTH,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toFile(thumbPath);
}

async function main() {
  // Task 3 fills this in.
}

module.exports = { listSourceImages, needsResize, MAX_WIDTH, JPEG_QUALITY };

if (require.main === module) {
  main().catch(function (e) {
    console.error("[wallpaper] FAILED:", e.message);
    process.exit(1);
  });
}
```

> 注：resizeOne 里 `require("sharp")` 放函数内部（懒加载），这样 Task 4 的纯函数测试即使环境没装 sharp 也能 require resize.cjs 测 listSourceImages/needsResize。sharp 只在真正调用 resizeOne 时才加载。

- [ ] **Step 2: 验证 resize.cjs 能被 require**

Run: `node -e "var r=require('./resize.cjs');console.log(Object.keys(r))"`
Expected: `[ 'listSourceImages', 'needsResize', 'MAX_WIDTH', 'JPEG_QUALITY' ]`

- [ ] **Step 3: 提交**

```bash
git add resize.cjs
git commit -m "resize: add listSourceImages/needsResize pure functions"
```

---

### Task 3: resize.cjs resizeOne + main()

**Files:**
- Modify: `resize.cjs`

- [ ] **Step 1: 实现 main()**

把 resize.cjs 里空的 `async function main() { ... }` 替换为：

```js
async function main() {
  var srcDir = path.join(__dirname, "wallpapers");
  var thumbDir = path.join(__dirname, "wallpapers-thumb");

  console.log("[wallpaper] Step 1: scan source images");
  var images = listSourceImages(srcDir);
  if (images.length === 0) {
    console.log("[wallpaper]   wallpapers/ 为空，没图可缩。把图放进 wallpapers/ 后重跑。");
    process.exit(0);
  }
  console.log("[wallpaper]   found " + images.length + " images");

  console.log("[wallpaper] Step 2: ensure wallpapers-thumb/");
  fs.mkdirSync(thumbDir, { recursive: true });

  console.log("[wallpaper] Step 3: resize (skip already-resized)");
  var added = 0,
    skipped = 0,
    failed = 0;
  for (var i = 0; i < images.length; i++) {
    var name = images[i];
    var srcPath = path.join(srcDir, name);
    var base = name.replace(/\.[^.]+$/, ""); // strip extension
    var thumbPath = path.join(thumbDir, base + ".jpg");
    if (!needsResize(srcPath, thumbPath)) {
      skipped++;
      continue;
    }
    try {
      await resizeOne(srcPath, thumbPath);
      var kb = Math.round(fs.statSync(thumbPath).size / 1024);
      console.log("[wallpaper]   " + base + ".jpg  (" + kb + " KB)");
      added++;
    } catch (e) {
      console.error("[wallpaper]   " + name + " FAILED: " + e.message);
      failed++;
    }
  }

  console.log("[wallpaper] ========================================");
  console.log(
    "[wallpaper]  缩图完成: 新增 " + added + " / 跳过 " + skipped + " / 失败 " + failed
  );
  console.log("[wallpaper]  inject 会从 wallpapers-thumb/ 随机选图");
  console.log("[wallpaper] ========================================");
  process.exit(failed > 0 ? 1 : 0);
}
```

- [ ] **Step 2: 验证语法 + 真实缩 1 张图（手动小测）**

先确认 wallpapers/ 有图。跑完整 resize：
Run: `node resize.cjs`
Expected: 看到 Step 1/2/3 输出，每张图打印 `xxx.jpg (NNN KB)`，最后"缩图完成: 新增 33 / 跳过 0 / 失败 0"。

> 这一步是真实 sharp 调用，33 张大图可能要 30-60 秒，耐心等。

- [ ] **Step 3: 验证 wallpapers-thumb/ 产物**

Run: `node -e "var fs=require('fs');var n=fs.readdirSync('wallpapers-thumb').filter(function(x){return/\.jpg$/i.test(x)}).length;console.log('thumb count:',n)"`
Expected: `thumb count: 33`（与源图数一致）

抽查一张产物大小（应远小于原图）：
Run: `node -e "var fs=require('fs');var s=fs.statSync('wallpapers-thumb/'+fs.readdirSync('wallpapers-thumb').filter(function(x){return/\.jpg$/i.test(x)})[0]).size;console.log(Math.round(s/1024)+' KB')"`
Expected: ~1000-3000 KB（1-3MB），对比原图 30000+ KB。

- [ ] **Step 4: 提交**

```bash
git add resize.cjs
git commit -m "resize: implement main() incremental resize flow"
```

---

### Task 4: resizetest.cjs 5 项纯函数测试

**Files:**
- Create: `resizetest.cjs`

- [ ] **Step 1: 创建 resizetest.cjs**

Create `resizetest.cjs`:

```js
// Self-test for resize.cjs pure functions. Run: node resizetest.cjs
const fs = require("fs");
const path = require("path");
const os = require("os");
const resize = require("./resize.cjs");

let pass = 0,
  fail = 0;
function check(name, cond) {
  console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name);
  cond ? pass++ : fail++;
}

// --- listSourceImages ---
check("listSourceImages on missing dir -> []", resize.listSourceImages("Z:\\no\\such\\dir").length === 0);

(function () {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-resize-test-"));
  try {
    fs.writeFileSync(path.join(tmp, "a.jpg"), "x");
    fs.writeFileSync(path.join(tmp, "b.txt"), "x");
    fs.writeFileSync(path.join(tmp, "c.png"), "x");
    fs.writeFileSync(path.join(tmp, "d.svg"), "x");
    var imgs = resize.listSourceImages(tmp).sort();
    check(
      "listSourceImages filters to raster (no svg)",
      JSON.stringify(imgs) === JSON.stringify(["a.jpg", "c.png"])
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();

// --- needsResize ---
(function () {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-resize-test-"));
  try {
    var src = path.join(tmp, "src.jpg");
    var thumb = path.join(tmp, "src-thumb.jpg");
    // thumb missing -> needs resize
    fs.writeFileSync(src, "x");
    check("needsResize: thumb missing -> true", resize.needsResize(src, thumb) === true);
    // thumb newer than src -> skip
    fs.writeFileSync(thumb, "x");
    // bump thumb mtime to be definitely newer
    var future = new Date(Date.now() + 10000);
    fs.utimesSync(thumb, future, future);
    check("needsResize: thumb newer -> false", resize.needsResize(src, thumb) === false);
    // src replaced (newer) -> needs resize again
    var later = new Date(Date.now() + 20000);
    fs.utimesSync(src, later, later);
    check("needsResize: src newer -> true", resize.needsResize(src, thumb) === true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: 跑 resizetest 验证 5 项**

Run: `node resizetest.cjs`
Expected: `5 passed, 0 failed.`

- [ ] **Step 3: 提交**

```bash
git add resizetest.cjs
git commit -m "test: add resize.cjs pure function tests (listSourceImages/needsResize)"
```

---

### Task 5: resize.bat 薄入口

**Files:**
- Create: `resize.bat`

- [ ] **Step 1: 创建 resize.bat**

Create `resize.bat`（与 setup.bat 同结构）:

```bat
@echo off
chcp 65001 >nul
setlocal
title ZCode Wallpaper Resizer

REM ============================================================
REM  ZCode Wallpaper - resize source images to renderable thumbs.
REM  ----------------------------------------------------------
REM  - Pre-checks Node.js exists.
REM  - Scales wallpapers/*.jpg to wallpapers-thumb/ (2560px, q85).
REM  - Incremental: skips already-resized images.
REM  ASCII-only in this .bat (node prints Chinese itself).
REM ============================================================

echo [wallpaper] Checking for Node.js ...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [wallpaper] Node.js not found.
  echo [wallpaper] Please install Node.js LTS ^(v18+^) from https://nodejs.org
  echo [wallpaper] Then run resize.bat again.
  echo.
  pause
  exit /b 1
)

echo [wallpaper] Node.js found. Resizing ...
echo.
node "%~dp0resize.cjs"
set rc=%errorlevel%
echo.
if "%rc%"=="0" (
  echo [wallpaper] Resize finished successfully.
) else (
  echo [wallpaper] Resize reported an issue ^(rc=%rc%^).
)
pause
endlocal
```

- [ ] **Step 2: 手动验证 resize.bat 能调起 resize.cjs**

在 cmd 里跑（或双击）：`resize.bat`
Expected: 看到 `[wallpaper] Resizing ...` + resize.cjs 的 Step 1/2/3 输出 + "缩图完成" 总结。因 Task 3 已缩过，这次应全是"跳过"（added=0 skipped=33）。

- [ ] **Step 3: 提交**

```bash
git add resize.bat
git commit -m "resize: add resize.bat thin entry (node precheck + call cjs)"
```

---

### Task 6: inject.cjs 改读 wallpapers-thumb/ + 提示文案

**Files:**
- Modify: `inject.cjs:155-160`

- [ ] **Step 1: 改 wallpapersDir 路径**

inject.cjs:155 当前：
```js
      var wallpapersDir = path.join(__dirname, "wallpapers");
```
改为：
```js
      var wallpapersDir = path.join(__dirname, "wallpapers-thumb");
```

- [ ] **Step 2: 改空目录提示文案**

inject.cjs:158-159 当前：
```js
        console.log("[wallpaper] wallpapers/ 为空，不注入壁纸（ZCode 保持默认外观）。");
        console.log("[wallpaper] 把图片放进 " + wallpapersDir + " 后重跑 inject-only.bat。");
```
改为：
```js
        console.log("[wallpaper] wallpapers-thumb/ 为空，不注入壁纸（ZCode 保持默认外观）。");
        console.log("[wallpaper] 双击 resize.bat 生成缩图后再启动。");
        console.log("[wallpaper] （把原图放进 wallpapers/，resize 会自动缩到 wallpapers-thumb/）");
```

- [ ] **Step 3: 验证 inject 语法 + 现有测试不破**

Run: `node -e "require('./inject.cjs');console.log('ok')"`
Expected: `ok`
Run: `node selftest.cjs`
Expected: `13 passed, 0 failed.`

- [ ] **Step 4: 提交**

```bash
git add inject.cjs
git commit -m "inject: read wallpapers-thumb/ instead of wallpapers/"
```

---

### Task 7: .gitignore + package.json test 串入 resizetest

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: .gitignore 加 wallpapers-thumb/**

在 .gitignore 的 `wallpapers/*` 那段之后（`!wallpapers/.gitkeep` 之后）加：

```
# Resized wallpaper thumbnails (generated by resize.cjs from wallpapers/)
wallpapers-thumb/
```

- [ ] **Step 2: package.json test 串入 resizetest**

package.json scripts.test 当前：
```json
    "test": "node selftest.cjs && node cdp-mock-test.cjs && node setuptest.cjs"
```
改为：
```json
    "test": "node selftest.cjs && node cdp-mock-test.cjs && node setuptest.cjs && node resizetest.cjs"
```

- [ ] **Step 3: 跑完整 npm test**

Run: `npm test`
Expected: selftest 13 + cdp-mock 3 + setuptest 4 + resizetest 5 = 25 项全过。

- [ ] **Step 4: 验证 wallpapers-thumb/ 被 gitignore**

Run: `git check-ignore wallpapers-thumb`
Expected: 输出 `wallpapers-thumb`（被忽略）

- [ ] **Step 5: 提交**

```bash
git add .gitignore package.json
git commit -m "ignore wallpapers-thumb/; wire resizetest into npm test"
```

---

### Task 8: README 更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 在「壁纸图（随机轮播）」一节标题之后插入缩图说明**

读 README 找到「## 壁纸图（随机轮播）」标题。在它之后、现有内容之前，插入一段醒目的提示：

```markdown
## 壁纸图（随机轮播）

> ⚠️ **相机原图（几十 MB）必须先缩图**。inject 实际从 `wallpapers-thumb/`（缩图产物）读，不是 `wallpapers/` 原图。先双击 `resize.bat` 生成缩图，否则看不到壁纸。见下方「缩图」。
```

（即把现有该节第一段替换为上面这段——保留后面"壁纸由 inject.cjs 每次启动时..."等正文）

> 执行注意：用 Edit 工具，old_string 匹配现有「## 壁纸图（随机轮播）」标题 + 紧跟的空行 + 第一段正文开头，new_string 插入提示 blockquote。

- [ ] **Step 2: 新增「缩图」一节（紧跟「壁纸图（随机轮播）」整节之后）**

在「壁纸图（随机轮播）」一节的最后一行（"支持 .jpg .jpeg..."那句）之后，插入新节：

```markdown

## 缩图（重要）

相机原图（30-39MB）体积过大，Electron 的 `background-image` 加载会静默失败（看不到壁纸）。必须先缩图：

1. 把原图放进 `wallpapers/`
2. 双击 **`resize.bat`**：
   - 扫描 `wallpapers/` 的栅格图（jpg/jpeg/png/webp）
   - 缩到长边 ≤2560px、JPEG 质量 85
   - 输出到 `wallpapers-thumb/`（与源同 basename，统一 `.jpg`）
   - **增量**：已缩过且不比源旧的自动跳过，重复跑很快
3. 看到"缩图完成"后，双击 `start-zcode.bat` 启动（inject 从 `wallpapers-thumb/` 随机选）

> 💡 加新图流程：图放 `wallpapers/` → 双击 `resize.bat` → 双击 `start-zcode.bat`。
> 缩图只对栅格图（jpg/png/webp）有效，svg/gif 不处理。
```

- [ ] **Step 3: 文件说明表加 3 行**

在文件说明表里 `setup.cjs` 行之后（或 `setuptest.cjs` 之后，按逻辑分组）插入：
```markdown
| **`resize.bat`** | 把 wallpapers/ 原图批量缩图到 wallpapers-thumb/（增量，2560px/质量85） |
| `resize.cjs` | resize.bat 的核心逻辑（sharp 缩图） |
| `resizetest.cjs` | resize 逻辑自检（5 项） |
```

- [ ] **Step 4: 验证状态加一行**

在「验证状态」节末尾加：
```markdown
- [x] resize 逻辑自检 `node resizetest.cjs` → **5/5 通过**
```

- [ ] **Step 5: 安装/setup 一节补一句 sharp**

在「安装」一节 setup.bat 的能力列表里，"安装依赖"那条改成：
```markdown
- 安装依赖（`npm install`，含 `ws` 和 `sharp`）
```

- [ ] **Step 6: 提交**

```bash
git add README.md
git commit -m "docs: document resize workflow and wallpapers-thumb/"
```

---

### Task 9: 手动端到端验证 + 收尾

**Files:** 无（纯验证）

- [ ] **Step 1: 完整测试套件**

Run: `npm test`
Expected: selftest 13 + cdp-mock 3 + setuptest 4 + resizetest 5 = 25 项全过。

- [ ] **Step 2: 确认 wallpapers-thumb/ 有缩图（Task 3 生成过）**

Run: `node -e "console.log(require('fs').readdirSync('wallpapers-thumb').filter(function(x){return/\.jpg$/i.test(x)}).length)"`
Expected: 33（或你当前 wallpapers/ 的图数）

- [ ] **Step 3: 确认 ZCode 带调试端口在运行**

Run: `powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9222/json/version'-TimeoutSec 2).StatusCode}catch{'NO_PORT'}"`
Expected: `200`。若 NO_PORT，双击 start-zcode.bat 启动带端口的 ZCode 再继续。

- [ ] **Step 4: 跑 inject，从 wallpapers-thumb/ 随机选**

Run: `node inject.cjs`
Expected: `[wallpaper] 选中壁纸: xxxx.jpg （共 33 张可选）` + 注入 ok。

- [ ] **Step 5: CDP 探针验证 body 背景图指向 wallpapers-thumb/ + file exists**

写临时 `_probe.cjs`（内容见下），运行。

`_probe.cjs`:
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
        var winPath=m?m[1].replace(/^file:\/\/\//,"").replace(/\//g,"\\"):null;
        console.log("in_thumb:", winPath?winPath.indexOf("wallpapers-thumb")!==-1:"no_url");
        console.log("file_exists:", winPath?fs.existsSync(winPath):"no_url");
        ws.close();
      };
      ws.send(JSON.stringify({id:id,method:"Runtime.evaluate",params:{expression:'JSON.stringify({found:!!document.getElementById("zcode-user-wallpaper"),bodyBg:getComputedStyle(document.body).backgroundImage})',returnByValue:true}}));
    });
  });
});
```

Run: `node _probe.cjs`
Expected:
- `found: true`
- `bodyBg:` 指向 `file:///.../wallpapers-thumb/xxx.jpg`
- `in_thumb: true`
- `file_exists: true`

- [ ] **Step 6: 终极判据——ZCode 窗口实际看到壁纸**

**请直接看 ZCode 窗口**——这次缩图后体积小（1-3MB），Electron 应该能渲染。如果还看不到，说明根因判断有误，需回到调试（但红色测试 + 体积数据已强力支持"体积过大"判断，这步应通过）。

- [ ] **Step 7: 验证增量——重复跑 resize**

Run: `node resize.cjs`
Expected: `缩图完成: 新增 0 / 跳过 33 / 失败 0`（全部跳过，增量生效）

- [ ] **Step 8: 验证加新图增量**

复制一张已有图改名放进 wallpapers/（模拟新图）：
```bash
cp wallpapers/DSC02849_260319_231525.jpg wallpapers/test-new.jpg
node resize.cjs
```
Expected: `新增 1 / 跳过 33`（只缩新加的 test-new.jpg）

清理测试图：
```bash
rm wallpapers/test-new.jpg wallpapers-thumb/test-new.jpg
```

- [ ] **Step 9: 清理临时探针**

Run: `rm -f _probe.cjs`

- [ ] **Step 10: 检查工作区 + 推送**

```bash
git status   # 应干净（wallpapers-thumb/ 被忽略，_probe.cjs 已删）
git log --oneline -12
git push
```

---

## Self-Review 记录

（plan 作者自检，执行者无需操作）

**1. Spec 覆盖：**
- §4.1 listSourceImages/needsResize → Task 2 ✓
- §4.1 resizeOne（懒加载 sharp）→ Task 2 ✓（懒加载决策见下方）
- §4.2 main() → Task 3 ✓
- §4.3 统一输出 .jpg → Task 3 main() `base + ".jpg"` ✓
- §5 inject 改读 thumb + 提示 → Task 6 ✓
- §6.1 .gitignore → Task 7 ✓
- §6.2 package.json sharp + test → Task 1 + Task 7 ✓
- §6.3 README → Task 8 ✓
- §7.1 resizetest 5 项 → Task 4 ✓
- §7.3 手动验证 → Task 9 ✓
- §9 错误处理（sharp 未装、单张失败、空目录）→ Task 2 守卫 + Task 3 try/catch + Task 9 ✓

**2. Placeholder scan：** Task 8 Step 1/2 有"执行注意"提示用 Edit 匹配——这是必要的操作指引（README 当前文本需执行时读取匹配），不是 plan placeholder。无 TBD/TODO。

**3. Type consistency：** listSourceImages/needsResize 在 Task 2 定义，Task 4 测试用同名 `resize.listSourceImages`/`resize.needsResize`，Task 3 main() 调用同名。MAX_WIDTH/JPEG_QUALITY 常量 Task 2 定义、Task 3 resizeOne 用、Task 4 不直接测（值正确性靠真实缩图手动验证）。函数签名一致 ✓。

**懒加载 sharp 的额外说明（自检发现）：** spec §4.1 把 resizeOne 写成顶部 `const sharp = require("sharp")`。但 Task 4 的纯函数测试要 `require("./resize.cjs")`，若 sharp 未装会顶层 require 报错，导致 listSourceImages/needsResize 测不了。所以 plan Task 2 把 sharp require 移进 resizeOne 函数体（懒加载）——这是对 spec 的合理改进，保证纯函数可独立测试。已与 spec §4.1 的小偏离，记录在此。
