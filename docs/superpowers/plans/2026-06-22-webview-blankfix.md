# webview `_blank` 链接同窗口跳转修复 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 ZCode webview 里 `target="_blank"` 链接点击无反应的问题——让所有非工具页 webview 的 `_blank` 链接自动改为同窗口跳转。

**Architecture:** control-server 后台每 3 秒轮询 `/json`，发现新 webview target 就用 CDP 连上、`Page.addScriptToEvaluateOnNewDocument` 注册一段剥离脚本（剥现有 + MutationObserver + capture click 三道关），保持长连接。脚本在每次新文档加载前自动执行，无空窗。新模块 `lib/webview-blankfix.cjs`（写操作独立成模块，对齐 `video-mute.cjs`，复用 `cdp.cjs` 中性工具）。

**Tech Stack:** Node.js, CDP (Chrome DevTools Protocol) over WebSocket, `ws` 库（已有依赖）。

**Spec:** `docs/superpowers/specs/2026-06-22-webview-blankfix-design.md`

---

## 文件结构

| 文件 | 责任 | 动作 |
|------|------|------|
| `lib/webview-blankfix.cjs` | WEBVIEW_BLANKFIX_SOURCE 常量 + filterWebviewTargets 纯函数 + blankfixManager(sync/close) | 新建 |
| `test/webviewblankfixtest.cjs` | 纯函数 + SOURCE 常量 + fake DOM 测 SOURCE 语义 | 新建 |
| `lib/control-server.cjs` | createServer 启动 setInterval(sync, 3000) + close() 调 blankfix.close() | 修改 |
| `control/index.html` | 书签区条件渲染一行提示（debug port 不通时） | 修改 |
| `package.json` | test 链加 `webviewblankfixtest` | 修改 |
| `AGENTS.md` | 新增"webview `_blank` 修复"章节 + 教训补丁 28 | 修改 |
| `scripts/test-blank-rewrite.cjs`, `install-blank-fix.cjs`, `check-blank-hook.cjs` | 一次性手测脚本 | 删除 |
| `scripts/inspect-newwindow.cjs`, `test-addscript-newdoc.cjs` | 命门探测脚本 | 保留 |

---

## Task 1: 创建 webview-blankfix.cjs 骨架 + SOURCE 常量

**Files:**
- Create: `lib/webview-blankfix.cjs`

- [ ] **Step 1: 创建文件，写入 SOURCE 常量 + 模块导出骨架**

创建 `lib/webview-blankfix.cjs`：

```js
// webview _blank link fix (spec 2026-06-22-webview-blankfix-design).
// WHY a separate module (not in cdp.cjs): cdp.cjs is READ-ONLY by design
// (AGENTS.md). Stripping target=_blank is a WRITE op. Keeping it out of cdp.cjs
// preserves the read-only invariant — mirrors video-mute.cjs's positioning.
// But this module REUSES cdp.connect + cdp.httpGetJson (neutral plumbing) —
// no duplicated CDP glue (教训 1).

// JS injected into every non-tool webview page via
// Page.addScriptToEvaluateOnNewDocument. Runs before each new document load.
// Three guarantees (spec §3):
//   1. Strip existing <a target=_blank> on current doc
//   2. MutationObserver catches dynamically-rendered links (SPA)
//   3. capture-phase click catches links added after observer setup
// Idempotent via window.__zzBlankFix guard (prevents observer pile-up on rerun).
const WEBVIEW_BLANKFIX_SOURCE = [
  "(function(){",
  "  if(window.__zzBlankFix)return;",
  "  window.__zzBlankFix=true;",
  "  window.__zzBlankFixCount=0;",
  "  function strip(a){",
  "    if(a&&a.tagName==='A'&&",
  "       (a.getAttribute('target')==='_blank'||a.target==='_blank')){",
  "      a.removeAttribute('target');",
  "      window.__zzBlankFixCount++;",
  "    }",
  "  }",
  "  var all=document.querySelectorAll('a[target=\"_blank\"]');",
  "  for(var i=0;i<all.length;i++)strip(all[i]);",
  "  new MutationObserver(function(muts){",
  "    for(var i=0;i<muts.length;i++){",
  "      for(var j=0;j<muts[i].addedNodes.length;j++){",
  "        var n=muts[i].addedNodes[j];",
  "        if(n.nodeType!==1)continue;",
  "        if(n.tagName==='A')strip(n);",
  "        if(n.querySelectorAll){",
  "          var inner=n.querySelectorAll('a[target=\"_blank\"]');",
  "          for(var k=0;k<inner.length;k++)strip(inner[k]);",
  "        }",
  "      }",
  "    }",
  "  }).observe(document.documentElement,{childList:true,subtree:true});",
  "  document.addEventListener('click',function(e){",
  "    try{",
  "      var a=e.target&&e.target.closest?e.target.closest('a'):null;",
  "      if(a)strip(a);",
  "    }catch(x){}",
  "  },true);",
  "})();"
].join("\n");

module.exports = { WEBVIEW_BLANKFIX_SOURCE: WEBVIEW_BLANKFIX_SOURCE };
```

