# 控制中心 UI 改版（macOS Big Sur 玻璃拟态）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把控制中心从「5 面板单列堆叠」改版为「macOS Big Sur 玻璃拟态 + 4 Tab 分区」，统一调色板与交互反馈。

**Architecture:** 纯原生 JS + CSS（不引框架）。现有 5 个 `<div class="panel">` DOM 保留，外面包 Tab 容器；lib 渲染函数签名不动，只改返回的 HTML 的 class/结构；CSS 变量集中管理设计 token。A1 红线（`html,body{background:transparent!important}`）保留。

**Tech Stack:** 原生 JS（IIFE + 字符串拼 HTML）、原生 CSS、localStorage、SVG 图标（Lucide 风格内联）。

**Spec:** `docs/superpowers/specs/2026-07-17-control-ui-revamp-design.md`

## Global Constraints

- **A1 红线**：`control/control.css` 里 `html, body { margin: 0; height: 100%; background: transparent !important; ... }` 必须保留——壁纸靠 body 透出，这是整个设计的依据（spec §4，教训 2）。
- **数据属性不动**：`data-action`/`data-tab`/`data-field`/`data-ck`/`data-ck-text`/`data-ov-*`/`data-emoji-*`/`data-open`/`data-go`/`data-del`/`data-add`/`data-skin-act` 等所有 `data-*` 属性保留。事件委托（control.js/skin-view.js）和 `collectEditor`（skin-view.js）靠它们。
- **localStorage key**：`zcode-reader:shelf`、`zcode-control:bookmarks`、皮肤 keys 不动。新增 `zcode-control:tab`。
- **lib 渲染函数签名不动**：`renderStatus(st)`、`renderSkinPanel()`、`renderShelf()`、`renderBookmarks()` 入参/调用方式不变，只改返回的 HTML 的 class/结构。
- **测试全绿**：`npm test` 28 个文件。只有 `test/statusviewtest.cjs` 需要更新断言（Task 4、Task 8）。其余不破。
- **不引框架**：不引 Tailwind/React/Vue。沿用 IIFE + 字符串拼 HTML。
- **文件编码**：改 `control/*.js`/`control/*.css`/`control/index.html`。JS/CSS 走 UTF-8，LF/CRLF 都行。`.bat`/`.ps1` 本次不碰。
- **pretest 钩子**：`npm test` 会先跑 `node test/fixtures/make-epub.cjs` 生成 epub fixture。单跑某个 `node test/xxx.cjs` 前先 `npm run pretest`（AGENTS.md）。
- **commit 规范**：中文 commit message，`feat(control-ui): ...` / `refactor(control-ui): ...` / `test(control-ui): ...` / `style(control-ui): ...`。

---

## File Structure

| 文件 | 职责 | 操作 |
|---|---|---|
| `control/control.css` | 全部样式（token + 玻璃面板 + Tab + 各组件） | 大改 |
| `control/index.html` | Tab 容器结构 + 5 panel DOM 包装 + script 引入 | 改 |
| `control/control.js` | Tab 切换逻辑 + job-msg toast + renderShelf/renderBookmarks 输出 class | 改 |
| `control/lib/status-view.js` | `renderStatus` 返回新行项结构 | 改 |
| `control/lib/skin-view.js` | `renderEditor` 折叠组重组 + 工具栏按钮 class | 改 |
| `control/lib/icons.js` | SVG 图标常量（新增） | 新建 |
| `test/statusviewtest.cjs` | 更新断言匹配新结构 + emoji→SVG | 改 |

---

## Task 1: 设计 Token + 玻璃面板基础样式

**Files:**
- Modify: `control/control.css:1-13`（替换 `html,body` 和 `.panel` 规则，插入 `:root`）

**Interfaces:**
- Produces: `:root` CSS 变量（`--glass-bg`/`--glass-blur`/`--accent`/`--radius-*`/`--space-*`/`--fs-*` 等），供后续所有 Task 引用。

**目的**：先让玻璃面板质感到位（均衡 alpha + 强模糊 + 投影高光），建立变量系统。A1 红线保留。

- [ ] **Step 1: 修改 `control/control.css` 顶部，插入 `:root` 变量块并替换 `html,body` 与 `.panel`**

把 `control/control.css` 第 1-13 行（从 `/* A1: transparent background...` 到 `.panel { ... }` 结束的 `}`）替换为：

```css
/* A1: transparent background so ZCode wallpaper shows through (spec §2/§4 B1).
   The page itself paints transparent; wallpaper comes from ZCode body below. */
:root {
  /* 玻璃面板（均衡路线，spec §3/§4） */
  --glass-bg:          rgba(28, 28, 36, 0.55);
  --glass-bg-elevated: rgba(44, 44, 54, 0.65);
  --glass-blur:        24px;
  --glass-sat:         180%;
  --glass-border:      rgba(255, 255, 255, 0.12);
  --glass-border-strong: rgba(255, 255, 255, 0.22);
  --glass-shadow:      0 8px 32px rgba(0, 0, 0, 0.4);
  --glass-highlight:   inset 0 1px 0 rgba(255, 255, 255, 0.15);

  /* 圆角层级 */
  --radius-panel:   16px;
  --radius-card:    12px;
  --radius-control: 10px;

  /* macOS 系统调色板（spec §3） */
  --accent:         #0a84ff;
  --accent-hover:   #3d94ff;
  --accent-pressed: #0060df;
  --ok:             #30d158;
  --warn:           #ffd60a;
  --err:            #ff453a;
  --muted:          rgba(235, 235, 245, 0.6);

  /* 文字层级 */
  --text-primary:   rgba(255, 255, 255, 0.96);
  --text-secondary: rgba(235, 235, 245, 0.6);

  /* Type scale */
  --fs-xs:   11px;
  --fs-sm:   12px;
  --fs-base: 13px;
  --fs-md:   14px;
  --fs-lg:   16px;

  /* 间距（8px 网格） */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
}

html, body { margin: 0; height: 100%; background: transparent !important; color: var(--text-primary);
  font-family: "Microsoft YaHei", system-ui, sans-serif; font-size: var(--fs-base);
  /* text-shadow 兜底：面板内透明区域文字仍有轮廓（教训2）。alpha 0.55 + blur 24 后非唯一来源。*/
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8), 0 0 1px rgba(0, 0, 0, 0.9); }

/* 玻璃面板（均衡路线，spec §4）：alpha 0.55 + blur 24 + saturate 180 + 投影 + 顶部高光。
   替换原 rgba(20,20,24,0) 全透 + blur(3px)。解决教训2 赌运气可读性。*/
.panel { background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-panel);
  box-shadow: var(--glass-shadow), var(--glass-highlight);
  padding: var(--space-3) var(--space-4);
  margin: 0 0 var(--space-3) 0; }
```

- [ ] **Step 2: 跑 controlservertest 确认静态托管没破**

Run: `npm run pretest && node test/controlservertest.cjs`
Expected: 全 PASS（controlservertest 测的是 server，不碰 CSS。但跑一遍确认 server 还能起来 + go.html 仍 text/html）。

- [ ] **Step 3: 跑全量测试**

Run: `npm test`
Expected: 全 28 个文件绿（CSS 改动不影响任何 JS 测试）。

- [ ] **Step 4: Commit**

```bash
git add control/control.css
git commit -m "feat(control-ui): 设计 token + 玻璃面板基础样式（均衡 alpha 0.55 + blur 24）"
```

---

## Task 2: 全局控件样式（按钮/输入/选择/焦点环/reduced-motion）

**Files:**
- Modify: `control/control.css:22-27`（替换 `button`/`button:hover`/`button:disabled`/`input` 规则）

**Interfaces:**
- Produces: `button`/`button.primary`/`button.danger`/`input`/`select`/`:focus-visible` 样式，供 Task 5/6/7 引用。

**目的**：统一控件视觉（圆角 10px + transition 200ms + 按下缩放 + 焦点环 + primary/danger 分级），并在文件末尾追加 reduced-motion。

- [ ] **Step 1: 替换 `control/control.css` 里现有的 button/input 规则块**

把这几行（Task 1 之后，约第 22-27 行）：

```css
button { background: rgba(255, 255, 255, 0.12); color: #fff; border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px; padding: 4px 10px; cursor: pointer; margin: 2px; }
button:hover { background: rgba(255, 255, 255, 0.22); }
button:disabled { opacity: 0.4; cursor: not-allowed; }
input { background: rgba(0, 0, 0, 0.3); color: #fff; border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 3px; width: 50px; }
```

替换为：

