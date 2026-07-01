# 小说阅读器 epub 支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `.txt`-only 小说阅读器里新增 epub 格式支持——server 端解析 epub、sanitize XHTML、托管 CSS/图片，前端按 format 分派渲染，txt 路径零改动。

**Architecture:** epub 差异完全封装在 server 端（`lib/epub.cjs` 纯函数 + `lib/control-server.cjs` 加载/章节/asset 端点分派）。bookId/toc 形状/书架/进度全部复用 txt 路径。前端只在"章节内容渲染"一处分派。依赖已 spike 验证（见 spec §3.1 真实 API 表）。

**Tech Stack:** `@likecoin/epub-ts`（epub 解析，已装）+ `sanitize-html`（XSS sanitize + src 改写，已装）+ `jszip`（底层二进制读取，epub-ts 的依赖，已装）+ `linkedom`（epub-ts peer dep，已装）。

## Global Constraints

- **txt 路径一行不改**：`reader-codec.cjs`、`reader-toc.cjs`、`detectEncoding`、parseTOC、前言/后记识别全保留。
- **bookId 共用**：`bookIdFor(filename)` 不改，epub 和 txt 同一 id 空间。
- **epub 差异封装在 server 端**：前端只在章节渲染分派，目录/翻页/进度/书架零区分。
- **依赖已装**（spike 阶段）：`@likecoin/epub-ts`/`sanitize-html`/`jszip`/`linkedom` 在 `package.json`，不要重复装。
- **真实 API 命门**（spec §3.1，spike 验证）：读 XHTML/CSS/图片**必须用 `book.archive.zip`（底层 jszip）**，**不用 `book.archive.request`**（对二进制返回乱码）；`book.resolve(href)` 返回的路径有前导 `/`，**必须 `.replace(/^\//,"")`** 给 jszip。
- **测试风格**：纯 `check(name, cond)` 断言、`PASS ✓ / FAIL ✗`、IIFE 分组（对齐现有 `test/*.cjs`）。
- **PowerShell 一律 `.ps1 -File`，不内联 `-Command`**（AGENTS.md 环境注意）。
- **`npm test` 必须保持全绿**：每个任务结束前跑一次确认无回归。

---

## File Structure

**新增文件：**
- `lib/epub.cjs` —— epub 解析纯函数层（可单测）。职责：`buildTocFromNav`/`buildSpineIndex`/`scopeCss`/`rewriteAssetRefs`/`isAllowedAssetHref`/`sanitizeChapterXhtml`。不碰 CDP、不碰 server。
- `lib/epub-load.cjs` —— epub 加载胶水（调 `@likecoin/epub-ts` 解 zip + 调 `lib/epub.cjs` 纯函数组装 library 条目）。胶水部分真机验。
- `test/epubtest.cjs` —— `lib/epub.cjs` 纯函数单测。
- `test/epubloadtest.cjs` —— `lib/epub-load.cjs` 可纯函数化部分的测试 + 用真 fixture 验加载。
- `test/fixtures/make-epub.cjs` —— 生成测试 epub fixture 的脚本（spike 已写好，迁入）。
- `test/fixtures/*.epub` —— 生成产物（gitignore，运行时生成）。
- `test/epubservertest.cjs` —— control-server 的 epub 端点（chapter/asset/格式分派）测试。

**改动文件：**
- `lib/control-server.cjs` —— `buildLibrary` 加 `.epub` 分派；library 条目加 `format` 字段；chapter 端点按 format 分派响应；新增 `/api/book/:id/asset` 端点；`guessMime` 扩展。
- `reader/lib/book.js` —— `openHttp` 章节响应按 format 分派（txt 走老路，epub 调新渲染）。
- `reader/reader.js` —— 新增 `renderEpubChapter(html, cssHrefs)` + `#epub-content` 容器；改 `showChapter` 按格式分派；改拖拽提示。
- `reader/reader.css` —— `#epub-content` 容器样式。
- `reader/index.html` —— 加 `#epub-content` 节点。
- `package.json` —— `scripts.test` 加新测试（`epubtest`/`epubloadtest`/`epubservertest`）。
- `AGENTS.md` —— 加"小说阅读器 epub 支持"小节 + 教训补丁 29。

---

## Task 1: epub 纯函数层 —— scopeCss（CSS 作用域隔离）

**Files:**
- Create: `lib/epub.cjs`
- Test: `test/epubtest.cjs`

**Interfaces:**
- Produces: `scopeCss(cssText, scopeId)` —— 给 CSS 每条选择器加 scope 前缀。`scopeId` 是不带 `#` 的 id 字符串（如 `"epub-content"`）。返回 scoped CSS 字符串。

- [ ] **Step 1: Write the failing test**

Create `test/epubtest.cjs`:

```js
// Test for lib/epub.cjs — epub parsing pure functions (spec §3, §5).
// Run: node test/epubtest.cjs
const lib = require("../lib/epub.cjs");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// --- scopeCss: prefix every selector with #scopeId ---
(function(){
  const { scopeCss } = lib;
  // simple tag selector
  check("tag selector scoped",
    scopeCss("p { color: red; }", "epub-content").includes("#epub-content p"));
  // body/global selector
  check("body scoped",
    scopeCss("body { font-family: serif; }", "epub-content").includes("#epub-content body"));
  // class selector
  check("class scoped",
    scopeCss(".chapter-text { text-indent: 2em; }", "epub-content").includes("#epub-content .chapter-text"));
  // descendant selector — only outermost gets prefix
  check("descendant scoped (prefix outermost)",
    /#epub-content\s+ul\s+li/.test(scopeCss("ul li { margin: 0; }", "epub-content")));
  // comma-separated selectors — both get prefix
  const comma = scopeCss("h1, h2 { color: black; }", "epub-content");
  check("comma list both scoped", comma.includes("#epub-content h1") && comma.includes("#epub-content h2"));
  // @media preserved, inner selectors scoped
  const media = scopeCss("@media (max-width: 600px) { p { font-size: 14px; } }", "epub-content");
  check("@media block kept", media.includes("@media"));
  check("@media inner scoped", media.includes("#epub-content p"));
  // declarations untouched
  const decl = scopeCss("p { color: red; background: url(x); }", "epub-content");
  check("declaration block untouched", decl.includes("color: red") && decl.includes("url(x)"));
})();

// --- scopeCss edge cases ---
(function(){
  const { scopeCss } = lib;
  // id selector
  check("id selector scoped",
    scopeCss("#cover { display: none; }", "epub-content").includes("#epub-content #cover"));
  // empty input
  check("empty css returns empty", scopeCss("", "epub-content") === "");
  // css with no selectors (only comment)
  check("comment-only preserved",
    scopeCss("/* hi */", "epub-content").includes("hi") || scopeCss("/* hi */", "epub-content") === "");
})();

if (fail > 0) { console.error("\n" + fail + " FAILED"); process.exit(1); }
console.log("\n" + pass + " passed, " + fail + " failed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/epubtest.cjs`
Expected: FAIL — `Cannot find module '../lib/epub.cjs'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/epub.cjs`:

```js
// epub parsing pure functions (spec §3, §5). No CDP, no server, no side effects.
// Tested by test/epubtest.cjs.

// Scope every CSS selector under #<scopeId> so epub CSS can't leak to reader UI.
// Approach: split into rule blocks, prefix each selector in the selector list.
// Handles @media/@supports by recursing into the block body.
function scopeCss(cssText, scopeId) {
  if (!cssText || !cssText.trim()) return "";
  const prefix = "#" + scopeId;
  return scopeChunk(cssText, prefix);
}

function scopeChunk(text, prefix) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    // skip whitespace, copy verbatim
    const wsMatch = text.slice(i).match(/^\s+/);
    if (wsMatch) { out += wsMatch[0]; i += wsMatch[0].length; }
    if (i >= text.length) break;

    // comment?
    if (text[i] === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }

    // at-rule with block (@media / @supports): scope inside the block
    const atBlock = text.slice(i).match(/^@(?:media|supports|document)\s+([^{]*)\{/);
    if (atBlock) {
      const prelude = atBlock[0];
      out += prelude;
      i += prelude.length;
      // find matching closing brace (no nesting assumption for simplicity; epub CSS rarely nests at-rules)
      const close = text.indexOf("}", i);
      const innerEnd = close === -1 ? text.length : close;
      out += scopeChunk(text.slice(i, innerEnd), prefix);
      if (close !== -1) { out += "}"; i = innerEnd + 1; }
      else { i = text.length; }
      continue;
    }

    // other at-rule without block (@import / @charset / @font-face with single block)
    // @font-face has a block but its "selector" isn't a selector — keep verbatim
    const fontFace = text.slice(i).match(/^@font-face\s*\{/);
    if (fontFace) {
      const close = text.indexOf("}", i);
      const stop = close === -1 ? text.length : close + 1;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    // @import / @charset — line/rule ending at ; — keep verbatim (CSS sanitize strips @import separately)
    const atLine = text.slice(i).match(/^@[a-zA-Z-]+\s+[^;{}]*;/);
    if (atLine) {
      out += atLine[0];
      i += atLine[0].length;
      continue;
    }

    // normal rule: selector list { declarations }
    const brace = text.indexOf("{", i);
    if (brace === -1) { out += text.slice(i); break; }
    const selectorList = text.slice(i, brace);
    const close = text.indexOf("}", brace);
    const declEnd = close === -1 ? text.length : close;
    const declBlock = text.slice(brace, declEnd + (close === -1 ? 0 : 1));
    const scoped = selectorList.split(",").map(s => prefix + " " + s.trim()).join(", ");
    out += scoped + " " + declBlock;
    i = declEnd + (close === -1 ? 0 : 1);
  }
  return out;
}

module.exports = { scopeCss };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/epubtest.cjs`
Expected: all PASS, `X passed, 0 failed`