- [ ] **Step 2: 验证文件能加载且 SOURCE 含关键字**

Run: `node -e "const m=require('./lib/webview-blankfix.cjs'); const s=m.WEBVIEW_BLANKFIX_SOURCE; ['__zzBlankFix','removeAttribute','MutationObserver','addEventListener'].forEach(k=>{if(s.indexOf(k)<0)throw new Error('missing '+k)}); console.log('OK, '+s.length+' chars')"` (in `e:\zcode-wallpaper`)

Expected: `OK, <number> chars`

- [ ] **Step 3: 提交**

```bash
git add lib/webview-blankfix.cjs
git commit -m "feat(blankfix): add WEBVIEW_BLANKFIX_SOURCE injection constant"
```

---

## Task 2: 实现 filterWebviewTargets 纯函数

**Files:**
- Modify: `lib/webview-blankfix.cjs`

- [ ] **Step 1: 在 module.exports 之前加入 filterWebviewTargets 函数**

在 `lib/webview-blankfix.cjs` 的 `module.exports` 行**之前**插入：

```js
// Pure: filter /json targets to "real external-site webviews" (spec §5).
// Mirrors cdp.cjs filterTargets' exclusion rules (devtools + our tool pages)
// but on type==="webview" instead of type==="page". Kept in sync by
// webviewblankfixtest.cjs mirror-consistency assertion (教训 17).
// Excludes: non-webview types, no wsUrl, devtools://, localhost/127.0.0.1
// any-port /control/ /reader/ /api/ paths.
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

- [ ] **Step 2: 更新 module.exports 导出 filterWebviewTargets**

把 `module.exports` 那行替换为：

```js
module.exports = { WEBVIEW_BLANKFIX_SOURCE: WEBVIEW_BLANKFIX_SOURCE,
  filterWebviewTargets: filterWebviewTargets };
```

- [ ] **Step 3: 手动验证基本过滤**

Run: `node -e "const m=require('./lib/webview-blankfix.cjs'); const r=m.filterWebviewTargets([{type:'webview',url:'https://x.com/',webSocketDebuggerUrl:'ws://x'},{type:'page',url:'https://y.com/',webSocketDebuggerUrl:'ws://y'},{type:'webview',url:'http://127.0.0.1:17890/control/',webSocketDebuggerUrl:'ws://z'}]); console.log('kept:',r.length,'url:',r[0]&&r[0].url)"` (in `e:\zcode-wallpaper`)

Expected: `kept: 1 url: https://x.com/`

- [ ] **Step 4: 提交**

```bash
git add lib/webview-blankfix.cjs
git commit -m "feat(blankfix): add filterWebviewTargets pure function"
```

---

## Task 3: 写 webviewblankfixtest.cjs（filterWebviewTargets 全测 + SOURCE 断言）

**Files:**
- Create: `test/webviewblankfixtest.cjs`

- [ ] **Step 1: 创建测试文件，含 filterWebviewTargets 全 case + SOURCE 常量断言**

创建 `test/webviewblankfixtest.cjs`（模仿 `test/videomutetest.cjs` 风格——`new Function` + 手写 fake DOM，不引入 jsdom）：