```css
button { background: rgba(255, 255, 255, 0.10); color: var(--text-primary);
  border: 1px solid var(--glass-border); border-radius: var(--radius-control);
  padding: 6px 14px; font-size: var(--fs-sm); cursor: pointer; margin: 2px;
  transition: background 200ms ease, transform 200ms ease, border-color 200ms ease; }
button:hover { background: rgba(255, 255, 255, 0.18); }
button:active { transform: scale(0.97); }
button:disabled { opacity: 0.35; cursor: not-allowed; }
button.primary { background: var(--accent); border-color: transparent; color: #fff; }
button.primary:hover { background: var(--accent-hover); }
button.danger:hover { background: rgba(255, 69, 58, 0.25); border-color: var(--err); color: var(--err); }
input, select { background: rgba(0, 0, 0, 0.3); color: var(--text-primary);
  border: 1px solid var(--glass-border); border-radius: var(--radius-control);
  padding: 4px 8px; font-size: var(--fs-sm); font-family: inherit; }
input[type="number"] { width: 60px; }
input[type="radio"], input[type="checkbox"], input[type="range"] { accent-color: var(--accent); }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px; }
```

- [ ] **Step 2: 在 `control/control.css` 末尾追加 reduced-motion 块**

```css

/* a11y: 尊重系统 reduced-motion 设置（spec §11.5） */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
  button:active { transform: none; }
}
```

- [ ] **Step 3: 跑全量测试**

Run: `npm test`
Expected: 全绿。

- [ ] **Step 4: Commit**

```bash
git add control/control.css
git commit -m "feat(control-ui): 全局控件样式（按钮分级 + 焦点环 + reduced-motion）"
```

---

## Task 3: Tab 结构（index.html 包装 + control.js 切换逻辑）

**Files:**
- Modify: `control/index.html`（全文重构 DOM 包装）
- Modify: `control/control.js`（新增 Tab 切换 IIFE）

**Interfaces:**
- Produces: `#tabs` Tab 栏 + 4 个 `.tab-pane`（`data-pane` = overview/wallpaper/reader/skin），`localStorage["zcode-control:tab"]` 持久化。

**目的**：把现有 5 个 panel 包进 4 个 Tab。壁纸动作分组在 Task 5 做，本 Task 只搭 Tab 骨架。

- [ ] **Step 1: 重写 `control/index.html`**

把 `<body>` 内容（第 8-52 行，从 `<body>` 到 `</body>` 前）替换为：

```html
<body>
  <div id="tabs" class="tab-bar">
    <button class="tab active" data-tab="overview">总览</button>
    <button class="tab" data-tab="wallpaper">壁纸</button>
    <button class="tab" data-tab="reader">阅读</button>
    <button class="tab" data-tab="skin">皮肤</button>
  </div>
  <div id="tab-content">
    <section class="tab-pane active" data-pane="overview">
      <div id="status-panel" class="panel"></div>
    </section>
    <section class="tab-pane" data-pane="wallpaper">
      <div id="job-msg" class="toast"></div>
      <div id="actions" class="panel">
        <button data-action="injectImage">注入图片壁纸</button>
        <button data-action="injectVideo">注入视频壁纸</button>
        <button data-action="muteVideo">🔇 静音</button>
        <button data-action="unmuteVideo">🔊 取消静音</button>
        <button data-action="remove">移除壁纸</button>
        <label>透明度 <input id="opacity" type="number" min="0" max="100" value="78">%
          <button data-action="setTransparent">设透明</button></label>
        <button data-action="resize">重新缩图</button>
        <button data-action="setup">重装依赖</button>
        <fieldset class="rotate-section">
          <legend>壁纸轮播</legend>
          <label><input type="radio" name="rotate-mode" value="image" checked> 图片</label>
          <label><input type="radio" name="rotate-mode" value="video"> 视频</label>
          <label>间隔 <input id="rotate-interval" type="number" min="1" value="5"> 分钟</label>
          <button data-action="startRotate">开始轮播</button>
          <button data-action="stopRotate">停止轮播</button>
        </fieldset>
      </div>
    </section>
    <section class="tab-pane" data-pane="reader">
      <div id="bm-port-warn" class="banner warn-banner" style="display:none">⚠ _blank 链接修复需 ZCode 带 debug port 启动，请从 wallpaper.bat 场景 2/13 重启</div>
      <div id="shelf-panel" class="panel">
        <div class="shelf-head"><h3>书架</h3><button id="open-reader" class="link-btn" title="去阅读界面">打开阅读器 →</button></div>
        <div id="shelf-list"></div>
      </div>
      <div id="bookmark-panel" class="panel">
        <h3>书签</h3>
        <div class="bookmark-add">
          <input id="bm-title" type="text" placeholder="名称" class="wide-input">
          <input id="bm-url" type="text" placeholder="网址（如 github.com）" class="wide-input">
          <button data-action="addBookmark">添加</button>
        </div>
        <div id="bookmark-list"></div>
        <span id="bm-msg" class="toast-inline"></span>
      </div>
    </section>
    <section class="tab-pane" data-pane="skin">
      <div id="skin-panel" class="panel"></div>
    </section>
  </div>
  <script src="lib/status-view.js"></script>
  <script src="lib/skin.js"></script>
  <script src="lib/skin-view.js"></script>
  <script src="lib/shelf.js"></script>
  <script src="lib/bookmark.js"></script>
  <script src="control.js"></script>
</body>
```

注意：`bm-msg` 从 `#bm-msg.muted` 改为 `#bm-msg.toast-inline`（Task 6 改 toast 风格，但保留 id）。`bookmark-add` 的 input 去掉 inline `style="width:..."`（Task 6 用 flex）。`job-msg` 从 `<span>` 改为 `<div class="toast">` 并移到 `#actions` 面板上方。

- [ ] **Step 2: 在 `control/control.css` 末尾追加 Tab 栏样式**

```css

/* ---- Tab 栏（segmented control，spec §5） ---- */
.tab-bar { display: flex; gap: 2px; background: rgba(0, 0, 0, 0.25);
  border-radius: var(--radius-control); padding: 3px; margin: 0 0 var(--space-3) 0; }
.tab { flex: 1; background: transparent; border: none; border-radius: 7px;
  padding: 5px 14px; margin: 0; color: var(--text-secondary);
  font-size: var(--fs-sm); font-weight: 500; cursor: pointer;
  transition: background 200ms ease, box-shadow 200ms ease, color 200ms ease; }
.tab.active { background: rgba(255, 255, 255, 0.18);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); color: var(--text-primary); font-weight: 600; }
.tab:hover:not(.active) { color: var(--text-primary); background: rgba(255, 255, 255, 0.06); }
.tab-pane { display: none; }
.tab-pane.active { display: block; }
/* 控制中心宽度限制，居中（spec §2.3） */
body { max-width: 480px; margin: 0 auto; padding: var(--space-3); box-sizing: border-box; }
```

注意：`body { max-width: 480px }` 会覆盖 Task 1 的 `body { margin: 0; height: 100% }` 的 margin。这是有意的——居中布局。`background: transparent !important` 仍保留（Task 1 已设，被这里的 padding/box-sizing 补充但不冲突）。

- [ ] **Step 3: 在 `control/control.js` 顶部 IIFE 内，紧跟 `var POLL_MS = 2000;` 之后插入 Tab 切换逻辑**

在 `control/control.js` 第 5 行 `var POLL_MS = 2000;` 之后插入：

```js

  // ---- Tab 切换（spec §2.2） ----
  var TAB_KEY = "zcode-control:tab";
  function activateTab(name) {
    var tabs = document.querySelectorAll(".tab");
    var panes = document.querySelectorAll(".tab-pane");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("active", tabs[i].getAttribute("data-tab") === name);
    }
    for (var j = 0; j < panes.length; j++) {
      panes[j].classList.toggle("active", panes[j].getAttribute("data-pane") === name);
    }
    try { localStorage.setItem(TAB_KEY, name); } catch (e) {}
    // 切到皮肤 Tab 时立即渲染一次（避免首次进入空白）
    if (name === "skin" && window.__ccSkinView) {
      try { window.__ccSkinView.renderSkinPanel(); } catch (e) {}
    }
  }
  (function initTab() {
    var saved = null;
    try { saved = localStorage.getItem(TAB_KEY); } catch (e) {}
    // 只接受已知 Tab 名
    var valid = { overview: 1, wallpaper: 1, reader: 1, skin: 1 };
    activateTab(saved && valid[saved] ? saved : "overview");
  })();
  document.getElementById("tabs").addEventListener("click", function (e) {
    var t = e.target.getAttribute && e.target.getAttribute("data-tab");
    if (t) activateTab(t);
  });
```

- [ ] **Step 4: 跑全量测试**

Run: `npm test`
Expected: 全绿（DOM/JS 改动不影响 Node 单测）。

- [ ] **Step 5: 真机粗验（可选，若 ZCode 开着）**

在 webview 打开控制中心，确认 4 个 Tab 显示且切换正常、刷新后保持上次 Tab。若无 ZCode 环境，跳过此步，靠 Task 11 统一真机验。

