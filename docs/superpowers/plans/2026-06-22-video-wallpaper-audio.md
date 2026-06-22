# 视频壁纸加声音 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 视频壁纸默认有声（带 autoplay flag），并支持控制中心实时切静音（不重建 video 元素、不闪屏）。

**Architecture:** 四处改动全部复用现有管道：① `launch-zcode.bat` 一处加 Chromium autoplay flag（三条启动链都带）；② `inject.cjs` 视频注入去强制 muted、加 `play().catch` 自动降级；③ `cdp.cjs` 的 `probeWallpaperMode` 顺带读 `video.muted`，返回 `{mode, videoMuted}`；④ 新建 `lib/video-mute.cjs`（复用 `cdp.connect` 但不污染只读定位）做实时切；⑤ `control-server.cjs` 加 `muteVideo`/`unmuteVideo` 即时 action；⑥ 控制中心前端加声音按钮。

**Tech Stack:** Node.js (CommonJS .cjs)、Chromium CDP over WebSocket (`ws`)、Windows .bat/PowerShell、vanilla JS 前端（无框架）。

**Spec:** `docs/superpowers/specs/2026-06-22-video-wallpaper-audio-design.md`

---

## 关键约束（实施前必读）

1. **AGENTS.md 教训 21：浏览器/OS 行为别用"应该"推理，必须真机验。** 本计划 Task 0 是 flag 生效 gate——验不过**停下来找用户商量**，不硬推后续。
2. **AGENTS.md 教训 12/13：跨进程胶水（Chromium flag ↔ Electron 透传 ↔ DOM play() Promise ↔ CDP 写 muted）单测验不全，真机端到端跑。**
3. **`cdp.cjs` 是只读模块**（AGENTS.md 明确）。实时切静音是写操作，必须新建 `video-mute.cjs`，不能塞进 cdp.cjs。但 `cdp.connect`/`cdp.listTargets` 是中性工具，video-mute.cjs 复用它们。
4. **`.bat` 改动保持 ASCII-only**（AGENTS.md 改动惯例）。launch-zcode.bat 的 flag 是纯 ASCII，无问题。
5. **测试命令**：`npm test` 跑全部。本计划新增 `videomutetest.cjs`，要加进 `package.json` 的 test 串。

---

## Task 0: 真机验证 autoplay flag 是否生效（GATE）

> 这个 task 不写代码，只验证。是整个设计的前提假设。验不过就停。

**Files:** 无（只跑命令 + 人眼/耳验）

- [ ] **Step 1: 临时手动改 launch-zcode.bat 加 flag**

用编辑器打开 `bin/launch-zcode.bat`，找到第 57 行的 `$psi.Arguments='--remote-debugging-port=%DEBUG_PORT%';`，改成 `$psi.Arguments='--remote-debugging-port=%DEBUG_PORT% --autoplay-policy=no-user-gesture-required';`。

（这是临时改动，Task 1 会正式做。这里先手动加，只为跑 gate 验证。）

- [ ] **Step 2: 完全退出 ZCode**

所有窗口 + 右下角托盘图标都关掉。ZCode 是单实例，残留进程会让带 flag 的新实例起不来。

- [ ] **Step 3: 双击 wallpaper.bat，选场景 8（注入视频壁纸），但先选 7 启动带视频壁纸**

实际操作：双击 `wallpaper.bat` → 选 `7 启动带视频壁纸`。这一步会：杀残留 ZCode → 带 flag + debug port 启动 ZCode → 注入一个随机视频。

> 前提：`wallpapers-video/` 里至少有一个 `.mp4`。没有的话先放一个有声音的短视频进去。

- [ ] **Step 4: 听有没有声音**

**判断**：
- ✅ **有声音** → flag 生效，继续 Task 1。
- ❌ **没声音** → flag 没生效（Electron 不透传 / ZCode 用 webPreferences 覆盖了 autoplay 策略）。**停下来，把结果告诉用户**，讨论是否回退方案 B（用户手势路线，另开 spec）。

- [ ] **Step 5: 恢复 launch-zcode.bat（如果 Step 4 通过，保留改动直接进 Task 1；如果没通过，git checkout 恢复）**

```bash
# 仅当 Step 4 失败时跑：
git checkout bin/launch-zcode.bat
```

---

## Task 1: launch-zcode.bat 正式加 autoplay flag

**Files:**
- Modify: `bin/launch-zcode.bat:57`

- [ ] **Step 1: 加 flag 到 ProcessStartInfo.Arguments**

把 `bin/launch-zcode.bat` 第 57 行的：

```
$psi.Arguments='--remote-debugging-port=%DEBUG_PORT%';
```

改成：

```
$psi.Arguments='--remote-debugging-port=%DEBUG_PORT% --autoplay-policy=no-user-gesture-required';
```

注意：这是 PowerShell 单引号字符串里的内容，flag 加在单引号内。`%DEBUG_PORT%` 是 bat 变量展开（bat 把它替换成 `9222` 后 PowerShell 才看到字符串），flag 本身是纯 ASCII 字面量，不受影响。

- [ ] **Step 2: 确认 CRLF 行尾没被破坏**

AGENTS.md 改动惯例：`.bat` 必须 CRLF。用 Node 验：

```bash
node -e "var b=require('fs').readFileSync('bin/launch-zcode.bat'); var lf=0,crlf=0; for(var i=0;i<b.length-1;i++){if(b[i]===10&&b[i-1]!==13)lf++; if(b[i]===13&&b[i+1]===10)crlf++;} console.log('CRLF:'+crlf+' bareLF:'+lf);"
```

期望：`bareLF:0`。如果有 bare LF，用编辑器另存为 CRLF（或 `node -e` 写一个转换）。

- [ ] **Step 3: Commit**

```bash
git add bin/launch-zcode.bat
git commit -m "feat(video): launch-zcode 加 autoplay-policy flag（视频壁纸默认有声前提）"
```

---

## Task 2: inject.cjs 视频注入去强制 muted + 自动降级