```js
// Test lib/webview-blankfix.cjs pure helpers (spec §3/§5/§8).
const bf = require("../lib/webview-blankfix.cjs");
const cdp = require("../lib/cdp.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// === filterWebviewTargets (spec §5) ===
function mkWv(url, id) { return { type: "webview", id: id || "wv1", url: url, webSocketDebuggerUrl: "ws://x/" + (id || "wv1") }; }
function mkPage(url, id) { return { type: "page", id: id || "p1", url: url, webSocketDebuggerUrl: "ws://x/" + (id || "p1") }; }

// 排除非 webview 类型
check("reject page type", bf.filterWebviewTargets([mkPage("https://x.com/")]).length === 0);
check("reject iframe type", bf.filterWebviewTargets([{ type: "iframe", url: "https://x.com/", webSocketDebuggerUrl: "ws://x" }]).length === 0);
check("reject worker type", bf.filterWebviewTargets([{ type: "worker", url: "", webSocketDebuggerUrl: "ws://x" }]).length === 0);

// 排除无 wsUrl
check("reject no wsUrl", bf.filterWebviewTargets([{ type: "webview", url: "https://x.com/" }]).length === 0);

// 排除 devtools://
check("reject devtools url", bf.filterWebviewTargets([mkWv("devtools://devtools/bundled/shell.html")]).length === 0);

// 排除工具页 (localhost/127.0.0.1 任意端口 + 工具路径)
check("reject /control/ on localhost", bf.filterWebviewTargets([mkWv("http://localhost:17890/control/")]).length === 0);
check("reject /control/ on 127.0.0.1", bf.filterWebviewTargets([mkWv("http://127.0.0.1:17890/control/")]).length === 0);
check("reject /reader/ on localhost", bf.filterWebviewTargets([mkWv("http://localhost:17890/reader/")]).length === 0);
check("reject /api/ on localhost", bf.filterWebviewTargets([mkWv("http://localhost:17890/api/books")]).length === 0);
check("reject /control/index.html", bf.filterWebviewTargets([mkWv("http://127.0.0.1:17890/control/index.html")]).length === 0);
check("reject different port still tool page", bf.filterWebviewTargets([mkWv("http://127.0.0.1:17891/control/")]).length === 0);

// 保留外部站
check("keep external https", bf.filterWebviewTargets([mkWv("https://open.bigmodel.cn/")]).length === 1);
check("keep external http", bf.filterWebviewTargets([mkWv("http://example.com/path?q=1")]).length === 1);

// 边界：url 为空但有 wsUrl（刚创建还没导航的 webview）
check("keep webview with empty url", bf.filterWebviewTargets([{ type: "webview", id: "wv1", url: "", webSocketDebuggerUrl: "ws://x/wv1" }]).length === 1);

// 不误杀 localhost 非工具路径（如用户本地其他服务）
check("keep localhost non-tool path", bf.filterWebviewTargets([mkWv("http://localhost:3000/app")]).length === 1);

// 混合场景
var mixed = [
  mkPage("https://a.com/"),                                  // page → reject
  mkWv("https://open.bigmodel.cn/"),                         // external → keep
  mkWv("http://127.0.0.1:17890/control/"),                   // tool → reject
  mkWv("devtools://x"),                                      // devtools → reject
  { type: "webview", id: "w", url: "", webSocketDebuggerUrl: "ws://x/w" } // empty url → keep
];
check("mixed: keep 2 of 5", bf.filterWebviewTargets(mixed).length === 2);

// === 镜像一致性断言 (教训 17): cdp.filterTargets 和 filterWebviewTargets
// 排除的工具页/devtools 集合完全相同，只是类型维度不同 ===
var mirrorTargets = [
  { type: "page", id: "p1", url: "https://a.com/", webSocketDebuggerUrl: "ws://x/p1" },
  { type: "webview", id: "w1", url: "https://a.com/", webSocketDebuggerUrl: "ws://x/w1" },
  { type: "page", id: "p2", url: "http://127.0.0.1:17890/control/", webSocketDebuggerUrl: "ws://x/p2" },
  { type: "webview", id: "w2", url: "http://127.0.0.1:17890/control/", webSocketDebuggerUrl: "ws://x/w2" },
  { type: "page", id: "p3", url: "devtools://x", webSocketDebuggerUrl: "ws://x/p3" },
  { type: "webview", id: "w3", url: "devtools://x", webSocketDebuggerUrl: "ws://x/w3" }
];
var pageKept = cdp.filterTargets(mirrorTargets).map(function (t) { return t.url; }).sort();
var wvKept = bf.filterWebviewTargets(mirrorTargets).map(function (t) { return t.url; }).sort();
check("mirror: page and webview keep same URL set", JSON.stringify(pageKept) === JSON.stringify(wvKept));
check("mirror: both keep https://a.com/", pageKept.length === 1 && pageKept[0] === "https://a.com/");

// === WEBVIEW_BLANKFIX_SOURCE 关键字断言 (spec §8) ===
var src = bf.WEBVIEW_BLANKFIX_SOURCE;
check("SOURCE: contains __zzBlankFix (idempotency guard)", src.indexOf("__zzBlankFix") !== -1);
check("SOURCE: contains removeAttribute('target')", src.indexOf("removeAttribute('target')") !== -1);
check("SOURCE: contains MutationObserver", src.indexOf("MutationObserver") !== -1);
check("SOURCE: contains addEventListener('click'", src.indexOf("addEventListener('click'") !== -1);
check("SOURCE: contains childList:true,subtree:true", src.indexOf("childList:true,subtree:true") !== -1);
check("SOURCE: is IIFE", /^\(function\(\)\{[\s\S]*\}\)\(\);?\s*$/.test(src.trim()));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: 运行测试，验证全部通过**

Run: `node test/webviewblankfixtest.cjs` (in `e:\zcode-wallpaper`)

Expected: 全部 `PASS ✓`，最后一行 `<N> passed, 0 failed`

- [ ] **Step 3: 提交**

```bash
git add test/webviewblankfixtest.cjs
git commit -m "test(blankfix): add filterWebviewTargets + SOURCE constant tests"
```

---

## Task 4: 测试 SOURCE 脚本语义（fake DOM 跑剥除 + observer + 幂等）

**Files:**
- Modify: `test/webviewblankfixtest.cjs`

- [ ] **Step 1: 在 `console.log("\n"...` 之前追加 fake DOM 语义测试**

在 `test/webviewblankfixtest.cjs` 的 `console.log("\n" + pass...` 行**之前**插入：

```js

// === SOURCE 脚本语义测试 (spec §8): 用手写 fake DOM 跑 SOURCE ===
// 不引入 jsdom (YAGNI). 手写最小 fake document/window 满足 SOURCE 需求。

function makeFakeDom(initialBlanks) {
  var observerCbs = [];
  var clickListeners = [];
  var observerTarget = null;
  // create minimal <a> nodes
  var anchors = initialBlanks.map(function (i) {
    return {
      tagName: "A",
      target: "_blank",
      _attrs: { target: "_blank" },
      getAttribute: function (n) { return this._attrs[n] !== undefined ? this._attrs[n] : null; },
      removeAttribute: function (n) { delete this._attrs[n]; this.target = this._attrs.target || ""; },
      closest: function () { return this; }
    };
  });
  var body = {
    children: anchors.slice(),
    appendChild: function (n) { this.children.push(n); anchors.push(n); return n; },
    querySelectorAll: function (sel) {
      // only support a[target="_blank"]
      return anchors.filter(function (a) { return a.getAttribute("target") === "_blank"; });
    }
  };
  var fakeDoc = {
    documentElement: body,
    querySelectorAll: function (sel) { return body.querySelectorAll(sel); },
    addEventListener: function (ev, cb, opts) { if (ev === "click") clickListeners.push(cb); }
  };
  // stub MutationObserver
  var MutationObserver = function (cb) {
    observerCbs.push(cb);
    return { observe: function (target, opts) { observerTarget = target; } };
  };
  // stub window (the IIFE assigns to window.__zzBlankFix etc)
  var win = {
    __zzBlankFix: undefined,
    document: fakeDoc,
    MutationObserver: MutationObserver
  };
  return {
    win: win,
    doc: fakeDoc,
    getAnchors: function () { return anchors; },
    fireMutation: function (addedNodes) {
      observerCbs.forEach(function (cb) { cb([{ addedNodes: addedNodes }]); });
    },
    fireClick: function (target) {
      // fake event with target supporting closest('a')
      var ev = { target: target };
      clickListeners.forEach(function (cb) { try { cb(ev); } catch (e) {} });
    },
    observerInstalled: function () { return observerCbs.length > 0; }
  };
}

// 场景 1: 预置 <a target=_blank> 被剥掉
(function () {
  var dom = makeFakeDom([{}, {}, {}]);  // 3 blank anchors
  var fn = new Function("window", "document", "MutationObserver", bf.WEBVIEW_BLANKFIX_SOURCE);
  fn(dom.win, dom.doc, dom.win.MutationObserver);
  var remaining = dom.getAnchors().filter(function (a) { return a.getAttribute("target") === "_blank"; });
  check("semantics: 3 pre-existing blanks all stripped", remaining.length === 0);
})();

// 场景 2: 动态 append 的 _blank 链接被 observer 剥掉
(function () {
  var dom = makeFakeDom([]);
  var fn = new Function("window", "document", "MutationObserver", bf.WEBVIEW_BLANKFIX_SOURCE);
  fn(dom.win, dom.doc, dom.win.MutationObserver);
  check("semantics: observer installed", dom.observerInstalled());
  // simulate dynamically-added anchor
  var newAnchor = {
    tagName: "A", target: "_blank",
    _attrs: { target: "_blank" },
    getAttribute: function (n) { return this._attrs[n] !== undefined ? this._attrs[n] : null; },
    removeAttribute: function (n) { delete this._attrs[n]; this.target = this._attrs.target || ""; },
    querySelectorAll: function () { return []; },
    closest: function () { return this; }
  };
  dom.fireMutation([newAnchor]);
  check("semantics: dynamically-added blank stripped by observer", newAnchor.getAttribute("target") === null);
})();

// 场景 3: 幂等 — 重跑 SOURCE 不报错、不重复装 observer
(function () {
  var dom = makeFakeDom([]);
  var fn = new Function("window", "document", "MutationObserver", bf.WEBVIEW_BLANKFIX_SOURCE);
  fn(dom.win, dom.doc, dom.win.MutationObserver);
  var observersAfter1 = dom.win.__zzBlankFix ? 1 : 0;
  // run again (bfcache/SPA route re-trigger)
  var threw = false;
  try { fn(dom.win, dom.doc, dom.win.MutationObserver); } catch (e) { threw = true; }
  check("semantics: re-run does not throw", threw === false);
  check("semantics: idempotency guard set after first run", dom.win.__zzBlankFix === true);
})();
```

- [ ] **Step 2: 运行测试，验证新增 case 通过**

Run: `node test/webviewblankfixtest.cjs` (in `e:\zcode-wallpaper`)

Expected: 全部 `PASS ✓`（比 Task 3 多 6 个 semantics case），`0 failed`

- [ ] **Step 3: 提交**

```bash
git add test/webviewblankfixtest.cjs
git commit -m "test(blankfix): add SOURCE script semantics tests (strip/observer/idempotency)"
```

---

## Task 5: 加入 npm test 链

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 在 test 脚本末尾追加 webviewblankfixtest**

读 `package.json`，找到 `"test"` 脚本行（以 `... && node test/bookmarktest.cjs` 结尾）。把：

```
... && node test/bookmarktest.cjs
```

替换为：

```
... && node test/bookmarktest.cjs && node test/webviewblankfixtest.cjs
```

（保持 `bookmarktest` 在前、`webviewblankfixtest` 在最后，对齐 spec §9"test 链加 webviewblankfixtest"。）

- [ ] **Step 2: 验证 npm test 全链绿（此时 blankfixManager 还没实现，但纯函数测试应通过）**

Run: `npm test` (in `e:\zcode-wallpaper`)

Expected: 全部测试 PASS（含新增 `webviewblankfixtest`），无 FAIL。

- [ ] **Step 3: 提交**

```bash
git add package.json
git commit -m "test: add webviewblankfixtest to npm test chain"
```

---

## Task 6: 实现 blankfixManager（sync + close）

**Files:**
- Modify: `lib/webview-blankfix.cjs`

- [ ] **Step 1: 在 filterWebviewTargets 之后、module.exports 之前插入 blankfixManager**

在 `lib/webview-blankfix.cjs` 的 `module.exports` 行**之前**插入：

```js

// ---- stateful manager (NOT unit-tested — cross-process CDP glue, 教训 12/13) ----
// Maintains Map<targetId, {ws, call}>. sync() diffs current /json vs registered
// set: connects+registers new targets, disconnects gone ones. ws break auto-
// removes from map (next sync reconnects). close() tears down everything.
//
// WHY no test: connect/ws lifecycle is cross-process glue. Verified by real-
// machine checklist (spec §8). Mirrors video-mute.cjs's setVideoMuted being
// untested (only buildMuteExpression pure fn is tested).

const registered = new Map(); // targetId -> {ws, call}

async function registerTarget(cdp, target) {
  const connected = await cdp.connect(target.webSocketDebuggerUrl);
  const ws = connected.ws;
  const call = connected.call;
  // Page.enable is prerequisite for addScriptToEvaluateOnNewDocument (CDP docs)
  await call("Page.enable");
  // Register script for ALL FUTURE new documents (no空窗 across navigations)
  await call("Page.addScriptToEvaluateOnNewDocument", { source: WEBVIEW_BLANKFIX_SOURCE });
  // ALSO run once on current doc — addScriptToEvaluateOnNewDocument only fires
  // on FUTURE docs, but the user's _blank links are on the CURRENT doc right now
  // (spec §6 决策 4 — this is what makes the user's complaint actually get fixed)
  await call("Runtime.evaluate", { expression: WEBVIEW_BLANKFIX_SOURCE });
  // auto-remove on disconnect (webview crash/session lost/ZCode restart)
  ws.on("close", function () { registered.delete(target.id); });
  ws.on("error", function () { registered.delete(target.id); });
  registered.set(target.id, { ws: ws, call: call });
}

async function sync() {
  const cdp = require("./cdp.cjs");
  const all = await cdp.httpGetJson("/json");
  const current = filterWebviewTargets(all);
  const currentIds = new Set(current.map(function (t) { return t.id; }));

  // register new targets (current - registered)
  for (const t of current) {
    if (registered.has(t.id)) continue;
    try { await registerTarget(cdp, t); }
    catch (e) { /* per-target fail non-fatal (mirrors video-mute.cjs) */ }
  }

  // disconnect gone targets (registered - current)
  for (const id of Array.from(registered.keys())) {
    if (!currentIds.has(id)) {
      try { registered.get(id).ws.close(); } catch (e) {}
      registered.delete(id);
    }
  }
}

function close() {
  for (const id of Array.from(registered.keys())) {
    try { registered.get(id).ws.close(); } catch (e) {}
    registered.delete(id);
  }
}

// reset for test isolation (not exported in prod, but harmless)
function _reset() { for (const id of Array.from(registered.keys())) registered.delete(id); }
```

- [ ] **Step 2: 更新 module.exports 导出 sync/close**

把 `module.exports` 那段替换为：

```js
module.exports = {
  WEBVIEW_BLANKFIX_SOURCE: WEBVIEW_BLANKFIX_SOURCE,
  filterWebviewTargets: filterWebviewTargets,
  sync: sync,
  close: close,
  _reset: _reset
};
```

- [ ] **Step 3: 验证文件语法 OK + 既有测试仍绿**

Run: `node -e "require('./lib/webview-blankfix.cjs'); console.log('loads ok')"` (in `e:\zcode-wallpaper`)

Expected: `loads ok`

Run: `node test/webviewblankfixtest.cjs`

Expected: 全部 PASS（sync/close 不被纯函数测试覆盖，但不应破坏现有 case）

- [ ] **Step 4: 提交**

```bash
git add lib/webview-blankfix.cjs
git commit -m "feat(blankfix): add blankfixManager (sync/close) stateful CDP glue"
```

---

## Task 7: control-server 集成（启动 setInterval + close）

**Files:**
- Modify: `lib/control-server.cjs`

- [ ] **Step 1: 在 createServer 函数体里、server 变量声明后加 blankfix timer**

找到 `lib/control-server.cjs` 中这段（约 138-153 行）：

```js
    const server = http.createServer((req, res) => handle(req, res));
    let tries = 0;
    function tryListen(port) {
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && tries < 5) { tries++; tryListen(port + 1); }
        else reject(err);
      });
      server.listen(port, host, () => resolve({
        server, port: server.address().port, host, library,
        close: () => {
          if (rotateChild) { try { rotateChild.kill(); } catch (e) {} rotateChild = null; }
          server.close();
        },
      }));
    }
    tryListen(startPort);