- [ ] **Step 6: Commit**

```bash
git add control/index.html control/control.css control/control.js
git commit -m "feat(control-ui): Tab 结构（4 分区 segmented control + 切换持久化）"
```

---

## Task 4: 总览 Tab 状态行项重排（renderStatus + 测试更新）

**Files:**
- Modify: `control/lib/status-view.js`（全文重写 `renderStatus`）
- Modify: `control/control.css`（追加 `.status-row` 样式）
- Modify: `test/statusviewtest.cjs`（新增结构断言）

**Interfaces:**
- Consumes: status JSON（shape 不变：`st.zcode/wallpaper/transparent/reader/resources/rotate/_meta`）。
- Produces: `renderStatus(st)` 返回 6 个 `.status-row` div（左标题右状态 + 次要信息行 + 异常行高亮 class）。

**目的**：状态从 6 行平铺文字 → 行项卡片风格。关键约束：**保留所有现有中文文本**（"运行中"/"视频壁纸"/"未注入"/"轮播"/"5min"/"进程退出"等），让 statusviewtest 现有断言全绿，再追加结构断言。emoji（🔊/🔇）在本 Task **暂保留**，Task 8 替换为 SVG。

- [ ] **Step 1: 先看现有测试断言依赖哪些文本（已读，列在这里防遗漏）**

statusviewtest 依赖的文本子串（必须在新 renderStatus 保留）：
- "运行" 或 "running"、"视频壁纸"、"未注入"、"—"（transparent null）、"78"（透明度）、"5min"/"10min"、"轮播"、"图片"/"视频"（rotate mode）、"Chapter4.jpg"/"v.mp4"（lastFile）、"未轮播"、"进程退出"、"调试端口" 或 "debug"、"🔊 有声"、"🔇 静音"。

- [ ] **Step 2: 重写 `control/lib/status-view.js`**

全文替换为：

```js
// Status renderer — pure (status JSON -> HTML string). Dual export: CommonJS
// for Node tests + window.__ccStatusView for browser (spec §4 B2).
// 行项风格（spec §6）：左标题右状态 + 次要信息行 + 异常行高亮。
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
  });
}
// 渲染单行：label(主文字) + valueHtml(状态，含 .ok/.warn/.err/.muted) + subHtml(次要信息)
// rowClass 可选：异常行加 warn-row/err-row 弱底高亮。
function row(label, valueHtml, subHtml, rowClass) {
  return '<div class="status-row' + (rowClass ? " " + rowClass : "") + '">' +
    '<div class="status-main">' +
      '<span class="status-label">' + label + '</span>' +
      '<span class="status-value">' + valueHtml + '</span>' +
    '</div>' +
    (subHtml ? '<div class="status-sub">' + subHtml + '</div>' : '') +
  '</div>';
}
function renderStatus(st) {
  var z = st.zcode, w = st.wallpaper, t = st.transparent, r = st.reader, res = st.resources;
  // ZCode 行
  var zVal, zSub, zRow;
  if (z) {
    zVal = '<span class="ok"><span class="dot"></span>运行中</span>';
    zSub = '端口 ' + esc(z.debugPort) + ' · 窗口 ' + esc(z.pageTargets);
  } else {
    zVal = '<span class="warn">调试端口未开</span>';
    zSub = '请从 wallpaper.bat 场景 2 重启 ZCode';
    zRow = "warn-row";
  }
  // 壁纸行
  var wVal, wSub;
  if (w && w.mode && w.mode !== "none") {
    wVal = esc(w.mode === "video" ? "视频壁纸" : "图片壁纸");
    wSub = '注入 ' + esc(w.injectedWindows) + '/' + esc(w.totalWindows);
    if (w.mode === "video") {
      wSub += ' · ' + (w.videoMuted ? '🔇 静音' : '🔊 有声');
    }
  } else {
    wVal = '<span class="muted">未注入</span>';
    wSub = '';
  }
  // 透明行
  var tVal, tRow;
  if (!t) { tVal = '<span class="muted">—</span>'; }
  else if (t.enabled === true) { tVal = '透明 ' + esc(t.opacityPct) + '%'; }
  else if (t.enabled === "unknown") { tVal = '<span class="warn">未知</span>'; tRow = "warn-row"; }
  else { tVal = '<span class="muted">未启用</span>'; }
  // 阅读器行
  var rVal = (r && r.running) ? '运行中 :' + esc(r.port) : '<span class="muted">未运行</span>';
  // 资源行
  var resVal, resSub, resRow;
  if (res) {
    resVal = '图 ' + esc(res.images) + ' · 缩图 ' + esc(res.thumbs) + ' · 视频 ' + esc(res.videos) + ' · 小说 ' + esc(res.novels);
    var depsOk = res.deps && res.deps.sharp;
    resSub = '依赖 ' + (depsOk ? '✓' : '✗');
    if (!depsOk) resRow = "err-row";
  } else {
    resVal = '<span class="muted">—</span>';
  }
  // 轮播行
  var rot = st.rotate;
  var rotVal, rotSub, rotRow;
  if (!rot) { rotVal = '<span class="muted">—</span>'; }
  else if (!rot.running) {
    if (rot.stale) { rotVal = '<span class="warn">轮播已停（进程退出）</span>'; rotRow = "warn-row"; }
    else { rotVal = '<span class="muted">未轮播</span>'; }
  } else {
    rotVal = esc(rot.mode === 'video' ? '视频' : '图片') + ' 轮播';
    var nextStr = rot.nextSwitchAt ? new Date(rot.nextSwitchAt).toLocaleTimeString() : '—';
    rotSub = '每 ' + esc(Math.round(rot.intervalMs / 60000)) + 'min · 下次 ' + esc(nextStr) + ' · 当前 ' + esc(rot.lastFile || '—');
  }
  return row("ZCode", zVal, zSub, zRow) +
    row("壁纸", wVal, wSub) +
    row("透明度", tVal, null, tRow) +
    row("阅读器", rVal) +
    row("资源", resVal, resSub, resRow) +
    row("轮播", rotVal, rotSub, rotRow);
}
if (typeof module !== "undefined" && module.exports) module.exports = { renderStatus: renderStatus };
if (typeof window !== "undefined") window.__ccStatusView = { renderStatus: renderStatus };
```

**注意保留的文本**：`运行中`/`视频壁纸`/`图片壁纸`/`未注入`/`—`/透明度 `78`%/`5min`/`10min`/`轮播`/`图片`/`视频`(rotate)/`Chapter4.jpg`/`v.mp4`/`未轮播`/`进程退出`/`调试端口`/`🔊 有声`/`🔇 静音` —— 全部保留，现有断言不破。

- [ ] **Step 3: 在 `control/control.css` 追加 `.status-row` 样式**

```css

/* ---- 总览状态行项（spec §6） ---- */
.status-row { padding: 10px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
.status-row:first-child { padding-top: 4px; }
.status-row:last-child { border-bottom: none; padding-bottom: 4px; }
.status-main { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); }
.status-label { color: var(--text-primary); font-size: var(--fs-base); font-weight: 500; }
.status-value { font-size: var(--fs-sm); text-align: right; }
.status-value .ok { color: var(--ok); }
.status-value .warn { color: var(--warn); }
.status-value .err { color: var(--err); }
.status-value .muted { color: var(--muted); }
.status-value .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: currentColor; margin-right: 5px; vertical-align: middle; }
.status-sub { color: var(--text-secondary); font-size: var(--fs-xs); margin-top: 2px; }
.status-row.warn-row { background: rgba(255, 214, 10, 0.08); border-radius: var(--radius-control); }
.status-row.err-row { background: rgba(255, 69, 58, 0.08); border-radius: var(--radius-control); }
/* .ok/.warn/.muted 兼容：旧 status-view 直接用 .ok/.warn/.muted class，新版包在 .status-value 里。
   保留这三个全局 class 的色值，供其他地方（空状态等）使用。*/
.ok { color: var(--ok); }
.warn { color: var(--warn); }
.muted { color: var(--muted); }
.err { color: var(--err); }
```

- [ ] **Step 4: 更新 `test/statusviewtest.cjs`，追加结构断言**

在 `test/statusviewtest.cjs` 末尾 `console.log(...)` 之前，追加结构断言（用现有的 `html1`/`html2`/`html3` 变量复用）：

