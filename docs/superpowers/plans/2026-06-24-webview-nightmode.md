# webview 网页夜间模式（深黑主题）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ZCode webview 打开的外部网页上，一键切换到深黑夜间主题（背景 `#1a1a1a`、文字 `#d4d4d4`），开关跨重启持久化。

**Architecture:** 新建 `lib/webview-nightmode.cjs`，架构完全对称已有的 `lib/webview-blankfix.cjs`——control-server 每 3 秒轮询注册 webview target，用 CDP `Page.addScriptToEvaluateOnNewDocument` 把"建深黑 `<style>`"的 JS 注入每个外部网页（跨导航自动重注）。与 blankfix 的唯一差异：夜间模式有开/关两态，状态存 `.nightmode.json`（对称 `.rotate.json`），切换时管理 `addScript` 返回的 scriptId（开则注册/关则移除）。

**Tech Stack:** Node.js, CDP（Chrome DevTools Protocol）over ws, HTTP server, vanilla JS 前端, 无新依赖（复用 ws）。

**Spec:** `docs/superpowers/specs/2026-06-24-webview-nightmode-design.md`

**前置事实（已核实，非假设）**：
- `lib/webview-blankfix.cjs` 已用 `addScriptToEvaluateOnNewDocument` 把 JS 注入 webview（type==="webview" target），已真机验生效（AGENTS.md 教训 28）。
- `lib/cdp.cjs` 导出中性工具：`connect(wsUrl)→{ws,call}`、`httpGetJson(path)`、`fixWsHost`。`connect` 返回的 `call(method,params)→Promise<result>`。
- 测试风格：`test/*.cjs` 用 `check(name,cond)` 计 pass/fail，`process.exit(fail>0?1:0)`。fake DOM 手写不引 jsdom（见 `webviewblankfixtest.cjs`）。
- `package.json` 的 `test` 是 `&&` 链，新测试插在 `webviewblankfixtest` 之后。
- `.gitignore` 第 59 行有 `.rotate.json`，夜间模式加 `.nightmode.json`。

---

## File Structure

**新增：**
- `lib/webview-nightmode.cjs` — 夜间模式核心模块。导出纯常量/纯函数（`NIGHTMODE_CSS`/`NIGHTMODE_SOURCE`/`filterWebviewTargets`/`readState`/`writeState`/`STATE_FILENAME`）+ 有状态 manager（`init`/`sync`/`apply`/`close`）。对称 `lib/webview-blankfix.cjs`。
- `test/webviewnightmodetest.cjs` — 纯函数 + 常量 + fake DOM + 状态读写测试。对称 `webviewblankfixtest.cjs`。

**修改：**
- `lib/control-server.cjs` — 启动 nightmode manager + 3 秒轮询 + `/api/action setNightMode` 分支 + close() 清理。
- `lib/status.cjs` — 加 `probeNightmode` + snapshot 加 `nightmode` 项 + mergeProbeResults 循环加 "nightmode"。
- `control/lib/status-view.js` — renderStatus 加夜间模式行（开/关显示）。
- `control/index.html` — `#actions` 加"🌙 夜间模式"按钮。
- `control/control.js` — poll 更新按钮文字/状态 + 点击 dispatch toggleNightMode。
- `package.json` — test 链加 `webviewnightmodetest`。
- `.gitignore` — 加 `.nightmode.json` + `.nightmode.json.tmp`。
- `AGENTS.md` — 新增"webview 网页夜间模式"章节 + 教训补丁。

**职责边界：** 每个文件单一职责。`webview-nightmode.cjs` 只管"webview 注入深黑 CSS"这一件事，和 blankfix（剥链接）互不耦合，但都复用 cdp.cjs 中性工具（不重写 CDP 胶水，教训 1）。

---

## Task 0：建分支

**Files:** 无（git 操作）

- [ ] **Step 1：建并切到 feature 分支**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" checkout -b feat/webview-nightmode
```

Expected：`Switched to a new branch 'feat/webview-nightmode'`

- [ ] **Step 2：确认工作区干净 + 在新分支**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" status -sb
```

Expected：第一行 `## feat/webview-nightmode`，无未提交改动（spec 已在上一轮 commit 到 main，新分支基于它）。

---

## Task 1：`.gitignore` 加 `.nightmode.json`

**Files:**
- Modify: `.gitignore:59-60` 附近

- [ ] **Step 1：在 `.rotate.json` 规则后加 `.nightmode.json`**

读 `.gitignore` 第 57-61 行，现有：
```
# Wallpaper rotation runtime state (written by lib/rotate.cjs, read by status).
# Never commit — it's machine-local runtime data.
.rotate.json
.rotate.json.tmp
```

在其后追加（用 Edit 工具，old_string 锚定 `.rotate.json.tmp` 那一行）：

```gitignore
.rotate.json.tmp

# webview night-mode runtime state (written by lib/webview-nightmode.cjs).
# Never commit — machine-local preference.
.nightmode.json
.nightmode.json.tmp
```

- [ ] **Step 2：验证被忽略**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" check-ignore .nightmode.json .nightmode.json.tmp
```

Expected：两行都输出（`.nightmode.json` 和 `.nightmode.json.tmp` 都被忽略）。

- [ ] **Step 3：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add .gitignore && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "chore(nightmode): gitignore runtime state file"
```

---

## Task 2：核心模块骨架 + 常量（`NIGHTMODE_CSS` / `NIGHTMODE_SOURCE`）

**Files:**
- Create: `lib/webview-nightmode.cjs`
- Test: `test/webviewnightmodetest.cjs`（本 task 先建文件测常量，后续 task 追加测试）

**TDD 顺序：** 先写常量断言测试（失败）→ 写常量（通过）。

- [ ] **Step 1：写测试文件骨架 + NIGHTMODE_CSS/SOURCE 常量断言**

Create `test/webviewnightmodetest.cjs`：