```

替换为：

```js
    const server = http.createServer((req, res) => handle(req, res));
    // webview _blank fix: background poll registers strip-script on every
    // external webview target (spec §7). sync failure non-fatal (ZCode down /
    // debug port closed -> blankfix silently no-ops, control-server lives on,
    // mirrors status.cjs "探查失败不致命" philosophy).
    const blankfix = require("./webview-blankfix.cjs");
    const blankfixTimer = setInterval(() => { blankfix.sync().catch(() => {}); }, 3000);
    let tries = 0;
    function tryListen(port) {
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && tries < 5) { tries++; tryListen(port + 1); }
        else reject(err);
      });
      server.listen(port, host, () => resolve({
        server, port: server.address().port, host, library, blankfixTimer,
        close: () => {
          clearInterval(blankfixTimer);
          blankfix.close();
          if (rotateChild) { try { rotateChild.kill(); } catch (e) {} rotateChild = null; }
          server.close();
        },
      }));
    }
    tryListen(startPort);
```

- [ ] **Step 2: 验证 control-server 语法 + 现有 server 测试仍绿**

Run: `node -e "require('./lib/control-server.cjs'); console.log('loads ok')"` (in `e:\zcode-wallpaper`)

Expected: `loads ok`

Run: `node test/controlservertest.cjs`

Expected: 全部 PASS（blankfix 不影响 server 现有行为，timer 在 createServer 调用时才起，测试不触发）

- [ ] **Step 3: 提交**

```bash
git add lib/control-server.cjs
git commit -m "feat(blankfix): wire blankfixManager into control-server lifecycle"
```

---

## Task 8: 前端条件渲染提示（debug port 不通时）

**Files:**
- Modify: `control/index.html`

- [ ] **Step 1: 在书签面板的 bm-msg span 旁加一个条件提示元素**

找到 `control/index.html` 第 42 行：

```html
    <span id="bm-msg" class="muted"></span>