**Files:**
- Modify: `lib/inject.cjs:140-147`（`buildVideoExpression` 的 muted + play 部分）
- Test: `test/selftest.cjs`（Test 4b/4c 改，新增 Test 4e）

- [ ] **Step 1: 改 selftest.cjs Test 4b —— 去掉"muted set"断言**

`test/selftest.cjs` 第 130 行附近，**删除**这一行：

```js
  check("video: muted set", video && video.getAttribute("muted") === "");
```

（默认模式不再强制 muted，这个断言会失败。）

- [ ] **Step 2: 改 selftest.cjs Test 4c —— 改字符串级断言**

`test/selftest.cjs` 第 135-145 行的 Test 4c，在现有的 `check("video expr contains .play() fallback", ...)` 之后**替换**为更精确的断言块。把整个 Test 4c 块（`// --- Test 4c: ...` 到闭合 `}`）替换为：

```js
// --- Test 4c: video expression default mode = unmuted + auto-fallback ---
{
  const expr = buildVideoExpression("body{a:1}", "file:///x/y.mp4");
  // Default mode must NOT force muted. The auto-fallback (play().catch -> set
  // muted + replay) handles the no-flag case. A bare `v.muted=true;` at top
  // level would force mute unconditionally and defeat the whole feature.
  check("video default: NO unconditional v.muted=true at top", expr.indexOf("v.muted=true;") === -1);
  // The .play() call must be present, and its .catch must re-mute + replay
  // (auto-degrade when flag not effective: AGENTS.md 教训 13/21).
  check("video default: contains .play()", expr.indexOf(".play()") !== -1);
  check("video default: catch path re-mutes", expr.indexOf("v.muted=true") !== -1);
  // The video file URL must survive JSON.stringify intact.
  check("video expr contains the file url", expr.indexOf("file:///x/y.mp4") !== -1);
  // createElement('video') — proves it's a real DOM element, not CSS background.
  check("video expr creates a <video> element", expr.indexOf("createElement('video')") !== -1);
  check("video expr references the video element id", expr.indexOf(VIDEO_EL_ID) !== -1);
}
```

- [ ] **Step 3: 跑 selftest 确认新断言失败（红）**

```bash
node test/selftest.cjs
```

期望：FAIL（`video default: NO unconditional v.muted=true at top` 失败，因为当前代码有 `v.muted=true;`）。

- [ ] **Step 4: 改 inject.cjs buildVideoExpression —— 去强制 muted + 加降级**

`lib/inject.cjs` 第 140-147 行，当前是：

```js
    v.setAttribute('autoplay','');" +
    v.setAttribute('muted','');" +
    v.setAttribute('loop','');" +
    v.setAttribute('playsinline','');" +
    "v.muted=true;" +
    // muted+autoplay is reliable in Chromium/Electron, but call play() too as a
    // belt-and-suspenders (some builds need the explicit call after setAttribute).
    "try{var p=v.play();if(p&&p.catch){p.catch(function(){});}}catch(e){}" +
```

替换为（保留 autoplay/loop/playsinline，去掉 muted attribute 和 `v.muted=true`，play() 加降级）：

```js
    v.setAttribute('autoplay','');" +
    v.setAttribute('loop','');" +
    v.setAttribute('playsinline','');" +
    // Default unmuted: try play(). On success (flag effective) audio plays.
    // On reject (no user gesture, flag not effective) auto-degrade to muted +
    // replay so at least the picture shows. AGENTS.md 教训 13/21: cross-process
    // glue (flag↔Electron↔play() Promise) — unit tests can't cover, 真机验.
    "try{var p=v.play();" +
    "if(p&&p.catch){p.catch(function(){v.muted=true;try{v.play().catch(function(){});}catch(_){}});}}" +
    "catch(e){v.muted=true;try{v.play().catch(function(){});}catch(_){}}" +
```

同时更新函数顶部的注释（`lib/inject.cjs:117-122` 那段）最后一句，把"muted+autoplay is reliable"那段删掉，因为不再是 muted 模式。在第 122 行 `// Returns an IIFE that returns 'ok'...` 之前补一行说明：

```js
// Audio policy (2026-06): default unmuted + play().catch fallback to muted.
// Requires launch-zcode.bat's --autoplay-policy=no-user-gesture-required flag
// for the unmuted path to actually play; without it the catch path re-mutes.
```

- [ ] **Step 5: 跑 selftest 确认通过（绿）**

```bash
node test/selftest.cjs
```

期望：全部 PASS。

- [ ] **Step 6: 改 cdp-mock-test —— 确认视频模式仍被 mock 正确识别**

`test/cdp-mock-test.cjs` 第 141-150 行的视频断言不检查 muted，只检查 `createElement('video')`、`clip.mp4`、不出现 image 的 background-image 规则。这些断言**不受本次改动影响**（我们没动 createElement/src/路由）。但跑一遍确认：

```bash
node test/cdp-mock-test.cjs
```