```js
// Test lib/webview-nightmode.cjs pure helpers + constants (spec §11).
const nm = require("../lib/webview-nightmode.cjs");
const bf = require("../lib/webview-blankfix.cjs");
const cdp = require("../lib/cdp.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// === NIGHTMODE_CSS 常量断言 (spec §3.1) ===
var css = nm.NIGHTMODE_CSS;
check("CSS: is string", typeof css === "string");
check("CSS: has deep black bg #1a1a1a", css.indexOf("#1a1a1a") !== -1);
check("CSS: has light gray text #d4d4d4", css.indexOf("#d4d4d4") !== -1);
check("CSS: targets html,body", css.indexOf("html, body") !== -1);
check("CSS: covers .main-content (cool18 hit)", css.indexOf(".main-content") !== -1);
check("CSS: covers .post-content", css.indexOf(".post-content") !== -1);
check("CSS: covers pre", css.indexOf("pre") !== -1);
check("CSS: uses !important (override site inline)", css.indexOf("!important") !== -1);
check("CSS: styles a:link (brighten links)", css.indexOf("a:link") !== -1);
check("CSS: styles a:visited", css.indexOf("a:visited") !== -1);

// === NIGHTMODE_SOURCE 常量断言 (spec §3) ===
var src = nm.NIGHTMODE_SOURCE;
check("SOURCE: is string", typeof src === "string");
check("SOURCE: contains __zzNightMode (idempotency guard)", src.indexOf("__zzNightMode") !== -1);
check("SOURCE: contains zcode-nightmode (style id)", src.indexOf("zcode-nightmode") !== -1);
check("SOURCE: contains createElement('style')", src.indexOf("createElement('style')") !== -1);
check("SOURCE: contains the CSS text (#1a1a1a embedded)", src.indexOf("#1a1a1a") !== -1);
check("SOURCE: is IIFE", /^\(function\(\)\{[\s\S]*\}\)\(\);?\s*$/.test(src.trim()));
// night mode does NOT need MutationObserver/click listener (CSS applies once;
// browser handles re-render). Assert absence to document this design choice.
check("SOURCE: NO MutationObserver (unlike blankfix)", src.indexOf("MutationObserver") === -1);
check("SOURCE: NO addEventListener (unlike blankfix)", src.indexOf("addEventListener") === -1);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2：运行测试确认失败（模块不存在）**

Run:
```bash
node -e "require('./test/webviewnightmodetest.cjs')"
```
（或 `node test/webviewnightmodetest.cjs`，下同）

Expected：FAIL——`Cannot find module '../lib/webview-nightmode.cjs'`，测试崩在 require。

- [ ] **Step 3：创建模块文件，写常量**

Create `lib/webview-nightmode.cjs`：

```js
// webview night mode (deep black) — spec 2026-06-24-webview-nightmode-design.
// Injects a dark-black <style> into every external webview page so users can
// read light-background sites (e.g. cool18 帖子) comfortably at night.
//
// WHY a separate module (not blankfix.cjs): night mode is a different webview-
// injection responsibility (改背景色) from blankfix (剥 _blank). Two unrelated
// features must not be welded together (single responsibility). But this module
// REUSES cdp.connect + cdp.httpGetJson (neutral plumbing) — no duplicated CDP
// glue (教训 1). Architecture is fully symmetric to webview-blankfix.cjs.
//
// Differs from blankfix in ONE way: night mode has an on/off toggle (blankfix is
// stateless always-on). State persists in .nightmode.json (symmetric .rotate.json).
// The toggle manages addScriptToEvaluateOnNewDocument's scriptId (register on
// enable, remove on disable).

// ---- §3.1 deep-black CSS ----
// Wide coverage of common text containers, all !important to override site
// inline styles (e.g. cool18's #E6E6DD on .main-content). Does NOT touch images
// / form controls / iframes (intentional — see spec §3.2).
const NIGHTMODE_CSS = [
  "/* base: html + body dark */",
  "html, body {",
  "  background-color: #1a1a1a !important;",
  "  color: #d4d4d4 !important;",
  "}",
  "/* common text containers: sites that paint bg on child elements */",
  ".main-content, .post-content, #content, #content-section,",
  "article, main, .article, .content, .post, .entry, .entry-content,",
  ".read, .read-content, .text, .article-content, .chapter, .chapter-content,",
  "pre, blockquote, .quote {",
  "  background-color: #1a1a1a !important;",
  "  color: #d4d4d4 !important;",
  "}",
  "/* links: default blue too dark on black, brighten */",
  "a, a:link { color: #6db4ff !important; }",
  "a:visited { color: #b06bdb !important; }",
  "a:hover, a:active { color: #9fd1ff !important; }",
  "/* tables, code blocks */",
  "table, th, td { background-color: #242424 !important; color: #d4d4d4 !important; border-color: #444 !important; }",
  "code, pre, kbd, samp { background-color: #242424 !important; color: #d4d4d4 !important; }",
  "/* headings: slightly brighter for hierarchy */",
  "h1, h2, h3, h4, h5, h6 { color: #e0e0e0 !important; }",
  "/* borders/dividers darken */",
  "hr, .divider { border-color: #444 !important; }"
].join("\n");

// ---- §3 injected JS: create the style + idempotent guard ----
// addScriptToEvaluateOnNewDocument injects SELF-CONTAINED source (can't ref
// outer scope), so we splice the CSS text into the IIFE via JSON.stringify.
const NIGHTMODE_SOURCE = [
  "(function(){",
  "  if(window.__zzNightMode)return;",
  "  window.__zzNightMode=true;",
  "  var existing=document.getElementById('zcode-nightmode');",
  "  if(existing)return;",
  "  var s=document.createElement('style');",
  "  s.id='zcode-nightmode';",
  "  s.textContent=" + JSON.stringify(NIGHTMODE_CSS) + ";",
  "  (document.head||document.documentElement).appendChild(s);",
  "})();"
].join("\n");

module.exports = {
  NIGHTMODE_CSS: NIGHTMODE_CSS,
  NIGHTMODE_SOURCE: NIGHTMODE_SOURCE,
};
```

- [ ] **Step 4：运行测试确认通过**

Run: `node test/webviewnightmodetest.cjs`
Expected：`14 passed, 0 failed`（10 个 CSS 断言 + 8 个 SOURCE 断言 = 实际计数看测试，应为全绿；若 FAIL 修模块不修测试，除非测试本身写错）。

> 注：若 Step 1 的断言数与实际对不上（比如数到 18 条 check），以"0 failed"为准，pass 计数无所谓。

- [ ] **Step 5：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add lib/webview-nightmode.cjs test/webviewnightmodetest.cjs && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "feat(nightmode): add NIGHTMODE_CSS/SOURCE constants + tests"
```

---

## Task 3：`filterWebviewTargets` 纯函数 + 三方镜像一致性

**Files:**
- Modify: `lib/webview-nightmode.cjs`（加函数 + 导出）
- Modify: `test/webviewnightmodetest.cjs`（加测试）

**关键：** 这 15 行过滤规则必须与 `lib/webview-blankfix.cjs` 的 `filterWebviewTargets` **逐字一致**（除模块名外）。镜像断言钉死三方（cdp.filterTargets / blankfix / nightmode）排除相同工具页。

- [ ] **Step 1：在测试文件追加 filterWebviewTargets 测试**

在 `test/webviewnightmodetest.cjs` 的 `console.log` 行**之前**插入：

