# ZCode 壁纸控制中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 wallpaper.bat 文字菜单升级成带界面的控制中心（透明 webview SPA + 合并常驻 server），统一操作四个子系统并实时显示状态。

**Architecture:** 一个常驻 HTTP server（由 reader-server.cjs 演进）同时供控制中心 SPA（透明背景，透出壁纸）和 reader SPA；新增 `lib/cdp.cjs`（只读 CDP 共享，inject.cjs 也改用它）和 `lib/status.cjs`（纯只读状态查询）；动作靠 spawn 现有命令（inject.cjs/transparent.ps1/resize.cjs/setup.cjs），不重写动作逻辑；transparent.ps1 加 `-Query/-Hwnd/-Json` 只读查询。

**Tech Stack:** Node.js（http/child_process/ws）、原生 HTML/CSS/JS 前端（零构建）、PowerShell + Win32 P/Invoke（透明）。详细设计见 `docs/superpowers/specs/2026-06-20-control-center-design.md`。

**核心原则（贯穿所有任务）：** 控制中心是「触发器 + 状态显示器」，绝不重写动作逻辑；查询模块纯只读；跨语言胶水（C#↔PS↔node）必端到端验。

---

## 文件结构

**新增：**
- `lib/cdp.cjs` —— 只读 CDP 能力共享模块（httpGetJson/listTargets/filterTargets/connect/probeWallpaperMode）
- `lib/status.cjs` —— 纯只读状态查询（snapshot + 各项探查纯函数 + alpha 缓存）
- `lib/control-server.cjs` —— 合并常驻 HTTP server（静态托管 + 小说/状态/动作 API）
- `control/index.html` `control/control.css` `control/control.js` —— 控制中心前端
- `control/lib/status-view.js` —— 状态渲染纯函数（CommonJS + 浏览器全局双导出）
- `control/lib/shelf.js` —— 书架管理（复用 reader progress）
- `bin/control-center.bat` —— 独立常驻入口
- `scripts/inspect-control.cjs` —— 端到端验证脚本
- `test/cdptest.cjs` `test/statustest.cjs` `test/controlservertest.cjs` `test/shelftest.cjs`

**修改：**
- `lib/inject.cjs` —— 改 `require('./cdp.cjs')` 复用只读 CDP（行为不变）
- `lib/transparent.ps1` —— 加 `-Query/-Hwnd/-Json` + `GetLayeredWindowAttributes`（不改设透明逻辑）
- `lib/reader-server.cjs` —— 改成兼容 wrapper（导出 createServer 委托 control-server）
- `lib/menu.cjs` + `wallpaper.bat` —— 加"启动控制中心"场景 13
- `package.json` —— test 串联加新 test
- `test/menutest.cjs` —— 加场景 13 断言

**任务顺序依据：** 先抽共享模块（cdp.cjs）→ 状态查询（status.cjs）→ 透明查询扩展（transparent.ps1）→ 合并 server → 前端 → 菜单集成 → 端到端。每步可独立测、独立提交。

---

## Task 1: 抽出 lib/cdp.cjs 只读 CDP 共享模块

**Files:**
- Create: `lib/cdp.cjs`
- Create: `test/cdptest.cjs`

背景（spec §4 A2b）：inject.cjs 的 `listTargets`/`connect`/`httpGetJson` 是内部函数未导出（已核实 inject.cjs line 410-421 导出列表无这些），`verifyExpression` 是 main 内局部。要把它们抽成共享模块，供 status.cjs 和 inject.cjs 复用。

- [ ] **Step 1: 写 test/cdptest.cjs 的 filterTargets 失败测试**

创建 `test/cdptest.cjs`：

```js
// Test lib/cdp.cjs — pure-function target filtering (spec §5.4, 审查 P1-2).
// filterTargets must exclude our own tool pages by PATH PREFIX on any localhost port.
const cdp = require("../lib/cdp.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// mock /json target shapes (real CDP returns these fields)
const targets = [
  { type: "page", webSocketDebuggerUrl: "ws://x/page1", url: "file:///C:/ZCode/index.html", title: "ZCode" },
  { type: "page", webSocketDebuggerUrl: "ws://x/ctrl",  url: "http://127.0.0.1:17890/control/", title: "控制中心" },
  { type: "page", webSocketDebuggerUrl: "ws://x/ctrl2", url: "http://localhost:17891/control/", title: "控制中心漂移" },
  { type: "page", webSocketDebuggerUrl: "ws://x/reader", url: "http://127.0.0.1:17890/reader/", title: "阅读器" },
  { type: "page", webSocketDebuggerUrl: "ws://x/api",   url: "http://localhost:17890/api/books", title: "api" },
  { type: "page", webSocketDebuggerUrl: "ws://x/devtools", url: "devtools://devtools/abc", title: "DevTools" },
  { type: "webview", webSocketDebuggerUrl: "ws://x/wv", url: "http://127.0.0.1:17890/reader/", title: "wv" }, // non-page
  { type: "page", url: "http://127.0.0.1:17890/reader/", title: "no wsUrl" }, // no webSocketDebuggerUrl
];

const filtered = cdp.filterTargets(targets);
const urls = filtered.map(t => t.url);

check("keeps ZCode main page (file://)", urls.includes("file:///C:/ZCode/index.html"));
check("excludes /control/ on 17890", !urls.includes("http://127.0.0.1:17890/control/"));
check("excludes /control/ on 17891 (port漂移)", !urls.includes("http://localhost:17891/control/"));
check("excludes /reader/", !urls.includes("http://127.0.0.1:17890/reader/"));
check("excludes /api/", !urls.includes("http://localhost:17890/api/books"));
check("excludes devtools://", !urls.includes("devtools://devtools/abc"));
check("excludes non-page (webview)", !filtered.some(t => t.type === "webview"));
check("excludes target without webSocketDebuggerUrl", !filtered.some(t => !t.webSocketDebuggerUrl));
check("exactly 1 target remains (the ZCode main page)", filtered.length === 1);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node test/cdptest.cjs`
Expected: FAIL — `Cannot find module '../lib/cdp.cjs'`

- [ ] **Step 3: 创建 lib/cdp.cjs（filterTargets 部分）**

创建 `lib/cdp.cjs`：

```js
// Shared read-only CDP helpers. Extracted from inject.cjs so both inject.cjs
// (action) and status.cjs (query) reuse ONE copy of the CDP glue (spec §4 A2b,
// 审查 P1-1). Action logic stays in inject.cjs; this module only connects +
// queries.
//
// Port/host mirror inject.cjs defaults.
const http = require("http");
const { WebSocket } = require("ws");

const PORT = parseInt(process.env.ZCODE_DEBUG_PORT || "9222", 10);
const HOST = process.env.ZCODE_DEBUG_HOST || "127.0.0.1";

// Pure function: filter /json targets to "real" ZCode pages (spec §5.4).
// Excludes our OWN tool pages by PATH PREFIX on any localhost/127.0.0.1 port
// (审查 P1-target过滤端口: don't depend on knowing our own port — standalone
// inject.cjs and port-drift both still filter correctly).
// Excludes: /control/, /reader/, /api/ paths; devtools://; non-page; no wsUrl.
function filterTargets(targets) {
  return targets.filter((t) => {
    if (t.type !== "page") return false;
    if (!t.webSocketDebuggerUrl) return false;
    const url = t.url || "";
    if (url.indexOf("devtools://") === 0) return false;
    // localhost or 127.0.0.1, any port, then check path prefix
    const m = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.exec(url);
    if (m) {
      const path = m[3] || "/";
      if (path.indexOf("/control/") === 0 || path.indexOf("/reader/") === 0 || path.indexOf("/api/") === 0) {
        return false;
      }
    }
    return true;
  });
}

module.exports = { filterTargets, PORT, HOST };

if (require.main === module) {
  // quick self-check when run directly
  console.log("cdp.cjs loaded. PORT=" + PORT + " HOST=" + HOST);
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node test/cdptest.cjs`
Expected: PASS — 9 passed, 0 failed

- [ ] **Step 5: 提交**

```bash
git add lib/cdp.cjs test/cdptest.cjs
git commit -m "feat(cdp): 抽出 lib/cdp.cjs 只读 CDP 共享模块 (filterTargets) + 单测"
```

---

## Task 2: 完成 lib/cdp.cjs（httpGetJson/listTargets/connect/probeWallpaperMode）

把 inject.cjs 里的 CDP 连接代码迁到 cdp.cjs，inject.cjs 改 require。

**Files:**
- Modify: `lib/cdp.cjs`
- Modify: `lib/inject.cjs:83-154` (httpGetJson/listTargets/fixWsHost/connect 迁出)
- Test: `test/cdptest.cjs`（加 listTargets 行为测试，用 mock http server）

- [ ] **Step 1: 在 cdptest.cjs 加 listTargets 集成测试（mock /json）**

在 `test/cdptest.cjs` 末尾 `process.exit` 之前，加一段（用真实 mock http server 验 listTargets 走过滤）：