```

替换为：

```html
    <span id="bm-msg" class="muted"></span>
    <div id="bm-port-warn" class="warn" style="display:none; margin-top:8px; font-size:12px;">⚠ _blank 链接修复需 ZCode 带 debug port 启动，请从 wallpaper.bat 场景 2/13 重启</div>
```

- [ ] **Step 2: 在 control.js 的 poll() 里，根据 cdpOk 切换 #bm-port-warn 显示**

`control/control.js` 第 20 行已有 `var cdpOk = !!(st.zcode && st.zcode.running);`（debug port 通且 ZCode 运行）。在该行**之后**追加 blankfix 提示切换（复用 cdpOk，语义完全对齐——debug port 不通时 blankfix 失效）：

把 `control/control.js` 中的：

```js
      var cdpOk = !!(st.zcode && st.zcode.running);
      var cdpBtns = document.querySelectorAll('[data-action="injectImage"],[data-action="injectVideo"],[data-action="remove"]');
```

替换为：

```js
      var cdpOk = !!(st.zcode && st.zcode.running);
      // webview _blank fix availability hint (spec §7 已知遗留):
      // blankfix needs debug port. When port closed (cdpOk=false), warn user
      // that _blank links won't be fixed.
      var warnEl = document.getElementById("bm-port-warn");
      if (warnEl) warnEl.style.display = cdpOk ? "none" : "block";
      var cdpBtns = document.querySelectorAll('[data-action="injectImage"],[data-action="injectVideo"],[data-action="remove"]');