```js
// === 结构断言（spec §6 行项风格，Task 4 新增） ===
check("结构: renderStatus 含 status-row", html1.indexOf("status-row") !== -1);
check("结构: renderStatus 含 status-label", html1.indexOf("status-label") !== -1);
check("结构: renderStatus 含 status-value", html1.indexOf("status-value") !== -1);
check("结构: renderStatus 含 status-main", html1.indexOf("status-main") !== -1);
// 端口未开时整行 warn-row 高亮（html2 是 zcode:null）
check("结构: 端口未开时含 warn-row", html2.indexOf("warn-row") !== -1);
// 依赖缺失时 err-row（构造一个缺依赖的 status）
var stDepsMissing = {
  zcode: { running: true, debugPort: 9222, pageTargets: 1 },
  wallpaper: { mode: "none" }, transparent: null,
  reader: { running: true }, resources: { images: 0, thumbs: 0, videos: 0, novels: 0, deps: { sharp: false } },
  rotate: null, _meta: { probeErrors: [] },
};
var htmlDeps = sv.renderStatus(stDepsMissing);
check("结构: 依赖缺失时含 err-row", htmlDeps.indexOf("err-row") !== -1);
check("结构: 依赖缺失时显示 ✗", htmlDeps.indexOf("✗") !== -1);
// 6 行（数 status-row 出现次数）
var rowCount = (html1.match(/status-row/g) || []).length;
check("结构: 共 6 个 status-row", rowCount === 6);
```

- [ ] **Step 5: 跑 statusviewtest，先确认失败再确认通过**

Run: `node test/statusviewtest.cjs`
Expected: 全 PASS（结构断言新加，renderStatus 已重写含这些 class）。

**重要**：现有断言（"运行"/"视频壁纸"/"未注入"/"5min"/"进程退出"/"🔊 有声"/"🔇 静音" 等）必须仍全绿——Task 4 Step 2 已保留所有这些文本。若某个旧断言红了，说明 renderStatus 漏了某文本，回去补上。

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: 全 28 个绿。

- [ ] **Step 7: Commit**

```bash
git add control/lib/status-view.js control/control.css test/statusviewtest.cjs
git commit -m "feat(control-ui): 总览状态行项重排（左标题右状态 + 异常行高亮）"
```

---

## Task 5: 壁纸 Tab 分组卡片 + 按钮 class

**Files:**
- Modify: `control/index.html`（`#actions` 内部分 4 个 `.action-group`）
- Modify: `control/control.css`（追加 `.action-group`/`.group-title`/`.toast` 样式）
- Modify: `control/control.js`（`setJobMsg` 改 toast 行为）

**Interfaces:**
- Produces: `#actions` 内 4 个 `.action-group`（壁纸操作/窗口透明/壁纸轮播/维护），按钮带 `class="primary"`/`class="danger"`；`#job-msg` 改 `.toast` + `.show`/`.ok`/`.err`。

- [ ] **Step 1: 重写 `control/index.html` 里 `#actions` 的内容**

把 Task 3 后的 `#actions` 内部（从 `<button data-action="injectImage">` 到 `</fieldset>`）替换为分组结构：

```html
      <div class="action-group">
        <div class="group-title">壁纸操作</div>
        <button class="primary" data-action="injectImage">注入图片壁纸</button>
        <button class="primary" data-action="injectVideo">注入视频壁纸</button>
        <button data-action="muteVideo">🔇 静音</button>
        <button data-action="unmuteVideo">🔊 取消静音</button>
        <button class="danger" data-action="remove">移除壁纸</button>
      </div>
      <div class="action-group">
        <div class="group-title">窗口透明</div>
        <label class="inline-row">透明度 <input id="opacity" type="number" min="0" max="100" value="78">% <button data-action="setTransparent">设透明</button></label>
      </div>
      <div class="action-group">
        <div class="group-title">壁纸轮播</div>
        <fieldset class="rotate-section">
          <label class="inline-row"><input type="radio" name="rotate-mode" value="image" checked> 图片</label>
          <label class="inline-row"><input type="radio" name="rotate-mode" value="video"> 视频</label>
          <label class="inline-row">间隔 <input id="rotate-interval" type="number" min="1" value="5"> 分钟</label>
          <button class="primary" data-action="startRotate">开始轮播</button>
          <button class="danger" data-action="stopRotate">停止轮播</button>
        </fieldset>
      </div>
      <div class="action-group">
        <div class="group-title">维护</div>
        <button data-action="resize">重新缩图</button>
        <button data-action="setup">重装依赖</button>
      </div>
```

**注意**：`data-action` 全部保留（control.js 事件委托靠它）。emoji 🔇/🔊 暂留，Task 8 换 SVG。

- [ ] **Step 2: 在 `control/control.css` 追加分组卡片样式**

```css

/* ---- 壁纸 Tab 分组卡片（spec §7） ---- */
.action-group { background: var(--glass-bg-elevated); border-radius: var(--radius-card);
  padding: var(--space-3); margin-bottom: var(--space-2); }
.action-group:last-child { margin-bottom: 0; }
.group-title { font-size: var(--fs-sm); font-weight: 600; color: var(--text-secondary);
  margin-bottom: var(--space-2); }
.inline-row { display: inline-flex; align-items: center; gap: var(--space-1); margin: 2px; font-size: var(--fs-sm); }
.rotate-section { border: 1px solid var(--glass-border); border-radius: var(--radius-control); padding: var(--space-2) var(--space-3); margin: 0; }
.rotate-section legend { font-size: var(--fs-sm); color: var(--text-secondary); padding: 0 var(--space-1); }

/* ---- job-msg toast（spec §7.5） ---- */
.toast { display: none; padding: 6px 12px; margin: 0 0 var(--space-2) 0;
  border-radius: var(--radius-control); background: rgba(10, 132, 255, 0.15);
  color: var(--text-primary); font-size: var(--fs-sm);
  opacity: 0; transition: opacity 200ms ease; }
.toast.show { display: block; opacity: 1; }
.toast.ok { background: rgba(48, 209, 88, 0.15); }
.toast.err { background: rgba(255, 69, 58, 0.15); }
.toast-inline { font-size: var(--fs-sm); display: inline-block; margin-top: var(--space-1); }
```

- [ ] **Step 3: 改 `control/control.js` 的 `setJobMsg` 为 toast 行为**

把 `control/control.js` 里的 `setJobMsg` 函数（约第 11-14 行）：

```js
  function setJobMsg(text) {
    var el = document.getElementById("job-msg");
    if (el) el.textContent = text;
  }
```

替换为：

```js
  // job-msg toast（spec §7.5）：成功/失败 2.5s 淡出，执行中持续显示。
  var jobMsgTimer = null;
  function setJobMsg(text, kind) {
    var el = document.getElementById("job-msg");
    if (!el) return;
    el.textContent = text;
    el.className = "toast show" + (kind ? " " + kind : "");
    if (jobMsgTimer) { clearTimeout(jobMsgTimer); jobMsgTimer = null; }
    // 执行中（kind 为空或 "执行中"文案）不自动消失，等下一次 setJobMsg 覆盖
    if (kind === "ok" || kind === "err") {
      jobMsgTimer = setTimeout(function () {
        el.className = "toast" + (kind ? " " + kind : "");
        jobMsgTimer = null;
      }, 2500);
    }
  }
```

- [ ] **Step 4: 更新 `control/control.js` 里所有 `setJobMsg(...)` 调用，传入 kind**

把 `dispatchAction` 后的 `.then` 回调里的 `setJobMsg` 调用（约第 83-94 行）更新 kind：

```js
    dispatchAction(finalAction, params).then(function (res) {
      if (res.status === 409) setJobMsg("忙，请等当前动作完成", "err");
      else if (!res.json.accepted) setJobMsg("拒绝: " + (res.json.error || ""), "err");
      else {
        if (res.json.jobId) setJobMsg("已提交 (" + res.json.jobId + ")", "ok");
        else if (typeof res.json.muted === "boolean") setJobMsg(res.json.muted ? "已静音（" + res.json.affected + "/" + res.json.total + " 窗口）" : "已取消静音（" + res.json.affected + "/" + res.json.total + " 窗口）", "ok");
        else setJobMsg("已提交", "ok");
        setTimeout(poll, 500);
      }
    }).catch(function (err) { setJobMsg("错误: " + err.message, "err"); });
```

`dispatchAction` 开头的 `setJobMsg("执行中: " + action + "...")` 保持无 kind（执行中持续显示，不自动消失）。

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add control/index.html control/control.css control/control.js
git commit -m "feat(control-ui): 壁纸 Tab 4 分组卡片 + 按钮分级 + job-msg toast"
```

---

## Task 6: 阅读 Tab（书架 + 书签）列表项卡片化 + bm-msg toast

**Files:**
- Modify: `control/control.js`（`renderShelf`/`renderBookmarks` 输出 class 加 `.list-item`；`setBmMsg` 改 toast）
- Modify: `control/control.css`（追加 `.list-item`/`.reader-section`/`.empty-state`/`.banner` 样式，替换 `.shelf-head`/`#shelf-list .book`/`#bookmark-list .book`）