期望：全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add lib/inject.cjs test/selftest.cjs
git commit -m "feat(video): inject 默认 unmuted + play().catch 自动降级 muted"
```

---

## Task 3: cdp.cjs probeWallpaperMode 顺带返回 videoMuted

**Files:**
- Modify: `lib/cdp.cjs:42-70`（`classifyWallpaperDom` + `probeWallpaperMode`）
- Test: `test/cdptest.cjs:33-38`（classifyWallpaperDom 断言）

- [ ] **Step 1: 改 cdptest.cjs classifyWallpaperDom 断言（红）**

`test/cdptest.cjs` 第 33-38 行，当前是裸字符串断言。替换为对象断言：

```js
// === classifyWallpaperDom (pure) — returns {mode, videoMuted} ===
check("classify: video present -> video", cdp.classifyWallpaperDom({ style: true, video: true, videoSrc: "file://x", bg: "url(x)", videoMuted: true }).mode === "video");
check("classify: video present -> videoMuted passthrough", cdp.classifyWallpaperDom({ style: true, video: true, videoSrc: "file://x", bg: "url(x)", videoMuted: true }).videoMuted === true);
check("classify: video present -> videoMuted false passthrough", cdp.classifyWallpaperDom({ style: true, video: true, videoSrc: "file://x", bg: "url(x)", videoMuted: false }).videoMuted === false);
check("classify: style + bg not none -> image", cdp.classifyWallpaperDom({ style: true, video: false, videoSrc: "", bg: "url(x)", videoMuted: null }).mode === "image");
check("classify: image -> videoMuted null", cdp.classifyWallpaperDom({ style: true, video: false, videoSrc: "", bg: "url(x)", videoMuted: null }).videoMuted === null);
check("classify: no style -> none", cdp.classifyWallpaperDom({ style: false, video: false, videoSrc: "", bg: "none", videoMuted: null }).mode === "none");
check("classify: style but bg none -> none", cdp.classifyWallpaperDom({ style: true, video: false, videoSrc: "", bg: "none", videoMuted: null }).mode === "none");
check("classify: video but no src -> none", cdp.classifyWallpaperDom({ style: false, video: true, videoSrc: "", bg: "none", videoMuted: true }).mode === "none");
check("classify: video but no src -> videoMuted null", cdp.classifyWallpaperDom({ style: false, video: true, videoSrc: "", bg: "none", videoMuted: true }).videoMuted === null);
check("classify: video with src -> video", cdp.classifyWallpaperDom({ style: false, video: true, videoSrc: "file://x", bg: "none", videoMuted: false }).mode === "video");
```

- [ ] **Step 2: 跑 cdptest 确认失败（红）**

```bash
node test/cdptest.cjs
```

期望：FAIL（`classifyWallpaperDom` 当前返回字符串，`.mode` 是 undefined）。

- [ ] **Step 3: 改 cdp.cjs classifyWallpaperDom —— 返回 {mode, videoMuted}**

`lib/cdp.cjs` 第 48-52 行，当前是：

```js
function classifyWallpaperDom(dom) {
  if (dom.video && dom.videoSrc) return "video";
  if (dom.style && dom.bg && dom.bg !== "none") return "image";
  return "none";
}
```

替换为：

```js
// Returns { mode: "video"|"image"|"none", videoMuted: boolean|null }.
// videoMuted is the DOM-truth (dom.videoMuted) when in video mode, null
// otherwise (no video = mute state meaningless). Single source of truth =
// the DOM property; we never mirror it in server memory (防漂移, 教训 1).
function classifyWallpaperDom(dom) {
  if (dom.video && dom.videoSrc) return { mode: "video", videoMuted: dom.videoMuted };
  if (dom.style && dom.bg && dom.bg !== "none") return { mode: "image", videoMuted: null };
  return { mode: "none", videoMuted: null };
}
```

- [ ] **Step 4: 改 cdp.cjs probeWallpaperMode —— DOM 查询加 videoMuted 字段**

`lib/cdp.cjs` 第 56-70 行，当前 `probeWallpaperMode` 的 evaluate 表达式是：

```js
      expression: "(function(){var s=document.getElementById(" + JSON.stringify(PROBE_STYLE_ID) +
        ");var v=document.getElementById(" + JSON.stringify(PROBE_VIDEO_EL_ID) +
        ");return JSON.stringify({style:!!s,video:!!v,videoSrc:v?v.getAttribute('src'):'',bg:getComputedStyle(document.body).backgroundImage});})()",
```

替换为（加 `,videoMuted:v?v.muted:null`）：

```js
      expression: "(function(){var s=document.getElementById(" + JSON.stringify(PROBE_STYLE_ID) +
        ");var v=document.getElementById(" + JSON.stringify(PROBE_VIDEO_EL_ID) +
        ");return JSON.stringify({style:!!s,video:!!v,videoSrc:v?v.getAttribute('src'):'',videoMuted:v?v.muted:null,bg:getComputedStyle(document.body).backgroundImage});})()",