```

- [ ] **Step 3: 验证 control/index.html 结构仍正常**

Run: `node -e "const fs=require('fs'); const h=fs.readFileSync('control/index.html','utf8'); if(h.indexOf('bm-port-warn')<0)throw new Error('warn element missing'); console.log('ok')"`

Expected: `ok`

- [ ] **Step 4: 提交**

```bash
git add control/index.html control/control.js
git commit -m "feat(blankfix): conditional warn when debug port closed (blankfix inactive)"
```

---

## Task 9: 清理一次性探测脚本

**Files:**
- Delete: `scripts/test-blank-rewrite.cjs`, `scripts/install-blank-fix.cjs`, `scripts/check-blank-hook.cjs`

- [ ] **Step 1: 删除 3 个一次性脚本（保留 inspect-newwindow.cjs 和 test-addscript-newdoc.cjs）**

Run: 
```bash
git rm scripts/test-blank-rewrite.cjs scripts/install-blank-fix.cjs scripts/check-blank-hook.cjs
```

(in `e:\zcode-wallpaper`)

- [ ] **Step 2: 验证 scripts/ 目录只剩应保留的探测脚本**

Run: `ls scripts/ | grep -E "blank|newwindow|addscript|hook"`

Expected: 只剩 `inspect-newwindow.cjs` 和 `test-addscript-newdoc.cjs`（其余 blank/hook 脚本已删）

- [ ] **Step 3: 提交**

```bash
git commit -m "chore: remove one-off blankfix probe scripts (keep命门 probes)"
```

---

## Task 10: 全量回归测试 + 真机验证

**Files:**
- None (验证 only)

- [ ] **Step 1: 跑完整 npm test，确保全链绿**

Run: `npm test` (in `e:\zcode-wallpaper`)

Expected: 所有测试 PASS，含 `webviewblankfixtest`。无 FAIL。

- [ ] **Step 2: 真机验证清单（spec §8）——逐条验**

前置：确保 ZCode 带 debug port（9222）运行，control-server 运行。在 ZCode 浏览器面板打开 `https://open.bigmodel.cn/`。