**Interfaces:**
- Produces: 书/书签项输出 `class="list-item book"`（双 class，`.book` 兼容），stale 书加 `.stale`；书签/书架区标题用 `.reader-section-title`。

- [ ] **Step 1: 改 `control/control.js` 的 `renderShelf`，给书项加 `.list-item` class**

把 `renderShelf` 里两个 `'<div class="book' + ...>` 改为带 `.list-item`：

书架 Region 1（我的书架）的书项：

```js
        html += '<div class="list-item book' + (b.stale ? " stale" : "") + '">' +
          '<span class="book-open" data-open="' + encodeURIComponent(b.bookId) + '" title="打开阅读">' +
          esc(b.filename) + (b.lastChapterTitle ? ' · <small>' + esc(b.lastChapterTitle) + '</small>' : "") + '</span>' +
          '<button class="book-del" data-del="' + encodeURIComponent(b.bookId) + '" title="从书架移除">✕</button>' +
          '</div>';
```

空状态（Region 1 的 `if (!list.length)`）：

```js
      html += '<div class="empty-state">空 — 从下面"全部小说"加入，或在阅读器里打开书</div>';
```

Region 2（全部小说）的 addable 书项：

```js
          html += '<div class="list-item book addable">' +
            '<span>' + esc(b.filename) + ' <small>(' + b.totalChapters + ' 章)</small></span>' +
            '<button class="book-add" data-add="' + encodeURIComponent(b.id) + '" title="加入书架">+</button>' +
            '</div>';
```

addable 空状态：

```js
        html += '<div class="empty-state">都已加入书架</div>';
```

**注意**：`data-open`/`data-del`/`data-add` 不动，事件委托靠它们。

- [ ] **Step 2: 改 `control/control.js` 的 `renderBookmarks`，书签项加 `.list-item`**

```js
      list.forEach(function (b) {
        html += '<div class="list-item book">' +
          '<span class="book-open" data-go="' + encodeURIComponent(window.__ccBookmark.buildGoUrl(b.url, b.title)) + '" title="' + esc(b.url) + '">' +
          esc(b.title) + ' <small>' + esc(b.url) + '</small></span>' +
          '<button class="book-del" data-bmdel="' + encodeURIComponent(b.id) + '" title="删除书签">✕</button>' +
          '</div>';
      });
```

书签空状态：

```js
      html = '<div class="empty-state">还没有书签，在上方添加（名称 + 网址）</div>';
```

- [ ] **Step 3: 改 `control/control.js` 的 `setBmMsg`，复用 toast 风格**

把 `setBmMsg`（约第 183-189 行）：

```js
  function setBmMsg(text, isErr) {
    var el = document.getElementById("bm-msg");
    if (!el) return;
    el.textContent = text;
    el.className = isErr ? "err" : "muted";
    if (isErr) setTimeout(function () { if (el.textContent === text) { el.textContent = ""; el.className = "muted"; } }, 2000);
  }
```

替换为：

```js
  var bmMsgTimer = null;
  function setBmMsg(text, isErr) {
    var el = document.getElementById("bm-msg");
    if (!el) return;
    el.textContent = text;
    el.className = "toast-inline" + (isErr ? " err" : " ok");
    if (bmMsgTimer) { clearTimeout(bmMsgTimer); bmMsgTimer = null; }
    bmMsgTimer = setTimeout(function () { el.textContent = ""; el.className = "toast-inline"; bmMsgTimer = null; }, 2500);
  }
```

`addBookmarkFromForm` 末尾的 `setTimeout(...)` 清空 bm-msg 那行（约第 203 行）可删除（setBmMsg 已自带定时器），但留着无害——它会在 1 秒后再清一次。为干净起见删掉：

```js
    setBmMsg("已添加", false);
    // （setBmMsg 已自带 2.5s 自动清空，无需再 setTimeout）
```

- [ ] **Step 4: 改 `control/control.css`，追加 `.list-item` 等样式并替换旧书架/书签选择器**

把现有 `.shelf-head`/`h3`/`.link-btn`/`#shelf-list .book*`/`.shelf-section-title`/`#bookmark-list .book*`/`.bookmark-add` 这几块（约第 14-53 行）替换为：

```css
h3 { margin: 0 0 var(--space-2) 0; font-size: var(--fs-md); font-weight: 600; }
/* 阅读 Tab 分区标题（spec §8.2）：书架/书签在一个面板内 */
.reader-section-title { font-size: var(--fs-md); font-weight: 600; color: var(--text-primary);
  margin: 0 0 var(--space-2) 0; display: flex; align-items: center; justify-content: space-between; }
/* 保留 .shelf-head 兼容（书架 h3 + 打开阅读器链接） */
.shelf-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2); }
.shelf-head h3 { margin: 0; }
.link-btn { background: transparent; border: none; color: var(--accent); padding: 0 4px; margin: 0;
  font-size: var(--fs-sm); text-decoration: none; cursor: pointer; }
.link-btn:hover { background: transparent; color: var(--accent-hover); text-decoration: underline; }

/* 列表项卡片化（spec §8.3）：书 + 书签统一 .list-item，保留 .book 兼容旧选择器 */
.list-item { background: var(--glass-bg-elevated); border-radius: var(--radius-control);
  padding: 8px 12px; margin-bottom: 4px; display: flex; align-items: center; gap: var(--space-2);
  transition: background 150ms ease; }
.list-item:hover { background: rgba(255, 255, 255, 0.22); }
.list-item:last-child { margin-bottom: 0; }
.list-item.stale { color: var(--err); border-left: 3px solid var(--err); }
.list-item .book-open { cursor: pointer; flex: 1; }
.list-item.addable { cursor: default; }
.list-item.addable span { flex: 1; color: var(--text-secondary); }
.list-item small { color: var(--text-secondary); display: block; font-size: var(--fs-xs);
  max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.book-del, .book-add { padding: 0 6px; margin: 0; font-size: var(--fs-sm); line-height: 18px;
  background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border); }
.book-del:hover { background: rgba(255, 100, 100, 0.3); border-color: var(--err); }
.book-add:hover { background: rgba(100, 200, 100, 0.3); border-color: var(--ok); }

/* 分区小标题（全部小说/我的书架子区） */
.shelf-section-title { font-size: var(--fs-sm); color: var(--text-secondary); margin: var(--space-3) 0 var(--space-1) 0;
  font-weight: 600; }
.shelf-section-title:first-child { margin-top: 0; }

/* 书签添加表单（spec §8.4） */
.bookmark-add { display: flex; gap: var(--space-2); margin-bottom: var(--space-2); flex-wrap: wrap; }
.bookmark-add input, .wide-input { flex: 1; min-width: 120px; width: auto !important; }

/* 空状态（spec §8.6） */
.empty-state { padding: 20px; text-align: center; color: var(--text-secondary); font-size: var(--fs-sm); }

/* 横幅（bm-port-warn 等，spec §8.5） */
.banner { padding: 6px 12px; border-radius: var(--radius-control); font-size: var(--fs-sm);
  margin-bottom: var(--space-2); }
.warn-banner { background: rgba(255, 214, 10, 0.12); color: var(--warn); }
```

**注意**：`#shelf-list .book` / `#bookmark-list .book` 旧选择器全部删除（被 `.list-item` 取代）。`.list-item .book-open`/`.list-item.addable` 等新规则覆盖原行为。`#shelf-list`/`#bookmark-list` 容器 id 保留（事件委托）。

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: 全绿（shelftest/bookmarktest 只测 lib 纯函数，不碰渲染 HTML）。

- [ ] **Step 6: Commit**

```bash
git add control/control.js control/control.css
git commit -m "feat(control-ui): 阅读 Tab 列表项卡片化 + bm-msg toast + 空状态"
```

---

## Task 7: 皮肤 Tab 编辑器折叠组重排 + 工具栏按钮 class

**Files:**
- Modify: `control/lib/skin-view.js`（`renderEditor` 重组为 4 个 `<details>`；`buildStructure` 工具栏按钮加 class）

**Interfaces:**
- Consumes: `editing` 工作副本（shape 不变）；`data-field`/`data-ck`/`data-ck-text`/`data-ov-*`/`data-emoji-*` attribute（全部保留）。
- Produces: `renderEditor` 返回的 HTML 包含 4 个 `<details>`（基本信息/颜色默认展开，角标闪光/叠加默认折叠或沿用）。

**关键约束**：`collectEditor`（skin-view.js 靠 querySelector 按 `data-*` 收集表单）**逻辑完全不动**，因为所有 `data-*` attribute 都保留。只改 HTML 外层包装。

- [ ] **Step 1: 改 `control/lib/skin-view.js` 的 `renderEditor`，把 flat 内容包进 4 个 `<details>`**

在 `skin-view.js` 找到 `renderEditor` 函数（约第 109-153 行），把它构造 `html` 的部分重组。**保留所有现有的 label/input 和 data-* attribute**，只改外层包装。