- [ ] **Step 5: Run full suite for regression**

Run: `npm test`
Expected: all existing tests still pass (29 passed before this task; epubtest not yet in suite script).

- [ ] **Step 6: Commit**

```bash
git add lib/epub.cjs test/epubtest.cjs
git commit -m "feat(reader-epub): add scopeCss pure function for CSS isolation"
```

---

## Task 2: epub 纯函数层 —— isAllowedAssetHref（路径穿越防护）

**Files:**
- Modify: `lib/epub.cjs`
- Modify: `test/epubtest.cjs`

**Interfaces:**
- Produces: `isAllowedAssetHref(href, allowedSet)` —— `allowedSet` 是 `Set<string>`（buildLibrary 时登记的合法 asset href 集合）。`href` 是请求的路径。返回 boolean：仅当 `href` 严格等于集合中某项时 true。

- [ ] **Step 1: Write the failing test**

Append to `test/epubtest.cjs` (before the final `if (fail > 0)` block):

```js
// --- isAllowedAssetHref: path-traversal defense (spec §4.3) ---
(function(){
  const { isAllowedAssetHref } = lib;
  const allowed = new Set(["images/red.png", "styles/main.css", "OEBPS/chap1.xhtml"]);
  // whitelist member
  check("exact whitelist member allowed", isAllowedAssetHref("images/red.png", allowed) === true);
  check("another whitelist member", isAllowedAssetHref("styles/main.css", allowed) === true);
  // not in whitelist
  check("unknown href rejected", isAllowedAssetHref("images/secret.png", allowed) === false);
  // path traversal attempts
  check("../../etc/passwd rejected", isAllowedAssetHref("../../etc/passwd", allowed) === false);
  check("..\\..\\windows rejected", isAllowedAssetHref("..\\..\\win.ini", allowed) === false);
  // URL-encoded traversal
  check("encoded ..%2f rejected", isAllowedAssetHref("images%2F..%2F..%2Fetc%2Fpasswd", allowed) === false);
  // empty/null
  check("empty href rejected", isAllowedAssetHref("", allowed) === false);
  check("null href rejected", isAllowedAssetHref(null, allowed) === false);
  // absolute path (not in whitelist as-is)
  check("/etc/passwd rejected", isAllowedAssetHref("/etc/passwd", allowed) === false);
  // case-sensitive (don't normalize — strict equality)
  check("case-sensitive: IMAGES/RED.PNG != images/red.png",
    isAllowedAssetHref("IMAGES/RED.PNG", allowed) === false);
  // empty whitelist rejects everything
  check("empty whitelist rejects all", isAllowedAssetHref("images/red.png", new Set()) === false);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/epubtest.cjs`
Expected: FAIL — `isAllowedAssetHref is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `lib/epub.cjs` (before `module.exports`):

```js
// Path-traversal defense (spec §4.3): a requested asset href is allowed ONLY if it
// is an exact member of the whitelist set built at load time. No normalization,
// no decoding, no path math — strict set membership only. This rejects
// "../../etc/passwd", "..%2f..%2f" (encoded traversal), and anything not registered.
function isAllowedAssetHref(href, allowedSet) {
  if (!href || typeof href !== "string") return false;
  if (!allowedSet || typeof allowedSet.has !== "function") return false;
  return allowedSet.has(href);
}
```

Update `module.exports`:
```js
module.exports = { scopeCss, isAllowedAssetHref };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/epubtest.cjs`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add lib/epub.cjs test/epubtest.cjs
git commit -m "feat(reader-epub): add isAllowedAssetHref path-traversal guard"
```

---

## Task 3: epub 纯函数层 —— buildTocFromNav + buildSpineIndex（目录/spine 构造）

**Files:**
- Modify: `lib/epub.cjs`
- Modify: `test/epubtest.cjs`

**Interfaces:**
- Produces:
  - `buildSpineIndex(spineItems)` —— `spineItems: [{href}]`（来自 `book.spine`）→ `[{href, title}]`（title 暂为 null，由 load 层后续填充）。保持顺序。
  - `buildTocFromNav(navToc, spineIndex)` —— `navToc: [{label, href, subitems}]`（来自 `book.navigation.toc`）+ `spineIndex`（buildSpineIndex 的输出）→ `{chapters:[{title, spineIndex}], volumes:[{title, startChapterIndex}]}`。shape 对齐 txt 的 toc（前端零区分）。把 nav 的 href 匹配到 spineIndex（按 basename 匹配）。

- [ ] **Step 1: Write the failing test**

Append to `test/epubtest.cjs`:

```js
// --- buildSpineIndex: spine items -> indexed list ---
(function(){
  const { buildSpineIndex } = lib;
  const spine = buildSpineIndex([{href:"chap1.xhtml"}, {href:"chap2.xhtml"}]);
  check("spine length 2", spine.length === 2);
  check("spine[0].href", spine[0].href === "chap1.xhtml");
  check("spine[1].href", spine[1].href === "chap2.xhtml");
  check("spine title null pending fill", spine[0].title === null);
  // empty spine
  check("empty spine -> empty array", buildSpineIndex([]).length === 0);
})();

// --- buildTocFromNav: map nav toc onto spine indices, shape aligned with txt ---
(function(){
  const { buildSpineIndex, buildTocFromNav } = lib;
  const spine = buildSpineIndex([{href:"chap1.xhtml"}, {href:"chap2.xhtml"}, {href:"chap3.xhtml"}]);
  const nav = [
    { label: "第一章 开始", href: "chap1.xhtml", subitems: [] },
    { label: "第二章 继续", href: "chap2.xhtml", subitems: [] },
    { label: "第三章 结束", href: "chap3.xhtml", subitems: [] },
  ];
  const toc = buildTocFromNav(nav, spine);
  // shape aligned with txt toc: { chapters, volumes }
  check("toc has chapters array", Array.isArray(toc.chapters));
  check("toc has volumes array", Array.isArray(toc.volumes));
  check("3 chapters", toc.chapters.length === 3);
  check("chapter title from nav", toc.chapters[0].title === "第一章 开始");
  check("chapter spineIndex 0", toc.chapters[0].spineIndex === 0);
  check("chapter spineIndex 2", toc.chapters[2].spineIndex === 2);
  // no volumes when nav is flat
  check("flat nav -> no volumes", toc.volumes.length === 0);
})();

// --- buildTocFromNav: nested nav -> volumes + chapters (two-level) ---
(function(){
  const { buildSpineIndex, buildTocFromNav } = lib;
  const spine = buildSpineIndex([
    {href:"c1.xhtml"},{href:"c2.xhtml"},{href:"c3.xhtml"},{href:"c4.xhtml"}
  ]);
  const nav = [
    { label: "卷一", href: "c1.xhtml", subitems: [
      { label: "第一章", href: "c1.xhtml", subitems: [] },
      { label: "第二章", href: "c2.xhtml", subitems: [] },
    ]},
    { label: "卷二", href: "c3.xhtml", subitems: [
      { label: "第三章", href: "c3.xhtml", subitems: [] },
      { label: "第四章", href: "c4.xhtml", subitems: [] },
    ]},
  ];
  const toc = buildTocFromNav(nav, spine);
  check("nested: 4 chapters", toc.chapters.length === 4);
  check("nested: 2 volumes", toc.volumes.length === 2);
  check("nested: volume 1 starts at chapter 0", toc.volumes[0].startChapterIndex === 0);
  check("nested: volume 2 starts at chapter 2", toc.volumes[1].startChapterIndex === 2);
  check("nested: volume title kept", toc.volumes[0].title === "卷一");
})();

// --- buildTocFromNav: nav href with fragment (#id) still matches spine ---
(function(){
  const { buildSpineIndex, buildTocFromNav } = lib;
  const spine = buildSpineIndex([{href:"chap1.xhtml"}]);
  const nav = [{ label: "Ch1", href: "chap1.xhtml#section1", subitems: [] }];
  const toc = buildTocFromNav(nav, spine);
  check("href with fragment matches spine", toc.chapters.length === 1 && toc.chapters[0].spineIndex === 0);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/epubtest.cjs`