```

`probeWallpaperMode` 的 `return classifyWallpaperDom(dom)` 不用改（classifyWallpaperDom 现在返回对象，probeWallpaperMode 直接透传）。

- [ ] **Step 5: 跑 cdptest 确认通过（绿）**

```bash
node test/cdptest.cjs
```

期望：全部 PASS。

- [ ] **Step 6: 改 status.cjs 调用方 —— 透传 videoMuted 到快照**

`lib/status.cjs` 第 55-66 行 `probeZcodeAndWallpaper`，当前是：

```js
async function probeZcodeAndWallpaper() {
  const pages = await cdp.listTargets();   // filtered (excludes tool pages)
  let mode = "none";
  for (const t of pages) {
    try { const m = await cdp.probeWallpaperMode(t); if (m !== "none") { mode = m; break; } }
    catch (e) { /* per-target fail, continue */ }
  }
  return {
    zcode: { running: true, pid: null, debugPort: cdp.PORT, pageTargets: pages.length },
    wallpaper: { mode, injectedWindows: mode === "none" ? 0 : pages.length, totalWindows: pages.length, lastInjectAt: null },
  };
}
```

替换为（用 `r.mode`，记录第一个非 none 的 `videoMuted`）：

```js
async function probeZcodeAndWallpaper() {
  const pages = await cdp.listTargets();   // filtered (excludes tool pages)
  let mode = "none", videoMuted = null;
  for (const t of pages) {
    try {
      const r = await cdp.probeWallpaperMode(t);
      if (r.mode !== "none") { mode = r.mode; videoMuted = r.videoMuted; break; }
    } catch (e) { /* per-target fail, continue */ }
  }
  return {
    zcode: { running: true, pid: null, debugPort: cdp.PORT, pageTargets: pages.length },
    wallpaper: { mode, videoMuted, injectedWindows: mode === "none" ? 0 : pages.length, totalWindows: pages.length, lastInjectAt: null },
  };
}
```

- [ ] **Step 7: 跑 statustest 确认不崩**

```bash
node test/statustest.cjs
```

期望：全部 PASS（现有断言不检查 wallpaper.videoMuted，但确认 snapshot 仍能跑通）。

- [ ] **Step 8: Commit**

```bash
git add lib/cdp.cjs lib/status.cjs test/cdptest.cjs
git commit -m "feat(video): probeWallpaperMode 顺带返回 videoMuted（零新增 CDP 往返）"
```

---

## Task 4: 新建 lib/video-mute.cjs（实时切静音）

**Files:**
- Create: `lib/video-mute.cjs`
- Create: `test/videomutetest.cjs`

- [ ] **Step 1: 写 test/videomutetest.cjs —— 测 buildMuteExpression 纯函数（红）**

创建 `test/videomutetest.cjs`：

```js
// Test lib/video-mute.cjs pure helpers (spec §4.4).
const vm = require("../lib/video-mute.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// === buildMuteExpression(videoElId, muted) ===
const VID_ID = "zcode-user-wallpaper-video";

// mute = true
var exprMute = vm.buildMuteExpression(VID_ID, true);
check("mute expr: IIFE wrapper", /^\(function\(\)\{.*\}\)\(\)$/.test(exprMute));
check("mute expr: references video el id", exprMute.indexOf(VID_ID) !== -1);
check("mute expr: sets v.muted=true", exprMute.indexOf("v.muted=true") !== -1);
check("mute expr: NO v.muted=false", exprMute.indexOf("v.muted=false") === -1);
check("mute expr: returns JSON with found flag", exprMute.indexOf("found:") !== -1);
check("mute expr: returns muted in JSON", exprMute.indexOf("muted:v.muted") !== -1);

// mute = false
var exprUnmute = vm.buildMuteExpression(VID_ID, false);
check("unmute expr: sets v.muted=false", exprUnmute.indexOf("v.muted=false") !== -1);
check("unmute expr: NO v.muted=true", exprUnmute.indexOf("v.muted=true") === -1);

// falsy truthy 转换（muted ? "true" : "false"）
check("buildMuteExpression: 0 -> false", vm.buildMuteExpression(VID_ID, 0).indexOf("v.muted=false") !== -1);
check("buildMuteExpression: 1 -> true", vm.buildMuteExpression(VID_ID, 1).indexOf("v.muted=true") !== -1);
check("buildMuteExpression: '' -> false", vm.buildMuteExpression(VID_ID, "").indexOf("v.muted=false") !== -1);

// VIDEO_EL_ID 常量镜像 inject.cjs（防漂移，单测钉死字面量）
check("VIDEO_EL_ID mirrors inject.cjs canonical", vm.VIDEO_EL_ID === "zcode-user-wallpaper-video");

// === 执行表达式 against fake DOM（验 found:true 路径）===
function makeFakeDom(hasVideo, initialMuted) {
  var video = hasVideo ? { id: VID_ID, muted: initialMuted } : null;
  return {
    document: {
      getElementById: function (id) { return id === VID_ID ? video : null; }
    }
  };
}
// mute a currently-unmuted video
(function () {
  var dom = makeFakeDom(true, false);
  var fn = new Function("document", "return " + vm.buildMuteExpression(VID_ID, true));
  var r = JSON.parse(fn(dom.document));
  check("exec mute: found true when video exists", r.found === true);
  check("exec mute: video.muted flipped to true", dom.document.getElementById(VID_ID).muted === true);
  check("exec mute: returned muted:true", r.muted === true);
})();
// unmute a currently-muted video
(function () {
  var dom = makeFakeDom(true, true);
  var fn = new Function("document", "return " + vm.buildMuteExpression(VID_ID, false));
  var r = JSON.parse(fn(dom.document));
  check("exec unmute: video.muted flipped to false", dom.document.getElementById(VID_ID).muted === false);
  check("exec unmute: returned muted:false", r.muted === false);
})();
// no video element -> found:false
(function () {
  var dom = makeFakeDom(false, null);
  var fn = new Function("document", "return " + vm.buildMuteExpression(VID_ID, true));
  var r = JSON.parse(fn(dom.document));
  check("exec mute: found false when no video", r.found === false);
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: 跑 videomutetest 确认失败（红）**

```bash
node test/videomutetest.cjs
```

期望：FAIL（`require("../lib/video-mute.cjs")` 找不到模块）。

- [ ] **Step 3: 创建 lib/video-mute.cjs**

创建 `lib/video-mute.cjs`：

```js
// Real-time video wallpaper mute toggle (spec §4.4).
// WHY a separate module (not in cdp.cjs): cdp.cjs is READ-ONLY by design
// (AGENTS.md: filterTargets/listTargets/connect/probeWallpaperMode). Mute
// toggle is a WRITE op (changes video.muted). Keeping it out of cdp.cjs
// preserves the read-only invariant. But this module REUSES cdp.connect +
// cdp.listTargets (neutral plumbing) — no duplicated CDP glue (教训 1).
//
// Single source of truth for "is muted": the DOM video.muted property itself.
// We never mirror it in server memory — status reads it via cdp.cjs probe,
// mute/unmute writes it here. Two copies = drift (教训 1).

// Mirror inject.cjs VIDEO_EL_ID (canonical owner). Kept in sync manually like
// cdp.cjs's PROBE_VIDEO_EL_ID; pinned by videomutetest.cjs string assertion.
const VIDEO_EL_ID = "zcode-user-wallpaper-video";

// Pure: build the evaluate expression that flips video.muted and reports back.
// Returns a JSON string {found:bool, muted:bool} so the caller can count
// affected windows. `muted` is coerced via ternary (true/false literal only).
function buildMuteExpression(videoElId, muted) {
  return "(function(){var v=document.getElementById(" + JSON.stringify(videoElId) +
    ");if(!v)return JSON.stringify({found:false});v.muted=" + (muted ? "true" : "false") +
    ";return JSON.stringify({found:true,muted:v.muted});})()";
}

// Effectful: iterate all page targets, flip video.muted on each that has one.
// Per-target connect/evaluate failure is non-fatal (skip, continue) — mirrors
// status.cjs probeZcodeAndWallpaper's per-target tolerance.
// Returns { affected, total, lastMuted }.
async function setVideoMuted(muted) {
  const cdp = require("./cdp.cjs");
  const targets = await cdp.listTargets();
  let affected = 0;
  let lastMuted = null;
  for (const t of targets) {
    let ws;
    try {
      const connected = await cdp.connect(t.webSocketDebuggerUrl);
      ws = connected.ws;
      const call = connected.call;
      const r = await call("Runtime.evaluate", {
        expression: buildMuteExpression(VIDEO_EL_ID, muted),
        returnByValue: true,
      });
      const obj = JSON.parse(r.result.value);
      if (obj.found) { affected++; lastMuted = obj.muted; }
    } catch (e) {
      // per-target fail, continue (don't let one bad window abort the rest)
    } finally {
      if (ws) { try { ws.close(); } catch (e) {} }
    }
  }
  return { affected: affected, total: targets.length, lastMuted: lastMuted };
}

module.exports = { buildMuteExpression, setVideoMuted, VIDEO_EL_ID };
```

- [ ] **Step 4: 跑 videomutetest 确认通过（绿）**

```bash
node test/videomutetest.cjs
```

期望：全部 PASS。

- [ ] **Step 5: 把 videomutetest 加进 package.json test 串**

`package.json` 第 22 行的 `"test":` 字段，在 `node test/bookmarktest.cjs"` 之前加 `node test/videomutetest.cjs && `。

改后（注意 `&&` 连接）：

```
"test": "node test/selftest.cjs && node test/cdp-mock-test.cjs && node test/cdp-retry-test.cjs && node test/cdptest.cjs && node test/setuptest.cjs && node test/resizetest.cjs && node test/probetest.cjs && node test/menutest.cjs && node test/transparenttest.cjs && node test/readertoctest.cjs && node test/readercodetest.cjs && node test/readercodetestweb.cjs && node test/readertocwebtest.cjs && node test/readerprogresstest.cjs && node test/readerservertest.cjs && node test/bookroutertest.cjs && node test/rotatetest.cjs && node test/statustest.cjs && node test/controlservertest.cjs && node test/statusviewtest.cjs && node test/shelftest.cjs && node test/videomutetest.cjs && node test/bookmarktest.cjs"
```

- [ ] **Step 6: 跑 npm test 确认全绿**

```bash
npm test
```

期望：全部测试 PASS（含新增 videomutetest）。

- [ ] **Step 7: Commit**

```bash
git add lib/video-mute.cjs test/videomutetest.cjs package.json
git commit -m "feat(video): 新建 video-mute.cjs 实时切静音（复用 cdp.connect，不污染只读定位）"
```

---

## Task 5: control-server.cjs 加 muteVideo/unmuteVideo action

**Files:**
- Modify: `lib/control-server.cjs:216-271`（`/api/action` 分支）
- Test: `test/controlservertest.cjs`

- [ ] **Step 1: 改 controlservertest.cjs —— 加 mute/unmute action 断言（红）**

`test/controlservertest.cjs` 第 83 行附近（`stopRotate after video start -> 200` 之后，`cleanup any .rotate.json` 之前），加：

```js
    // === video mute/unmute actions (spec §4.5) ===
    // 测试环境无 ZCode on 9222，video-mute.setVideoMuted 会因 listTargets 失败抛错，
    // server 应转成 {accepted:false} 而非 500（对齐 status "探查失败不致命" 哲学）。
    const muteRes = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "muteVideo" }));
    check("muteVideo -> 200 (not 500)", muteRes.status === 200);
    var muteJson = JSON.parse(muteRes.body);
    check("muteVideo -> has accepted field", typeof muteJson.accepted === "boolean");
    check("muteVideo -> accepted false when CDP down (test env)", muteJson.accepted === false);

    const unmuteRes = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "unmuteVideo" }));
    check("unmuteVideo -> 200 (not 500)", unmuteRes.status === 200);
    var unmuteJson = JSON.parse(unmuteRes.body);
    check("unmuteVideo -> has accepted field", typeof unmuteJson.accepted === "boolean");
    check("unmuteVideo -> accepted false when CDP down (test env)", unmuteJson.accepted === false);
```

- [ ] **Step 2: 跑 controlservertest 确认失败（红）**

```bash
node test/controlservertest.cjs
```

期望：FAIL（`muteVideo` 当前走 `buildSpawnArgs` 返回 null → 400，不是 200）。

- [ ] **Step 3: 改 control-server.cjs —— 加 mute/unmute 特殊 action 分支**

`lib/control-server.cjs` 第 222 行附近（`if (req2.action === "stopRotate")` 块之后，`if (req2.action === "startRotateImage" || ...)` 之前），插入新分支。找到：

```js
          // stopRotate: kill child (or pid fallback), no spawn (spec §6.2)
          if (req2.action === "stopRotate") {
            stopRotateNow();
            return sendJson(res, 200, { accepted: true });
          }
```

在它之后加：

```js
          // muteVideo/unmuteVideo: instant CDP write, no spawn/jobId (spec §4.5).
          // Test env has no ZCode -> setVideoMuted throws -> {accepted:false},
          // not 500 (aligns with status "探查失败不致命" philosophy).
          if (req2.action === "muteVideo" || req2.action === "unmuteVideo") {
            const videoMute = require("./video-mute.cjs");
            try {
              const r = await videoMute.setVideoMuted(req2.action === "muteVideo");
              return sendJson(res, 200, { accepted: true, affected: r.affected, total: r.total, muted: r.lastMuted });
            } catch (e) {
              return sendJson(res, 200, { accepted: false, error: e.message });
            }
          }
```

- [ ] **Step 4: 跑 controlservertest 确认通过（绿）**

```bash
node test/controlservertest.cjs
```

期望：全部 PASS。

- [ ] **Step 5: 跑 npm test 确认全绿**

```bash
npm test
```

期望：全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add lib/control-server.cjs test/controlservertest.cjs
git commit -m "feat(video): control-server 加 muteVideo/unmuteVideo 即时 action"
```

---

## Task 6: 控制中心前端加声音按钮

**Files:**
- Modify: `control/index.html`（`#actions` 面板）
- Modify: `control/control.js`（poll + click 处理）
- Modify: `control/lib/status-view.js`（状态条显示有声/静音）
- Test: `test/statusviewtest.cjs`

- [ ] **Step 1: 改 statusviewtest.cjs —— 加 videoMuted 显示断言（红）**

`test/statusviewtest.cjs` 用 `const sv = require("../control/lib/status-view.js")` + `sv.renderStatus(...)`（纯 Node，无 `window`）。在文件末尾的 `console.log("\n"...` 之前，加（沿用同样的 `sv.renderStatus` 调用模式）：

```js
// === video wallpaper audio state display (spec §4.6) ===
// video mode + unmuted -> shows 🔊 有声
var stV = {
  zcode: { running: true, debugPort: 9222, pageTargets: 1 },
  wallpaper: { mode: "video", videoMuted: false, injectedWindows: 1, totalWindows: 1 },
  transparent: { enabled: false }, reader: { running: true, port: 17890 },
  resources: { images: 0, thumbs: 0, videos: 1, novels: 0, deps: { sharp: true } },
  rotate: { running: false }, _meta: { probeErrors: [] },
};
var htmlV = sv.renderStatus(stV);
check("status-view: video unmuted shows 🔊 有声", htmlV.indexOf("🔊 有声") !== -1);
// video mode + muted -> shows 🔇 静音
var stM = JSON.parse(JSON.stringify(stV));
stM.wallpaper.videoMuted = true;
var htmlM = sv.renderStatus(stM);
check("status-view: video muted shows 🔇 静音", htmlM.indexOf("🔇 静音") !== -1);
check("status-view: video muted does NOT show 🔊 有声", htmlM.indexOf("🔊 有声") === -1);
// image mode -> no audio marker
var stI = JSON.parse(JSON.stringify(stV));
stI.wallpaper.mode = "image";
stI.wallpaper.videoMuted = null;
var htmlI = sv.renderStatus(stI);
check("status-view: image mode no audio marker", htmlI.indexOf("🔊 有声") === -1 && htmlI.indexOf("🔇 静音") === -1);
```

- [ ] **Step 2: 跑 statusviewtest 确认失败（红）**

```bash
node test/statusviewtest.cjs
```

期望：FAIL（当前 status-view.js 不渲染 🔊/🔇）。

- [ ] **Step 3: 改 control/lib/status-view.js —— video 模式加有声/静音标注**

`control/lib/status-view.js` 第 13-18 行，当前是：

```js
  var wHtml;
  if (w && w.mode && w.mode !== "none") {
    wHtml = esc(w.mode === "video" ? "视频壁纸" : "图片壁纸") + ' | 注入 ' + esc(w.injectedWindows) + '/' + esc(w.totalWindows);
  } else {
    wHtml = '<span class="muted">未注入</span>';
  }
```

替换为：

```js
  var wHtml;
  if (w && w.mode && w.mode !== "none") {
    wHtml = esc(w.mode === "video" ? "视频壁纸" : "图片壁纸") + ' | 注入 ' + esc(w.injectedWindows) + '/' + esc(w.totalWindows);
    // video mode: show audio state from DOM-truth videoMuted (spec §4.6)
    if (w.mode === "video") {
      wHtml += w.videoMuted ? ' | 🔇 静音' : ' | 🔊 有声';
    }
  } else {
    wHtml = '<span class="muted">未注入</span>';
  }
```

- [ ] **Step 4: 跑 statusviewtest 确认通过（绿）**

```bash
node test/statusviewtest.cjs
```

期望：全部 PASS。

- [ ] **Step 5: 改 control/index.html —— 加声音按钮**

`control/index.html` 第 12-13 行，当前是：

```html
    <button data-action="injectImage">注入图片壁纸</button>
    <button data-action="injectVideo">注入视频壁纸</button>
    <button data-action="remove">移除壁纸</button>
```

在 `injectVideo` 按钮之后、`remove` 之前加两个按钮：

```html
    <button data-action="injectImage">注入图片壁纸</button>
    <button data-action="injectVideo">注入视频壁纸</button>
    <button data-action="muteVideo">🔇 静音</button>
    <button data-action="unmuteVideo">🔊 取消静音</button>
    <button data-action="remove">移除壁纸</button>
```

- [ ] **Step 6: 改 control/control.js —— poll 里根据 videoMuted 切按钮 disabled**

`control/control.js` 第 20-22 行，当前是：

```js
      var cdpOk = !!(st.zcode && st.zcode.running);
      var cdpBtns = document.querySelectorAll('[data-action="injectImage"],[data-action="injectVideo"],[data-action="remove"]');
      for (var i = 0; i < cdpBtns.length; i++) cdpBtns[i].disabled = !cdpOk;
```

替换为（CDP 按钮逻辑不变，加 mute/unmute 按钮的状态逻辑）：

```js
      var cdpOk = !!(st.zcode && st.zcode.running);
      var cdpBtns = document.querySelectorAll('[data-action="injectImage"],[data-action="injectVideo"],[data-action="remove"]');
      for (var i = 0; i < cdpBtns.length; i++) cdpBtns[i].disabled = !cdpOk;
      // mute/unmute buttons: only meaningful in video mode (spec §4.6).
      // videoMuted === null (not video mode) -> both disabled.
      // videoMuted === true  -> mute disabled, unmute enabled (CDP permitting).
      // videoMuted === false -> mute enabled, unmute disabled.
      var w = st.wallpaper || {};
      var inVideo = (w.mode === "video");
      var muted = (w.videoMuted === true);
      var muteBtn = document.querySelector('[data-action="muteVideo"]');
      var unmuteBtn = document.querySelector('[data-action="unmuteVideo"]');
      if (muteBtn) muteBtn.disabled = !cdpOk || !inVideo || muted;
      if (unmuteBtn) unmuteBtn.disabled = !cdpOk || !inVideo || !muted;
```

- [ ] **Step 7: 改 control/control.js —— click 处理（mute/unmute 走 dispatchAction）**

`control/control.js` 第 40-61 行的 actions click 处理，当前 `data-action` 的 switch/if 只识别 `setTransparent` / `startRotate`。muteVideo/unmuteVideo 不需要特殊 params，直接走默认 `params = {}` 分支即可（dispatchAction 会把它们 POST 给 server）。

**确认现有代码的 `else { params = {}; }` 分支**（第 53-54 行）已经覆盖 muteVideo/unmuteVideo——它们会以 `params={}` 进 dispatchAction。**无需改 click 处理逻辑**。

但要确认 `dispatchAction` 成功后会刷新 poll。看第 56-60 行：

```js
    dispatchAction(finalAction, params).then(function (res) {
      if (res.status === 409) setJobMsg("忙，请等当前动作完成");
      else if (!res.json.accepted) setJobMsg("拒绝: " + (res.json.error || ""));
      else { setJobMsg("已提交 (" + res.json.jobId + ")"); setTimeout(poll, 500); }
    })
```

问题：mute/unmute action 的响应**没有 jobId**（即时返回，spec §4.5）。`res.json.jobId` 会是 undefined，`"已提交 (undefined)"` 不好看。改这行让它对 mute/unmute 友好：

替换第 58 行为：

```js
      else if (!res.json.accepted) setJobMsg("拒绝: " + (res.json.error || ""));
      else {
        // mute/unmute return {accepted, affected, muted} not {jobId}; show a
        // sensible message for both shapes.
        if (res.json.jobId) setJobMsg("已提交 (" + res.json.jobId + ")");
        else if (typeof res.json.muted === "boolean") setJobMsg(res.json.muted ? "已静音（" + res.json.affected + "/" + res.json.total + " 窗口）" : "已取消静音（" + res.json.affected + "/" + res.json.total + " 窗口）");
        else setJobMsg("已提交");
        setTimeout(poll, 500);
      }
```

- [ ] **Step 8: 跑 npm test 确认全绿**

```bash
npm test
```

期望：全部 PASS（statusviewtest 含新断言）。

- [ ] **Step 9: Commit**

```bash
git add control/index.html control/control.js control/lib/status-view.js test/statusviewtest.cjs
git commit -m "feat(video): 控制中心加声音按钮 + 状态显示有声/静音"
```

---

## Task 7: 真机端到端验证（GATE —— 必须全过）

> AGENTS.md 教训 12/13/21：跨进程胶水单测验不全。Task 0-6 全绿不等于功能跑得通。
> 这一步是最后一道闸，每条都要真机操作确认。

**Files:** 无（只人眼/耳验）

- [ ] **Step 1: 完全退出 ZCode**

所有窗口 + 右下角托盘图标都关掉。

- [ ] **Step 2: 启动控制中心**

双击 `start.vbs`（无 cmd 黑窗）。它会停旧 server + 带 flag 重启 ZCode + 后台起 control-server。

- [ ] **Step 3: 在 ZCode 浏览器面板打开控制中心**

粘 `http://127.0.0.1:17890/control/` 回车。控制中心页面出来。

- [ ] **Step 4: 验证清单第 1 条 —— flag 生效（视频壁纸默认有声）**

控制中心点"注入视频壁纸"。等 1-2 秒。

**判断**：
- ✅ 看到视频画面 + **听到声音** → 通过。
- ❌ 看到画面但**没声音** → flag 没生效（Task 0 应该已经验过，但代码改动后可能回归）。**停下来排查**：检查 launch-zcode.bat 的 flag 是否还在、ZCode 是否真的被重启了（看 zcode-launch.log）。

- [ ] **Step 5: 验证清单第 3 条 —— 实时切静音（不闪屏）**

控制中心点"🔇 静音"。

**判断**：
- ✅ **瞬间无声**，视频画面**没有闪/重新加载** → 通过。
- ❌ 声音没变 / 画面闪了一下 → 实时切没生效，查 video-mute.cjs 的 setVideoMuted 是否真连上了 page target（控制台看 affected 数量）。

然后点"🔊 取消静音"。

**判断**：
- ✅ **瞬间有声**，画面不闪 → 通过。

- [ ] **Step 6: 验证清单第 4 条 —— 状态显示同步**

点静音后，等最多 2 秒（轮询周期）。看状态条的"视频壁纸"那行。

**判断**：
- ✅ 显示"视频壁纸 | 注入 1/1 | 🔇 静音" → 通过。
- 点取消静音后 2 秒内变成"🔊 有声" → 通过。

- [ ] **Step 7: 验证清单第 5 条 —— 非视频模式按钮禁用**

控制中心点"移除壁纸"。等 1-2 秒。

**判断**：
- ✅ 状态条显示"未注入"，🔇 和 🔊 按钮**都变灰 disabled** → 通过。

然后点"注入图片壁纸"（不是视频）。

**判断**：
- ✅ 状态条显示"图片壁纸"（无有声/静音标注），🔇 和 🔊 按钮**都灰** → 通过。

- [ ] **Step 8: 验证清单第 6 条 —— flag 不破坏透明链路**

完全退出 ZCode。双击 `wallpaper.bat`，选 `9 启动带透明窗口`，输个透明度（如 50）。

**判断**：
- ✅ ZCode 启动，窗口变半透明（能看到桌面），**没有因 flag 报错** → 通过（flag 对透明无副作用，只是个 autoplay 策略开关）。

- [ ] **Step 9: 验证清单第 7 条 —— inject 后声音重置**

回到控制中心场景（Step 2-4 重新来）。点"🔇 静音"确认无声。然后点"注入视频壁纸"（换一个视频）。

**判断**：
- ✅ 新视频**默认有声**（mute 状态不跨 inject 持久化，spec §4.5/§6 设计决定）→ 通过。

- [ ] **Step 10: 全部通过 → Commit 验证记录（可选）**

如果以上 9 条全过，功能完成。可以选择把验证结果记在 commit message 里：

```bash
git commit --allow-empty -m "chore: 视频壁纸加声音 真机验证全过（flag/实时切/状态/禁用/透明/inject重置）"
```

---

## Task 8: 文档同步

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: README.md「视频壁纸」章节补"默认有声"+ flag 说明**

`README.md` 第 73-99 行的"3. 视频壁纸（可选）"章节，在第 76-78 行"原理和图片不同..."那段之后，加一小节：

```markdown
### 声音（默认有声 + 实时切静音）

视频壁纸**默认有声**（不再强制静音）。原理：启动 ZCode 时带 Chromium 的
`--autoplay-policy=no-user-gesture-required` flag（`launch-zcode.bat` 自动加），
让 unmuted 视频能免"用户手势"自动播放。

- **想静音**：去控制中心点"🔇 静音"（实时切，视频不闪屏）。
- **想恢复声音**：点"🔊 取消静音"。
- **直接双击开的 ZCode（没带 flag）**：视频壁纸会自动降级成静音（保证至少有画面），
  这种场景下"取消静音"按钮无效（unmuted 视频本来就播不了）。用控制中心的前提是
  ZCode 带 debug port 启动（= 走 launch-zcode.bat = 带 flag），正常使用不会遇到这个边界。
```

- [ ] **Step 2: README.md「控制中心 能做什么」补声音按钮**

`README.md` 第 215 行附近"动作按钮"那行，把"注入视频壁纸"后面加"+ 静音/取消静音"：

当前：
```
- **动作按钮**：注入图片壁纸 / 注入视频壁纸 / 移除壁纸 / 设透明（输 0-100）/ 重新缩图 / 重装依赖
```

改为：
```
- **动作按钮**：注入图片壁纸 / 注入视频壁纸 / 🔇 静音 / 🔊 取消静音 / 移除壁纸 / 设透明（输 0-100）/ 重新缩图 / 重装依赖
```

- [ ] **Step 3: README.md 文件表加 video-mute.cjs**

`README.md` 第 270-289 行的文件表，在 `lib/inject.cjs` 行之后加一行：

```
| `lib/video-mute.cjs` | 🆕 实时切视频壁纸静音（遍历 page targets 改 `video.muted`，复用 `cdp.connect` 但不污染只读定位） |
```

- [ ] **Step 4: AGENTS.md「视频壁纸」章节补音频机制**

AGENTS.md 的"## 视频壁纸（`--video` 模式）"章节，在"### 为什么不能复用图片的 CSS background-image"小节之后（或合适位置），加一个小节：

```markdown
### 默认有声 + 自动降级 muted（2026-06）

视频壁纸**默认有声**。`buildVideoExpression`（`lib/inject.cjs`）不再强制 `muted`：
创建 `<video>` 后直接 `play()`，`then` 成功就保持有声；`catch` 失败（Chromium autoplay
策略拒绝 unmuted 自动播放）回退 `muted=true` + `play()` 重播，**保证至少有画面**。

让 unmuted 视频能免"用户手势"自动播放靠启动 flag：`bin/launch-zcode.bat` Step 2 的
`ProcessStartInfo.Arguments` 带 `--autoplay-policy=no-user-gesture-required`。**只改这一处**，
三条启动链（start-zcode / start-transparent / start.bat）都带上（根除重复，教训 1 二次事故）。

> ⚠️ **假设必须真机验**（教训 21）：Electron 是否透传这个 flag、ZCode 是否用 `webPreferences`
> 覆盖——不能靠常识判断。实施时第一步就是探测验证（spec §5.2 真机清单第 1 条）。万一
> flag 不生效，"默认有声"目标无法达成，得回退方案 B（用户手势路线，另开 spec）。

### 实时切静音（lib/video-mute.cjs）

开会/录屏想静音，不重建 video 元素（不闪屏）。控制中心点"🔇 静音"/"🔊 取消静音" →
server `/api/action muteVideo/unmuteVideo` → `lib/video-mute.cjs` 的 `setVideoMuted(muted)`
遍历 page targets，对每个调 CDP `Runtime.evaluate` 改 `video.muted` 属性。

**为什么独立模块不在 cdp.cjs**：cdp.cjs 是**只读模块**（AGENTS.md 明确，
`filterTargets/listTargets/connect/probeWallpaperMode`）。实时切是**写操作**，塞进去
破坏只读定位。但 `cdp.connect`/`cdp.listTargets` 是中性工具（连接+列举），video-mute.cjs
**复用它们**而非重写 CDP 胶水（教训 1：复用连接逻辑，不是复用"只读"语义）。

**单一权威**：`video.muted` 是 DOM 真实属性。状态读取（cdp.cjs `probeWallpaperMode`）和
写入（video-mute.cjs `setVideoMuted`）都直接操作 DOM，**不另设 server 内存变量**——
避免两份状态漂移（教训 1 同型）。

**inject 后声音重置**：mute 后换视频（重新 inject）会变回有声。因为 inject 会重建 video
元素，新元素按 §"默认有声"机制 unmuted 试播。mute 状态不跨 inject 持久化（不做 localStorage
偏好，YAGNI——声音是临时状态，不像书架/书签是用户数据）。
```

- [ ] **Step 5: AGENTS.md 测试章节补 videomutetest**

AGENTS.md 的"## 测试"章节（`npm test` 跑那一段），在测试列表里加 `videomutetest`。
找到当前列表（`...controlservertest → statusviewtest → shelftest → bookmarktest`），
在 `bookmarktest` 之前加 `videomutetest`：

```
... → statusviewtest → shelftest → videomutetest → bookmarktest。
```

并在下面补一段说明（参照 `bookmarktest.cjs` 那段的风格）：

```markdown
`videomutetest.cjs` 测 `lib/video-mute.cjs` 的纯函数 `buildMuteExpression(videoElId, muted)`：
mute/unmute 两个方向的表达式正确性（含 `v.muted=true/false`、IIFE 包裹、JSON 返回）、
truthy/falsy 转换、`VIDEO_EL_ID` 常量镜像 inject.cjs（防漂移）。执行表达式 against fake DOM
验 `found:true/false` 路径。`setVideoMuted` 的 CDP 遍历靠真机验（教训 12/13：跨进程胶水）。
```

- [ ] **Step 6: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: 同步视频壁纸加声音（默认有声 + 实时切静音）"
```

---

## 完成标准

- [ ] Task 0 真机 gate 通过（flag 生效）
- [ ] Task 1-6 代码 + 单测全绿（`npm test`）
- [ ] Task 7 真机验证 9 条全过
- [ ] Task 8 文档同步
- [ ] 所有 commit 已提交