```js
// === filterWebviewTargets (spec §5) — mirrors blankfix rule verbatim ===
function mkWv(url, id) { return { type: "webview", id: id || "wv1", url: url, webSocketDebuggerUrl: "ws://x/" + (id || "wv1") }; }
function mkPage(url, id) { return { type: "page", id: id || "p1", url: url, webSocketDebuggerUrl: "ws://x/" + (id || "p1") }; }

check("filter: reject page type", nm.filterWebviewTargets([mkPage("https://x.com/")]).length === 0);
check("filter: reject iframe type", nm.filterWebviewTargets([{ type: "iframe", url: "https://x.com/", webSocketDebuggerUrl: "ws://x" }]).length === 0);
check("filter: reject no wsUrl", nm.filterWebviewTargets([{ type: "webview", url: "https://x.com/" }]).length === 0);
check("filter: reject devtools url", nm.filterWebviewTargets([mkWv("devtools://devtools/bundled/shell.html")]).length === 0);
check("filter: reject /control/ on localhost", nm.filterWebviewTargets([mkWv("http://localhost:17890/control/")]).length === 0);
check("filter: reject /control/ on 127.0.0.1", nm.filterWebviewTargets([mkWv("http://127.0.0.1:17890/control/")]).length === 0);
check("filter: reject /reader/ on localhost", nm.filterWebviewTargets([mkWv("http://localhost:17890/reader/")]).length === 0);
check("filter: reject /api/ on localhost", nm.filterWebviewTargets([mkWv("http://localhost:17890/api/books")]).length === 0);
check("filter: reject /control/index.html", nm.filterWebviewTargets([mkWv("http://127.0.0.1:17890/control/index.html")]).length === 0);
check("filter: reject different port still tool page", nm.filterWebviewTargets([mkWv("http://127.0.0.1:17891/control/")]).length === 0);
check("filter: keep external https", nm.filterWebviewTargets([mkWv("https://open.bigmodel.cn/")]).length === 1);
check("filter: keep external http", nm.filterWebviewTargets([mkWv("http://example.com/path?q=1")]).length === 1);
check("filter: keep webview with empty url", nm.filterWebviewTargets([{ type: "webview", id: "wv1", url: "", webSocketDebuggerUrl: "ws://x/wv1" }]).length === 1);
check("filter: keep localhost non-tool path", nm.filterWebviewTargets([mkWv("http://localhost:3000/app")]).length === 1);

// 三方镜像一致性 (教训 17 三方扩展): cdp.filterTargets / blankfix.filterWebviewTargets
// / nightmode.filterWebviewTargets 排除的工具页集合完全相同 (只类型维度 page vs webview 不同)
var mirrorTargets = [
  { type: "page", id: "p1", url: "https://a.com/", webSocketDebuggerUrl: "ws://x/p1" },
  { type: "webview", id: "w1", url: "https://a.com/", webSocketDebuggerUrl: "ws://x/w1" },
  { type: "page", id: "p2", url: "http://127.0.0.1:17890/control/", webSocketDebuggerUrl: "ws://x/p2" },
  { type: "webview", id: "w2", url: "http://127.0.0.1:17890/control/", webSocketDebuggerUrl: "ws://x/w2" },
  { type: "page", id: "p3", url: "devtools://x", webSocketDebuggerUrl: "ws://x/p3" },
  { type: "webview", id: "w3", url: "devtools://x", webSocketDebuggerUrl: "ws://x/w3" }
];
var bfKept = bf.filterWebviewTargets(mirrorTargets).map(function (t) { return t.url; }).sort();
var nmKept = nm.filterWebviewTargets(mirrorTargets).map(function (t) { return t.url; }).sort();
check("mirror: blankfix and nightmode keep same URL set", JSON.stringify(bfKept) === JSON.stringify(nmKept));
check("mirror: both nightmode filters keep only external https", nmKept.length === 1 && nmKept[0] === "https://a.com/");
```

- [ ] **Step 2：运行测试确认失败（filterWebviewTargets 未定义）**

Run: `node test/webviewnightmodetest.cjs`
Expected：FAIL——`nm.filterWebviewTargets is not a function`。

- [ ] **Step 3：在模块加 filterWebviewTargets**

在 `lib/webview-nightmode.cjs` 的 `module.exports` **之前**插入（与 blankfix 逐字一致）：

```js
// Pure: filter /json targets to "real external-site webviews" (spec §5).
// VERBATIM copy of webview-blankfix.cjs filterWebviewTargets — kept in sync by
// the three-way mirror-consistency assertion in webviewnightmodetest.cjs
// (cdp.filterTargets / blankfix / nightmode exclude identical tool pages).
// Why not import blankfix's: would couple two independent webview-injection
// modules. Copy + mirror test is cleaner (教训 17 three-way extension).
function filterWebviewTargets(targets) {
  return targets.filter(function (t) {
    if (t.type !== "webview") return false;
    if (!t.webSocketDebuggerUrl) return false;
    var url = t.url || "";
    if (url.indexOf("devtools://") === 0) return false;
    var m = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.exec(url);
    if (m) {
      var pathPrefix = m[3] || "/";
      if (pathPrefix.indexOf("/control/") === 0 ||
          pathPrefix.indexOf("/reader/") === 0 ||
          pathPrefix.indexOf("/api/") === 0) return false;
    }
    return true;
  });
}
```

并在 `module.exports` 加 `filterWebviewTargets: filterWebviewTargets,`（在 `NIGHTMODE_SOURCE` 那行后）。

- [ ] **Step 4：运行测试确认通过**

Run: `node test/webviewnightmodetest.cjs`
Expected：`0 failed`（所有 filter + 镜像断言绿）。

- [ ] **Step 5：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add lib/webview-nightmode.cjs test/webviewnightmodetest.cjs && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "feat(nightmode): add filterWebviewTargets + three-way mirror test"
```

---

## Task 4：状态读写 `readState` / `writeState` / `STATE_FILENAME`

**Files:**
- Modify: `lib/webview-nightmode.cjs`（加 fs require + 函数 + 导出）
- Modify: `test/webviewnightmodetest.cjs`（加测试）

**对称 `lib/rotate.cjs` 的 readState/writeState**（原子写 tmp+rename）。

- [ ] **Step 1：在测试追加状态读写测试**

在 `test/webviewnightmodetest.cjs` 的 `console.log` 行**之前**插入：

```js
// === readState / writeState (spec §6, symmetric rotate.cjs) ===
var fs = require("fs"), os = require("os"), path = require("path");
var nmTmp = fs.mkdtempSync(path.join(os.tmpdir(), "nm-"));
var nmState = path.join(nmTmp, nm.STATE_FILENAME);

check("STATE_FILENAME is .nightmode.json", nm.STATE_FILENAME === ".nightmode.json");
// readState on missing file -> { enabled: false }
check("readState: missing file -> enabled false", nm.readState(nmState).enabled === false);
// writeState then readState round-trips
nm.writeState(nmState, { enabled: true, updatedAt: 1719216000000 });
var nrd = nm.readState(nmState);
check("readState: round-trip enabled true", nrd.enabled === true);
check("readState: round-trip updatedAt", nrd.updatedAt === 1719216000000);
// writeState overwrites (not merges)
nm.writeState(nmState, { enabled: false });
check("writeState: overwrites enabled", nm.readState(nmState).enabled === false);
check("writeState: overwrite drops updatedAt", nm.readState(nmState).updatedAt === undefined);
// readState on corrupt JSON -> { enabled: false } no throw
fs.writeFileSync(nmState, "{ not valid json");
check("readState: corrupt json -> enabled false no throw", nm.readState(nmState).enabled === false);
// readState on null path -> { enabled: false } no throw
check("readState: null path -> enabled false", nm.readState(null).enabled === false);
try { fs.rmSync(nmTmp, { recursive: true, force: true }); } catch (e) {}
```

- [ ] **Step 2：运行测试确认失败**

Run: `node test/webviewnightmodetest.cjs`
Expected：FAIL——`nm.STATE_FILENAME is undefined` 或 `nm.readState is not a function`。

- [ ] **Step 3：在模块加 fs require + 状态函数**

在 `lib/webview-nightmode.cjs` 顶部 `const` 区加（在 NIGHTMODE_CSS 定义之前）：

```js
const fs = require("fs");
```

在 `module.exports` **之前**插入：

```js
// ---- §6 state file (.nightmode.json) — symmetric rotate.cjs ----
const STATE_FILENAME = ".nightmode.json";