Expected: FAIL — `buildSpineIndex is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `lib/epub.cjs` (before `module.exports`):

```js
// Strip any #fragment from an href for spine matching.
function stripFragment(href) {
  const i = (href || "").indexOf("#");
  return i === -1 ? (href || "") : href.slice(0, i);
}
// basename: last path segment (chap1.xhtml from OEBPS/chap1.xhtml or chap1.xhtml)
function basename(p) {
  if (!p) return "";
  const norm = p.replace(/\\/g, "/").replace(/^\//, "");
  const i = norm.lastIndexOf("/");
  return i === -1 ? norm : norm.slice(i + 1);
}

// spine items -> indexed list (titles filled later by load layer).
function buildSpineIndex(spineItems) {
  return (spineItems || []).map(s => ({ href: s.href, title: null }));
}

// Map a nav href to a spine index by basename match (strip fragments, match leaf name).
function matchSpineIndex(navHref, spine) {
  const target = basename(stripFragment(navHref));
  for (let i = 0; i < spine.length; i++) {
    if (basename(spine[i].href) === target) return i;
  }
  return -1;
}

// Build {chapters, volumes} from epubjs nav shape {label, href, subitems}.
// Two-level: top-level entries with subitems become volumes; their subitems + flat
// top-level entries become chapters. Shape aligns with txt toc (reader.js:86-93).
function buildTocFromNav(navToc, spine) {
  const chapters = [];
  const volumes = [];
  function pushLeaf(label, href) {
    const idx = matchSpineIndex(href, spine);
    if (idx >= 0) chapters.push({ title: label, spineIndex: idx });
  }
  for (const item of (navToc || [])) {
    if (item.subitems && item.subitems.length > 0) {
      // nested: this is a volume
      const volStart = chapters.length;
      volumes.push({ title: item.label, startChapterIndex: volStart });
      for (const sub of item.subitems) {
        pushLeaf(sub.label, sub.href);
      }
    } else {
      pushLeaf(item.label, item.href);
    }
  }
  // dedupe chapters by spineIndex (nav sometimes repeats), keep first
  const seen = new Set();
  const dedup = [];
  for (const c of chapters) {
    if (!seen.has(c.spineIndex)) { seen.add(c.spineIndex); dedup.push(c); }
  }
  return { chapters: dedup, volumes };
}
```

Update `module.exports`:
```js
module.exports = { scopeCss, isAllowedAssetHref, buildSpineIndex, buildTocFromNav };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/epubtest.cjs`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add lib/epub.cjs test/epubtest.cjs
git commit -m "feat(reader-epub): add buildSpineIndex + buildTocFromNav (toc shape aligned with txt)"
```

---

## Task 4: epub 纯函数层 —— sanitizeChapterXhtml（XSS sanitize + src 改写一次完成）

**Files:**
- Modify: `lib/epub.cjs`
- Modify: `test/epubtest.cjs`

**Interfaces:**
- Produces: `sanitizeChapterXhtml(rawXhtml, bookId)` —— 用 `sanitize-html` 白名单剥 XSS + `transformTags.img`/`link` 改写 src/href 到 `/api/book/:id/asset?href=encoded`。返回 sanitize 后的 HTML 片段字符串。**包内只对应白名单内的相对路径做改写**；`http:`/`https:` 绝对 URL 不改写（外链）。

- [ ] **Step 1: Write the failing test**

Append to `test/epubtest.cjs`:

```js
// --- sanitizeChapterXhtml: XSS strip + src rewrite in one pass (spec §4.2, §4.4) ---
(function(){
  const { sanitizeChapterXhtml } = lib;
  const raw = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title>
<link rel="stylesheet" href="styles/main.css"/></head>
<body>
<h1 class="t">Title</h1>
<p class="chapter-text">text</p>
<img src="images/red.png" alt="r"/>
<script>alert(1)</script>
<img src="x" onerror="alert(2)"/>
<a href="javascript:alert(3)">evil</a>
<iframe src="evil.html"></iframe>
<div style="color:red">x</div>
<a href="https://example.com/path">external</a>
<img src="https://example.com/ext.png"/>
</body></html>`;
  const out = sanitizeChapterXhtml(raw, "b123");
  // XSS stripped
  check("script stripped", !out.includes("<script"));
  check("onerror stripped", !out.includes("onerror"));
  check("javascript: scheme stripped", !out.toLowerCase().includes("javascript:"));
  check("iframe stripped", !out.includes("<iframe"));
  check("style attr stripped", !out.includes("style="));
  // legit content kept
  check("h1 kept", /<h1[^>]*class="t"/.test(out));
  check("p.chapter-text kept", out.includes('class="chapter-text"'));
  // relative src rewritten to asset endpoint
  check("img src rewritten to asset", out.includes("/api/book/b123/asset?href=") && out.includes("red.png"));
  // external http(s) URLs NOT rewritten
  check("external https img not rewritten",
    out.includes('src="https://example.com/ext.png"'));
  check("external https link not rewritten",
    out.includes('href="https://example.com/path"'));
  // encoded path
  check("rewritten href is encoded", out.includes("images%2Fred.png"));
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/epubtest.cjs`
Expected: FAIL — `sanitizeChapterXhtml is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to top of `lib/epub.cjs` (after the comment header):
```js
const sanitizeHtml = require("sanitize-html");
```

Add before `module.exports`:
```js
// Whitelist for epub XHTML (spec §4.2). Keeps semantic content tags, drops
// script/iframe/style-attr/event-handlers and javascript: schemes.
const XHTML_ALLOWED_TAGS = [
  "p","h1","h2","h3","h4","h5","h6","span","em","i","b","strong","u","s","strike",
  "a","img","ul","ol","li","table","tr","td","th","thead","tbody","tfoot","caption",
  "br","hr","blockquote","q","cite","sub","sup","small","ruby","rt","rp","div",
  "pre","code","dl","dt","dd","figure","figcaption","abbr","kbd","var","samp",
];
const XHTML_ALLOWED_ATTRIBUTES = {
  a: ["href", "title", "name"],
  img: ["src", "alt", "title", "width", "height"],
  "*": ["class", "id", "colspan", "rowspan", "lang", "dir"],
};

// Rewrite a single src/href value: relative -> /api/book/:id/asset?href=encoded.
// Absolute http(s) URLs are left alone (external resources).
function rewriteRef(value, bookId) {
  if (!value || typeof value !== "string") return value;
  if (/^https?:/i.test(value)) return value;        // external, untouched
  if (value.startsWith("/api/")) return value;       // already rewritten
  if (value.startsWith("data:") || value.startsWith("#")) return value; // inline/same-page
  return "/api/book/" + bookId + "/asset?href=" + encodeURIComponent(value);
}

// Sanitize + rewrite in one sanitize-html pass (spec §4.4).
function sanitizeChapterXhtml(rawXhtml, bookId) {
  const opts = {
    allowedTags: XHTML_ALLOWED_TAGS,
    allowedAttributes: XHTML_ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https"],     // blocks javascript:, data: in href/src
    allowedSchemesByTag: { img: ["http", "https"] }, // no data: images either (YAGNI)
    transformTags: {
      img: (tag, attribs) => {
        if (attribs.src) attribs.src = rewriteRef(attribs.src, bookId);
        return { tagName: tag, attribs };
      },
      a: (tag, attribs) => {
        if (attribs.href) attribs.href = rewriteRef(attribs.href, bookId);
        return { tagName: tag, attribs };
      },
      // strip <link rel=stylesheet> entirely — CSS goes through scoped asset path, not inline
      link: () => ({ tagName: "span", attribs: {}, text: "" }),
    },
    // drop <style> blocks
    exclusiveFilter: (frame) => frame.tag === "style" || frame.tag === "link",
  };
  return sanitizeHtml(rawXhtml, opts);
}
```

Update `module.exports`:
```js
module.exports = { scopeCss, isAllowedAssetHref, buildSpineIndex, buildTocFromNav, sanitizeChapterXhtml };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/epubtest.cjs`
Expected: all PASS

- [ ] **Step 5: Run full suite for regression**

Run: `npm test`
Expected: all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/epub.cjs test/epubtest.cjs
git commit -m "feat(reader-epub): add sanitizeChapterXhtml (XSS strip + src rewrite one pass)"
```

---

## Task 5: 测试 fixtures —— 生成 epub 的脚本（迁自 spike）

**Files:**
- Create: `test/fixtures/make-epub.cjs`
- Create: `test/fixtures/.gitignore`（生成产物不入库）

**Interfaces:**
- Produces: 运行 `node test/fixtures/make-epub.cjs` 在 `test/fixtures/` 生成 `normal.epub`（2 章 + CSS + 图片 + NCX + nav + XSS 探针）。这个 fixture 给 Task 6/7 的加载测试和真机验证用。

- [ ] **Step 1: Create the fixture generator**

Create `test/fixtures/make-epub.cjs` (迁自 spike，已验证可生成合法 epub):

```js
// Generate test epub fixtures for epub support (spec §6.4).
// Run: node test/fixtures/make-epub.cjs
// Produces: normal.epub (2 chapters, CSS, image, NCX+nav, XSS probes).
// Fixtures are gitignored — regenerate when needed.
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");

function makeNormalEpub() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml",
`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  zip.file("OEBPS/images/red.png", PNG);
  zip.file("OEBPS/styles/main.css",
`body { font-family: serif; }
p.chapter-text { text-indent: 2em; color: #333; }
@import url("should-be-stripped.css");`);
  zip.file("OEBPS/chap1.xhtml",
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title>
<link rel="stylesheet" type="text/css" href="styles/main.css"/></head>
<body>
<h1>第一章 开始</h1>
<p class="chapter-text">这是第一段正文。</p>
<p class="chapter-text">这是第二段正文。</p>
<p><img src="images/red.png" alt="红点"/></p>
<script>alert('xss-script')</script>
<img src="x" onerror="alert('xss-onerror')"/>
<a href="javascript:alert('xss-js')">evil link</a>
</body></html>`);
  zip.file("OEBPS/chap2.xhtml",
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 2</title></head>
<body><h1>第二章 继续</h1><p>第二章内容。</p></body>
</html>`);
  zip.file("OEBPS/content.opf",
`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Spike Test Book</dc:title><dc:creator>Tester</dc:creator>
<dc:language>zh</dc:language><dc:identifier id="bookid">spike-001</dc:identifier>
</metadata>
<manifest>
<item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
<item id="chap2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
<item id="css" href="styles/main.css" media-type="text/css"/>
<item id="img" href="images/red.png" media-type="image/png"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
</manifest>
<spine toc="ncx"><itemref idref="chap1"/><itemref idref="chap2"/></spine>
</package>`);
  zip.file("OEBPS/toc.ncx",
`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="spike-001"/></head>
<docTitle><text>Spike Test Book</text></docTitle>
<navMap>
<navPoint id="c1" playOrder="1"><navLabel><text>第一章 开始</text></navLabel><content src="chap1.xhtml"/></navPoint>
<navPoint id="c2" playOrder="2"><navLabel><text>第二章 继续</text></navLabel><content src="chap2.xhtml"/></navPoint>
</navMap></ncx>`);
  zip.file("OEBPS/nav.xhtml",
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="chap1.xhtml">第一章 开始</a></li>
<li><a href="chap2.xhtml">第二章 继续</a></li>
</ol></nav></body></html>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

(async () => {
  const buf = await makeNormalEpub();
  const out = path.join(__dirname, "normal.epub");
  fs.writeFileSync(out, buf);
  console.log("WROTE", out, buf.length, "bytes");
})();
```

- [ ] **Step 2: Add gitignore for generated fixtures**

Create `test/fixtures/.gitignore`:
```
*.epub
```

- [ ] **Step 3: Verify generation works**

Run: `node test/fixtures/make-epub.cjs`
Expected: `WROTE .../normal.epub NNNN bytes`

Verify the file exists: `ls test/fixtures/normal.epub`

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/make-epub.cjs test/fixtures/.gitignore
git commit -m "test(reader-epub): add epub fixture generator (migrated from spike)"
```

---

## Task 6: epub 加载胶水 —— lib/epub-load.cjs（调库解 zip + 组装 library 条目）

**Files:**
- Create: `lib/epub-load.cjs`
- Create: `test/epubloadtest.cjs`

**Interfaces:**
- Consumes: `lib/epub.cjs`（`buildSpineIndex`/`buildTocFromNav`）+ `@likecoin/epub-ts`（`Book`）+ `test/fixtures/normal.epub`（fixture）。
- Produces: `loadEpub(filePath)` —— async，返回 library 条目对象 `{ format:"epub", toc:{chapters,volumes}, spine, resources, _book }`。`_book` 保留 `book.archive.zip` 句柄供章节懒加载用（不暴露给前端）。
- Produces: `getEpubChapter(entry, n, bookId)` —— async，懒加载第 n 章：从 zip 取 XHTML、`sanitizeChapterXhtml`、返回 `{format:"epub", index, title, html, cssHrefs, prev, next}`。
- Produces: `readEpubAsset(entry, href)` —— async，按白名单读 CSS/图片字节。返回 `{data, mime}` 或 null（href 不在白名单）。

- [ ] **Step 1: Write the failing test**

Create `test/epubloadtest.cjs`:

```js
// Test for lib/epub-load.cjs — epub loading glue (spec §3.3, §3.4).
// Uses real fixture (regenerate with: node test/fixtures/make-epub.cjs).
// Run: node test/epubloadtest.cjs
const fs = require("fs");
const path = require("path");

const fixture = path.join(__dirname, "fixtures", "normal.epub");
if (!fs.existsSync(fixture)) {
  console.error("MISSING fixture. Run: node test/fixtures/make-epub.cjs");
  process.exit(1);
}

const { loadEpub, getEpubChapter, readEpubAsset } = require("../lib/epub-load.cjs");
const { bookIdFor } = require("../lib/control-server.cjs");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

(async () => {
  // --- loadEpub ---
  const entry = await loadEpub(fixture);
  check("format is epub", entry.format === "epub");
  check("toc has 2 chapters", entry.toc.chapters.length === 2);
  check("chapter 0 title", entry.toc.chapters[0].title === "第一章 开始");
  check("chapter 0 spineIndex", entry.toc.chapters[0].spineIndex === 0);
  check("chapter 1 spineIndex", entry.toc.chapters[1].spineIndex === 1);
  check("spine length 2", entry.spine.length === 2);
  check("resources.css has main.css", Object.values(entry.resources.css).some(h => h.includes("main.css")));
  check("resources.images has red.png", Object.values(entry.resources.images).some(h => h.includes("red.png")));

  // --- getEpubChapter (sanitize + lazy) ---
  const bookId = bookIdFor("normal.epub");
  const ch0 = await getEpubChapter(entry, 0, bookId);
  check("chapter format epub", ch0.format === "epub");
  check("chapter index 0", ch0.index === 0);
  check("chapter title set", ch0.title === "第一章 开始");
  check("chapter html non-empty", typeof ch0.html === "string" && ch0.html.length > 0);
  // XSS probes stripped
  check("chapter html no <script>", !ch0.html.includes("<script"));
  check("chapter html no onerror", !ch0.html.includes("onerror"));
  // src rewritten
  check("chapter html img src rewritten", ch0.html.includes("/api/book/" + bookId + "/asset?href="));
  // cssHrefs provided (link to asset endpoint)
  check("chapter cssHrefs is array", Array.isArray(ch0.cssHrefs) && ch0.cssHrefs.length > 0);
  check("chapter cssHrefs point to asset endpoint", ch0.cssHrefs[0].includes("/api/book/" + bookId + "/asset?href="));
  // prev/next
  check("chapter 0 prev null", ch0.prev === null);
  check("chapter 0 next 1", ch0.next === 1);
  const ch1 = await getEpubChapter(entry, 1, bookId);
  check("chapter 1 prev 0", ch1.prev === 0);
  check("chapter 1 next null", ch1.next === null);
  // out of range
  const chBad = await getEpubChapter(entry, 99, bookId);
  check("out-of-range returns null", chBad === null);

  // --- readEpubAsset (whitelist + path traversal defense) ---
  const cssHref = Object.keys(entry.resources.css).find(h => h.includes("main.css"));
  // resources map: key is the OPF-relative href (what buildLibrary registered), value is zip path.
  // readEpubAsset takes the OPF-relative href (the whitelist key).
  const css = await readEpubAsset(entry, cssHref);
  check("CSS asset read returns data", css && typeof css.data === "string" && css.data.includes("font-family"));
  check("CSS asset mime text/css", css && css.mime === "text/css");
  const imgHref = Object.keys(entry.resources.images).find(h => h.includes("red.png"));
  const img = await readEpubAsset(entry, imgHref);
  check("image asset read returns buffer", img && img.data && img.data.byteLength > 0);
  check("image asset mime image/png", img && img.mime === "image/png");
  // path traversal rejected
  const evil = await readEpubAsset(entry, "../../etc/passwd");
  check("path traversal href returns null", evil === null);
  const evilEnc = await readEpubAsset(entry, "images%2F..%2F..%2Fetc%2Fpasswd");
  check("encoded path traversal returns null", evilEnc === null);
  // non-whitelisted legit-looking path rejected
  const unknown = await readEpubAsset(entry, "styles/other.css");
  check("unknown href rejected", unknown === null);

  if (fail > 0) { console.error("\n" + fail + " FAILED"); process.exit(1); }
  console.log("\n" + pass + " passed, " + fail + " failed");
})().catch(e => { console.error("CRASH:", e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/epubloadtest.cjs`
Expected: FAIL — `Cannot find module '../lib/epub-load.cjs'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/epub-load.cjs`:

```js
// epub loading glue: uses @likecoin/epub-ts to parse, lib/epub.cjs pure fns to shape.
// Real API verified by spike (spec §3.1):
//   - read XHTML/CSS via book.archive.zip (jszip), NOT archive.request (corrupts binary)
//   - book.resolve(href) returns "/OEBPS/..." — strip leading "/" for jszip
const fs = require("fs");
const { Book } = require("@likecoin/epub-ts/node");
const {
  buildSpineIndex, buildTocFromNav, sanitizeChapterXhtml, isAllowedAssetHref,
} = require("./epub.cjs");

// mime by extension (must stay in sync with control-server guessMime — spec §4.3, lesson 27)
function mimeFor(href) {
  const h = (href || "").toLowerCase();
  if (h.endsWith(".css")) return "text/css";
  if (h.endsWith(".png")) return "image/png";
  if (h.endsWith(".jpg") || h.endsWith(".jpeg")) return "image/jpeg";
  if (h.endsWith(".gif")) return "image/gif";
  if (h.endsWith(".svg")) return "image/svg+xml";
  if (h.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

// Resolve an OPF-relative href to a jszip path (strip leading slash from book.resolve output).
function zipPathFor(book, href) {
  let resolved;
  try { resolved = book.resolve(href); } catch (e) { resolved = href; }
  return String(resolved || href).replace(/^\//, "");
}

async function loadEpub(filePath) {
  const buf = fs.readFileSync(filePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const book = new Book(arrayBuffer);
  await book.opened;

  // spine items in reading order
  const spineItems = [];
  book.spine.each((section) => spineItems.push({ href: section.href }));
  const spine = buildSpineIndex(spineItems);

  // nav toc (NCX + nav auto-detected by the lib)
  const navToc = (book.navigation && book.navigation.toc) || [];
  const toc = buildTocFromNav(navToc, spine);

  // fill spine titles from toc (reverse lookup by spineIndex)
  for (const ch of toc.chapters) {
    if (spine[ch.spineIndex]) spine[ch.spineIndex].title = ch.title;
  }
  // any spine item still without a title: leave null (chapter endpoint will fallback)

  // resources: enumerate manifest, split css vs images, keyed by OPF-relative href
  const resources = { css: {}, images: {} };
  const manifestObj = (book.packaging && book.packaging.manifest) || {};
  const manifestItems = Array.isArray(manifestObj) ? manifestObj
    : (manifestObj.manifest && Array.isArray(manifestObj.manifest) ? manifestObj.manifest
    : Object.values(manifestObj));
  for (const item of manifestItems) {
    if (!item || !item.href) continue;
    const mt = (item["media-type"] || item.mediaType || "").toLowerCase();
    const h = item.href;
    if (mt === "text/css" || h.toLowerCase().endsWith(".css")) {
      resources.css[h] = zipPathFor(book, h);
    } else if (mt.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp)$/i.test(h)) {
      resources.images[h] = zipPathFor(book, h);
    }
  }

  return {
    format: "epub",
    toc,
    spine,
    resources,
    _book: book,             // retained for lazy chapter/asset reads
    _zip: book.archive.zip,  // jszip handle
  };
}

// Lazy-load + sanitize chapter n. Returns chapter response (format:epub) or null.
async function getEpubChapter(entry, n, bookId) {
  const chs = entry.toc.chapters;
  if (n < 0 || n >= chs.length) return null;
  const c = chs[n];
  const spineItem = entry.spine[c.spineIndex];
  if (!spineItem) return null;
  const zp = zipPathFor(entry._book, spineItem.href);
  const raw = await entry._zip.file(zp).async("string");
  const html = sanitizeChapterXhtml(raw, bookId);
  // cssHrefs: all registered css assets (books typically share one css)
  const cssHrefs = Object.keys(entry.resources.css).map(
    h => "/api/book/" + bookId + "/asset?href=" + encodeURIComponent(h)
  );
  return {
    format: "epub",
    index: n,
    title: c.title || spineItem.title || ("第" + (n + 1) + "节"),
    html,
    cssHrefs,
    prev: n > 0 ? n - 1 : null,
    next: n + 1 < chs.length ? n + 1 : null,
  };
}

// Read an asset by OPF-relative href, gated by the whitelist built at load time.
// Returns {data, mime} or null (href not whitelisted -> path traversal blocked).
async function readEpubAsset(entry, href) {
  const allowed = new Set([...Object.keys(entry.resources.css), ...Object.keys(entry.resources.images)]);
  if (!isAllowedAssetHref(href, allowed)) return null;
  const zp = entry.resources.css[href] || entry.resources.images[href];
  if (!zp) return null;
  const isText = mimeFor(href) === "text/css";
  const data = isText
    ? await entry._zip.file(zp).async("string")
    : await entry._zip.file(zp).async("arraybuffer");
  return { data, mime: mimeFor(href) };
}

module.exports = { loadEpub, getEpubChapter, readEpubAsset, mimeFor };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/epubloadtest.cjs`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add lib/epub-load.cjs test/epubloadtest.cjs
git commit -m "feat(reader-epub): add epub-load glue (loadEpub/getEpubChapter/readEpubAsset)"
```

---

## Task 7: control-server 集成 —— buildLibrary 加 epub 分派 + guessMime 扩展

**Files:**
- Modify: `lib/control-server.cjs:28-49`（`buildLibrary`）+ `:63-68`（`guessMime`）
- Modify: `test/epubservertest.cjs`（新建）

**Interfaces:**
- Consumes: `lib/epub-load.cjs`（`loadEpub`/`getEpubChapter`/`readEpubAsset`）。
- Produces: `buildLibrary` 现在扫 `.txt` 和 `.epub`，txt 条目加 `format:"txt"`，epub 条目用 `loadEpub` 输出。
- Produces: `guessMime` 新增 `.css/.png/.jpg/.jpeg/.gif/.svg/.webp`。

- [ ] **Step 1: Write the failing test**

Create `test/epubservertest.cjs`:

```js
// Test for control-server epub integration: buildLibrary dual-format, guessMime.
// Run: node test/epubservertest.cjs
const fs = require("fs");
const path = require("path");
const os = require("os");

const { buildLibrary, bookIdFor, guessMime } = require("../lib/control-server.cjs");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

(async () => {
  // --- buildLibrary scans both .txt and .epub ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "epub-lib-"));
  // a tiny txt
  fs.writeFileSync(path.join(tmp, "sample.txt"), "第一章 测试\n\u3000\u3000正文。\n");
  // copy fixture epub
  const fixture = path.join(__dirname, "fixtures", "normal.epub");
  if (!fs.existsSync(fixture)) {
    console.error("MISSING fixture. Run: node test/fixtures/make-epub.cjs"); process.exit(1);
  }
  fs.copyFileSync(fixture, path.join(tmp, "normal.epub"));

  const lib = buildLibrary(tmp);
  check("library has 2 entries", lib.size === 2);
  // both formats present
  const txtEntry = Array.from(lib.values()).find(b => b.filename === "sample.txt");
  const epubEntry = Array.from(lib.values()).find(b => b.filename === "normal.epub");
  check("txt entry exists", !!txtEntry);
  check("epub entry exists", !!epubEntry);
  check("txt entry format", txtEntry.format === "txt");
  check("epub entry format", epubEntry.format === "epub");
  // txt entry keeps legacy fields (encoding, text)
  check("txt entry keeps encoding field", typeof txtEntry.encoding === "string");
  check("txt entry keeps text field", typeof txtEntry.text === "string");
  // epub entry has spine/resources, no text
  check("epub entry has spine", Array.isArray(epubEntry.spine));
  check("epub entry has resources", epubEntry.resources && epubEntry.resources.css);
  check("epub entry has no text field", epubEntry.text === undefined);
  // epub toc shape aligned with txt (chapters + volumes)
  check("epub toc.chapters is array", Array.isArray(epubEntry.toc.chapters));
  check("epub toc.volumes is array", Array.isArray(epubEntry.toc.volumes));
  // bookId space shared
  check("epub bookId deterministic", bookIdFor("normal.epub") === epubEntry.id);

  // --- guessMime extensions (lesson 27 regression) ---
  check("guessMime .css", guessMime("a.css") === "text/css");
  check("guessMime .png", guessMime("a.png") === "image/png");
  check("guessMime .jpg", guessMime("a.jpg") === "image/jpeg");
  check("guessMime .jpeg", guessMime("a.jpeg") === "image/jpeg");
  check("guessMime .gif", guessMime("a.gif") === "image/gif");
  check("guessMime .svg", guessMime("a.svg") === "image/svg+xml");
  check("guessMime .webp", guessMime("a.webp") === "image/webp");
  // legacy mime still works
  check("guessMime .html still works", guessMime("a.html").includes("text/html"));
  check("guessMime .js still works", guessMime("a.js").includes("javascript"));
  check("guessMime unknown -> octet-stream", guessMime("a.xyz") === "application/octet-stream");

  fs.rmSync(tmp, { recursive: true, force: true });
  if (fail > 0) { console.error("\n" + fail + " FAILED"); process.exit(1); }
  console.log("\n" + pass + " passed, " + fail + " failed");
})().catch(e => { console.error("CRASH:", e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/epubservertest.cjs`
Expected: FAIL — txt entry's `format` is undefined; `guessMime(".css")` returns octet-stream; epub entry not loaded.

- [ ] **Step 3: Modify buildLibrary to scan both formats**

In `lib/control-server.cjs`, replace the body of `buildLibrary` (lines 28-49). First read current state:

```bash
# verify current line numbers
grep -n "function buildLibrary\|function guessMime" lib/control-server.cjs
```

Replace `buildLibrary` with:

```js
function buildLibrary(novelsDir) {
  const lib = new Map();
  if (!fs.existsSync(novelsDir)) { try { fs.mkdirSync(novelsDir, { recursive: true }); } catch (e) {} }
  let entries = [];
  try { entries = fs.readdirSync(novelsDir); } catch (e) {}
  for (const name of entries) {
    const full = path.join(novelsDir, name);
    if (/\.txt$/i.test(name)) {
      let bytes;
      try { bytes = fs.readFileSync(full); } catch (e) { continue; }
      const enc = detectEncoding(bytes);
      let text;
      try { text = new TextDecoder(enc === "utf8" && bytes[0] === 0xEF ? "utf8" : enc).decode(bytes); }
      catch (e) { text = new TextDecoder("gb18030").decode(bytes); }
      if (enc === "utf8" && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const toc = parseTOC(text, name);
      const suspect = replacementRatio(text) > 0.01;
      const id = bookIdFor(name);
      lib.set(id, { id, filename: name, format: "txt", sizeBytes: bytes.length, encoding: enc, encodingSuspect: suspect, toc, text });
    }
    // .epub handled below (async — needs await book.opened)
  }
  // epub loading is async; do it after the sync txt loop
  for (const name of entries) {
    if (!/\.epub$/i.test(name)) continue;
    const full = path.join(novelsDir, name);
    try {
      const entry = await epubLoad.loadEpub(full);
      const id = bookIdFor(name);
      lib.set(id, Object.assign({ id, filename: name, sizeBytes: fs.statSync(full).size }, entry));
    } catch (e) {
      // broken/DRM epub: skip (symmetric to txt readFileSync failure handling)
      console.error("[reader] skipping epub " + name + ": " + e.message);
    }
  }
  return lib;
}
```

**Async cascade — precise instructions (verified against current code)**:

`buildLibrary` becomes `async function buildLibrary(novelsDir)` because `loadEpub` awaits `book.opened`.
The sole caller is `lib/control-server.cjs:102`: `const library = buildLibrary(novelsDir);`
inside `createServer`, which is structured as `return new Promise((resolve, reject) => { ... })`.
**A Promise executor is a plain function — you cannot `await` directly in it.** Restructure as:

```js
function createServer(opts) {
  return new Promise((resolve, reject) => {
    (async () => {
      // ... existing setup ...
      const library = await buildLibrary(novelsDir);
      // ... rest of server setup, http.createServer, listen ...
      // resolve({ port, host, ... }) at the end
    })().catch(reject);
  });
}
```

i.e. wrap the executor body in an async IIFE so `await buildLibrary(...)` works. Keep the outer `return new Promise` signature (callers expect it). Verify with `grep -n "buildLibrary(" lib/control-server.cjs` — only the line 102 call needs `await`. `lib/reader-server.cjs:29` only re-exports `buildLibrary`, doesn't call it (it delegates to `control.createServer`), so no change there.

`test/epubservertest.cjs` already calls `buildLibrary` via `await` (Task 7 Step 1 test is `async`). `test/readerservertest.cjs` / `controlservertest.cjs` call `createServer` which is already Promise-returning — no change needed there (the async-ness is internal to createServer).
```

`await` each call site (it's called in `createServer` which is already async).

- [ ] **Step 4: Add require + guessMime extension**

At top of `lib/control-server.cjs`, near other requires:
```js
const epubLoad = require("./epub-load.cjs");
```

Replace `guessMime` (lines 63-68) with:
```js
function guessMime(rel) {
  if (/\.html?$/i.test(rel)) return "text/html; charset=utf-8";
  if (/\.js$/i.test(rel)) return "text/javascript; charset=utf-8";
  if (/\.css$/i.test(rel)) return "text/css; charset=utf-8";
  if (/\.png$/i.test(rel)) return "image/png";
  if (/\.jpe?g$/i.test(rel)) return "image/jpeg";
  if (/\.gif$/i.test(rel)) return "image/gif";
  if (/\.svg$/i.test(rel)) return "image/svg+xml";
  if (/\.webp$/i.test(rel)) return "image/webp";
  return "application/octet-stream";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node test/epubservertest.cjs`
Expected: all PASS

- [ ] **Step 6: Run full suite for regression**

Run: `npm test`
Expected: all existing tests pass. If `readerservertest` or `controlservertest` breaks, the buildLibrary-async change cascaded — `await` the buildLibrary call in those tests' setup too.

- [ ] **Step 7: Commit**

```bash
git add lib/control-server.cjs test/epubservertest.cjs
git commit -m "feat(reader-epub): buildLibrary scans .epub + txt; guessMime extended (lesson 27)"
```

---

## Task 8: control-server 章节端点 + asset 端点（按 format 分派）

**Files:**
- Modify: `lib/control-server.cjs:200-214`（`/api/book/:id/chapter/:n` 分派）+ 新增 `/api/book/:id/asset` 端点
- Modify: `test/epubservertest.cjs`（加端点测试）

**Interfaces:**
- Produces: `/api/book/:id/chapter/:n` 对 txt 返回 `{format:"txt", index, title, paragraphs, prev, next}`（加 format 字段）；对 epub 返回 `{format:"epub", index, title, html, cssHrefs, prev, next}`。
- Produces: `GET /api/book/:id/asset?href=<encoded>` —— 用 `readEpubAsset` 读字节，按 mime 返。白名单外的 href → 404。非 epub 书 → 404。

- [ ] **Step 1: Write the failing test**

Append to `test/epubservertest.cjs` (before the final `if (fail > 0)`):

```js
// --- chapter + asset endpoints via real HTTP (lesson 12/13: cross-process glue) ---
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "epub-srv-"));
  fs.writeFileSync(path.join(tmp, "sample.txt"), "第一章 测试\n\u3000\u3000正文段。\n");
  const fixture = path.join(__dirname, "fixtures", "normal.epub");
  fs.copyFileSync(fixture, path.join(tmp, "normal.epub"));

  const { createServer } = require("../lib/control-server.cjs");
  const { port } = await createServer({ root: tmp, port: 0, host: "127.0.0.1" });
  const base = "http://127.0.0.1:" + port;
  const epubId = bookIdFor("normal.epub");
  const txtId = bookIdFor("sample.txt");

  // txt chapter: has format field, keeps paragraphs
  const txtCh = await fetch(base + "/api/book/" + txtId + "/chapter/0").then(r => r.json());
  check("txt chapter format field", txtCh.format === "txt");
  check("txt chapter paragraphs kept", Array.isArray(txtCh.paragraphs));

  // epub chapter: html + cssHrefs, no paragraphs
  const epubCh = await fetch(base + "/api/book/" + epubId + "/chapter/0").then(r => r.json());
  check("epub chapter format field", epubCh.format === "epub");
  check("epub chapter has html", typeof epubCh.html === "string" && epubCh.html.length > 0);
  check("epub chapter has cssHrefs", Array.isArray(epubCh.cssHrefs) && epubCh.cssHrefs.length > 0);
  check("epub chapter no paragraphs", epubCh.paragraphs === undefined);
  check("epub chapter prev/next", epubCh.prev === null && epubCh.next === 1);
  // XSS stripped at the endpoint (not just in pure fn)
  check("epub chapter html XSS-stripped", !epubCh.html.includes("<script") && !epubCh.html.includes("onerror"));

  // asset endpoint: whitelisted CSS returns text/css + body
  // fetch CSS asset directly (href known from fixture: styles/main.css — that's the
  // OPF-relative href buildLibrary registered into resources.css whitelist)
  const cssRes = await fetch(base + "/api/book/" + epubId + "/asset?href=" + encodeURIComponent("styles/main.css"));
  check("asset CSS status 200", cssRes.status === 200);
  check("asset CSS content-type", cssRes.headers.get("content-type").includes("text/css"));
  const cssBody = await cssRes.text();
  check("asset CSS body has font-family", cssBody.includes("font-family"));

  // asset endpoint: image returns image/png
  const imgRes = await fetch(base + "/api/book/" + epubId + "/asset?href=" + encodeURIComponent("images/red.png"));
  check("asset image status 200", imgRes.status === 200);
  check("asset image content-type", imgRes.headers.get("content-type").includes("image/png"));
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  check("asset image bytes > 0", imgBuf.length > 0);

  // asset endpoint: path traversal -> 404
  const evilRes = await fetch(base + "/api/book/" + epubId + "/asset?href=" + encodeURIComponent("../../etc/passwd"));
  check("asset path traversal 404", evilRes.status === 404);
  const evilEnc = await fetch(base + "/api/book/" + epubId + "/asset?href=" + encodeURIComponent("images%2F..%2F..%2Fpasswd"));
  check("asset encoded traversal 404", evilEnc.status === 404);

  // asset endpoint: non-epub book -> 404
  const noAsset = await fetch(base + "/api/book/" + txtId + "/asset?href=x");
  check("asset on txt book 404", noAsset.status === 404);

  fs.rmSync(tmp, { recursive: true, force: true });
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/epubservertest.cjs`
Expected: FAIL — epub chapter returns `paragraphs` (no format dispatch); asset endpoint 404s or doesn't exist.

- [ ] **Step 3: Modify chapter endpoint + add asset endpoint**

**Prerequisite — make the request handler async.** Currently `handle(req, res)` at `lib/control-server.cjs:163` is sync (`function handle(req, res) {`). The epub chapter/asset endpoints use `await` (epub reads are async). Change the signature to `async function handle(req, res) {` — everything else inside stays the same; http.createServer accepts a handler that returns a Promise (it just ignores the return value). Verify with `grep -n "function handle" lib/control-server.cjs` after.

In `lib/control-server.cjs`, find the chapter handler (around line 200):
```bash
grep -n "api/book/.\*/chapter" lib/control-server.cjs
```

Replace the chapter handler block with format-dispatched version:

```js
      m = /^\/api\/book\/([^/]+)\/chapter\/(\d+)$/.exec(p);
      if (m) {
        const b = library.get(m[1]);
        if (!b) return sendJson(res, 404, { error: "book not found" });
        const n = parseInt(m[2], 10);
        if (b.format === "epub") {
          try {
            const ch = await epubLoad.getEpubChapter(b, n, b.id);
            if (!ch) return sendJson(res, 404, { error: "chapter out of range" });
            return sendJson(res, 200, ch);
          } catch (e) {
            return sendJson(res, 500, { error: "epub chapter read failed: " + e.message });
          }
        }
        // txt path (existing logic, +format field)
        const chs = b.toc.chapters;
        if (n < 0 || n >= chs.length) return sendJson(res, 404, { error: "chapter out of range" });
        const c = chs[n];
        const chunk = b.text.slice(c.startOffset, c.endOffset);
        const raw = chunk.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
        const paras = cleanChapterParagraphs(raw, c.title);
        return sendJson(res, 200, { format: "txt", index: n, title: c.title, paragraphs: paras, prev: n > 0 ? n - 1 : null, next: n + 1 < chs.length ? n + 1 : null });
      }
```

**Note**: the `await` calls here rely on the Step 3 prerequisite (`handle` now `async`).

Add the asset endpoint after the chapter handler:

```js
      m = /^\/api\/book\/([^/]+)\/asset$/.exec(p);
      if (m && method === "GET") {
        const b = library.get(m[1]);
        if (!b || b.format !== "epub") { res.writeHead(404); res.end("not found"); return; }
        // href is URL-encoded; decode once for whitelist lookup
        const href = decodeURIComponent(u.searchParams.get("href") || "");
        try {
          const asset = await epubLoad.readEpubAsset(b, href);
          if (!asset) { res.writeHead(404); res.end("not found"); return; }
          if (typeof asset.data === "string") {
            res.writeHead(200, { "Content-Type": asset.mime });
            res.end(asset.data);
          } else {
            const buf = Buffer.from(asset.data);
            res.writeHead(200, { "Content-Type": asset.mime, "Content-Length": buf.length });
            res.end(buf);
          }
        } catch (e) { res.writeHead(500); res.end("asset read failed"); return; }
        return;
      }
```

**Variable name**: the existing request handler uses `u` for the parsed URL (`const u = new URL(req.url, "http://localhost"); const p = u.pathname;` at line 164-165). The asset endpoint above uses `u.searchParams` — matches existing convention. No new variable needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/epubservertest.cjs`
Expected: all PASS

- [ ] **Step 5: Run full suite for regression**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/control-server.cjs test/epubservertest.cjs
git commit -m "feat(reader-epub): chapter endpoint format-dispatch + asset endpoint (path-traversal guarded)"
```

---

## Task 9: 前端 —— book.js 按 format 分派 + reader.js epub 渲染容器

**Files:**
- Modify: `reader/lib/book.js`（`openHttp` 章节消费按 format 透传）
- Modify: `reader/reader.js`（新增 `renderEpubChapter`；`showChapter` 按 `ch.format` 分派）
- Modify: `reader/reader.css`（`#epub-content` 样式）
- Modify: `reader/index.html`（加 `#epub-content` 节点）

**Interfaces:**
- Consumes: server 的章节响应（`format` 字段）。
- Produces: 前端能渲染 txt（段落列表，老路径）和 epub（HTML 片段 + scoped CSS）两种章节。

- [ ] **Step 1: Modify index.html — add epub content container**

In `reader/index.html`, find the chapter content area (the `#chapter-content` article). Add a sibling `#epub-content` div right after it, initially hidden:

```html
<article id="chapter-content"></article>
<div id="epub-content" hidden></div>
```

(Find the exact location with `grep -n "chapter-content" reader/index.html`.)

- [ ] **Step 2: Modify reader.css — epub container styling**

Append to `reader/reader.css`:

```css
/* epub chapter container (scoped CSS injected here) */
#epub-content {
  max-width: 42em;
  margin: 0 auto;
  padding: 1em 1.5em 4em;
  line-height: 1.8;
}
#epub-content[hidden] { display: none; }
/* When showing epub, hide the txt article to avoid stale content */
body.epub-mode #chapter-content { display: none; }
body:not(.epub-mode) #epub-content { display: none; }
/* epub content scoped styles live inside a <style id="epub-scoped-css"> element;
   scopeCss prefixes them with #epub-content so they don't leak. */
```

- [ ] **Step 3: Modify reader.js — add renderEpubChapter + dispatch in showChapter**

Find `showChapter` (around `reader/reader.js:133`). Currently it does:
```js
var art = $("chapter-content");
art.innerHTML = "";
var h = document.createElement("h2"); h.textContent = ch.title; art.appendChild(h);
ch.paragraphs.forEach(function (p) { var el = document.createElement("p"); el.textContent = p; art.appendChild(el); });
```

Replace with format-dispatched rendering:

```js
function showChapterNode(ch) {
  // Returns the DOM container that should be visible for this chapter.
  if (ch.format === "epub") {
    document.body.classList.add("epub-mode");
    var ec = $("epub-content");
    ec.innerHTML = "";
    // title
    var h = document.createElement("h2"); h.textContent = ch.title; ec.appendChild(h);
    // scoped CSS: inject all cssHrefs into a single <style> with #epub-content scope.
    // (CSS is fetched + scopeCss'd server-side in a later task; for now, link them directly
    //  — they are already absolute /api/book/.../asset URLs.)
    var styleWrap = document.createElement("div");
    ch.cssHrefs.forEach(function (href) {
      var link = document.createElement("link");
      link.rel = "stylesheet"; link.type = "text/css"; link.href = href;
      styleWrap.appendChild(link);
    });
    // epub HTML body fragment (already sanitized + src-rewritten server-side)
    var body = document.createElement("div");
    body.innerHTML = ch.html;
    ec.appendChild(styleWrap);
    ec.appendChild(body);
    return ec;
  } else {
    document.body.classList.remove("epub-mode");
    var art = $("chapter-content");
    art.innerHTML = "";
    var h2 = document.createElement("h2"); h2.textContent = ch.title; art.appendChild(h2);
    (ch.paragraphs || []).forEach(function (p) {
      var el = document.createElement("p"); el.textContent = p; art.appendChild(el);
    });
    return art;
  }
}
```

Then in `showChapter`, replace the existing render block with:
```js
var node = showChapterNode(ch);
```
(Keep the surrounding toc-highlight / scroll / progress logic untouched — it works on whichever container.)

- [ ] **Step 4: book.js — ensure format field passes through**

In `reader/lib/book.js`, `openHttp`'s `getChapter` already returns the server response object verbatim (`return r.json()`). Confirm the format field flows through. Check:
```bash
grep -n "getChapter\|chapter/" reader/lib/book.js
```
The `getChapter` returns `r.json()` — the `format`/`html`/`cssHrefs` fields pass through untouched. No change needed unless the code transforms the response. If it maps fields, ensure `format`/`html`/`cssHrefs` are preserved.

- [ ] **Step 5: Update drag-drop error message**

In `reader/reader.js:195`, change:
```js
if (!/\.txt$/i.test(f.name)) { showErr("仅支持 .txt"); return; }
```
to:
```js
if (!/\.txt$/i.test(f.name)) { showErr("拖拽仅支持 .txt。epub 请放入 novels/ 由服务加载。"); return; }
```

- [ ] **Step 6: Manual verification (no automated test — DOM rendering, lesson 12)**

Start server with a fixture epub in `novels/`:
```bash
cp test/fixtures/normal.epub novels/  # if novels/ exists; else create
node lib/control-server.cjs
```
Open `http://127.0.0.1:17890/reader/` in a browser. Verify:
- Shelf shows both the txt book and the epub.
- Click the epub → TOC shows 第一章/第二章.
- Click 第一章 → h1 + paragraphs render; CSS font-family applies (serif); red image shows.
- `<script>`/`onerror`/`javascript:` probes do NOT execute (open devtools console — no alerts).
- Click 第二章 → renders; click back to 第一章; click a txt book → renders in txt mode (epub-mode class removed).

This is a真机 check — DOM/CSS rendering is single-test blind spot (lesson 12/27).

- [ ] **Step 7: Run full suite for regression**

Run: `npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add reader/index.html reader/reader.css reader/reader.js reader/lib/book.js
git commit -m "feat(reader-epub): frontend format dispatch + #epub-content container + scoped CSS"
```

---

## Task 10: CSS scope 注入 + 真机验证清单 + 注册测试到 npm test + AGENTS.md

**Files:**
- Modify: `reader/reader.js`（CSS scope：先 fetch CSS、`scopeCss`、注入 `<style>`）
- Modify: `package.json`（`scripts.test` 加 4 个新测试）
- Modify: `AGENTS.md`（epub 小节 + 教训补丁 29）

**Note on CSS scope**: Task 9 link-tagged the CSS directly. But unsoped CSS leaks (e.g. `body{...}` hits reader UI). Real isolation requires: fetch CSS text from asset endpoint → run through `scopeCss` client-side → inject as `<style>`. The `scopeCss` pure fn is in `lib/epub.cjs` (Node) — but the browser needs it too. Mirror it to `reader/lib/scope-css.js` with dual export (lesson: front-end lib dual export).

- [ ] **Step 1: Create reader/lib/scope-css.js (dual export, mirrors lib/epub.cjs scopeCss)**

Create `reader/lib/scope-css.js`:
```js
// Browser-side CSS scoper — mirrors lib/epub.cjs scopeCss (lesson 17: shared logic,
// two runtimes). Dual export: CommonJS for Node test, window.__readerScopeCss for browser.
function scopeCss(cssText, scopeId) {
  if (!cssText || !cssText.trim()) return "";
  return scopeChunk(cssText, "#" + scopeId);
}
function scopeChunk(text, prefix) {
  // (same implementation as lib/epub.cjs — copy verbatim)
  let out = "", i = 0;
  while (i < text.length) {
    const ws = text.slice(i).match(/^\s+/);
    if (ws) { out += ws[0]; i += ws[0].length; }
    if (i >= text.length) break;
    if (text[i] === "/" && text[i+1] === "*") {
      const e = text.indexOf("*/", i+2); const s = e === -1 ? text.length : e+2;
      out += text.slice(i, s); i = s; continue;
    }
    const atBlock = text.slice(i).match(/^@(?:media|supports|document)\s+([^{]*)\{/);
    if (atBlock) {
      out += atBlock[0]; i += atBlock[0].length;
      const c = text.indexOf("}", i); const ie = c === -1 ? text.length : c;
      out += scopeChunk(text.slice(i, ie), prefix);
      if (c !== -1) { out += "}"; i = ie+1; } else { i = text.length; }
      continue;
    }
    const ff = text.slice(i).match(/^@font-face\s*\{/);
    if (ff) {
      const c = text.indexOf("}", i); const s = c === -1 ? text.length : c+1;
      out += text.slice(i, s); i = s; continue;
    }
    const atLine = text.slice(i).match(/^@[a-zA-Z-]+\s+[^;{}]*;/);
    if (atLine) { out += atLine[0]; i += atLine[0].length; continue; }
    const brace = text.indexOf("{", i);
    if (brace === -1) { out += text.slice(i); break; }
    const sel = text.slice(i, brace);
    const c = text.indexOf("}", brace); const de = c === -1 ? text.length : c;
    const db = text.slice(brace, de + (c === -1 ? 0 : 1));
    out += sel.split(",").map(s => prefix + " " + s.trim()).join(", ") + " " + db;
    i = de + (c === -1 ? 0 : 1);
  }
  return out;
}
if (typeof module !== "undefined" && module.exports) module.exports = { scopeCss };
if (typeof window !== "undefined") window.__readerScopeCss = { scopeCss };
```

- [ ] **Step 2: Create test/scope-csstest.cjs (mirror consistency, lesson 17)**

Create `test/scope-csstest.cjs`:
```js
// Mirror consistency: reader/lib/scope-css.js must behave identically to lib/epub.cjs scopeCss.
// Same inputs, same outputs (lesson 17).
const srv = require("../lib/epub.cjs");
const web = require("../reader/lib/scope-css.js");
let pass = 0, fail = 0;
function check(n, c) { console.log((c?"PASS ✓ ":"FAIL ✗ ")+n); c?pass++:fail++; }
const cases = [
  "p { color: red; }",
  "body { font-family: serif; }",
  ".x { text-indent: 2em; }",
  "ul li { margin: 0; }",
  "h1, h2 { color: black; }",
  "@media (max-width: 600px) { p { font-size: 14px; } }",
  "#cover { display: none; }",
  "",
  "/* comment */ p { color: blue; }",
];
for (const c of cases) {
  check("mirror: " + JSON.stringify(c).slice(0,30), srv.scopeCss(c, "epub-content") === web.scopeCss(c, "epub-content"));
}
if (fail>0) { console.error("\n"+fail+" FAILED"); process.exit(1); }
console.log("\n"+pass+" passed, "+fail+" failed");
```

- [ ] **Step 3: Modify reader.js to fetch + scope CSS instead of link-tagging**

In `reader/reader.js` `showChapterNode` (epub branch), replace the link-tag block with fetch+scope:
```js
    // fetch each CSS, scope it, inject as one <style>
    var styleEl = document.createElement("style");
    ec.appendChild(styleEl); // placeholder; filled after fetches
    Promise.all((ch.cssHrefs || []).map(function (href) {
      return fetch(href).then(r => r.text()).then(t => window.__readerScopeCss.scopeCss(t, "epub-content"));
    })).then(function (scoped) {
      styleEl.textContent = scoped.join("\n");
    }).catch(function () { /* CSS optional; chapter still readable */ });
```

- [ ] **Step 4: Add 4 new tests to package.json scripts.test**

In `package.json`, edit the `test` script string to append before the closing quote:
```
&& node test/epubtest.cjs && node test/epubloadtest.cjs && node test/epubservertest.cjs && node test/scope-csstest.cjs
```
(insert after `webviewblankfixtest.cjs`)

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all tests pass including 4 new ones. If epubloadtest/epubservertest fail because fixtures missing, run `node test/fixtures/make-epub.cjs` first.

- [ ] **Step 6: AGENTS.md — add epub section + lesson 29**

Append to `AGENTS.md` (after the webview-blankfix section), a new top-level section "## 小说阅读器 epub 支持" summarizing: epub 仅 server 模式；lib/epub.cjs 纯函数 + lib/epub-load.cjs 胶水；XSS sanitize + asset 端点路径穿越防护（白名单）；scopeCss 隔离（双实现 mirror）；真实 API 命门（jszip 直读、resolve 去 `/`）；已知遗留。 Plus lesson patch 29 (already in spec §10 — copy the wording).

- [ ] **Step 7: Final真机 verification (spec §6.3 checklist)**

Run through the spec §6.3 checklist end-to-end in a real ZCode webview (not just plain browser):
1. epub in novels/ → shelf shows it.
2. Open epub → TOC → chapter renders + image + CSS.
3. Malicious epub (fixture has probes) → no alerts execute.
4. epub CSS doesn't restyle reader's top bar / sidebar.
5. Progress (scroll + chapter change) saves + restores.
6. txt book still works after viewing epub (epub-mode class removed).

Document any failures as known caveats before declaring done.

- [ ] **Step 8: Commit**

```bash
git add reader/lib/scope-css.js test/scope-csstest.cjs reader/reader.js package.json AGENTS.md
git commit -m "feat(reader-epub): scoped CSS injection (mirror impl) + register tests + AGENTS.md lesson 29"
```

---

## 依赖安装（已在 spike 阶段完成）

`@likecoin/epub-ts`, `sanitize-html`, `jszip`, `linkedom` 已在 `package.json`（spike 验证时装入，commit `f0e5f00`）。**Task 实施时不要再 `npm install` 这些**——直接用。如果 `package.json` 里没有，回退到 spike commit 取依赖列表。

---

## Self-Review (完成所有任务后做)

1. **Spec coverage**: 逐条对 spec 检查 —— §3.1 库（Task 1-6 用真实 API）✓；§3.3 library 结构（Task 6/7）✓；§4.2 sanitize（Task 4）✓；§4.3 asset 端点 + 路径穿越（Task 2/8）✓；§4.4 src 改写（Task 4）✓；§5 前端分派（Task 9/10）✓；§6 测试（Task 1-8 + scope-csstest）✓；§7 改动清单全覆盖 ✓；§10 真机验（Task 9 step 6 + Task 10 step 7）✓。
2. **Placeholder scan**: 每步都有完整代码 ✓。
3. **Type consistency**: `scopeCss(cssText, scopeId)`、`isAllowedAssetHref(href, set)`、`buildSpineIndex(items)`、`buildTocFromNav(nav, spine)`、`sanitizeChapterXhtml(raw, bookId)`、`loadEpub(path)`、`getEpubChapter(entry, n, bookId)`、`readEpubAsset(entry, href)` —— 跨任务签名一致 ✓。