把现有的：

```js
    var html = '<fieldset class="skin-edit-fs"' + (locked ? ' disabled title="预设主题只读，点「复制」后编辑副本"' : '') + '>' +
      '<legend>编辑: ' + esc(t.name) + (locked ? ' [预设只读]' : '') + '</legend>' +
      '<label class="skin-row">名称 <input type="text" data-field="name" value="' + esc(editing.name) + '"></label>' +
      '<div class="skin-colors">' +
        colorRow("background", "背景") + colorRow("panel", "面板") +
        colorRow("accent", "主色") + colorRow("accentAlt", "次色") +
        colorRow("text", "文字") + colorRow("muted", "弱文字") +
        colorRow("sidebarBg", "侧栏") + colorRow("inputBg", "输入框") +
        colorRow("inputBorder", "输入框边框") +
      '</div>' +
      '<label class="skin-row">字体 <input type="text" data-field="font" value="' + esc(editing.font || "") + '" placeholder="留空=不覆盖"></label>' +
      '<label class="skin-row">圆角(px) <input type="number" data-field="radius" value="' + (editing.radius != null ? editing.radius : "") + '" placeholder="留空=不覆盖" min="0"></label>' +
      renderOverlaySection(editing) +
      '<div class="skin-deco">' +
        '<label class="skin-checkbox"><input type="checkbox" data-field="sparkle"' + (editing.decorations && editing.decorations.sparkle ? " checked" : "") + '> 闪光粒子</label>' +
        '<label class="skin-row skin-opacity-row">闪光数量 <input type="range" data-field="sparkleCount" min="0" max="50" value="' + ((editing.decorations && editing.decorations.sparkleCount != null) ? editing.decorations.sparkleCount : 12) + '"><span data-sparkle-count-val>' + ((editing.decorations && editing.decorations.sparkleCount != null) ? editing.decorations.sparkleCount : 12) + '</span></label>' +
        '<div class="skin-emoji-list-head">Emoji 角标（可多个，显示在不同位置）</div>' +
        '<div id="skin-emoji-rows">' + renderEmojiRows(editing) + '</div>' +
        '<button type="button" data-skin-act="addEmojiRow" class="skin-emoji-add">+ 添加角标</button>' +
      '</div>';
    if (!locked) html += '<button data-skin-act="save">保存</button>';
    if (locked) html += '<div class="muted" style="font-size:11px;margin-top:4px">预设主题不可直接编辑。点上方「复制」生成可编辑副本。</div>';
    html += '</fieldset>';
    ed.innerHTML = html;
```

替换为（**所有 input 和 data-* 原样保留，只改分组包装**）：

```js
    var badge = locked ? ' <span class="readonly-badge">预设只读</span>' : '';
    var html = '<fieldset class="skin-edit-fs"' + (locked ? ' disabled title="预设主题只读，点「复制」后编辑副本"' : '') + '>' +
      '<legend>编辑: ' + esc(t.name) + badge + '</legend>' +
      '<details open><summary>基本信息</summary>' +
        '<label class="skin-row">名称 <input type="text" data-field="name" value="' + esc(editing.name) + '"></label>' +
        '<label class="skin-row">字体 <input type="text" data-field="font" value="' + esc(editing.font || "") + '" placeholder="留空=不覆盖"></label>' +
        '<label class="skin-row">圆角(px) <input type="number" data-field="radius" value="' + (editing.radius != null ? editing.radius : "") + '" placeholder="留空=不覆盖" min="0"></label>' +
      '</details>' +
      '<details open><summary>颜色 (9)</summary>' +
        '<div class="skin-colors">' +
          colorRow("background", "背景") + colorRow("panel", "面板") +
          colorRow("accent", "主色") + colorRow("accentAlt", "次色") +
          colorRow("text", "文字") + colorRow("muted", "弱文字") +
          colorRow("sidebarBg", "侧栏") + colorRow("inputBg", "输入框") +
          colorRow("inputBorder", "输入框边框") +
        '</div>' +
      '</details>' +
      '<details><summary>角标与闪光</summary>' +
        '<div class="skin-deco">' +
          '<label class="skin-checkbox"><input type="checkbox" data-field="sparkle"' + (editing.decorations && editing.decorations.sparkle ? " checked" : "") + '> 闪光粒子</label>' +
          '<label class="skin-row skin-opacity-row">闪光数量 <input type="range" data-field="sparkleCount" min="0" max="50" value="' + ((editing.decorations && editing.decorations.sparkleCount != null) ? editing.decorations.sparkleCount : 12) + '"><span data-sparkle-count-val>' + ((editing.decorations && editing.decorations.sparkleCount != null) ? editing.decorations.sparkleCount : 12) + '</span></label>' +
          '<div class="skin-emoji-list-head">Emoji 角标（可多个，显示在不同位置）</div>' +
          '<div id="skin-emoji-rows">' + renderEmojiRows(editing) + '</div>' +
          '<button type="button" data-skin-act="addEmojiRow" class="skin-emoji-add">+ 添加角标</button>' +
        '</div>' +
      '</details>' +
      renderOverlaySection(editing);
    if (!locked) html += '<button class="primary" data-skin-act="save">保存</button>';
    if (locked) html += '<div class="muted skin-readonly-hint">预设主题不可直接编辑。点上方「复制」生成可编辑副本。</div>';
    html += '</fieldset>';
    ed.innerHTML = html;
```

**关键**：`renderOverlaySection(editing)` 返回的已经是 `<details>`（现有代码），保持不动。`collectEditor` 靠 `data-field`/`data-ck`/`data-ov-*` 收集，这些 attribute 全保留，收集逻辑不受 `<details>` 包装影响（`<details>` 折叠时子元素仍在 DOM 里，querySelector 能查到）。

- [ ] **Step 2: 改 `skin-view.js` 的 `buildStructure`，工具栏按钮加 class**

把 `buildStructure` 里工具栏的按钮（约第 50-56 行）：

```js
    html += '<div class="skin-toolbar">' +
      '<select id="skin-select">' + opts + '</select> ' +
      '<button data-skin-act="apply">应用</button> ' +
      '<button data-skin-act="remove">移除</button> ' +
      '<button data-skin-act="new">新建</button> ' +
      '<button data-skin-act="dup">复制</button> ' +
      '<button data-skin-act="del">删除</button></div>';
```

改为：

```js
    html += '<div class="skin-toolbar">' +
      '<select id="skin-select">' + opts + '</select> ' +
      '<button class="primary" data-skin-act="apply">应用</button> ' +
      '<button class="danger" data-skin-act="remove">移除</button> ' +
      '<button data-skin-act="new">新建</button> ' +
      '<button data-skin-act="dup">复制</button> ' +
      '<button class="danger" data-skin-act="del">删除</button></div>';
```

`data-skin-act` 全部保留（事件委托靠它）。

- [ ] **Step 3: 在 `control/control.css` 追加皮肤折叠组/只读徽章样式**