// Read state. Missing/corrupt/unreadable -> { enabled: false } (no throw).
// nightmode.apply writes; status.cjs reads. Single-direction data flow (spec §6).
function readState(statePath) {
  if (!statePath) return { enabled: false };
  var raw;
  try { raw = fs.readFileSync(statePath, "utf8"); } catch (e) { return { enabled: false }; }
  try { return JSON.parse(raw); } catch (e) { return { enabled: false }; }
}

// Write state atomically (tmp + rename, so status never reads a half-write).
function writeState(statePath, obj) {
  if (!statePath) return;
  var tmp = statePath + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
    fs.renameSync(tmp, statePath);
  } catch (e) { /* best-effort; don't crash */ }
}
```

并在 `module.exports` 加：

```js
  filterWebviewTargets: filterWebviewTargets,
  readState: readState,
  writeState: writeState,
  STATE_FILENAME: STATE_FILENAME,
```

- [ ] **Step 4：运行测试确认通过**

Run: `node test/webviewnightmodetest.cjs`
Expected：`0 failed`。

- [ ] **Step 5：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add lib/webview-nightmode.cjs test/webviewnightmodetest.cjs && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "feat(nightmode): add readState/writeState/STATE_FILENAME"
```

---

## Task 5：有状态 manager（`init` / `sync` / `apply` / `close`）

**Files:**
- Modify: `lib/webview-nightmode.cjs`（加 manager 代码 + 导出）

**不单测**（跨进程 CDP 胶水 + ws 生命周期，教训 12/13，靠真机验）。这是 plan 里唯一"纯实现无测试"的 task——因为 manager 的逻辑全是 CDP 调用，单测只能测 mock，而 mock 测不出 webview 真实行为（教训 28）。真机验证在 Task 11。

- [ ] **Step 1：在模块追加 manager 实现**

在 `lib/webview-nightmode.cjs` 的 `module.exports` **之前**插入：

```js
// ---- stateful manager (NOT unit-tested — cross-process CDP glue, 教训 12/13) ----
// Maintains Map<targetId, {ws, call, scriptId}>. init() loads initial enabled
// from state file. sync() (every 3s) diffs /json vs registered: connects+maybe-
// registers new targets, disconnects gone ones. apply(enabled) toggles: writes
// state + registers/removes script on all registered targets. close() tears down.
//
// WHY no test: connect/ws/scriptId lifecycle is cross-process glue. Verified by
// real-machine checklist (spec §11). Mirrors webview-blankfix.cjs's sync/close
// being untested (only pure fns are tested there too).

const registered = new Map(); // targetId -> {ws, call, scriptId}
let enabled = false;           // cached toggle state (state file is single source of truth)
let statePath = null;

// REMOVE_STYLE_EXPR: delete the injected style from the current page.
// Used by apply(false) so the current page reverts immediately (removeScript
// only blocks FUTURE docs; current page still has the style until we delete it).
const REMOVE_STYLE_EXPR = "(function(){var s=document.getElementById('zcode-nightmode');if(s)s.remove();})()";

function init(stateFilePath) {
  statePath = stateFilePath || null;
  const st = readState(statePath);
  enabled = !!st.enabled;
}

async function registerTarget(cdp, target, doInject) {
  const connected = await cdp.connect(target.webSocketDebuggerUrl);
  const ws = connected.ws;
  const call = connected.call;
  await call("Page.enable"); // prerequisite for addScriptToEvaluateOnNewDocument
  var scriptId = null;
  if (doInject) {
    const r = await call("Page.addScriptToEvaluateOnNewDocument", { source: NIGHTMODE_SOURCE });
    scriptId = r.identifier;
    // ALSO run once on current doc — addScript only fires on FUTURE docs, but the
    // user's current page needs the style now (mirrors blankfix decision 4).
    await call("Runtime.evaluate", { expression: NIGHTMODE_SOURCE });
  }
  ws.on("close", function () { registered.delete(target.id); });
  ws.on("error", function () { registered.delete(target.id); });
  registered.set(target.id, { ws: ws, call: call, scriptId: scriptId });
}

async function sync() {
  const cdp = require("./cdp.cjs");
  const all = await cdp.httpGetJson("/json");
  const current = filterWebviewTargets(all);
  const currentIds = new Set(current.map(function (t) { return t.id; }));

  // register new targets (current - registered)
  for (const t of current) {
    if (registered.has(t.id)) continue;
    try { await registerTarget(cdp, t, enabled); }
    catch (e) { /* per-target fail non-fatal (mirrors blankfix) */ }
  }

  // disconnect gone targets (registered - current)
  for (const id of Array.from(registered.keys())) {
    if (!currentIds.has(id)) {
      try { registered.get(id).ws.close(); } catch (e) {}
      registered.delete(id);
    }
  }
}

async function apply(newEnabled) {
  enabled = !!newEnabled;
  writeState(statePath, { enabled: enabled, updatedAt: Date.now() });
  let affected = 0;
  for (const id of Array.from(registered.keys())) {
    const entry = registered.get(id);
    try {
      if (enabled && entry.scriptId === null) {
        const r = await entry.call("Page.addScriptToEvaluateOnNewDocument", { source: NIGHTMODE_SOURCE });
        entry.scriptId = r.identifier;
        await entry.call("Runtime.evaluate", { expression: NIGHTMODE_SOURCE });
        affected++;
      } else if (!enabled && entry.scriptId !== null) {
        await entry.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: entry.scriptId });
        await entry.call("Runtime.evaluate", { expression: REMOVE_STYLE_EXPR });
        entry.scriptId = null;
        affected++;
      }
    } catch (e) { /* per-target fail non-fatal */ }
  }
  return { affected: affected };
}

function close() {
  for (const id of Array.from(registered.keys())) {
    try { registered.get(id).ws.close(); } catch (e) {}
    registered.delete(id);
  }
}

// reset for test isolation (not exported in prod, harmless)
function _reset() { for (const id of Array.from(registered.keys())) registered.delete(id); enabled = false; statePath = null; }
```

- [ ] **Step 2：在 module.exports 加 manager 导出**

```js
  STATE_FILENAME: STATE_FILENAME,
  init: init,
  sync: sync,
  apply: apply,
  close: close,
  _reset: _reset,
```

- [ ] **Step 3：确认模块能 require（语法检查）**

Run: `node -e "var nm=require('./lib/webview-nightmode.cjs'); console.log(typeof nm.init, typeof nm.sync, typeof nm.apply, typeof nm.close);"`
Expected：`function function function function`

- [ ] **Step 4：跑已有测试确认没回归**

Run: `node test/webviewnightmodetest.cjs`
Expected：`0 failed`（manager 代码不影响纯函数/常量测试）。