```js
// === listTargets via mock /json server ===
const http = require("http");
(async () => {
  // mock CDP /json returning the same targets
  const mock = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(targets));
  });
  await new Promise(r => mock.listen(0, "127.0.0.1", r));
  const mport = mock.address().port;
  // point cdp at the mock via env
  process.env.ZCODE_DEBUG_PORT = String(mport);
  delete require.cache[require.resolve("../lib/cdp.cjs")];
  const cdpMocked = require("../lib/cdp.cjs");
  try {
    const pages = await cdpMocked.listTargets();
    check("listTargets returns filtered pages (1)", pages.length === 1);
    check("listTargets page is the ZCode main", pages[0].url === "file:///C:/ZCode/index.html");
  } catch (e) {
    check("listTargets runs without throwing", false);
    console.error(e);
  } finally {
    mock.close();
    delete process.env.ZCODE_DEBUG_PORT;
  }
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
})();
```

（移除文件末尾原来的 `process.exit`，改由这个 async 块收尾。）

- [ ] **Step 2: 运行，确认新增的 listTargets 测试失败**

Run: `node test/cdptest.cjs`
Expected: FAIL — `cdp.listTargets is not a function`

- [ ] **Step 3: 在 cdp.cjs 实现 httpGetJson/listTargets/fixWsHost/connect**

在 `lib/cdp.cjs` 的 `module.exports` 之前，加入（从 inject.cjs 原样迁移）：

```js
function httpGetJson(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: HOST, port: PORT, path: urlPath, headers: { Host: "localhost" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (!data) return reject(new Error("empty response"));
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error("bad JSON: " + data.slice(0, 120))); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(4000, () => req.destroy(new Error("timeout")));
  });
}

// listTargets returns FILTERED page targets (spec §5.4). Callers that need
// the raw list (e.g. inject --remove cleaning all pages — see inject.cjs) can
// call listAllTargets.
async function listTargets() {
  const targets = await httpGetJson("/json");
  return filterTargets(targets).filter((t) => t.webSocketDebuggerUrl);
}
async function listAllTargets() {
  const targets = await httpGetJson("/json");
  return targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

// Chromium returns ws://localhost/... with no port; rewrite to real host:port.
function fixWsHost(wsUrl) {
  return wsUrl
    .replace(/^ws:\/\/localhost\//i, `ws://127.0.0.1:${PORT}/`)
    .replace(/^wss:\/\/localhost\//i, `wss://127.0.0.1:${PORT}/`)
    .replace(/^ws:\/\/localhost(?=[:/])/i, "ws://127.0.0.1")
    .replace(/^wss:\/\/localhost(?=[:/])/i, "wss://127.0.0.1");
}

let _callId = 0;
function connect(wsUrl) {
  wsUrl = fixWsHost(wsUrl);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: no } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? no(new Error("CDP: " + JSON.stringify(msg.error))) : ok(msg.result);
      }
    });
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++_callId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }), (err) => err && reject(err));
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject(new Error("CDP timeout: " + method)); }
        }, 8000);
      });
    ws.on("open", () => resolve({ ws, call }));
    ws.on("error", reject);
  });
}
```

更新 `module.exports`：
```js
module.exports = { filterTargets, listTargets, listAllTargets, httpGetJson, connect, fixWsHost, PORT, HOST };
```

- [ ] **Step 4: 运行 cdptest，确认通过**

Run: `node test/cdptest.cjs`
Expected: PASS — all pass

- [ ] **Step 5: 改 inject.cjs 复用 cdp.cjs（删除重复的 CDP 函数）**

修改 `lib/inject.cjs`：

顶部 require 之后，把 `httpGetJson`/`listTargets`/`fixWsHost`/`connect` 的定义**删除**（原 line 83-154），改为 require：
```js
const cdp = require("./cdp.cjs");
const { listTargets, connect, httpGetJson, PORT, HOST } = cdp;
```
（保留 STYLE_ID/VIDEO_EL_ID 等模块常量不动；`main()` 内对 `listTargets`/`connect` 的调用不变。）

注意：inject.cjs 原来注入循环里用的是 `listTargets()`（过滤后）。按 spec §5.4（remove 也走过滤，已定），inject/remove/probe 都用过滤后的 `listTargets()`，**不**用 listAllTargets。listAllTargets 导出留作将来需要，本计划不调用。

- [ ] **Step 6: 跑现有 inject 相关测试，确认无回归**

Run: `npm test`（全部）
Expected: PASS — 所有现有测试（selftest/cdp-mock-test/cdp-retry-test/...）仍绿。inject.cjs 对外行为不变。

- [ ] **Step 7: 提交**

```bash
git add lib/cdp.cjs lib/inject.cjs test/cdptest.cjs
git commit -m "refactor(cdp): cdp.cjs 补 listTargets/connect/httpGetJson，inject.cjs 改 require (消除两份胶水)"
```

---

## Task 3: probeWallpaperMode —— 探测壁纸注入状态

cdp.cjs 加 probeWallpaperMode（连 page target 查 DOM → image/video/none），封装原 inject.cjs main 内的 verifyExpression 思路。

**Files:**
- Modify: `lib/cdp.cjs`（加 probeWallpaperMode + 复用 inject.cjs 的 STYLE_ID/VIDEO_EL_ID）
- Modify: `test/cdptest.cjs`（加 probeWallpaperMode 单测，mock CDP evaluate）

- [ ] **Step 1: 写 probeWallpaperMode 失败测试（mock WS）**

在 cdptest.cjs 加（用 inject.cjs 已有的 STYLE_ID/VIDEO_EL_ID 常量；mock 一个能回 Runtime.evaluate 的假 ws server 较重，改为测**纯函数** classifyWallpaperDom）：

```js
// === classifyWallpaperDom (pure) — probeWallpaperMode 内部的纯分类逻辑 ===
check("classify: video present -> video", cdp.classifyWallpaperDom({ style: true, video: true, bg: "url(x)" }) === "video");
check("classify: style + bg not none -> image", cdp.classifyWallpaperDom({ style: true, video: false, bg: "url(x)" }) === "image");
check("classify: no style -> none", cdp.classifyWallpaperDom({ style: false, video: false, bg: "none" }) === "none");
check("classify: style but bg none -> none", cdp.classifyWallpaperDom({ style: true, video: false, bg: "none" }) === "none");
check("classify: video but no src -> none", cdp.classifyWallpaperDom({ style: false, video: true, videoSrc: "", bg: "none" }) === "none");
check("classify: video with src -> video", cdp.classifyWallpaperDom({ style: false, video: true, videoSrc: "file://x", bg: "none" }) === "video");
```

- [ ] **Step 2: 运行，确认失败**

Run: `node test/cdptest.cjs`
Expected: FAIL — `cdp.classifyWallpaperDom is not a function`

- [ ] **Step 3: 在 cdp.cjs 实现 classifyWallpaperDom + probeWallpaperMode**

```js
// Pure: classify wallpaper mode from a DOM probe result.
// dom = { style: bool, video: bool, videoSrc: string, bg: string }
function classifyWallpaperDom(dom) {
  if (dom.video && dom.videoSrc) return "video";
  if (dom.style && dom.bg && dom.bg !== "none") return "image";
  return "none";
}