```css

/* ---- 皮肤编辑器折叠组（spec §9） ---- */
.skin-edit-fs { border: 1px solid var(--glass-border); border-radius: var(--radius-card);
  padding: var(--space-3); margin-top: var(--space-2); }
.skin-edit-fs legend { font-size: var(--fs-sm); color: var(--text-secondary); padding: 0 var(--space-1); font-weight: 600; }
.skin-edit-fs:disabled { opacity: 0.6; }
.skin-edit-fs details { border-top: 1px solid rgba(255, 255, 255, 0.08); padding: var(--space-2) 0; }
.skin-edit-fs details:first-of-type { border-top: none; padding-top: 0; }
.skin-edit-fs summary { font-size: var(--fs-sm); font-weight: 600; color: var(--text-primary);
  cursor: pointer; padding: var(--space-1) 0; }
.skin-edit-fs summary:hover { color: var(--accent); }
.readonly-badge { display: inline-block; font-size: var(--fs-xs); color: var(--warn);
  background: rgba(255, 214, 10, 0.12); padding: 1px 6px; border-radius: var(--space-1);
  margin-left: var(--space-1); vertical-align: middle; }
.skin-readonly-hint { font-size: var(--fs-xs); margin-top: var(--space-1); color: var(--text-secondary); }
/* 颜色卡片化（spec §9.2） */
.skin-colors { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-1); margin: var(--space-2) 0; }
.skin-color { background: var(--glass-bg-elevated); border-radius: var(--radius-control); padding: var(--space-2);
  display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
  font-size: var(--fs-xs); transition: background 150ms ease; }
.skin-color:hover { background: rgba(255, 255, 255, 0.22); }
.skin-color input[type="color"] { width: 100%; height: 40px; padding: 0;
  border: 1px solid var(--glass-border); border-radius: var(--radius-control); background: transparent; cursor: pointer; }
.skin-color input[type="text"] { background: rgba(0, 0, 0, 0.3); color: var(--text-primary);
  border: 1px solid var(--glass-border); border-radius: var(--radius-control);
  padding: 1px 2px; font-size: var(--fs-xs); width: 100%; text-align: center; }
/* 保留现有 skin-row/toolbar 等样式（spec §9 其他控件） */
.skin-row { display: block; margin: var(--space-1) 0; font-size: var(--fs-sm); }
.skin-row input[type="text"], .skin-row input[type="number"], .skin-row select {
  background: rgba(0, 0, 0, 0.3); color: var(--text-primary); border: 1px solid var(--glass-border);
  border-radius: var(--radius-control); padding: 1px var(--space-1); width: 60%; }
.skin-toolbar { display: flex; flex-wrap: wrap; gap: var(--space-1); align-items: center; margin: var(--space-2) 0; }
.skin-toolbar select { background: rgba(0, 0, 0, 0.3); color: var(--text-primary);
  border: 1px solid var(--glass-border); border-radius: var(--radius-control); padding: 1px var(--space-1); flex: 1; min-width: 120px; }
.skin-deco { margin-top: var(--space-2); padding-top: var(--space-2); }
.skin-checkbox { display: inline-flex; align-items: center; gap: var(--space-1); font-size: var(--fs-sm); margin: var(--space-1) 0; }
.skin-emoji-list-head { font-size: var(--fs-sm); color: var(--text-secondary); margin: var(--space-2) 0 2px; }
.skin-emoji-row { display: flex; align-items: center; gap: var(--space-1); margin: 2px 0; }
.skin-emoji-row select { background: rgba(0, 0, 0, 0.3); color: var(--text-primary);
  border: 1px solid var(--glass-border); border-radius: var(--radius-control); padding: 1px 2px; font-size: var(--fs-xs); flex: 1; }
.skin-emoji-row button { padding: 0 5px; margin: 0; font-size: var(--fs-xs); line-height: 18px; }
.skin-emoji-add { margin-top: var(--space-1) !important; font-size: var(--fs-xs); padding: 2px 8px; }
.skin-overlay-section { margin-top: var(--space-2); border: 1px solid var(--glass-border); border-radius: var(--radius-control); padding: var(--space-2) var(--space-3); }
.skin-overlay-section summary { font-size: var(--fs-sm); color: var(--text-secondary); cursor: pointer; }
.skin-opacity-row { display: flex; align-items: center; gap: var(--space-1); font-size: var(--fs-xs); margin: 3px 0; }
.skin-opacity-row input[type="range"] { flex: 1; }
.skin-opacity-row span { min-width: 36px; text-align: right; color: var(--text-secondary); font-size: var(--fs-xs); }
```

**注意**：原 control.css 第 56-86 行的 skin 相关样式块（`.skin-toolbar` 到 `.skin-opacity-row`）现在被这块覆盖/替代。**手动删除原 control.css 第 56-86 行的旧 skin 样式**（避免重复定义）。即把原文件里从 `/* ---- skin panel (spec §5) ---- */` 到 `.skin-opacity-row span {...}` 整块删除（被上面新块替代）。

- [ ] **Step 4: 跑全量测试**

Run: `npm test`
Expected: 全绿（skintest 测 lib/skin.js 纯函数，不碰渲染；没有 skin-view 渲染单测）。

- [ ] **Step 5: Commit**

```bash
git add control/lib/skin-view.js control/control.css
git commit -m "feat(control-ui): 皮肤编辑器折叠组重排 + 颜色卡片化 + 工具栏按钮分级"
```

---

## Task 8: SVG 图标系统 + 替换 UI emoji

**Files:**
- Create: `control/lib/icons.js`
- Modify: `control/index.html`（引入 icons.js）
- Modify: `control/lib/status-view.js`（🔊/🔇/✓/✗ → SVG）
- Modify: `control/control.js`（injectImage/injectVideo/muteVideo/unmuteVideo/remove/resize/setup 按钮文字前加 SVG——但按钮文字在 index.html，这里只改 control.js 里动态生成的部分，主要是 setJobMsg 不涉及。实际按钮文字在 index.html，所以 index.html 也要改）
- Modify: `control/index.html`（按钮 emoji → SVG）
- Modify: `test/statusviewtest.cjs`（🔊/🔇 断言 → SVG 断言）

**Interfaces:**
- Produces: `control/lib/icons.js` 导出 `ICONS` 对象（CommonJS + `window.__ccIcons`），键：`volume`/`volumeX`/`check`/`x`/`image`/`video`/`refresh`/`externalLink`/`trash`。

- [ ] **Step 1: 创建 `control/lib/icons.js`**

Lucide 风格 SVG（24×24 viewBox，stroke-width 1.5，stroke=currentColor，fill=none），内联字符串：

```js
// SVG 图标常量（Lucide 风格，spec §10）。UI 系统图标用 SVG 跨平台一致；
// 用户内容（skin 角标 emoji）保留不换。
// Dual export: CommonJS（Node 测）+ window.__ccIcons（浏览器用）。
var ICONS = {
  volume: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>',
  volumeX: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
  x: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
  image: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
  video: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>',
  refresh: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
  externalLink: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
  trash: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>'
};
if (typeof module !== "undefined" && module.exports) module.exports = ICONS;
if (typeof window !== "undefined") window.__ccIcons = ICONS;
```

- [ ] **Step 2: `control/index.html` 引入 icons.js + 替换按钮 emoji**

在 `<script src="lib/status-view.js">` **之前**加一行（status-view.js 要用 window.__ccIcons）：

```html
  <script src="lib/icons.js"></script>
  <script src="lib/status-view.js"></script>
```

替换壁纸 Tab 按钮文字（Task 5 后的 index.html）：

```html
        <button class="primary" data-action="injectImage"><span class="btn-icon"></span>注入图片壁纸</button>
        <button class="primary" data-action="injectVideo"><span class="btn-icon"></span>注入视频壁纸</button>
        <button data-action="muteVideo"><span class="btn-icon"></span>静音</button>
        <button data-action="unmuteVideo"><span class="btn-icon"></span>取消静音</button>
        <button class="danger" data-action="remove"><span class="btn-icon"></span>移除壁纸</button>
```

**注意**：`<span class="btn-icon">` 是占位，由 control.js 在 poll 时按 data-action 填充 SVG（因为 index.html 是静态的，不能直接写 `window.__ccIcons`）。或者更简单——**直接在 index.html 内联 SVG**（不走 JS 填充，避免轮询开销）。

改为直接内联（把上面替换为，用 icons.js 里的 SVG 字符串直接贴进 HTML）：

```html
        <button class="primary" data-action="injectImage"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> 注入图片壁纸</button>
        <button class="primary" data-action="injectVideo"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg> 注入视频壁纸</button>
        <button data-action="muteVideo"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg> 静音</button>
        <button data-action="unmuteVideo"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg> 取消静音</button>
        <button class="danger" data-action="remove"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> 移除壁纸</button>
```

维护按钮：

```html
        <button data-action="resize"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg> 重新缩图</button>
        <button data-action="setup">重装依赖</button>
```

打开阅读器链接（阅读 Tab 书架头）：

```html
        <div class="shelf-head"><h3>书架</h3><button id="open-reader" class="link-btn" title="去阅读界面">打开阅读器 <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></button></div>
```

**注意**：`data-action` 全部保留。skin 角标 emoji（用户内容）不动。

- [ ] **Step 3: 改 `control/lib/status-view.js`，把 emoji 换成 SVG（用 `window.__ccIcons`）**

`status-view.js` 顶部 `esc` 函数后加图标引用，并在用到 emoji 的地方替换。

在 `function esc(s) {...}` 之后加：

```js
// 图标（spec §10）：浏览器走 window.__ccIcons，Node 测无 window 时降级文本。
var ICONS = (typeof window !== "undefined" && window.__ccIcons) ? window.__ccIcons : null;
function icon(name, fallback) {
  return ICONS && ICONS[name] ? ICONS[name] : (fallback || "");
}
```

壁纸行的音频标记，把：

```js
      wSub += ' · ' + (w.videoMuted ? '🔇 静音' : '🔊 有声');
```

改为：

```js
      wSub += ' · ' + (w.videoMuted ? (icon("volumeX") + ' 静音') : (icon("volume") + ' 有声'));
```

资源行的依赖标记，把：

```js
    resSub = '依赖 ' + (depsOk ? '✓' : '✗');
```

改为：

```js
    resSub = '依赖 ' + (depsOk ? icon("check", "✓") : icon("x", "✗"));
```

**注意**：`icon(name, fallback)` 在 Node 测无 window 时返回 fallback（`✓`/`✗`），保证测试断言可改用 fallback 字符。浏览器里有 `window.__ccIcons` 返回 SVG。