- [ ] **Step 5：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add lib/webview-nightmode.cjs && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "feat(nightmode): add stateful manager (init/sync/apply/close)"
```

---

## Task 6：SOURCE 脚本语义测试（fake DOM）

**Files:**
- Modify: `test/webviewnightmodetest.cjs`（加 fake DOM 语义测试）

验证建 style + 幂等语义正确（非纯语法）。手写最小 fake document/window，不引 jsdom（对齐 blankfix test）。

- [ ] **Step 1：在测试追加 fake DOM 测试**

在 `test/webviewnightmodetest.cjs` 的 `console.log` 行**之前**插入：

```js
// === SOURCE 脚本语义测试 (spec §11.5): 手写 fake DOM 跑 SOURCE ===
// 不引 jsdom (YAGNI). night mode SOURCE 比 blankfix 简单：只建一个 style，不需要
// observer/click。fake DOM 只需 document.createElement + getElementById + appendChild。
function makeNmFakeDom() {
  var head = { appended: [], appendChild: function (n) { this.appended.push(n); } };
  var styles = {}; // id -> element
  var fakeDoc = {
    head: head,
    documentElement: head,
    getElementById: function (id) { return styles[id] || null; },
    createElement: function (tag) {
      var el = { tagName: tag.toUpperCase(), id: null, textContent: "", _set: false };
      // capture id assignment via defineProperty to register in styles map
      var node = el;
      Object.defineProperty(node, "id", {
        get: function () { return el._id; },
        set: function (v) { el._id = v; if (v) styles[v] = node; }
      });
      return node;
    }
  };
  var win = { __zzNightMode: undefined, document: fakeDoc };
  return { win: win, doc: fakeDoc, getStyle: function (id) { return styles[id] || null; } };
}

// 场景 1: 跑 SOURCE 后 #zcode-nightmode style 存在，textContent 含 CSS
(function () {
  var dom = makeNmFakeDom();
  var fn = new Function("window", "document", nm.NIGHTMODE_SOURCE);
  fn(dom.win, dom.doc);
  var s = dom.getStyle("zcode-nightmode");
  check("semantics: style created with id zcode-nightmode", s !== null);
  check("semantics: style textContent contains CSS (#1a1a1a)", s && s.textContent.indexOf("#1a1a1a") !== -1);
  check("semantics: idempotency guard set", dom.win.__zzNightMode === true);
})();

// 场景 2: 幂等 — 重跑 SOURCE 不建第二个 style
(function () {
  var dom = makeNmFakeDom();
  var fn = new Function("window", "document", nm.NIGHTMODE_SOURCE);
  fn(dom.win, dom.doc);
  var threw = false;
  try { fn(dom.win, dom.doc); } catch (e) { threw = true; }
  check("semantics: re-run does not throw", threw === false);
  // only one append happened (the first run); second run hit the guard
  check("semantics: re-run appends no second style", dom.doc.head.appended.length === 1);
})();

// 场景 3: guard 丢了但 style 已存在 — 不重建 (getElementById 检查)
(function () {
  var dom = makeNmFakeDom();
  var fn = new Function("window", "document", nm.NIGHTMODE_SOURCE);
  fn(dom.win, dom.doc);
  // simulate guard lost but style present (edge case)
  dom.win.__zzNightMode = undefined;
  var threw = false;
  try { fn(dom.win, dom.doc); } catch (e) { threw = true; }
  check("semantics: guard-lost + style-present -> no throw", threw === false);
  check("semantics: guard-lost + style-present -> no rebuild", dom.doc.head.appended.length === 1);
})();
```

- [ ] **Step 2：运行测试确认通过**

Run: `node test/webviewnightmodetest.cjs`
Expected：`0 failed`（语义测试应一次绿，因为 Task 2 的常量已实现；若 FAIL 说明 fake DOM 的 `id` setter 或 appendChild 实现有误，修测试的 fake DOM 直至绿）。

- [ ] **Step 3：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add test/webviewnightmodetest.cjs && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "test(nightmode): add SOURCE fake-DOM semantics tests"
```

---

## Task 7：把测试加入 `npm test` 链

**Files:**
- Modify: `package.json:22`

- [ ] **Step 1：在 test 链末尾（webviewblankfixtest 之后）加 webviewnightmodetest**

读 `package.json` 第 22 行 `scripts.test`，在 `node test/webviewblankfixtest.cjs"` 后追加 ` && node test/webviewnightmodetest.cjs"`。

具体 Edit：把
```
node test/webviewblankfixtest.cjs"
```
替换为
```
node test/webviewblankfixtest.cjs && node test/webviewnightmodetest.cjs"
```

- [ ] **Step 2：跑完整测试链确认全绿**

Run: `npm test`
Expected：所有测试全绿（含新增 webviewnightmodetest），最后无 `Command failed` 报错。

> ⚠️ 若 npm test 在中间某测试红了（非 nightmode），那是预先存在的问题——记录但**不要**在本任务里修（scope 外）。只确认 nightmode 相关测试绿。

- [ ] **Step 3：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add package.json && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "test(nightmode): add webviewnightmodetest to npm test chain"
```

---

## Task 8：control-server 集成（init + 轮询 + setNightMode action + close）

**Files:**
- Modify: `lib/control-server.cjs`

**对齐 blankfix 的集成模式**（control-server.cjs:143-159 附近）。

- [ ] **Step 1：在 control-server 启动逻辑加 nightmode init + 轮询**

读 `lib/control-server.cjs` 第 138-161 行（`const server = http.createServer...` 到 `tryListen(startPort)`）。

定位这段（blankfix 集成块）：
```js
    const blankfix = require("./webview-blankfix.cjs");
    const blankfixTimer = setInterval(() => { blankfix.sync().catch(() => {}); }, 3000);
```

在其**后**追加 nightmode 对称块：
```js
    const nightmode = require("./webview-nightmode.cjs");
    const nightmodeStatePath = path.join(root, nightmode.STATE_FILENAME);
    nightmode.init(nightmodeStatePath);
    const nightmodeTimer = setInterval(() => { nightmode.sync().catch(() => {}); }, 3000);
```

- [ ] **Step 2：在 close() 加 nightmode.close()**

定位 close 回调（同一 `tryListen` 的 resolve 对象里）：
```js
        close: () => {
          clearInterval(blankfixTimer);
          blankfix.close();
```
在其后加：
```js
          clearInterval(nightmodeTimer);
          nightmode.close();
```

并在 resolve 对象加 `nightmodeTimer,`（参照 `blankfixTimer,` 的位置，在 `blankfixTimer,` 后）。

- [ ] **Step 3：在 /api/action 加 setNightMode 分支**

定位 muteVideo/unmuteVideo 分支（control-server.cjs:241-249 附近）。在该分支的**闭合 `return;` 之后**、`// startRotate*` 分支之前，插入 setNightMode 分支：

```js
          // setNightMode: toggle deep-black night mode on webview pages. Instant
          // CDP write (register/remove script on all targets), no spawn/jobId —
          // mirrors muteVideo's instant path. Test env has no ZCode -> apply's
          // per-target calls throw -> caught -> affected:0, still returns 200
          // (aligns with "探查失败不致命" philosophy).
          if (req2.action === "setNightMode") {
            const nightmodeEnabled = !!req2.enabled;
            nightmode.apply(nightmodeEnabled).then(function (r) {
              return sendJson(res, 200, { accepted: true, enabled: nightmodeEnabled, affected: r.affected });
            }).catch(function (e) {
              return sendJson(res, 200, { accepted: false, error: e.message });
            });
            return;
          }
```

- [ ] **Step 4：语法检查 + 跑 controlservertest**

Run: `node -e "require('./lib/control-server.cjs'); console.log('ok')"`
Expected：`ok`（模块能加载）。

Run: `node test/controlservertest.cjs`
Expected：现有断言全绿（setNightMode 的端到端测试在 Task 9 加）。

- [ ] **Step 5：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add lib/control-server.cjs && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "feat(nightmode): wire nightmodeManager into control-server (init/sync/action/close)"
```

---

## Task 9：controlservertest 加 setNightMode 断言

**Files:**
- Modify: `test/controlservertest.cjs`

- [ ] **Step 1：在 controlservertest 的 unmuteVideo 断言后加 setNightMode 测试**

读 `test/controlservertest.cjs` 第 97-101 行（unmuteVideo 断言块）。在其后插入：

```js
    // setNightMode: instant CDP path, returns {accepted, enabled, affected}, no jobId
    const nmOn = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "setNightMode", enabled: true }));
    check("setNightMode true -> 200", nmOn.status === 200);
    const nmOnJson = JSON.parse(nmOn.body);
    check("setNightMode true -> accepted boolean", typeof nmOnJson.accepted === "boolean");
    check("setNightMode true -> enabled true echoed", nmOnJson.enabled === true);
    check("setNightMode -> NO jobId (instant path)", typeof nmOnJson.jobId === "undefined");
    check("setNightMode -> has affected field", typeof nmOnJson.affected === "number");
    // state persisted to .nightmode.json (status reads file as single source of truth)
    const stAfter = JSON.parse((await httpReq("GET", base + "/api/status")).body);
    check("setNightMode persists to status.nightmode.enabled", stAfter.nightmode && stAfter.nightmode.enabled === true);
    // toggle off
    const nmOff = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "setNightMode", enabled: false }));
    const nmOffJson = JSON.parse(nmOff.body);
    check("setNightMode false -> enabled false echoed", nmOffJson.enabled === false);