1. 等 ≤3 秒，点"控制台"（`target="_blank"` 链接）→ 应**同窗口跳转**到控制台页（不开新窗口、不卡住）✅
2. 在控制台页里，再点一个 `_blank` 链接 → 应继续同窗口跳转（验 `addScriptToEvaluateOnNewDocument` 跨导航生效）✅
3. 用 `node scripts/inspect-newwindow.cjs` 确认目标 webview 仍能连、hook 在（`window.__zzBlankFix === true`）✅
4. 关闭该 webview 标签 → 观察 control-server 进程日志无 ws 错误堆积（sync 自动清理）✅
5. 重开 webview 标签打开外部站 → ≤3 秒后 `_blank` 修复重新生效 ✅
6. 重启 control-server（关窗再 `bin/reader-server.bat` 或 start.bat 重起）→ 现有 webview 重新注册，`_blank` 修复恢复 ✅

每条验过打勾。任一条 fail → 回到对应 Task 排查（不要继续往下）。

- [ ] **Step 3: 提交一个验证记录空 commit（可选，标记真机验证通过）**

```bash
git commit --allow-empty -m "verify(blankfix): 真机验证清单全部通过(同窗口跳转/跨导航/自愈/重启恢复)"
```

---

## Task 11: 更新 AGENTS.md（新章节 + 教训补丁 28）

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 在 AGENTS.md 的"书签管理"章节之后、"壁纸轮播"之前，插入新章节**

在 `AGENTS.md` 找到"## 壁纸轮播（定时随机切换）"这一行，在它**之前**插入：

```markdown
---

## webview `_blank` 链接修复（同窗口跳转）

第八种能力。和前七种**不同层**：前七种改 ZCode 某一面，这个修复的是 **ZCode 浏览器面板
（webview）里 `target="_blank"` 链接点击无反应**的问题。用户通过书签打开外部站，站里 `target="_blank"`
链接点下去完全没反应（不开新窗口、不跳转），是 webview 的硬限制。

### 根因（webview 无 allowpopups，已真机探测）

ZCode 的 `<webview>` 元素（`data-testid="browser-webview"`）**没有 `allowpopups` 属性**。
Electron webview 默认禁弹窗，所以 `target="_blank"` 点击后 host 层（app.asar）决定"不开新窗口"
且"不在 webview 内导航"——表现就是完全没反应。

这是 host 侧行为，但**我们不改 app.asar**：webview 有独立 CDP target（`type === "webview"`），
从 webview 内部页面注入 JS 剥掉 `target="_blank"` 属性即可（剥后变默认 `_self`，同窗口跳转）。

### 两个命门（都已真机验，不是赌）

1. **剥 `target="_blank"` 后同窗口跳转成功**（`scripts/inspect-newwindow.cjs` + 真机点"控制台"
   验证：78 个 `_blank` 全剥后跳转成功）
2. **`Page.addScriptToEvaluateOnNewDocument` 在 webview target 上生效**（`scripts/test-addscript-newdoc.cjs`
   验证：导航后 marker 自动出现在新文档）——这是"无空窗"的关键

### 三道关机制（`WEBVIEW_BLANKFIX_SOURCE`）

注入脚本在每次新文档加载前自动跑，三道关保证 `_blank` 必被剥：
1. **剥现有**：`document.querySelectorAll('a[target="_blank"]')` 全部 `removeAttribute`
2. **MutationObserver**：SPA 动态渲染的链接也能拦到
3. **capture-phase click 兜底**：observer 装好后才插入的链接，click 时最后一道关

幂等保护 `window.__zzBlankFix` 标志防 observer 累积（bfcache/SPA 路由重跑时）。

**不处理 `window.open()`**（已知遗留）：会破坏依赖 `window.open` 返回值的正常站点弹窗通信逻辑，
风险大于收益，YAGNI。如遇具体站点用 `window.open` 打不开，再单独处理。

### 模块定位（对齐 video-mute.cjs，复用 cdp.cjs 中性工具）

`lib/webview-blankfix.cjs` 是**写操作**模块（剥 DOM 属性），独立成模块**不塞进 cdp.cjs**
（cdp.cjs 是只读模块，AGENTS.md 明确）。但**复用** cdp.cjs 的 `connect`/`httpGetJson` 中性工具
（教训 1：复用连接逻辑，不是复用"只读"语义）。

### 后台轮询自愈（control-server 每 3 秒 sync）

control-server 启动后 `setInterval(sync, 3000)`：
- sync 调 `cdp.httpGetJson("/json")` → `filterWebviewTargets` → diff 已注册集合
- 新 target：`connect` → `Page.enable` → `addScriptToEvaluateOnNewDocument` → `Runtime.evaluate`
  （后者覆盖当前页，前者覆盖未来页）
- 消失 target：`ws.close()` + 从集合移除
- ws 断开（crash/session 失效）：`ws.on("close"/"error")` 自动移除，下次 sync 重连重注册

**去重键用 target.id 不用 url**：webview 导航时 id 不变但 url 变，用 url 会重复注册。

### target 过滤复制 cdp.filterTargets 规则（教训 17 同型）

`filterWebviewTargets` 复制 `cdp.cjs filterTargets` 的 15 行排除规则（devtools:// + 工具页路径），
但作用在 `type === "webview"` 而非 `type === "page"`。不改 filterTargets 签名（会破坏 5 个调用点），
复制更干净。**`webviewblankfixtest.cjs` 有镜像一致性断言**——同一组 target 跑两边，断言排除的
工具页集合完全相同，改一边时另一边测试会红，强迫同步。

### 已知遗留

- **不带 debug port 则失效**：用户从普通方式启 ZCode（不带 `--remote-debugging-port=9222`），
  CDP 连不上，blankfix 完全失效。这是所有 CDP 能力的共同前提（AGENTS.md "没有 startZcode
  action" 小节）。前端书签区在 status.zcode 为 null 时条件渲染一行提示。
- **`window.open()` 不处理**（见上）。
- **blankfixManager.sync/close 不单测**：跨进程 CDP 胶水（教训 12/13），靠真机验证清单钉。

### 教训补丁 28：`addScriptToEvaluateOnNewDocument` 在 Electron webview target 上生效

和 page target 行为不同，Electron 的 `<webview>` 有独立 CDP target（`type === "webview"`），
`Page.addScriptToEvaluateOnNewDocument` 在它上面**生效**——导航到新页面时注册的脚本自动执行。
这不是常识（CDP 对 webview target 的支持不完整是出了名的，很多 page target 的 API 在 webview
上不灵），是靠 `scripts/test-addscript-newdoc.cjs` 真机验出来的。记录下来防以后重踩。

教训补丁：
28. **`addScriptToEvaluateOnNewDocument` 在 Electron webview target 上生效（已验），但 CDP 对
    webview 的支持不完整，每个 API 都要单独真机验。** 不要假设 page target 上 work 的 API 在
    webview target 上也 work——Electron `<webview>` 是独立渲染进程，CDP 支持是子集且版本相关。
    任何"webview target + 某 CDP API"的组合，第一步就是写探测脚本验它生效，再基于它设计。
    这是教训 21（"应该能 X"是假设，探测真实 state 是事实）的 webview 特化版。
```