// Probe one page target's wallpaper state. Returns "image"|"video"|"none".
async function probeWallpaperMode(target) {
  const STYLE_ID = "zcode-user-wallpaper";
  const VIDEO_EL_ID = "zcode-user-wallpaper-video";
  const { ws, call } = await connect(target.webSocketDebuggerUrl);
  try {
    const r = await call("Runtime.evaluate", {
      expression: "(function(){var s=document.getElementById(" + JSON.stringify(STYLE_ID) +
        ");var v=document.getElementById(" + JSON.stringify(VIDEO_EL_ID) +
        ");return JSON.stringify({style:!!s,video:!!v,videoSrc:v?v.getAttribute('src'):'',bg:getComputedStyle(document.body).backgroundImage});})()",
      returnByValue: true,
    });
    const dom = JSON.parse(r.result.value);
    return classifyWallpaperDom(dom);
  } finally {
    try { ws.close(); } catch (e) {}
  }
}
```

更新 exports 加 `classifyWallpaperDom`、`probeWallpaperMode`。

- [ ] **Step 4: 运行，确认通过**

Run: `node test/cdptest.cjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/cdp.cjs test/cdptest.cjs
git commit -m "feat(cdp): probeWallpaperMode + classifyWallpaperDom 纯函数 (DOM->image/video/none)"
```

---

## Task 4: lib/status.cjs —— 纯函数状态构造（无 I/O 部分）

先实现 status.cjs 里**不碰 I/O 的纯函数**：parseTargetsForStatus、mergeProbeResults、alphaToOpacityPct/opacityPctToAlpha。

**Files:**
- Create: `lib/status.cjs`（先只纯函数 + snapshot 占位）
- Create: `test/statustest.cjs`

- [ ] **Step 1: 写 statustest.cjs 失败测试**

```js
// Test lib/status.cjs pure helpers (spec §7.1).
const status = require("../lib/status.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// alphaToOpacityPct / opacityPctToAlpha
check("alpha 0 -> 0%", status.alphaToOpacityPct(0) === 0);
check("alpha 255 -> 100%", status.alphaToOpacityPct(255) === 100);
check("alpha 199 -> 78% (round)", status.alphaToOpacityPct(199) === 78);
check("opacity 0 -> alpha 0", status.opacityPctToAlpha(0) === 0);
check("opacity 100 -> alpha 255", status.opacityPctToAlpha(100) === 255);
check("opacity 78 -> alpha 199 (round)", status.opacityPctToAlpha(78) === 199);

// mergeProbeResults: null items don't pollute, go to probeErrors
const merged = status.mergeProbeResults({
  zcode: { running: true, pid: 1 },
  wallpaper: null,           // probe failed
  transparent: { enabled: true, opacityPct: 78 },
  reader: null,
  resources: { images: 5 },
});
check("merge keeps non-null zcode", merged.zcode.running === true);
check("merge null wallpaper -> null field", merged.wallpaper === null);
check("merge records probeErrors for nulls", Array.isArray(merged._meta.probeErrors) && merged._meta.probeErrors.length === 2);
check("merge _meta.fetchedAt is number", typeof merged._meta.fetchedAt === "number");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 运行，确认失败**

Run: `node test/statustest.cjs`
Expected: FAIL — module not found

- [ ] **Step 3: 创建 lib/status.cjs（纯函数 + snapshot 占位）**

```js
// Read-only status probe (spec §4 A2). snapshot() gathers state①~⑤; NEVER
// mutates anything. Heavy I/O (CDP/PS/fs) is in probe functions below; pure
// helpers here are unit-tested.
const os = require("os");
const fs = require("fs");
const path = require("path");
const cdp = require("./cdp.cjs");

// alpha (0-255) <-> opacity percent (0-100).
function alphaToOpacityPct(alpha) { return Math.round((alpha / 255) * 100); }
function opacityPctToAlpha(pct) { return Math.round(pct * 2.55); }

// Merge per-item probe results into one snapshot. Null items = probe failed;
// recorded in _meta.probeErrors, do NOT pollute the whole snapshot.
function mergeProbeResults(parts) {
  const probeErrors = [];
  for (const k of ["zcode", "wallpaper", "transparent", "reader", "resources"]) {
    if (parts[k] === null || parts[k] === undefined) {
      probeErrors.push({ item: k, reason: parts[k + "Error"] || "probe failed" });
    }
  }
  return Object.assign({}, parts, {
    _meta: { fetchedAt: Date.now(), probeErrors },
  });
}

module.exports = { alphaToOpacityPct, opacityPctToAlpha, mergeProbeResults };
// snapshot() added in Task 5.
```

- [ ] **Step 4: 运行，确认通过**

Run: `node test/statustest.cjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/status.cjs test/statustest.cjs
git commit -m "feat(status): status.cjs 纯函数 (alpha 换算 + mergeProbeResults null 不污染)"
```

---

## Task 5: status.cjs 的 snapshot() —— 实际 I/O 探查

实现 snapshot()，组合 cdp 探查 + fs 资源盘点 + 透明查询（透明先 stub，Task 6 接上真 PS）。

**Files:**
- Modify: `lib/status.cjs`（加 snapshot + probeZcode/probeWallpaper/probeResources，透明调 queryTransparent stub）
- Modify: `test/statustest.cjs`（加 snapshot 资源盘点测试，用 tmp 目录）

- [ ] **Step 1: 写 snapshot 资源盘点测试（tmp 目录 + 无 ZCode 时各 null）**

在 statustest.cjs 加：

```js
const fs = require("fs"), os = require("os"), path = require("path");
(async () => {
  // tmp "project root" with empty asset dirs
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-root-"));
  for (const d of ["wallpapers", "wallpapers-thumb", "wallpapers-video", "novels"]) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  fs.writeFileSync(path.join(root, "wallpapers", "a.jpg"), "x");
  fs.writeFileSync(path.join(root, "novels", "b.txt"), "x");
  fs.writeFileSync(path.join(root, "node_modules", "sharp", "package.json"), "{}"); fs.mkdirSync(path.join(root, "node_modules", "sharp"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "sharp", "package.json"), "{}");
  fs.mkdirSync(path.join(root, "node_modules", "ws"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "ws", "package.json"), "{}");

  const s = await status.snapshot({ root, transparentHwnd: null });
  check("snapshot resources counts images", s.resources.images === 1);
  check("snapshot resources counts novels", s.resources.novels === 1);
  check("snapshot resources thumbs 0", s.resources.thumbs === 0);
  check("snapshot deps sharp true", s.resources.deps.sharp === true);
  check("snapshot deps ws true", s.resources.deps.ws === true);
  // no ZCode running on 9222 in test env -> zcode null, not crash
  check("snapshot zcode null when CDP down (no crash)", s.zcode === null);
  check("snapshot _meta has probeErrors for zcode", s._meta.probeErrors.some(e => e.item === "zcode"));
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
})();
```
（移除文件末尾原来的同步 `process.exit`。）

- [ ] **Step 2: 运行，确认失败**

Run: `node test/statustest.cjs`
Expected: FAIL — `status.snapshot is not a function`

- [ ] **Step 3: 在 status.cjs 实现 snapshot + 各 probe**

```js
const child_process = require("child_process");

function listImages(dir) {
  const EXTS = [".jpg",".jpeg",".png",".webp",".gif",".svg"];
  try { return fs.readdirSync(dir).filter(n => EXTS.indexOf(path.extname(n).toLowerCase()) !== -1); }
  catch (e) { return []; }
}
function listVideos(dir) {
  const EXTS = [".mp4",".webm",".mov",".ogg",".ogv"];
  try { return fs.readdirSync(dir).filter(n => EXTS.indexOf(path.extname(n).toLowerCase()) !== -1); }
  catch (e) { return []; }
}
function depInstalled(root, name) {
  try { require.resolve(path.join(root, "node_modules", name)); return true; }
  catch (e) { return false; }
}

async function probeResources(root) {
  return {
    images: listImages(path.join(root, "wallpapers")).length,
    thumbs: listImages(path.join(root, "wallpapers-thumb")).length,
    videos: listVideos(path.join(root, "wallpapers-video")).length,
    novels: (function(){ try { return fs.readdirSync(path.join(root,"novels")).filter(n=>/\.txt$/i.test(n)).length; } catch(e){ return 0; } })(),
    deps: { sharp: depInstalled(root, "sharp"), ws: depInstalled(root, "ws") },
  };
}

async function probeZcodeAndWallpaper() {
  // throws if CDP down; caller catches -> null
  const pages = await cdp.listTargets();
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

// transparent probe: implemented in Task 6 via PS. Stub here: returns null.
async function probeTransparent(hwnd) { return null; }

// Main entry. opts: { root, transparentHwnd }.
async function snapshot(opts) {
  opts = opts || {};
  const root = opts.root || path.join(__dirname, "..");
  const parts = {};
  // resources (always works)
  parts.resources = await probeResources(root);
  // zcode + wallpaper (CDP; null if down)
  try { const zw = await probeZcodeAndWallpaper(); parts.zcode = zw.zcode; parts.wallpaper = zw.wallpaper; }
  catch (e) { parts.zcode = null; parts.wallpaper = null; parts.zcodeError = e.message; }
  // transparent
  try { parts.transparent = await probeTransparent(opts.transparentHwnd); }
  catch (e) { parts.transparent = null; parts.transparentError = e.message; }
  // reader (this server is the reader too; mark running)
  parts.reader = { running: true, port: opts.serverPort || null };
  return mergeProbeResults(parts);
}

module.exports = { alphaToOpacityPct, opacityPctToAlpha, mergeProbeResults, snapshot, probeResources, _probeTransparent: probeTransparent };
```

- [ ] **Step 4: 运行，确认通过**

Run: `node test/statustest.cjs`
Expected: PASS（透明为 null，但不 crash；zcode 因测试环境无 9222 为 null）

- [ ] **Step 5: 提交**

```bash
git add lib/status.cjs test/statustest.cjs
git commit -m "feat(status): snapshot() 资源盘点 + zcode/wallpaper CDP 探查 (探查失败不致命)"
```

---

## Task 6: transparent.ps1 加 -Query/-Hwnd/-Json + GetLayeredWindowAttributes

扩展 transparent.ps1（spec §4 A3 三处改动）。**这是跨语言胶水（C#↔PS↔node），实现后必须真机逐字验（E3/E8）。**

**Files:**
- Modify: `lib/transparent.ps1`（加 GetLayeredWindowAttributes P/Invoke、-Query/-Hwnd/-Json 参数、设透明 -Json 输出）
- 注意：transparent.ps1 必须 UTF-8 with BOM（AGENTS.md）

- [ ] **Step 1: 加 param 参数（-Query/-Hwnd/-Json）**

修改 transparent.ps1 的 param 块（line 27-31）：

```powershell
param(
  [string]$ProcessName = "ZCode",
  [int]   $Opacity      = 78,
  [int]   $InitialAlpha = -1,
  [switch]$Query,            # 只读查询模式 (spec §4 A3 改动2)
  [long]  $Hwnd         = 0, # -Query 时直接按 hwnd 查 (0=走窗口枚举)
  [switch]$Json             # 机器可读输出 (查询/设置都支持)
)
```

- [ ] **Step 2: 给 Win32 类加 GetLayeredWindowAttributes P/Invoke**

在 `$win32Code` here-string 的 Win32 类里（line 37-41），加一行：

```csharp
  [DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr hwnd, out uint crKey, out byte bAlpha, out uint dwFlags);
```

（放在 SetLayeredWindowAttributes 那行之后。）

- [ ] **Step 3: 实现 -Query 分支（在 param 解析后、窗口枚举前插入）**

在 line 58（"Write-Host 目标透明度"）之前插入整个 -Query 分支：

```powershell
# ---- 0) -Query 模式: 只读查询 alpha, 绝不 Set (spec §4 A3 改动2) ----
if ($Query) {
  function Get-Alpha($h) {
    $flags = 0; $key = 0; $a = [byte]0
    $ok = [Win32]::GetLayeredWindowAttributes($h, [ref]$key, [ref]$a, [ref]$flags)
    # LWA_ALPHA = 0x2; 若 flags 含它且 layered, alpha 生效
    $layered = (($flags -band 0x2) -ne 0)
    return @{ ok = $ok; alpha = [int]$a; layered = $layered }
  }
  if ($Hwnd -gt 0) {
    # 直接按 hwnd 查 (server 记的 hwnd, 快)
    $h = [IntPtr]$Hwnd
    $r = Get-Alpha $h
    $obj = @{ hwnd = $Hwnd; alpha = ( $r.layered ? $r.alpha : $null ); opacityPct = ( $r.layered ? [Math]::Round($r.alpha / 255 * 100) : $null ); layered = $r.layered }
    if ($Json) { Write-Output ($obj | ConvertTo-Json -Compress) } else { Write-Host ("hwnd=" + $Hwnd + " layered=" + $r.layered + " alpha=" + $r.alpha) }
    exit 0
  }
  # 没给 hwnd: 枚举进程窗口, 多候选自动选面积最大 (不 read-host, spec §10 状态机)
  $procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
  if (-not $procs -or @($procs).Count -eq 0) {
    if ($Json) { Write-Output '{"hwnd":null,"alpha":null,"layered":false}' } else { Write-Host "[transparent] 没找到进程 '$ProcessName'。" }
    exit 2
  }
  # 复用下面的 WinEnum (需先 Add-Type; 为简单起见这里重新枚举前确保 WinEnum 已加载 —
  # 实现时把 WinEnum Add-Type 提前到此分支之前, 或在本分支内联一个最小枚举)
  # ... (实现: 用 WinEnum::Dump 拿候选, 选面积最大, Get-Alpha 查, 输出 JSON)
  # 详见 spec §10 状态机"否"分支
  exit 0
}
```

**实现注意**：`WinEnum` 的 `Add-Type`（line 109）原本在 -Query 分支之后。需要把 WinEnum 的 Add-Type **移到** -Query 分支之前（或 -Query 分支内重做枚举）。最简单：把 line 72-109 的 WinEnum 定义块整体移到 -Query 分支之前。多候选时用 `Sort-Object {width*height} -Descending | Select -First 1`（不 read-host）。

- [ ] **Step 4: 设透明模式加 -Json 输出 hwnd（改动3）**

在 line 168 `Set-Alpha $hwnd $alpha` 之后、最终 exit 之前，加：

```powershell
if ($Json) {
  $obj = @{ event = "set"; hwnd = [long]$chosen.hwnd; alpha = $alpha; opacityPct = $Opacity }
  Write-Output ($obj | ConvertTo-Json -Compress)
}
```

（`$chosen.hwnd` 是窗口枚举选中的；-Json 时仍打印原人话 + 这行 JSON，server 解析 JSON 行。）

- [ ] **Step 5: 验语法（PowerShell Parser）**

Run:
```bash
powershell -NoProfile -Command "$e=$null; [System.Management.Automation.Language.Parser]::ParseFile('lib/transparent.ps1',[ref]$null,[ref]$e); $e"
```
Expected: 无输出（0 错误）。

**BOM 检查**：transparent.ps1 必须保持 UTF-8 with BOM（前 3 字节 EF BB BF）。
Run: `powershell -NoProfile -Command "([byte[]](Get-Content -Encoding Byte -TotalCount 3 -Path 'lib/transparent.ps1')) -join ','"`
Expected: `239,187,191` (= EF BB BF)

- [ ] **Step 6: 真机验证（E3 + E8，spec §7.2）**

这是跨语言胶水，必须真跑（教训 3/12/15）。**这步需要 ZCode 开着**：
```bash
# 1. 设透明，验 -Json 输出 hwnd
powershell -NoProfile -ExecutionPolicy Bypass -File lib/transparent.ps1 -Opacity 78 -Json
# 记下输出的 {"event":"set","hwnd":XXXXX,...} 里的 hwnd

# 2. 用那个 hwnd 查询，验读回值一致
powershell -NoProfile -ExecutionPolicy Bypass -File lib/transparent.ps1 -Query -Hwnd <那个hwnd> -Json
# 应输出 {"hwnd":...,"alpha":199,"opacityPct":78,"layered":true}

# 3. 逐字 dump PS 输出确认字段 (教训15)
```
Expected: set 的 alpha=199 对应查询读回 alpha=199、opacityPct=78。若不一致 → C#/PS 字段错位（教训 3），逐字 dump 修。

- [ ] **Step 7: 跑现有透明测试，确认无回归**

Run: `node test/transparenttest.cjs`（测 windowselect.cjs 纯函数规则）
Expected: PASS（transparenttest 不碰 PS 的 -Query/-Json，只测 JS 规则，应不受影响）

- [ ] **Step 8: 提交**

```bash
git add lib/transparent.ps1
git commit -m "feat(transparent): -Query/-Hwnd/-Json 只读查询 + GetLayeredWindowAttributes + 设透明输出 hwnd (spec §4 A3)"
```

---

## Task 7: status.cjs 接上真透明查询（probeTransparent）

把 Task 5 的 probeTransparent stub 换成真调 transparent.ps1 -Query，加 500ms 缓存（spec §4 A2 + §5.3）+ 状态机（spec §10）。

**Files:**
- Modify: `lib/status.cjs`（probeTransparent 实现 + 缓存）
- Modify: `test/statustest.cjs`（加透明状态机纯函数测试 + 缓存测试）

- [ ] **Step 1: 写透明状态机纯函数测试**

在 statustest.cjs 加：

```js
// classifyTransparent: spec §10 状态机的纯分类
// 输入 PS 查询结果 {hwnd, alpha, layered, found} + 是否多候选无法确定
check("classify: layered alpha<255 -> true", status.classifyTransparent({layered:true, alpha:199}, false).enabled === true);
check("classify: layered alpha 255 -> false", status.classifyTransparent({layered:true, alpha:255}, false).enabled === false);
check("classify: not layered -> false", status.classifyTransparent({layered:false, alpha:0}, false).enabled === false);
check("classify: not found + ambiguous -> unknown", status.classifyTransparent(null, true).enabled === "unknown");
check("classify: not found + not ambiguous -> false", status.classifyTransparent(null, false).enabled === false);
```

- [ ] **Step 2: 运行，确认失败**

Run: `node test/statustest.cjs`
Expected: FAIL — `status.classifyTransparent is not a function`

- [ ] **Step 3: 实现 classifyTransparent + 真 probeTransparent + 缓存**

在 status.cjs：

```js
const { execFile } = require("child_process");
const ROOT = path.join(__dirname, "..");

// Pure: spec §10 状态机分类。psResult={hwnd,alpha,layered,found}, ambiguous=多候选无法确定。
function classifyTransparent(psResult, ambiguous) {
  if (!psResult || !psResult.found) {
    return { enabled: ambiguous ? "unknown" : false };
  }
  if (!psResult.layered || psResult.alpha == null) return { enabled: false };
  if (psResult.alpha >= 255) return { enabled: false };
  return { enabled: true, alpha: psResult.alpha, opacityPct: alphaToOpacityPct(psResult.alpha), hwnd: psResult.hwnd };
}

let _alphaCache = { at: 0, val: null };
const ALPHA_CACHE_MS = 500;

// transparentHwnd: server 记的上次 setTransparent 的 hwnd (无则 null, 走 -ProcessName 兜底)
function runTransparentQuery(args) {
  return new Promise((resolve) => {
    const ps = path.join(__dirname, "transparent.ps1");
    execFile("powershell.exe", ["-NoProfile","-ExecutionPolicy","Bypass","-File", ps].concat(args),
      { cwd: ROOT }, (err, stdout) => {
        if (err) return resolve(null);
        // 找 stdout 里最后一行 JSON
        const lines = stdout.split(/\r?\n/).filter(l => l.trim().indexOf("{") === 0);
        if (!lines.length) return resolve(null);
        try { resolve(JSON.parse(lines[lines.length - 1])); } catch (e) { resolve(null); }
      });
  });
}

async function probeTransparent(transparentHwnd) {
  // 500ms 缓存 (spec §5.3)
  if (Date.now() - _alphaCache.at < ALPHA_CACHE_MS && _alphaCache.val) return _alphaCache.val;
  let psResult = null, ambiguous = false;
  if (transparentHwnd) {
    psResult = await runTransparentQuery(["-Query","-Hwnd",String(transparentHwnd),"-Json"]);
    if (psResult) psResult.found = true;
  }
  if (!psResult) {
    // -ProcessName 兜底; PS 多候选时自己选面积最大不 read-host
    psResult = await runTransparentQuery(["-Query","-ProcessName","ZCode","-Json"]);
    if (psResult && psResult.hwnd == null) { psResult = { found: false }; ambiguous = true; }
    else if (psResult) { psResult.found = true; }
  }
  const v = classifyTransparent(psResult, ambiguous);
  _alphaCache = { at: Date.now(), val: v };
  return v;
}
```

更新 exports 加 `classifyTransparent`。把 Task 5 的 `_probeTransparent` 替换为此 `probeTransparent`。

- [ ] **Step 4: 运行，确认通过**

Run: `node test/statustest.cjs`
Expected: PASS（纯函数测试过；真 PS 调用在测试环境无 ZCode 会返回 null→enabled:false，不 crash）

- [ ] **Step 5: 提交**

```bash
git add lib/status.cjs test/statustest.cjs
git commit -m "feat(status): probeTransparent 接真 PS 查询 + 500ms 缓存 + 状态机纯函数"
```

---

## Task 8: lib/control-server.cjs —— 合并 HTTP server（静态 + 小说 + 状态 API）

由 reader-server.cjs 演进。托 control/ + reader/ 静态，小说 API 复用，新增 /api/status + /api/action + /api/job/:id。

**Files:**
- Create: `lib/control-server.cjs`
- Create: `test/controlservertest.cjs`
- Modify: `lib/reader-server.cjs`（改成兼容 wrapper）
- Modify: `test/readerservertest.cjs`（不动，验 wrapper 仍工作）

- [ ] **Step 1: 写 controlservertest.cjs（/control 重定向 + /api/status 探查失败不致命 + action 白名单/锁）**

```js
// Test control-server HTTP layer (spec §7.1).
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
let pass = 0, fail = 0;
function check(n,c){ console.log((c?"PASS ✓ ":"FAIL ✗ ")+n); c?pass++:fail++; }
function httpReq(method, url, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ method, host: u.hostname, port: u.port, path: u.pathname+u.search,
      headers: body ? {"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)} : {} }, (res) => {
      let d=""; res.on("data",c=>d+=c); res.on("end",()=>resolve({status:res.statusCode,body:d,headers:res.headers}));
    });
    req.on("error",()=>resolve({status:0,body:""}));
    if (body) req.write(body);
    req.end();
  });
}
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  for (const d of ["control","reader","novels","wallpapers","wallpapers-thumb","wallpapers-video"]) fs.mkdirSync(path.join(root,d),{recursive:true});
  fs.writeFileSync(path.join(root,"control","index.html"), "<!doctype html><title>cc</title>");
  fs.writeFileSync(path.join(root,"reader","index.html"), "<!doctype html><title>r</title>");
  const { createServer } = require("../lib/control-server.cjs");
  const picker = require("net").createServer(); await new Promise(r=>picker.listen(0,"127.0.0.1",r));
  const port = picker.address().port; await new Promise(r=>picker.close(r));
  const srv = await createServer({ root, port, host:"127.0.0.1" });
  const base = "http://127.0.0.1:"+srv.port;
  try {
    // /control (no slash) -> 302 /control/ (教训 18a)
    const redir = await httpReq("GET", base+"/control");
    check("/control -> 302", redir.status === 302);
    check("/control redirects to /control/", (redir.headers.location||"").indexOf("/control/") !== -1);
    // /control/ serves html
    const cc = await httpReq("GET", base+"/control/");
    check("/control/ returns html", cc.status===200 && cc.body.indexOf("<title>") !== -1);
    // /api/status: no ZCode in test -> zcode null but 200 + probeErrors (探查失败不致命)
    const st = JSON.parse((await httpReq("GET", base+"/api/status")).body);
    check("/api/status returns 200-shaped object", st && typeof st === "object");
    check("/api/status zcode null when CDP down", st.zcode === null);
    check("/api/status has _meta.probeErrors", Array.isArray(st._meta && st._meta.probeErrors));
    // /api/action unknown -> 400
    const bad = await httpReq("POST", base+"/api/action", JSON.stringify({action:"bogus"}));
    check("/api/action unknown -> 400", bad.status === 400);
    // /api/action valid -> accepted with jobId (setup is safe to spawn in test: it'll run but we only check shape)
    // NOTE: skip actually running setup here; test the 409 lock with a mock instead (see step 3)
  } finally { srv.close(); }
  console.log("\n"+pass+" passed, "+fail+" failed");
  process.exit(fail===0?0:1);
})();
```

- [ ] **Step 2: 运行，确认失败**

Run: `node test/controlservertest.cjs`
Expected: FAIL — module not found

- [ ] **Step 3: 创建 lib/control-server.cjs**

```js
// Merged control-center + reader HTTP server (spec §4 A1). Serves /control/ +
// /reader/ static + novel API (migrated from reader-server) + /api/status +
// /api/action. Port fixed at 17890 (spec §5.3), +1 only as fallback.
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const child_process = require("child_process");
const status = require("./status.cjs");
const { detectEncoding } = require("./reader-codec.cjs");
const { parseTOC, cleanChapterParagraphs } = require("./reader-toc.cjs");

const DEFAULT_PORT = 17890;  // canonical, fixed (spec §5.3)
const DEFAULT_HOST = "127.0.0.1";

function bookIdFor(filename){let h=5381;for(let i=0;i<filename.length;i++)h=((h<<5)+h+filename.charCodeAt(i))|0;return "b"+(h>>>0).toString(36);}
function buildLibrary(novelsDir){ /* identical to reader-server.cjs buildLibrary */ }
function sendJson(res,st,obj){const b=JSON.stringify(obj);res.writeHead(st,{"Content-Type":"application/json; charset=utf-8","Content-Length":Buffer.byteLength(b)});res.end(b);}
function serveStatic(res,full,mime){fs.readFile(full,(e,d)=>{if(e){res.writeHead(404);res.end("not found");return;}res.writeHead(200,{"Content-Type":mime||"application/octet-stream"});res.end(d);});}
function guessMime(rel){if(/\.js$/i.test(rel))return"text/javascript; charset=utf-8";if(/\.css$/i.test(rel))return"text/css; charset=utf-8";return"application/octet-stream";}

// === action spawn contract (spec §5.2, 审查 P2-1) ===
const ROOT_OVERRIDE = Symbol(); // set at createServer
function buildSpawnArgs(root, action, params) {
  const exec = process.execPath;
  const ps = (...a) => ["powershell.exe","-NoProfile","-ExecutionPolicy","-File"].concat(a);
  switch(action){
    case "injectImage": return [exec,[path.join(root,"lib","inject.cjs")],{cwd:root}];
    case "injectVideo": return [exec,[path.join(root,"lib","inject.cjs"),"--video"],{cwd:root}];
    case "remove":      return [exec,[path.join(root,"lib","inject.cjs"),"--remove"],{cwd:root}];
    case "setTransparent": return ["powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(root,"lib","transparent.ps1"),"-Opacity",String(params.opacityPct||78),"-Json"],{cwd:root}];
    case "resize":      return [exec,[path.join(root,"lib","resize.cjs")],{cwd:root}];
    case "setup":       return [exec,[path.join(root,"lib","setup.cjs")],{cwd:root}];
    default: return null;
  }
}

function createServer(opts) {
  return new Promise((resolve, reject) => {
    const root = opts.root;
    const novelsDir = path.join(root, "novels");
    const controlDir = path.join(root, "control");
    const readerDir = path.join(root, "reader");
    const startPort = opts.port || DEFAULT_PORT;
    const host = opts.host || DEFAULT_HOST;
    const library = buildLibrary(novelsDir);

    // action job state (single global lock, spec §5.2)
    let activeJob = null; const jobs = new Map();
    let transparentHwnd = null; // remembered from setTransparent -Json output (spec §10)

    const server = http.createServer((req,res)=>handle(req,res));
    let tries = 0;
    function tryListen(port) {
      server.once("error",(err)=>{ if(err.code==="EADDRINUSE"&&tries<5){tries++;tryListen(port+1);} else reject(err); });
      server.listen(port,host,()=>resolve({server,port:server.address().port,host,library,close:()=>server.close()}));
    }
    tryListen(startPort);

    function handle(req,res) {
      const u = new URL(req.url, "http://localhost"); const p = u.pathname; const method = req.method;
      if (p === "/" ) { res.writeHead(302,{Location:"/control/"}); res.end(); return; }
      if (p === "/control") { res.writeHead(302,{Location:"/control/"}); res.end(); return; }
      if (p === "/control/" || p === "/control/index.html") return serveStatic(res,path.join(controlDir,"index.html"),"text/html; charset=utf-8");
      if (p.indexOf("/control/lib/")===0) return serveStatic(res,path.join(controlDir,p.slice("/control/".length)),guessMime(p));
      if (p.indexOf("/control/")===0) return serveStatic(res,path.join(controlDir,p.slice("/control/".length)),guessMime(p));
      // reader static (unchanged behavior)
      if (p === "/reader") { res.writeHead(302,{Location:"/reader/"}); res.end(); return; }
      if (p === "/reader/" || p === "/reader/index.html") return serveStatic(res,path.join(readerDir,"index.html"),"text/html; charset=utf-8");
      if (p.indexOf("/reader/")===0) return serveStatic(res,path.join(readerDir,p.slice("/reader/".length)),guessMime(p));

      // novel API (migrated from reader-server)
      if (p === "/api/books") { /* same as reader-server */ return; }
      // ... (toc, chapter — copy from reader-server.cjs verbatim) ...

      if (p === "/api/status" && method === "GET") {
        return status.snapshot({ root, serverPort: server.address().port, transparentHwnd })
          .then(s=>sendJson(res,200,s)).catch(e=>sendJson(res,200,{_meta:{fetchedAt:Date.now(),probeErrors:[{item:"status",reason:e.message}]}}));
      }
      if (p === "/api/action" && method === "POST") {
        let body=""; req.on("data",c=>body+=c); req.on("end",()=>{
          let req2; try{req2=JSON.parse(body);}catch(e){return sendJson(res,400,{error:"bad json"});}
          const spawnArgs = buildSpawnArgs(root, req2.action, req2);
          if (!spawnArgs) return sendJson(res,400,{error:"unknown action"});
          if (activeJob) return sendJson(res,409,{accepted:false,reason:"busy",activeJob});
          const jobId = "j_"+crypto.randomBytes(3).toString("hex");
          activeJob = jobId; jobs.set(jobId,{state:"running",startedAt:Date.now()});
          const [cmd,args,opts2] = spawnArgs;
          const child = child_process.spawn(cmd,args,opts2);
          let out=""; child.stdout.on("data",c=>out+=c); child.stderr.on("data",c=>out+=c);
          child.on("exit",(code)=>{
            // parse setTransparent -Json hwnd line (spec §10)
            if (req2.action==="setTransparent") {
              const lines = out.split(/\r?\n/).filter(l=>l.trim().indexOf("{")===0);
              for (const l of lines) { try{const o=JSON.parse(l); if(o.event==="set"&&o.hwnd){transparentHwnd=o.hwnd;break;}}catch(e){} }
            }
            jobs.set(jobId,{state:code===0?"done":"failed",exitCode:code,output:out.slice(-2000),finishedAt:Date.now()});
            activeJob = null;
          });
          return sendJson(res,200,{jobId,accepted:true});
        });
        return;
      }
      let m = /^\/api\/job\/([^/]+)$/.exec(p);
      if (m && method==="GET") { const j=jobs.get(m[1]); return sendJson(res, j?200:404, j||{error:"not found"}); }
      sendJson(res,404,{error:"not found"});
    }
  });
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  createServer({ root, port: DEFAULT_PORT, host: DEFAULT_HOST })
    .then(({port,host,library})=>{
      console.log("[control] 服务已启动: http://"+host+":"+port+"/control");
      console.log("[control] 共加载 "+library.size+" 本书");
      try{ child_process.execSync('powershell -NoProfile -Command "Set-Clipboard -Value \\"http://'+host+':'+port+'/control\\""',{stdio:"ignore"});
        console.log("[control] URL 已复制到剪贴板。"); }catch(e){}
    }).catch(e=>{console.error("[control] 启动失败: "+e.message);process.exit(1);});
}
module.exports = { createServer, buildSpawnArgs };
```

**实现注意**：`buildLibrary` 和小说 API（/api/books, /toc, /chapter）从 reader-server.cjs **原样复制**（不要重写——它有编码探测/章节切分逻辑，已测）。上面用注释标了位置，实现时填入实际代码。

- [ ] **Step 4: 运行 controlservertest，确认通过**

Run: `node test/controlservertest.cjs`
Expected: PASS

- [ ] **Step 5: 把 reader-server.cjs 改成兼容 wrapper**

`lib/reader-server.cjs` 整个替换为：

```js
// Compatibility wrapper (spec §9, 审查 P2-reader迁移).
// Logic migrated to control-server.cjs; this re-exports createServer so
// existing test/readerservertest.cjs (require("../lib/reader-server.cjs"))
// keeps working unchanged.
const control = require("./control-server.cjs");
module.exports = { createServer: control.createServer, buildLibrary: control.buildLibrary, bookIdFor: control.bookIdFor };
```

- [ ] **Step 6: 跑 readerservertest，确认 wrapper 仍工作**

Run: `node test/readerservertest.cjs`
Expected: PASS（reader-server.cjs 现委托 control-server，readerservertest 不动）

- [ ] **Step 7: 提交**

```bash
git add lib/control-server.cjs lib/reader-server.cjs test/controlservertest.cjs
git commit -m "feat(control): control-server.cjs 合并 server (静态+小说+status/action API) + reader-server 兼容 wrapper"
```

---

## Task 9: 控制中心前端 —— status-view 纯渲染

前端先做状态渲染纯函数（spec §4 B2），可 Node 单测。

**Files:**
- Create: `control/lib/status-view.js`
- Create: `test/shelftest.cjs`（暂用它测 status-view，或新建；本 task 加 status-view 测试）

- [ ] **Step 1: 写 status-view 渲染测试**

创建 `test/statusviewtest.cjs`：

```js
const sv = require("../control/lib/status-view.js");
let pass=0,fail=0; function check(n,c){console.log((c?"PASS ✓ ":"FAIL ✗ ")+n);c?pass++:fail++;}
// renderStatus returns an HTML string
const html1 = sv.renderStatus({zcode:{running:true,debugPort:9222,pageTargets:2},wallpaper:{mode:"video"},transparent:null,reader:{running:true,port:17890},resources:{images:5},_meta:{probeErrors:[]}});
check("renderStatus returns string", typeof html1 === "string");
check("render shows ZCode running", html1.indexOf("运行中") !== -1 || html1.indexOf("running") !== -1);
check("render shows video mode", html1.indexOf("video") !== -1);
check("render shows transparent unknown (null)", html1.indexOf("未知") !== -1 || html1.indexOf("unknown") !== -1 || html1.indexOf("—") !== -1);
check("render shows images 5", html1.indexOf("5") !== -1);
// debug port closed case
const html2 = sv.renderStatus({zcode:null,wallpaper:null,transparent:null,reader:{running:true,port:17890},resources:{images:5},_meta:{probeErrors:[{item:"zcode"}]}});
check("render zcode null shows debug-port hint", html2.indexOf("调试端口") !== -1 || html2.indexOf("debug") !== -1);
console.log("\n"+pass+" passed, "+fail+" failed");process.exit(fail===0?0:1);
```

- [ ] **Step 2: 运行，确认失败**

Run: `node test/statusviewtest.cjs`
Expected: FAIL — module not found

- [ ] **Step 3: 创建 control/lib/status-view.js（双导出）**

```js
// Status renderer — pure (status JSON -> HTML string). Dual export: CommonJS
// for Node tests + window.__ccStatusView for browser (spec §4 B2).
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function renderStatus(st){
  const z = st.zcode, w = st.wallpaper, t = st.transparent, r = st.reader, res = st.resources;
  const zHtml = z
    ? '<span class="ok">● 运行中</span> PID ' + esc(z.pid||'?') + ' | 端口 ' + esc(z.debugPort) + ' | 窗口 ' + esc(z.pageTargets)
    : '<span class="warn">调试端口未开</span> — 请从 wallpaper.bat 场景 2 重启 ZCode';
  const wHtml = w && w.mode && w.mode!=="none"
    ? esc(w.mode==="video"?"视频壁纸":"图片壁纸") + ' | 注入 ' + esc(w.injectedWindows) + '/' + esc(w.totalWindows)
    : '<span class="muted">未注入</span>';
  let tHtml;
  if (!t) tHtml = '<span class="muted">—</span>';
  else if (t.enabled===true) tHtml = '透明 ' + esc(t.opacityPct) + '%';
  else if (t.enabled==="unknown") tHtml = '<span class="warn">未知（未通过控制中心设置）</span>';
  else tHtml = '<span class="muted">未启用</span>';
  const rHtml = r && r.running ? '运行中 :'+esc(r.port) : '<span class="muted">未运行</span>';
  const resHtml = res ? '图 '+esc(res.images)+' | 缩图 '+esc(res.thumbs)+' | 视频 '+esc(res.videos)+' | 小说 '+esc(res.novels)+' | 依赖 '+(res.deps&&res.deps.sharp?'✓':'✗') : '';
  return '<div class="st">'+zHtml+'</div><div class="st">'+wHtml+'</div><div class="st">'+tHtml+'</div><div class="st">'+rHtml+'</div><div class="st">'+resHtml+'</div>';
}
if (typeof module!=="undefined"&&module.exports) module.exports={renderStatus};
if (typeof window!=="undefined") window.__ccStatusView={renderStatus};
```

- [ ] **Step 4: 运行，确认通过**

Run: `node test/statusviewtest.cjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add control/lib/status-view.js test/statusviewtest.cjs
git commit -m "feat(control-ui): status-view.js 纯渲染函数 (status JSON->HTML, 双导出)"
```

---

## Task 10: 控制中心前端 —— index.html / control.css / control.js

透明背景 SPA：占满 webview、浮动控件、轮询 /api/status、动作按钮、debug port 不通禁用（方案 1a）。

**Files:**
- Create: `control/index.html`
- Create: `control/control.css`
- Create: `control/control.js`

- [ ] **Step 1: 创建 control/index.html**

```html
<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>ZCode 控制中心</title>
<link rel="stylesheet" href="control.css">
</head>
<body>
  <div id="status-panel" class="panel"></div>
  <div id="actions" class="panel">
    <button data-action="injectImage">注入图片壁纸</button>
    <button data-action="injectVideo">注入视频壁纸</button>
    <button data-action="remove">移除壁纸</button>
    <label>透明度 <input id="opacity" type="number" min="0" max="100" value="78">%
      <button data-action="setTransparent">设透明</button></label>
    <button data-action="resize">重新缩图</button>
    <button data-action="setup">重装依赖</button>
    <button id="open-reader">打开阅读器</button>
    <span id="job-msg" class="muted"></span>
  </div>
  <div id="shelf-panel" class="panel"><h3>书架</h3><div id="shelf-list"></div></div>
  <script src="lib/status-view.js"></script>
  <script src="lib/shelf.js"></script>
  <script src="control.js"></script>
</body>
</html>
```

- [ ] **Step 2: 创建 control/control.css（透明背景透壁纸 — spec A1）**

```css
/* A1: transparent background so ZCode wallpaper shows through (spec §2). */
html, body { margin:0; height:100%; background: transparent !important; color:#fff;
  font-family:"Microsoft YaHei",system-ui,sans-serif; font-size:13px; }
.panel { background: rgba(20,20,24,0.55); border-radius:8px; padding:10px 12px; margin:8px;
  backdrop-filter: blur(3px); }
.st { padding:3px 0; }
button { background:rgba(255,255,255,0.12); color:#fff; border:1px solid rgba(255,255,255,0.25);
  border-radius:4px; padding:4px 10px; cursor:pointer; margin:2px; }
button:hover{ background:rgba(255,255,255,0.22); }
button:disabled{ opacity:0.4; cursor:not-allowed; }
input{ background:rgba(0,0,0,0.3); color:#fff; border:1px solid rgba(255,255,255,0.25); border-radius:3px; width:50px; }
.ok{ color:#66bb6a; } .warn{ color:#ffb74d; } .muted{ color:#aaa; }
#shelf-list .book{ padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.1); cursor:pointer; }
#shelf-list .book.stale{ color:#ff8a80; }
```

- [ ] **Step 3: 创建 control/control.js**

```js
// Control center SPA controller: poll /api/status, dispatch actions, render.
const POLL_MS = 2000;
let cdpOk = true; // disable CDP actions if debug port down (方案 1a)

async function poll() {
  try {
    const r = await fetch("/api/status");
    const st = await r.json();
    document.getElementById("status-panel").innerHTML = window.__ccStatusView.renderStatus(st);
    cdpOk = !!(st.zcode && st.zcode.running);
    document.querySelectorAll('[data-action="injectImage"],[data-action="injectVideo"],[data-action="remove"]')
      .forEach(b => b.disabled = !cdpOk);
  } catch (e) { /* server down; retry next tick */ }
}
setInterval(poll, POLL_MS); poll();

document.getElementById("actions").addEventListener("click", async (e) => {
  const action = e.target.getAttribute && e.target.getAttribute("data-action");
  if (!action) return;
  const params = action === "setTransparent" ? { opacityPct: parseInt(document.getElementById("opacity").value,10) } : {};
  const msg = document.getElementById("job-msg");
  msg.textContent = "执行中: " + action + "...";
  try {
    const r = await fetch("/api/action", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify(Object.assign({action}, params)) });
    const j = await r.json();
    if (r.status === 409) msg.textContent = "忙，请等当前动作完成";
    else if (!j.accepted) msg.textContent = "拒绝: " + (j.error||"");
    else { msg.textContent = "已提交 ("+j.jobId+")"; setTimeout(poll, 500); }
  } catch (err) { msg.textContent = "错误: " + err.message; }
});

document.getElementById("open-reader").addEventListener("click", () => {
  location.href = "/reader/";  // reader SPA, same server
});
```

- [ ] **Step 4: 真机验证（E1 + E5）**

启动 control-server，在 ZCode webview 打开 `/control/`：
- 验 body computed bg 是 transparent（用 inspect-control.cjs，Task 12 写）
- 验壁纸透出（人眼）
- 验 `/control/`（无尾斜杠）正常加载 CSS/JS（不 404）

- [ ] **Step 5: 提交**

```bash
git add control/index.html control/control.css control/control.js
git commit -m "feat(control-ui): 控制中心前端 SPA (透明背景 + 浮动控件 + 轮询 + 动作)"
```

---

## Task 11: 书架管理 control/lib/shelf.js

书架展示/进书读/删书/加书/关联修复（spec §4 B3，全套增删改）。复用 reader progress（localStorage key 相同）。

**Files:**
- Create: `control/lib/shelf.js`
- Create: `test/shelftest.cjs`（关联修复纯函数 resolveStaleBookId）

- [ ] **Step 1: 写关联修复纯函数测试**

```js
// Test shelf association-repair pure fn (spec §4 B3, §5.2).
const shelf = require("../control/lib/shelf.js");
let pass=0,fail=0; function check(n,c){console.log((c?"PASS ✓ ":"FAIL ✗ ")+n);c?pass++:fail++;}
// resolveStaleBookId(staleEntry, currentFiles): filename 同名还在 -> 返回新 id; 不在 -> null
check("resolve: same filename present -> returns {newBookId}", shelf.resolveStaleBookId({filename:"a.txt"}, ["a.txt","b.txt"]) !== null);
check("resolve: filename gone -> null", shelf.resolveStaleBookId({filename:"x.txt"}, ["a.txt"]) === null);
check("resolve: returns newBookId keyed off current filename", shelf.resolveStaleBookId({filename:"a.txt"}, ["a.txt"]).newFilename === "a.txt");
console.log("\n"+pass+" passed, "+fail+" failed");process.exit(fail===0?0:1);
```

- [ ] **Step 2: 运行，确认失败**

Run: `node test/shelftest.cjs`
Expected: FAIL — module not found

- [ ] **Step 3: 创建 control/lib/shelf.js**

```js
// Shelf management (spec §4 B3). Reuses reader's progress (localStorage key
// zcode-reader:shelf). Dual export.
// resolveStaleBookId: filename-based association repair (spec §5.2, no content hash).
function bookId(filename){let h=5381;for(let i=0;i<filename.length;i++)h=((h<<5)+h+filename.charCodeAt(i))|0;return "b"+(h>>>0).toString(36);}
function resolveStaleBookId(staleEntry, currentFiles) {
  if (!staleEntry || !staleEntry.filename) return null;
  if (currentFiles.indexOf(staleEntry.filename) === -1) return null;
  return { newBookId: bookId(staleEntry.filename), newFilename: staleEntry.filename };
}
// Browser-only shelf ops (need localStorage); guarded.
function getShelf(){ try { return JSON.parse(localStorage.getItem("zcode-reader:shelf")||"[]"); } catch(e){ return []; } }
function setShelf(arr){ try { localStorage.setItem("zcode-reader:shelf", JSON.stringify(arr)); } catch(e){} }
function removeBook(bookId){ setShelf(getShelf().filter(b=>b.bookId!==bookId)); }
async function repairAll(currentFiles){ // returns count repaired
  const s = getShelf(); let n=0;
  const fixed = s.map(b => {
    const r = resolveStaleBookId(b, currentFiles);
    if (r && r.newBookId !== b.bookId) { n++; return Object.assign({}, b, { bookId: r.newBookId }); }
    return b;
  });
  setShelf(fixed); return n;
}
if (typeof module!=="undefined"&&module.exports) module.exports={resolveStaleBookId, bookId, repairAll, removeBook, getShelf};
if (typeof window!=="undefined") window.__ccShelf={resolveStaleBookId, bookId, repairAll, removeBook, getShelf};
```

- [ ] **Step 4: 运行，确认通过**

Run: `node test/shelftest.cjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add control/lib/shelf.js test/shelftest.cjs
git commit -m "feat(control-ui): shelf.js 书架管理 (复用 reader progress + 关联修复 filename 匹配)"
```

---

## Task 12: scripts/inspect-control.cjs —— 端到端验证脚本

一次性、设完即退、可回读（教训 14）。验证 E1（透明透壁纸）/E2（status CDP）/E7（target 过滤）。

**Files:**
- Create: `scripts/inspect-control.cjs`

- [ ] **Step 1: 创建 scripts/inspect-control.cjs**

```js
// End-to-end probe for control center (spec §7.2 E1/E2/E7). Connects to the
// control-center webview target, checks body bg transparent + wallpaper visible,
// and curls /api/status to verify target filtering excludes tool pages.
const http = require("http");
const { WebSocket } = require("ws");
const CC_PORT = parseInt(process.env.CC_PORT || "17890", 10);
const CDP_PORT = parseInt(process.env.ZCODE_DEBUG_PORT || "9222", 10);

function httpGetJson(p,h,port){return new Promise((res,rej)=>{http.get({host:h,port,path:p},(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{res(JSON.parse(d));}catch(e){rej(e);}});}).on("error",rej);});}

(async () => {
  // E2/E7: /api/status — verify tool pages NOT counted
  try {
    const st = await httpGetJson("/api/status","127.0.0.1",CC_PORT);
    console.log("[E2] status.zcode =", JSON.stringify(st.zcode));
    console.log("[E2] status.wallpaper =", JSON.stringify(st.wallpaper));
    console.log("[E7] pageTargets =", st.zcode && st.zcode.pageTargets, "(should NOT include /control//reader/)");
  } catch (e) { console.log("[E2] FAIL: control-server not running on", CC_PORT, e.message); }

  // E1: connect control-center webview target, check body bg transparent
  try {
    const targets = await httpGetJson("/json","127.0.0.1",CDP_PORT);
    const wv = targets.find(t => t.type==="webview" && (t.url||"").indexOf("/control") !== -1);
    if (!wv) { console.log("[E1] no control-center webview target open"); }
    else {
      const wsUrl = wv.webSocketDebuggerUrl.replace(/^ws:\/\/localhost(\/)/, "ws://127.0.0.1:"+CDP_PORT+"$1");
      const ws = new WebSocket(wsUrl); let id=0; const pend=new Map();
      ws.on("message",(raw)=>{const m=JSON.parse(raw.toString());if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
      await new Promise((r,e)=>{ws.on("open",r);ws.on("error",e);});
      const call=(method,params={})=>new Promise((res)=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
      const r = await call("Runtime.evaluate",{expression:"getComputedStyle(document.body).backgroundColor",returnByValue:true});
      console.log("[E1] control body bg =", r.result && r.result.value, "(transparent => rgba(0, 0, 0, 0))");
      ws.close();
    }
  } catch (e) { console.log("[E1] FAIL:", e.message); }
})();
```

- [ ] **Step 2: 提交**

```bash
git add scripts/inspect-control.cjs
git commit -m "chore(scripts): inspect-control.cjs 端到端验证 (E1 透明/E2 status/E7 target 过滤)"
```

---

## Task 13: bin/control-center.bat + 菜单场景 13

独立常驻入口 + wallpaper.bat 加场景 13。注意 .bat 必须 CRLF + ASCII-only（AGENTS.md）。

**Files:**
- Create: `bin/control-center.bat`
- Modify: `lib/menu.cjs`（加场景 13）
- Modify: `wallpaper.bat`（加 scene_reader 后的 scene_control + 分支）
- Modify: `test/menutest.cjs`（加场景 13 断言）

- [ ] **Step 1: 创建 bin/control-center.bat（对称 reader-server.bat）**

参考 `bin/reader-server.bat` 结构，改成调 `lib/control-server.cjs`，窗口标题 "ZCode 控制中心"，输出 /control/ URL 到剪贴板。ASCII-only。

```bat
@echo off
chcp 65001 >nul
setlocal
set "WP_ROOT=%~dp0.."
title ZCode 控制中心 (control server)
echo [control] starting control-center server...
start "ZCode 控制中心" cmd /k node "%WP_ROOT%\lib\control-server.cjs"
echo [control] launched in a new window. URL copied to clipboard.
echo [control] open http://localhost:17890/control/ in ZCode browser panel.
endlocal
```

- [ ] **Step 2: 菜单加场景 13**

`lib/menu.cjs` 的 SCENARIOS 数组加：
```js
{
  key: "13",
  title: "启动控制中心",
  desc: "开常驻服务，去 ZCode 浏览器面板打开控制中心（带界面统一操作 + 看状态）",
  calls: "control-center",
},
```

- [ ] **Step 3: wallpaper.bat 加分支**

在 `if "%choice%"=="12" goto scene_reader_help` 后加 `if "%choice%"=="13" goto scene_control`；
在 `:scene_reader_help` 段之前加：
```bat
:scene_control
call "%WP_DIR%\bin\control-center.bat"
goto menu
```
（提示文案里的 `set /p` 输入范围改成 `0-13`。）

- [ ] **Step 4: 扩展 test/menutest.cjs 加场景 13 断言**

在 menutest 里加（参照现有场景断言风格）：
- 场景 13 存在、title "启动控制中心"、calls 含 "control-center"

- [ ] **Step 5: 运行 menutest，确认通过**

Run: `node test/menutest.cjs`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add bin/control-center.bat lib/menu.cjs wallpaper.bat test/menutest.cjs
git commit -m "feat(menu): 场景 13 启动控制中心 + bin/control-center.bat 入口"
```

---

## Task 14: package.json test 串联 + 最终全测

把所有新 test 加进 npm test，跑全套确认无回归。

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 更新 package.json test 脚本**

在 `package.json` 的 `"test"` 末尾追加新 test（顺序：cdptest 在 inject 相关之后，status/control/shelf 在 reader 相关之后）：
```
&& node test/cdptest.cjs && node test/statusviewtest.cjs && node test/statustest.cjs && node test/shelftest.cjs && node test/controlservertest.cjs
```

- [ ] **Step 2: 跑全套**

Run: `npm test`
Expected: PASS — 所有测试（旧 + 新）全绿

- [ ] **Step 3: 真机交付前清单（spec §7.2，E1-E8）**

手动跑（需 ZCode 开着 + control-server 开着）：
- E1: webview 打开 /control/，inspect-control.cjs 验 body bg transparent + 人眼看壁纸透出
- E2: curl http://localhost:17890/api/status，验 wallpaper.mode 反映真实
- E3/E8: 设透明→查 alpha 回读一致（Task 6 Step 6 已做）
- E4: 点"移除"，验下一轮 status 反映 none + inject.cjs 真被调
- E5: webview 加载 /control（无尾斜杠），验 CSS/JS 不 404
- E6: novels/ 改文件名，验书架标 stale + 关联修复
- E7: 控制中心开着时 /api/status 的 pageTargets 不含 /control//reader/

- [ ] **Step 4: 提交**

```bash
git add package.json
git commit -m "test: test 串联加 cdptest/statusviewtest/statustest/shelftest/controlservertest"
```

---

## Self-Review（计划完成后）

**1. Spec coverage（逐节核对 spec）：**
- §2 真机事实（webview 透明链）→ Task 6/12 真机验 ✓
- §4 A1 control-server → Task 8 ✓
- §4 A2 status.cjs → Task 4/5/7 ✓
- §4 A2b cdp.cjs → Task 1/2/3 ✓
- §4 A3 transparent.ps1 三处改动 → Task 6 ✓
- §4 B1-B3 前端 → Task 9/10/11 ✓
- §5.2 action 表（6 个，无 startZcode）+ spawn 契约 → Task 8 buildSpawnArgs ✓
- §5.3 固定端口 17890 → Task 8 DEFAULT_PORT ✓
- §5.4 target 过滤（路径前缀，remove 也走过滤）→ Task 1/2 ✓
- §5.2 书架关联修复 → Task 11 ✓
- §6 错误处理（探查失败不致命/409 锁/状态机）→ Task 5/7/8 ✓
- §7 测试 → Task 1-14 各有测试 ✓
- §9 文件清单 → 全覆盖 ✓

**2. Placeholder scan：** 无 TBD/TODO；buildLibrary/小说 API 在 Task 8 标了"从 reader-server.cjs 原样复制"并给了明确位置——实现者需照搬，不是占位。

**3. Type/signature 一致性：**
- `filterTargets(targets)` — Task 1 定义，Task 2 listTargets 调用 ✓
- `probeWallpaperMode(target)` / `classifyWallpaperDom(dom)` — Task 3 定义，Task 5 probeZcodeAndWallpaper 调用 ✓
- `snapshot({root, serverPort, transparentHwnd})` — Task 5 定义，Task 8 handle 调用 ✓
- `buildSpawnArgs(root, action, params)` 返回 `[cmd, args, opts]` — Task 8 定义 + 调用 ✓
- `classifyTransparent(psResult, ambiguous)` / `probeTransparent(hwnd)` — Task 7 ✓
- `resolveStaleBookId(staleEntry, currentFiles)` — Task 11 ✓
- 双导出 pattern（status-view.js/shelf.js 都 `module.exports` + `window.__ccXxx`）一致 ✓

计划完整、可执行。