```

> 注：`affected` 在测试环境（无 ZCode/webview）会是 0（registered Map 为空），这正常——测的是"action 被接受 + 状态持久化"，不是"真注入了"（那靠真机验）。

- [ ] **Step 2：运行测试确认通过**

Run: `node test/controlservertest.cjs`
Expected：所有断言绿（含新增 setNightMode）。

> 若 `stAfter.nightmode` 为 undefined：说明 status.cjs 还没加 nightmode 项（Task 10）。这是预期的 task 顺序依赖——**先做 Task 10 再回头跑这条**，或本 task 先注释掉 nightmode status 断言，Task 10 后取消注释。推荐：先做 Task 10。

**实际执行顺序调整：** Task 9 和 Task 10 有依赖（9 测 status.nightmode，10 才加它）。执行时**先做 Task 10（status.cjs）再做 Task 9 的 status 断言行**，或把 Task 9 拆成"action 断言（先）"+"status 断言（Task 10 后）"。为保持 plan 线性，下面 Task 10 紧接，之后回跑 Task 9 验证。

- [ ] **Step 3：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add test/controlservertest.cjs && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "test(nightmode): add setNightMode action assertions"
```

---

## Task 10：status.cjs 加 `nightmode` probe 项

**Files:**
- Modify: `lib/status.cjs`
- Modify: `test/statustest.cjs`

**对齐 `probeRotate` 的模式**（status.cjs:133-149）。

- [ ] **Step 1：在 statustest 加 nightmode probe 测试**

读 `test/statustest.cjs`，在 `probeRotate` 测试块**之后**（第 86 行 `try { fs.rmSync...` 之前）插入：

```js
  // === probeNightmode (spec §8): reads .nightmode.json ===
  const nmRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nm-root-"));
  // (1) no state file -> enabled false
  var nmNoFile = await status.probeNightmode(nmRoot);
  check("probeNightmode: no file -> enabled false", nmNoFile.enabled === false);
  // (2) enabled true persisted
  const nm = require("../lib/webview-nightmode.cjs");
  nm.writeState(path.join(nmRoot, nm.STATE_FILENAME), { enabled: true, updatedAt: 1719200000000 });
  var nmOn = await status.probeNightmode(nmRoot);
  check("probeNightmode: enabled true read back", nmOn.enabled === true);
  check("probeNightmode: updatedAt read back", nmOn.updatedAt === 1719200000000);
  try { fs.rmSync(nmRoot, { recursive: true, force: true }); } catch (e) {}
```

并在 snapshot 测试区（第 51 行 `const s = await status.snapshot(...)` 之后）加：
```js
  check("snapshot includes nightmode field", typeof s.nightmode === "object" && s.nightmode !== null);
  check("snapshot nightmode.enabled is boolean", typeof s.nightmode.enabled === "boolean");
```

- [ ] **Step 2：运行测试确认失败（probeNightmode 未定义）**

Run: `node test/statustest.cjs`
Expected：FAIL——`status.probeNightmode is not a function`。

- [ ] **Step 3：在 status.cjs 加 probeNightmode**

在 `lib/status.cjs` 的 `module.exports` 行加 `probeNightmode`（在 `probeRotate` 后）：
```js
module.exports = { alphaToOpacityPct, opacityPctToAlpha, mergeProbeResults, snapshot, probeResources, classifyTransparent, probeTransparent, probeRotate, probeNightmode };
```

在 `probeRotate` 函数**之后**（snapshot 函数之前）插入：

```js
// ---- nightmode probe (spec §8) — reads .nightmode.json (file = single source of truth) ----
async function probeNightmode(root) {
  const nm = require("./webview-nightmode.cjs");
  const state = nm.readState(path.join(root, nm.STATE_FILENAME));
  return { enabled: !!state.enabled, updatedAt: state.updatedAt || null };
}
```

并在 `mergeProbeResults` 的循环数组加 `"nightmode"`（在 `"rotate"` 后）：
```js
  for (const k of ["zcode", "wallpaper", "transparent", "reader", "resources", "rotate", "nightmode"]) {
```

在 `snapshot` 函数加 probe 调用（在 `try { parts.rotate = await probeRotate(root); }` 块之后）：
```js
  // nightmode (file-based state; null if probe throws — shouldn't, but be safe)
  try { parts.nightmode = await probeNightmode(root); }
  catch (e) { parts.nightmode = null; parts.nightmodeError = e.message; }
```

- [ ] **Step 4：运行测试确认通过**

Run: `node test/statustest.cjs`
Expected：`0 failed`（含新 probeNightmode + snapshot nightmode 断言）。

- [ ] **Step 5：回跑 Task 9 的 controlservertest（status 断言现在应绿）**

Run: `node test/controlservertest.cjs`
Expected：全绿（含 `setNightMode persists to status.nightmode.enabled`）。

- [ ] **Step 6：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add lib/status.cjs test/statustest.cjs && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "feat(nightmode): add nightmode probe to status snapshot"
```

---

## Task 11：status-view.js 加夜间模式行 + 测试

**Files:**
- Modify: `control/lib/status-view.js`
- Modify: `test/statusviewtest.cjs`

- [ ] **Step 1：在 statusviewtest 加 nightmode 行断言**

在 `test/statusviewtest.cjs` 的 `console.log` 行**之前**插入：

```js
// === nightmode row (spec §9 status display) ===
const nmOn = sv.renderStatus({
  zcode: { running: true }, wallpaper: { mode: "none" }, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  nightmode: { enabled: true, updatedAt: 1719216000000 },
  rotate: { running: false }, _meta: { probeErrors: [] },
});
check("render nightmode on shows 夜间", nmOn.indexOf("夜间") !== -1);
check("render nightmode on shows 开", nmOn.indexOf("开") !== -1);