- [ ] **Step 2: 验证 AGENTS.md 仍能正常 parse（无 markdown 结构破坏）**

Run: `node -e "const fs=require('fs'); const t=fs.readFileSync('AGENTS.md','utf8'); if(t.indexOf('## webview \`_blank\` 链接修复')<0)throw new Error('section missing'); if(t.indexOf('教训补丁 28')<0)throw new Error('lesson 28 missing'); console.log('ok, '+t.length+' chars')"`

Expected: `ok, <N> chars`

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md
git commit -m "docs(agents): add webview _blank fix chapter + lesson 28"
```

---

## Self-Review（写完计划后自查）

**1. Spec coverage:**
- §1 根因/三命门 → Task 1 SOURCE + Task 6 registerTarget 体现 ✅
- §2 方案 B → Task 6 sync + addScriptToEvaluateOnNewDocument ✅
- §3 三道关 SOURCE → Task 1 + Task 4 语义测试 ✅
- §4 架构/新模块 → Task 1/2/6 ✅
- §5 filterWebviewTargets → Task 2 + Task 3 ✅
- §6 sync/close 状态管理 → Task 6 + Task 7 ✅
- §7 control-server 集成 + 前端提示 → Task 7 + Task 8 ✅
- §8 测试策略（单测 + 真机清单）→ Task 3/4/5 + Task 10 ✅
- §9 实现清单（含脚本清理）→ Task 9 ✅
- AGENTS.md 新章节 → Task 11 ✅

**2. Placeholder scan:** Task 8 Step 2 说"按 grep 结果定具体行号"——这是合理的（control.js 结构需实时探测），但给了确切代码块。不是 placeholder，是"探测后插入"。✅ 其余无 TBD/TODO。

**3. Type consistency:** `sync`/`close`/`_reset`/`filterWebviewTargets`/`WEBVIEW_BLANKFIX_SOURCE` 在所有 Task 中名称一致。`registerTarget` 是内部 helper（不导出），在 Task 6 定义一次。`blankfixTimer` 在 Task 7 定义并导出。✅

**4. 已知风险（spec §9 风险点对应）：**
- Task 10 真机清单第 1-2 条覆盖"完整 sync 序列在 webview 上生效"（风险点 1）
- Task 10 真机清单第 6 条覆盖"幂等不叠加 observer"（风险点 2，靠 `__zzBlankFix`）
- 风险点 3（新标签 vs 同 target 导航）任一情况都 work，Task 10 真机第 5 条观察