- [ ] **Step 4: 在 `control/control.css` 追加 `.icon` 样式**

```css

/* ---- SVG 图标（spec §10.3） ---- */
.icon { width: 14px; height: 14px; vertical-align: middle; display: inline-block;
  margin-right: 2px; }
```

- [ ] **Step 5: 更新 `test/statusviewtest.cjs` 的 emoji 断言**

status-view.js 在 Node 测里 `window` 未定义，`icon()` 返回 fallback。把现有断言：

```js
check("status-view: video unmuted shows 🔊 有声", htmlV.indexOf("🔊 有声") !== -1);
...
check("status-view: video muted shows 🔇 静音", htmlM.indexOf("🔇 静音") !== -1);
check("status-view: video muted does NOT show 🔊 有声", htmlM.indexOf("🔊 有声") === -1);
...
check("status-view: image mode no audio marker", htmlI.indexOf("🔊 有声") === -1 && htmlI.indexOf("🔇 静音") === -1);
```

改为（fallback 字符 `🔊`/`🔇` 在 Node 下不出现，改为测"有声"/"静音"文本）：

```js
check("status-view: video unmuted shows 有声", htmlV.indexOf("有声") !== -1);
...
check("status-view: video muted shows 静音", htmlM.indexOf("静音") !== -1);
check("status-view: video muted does NOT show 有声", htmlM.indexOf("有声") === -1);
...
check("status-view: image mode no audio marker", htmlI.indexOf("有声") === -1 && htmlI.indexOf("静音") === -1);
```

**注意**：原断言用 emoji `🔊`/`🔇` 前缀，现在 Node 测 fallback 是纯文本（无 emoji 也无 SVG），所以只测"有声"/"静音"。浏览器里会有 SVG，但单测覆盖不到 SVG（前端 DOM 单测盲区，靠真机验）。

- [ ] **Step 6: 跑 statusviewtest 确认通过**

Run: `node test/statusviewtest.cjs`
Expected: 全 PASS。

- [ ] **Step 7: 跑全量测试**

Run: `npm test`
Expected: 全 28 个绿。

- [ ] **Step 8: Commit**

```bash
git add control/lib/icons.js control/index.html control/lib/status-view.js control/control.css test/statusviewtest.cjs
git commit -m "feat(control-ui): SVG 图标系统（UI emoji 换 Lucide SVG，用户角标 emoji 保留）"
```

---

## Task 9: 真机验证 + 收尾

**Files:** 无代码改动，纯验证 + 可能的小修。

**目的**：按 spec §13.2 真机验证清单逐项确认。前端 DOM/CSS + server↔浏览器契约是单测盲区（教训 12/13/27），必须真机点一遍。

- [ ] **Step 1: 在 ZCode webview 打开控制中心，逐项验证**

启动 ZCode（带 9222 debug port，`wallpaper.bat` 场景 2），webview 粘 `http://127.0.0.1:17890/control/`。

**结构层**：
- [ ] 4 个 Tab 显示，切换正常（总览/壁纸/阅读/皮肤）。
- [ ] 刷新页面后保持上次 Tab（localStorage `zcode-control:tab`）。

**总览 Tab**：
- [ ] 6 行状态行项排版（左标题右状态 + 次要信息）。
- [ ] ZCode 运行中绿点显示。
- [ ] 关掉 ZCode 重启不带 debug port → 端口未开行黄底 `warn-row`。
- [ ] 依赖缺失行红底 `err-row`（若 sharp 没装）。

**壁纸 Tab**：
- [ ] 4 个分组卡片显示，嵌套玻璃层次（elevated alpha 0.65 叠在 panel 0.55 上）。
- [ ] 主按钮（注入图片/视频/开始轮播）蓝填色，破坏性按钮（移除/停止）hover 红。
- [ ] SVG 图标显示（音量/图片/视频/刷新/外链），14px 对齐文字基线。
- [ ] 注入图片壁纸 → 成功，job-msg toast 绿 2.5s 淡出。
- [ ] 注入视频壁纸 → 有声播放，状态栏显示音量 SVG + 有声。
- [ ] 点静音 → 视频静音，job-msg 提示窗口数。
- [ ] 透明度输入 78 + 设透明 → 窗口变透明。
- [ ] 端口未开时注入按钮 disabled。

**阅读 Tab**：
- [ ] 书架 + 书签在一个面板内，分区标题正确。
- [ ] 书项/书签项卡片化 + hover 高亮。
- [ ] 点书项跳 reader（`?book=`）、✕ 删除书、+ 加入书架正常。
- [ ] 书签添加 + 点跳 go.html + ✕ 删除正常。
- [ ] stale 书（若有）红条显示。
- [ ] bm-port-warn 在端口未开时显示黄横幅。

**皮肤 Tab**：
- [ ] 主题选择/应用/移除正常。
- [ ] 编辑器 4 个折叠组：基本信息 + 颜色默认展开，角标与闪光默认折叠，壁纸叠加沿用。
- [ ] 颜色卡片化，picker 40px 好点。
- [ ] 改颜色/字体/圆角 → 保存 → 应用生效（collectEditor 收集正确）。
- [ ] 角标 emoji 增删正常（用户 emoji 保留）。
- [ ] 预设只读徽章 + fieldset disabled 不可编辑。

**视觉层**：
- [ ] 换一张亮壁纸（天空/雪景），控制中心文字清晰（alpha 0.55 + blur 24 验证解决教训 2）。
- [ ] 换暗壁纸，对比度正常。
- [ ] 玻璃面板投影 + 顶部 1px 高光可见。
- [ ] prefers-reduced-motion 开启（系统设置）后按钮无 scale 动画。

**回归**：
- [ ] 壁纸从控制中心面板后面透出正常（A1 红线未破）。
- [ ] 普通浏览器打开控制中心降级正常（无壁纸但控件可用）。

- [ ] **Step 2: 修复真机发现的问题（若有）**

逐个修复，每个修复独立 commit。

- [ ] **Step 3: 最终全量测试**

Run: `npm test`
Expected: 全 28 个绿。

- [ ] **Step 4: 更新 AGENTS.md（若引入了新的设计范式/教训）**

若真机发现新的单测盲区或设计约束，追加到 `AGENTS.md` 对应章节（"控制中心"小节）。

- [ ] **Step 5: 最终 commit + 分支总结**

```bash
git add -A
git commit -m "docs(control-ui): 真机验证完成 + 收尾"
```

分支 `feat/control-ui-revamp` 可合并。

---

## Self-Review（计划自审）

**1. Spec coverage（逐节对照）**：
- spec §1（决策）→ 全计划体现 ✓
- spec §2（Tab 架构）→ Task 3 ✓
- spec §3（Token）→ Task 1 ✓
- spec §4（玻璃面板）→ Task 1 ✓
- spec §5（Tab 栏）→ Task 3 ✓
- spec §6（总览行项）→ Task 4 ✓
- spec §7（壁纸分组）→ Task 5 ✓
- spec §8（阅读 Tab）→ Task 6 ✓
- spec §9（皮肤编辑器）→ Task 7 ✓
- spec §10（SVG 图标）→ Task 8 ✓
- spec §11（交互反馈）→ Task 2（焦点环/reduced-motion）+ Task 5（toast）✓
- spec §12（工程约束）→ Global Constraints + 各 Task 约束 ✓
- spec §13（测试验证）→ 各 Task 测试 + Task 9 真机 ✓
- spec §14（遗留）→ 无需任务（记录性）✓
- spec §15（实施顺序）→ Task 1-9 对应 ✓

**2. Placeholder 扫描**：无 TBD/TODO。所有步骤含完整代码 ✓

**3. 类型/签名一致性**：
- `renderStatus(st)` 签名不变（Task 4）✓
- `data-action`/`data-skin-act`/`data-field` 等 attribute 全程保留 ✓
- `ICONS` 对象键名（Task 8 定义 `volume`/`volumeX`/`check`/`x` 等）与 status-view.js 使用处（Task 8 Step 3 `icon("volumeX")`/`icon("check")`）一致 ✓
- `setJobMsg(text, kind)` 定义（Task 5）与调用处（Task 5 Step 4）一致 ✓
- `activateTab(name)` 定义与调用（Task 3）一致 ✓

**4. 潜在风险点**（已在 Task 内标注）：
- Task 7 Step 3 要求手动删除原 control.css 第 56-86 行旧 skin 样式——执行时注意行号可能因前面 Task 插入而偏移，按内容（`/* ---- skin panel (spec §5) ---- */` 到 `.skin-opacity-row span`）定位删除。
- Task 8 status-view.js 在 Node 测无 `window`，`icon()` 返回 fallback——测试断言已相应调整。

计划完整，可执行。