const nmOff = sv.renderStatus({
  zcode: null, wallpaper: null, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  nightmode: { enabled: false, updatedAt: null },
  rotate: { running: false }, _meta: { probeErrors: [] },
});
check("render nightmode off shows 关", nmOff.indexOf("关") !== -1);

const nmNull = sv.renderStatus({
  zcode: null, wallpaper: null, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  nightmode: null,
  rotate: { running: false }, _meta: { probeErrors: [{ item: "nightmode" }] },
});
check("render nightmode null shows placeholder", nmNull.indexOf("—") !== -1);
```

- [ ] **Step 2：运行测试确认失败（nightmode 行没渲染）**

Run: `node test/statusviewtest.cjs`
Expected：FAIL——nightmode "开"/"关"/placeholder 断言红。

- [ ] **Step 3：在 renderStatus 加 nightmode 行**

在 `control/lib/status-view.js` 的 `renderStatus` 函数里，定位 rotateHtml 计算块之后、`return` 之前，插入：

```js
  var nm = st.nightmode;
  var nmHtml;
  if (!nm) nmHtml = '<span class="muted">—</span>';
  else nmHtml = '夜间模式: ' + (nm.enabled ? '<span class="ok">开</span>' : '<span class="muted">关</span>');
```

并在 return 的 HTML 拼接里加一行（在 rotateHtml 那行之后）：
```js
    '<div class="st">' + nmHtml + '</div>' +
```

- [ ] **Step 4：运行测试确认通过**

Run: `node test/statusviewtest.cjs`
Expected：`0 failed`。

- [ ] **Step 5：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add control/lib/status-view.js test/statusviewtest.cjs && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "feat(nightmode): render nightmode row in status panel"
```

---

## Task 12：前端 UI（按钮 + control.js 交互）

**Files:**
- Modify: `control/index.html`
- Modify: `control/control.js`

- [ ] **Step 1：在 index.html #actions 加按钮**

在 `control/index.html` 定位 `<button data-action="unmuteVideo">🔊 取消静音</button>` 行，在其后加：

```html
    <button data-action="toggleNightMode">🌙 夜间模式</button>
```

- [ ] **Step 2：在 control.js poll 加按钮状态更新**

在 `control/control.js` 定位 poll 函数里更新 mute/unmute 按钮的块（`if (unmuteBtn) unmuteBtn.disabled = ...` 之后）。在那之后插入：

```js
      // night mode button: text reflects on/off, disabled when debug port closed
      var nm = st.nightmode || {};
      lastNightEnabled = !!nm.enabled;
      var nmBtn = document.querySelector('[data-action="toggleNightMode"]');
      if (nmBtn) {
        nmBtn.disabled = !cdpOk;
        nmBtn.textContent = nm.enabled ? "🌙 夜间模式: 开" : "🌙 夜间模式: 关";
      }
```

并在 poll 函数**外部**（IIFE 顶部 `var POLL_MS` 附近）加模块级缓存变量：
```js
  var lastNightEnabled = false;  // cached from last poll for toggle click handler
```

- [ ] **Step 3：在 control.js 点击处理加 toggleNightMode 分支**

在 `control/control.js` 的 `actions` click 监听里（`if (action === "setTransparent")` 块附近），加一个分支：

```js
    } else if (action === "toggleNightMode") {
      finalAction = "setNightMode";
      params = { enabled: !lastNightEnabled };
```

（放在 `startRotate` 分支之后、`else { params = {}; }` 之前。）

并在 dispatchAction 的 `.then` 回调里，对 setNightMode 的响应加消息处理。定位现有 `.then(function (res) {...})`，在 mute/unmute 的 `else if (typeof res.json.muted === "boolean")` 分支**之后**加：

```js
        else if (typeof res.json.enabled === "boolean") setJobMsg(res.json.enabled ? "夜间模式已开（" + res.json.affected + " 窗口）" : "夜间模式已关");
```

- [ ] **Step 4：语法检查**

Run: `node -e "require('fs').readFileSync('control/control.js','utf8'); console.log('control.js readable')"` + `node -e "require('fs').readFileSync('control/lib/status-view.js','utf8'); console.log('ok')"`
Expected：都打印 ok（纯语法可读性检查，前端 JS 不 require）。

- [ ] **Step 5：跑全测试链确认无回归**

Run: `npm test`
Expected：全绿。

- [ ] **Step 6：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add control/index.html control/control.js && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "feat(nightmode): add toggle button + control.js wiring"
```

---

## Task 13：AGENTS.md 文档

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1：在 AGENTS.md 加"webview 网页夜间模式"章节**

在 `AGENTS.md` 找到 "## webview `_blank` 链接修复（同窗口跳转）" 章节**之后**（或文件末尾合适位置），插入新章节：

````markdown
---

## webview 网页夜间模式（深黑主题）

第九种能力。和第八种（webview `_blank` 修复）**同层同型**：都是 control-server 轮询注册 webview
target、用 CDP 把 JS 注入外部网页。差别只有一处——夜间模式有**开/关两态**（blankfix 无状态永远注入）。

### 为什么能做（复用 blankfix 通路，不赌）

`lib/webview-blankfix.cjs` 已真机验 `Page.addScriptToEvaluateOnNewDocument` 在 webview target 上
生效（教训 28）。夜间模式挂同一层：把"建深黑 `<style>`"的 JS 注进去即可，载体完全复用。**唯一新增
的未验点**是 `Page.removeScriptToEvaluateOnNewDocument`（关闭时移除注册脚本），见下面"命门"。

### 模块定位（完全对称 blankfix）

`lib/webview-nightmode.cjs` 是**写操作**模块（改网页背景），独立成模块**不塞进 cdp.cjs**（只读模块）。
但**复用** cdp.cjs 的 `connect`/`httpGetJson` 中性工具（教训 1：复用连接逻辑，不是复用"只读"语义）。
和 blankfix 互不耦合，但 `filterWebviewTargets` 的 15 行规则**逐字复制**（靠三方镜像测试钉一致）。

### 注入内容（深黑 CSS）

`NIGHTMODE_CSS` 宽覆盖常见文本容器（`.main-content`/`.post-content`/`pre`/`article` 等），
全 `!important` 盖站点内联样式（如 cool18 的 `#E6E6DD`）。**不碰图片/表单控件/iframe**（有意为之，
避免误伤）。对纯文字站效果好，对复杂图文站可能异常（已知遗留）。

### 开关状态管理（与 blankfix 的核心差异）

- 状态存 `.nightmode.json`（对称 `.rotate.json`，gitignore）。`apply` 写、status 读，单向数据流。
- 开启：对每个 webview target `addScriptToEvaluateOnNewDocument`（拿 scriptId 存 Map）+ 当前页
  立即 `Runtime.evaluate`（覆盖当前已加载页）。
- 关闭：`removeScriptToEvaluateOnNewDocument`（阻未来页）+ `Runtime.evaluate` 删当前页 style（立即变浅）。

### 命门：`removeScriptToEvaluateOnNewDocument` 在 webview 上是否生效（必须真机验）

教训 28 明确：CDP 对 webview 的支持是子集，page target 上 work 的 API webview 上不一定。
`addScript` 已验生效（blankfix），但 `removeScript` **没验过**。万一不生效，关闭后当前页变浅了但
下次导航又变深。**兜底**：若 remove 不灵，关闭时直接断 ws（CDP 连接断开自动清所有注册脚本）。
实施第一步写真机探测脚本验 remove 生效，不灵则改用断 ws 兜底。

### 已知遗留

- **宽覆盖 CSS 对复杂图文站可能异常**：带彩色 banner/深色设计站可能显示错乱。简化版夜间模式的
  固有代价（没做完整 Dark Reader）。遇具体站显示坏可临时关掉。
- **不覆盖图片/表单控件**：某站输入框在深底下看不清是已知边界。
- **首次开启有最多 3 秒延迟**：轮询架构限制，hook 装上后永久有效（同 blankfix）。
- **不带 debug port 则失效**：CDP 连不上则 nightmode 完全失效（所有 CDP 能力同前提）。前端按钮在
  status.zcode 为 null 时禁用。

### 教训补丁 29：`removeScriptToEvaluateOnNewDocument` 在 webview 上必须单独真机验

教训 28 的同型应用：每个"webview target + 某 CDP API"组合都要单独验，不能假设 page target 上
work 的 webview 上也 work。`addScriptToEvaluateOnNewDocument` 已验生效，但它的对偶
`removeScriptToEvaluateOnNewDocument` 是**独立的未验点**——两者是不同 API，一个生效不代表另一个生效。
设计时必须预设"可能不生效"并准备兜底（断 ws 清注册脚本），不能赌它 work。
````

- [ ] **Step 2：提交**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add AGENTS.md && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "docs(agents): add webview night-mode chapter + lesson 29"
```

---

## Task 14：真机验证（命门 + 端到端）

**Files:** 无（人工验证 + 探测脚本）

**这是跨进程胶水的验证（教训 12/13/28/29）。单测全绿 ≠ 真跑得通。** 必须真机跑一遍。

- [ ] **Step 1：命门探测——验 `removeScriptToEvaluateOnNewDocument` 在 webview 生效**

写一次性探测脚本 `scripts/probe-remove-script.cjs`（验完可删，不入仓库）：
- 连一个 webview target
- `Page.enable` → `addScriptToEvaluateOnNewDocument`（注入一个 marker，如建 `window.__probeMarker`）
- 导航到新页 → 确认 marker 出现（addScript 生效）
- `removeScriptToEvaluateOnNewDocument(identifier)` → 再导航到另一新页 → 确认 marker **不出现**

若 marker 仍出现 → remove 不生效 → **改 apply(false) 为"断 ws"兜底**（Task 5 的 apply 关闭分支改：
`entry.ws.close()` + `registered.delete(id)`，而非 removeScript）。改完重跑探测确认。

- [ ] **Step 2：启 control-server + ZCode（带 9222）**

通过 `wallpaper.bat` 场景 13（控制中心）或直接 `node lib/control-server.cjs` + 带 debug port 的 ZCode。
确认 `/api/status` 返回 `nightmode.enabled: false`（默认关）。

- [ ] **Step 3：webview 打开浅色长文站，点"开启"**

在 ZCode webview 打开 cool18 帖子页（或任意浅色长文站）。控制中心点"🌙 夜间模式"。
Expected：≤3 秒内当前页变深黑（背景 `#1a1a1a`、文字 `#d4d4d4`、链接变亮蓝）。

- [ ] **Step 4：webview 内导航到新页**

点站内一个链接导航到新页。Expected：新页**自动**深黑（验 addScript 跨导航生效）。

- [ ] **Step 5：点"关闭"，验当前页 + 未来页都变浅**

控制中心点"🌙 夜间模式: 开"关闭。Expected：
- 当前页立即变回浅色（验 Runtime.evaluate 删 style 生效）
- 再导航到新页 → 新页是**浅色**（验 removeScriptToEvaluateOnNewDocument 生效——**命门**）

若新页仍深黑 → 命门失败，按 Step 1 兜底改断 ws，重验。

- [ ] **Step 6：重启 control-server，验状态持久化**

关掉 control-server，重开。Expected：夜间模式状态 = 上次的值（`.nightmode.json` 持久化）。
webview 新开标签 ≤3 秒后按持久化状态生效。

- [ ] **Step 7：关 webview 标签，验 sync 自愈**

关掉一个 webview 标签。Expected：control-server 日志不报错、无 ws 泄漏（sync 自动清理）。
重开标签 ≤3 秒后重新生效。

- [ ] **Step 8：debug port 不通时验按钮禁用**

普通方式启 ZCode（不带 9222）。Expected：控制中心"🌙 夜间模式"按钮禁用（status.zcode 为 null）。

- [ ] **Step 9：清理一次性探测脚本**

```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" status --porcelain
```
若有未跟踪的 `scripts/probe-remove-script.cjs`，删除它（不入仓库）。

- [ ] **Step 10：若命门兜底触发了，提交兜底改动**

仅当 Step 1/5 触发了"断 ws 兜底"改动时：
```bash
git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" add lib/webview-nightmode.cjs && git -C "C:/Users/johnl/ZCodeProject/zcode-wallpaper" commit -m "fix(nightmode): fallback to ws-close on removeScript failure (lesson 29)"
```

---

## 完成标准

- [ ] `npm test` 全绿（含 webviewnightmodetest + 扩展的 statustest/statusviewtest/controlservertest）
- [ ] Task 14 真机验证全通过（尤其命门 Step 5：关闭后未来页变浅）
- [ ] AGENTS.md 章节就位
- [ ] 所有改动已提交到 `feat/webview-nightmode` 分支

---

## Self-Review 记录（plan 作者自审，执行时跳过）

**Spec 覆盖检查：**
- §1 目标（深黑 + 持久化）→ Task 2(CSS) + Task 4(state) + Task 5(apply) ✓
- §2 方案 A 独立模块 → Task 2(create module) ✓
- §3 注入脚本 → Task 2(NIGHTMODE_SOURCE) + Task 6(fake DOM 语义) ✓
- §3.1 CSS → Task 2 ✓
- §3.2 不覆盖元素 → Task 2 CSS（不含 img/input 选择器）✓
- §4 架构 → Task 2/5 ✓
- §5 filterWebviewTargets + 三方镜像 → Task 3 ✓
- §6 manager + 状态 → Task 4(state) + Task 5(manager) ✓
- §7 control-server 集成 → Task 8 ✓
- §8 status.cjs → Task 10 ✓
- §9 前端 → Task 11(status-view) + Task 12(button/control.js) ✓
- §10 命门 + 已知遗留 → Task 14(真机验) + Task 13(AGENTS.md 文档) ✓
- §11 测试策略 → Task 6/7/9/10/11 ✓
- §12 实现清单 → 全覆盖 ✓

**Placeholder 扫描：** 无 TBD/TODO，每个代码步骤都有完整代码。

**类型一致性：** `init`/`sync`/`apply`/`close` 在 Task 5 定义、Task 8 调用——签名一致（`init(statePath)`、`sync()`、`apply(enabled)→{affected}`、`close()`）。`STATE_FILENAME` 在 Task 4 定义、Task 8/10 引用一致。`filterWebviewTargets` 在 Task 3 定义、Task 5(sync 内)调用一致。

**Task 9/10 顺序依赖**已在 Task 9 Step 2 明确标注（执行时先 Task 10 再回跑 Task 9 status 断言）。
