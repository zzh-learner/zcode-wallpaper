# ZCode 内置小说阅读器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ZCode 内置浏览器 webview 面板里阅读本地 .txt 小说，带两级目录、滚动阅读、书架多本、进度记忆。

**Architecture:** 独立常驻 Node http server（`lib/reader-server.cjs`）扫 `novels/*.txt` 做章节切分供 API；前端 SPA（`reader/`）双模式运行——`http:` 协议走 server fetch，`file:` 协议走拖拽兜底；`bin/reader-server.bat` 启动服务并把 URL 写剪贴板。完全不碰 CDP/inject.cjs。

**Tech Stack:** Node 内置 `http`/`fs`/`TextDecoder`（零新依赖）、原生浏览器 API（fetch/FileReader/localStorage）、项目现有 `check()` 风格单测、ASCII + CRLF 的 `.bat`。

**Spec:** `docs/superpowers/specs/2026-06-19-novel-reader-design.md`（已与用户逐节确认）

---

## 文件结构

**新增（lib/ — server 端纯逻辑）：**
- `lib/reader-codec.cjs` — `detectEncoding(bytes)` 编码检测（BOM → fatal UTF-8 → GB18030 + 合理性校验）
- `lib/reader-toc.cjs` — `parseTOC(text)` 卷/章切分 + `splitParagraphs(chunk)` 分段

**新增（lib/ — server 主程序）：**
- `lib/reader-server.cjs` — http server：扫 novels/、建 BookRecord、路由 `/api/*` + `/reader` 静态、端口冲突自动 +1、监听成功后写剪贴板

**新增（reader/ — 前端 SPA）：**
- `reader/index.html` — 入口骨架
- `reader/reader.css` — 三栏布局 + 主题 + 阅读排版
- `reader/reader.js` — 主控胶水（唯一碰 DOM）
- `reader/lib/codec.js` — 前端编码（拖拽模式，server codec 的浏览器镜像）
- `reader/lib/toc.js` — 前端正则切章（拖拽模式，server toc 的浏览器镜像）
- `reader/lib/progress.js` — localStorage 进度存取
- `reader/lib/book.js` — 数据访问层，封装 fetch/拖拽双模式
- `reader/README.md` — 单独调试说明

**新增（bin/）：**
- `bin/reader-server.bat` — 启动入口（ASCII + CRLF）

**新增（test/，6 个）：**
- `test/readertoctest.cjs`、`test/readercodectest.cjs`、`test/readercodectestweb.cjs`、`test/readertocwebtest.cjs`、`test/readerprogresstest.cjs`、`test/readerservertest.cjs`

**新增（资源）：**
- `novels/.gitkeep` — 占位（`novels/*` 加入 .gitignore）

**改动：**
- `lib/menu.cjs` — 加场景 11/12
- `wallpaper.bat` — 转发场景 11/12
- `package.json` — test 链 + `npm run reader`
- `.gitignore` — 加 `novels/*` 规则
- `test/menutest.cjs` — 加 11/12 断言
- `README.md` — 加小说阅读器章节
- `AGENTS.md` — 加子系统说明 + 教训

**TDD 顺序**：纯函数层（codec/toc）先写测试再实现 → server → 前端纯逻辑（codec/toc/progress）→ 前端胶水 + HTML/CSS → bat → 菜单集成 → 真机验证 → 文档。

---

## Task 1: server 端编码检测（`lib/reader-codec.cjs`）

**Files:**
- Create: `lib/reader-codec.cjs`
- Test: `test/readercodectest.cjs`

- [ ] **Step 1: 写失败测试**

创建 `test/readercodectest.cjs`：

```js
// Test for lib/reader-codec.cjs — server-side encoding detection.
// Order: BOM -> fatal UTF-8 -> GB18030 + sanity check.
// Run: node test/readercodectest.cjs
const { detectEncoding } = require("../lib/reader-codec.cjs");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// UTF-8 with BOM: EF BB BF prefix -> 'utf8' (strip BOM upstream)
check("UTF-8 BOM detected",
  detectEncoding(Buffer.from([0xEF,0xBB,0xBF,0xE4,0xBD,0xA0])) === "utf8");

// UTF-16 LE BOM
check("UTF-16LE BOM detected",
  detectEncoding(Buffer.from([0xFF,0xFE,0x4F,0x60])) === "utf-16le");

// Plain UTF-8 (no BOM): valid Chinese UTF-8 bytes for "你好" E4 BD A0 E5 A5 BD
check("plain UTF-8 (no BOM) detected",
  detectEncoding(Buffer.from([0xE4,0xBD,0xA0,0xE5,0xA5,0xBD])) === "utf8");

// GB18030: "你好" in GBK = C4 E3 BA C3. As UTF-8 this is invalid (fatal throws).
check("GB18030 detected (fatal UTF-8 fails)",
  detectEncoding(Buffer.from([0xC4,0xE3,0xBA,0xC3])) === "gb18030");

// Empty buffer -> default to utf8 (won't crash)
check("empty buffer -> utf8", detectEncoding(Buffer.alloc(0)) === "utf8");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/readercodectest.cjs`
Expected: FAIL — `Cannot find module '../lib/reader-codec.cjs'`

- [ ] **Step 3: 写实现**

创建 `lib/reader-codec.cjs`：

```js
// Server-side encoding detection for .txt novels.
// Order: BOM -> fatal UTF-8 -> GB18030 (+ sanity via U+FFFD ratio).
// Mirrored in browser by reader/lib/codec.js; keep both in sync and run
// the same test cases (test/readercodectest*.cjs).
//
// Run standalone: not a runnable script; required by lib/reader-server.cjs.

function tryDecode(bytes, label, fatal) {
  try {
    return new TextDecoder(label, { fatal: !!fatal }).decode(bytes);
  } catch (e) {
    return null;
  }
}

function detectEncoding(bytes) {
  // 1) BOM detection (authoritative)
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return "utf8";
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return "utf-16be";

  // Empty -> utf8 default (TextDecoder handles empty fine)
  if (bytes.length === 0) return "utf8";

  // 2) Strict UTF-8: if it decodes without error, treat as UTF-8
  if (tryDecode(bytes, "utf8", true) !== null) return "utf8";

  // 3) Otherwise GB18030 (superset of GBK/GB2312; decodes any byte seq).
  // Sanity: if it yields lots of U+FFFD replacement chars, still return gb18030
  // (callers mark encodingSuspect), but don't return something nonsensical.
  return "gb18030";
}

// Sanity helper: fraction of U+FFFD in decoded text. >0.01 = suspect.
function replacementRatio(text) {
  if (!text || text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xFFFD) n++;
  return n / text.length;
}

module.exports = { detectEncoding, tryDecode, replacementRatio };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/readercodectest.cjs`
Expected: PASS, 5 passed, 0 failed

- [ ] **Step 5: 提交**

```bash
git add lib/reader-codec.cjs test/readercodest.cjs
git commit -m "feat(reader): server 端编码检测 detectEncoding (BOM/fatal-UTF8/GB18030)"
```

---

## Task 2: server 端章节切分（`lib/reader-toc.cjs`）

**Files:**
- Create: `lib/reader-toc.cjs`
- Test: `test/readertoctest.cjs`

- [ ] **Step 1: 写失败测试**

创建 `test/readertoctest.cjs`：

```js
// Test for lib/reader-toc.cjs — volume/chapter splitting + paragraph splitting.
// Spec §5. Mirrors real-world sample structure (凡人修仙传: 第X卷 / 第X章).
// Run: node test/readertoctest.cjs
const { parseTOC, splitParagraphs } = require("../lib/reader-toc.cjs");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// --- two-level structure: volume + chapter, offset spanning whole text ---
(function(){
  const text = "第一卷 七玄门\n第一章 山边小村\n　　二愣子睁眼。\n　　另一人睡着。\n第二章 青牛镇\n　　镇上热闹。\n第二卷 初踏修仙路\n第三章 嘉元城\n　　进城了。\n";
  const r = parseTOC(text, "test.txt");
  check("2 volumes detected", r.volumes.length === 2);
  check("3 chapters detected", r.chapters.length === 3);
  check("volume 1 points at chapter 0", r.volumes[0].startChapterIndex === 0);
  // v1 covers ch0(山边小村)+ch1(青牛镇); v2 starts at ch2(嘉元城) -> index 2
  check("volume 2 points at chapter 2", r.volumes[1].startChapterIndex === 2);
  // ch0 spans from its start to ch1 start
  check("ch0 endOffset == ch1 startOffset", r.chapters[0].endOffset === r.chapters[1].startOffset);
  // last chapter endOffset == text.length
  check("last ch endOffset == text.length", r.chapters[2].endOffset === text.length);
})();

// --- fallback: no recognizable heading -> single "全文" chapter ---
(function(){
  const text = "就是一段散文没有任何章节标题。\n第二行。\n";
  const r = parseTOC(text, "nochap.txt");
  check("0 real chapters -> fallback 1 chapter", r.chapters.length === 1);
  check("fallback title is '全文'", r.chapters[0].title === "全文");
  check("fallback spans whole text", r.chapters[0].endOffset === text.length);
})();

// --- duplicate headings NOT deduped (real sample bug: 第十一卷 appears twice) ---
(function(){
  const text = "第十一卷 真仙降世\n第一章 a\n　　x\n第十一卷 真仙降临\n第二章 b\n　　y\n";
  const r = parseTOC(text, "dup.txt");
  check("duplicate volume kept (2)", r.volumes.length === 2);
  check("duplicate not deduped: titles differ",
    r.volumes[0].title !== r.volumes[1].title || r.volumes.length === 2);
})();

// --- heading NOT on its own line (body mentions "翻开第一章") -> not a chapter ---
(function(){
  const text = "他翻开第一章看了看。\n　　内容。\n";
  const r = parseTOC(text, "body.txt");
  // "他翻开第一章看了看。" does NOT match /^第X章(\s|\u3000)/ because no space after 章
  check("body mention not parsed as chapter", r.chapters.length === 1 && r.chapters[0].title === "全文");
})();

// --- heading requires space/fullwidth-space separator after the marker ---
(function(){
  const text = "第一章 山边小村\n　　正文。\n";  // space after 章
  const r = parseTOC(text, "sp.txt");
  check("heading with space accepted", r.chapters.length === 1 && r.chapters[0].title.indexOf("山边小村") !== -1);
})();

// --- splitParagraphs: trims line-leading fullwidth spaces, drops empty lines ---
(function(){
  const chunk = "第一卷 七玄门\n　　二愣子睁眼。\n\n　　另一人睡着。\n";
  const ps = splitParagraphs(chunk);
  check("splitParagraphs drops the volume line + empty, keeps 2 body paragraphs",
    ps.length === 2 && ps[0].indexOf("二愣子") !== -1 && ps[1].indexOf("另一人") !== -1);
  check("splitParagraphs stripped fullwidth leading spaces", ps[0][0] !== "\u3000");
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/readertoctest.cjs`
Expected: FAIL — `Cannot find module '../lib/reader-toc.cjs'`

- [ ] **Step 3: 写实现**

创建 `lib/reader-toc.cjs`：

```js
// Server-side TOC parsing: split decoded text into volumes + chapters by
// offset, and split a chapter chunk into paragraphs.
// Spec §5. Mirrored in browser by reader/lib/toc.js (drag mode); keep both
// in sync; same cases in test/readertoctest.cjs + test/readertocwebtest.cjs.

// Volume/chapter markers: 第X卷 / 第X章 with Chinese or arabic numerals,
// followed by a space or fullwidth space (\u3000) then the title. Requiring
// the separator + "title on its own line" prevents body mentions like
// "翻开第一章" from being misparsed (spec §5 容错).
const VOLUME_RE = /^第[一二三四五六七八九十百千零0-9]+卷(\s|\u3000)/;
const CHAPTER_RE = /^第[一二三四五六七八九十百千零0-9]+章(\s|\u3000)/;

function parseTOC(text, filename) {
  const lines = text.split(/\r?\n/);
  const chapters = []; // {title, startOffset, endOffset?}
  const volumes = [];  // {title, startChapterIndex}
  let offset = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (VOLUME_RE.test(line)) {
      volumes.push({ title: line, startChapterIndex: chapters.length });
    } else if (CHAPTER_RE.test(line)) {
      chapters.push({ title: line, startOffset: offset });
    }
    offset += raw.length + 1; // +1 for the newline char we split on
  }
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].endOffset = (i + 1 < chapters.length)
      ? chapters[i + 1].startOffset : text.length;
  }
  // Fallback: no recognizable chapter -> whole text is one "全文" chapter
  if (chapters.length === 0) {
    chapters.push({ title: "全文", startOffset: 0, endOffset: text.length });
  }
  return { volumes, chapters };
}

// Split a chapter chunk (text between two offsets) into display paragraphs.
// Trim line-leading whitespace (fullwidth/halfwidth spaces); CSS text-indent
// re-adds indentation so it scales with font-size (spec §5).
function splitParagraphs(chunk) {
  return chunk.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
}

module.exports = { parseTOC, splitParagraphs, VOLUME_RE, CHAPTER_RE };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/readertoctest.cjs`
Expected: PASS, all checks passed, 0 failed

- [ ] **Step 5: 提交**

```bash
git add lib/reader-toc.cjs test/readertoctest.cjs
git commit -m "feat(reader): server 端章节切分 parseTOC + splitParagraphs (卷/章 + 兜底)"
```

---

## Task 3: 前端编码镜像（`reader/lib/codec.js`）

**Files:**
- Create: `reader/lib/codec.js`
- Test: `test/readercodectestweb.cjs`

- [ ] **Step 1: 写失败测试**

创建 `test/readercodectestweb.cjs`（与 server 版用**同一套用例**，钉死两边一致 — spec §7）：

```js
// Test for reader/lib/codec.js — browser-side encoding mirror of
// lib/reader-codec.cjs. SAME cases as readercodetest.cjs; both must agree.
// This is the cross-environment glue check (AGENTS.md 教训 12).
// Run: node test/readercodectestweb.cjs
const { detectEncoding, decodeText } = require("../reader/lib/codec.js");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

check("UTF-8 BOM detected",
  detectEncoding(new Uint8Array([0xEF,0xBB,0xBF,0xE4,0xBD,0xA0])) === "utf8");
check("plain UTF-8 detected",
  detectEncoding(new Uint8Array([0xE4,0xBD,0xA0,0xE5,0xA5,0xBD])) === "utf8");
check("GB18030 detected",
  detectEncoding(new Uint8Array([0xC4,0xE3,0xBA,0xC3])) === "gb18030");
check("empty -> utf8", detectEncoding(new Uint8Array(0)) === "utf8");

// decodeText: full pipeline bytes -> decoded string
check("decodeText GB18030 returns 你好",
  decodeText(new Uint8Array([0xC4,0xE3,0xBA,0xC3])) === "你好");
check("decodeText UTF-8 returns 你好",
  decodeText(new Uint8Array([0xE4,0xBD,0xA0,0xE5,0xA5,0xBD])) === "你好");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/readercodectestweb.cjs`
Expected: FAIL — `Cannot find module '../reader/lib/codec.js'`

- [ ] **Step 3: 写实现**

创建 `reader/lib/codec.js`（**纯 JS，不依赖任何全局除 `TextDecoder`，可在浏览器和 Node 都跑**）：

```js
// Browser-side encoding detection for drag mode. Mirror of lib/reader-codec.cjs
// (server). Same algorithm; keep both in sync. Tested by test/readercodectestweb.cjs
// with the SAME cases as server's readercodetest.cjs.
//
// Input is Uint8Array (from FileReader.readAsArrayBuffer). Output is a
// TextDecoder label string + a decodeText(bytes) helper that strips BOM.

function tryDecode(bytes, label, fatal) {
  try { return new TextDecoder(label, { fatal: !!fatal }).decode(bytes); }
  catch (e) { return null; }
}

function detectEncoding(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return "utf8";
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return "utf-16be";
  if (bytes.length === 0) return "utf8";
  if (tryDecode(bytes, "utf8", true) !== null) return "utf8";
  return "gb18030";
}

// Full pipeline: detect + decode, stripping a UTF-8 BOM if present.
function decodeText(bytes, overrideLabel) {
  const label = overrideLabel || detectEncoding(bytes);
  let b = bytes;
  if (label === "utf8" && b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    b = b.subarray(3);
  }
  return new TextDecoder(label).decode(b);
}

// UMD-ish: works as CommonJS (test) and as a browser global/module.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { detectEncoding, decodeText, tryDecode };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/readercodectestweb.cjs`
Expected: PASS, 6 passed, 0 failed

- [ ] **Step 5: 提交**

```bash
git add reader/lib/codec.js test/readercodetestweb.cjs
git commit -m "feat(reader): 前端编码镜像 codec.js (拖拽模式, 同款用例钉一致)"
```

---

## Task 4: 前端 TOC 镜像（`reader/lib/toc.js`）

**Files:**
- Create: `reader/lib/toc.js`
- Test: `test/readertocwebtest.cjs`

- [ ] **Step 1: 写失败测试**

创建 `test/readertocwebtest.cjs`（同 readertoctest 的核心用例）：

```js
// Test for reader/lib/toc.js — browser-side TOC mirror of lib/reader-toc.cjs.
// Drag mode parses chapters client-side. SAME core cases as readertoctest.cjs.
// Run: node test/readertocwebtest.cjs
const { parseTOC, splitParagraphs } = require("../reader/lib/toc.js");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

(function(){
  const text = "第一卷 七玄门\n第一章 山边小村\n　　二愣子睁眼。\n第二章 青牛镇\n　　镇上。\n第二卷 初踏\n第三章 嘉元城\n　　进城。\n";
  const r = parseTOC(text);
  check("2 volumes", r.volumes.length === 2);
  check("3 chapters", r.chapters.length === 3);
  check("v1->ch0, v2->ch1", r.volumes[0].startChapterIndex === 0 && r.volumes[1].startChapterIndex === 1);
  check("last ch endOffset == text.length", r.chapters[2].endOffset === text.length);
})();

(function(){
  const r = parseTOC("无章节散文。\n第二行。\n");
  check("fallback 全文", r.chapters.length === 1 && r.chapters[0].title === "全文");
})();

check("splitParagraphs trims + drops empty",
  splitParagraphs("　　段一。\n\n　　段二。\n").length === 2);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/readertocwebtest.cjs`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: 写实现**

创建 `reader/lib/toc.js`：

```js
// Browser-side TOC mirror of lib/reader-toc.cjs (server). Drag mode parses
// chapters from the full decoded text held in memory. SAME cases in tests.
// NOTE: returns {title,startOffset,endOffset}; in drag mode the full text is
// in memory so getChapter just slices text.slice(start,end).

const VOLUME_RE = /^第[一二三四五六七八九十百千零0-9]+卷(\s|\u3000)/;
const CHAPTER_RE = /^第[一二三四五六七八九十百千零0-9]+章(\s|\u3000)/;

function parseTOC(text) {
  const lines = text.split(/\r?\n/);
  const chapters = [], volumes = [];
  let offset = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (VOLUME_RE.test(line)) volumes.push({ title: line, startChapterIndex: chapters.length });
    else if (CHAPTER_RE.test(line)) chapters.push({ title: line, startOffset: offset });
    offset += raw.length + 1;
  }
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].endOffset = (i + 1 < chapters.length) ? chapters[i + 1].startOffset : text.length;
  }
  if (chapters.length === 0) chapters.push({ title: "全文", startOffset: 0, endOffset: text.length });
  return { volumes, chapters };
}

function splitParagraphs(chunk) {
  return chunk.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseTOC, splitParagraphs, VOLUME_RE, CHAPTER_RE };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/readertocwebtest.cjs`
Expected: PASS, all passed

- [ ] **Step 5: 提交**

```bash
git add reader/lib/toc.js test/readertocwebtest.cjs
git commit -m "feat(reader): 前端 TOC 镜像 toc.js (拖拽模式切章)"
```

---

## Task 5: 前端进度存取（`reader/lib/progress.js`）

**Files:**
- Create: `reader/lib/progress.js`
- Test: `test/readerprogresstest.cjs`

- [ ] **Step 1: 写失败测试**

创建 `test/readerprogresstest.cjs`（用注入的 localStorage mock，因为 Node 没有 localStorage）：

```js
// Test for reader/lib/progress.js — localStorage progress per-book-id.
// Spec §6. Uses an in-memory localStorage mock (Node has none).
// Run: node test/readerprogresstest.cjs

// --- localStorage mock ---
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { saveProgress, loadProgress, getShelf, addToShelf } = require("../reader/lib/progress.js");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// save + load roundtrip
saveProgress("bookA", { chapterIndex: 156, scrollRatio: 0.23 });
const p = loadProgress("bookA");
check("save/load roundtrip preserves chapter+ratio",
  p.chapterIndex === 156 && p.scrollRatio === 0.23);

// per-book isolation
saveProgress("bookB", { chapterIndex: 3, scrollRatio: 0.9 });
check("books isolated", loadProgress("bookA").chapterIndex === 156 && loadProgress("bookB").chapterIndex === 3);

// missing book -> null
check("missing book returns null", loadProgress("nonexistent") === null);

// scrollRatio clamped to [0,1]
saveProgress("bookC", { chapterIndex: 0, scrollRatio: 5 });
check("ratio clamped to 1", loadProgress("bookC").scrollRatio === 1);
saveProgress("bookD", { chapterIndex: 0, scrollRatio: -2 });
check("ratio clamped to 0", loadProgress("bookD").scrollRatio === 0);

// shelf: add + list + dedup by bookId + sorted by updatedAt desc
addToShelf({ bookId: "bookA", filename: "a.txt", lastChapterTitle: "ch156" });
addToShelf({ bookId: "bookB", filename: "b.txt", lastChapterTitle: "ch3" });
addToShelf({ bookId: "bookA", filename: "a.txt", lastChapterTitle: "ch160" }); // update
const shelf = getShelf();
check("shelf dedups by bookId (2 entries)", shelf.length === 2);
check("shelf latest update wins", shelf.find(s => s.bookId === "bookA").lastChapterTitle === "ch160");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/readerprogresstest.cjs`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: 写实现**

创建 `reader/lib/progress.js`：

```js
// Per-book reading progress in localStorage. Spec §6.
// key: zcode-reader:progress:<bookId>  value: {chapterIndex, scrollRatio, updatedAt}
// key: zcode-reader:shelf              value: [{bookId, filename, lastChapterTitle, updatedAt}]
//
// localStorage must exist (browser or test mock). In drag mode the partition
// is persist:zcode-embedded-browser, so progress survives ZCode restart
// (待真机验证 — spec §2 待验项 5).

const PROGRESS_PREFIX = "zcode-reader:progress:";
const SHELF_KEY = "zcode-reader:shelf";

function clamp01(x) { x = Number(x) || 0; return x < 0 ? 0 : x > 1 ? 1 : x; }

function saveProgress(bookId, p) {
  const v = {
    bookId,
    chapterIndex: Math.max(0, parseInt(p.chapterIndex, 10) || 0),
    scrollRatio: clamp01(p.scrollRatio),
    updatedAt: Date.now(),
  };
  localStorage.setItem(PROGRESS_PREFIX + bookId, JSON.stringify(v));
  return v;
}

function loadProgress(bookId) {
  const raw = localStorage.getItem(PROGRESS_PREFIX + bookId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function getShelf() {
  const raw = localStorage.getItem(SHELF_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    // sort by updatedAt desc (most recently read first)
    return arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (e) { return []; }
}

function addToShelf(entry) {
  const arr = getShelf();
  const i = arr.findIndex(s => s.bookId === entry.bookId);
  const v = { ...entry, updatedAt: Date.now() };
  if (i >= 0) arr[i] = { ...arr[i], ...v };
  else arr.push(v);
  localStorage.setItem(SHELF_KEY, JSON.stringify(arr));
  return v;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { saveProgress, loadProgress, getShelf, addToShelf, clamp01, PROGRESS_PREFIX, SHELF_KEY };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/readerprogresstest.cjs`
Expected: PASS, all passed

- [ ] **Step 5: 提交**

```bash
git add reader/lib/progress.js test/readerprogresstest.cjs
git commit -m "feat(reader): 前端进度存取 progress.js (localStorage 按书 id 隔离)"
```

---

## Task 6: server 主程序（`lib/reader-server.cjs`）

**Files:**
- Create: `lib/reader-server.cjs`
- Test: `test/readerservertest.cjs`

- [ ] **Step 1: 写失败测试**

创建 `test/readerservertest.cjs`（起 server on 随机端口，用 fixture 小 txt，验证 API 结构 + 端口冲突自增）：

```js
// Test for lib/reader-server.cjs — HTTP API shape + port-conflict auto-increment.
// Starts the server on a random free port with a fixture novels/ dir.
// Run: node test/readerservertest.cjs
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    }).on("error", reject);
  });
}

(async () => {
  // fixture novels dir: one tiny GB18030 txt with 2 chapters
  const tmpNovels = fs.mkdtempSync(path.join(os.tmpdir(), "reader-novels-"));
  const sample = Buffer.from("第一章 开头\n　　正文一。\n第二章 结尾\n　　正文二。\n", "utf8");
  fs.writeFileSync(path.join(tmpNovels, "sample.txt"), sample);

  // fixture reader dir: minimal index.html so /reader serves something
  const tmpReader = fs.mkdtempSync(path.join(os.tmpdir(), "reader-web-"));
  fs.writeFileSync(path.join(tmpReader, "index.html"), "<!doctype html><title>r</title>");

  const { createServer } = require("../lib/reader-server.cjs");

  // pick a free port by binding once then releasing
  const portPicker = require("net").createServer();
  await new Promise(r => portPicker.listen(0, "127.0.0.1", r));
  const port = portPicker.address().port;
  await new Promise(r => portPicker.close(r));

  const server = await createServer({ novelsDir: tmpNovels, readerDir: tmpReader, port: port, host: "127.0.0.1" });
  const base = "http://127.0.0.1:" + server.port;

  try {
    // /api/books -> array with our sample
    const books = JSON.parse((await httpGet(base + "/api/books")).body);
    check("/api/books returns array", Array.isArray(books));
    check("/api/books has sample.txt", books.some(b => b.filename === "sample.txt"));
    check("book has totalChapters", typeof books[0].totalChapters === "number" && books[0].totalChapters === 2);

    // toc
    const id = books[0].id;
    const toc = JSON.parse((await httpGet(base + "/api/book/" + id + "/toc")).body);
    check("/toc has chapters array", Array.isArray(toc.chapters) && toc.chapters.length === 2);
    check("/toc ch0 title contains 开头", toc.chapters[0].title.indexOf("开头") !== -1);

    // chapter content
    const ch = JSON.parse((await httpGet(base + "/api/book/" + id + "/chapter/0")).body);
    check("/chapter has paragraphs array", Array.isArray(ch.paragraphs) && ch.paragraphs.length >= 1);
    check("/chapter paragraphs include 正文一", ch.paragraphs.some(p => p.indexOf("正文一") !== -1));
    check("/chapter prev/next fields present", "prev" in ch && "next" in ch);

    // out-of-range chapter -> 404
    const oor = await httpGet(base + "/api/book/" + id + "/chapter/9999");
    check("out-of-range chapter -> 404", oor.status === 404);

    // /reader serves html
    const reader = await httpGet(base + "/reader");
    check("/reader returns html", reader.status === 200 && reader.body.indexOf("<title>") !== -1);

    // / redirects to /reader
    const root = await httpGet(base + "/");
    check("/ redirects to /reader", root.status === 302 && (root.headers.location || "").indexOf("/reader") !== -1);
  } finally {
    server.close();
    try { fs.rmSync(tmpNovels, { recursive: true }); } catch (e) {}
    try { fs.rmSync(tmpReader, { recursive: true }); } catch (e) {}
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error("TEST ERROR:", e); process.exit(1); });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/readerservertest.cjs`
Expected: FAIL — `Cannot find module '../lib/reader-server.cjs'`

- [ ] **Step 3: 写实现**

创建 `lib/reader-server.cjs`：

```js
// Novel-reader HTTP server. Scans novels/*.txt once at startup, decodes,
// builds TOC, serves /api/* + the reader SPA. Port conflicts auto-increment.
// Spec §3, §5. Not coupled to inject.cjs or CDP.
//
// run standalone:  node lib/reader-server.cjs
// (bin/reader-server.bat wraps this; test imports createServer directly)

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { detectEncoding, replacementRatio } = require("./reader-codec.cjs");
const { parseTOC } = require("./reader-toc.cjs");

const DEFAULT_PORT = parseInt(process.env.ZCODE_READER_PORT || "17890", 10);
const DEFAULT_HOST = process.env.ZCODE_READER_HOST || "127.0.0.1";

// Stable id from filename (spec §6: hash so rename loses progress, accepted).
function bookIdFor(filename) {
  let h = 5381;
  for (let i = 0; i < filename.length; i++) h = ((h << 5) + h + filename.charCodeAt(i)) | 0;
  return "b" + (h >>> 0).toString(36);
}

// Scan + decode all books. Returns Map<id, BookRecord>.
function buildLibrary(novelsDir) {
  const lib = new Map();
  if (!fs.existsSync(novelsDir)) { try { fs.mkdirSync(novelsDir, { recursive: true }); } catch (e) {} }
  let entries = [];
  try { entries = fs.readdirSync(novelsDir); } catch (e) {}
  for (const name of entries) {
    if (!/\.txt$/i.test(name)) continue;
    const full = path.join(novelsDir, name);
    let bytes;
    try { bytes = fs.readFileSync(full); } catch (e) { continue; }
    const enc = detectEncoding(bytes);
    let text;
    try { text = new TextDecoder(enc === "utf8" && bytes[0] === 0xEF ? "utf8" : enc).decode(bytes); }
    catch (e) { text = new TextDecoder("gb18030").decode(bytes); }
    // strip UTF-8 BOM from text if present
    if (enc === "utf8" && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const toc = parseTOC(text, name);
    const suspect = replacementRatio(text) > 0.01;
    const id = bookIdFor(name);
    lib.set(id, { id, filename: name, sizeBytes: bytes.length, encoding: enc, encodingSuspect: suspect, toc, text });
  }
  return lib;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

// Factory: create + listen, auto-increment port on EADDRINUSE (up to +5).
// Returns { server, port, close, library }.
function createServer(opts) {
  return new Promise((resolve, reject) => {
    const novelsDir = opts.novelsDir;
    const readerDir = opts.readerDir;
    const startPort = opts.port || DEFAULT_PORT;
    const host = opts.host || DEFAULT_HOST;
    const library = buildLibrary(novelsDir);

    const server = http.createServer((req, res) => handle(req, res, library, readerDir));
    let tries = 0;
    function tryListen(port) {
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && tries < 5) { tries++; tryListen(port + 1); }
        else reject(err);
      });
      server.listen(port, host, () => {
        // resolve with the ACTUAL bound port (spec §3: write clipboard AFTER listen)
        resolve({ server, port: server.address().port, host, library, close: () => server.close() });
      });
    }
    tryListen(startPort);
  });
}

function handle(req, res, library, readerDir) {
  const u = url.parse(req.url, true);
  const p = u.pathname;

  if (p === "/" ) { res.writeHead(302, { Location: "/reader" }); res.end(); return; }

  if (p === "/reader") {
    return serveStatic(res, path.join(readerDir, "index.html"), "text/html; charset=utf-8");
  }
  if (p.indexOf("/reader/lib/") === 0) {
    const rel = p.slice("/reader/".length); // lib/x.js
    return serveStatic(res, path.join(readerDir, rel), guessMime(rel));
  }

  if (p === "/api/books") {
    const list = [];
    for (const b of library.values()) {
      list.push({ id: b.id, filename: b.filename, totalChapters: b.toc.chapters.length,
        hasVolumes: b.toc.volumes.length > 0, encoding: b.encoding, encodingSuspect: b.encodingSuspect });
    }
    return sendJson(res, 200, list);
  }

  let m = /^\/api\/book\/([^/]+)\/toc$/.exec(p);
  if (m) {
    const b = library.get(m[1]);
    if (!b) return sendJson(res, 404, { error: "book not found" });
    return sendJson(res, 200, b.toc);
  }

  m = /^\/api\/book\/([^/]+)\/chapter\/(\d+)$/.exec(p);
  if (m) {
    const b = library.get(m[1]);
    if (!b) return sendJson(res, 404, { error: "book not found" });
    const n = parseInt(m[2], 10);
    const chs = b.toc.chapters;
    if (n < 0 || n >= chs.length) return sendJson(res, 404, { error: "chapter out of range" });
    const c = chs[n];
    const chunk = b.text.slice(c.startOffset, c.endOffset);
    // paragraphs: split + drop the heading line itself (first matching line)
    const paras = chunk.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
    // first paragraph is usually the heading; drop it if it matches the chapter title
    if (paras.length > 0 && paras[0] === c.title.trim()) paras.shift();
    return sendJson(res, 200, { index: n, title: c.title, paragraphs: paras, prev: n > 0 ? n - 1 : null, next: n + 1 < chs.length ? n + 1 : null });
  }

  // progress endpoint is a no-op placeholder (progress lives in localStorage)
  m = /^\/api\/book\/([^/]+)\/progress$/.exec(p);
  if (m) return sendJson(res, 200, null);

  sendJson(res, 404, { error: "not found" });
}

function serveStatic(res, full, mime) {
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": mime || "application/octet-stream" });
    res.end(data);
  });
}
function guessMime(rel) {
  if (/\.js$/i.test(rel)) return "text/javascript; charset=utf-8";
  if (/\.css$/i.test(rel)) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

// Standalone entry (bin/reader-server.bat calls this).
if (require.main === module) {
  const root = path.join(__dirname, "..");
  const novelsDir = path.join(root, "novels");
  const readerDir = path.join(root, "reader");
  createServer({ novelsDir, readerDir, port: DEFAULT_PORT, host: DEFAULT_HOST })
    .then(({ port, host, library }) => {
      console.log("[reader] 服务已启动: http://" + host + ":" + port + "/reader");
      console.log("[reader] 共加载 " + library.size + " 本书:");
      for (const b of library.values()) {
        console.log("  - " + b.filename + " (" + b.toc.chapters.length + " 章, " + b.encoding +
          (b.encodingSuspect ? ", 编码可疑" : "") + ")");
      }
      console.log("[reader] 关闭此窗口即停止服务。");
      // Write the actual URL to the clipboard (after listen, so the port is real).
      try { require("child_process").execSync(
        'powershell -NoProfile -Command "Set-Clipboard -Value \\"http://' + host + ':' + port + '/reader\\""',
        { stdio: "ignore" });
        console.log("[reader] URL 已复制到剪贴板，去 ZCode 浏览器面板粘贴回车。");
      } catch (e) { console.log("[reader] (剪贴板写入失败，请手动复制上方 URL)"); }
    })
    .catch((e) => { console.error("[reader] 启动失败: " + e.message); process.exit(1); });
}

module.exports = { createServer, buildLibrary, bookIdFor };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/readerservertest.cjs`
Expected: PASS, all passed

- [ ] **Step 5: 提交**

```bash
git add lib/reader-server.cjs test/readerservertest.cjs
git commit -m "feat(reader): server 主程序 createServer (API + 端口自增 + 监听后写剪贴板)"
```

---

## Task 7: server 端口冲突自增的回归测试

**Files:**
- Modify: `test/readerservertest.cjs`（在末尾 `process.exit` 前追加）

这一步钉死 spec §11 风险"端口冲突自动换端口且新 URL 正确"（对称 probetest 钉死 `.Count` 陷阱的精神）。

- [ ] **Step 1: 在测试文件末尾追加端口冲突用例**

把 `test/readerservertest.cjs` 最后的 `console.log(...)` + `process.exit(...)` 整段替换为：

```js
// === port-conflict auto-increment (spec §11 风险钉死) ===
(async () => {
  const tmpNovels2 = fs.mkdtempSync(path.join(os.tmpdir(), "reader-novels2-"));
  const tmpReader2 = fs.mkdtempSync(path.join(os.tmpdir(), "reader-web2-"));
  fs.writeFileSync(path.join(tmpReader2, "index.html"), "<!doctype html>");
  const { createServer } = require("../lib/reader-server.cjs");

  // occupy a port
  const blocker = require("net").createServer();
  await new Promise(r => blocker.listen(0, "127.0.0.1", r));
  const blockedPort = blocker.address().port;

  // ask server to use the blocked port -> should auto-increment to blockedPort+1
  const s = await createServer({ novelsDir: tmpNovels2, readerDir: tmpReader2, port: blockedPort, host: "127.0.0.1" });
  check("port conflict auto-incremented", s.port === blockedPort + 1);

  // verify the new port actually serves
  const r = await httpGet("http://127.0.0.1:" + s.port + "/api/books");
  check("incremented port serves API", r.status === 200);

  s.close();
  await new Promise(r => blocker.close(r));
  try { fs.rmSync(tmpNovels2, { recursive: true }); } catch (e) {}
  try { fs.rmSync(tmpReader2, { recursive: true }); } catch (e) {}

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
})();
```

注意：这是在第一个 IIFE 的 `finally { server.close() }` **之后**新增的第二个 IIFE。把原文件末尾的：

```js
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error("TEST ERROR:", e); process.exit(1); });
```

替换为（保留 `.catch`）：

```js
})().catch(e => { console.error("TEST ERROR:", e); process.exit(1); });
```

然后把上面的端口冲突 IIFE 追加到文件末尾（它自己带 `process.exit`）。

- [ ] **Step 2: 跑测试确认通过**

Run: `node test/readerservertest.cjs`
Expected: PASS（含新增的 2 个端口冲突 check）

- [ ] **Step 3: 提交**

```bash
git add test/readerservertest.cjs
git commit -m "test(reader): 端口冲突自增回归测试 (钉死 spec §11 风险)"
```

---

## Task 8: 前端 book.js 数据访问层（`reader/lib/book.js`）

**Files:**
- Create: `reader/lib/book.js`
- Test: 无独立测试（薄适配层，靠 readerservertest + 端到端覆盖；纯逻辑都在 codec/toc/progress 里）

- [ ] **Step 1: 写实现**

创建 `reader/lib/book.js`：

```js
// Data-access layer. Hides server-fetch vs drag-decode behind one Book API.
// Spec §4. reader.js only calls Book.open/getToc/getChapter/save/load —
// it never knows whether data came from /api or an in-memory ArrayBuffer.
//
// Drag-mode books hold the full decoded text in memory (getChapter slices).

(function (global) {
  function isHttpMode() { return global.location && global.location.protocol === "http:"; }

  // Open a book. server: bookId from /api/books. drag: pass {filename, arrayBuffer}.
  async function open(arg) {
    if (isHttpMode() && typeof arg === "string") {
      return openHttp(arg);
    }
    return openDrag(arg);
  }

  async function openHttp(bookId) {
    const [tocRes, prog] = await Promise.all([
      fetch("/api/book/" + bookId + "/toc").then(r => r.json()),
      Promise.resolve(null),
    ]);
    return {
      id: bookId,
      _mode: "http",
      _toc: tocRes,
      getToc: async () => tocRes,
      getChapter: async (n) => {
        const r = await fetch("/api/book/" + bookId + "/chapter/" + n);
        if (!r.ok) return null;
        return r.json();
      },
      save: async (n, ratio) => global.__readerProgress.saveProgress(bookId, { chapterIndex: n, scrollRatio: ratio }),
      load: async () => global.__readerProgress.loadProgress(bookId),
    };
  }

  async function openDrag(arg) {
    // arg: {filename, arrayBuffer} from FileReader / drop
    const { decodeText } = global.__readerCodec;
    const { parseTOC, splitParagraphs } = global.__readerToc;
    const bytes = new Uint8Array(arg.arrayBuffer);
    const text = decodeText(bytes);
    const toc = parseTOC(text);
    const bookId = arg.bookId || ("drag-" + arg.filename);
    return {
      id: bookId,
      _mode: "drag",
      _text: text,
      _toc: toc,
      getToc: async () => toc,
      getChapter: async (n) => {
        if (n < 0 || n >= toc.chapters.length) return null;
        const c = toc.chapters[n];
        const chunk = text.slice(c.startOffset, c.endOffset);
        let paras = splitParagraphs(chunk);
        if (paras.length > 0 && paras[0] === c.title.trim()) paras.shift();
        return { index: n, title: c.title, paragraphs: paras,
          prev: n > 0 ? n - 1 : null, next: n + 1 < toc.chapters.length ? n + 1 : null };
      },
      save: async (n, ratio) => global.__readerProgress.saveProgress(bookId, { chapterIndex: n, scrollRatio: ratio }),
      load: async () => global.__readerProgress.loadProgress(bookId),
    };
  }

  global.__readerBook = { open, isHttpMode };
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 2: 手动验证（Node 里 sanity check 导出，不写正式测试）**

Run:
```bash
node -e "require('./reader/lib/book.js'); console.log('book.js loads ok:', typeof globalThis.__readerBook)"
```
Expected: `book.js loads ok: object`（不抛错即过；真实行为靠端到端）

- [ ] **Step 3: 提交**

```bash
git add reader/lib/book.js
git commit -m "feat(reader): 数据访问层 book.js (封装 fetch/拖拽双模式)"
```

---

## Task 9: reader HTML 骨架 + CSS（`reader/index.html`, `reader/reader.css`）

**Files:**
- Create: `reader/index.html`
- Create: `reader/reader.css`

- [ ] **Step 1: 写 HTML 骨架**

创建 `reader/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ZCode 阅读器</title>
  <!-- relative href works in BOTH modes: http (index at /reader, resolves to
       /reader/reader.css) and file:// (same dir). Avoid /absolute paths:
       they break in file:// mode. -->
  <link rel="stylesheet" href="reader.css">
</head>
<body class="theme-dark" data-mode="loading">
  <header id="topbar">
    <button id="btn-shelf" title="书架/目录">☰</button>
    <span id="title-bar">《<span id="book-name">未打开</span>》 · <span id="chap-name">—</span></span>
    <span class="spacer"></span>
    <button id="font-dec" title="字号 −">A−</button>
    <button id="font-inc" title="字号 +">A+</button>
    <button id="theme-toggle" title="主题">🌙</button>
    <select id="enc-select" title="编码">
      <option value="auto">自动</option>
      <option value="utf8">UTF-8</option>
      <option value="gb18030">GB18030</option>
    </select>
    <button id="refresh-shelf" title="刷新书单">⟳</button>
  </header>

  <div id="main">
    <nav id="sidebar" class="collapsed">
      <div id="shelf-list"></div>
      <hr>
      <div id="toc-list"></div>
    </nav>
    <section id="reader">
      <div id="drop-hint">把 .txt 拖到这里开始阅读<br><small>（或启动 reader-server.bat 后从书架选书）</small></div>
      <article id="chapter-content"></article>
      <div id="chapter-nav">
        <button id="prev-chap">← 上一章</button>
        <button id="next-chap">下一章 →</button>
      </div>
    </section>
  </div>

  <div id="err-banner" class="hidden"></div>

  <!-- Pure-logic libs (work in Node too; tested separately) -->
  <script src="lib/codec.js"></script>
  <script src="lib/toc.js"></script>
  <script src="lib/progress.js"></script>
  <script src="lib/book.js"></script>
  <!-- Main glue (only DOM code) -->
  <script src="reader.js"></script>
</body>
</html>
```

注意：CSS/JS 一律用**相对路径**（`reader.css`、`lib/codec.js`），不要用 `/reader/...` 绝对路径——绝对路径在 file:// 模式下会断（file:// 不认 `/reader` 开头的路径）。相对路径在 http（index 在 `/reader`）和 file（index 在某目录）下都能正确解析。

- [ ] **Step 2: 写 CSS**

创建 `reader/reader.css`：

```css
:root {
  --font-size: 17px;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; }

body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

/* top bar */
#topbar { flex: 0 0 44px; display: flex; align-items: center; gap: 8px;
  padding: 0 10px; border-bottom: 1px solid var(--c-border);
  background: var(--c-bg); color: var(--c-fg); font-size: 13px; }
#topbar button, #topbar select { background: transparent; color: var(--c-fg);
  border: 1px solid var(--c-border); border-radius: 4px; padding: 2px 8px; cursor: pointer; }
#title-bar { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.spacer { flex: 0 0 auto; }

/* main: sidebar + reader */
#main { flex: 1 1 auto; display: flex; min-height: 0; }

#sidebar { width: 220px; flex: 0 0 220px; border-right: 1px solid var(--c-border);
  background: var(--c-bg-alt); overflow-y: auto; transition: width .15s, flex .15s; }
#sidebar.collapsed { width: 0; flex: 0 0 0; overflow: hidden; }
#sidebar .vol { font-weight: bold; color: var(--c-fg-muted); padding: 6px 10px; font-size: 12px; }
#sidebar .chap { padding: 4px 16px; cursor: pointer; font-size: 13px; color: var(--c-fg); }
#sidebar .chap:hover { background: var(--c-hover); }
#sidebar .chap.current { background: var(--c-accent-bg); color: var(--c-accent-fg); }
#sidebar .shelf-item { padding: 6px 10px; cursor: pointer; border-bottom: 1px solid var(--c-border); }
#sidebar .shelf-item small { display: block; color: var(--c-fg-muted); }
#sidebar hr { border: 0; border-top: 1px solid var(--c-border); margin: 4px 0; }

#reader { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 20px; }
#chapter-content { max-width: 760px; margin: 0 auto; font-size: var(--font-size);
  line-height: 1.8; color: var(--c-fg); }
#chapter-content p { text-indent: 2em; margin: 0 0 0.4em 0; }
#chapter-content h2 { font-size: 1.3em; text-align: center; margin: 0 0 1em 0; }
#chapter-nav { display: flex; justify-content: space-between; max-width: 760px;
  margin: 20px auto; }
#chapter-nav button { padding: 8px 20px; border: 1px solid var(--c-border);
  background: var(--c-bg-alt); color: var(--c-fg); border-radius: 4px; cursor: pointer; }

#drop-hint { text-align: center; color: var(--c-fg-muted); margin-top: 30vh; }
body.dragging #reader { outline: 3px dashed var(--c-accent-fg); }

#err-banner { position: fixed; bottom: 0; left: 0; right: 0; padding: 8px 16px;
  background: #c33; color: #fff; font-size: 13px; }
.hidden { display: none !important; }

/* themes */
.theme-dark { --c-bg:#1e1e22; --c-bg-alt:#26262b; --c-fg:#d4d4d8; --c-fg-muted:#888;
  --c-border:#3a3a42; --c-hover:#2e2e36; --c-accent-bg:#3a3a42; --c-accent-fg:#7cc7ff; }
.theme-light { --c-bg:#fafafa; --c-bg-alt:#f0f0f0; --c-fg:#222; --c-fg-muted:#888;
  --c-border:#ddd; --c-hover:#eaeaea; --c-accent-bg:#e0ecff; --c-accent-fg:#1668d6; }
.theme-sepia { --c-bg:#f4ecd8; --c-bg-alt:#ece2c4; --c-fg:#5b4636; --c-fg-muted:#9a8a72;
  --c-border:#d9cba8; --c-hover:#e8ddbf; --c-accent-bg:#d9cba8; --c-accent-fg:#8a5a00; }
```

- [ ] **Step 3: 提交**

```bash
git add reader/index.html reader/reader.css
git commit -m "feat(reader): HTML 骨架 + CSS (三栏布局/主题/阅读排版)"
```

---

## Task 10: reader 主控胶水（`reader/reader.js`）

**Files:**
- Create: `reader/reader.js`

这是唯一碰 DOM 的文件。保持薄（spec §4）。

- [ ] **Step 1: 写实现**

创建 `reader/reader.js`：

```js
// Main glue: the only file that touches DOM. Spec §4. Keep it thin.
// libs are loaded as globals: __readerCodec, __readerToc, __readerProgress, __readerBook.
(function () {
  "use strict";
  var currentBook = null;
  var currentChapter = -1;
  var saveTimer = null;

  var $ = function (id) { return document.getElementById(id); };
  var shelf = window.__readerProgress;
  var bookApi = window.__readerBook;

  function showErr(msg) { var b = $("err-banner"); b.textContent = msg; b.classList.remove("hidden"); }
  function clearErr() { $("err-banner").classList.add("hidden"); }

  // ---- shelf list render ----
  async function renderShelf() {
    var box = $("shelf-list");
    box.innerHTML = "";
    var header = document.createElement("div");
    header.className = "vol";
    header.textContent = "书架";
    box.appendChild(header);

    if (bookApi.isHttpMode()) {
      try {
        var books = await fetch("/api/books").then(r => r.json());
        var local = shelf.getShelf();
        // sort: books with progress first (by updatedAt), then the rest
        var progressMap = {}; local.forEach(s => progressMap[s.bookId] = s);
        books.sort(function (a, b) {
          var pa = progressMap[a.id], pb = progressMap[b.id];
          return (pb ? pb.updatedAt : 0) - (pa ? pa.updatedAt : 0);
        });
        if (books.length === 0) {
          var e = document.createElement("div"); e.className = "chap"; e.style.color = "var(--c-fg-muted)";
          e.textContent = "novels/ 为空，把 .txt 放进去后重启服务。"; box.appendChild(e); return;
        }
        books.forEach(function (b) {
          var item = document.createElement("div"); item.className = "shelf-item";
          var p = progressMap[b.id];
          var title = document.createElement("span"); title.textContent = b.filename;
          if (b.encodingSuspect) title.textContent = "⚠️ " + title.textContent;
          item.appendChild(title);
          if (p) { var s = document.createElement("small"); s.textContent = "读到: " + (p.lastChapterTitle || ("第" + (p.chapterIndex + 1) + "章")); item.appendChild(s); }
          item.onclick = function () { openBook(b.id, b.filename); };
          box.appendChild(item);
        });
      } catch (e) {
        var ee = document.createElement("div"); ee.className = "chap"; ee.style.color = "var(--c-fg-muted)";
        ee.textContent = "未连接服务，拖入 .txt 即可阅读。"; box.appendChild(ee);
      }
    } else {
      // drag mode: show only books with progress (greyed, hint to re-drag)
      var local2 = shelf.getShelf();
      if (local2.length === 0) {
        var ne = document.createElement("div"); ne.className = "chap"; ne.style.color = "var(--c-fg-muted)";
        ne.textContent = "拖入 .txt 开始阅读。"; box.appendChild(ne);
      }
      local2.forEach(function (s) {
        var item = document.createElement("div"); item.className = "shelf-item";
        item.textContent = s.filename + " (重新拖入关联)";
        box.appendChild(item);
      });
    }
  }

  async function openBook(bookId, filename) {
    clearErr();
    try {
      currentBook = await bookApi.open(bookId);
      $("book-name").textContent = filename || bookId;
      await renderToc();
      var p = await currentBook.load();
      var start = (p && typeof p.chapterIndex === "number") ? p.chapterIndex : 0;
      var ratio = (p && typeof p.scrollRatio === "number") ? p.scrollRatio : 0;
      await showChapter(start, ratio);
      $("sidebar").classList.add("collapsed");
    } catch (e) { showErr("打开失败: " + e.message); }
  }

  async function renderToc() {
    var box = $("toc-list"); box.innerHTML = "";
    var toc = await currentBook.getToc();
    // if volumes exist, group chapters under them; else flat
    if (toc.volumes.length > 0) {
      toc.volumes.forEach(function (v) {
        var vd = document.createElement("div"); vd.className = "vol"; vd.textContent = v.title; box.appendChild(vd);
        var end = (toc.volumes[toc.volumes.indexOf(v) + 1] || { startChapterIndex: toc.chapters.length }).startChapterIndex;
        for (var i = v.startChapterIndex; i < end; i++) addChapItem(box, i, toc.chapters[i].title);
      });
    } else {
      toc.chapters.forEach(function (c, i) { addChapItem(box, i, c.title); });
    }
  }
  function addChapItem(box, idx, title) {
    var d = document.createElement("div"); d.className = "chap"; d.dataset.idx = idx;
    d.textContent = title; d.onclick = function () { showChapter(idx, 0); };
    box.appendChild(d);
  }

  async function showChapter(n, restoreRatio) {
    if (!currentBook) return;
    var ch = await currentBook.getChapter(n);
    if (!ch) { showErr("无此章"); return; }
    currentChapter = n;
    $("chap-name").textContent = ch.title;
    var art = $("chapter-content");
    art.innerHTML = "";
    var h = document.createElement("h2"); h.textContent = ch.title; art.appendChild(h);
    ch.paragraphs.forEach(function (p) { var el = document.createElement("p"); el.textContent = p; art.appendChild(el); });
    // highlight current in toc
    [].forEach.call(document.querySelectorAll("#toc-list .chap"), function (el) {
      el.classList.toggle("current", parseInt(el.dataset.idx, 10) === n);
    });
    // scroll current into view in toc
    var cur = document.querySelector("#toc-list .chap.current");
    if (cur) cur.scrollIntoView({ block: "nearest" });
    // restore scroll ratio
    var reader = $("reader");
    reader.scrollTop = restoreRatio ? restoreRatio * (reader.scrollHeight - reader.clientHeight) : 0;
    $("drop-hint").classList.add("hidden");
    // prefetch next
    if (ch.next !== null) currentBook.getChapter(ch.next).catch(function () {});
    // nav buttons
    $("prev-chap").disabled = (ch.prev === null);
    $("next-chap").disabled = (ch.next === null);
  }

  // ---- scroll -> save progress (debounced) ----
  function onScroll() {
    if (!currentBook || currentChapter < 0) return;
    var reader = $("reader");
    var ratio = reader.scrollHeight > reader.clientHeight
      ? reader.scrollTop / (reader.scrollHeight - reader.clientHeight) : 0;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      currentBook.save(currentChapter, ratio);
      // also update shelf entry
      shelf.addToShelf({ bookId: currentBook.id, filename: $("book-name").textContent,
        lastChapterTitle: $("chap-name").textContent });
    }, 1000);
  }

  // ---- drag & drop ----
  function setupDrag() {
    var reader = $("reader");
    document.addEventListener("dragover", function (e) { e.preventDefault(); document.body.classList.add("dragging"); });
    document.addEventListener("dragleave", function (e) { document.body.classList.remove("dragging"); });
    document.addEventListener("drop", async function (e) {
      e.preventDefault(); document.body.classList.remove("dragging");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (!/\.txt$/i.test(f.name)) { showErr("仅支持 .txt"); return; }
      clearErr();
      try {
        var buf = await f.arrayBuffer();
        currentBook = await bookApi.open({ filename: f.name, arrayBuffer: buf, bookId: "drag-" + f.name });
        $("book-name").textContent = f.name;
        await renderToc();
        var p = await currentBook.load();
        await showChapter(p && typeof p.chapterIndex === "number" ? p.chapterIndex : 0,
          p && typeof p.scrollRatio === "number" ? p.scrollRatio : 0);
        $("sidebar").classList.add("collapsed");
      } catch (err) { showErr("读取失败: " + err.message); }
    });
  }

  // ---- wiring ----
  function init() {
    try {
      $("btn-shelf").onclick = function () { $("sidebar").classList.toggle("collapsed"); };
      $("font-inc").onclick = function () { setFont(1); };
      $("font-dec").onclick = function () { setFont(-1); };
      $("theme-toggle").onclick = function () {
        var order = ["theme-dark", "theme-light", "theme-sepia"];
        var cur = order.findIndex(function (t) { return document.body.classList.contains(t); });
        document.body.classList.remove(order[cur]);
        document.body.classList.add(order[(cur + 1) % order.length]);
        $("theme-toggle").textContent = { "theme-dark": "🌙", "theme-light": "☀", "theme-sepia": "📜" }[order[(cur + 1) % order.length]];
      };
      $("prev-chap").onclick = function () { if (currentChapter > 0) showChapter(currentChapter - 1, 0); };
      $("next-chap").onclick = function () { showChapter(currentChapter + 1, 0); };
      $("refresh-shelf").onclick = renderShelf;
      $("reader").addEventListener("scroll", onScroll, { passive: true });

      // keyboard: left/right = prev/next chap
      document.addEventListener("keydown", function (e) {
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
        if (e.key === "ArrowLeft" && currentChapter > 0) showChapter(currentChapter - 1, 0);
        if (e.key === "ArrowRight") showChapter(currentChapter + 1, 0);
      });

      setupDrag();
      renderShelf();
    } catch (e) { showErr("初始化失败: " + e.message); }
  }

  function setFont(delta) {
    var root = document.documentElement;
    var cur = parseInt(getComputedStyle(root).getPropertyValue("--font-size"), 10) || 17;
    cur = Math.max(12, Math.min(28, cur + delta));
    root.style.setProperty("--font-size", cur + "px");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
```

- [ ] **Step 2: 提交**

```bash
git add reader/reader.js
git commit -m "feat(reader): 主控胶水 reader.js (书架/目录/章节/进度/拖拽/主题/字号)"
```

---

## Task 11: reader README（`reader/README.md`）

**Files:**
- Create: `reader/README.md`

- [ ] **Step 1: 写说明**

创建 `reader/README.md`：

```markdown
# reader/ — ZCode 小说阅读器前端

纯前端 SPA，两种运行模式：

## http 模式（推荐）
启动 `bin/reader-server.bat` 后，在 ZCode 浏览器面板访问
`http://localhost:17890/reader`。从书架选书即用。

## file 模式（兜底）
直接用 `file:///.../reader/index.html` 打开（拖入 .txt 阅读）。
此模式下书架只显示有进度的条目（localStorage 持久），新书靠拖拽。

## 浏览器调试
reader 的纯逻辑模块可在普通浏览器或 Node 跑：
- `lib/codec.js` / `lib/toc.js` / `lib/progress.js` 都有对应 `test/reader*webtest.cjs`
- `lib/book.js` 是薄适配层，靠端到端覆盖

直接在浏览器开 `reader/index.html`（file://）+ 拖入 `凡人修仙传.txt` 即可调试。
```

- [ ] **Step 2: 提交**

```bash
git add reader/README.md
git commit -m "docs(reader): reader/ README (双模式说明 + 调试方法)"
```

---

## Task 12: 启动脚本（`bin/reader-server.bat`）

**Files:**
- Create: `bin/reader-server.bat`

**约束**（AGENTS.md）：ASCII-only、CRLF 行尾、`WP_ROOT=%~dp0..`、块内 echo 用 `^(rc^)` 转义。

- [ ] **Step 1: 写 .bat**

创建 `bin/reader-server.bat`（注意：用编辑器存成 **CRLF**，下面是内容）：

```bat
@echo off
chcp 65001 >nul
setlocal
title ZCode Reader Server

REM ============================================================
REM  ZCode Wallpaper - novel reader HTTP server launcher.
REM  ----------------------------------------------------------
REM  Starts lib/reader-server.cjs in a persistent window. The
REM  server scans novels/*.txt and serves the reader SPA + API.
REM  Close this window to stop the server.
REM  ASCII-only in this .bat (node prints Chinese itself).
REM ============================================================

echo [reader] Checking for Node.js ...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [reader] Node.js not found.
  echo [reader] Please install Node.js LTS ^(v18+^) from https://nodejs.org
  echo.
  pause
  exit /b 1
)

set "WP_ROOT=%~dp0.."
echo [reader] Starting reader server ^(persistent window^) ...
echo [reader] Close this window to stop it.
echo.

REM  Start in a NEW persistent window so the menu is not blocked.
REM  reader-server.cjs prints the URL + writes it to the clipboard.
start "ZCode Reader Server" cmd /k node "%WP_ROOT%\lib\reader-server.cjs"

echo [reader] Server launched in a separate window.
echo [reader] ^(It printed the URL and copied it to your clipboard.^)
endlocal
```

- [ ] **Step 2: 验证 CRLF 行尾**

Run:
```bash
node -e "var b=require('fs').readFileSync('bin/reader-server.bat'); var lf=(b.toString('utf8').match(/[^\r]\n/g)||[]).length; var crlf=(b.toString('utf8').match(/\r\n/g)||[]).length; console.log('CRLF:',crlf,' bareLF:',lf);"
```
Expected: `CRLF: <n>  bareLF: 0`（bareLF 必须为 0；CRLF > 0）

如果 bareLF > 0，用 PowerShell 转 CRLF：
```bash
node -e "var p='bin/reader-server.bat'; var fs=require('fs'); var s=fs.readFileSync(p,'utf8').replace(/\r?\n/g,'\r\n'); fs.writeFileSync(p,s);"
```
再跑 Step 2 的验证命令确认 bareLF=0。

- [ ] **Step 3: 验证 server 真能起来（真机 dry-run）**

Run:
```bash
mkdir -p novels && node lib/reader-server.cjs
```
Expected: 打印 `[reader] 服务已启动: http://127.0.0.1:17890/reader` + 书单 + 剪贴板提示。Ctrl+C 停。

（此时 `novels/` 是空的，会打印"共加载 0 本书"——正常。）

- [ ] **Step 4: 提交**

```bash
git add bin/reader-server.bat
git commit -m "feat(reader): 启动脚本 reader-server.bat (ASCII+CRLF, 独立常驻窗口)"
```

---

## Task 13: 资源占位 + .gitignore（`novels/`）

**Files:**
- Create: `novels/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: 加 .gitkeep**

创建 `novels/.gitkeep`（空文件）：
```bash
mkdir -p novels && touch novels/.gitkeep
```

- [ ] **Step 2: 改 .gitignore**

在 `.gitignore` 末尾追加（仿 `wallpapers/*` 惯例）：

```
# Novel text files (private content, never commit).
novels/*
!novels/.gitkeep
```

- [ ] **Step 3: 验证 novels/.txt 不会被提交**

把样本 txt 放进 `novels/`：
```bash
cp 凡人修仙传.txt novels/ 2>/dev/null; git status --short | grep -i novels || echo "novels 内容被忽略 ✓"
```
Expected: 只看到 `novels/.gitkeep`（新增，未跟踪），txt 不出现。如果 txt 出现，说明 .gitignore 规则没生效，检查。

- [ ] **Step 4: 提交**

```bash
git add novels/.gitkeep .gitignore
git commit -m "chore(reader): novels/ 占位 + gitignore (私有不提交)"
```

---

## Task 14: package.json 集成

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 改 test 链 + 加 reader 脚本**

把 `package.json` 的 `scripts` 改为：

```json
"scripts": {
  "inject": "node lib/inject.cjs",
  "inject:video": "node lib/inject.cjs --video",
  "remove": "node lib/inject.cjs --remove",
  "setup": "node lib/setup.cjs",
  "reader": "node lib/reader-server.cjs",
  "test": "node test/selftest.cjs && node test/cdp-mock-test.cjs && node test/cdp-retry-test.cjs && node test/setuptest.cjs && node test/resizetest.cjs && node test/probetest.cjs && node test/menutest.cjs && node test/transparenttest.cjs && node test/readertoctest.cjs && node test/readercodectest.cjs && node test/readercodetestweb.cjs && node test/readertocwebtest.cjs && node test/readerprogresstest.cjs && node test/readerservertest.cjs"
},
```

- [ ] **Step 2: 跑全套测试**

Run: `npm test`
Expected: 全部 PASS（含新增 6 个 reader 测试）

- [ ] **Step 3: 提交**

```bash
git add package.json
git commit -m "chore(reader): package.json 加 reader 脚本 + test 链含 6 个 reader 测试"
```

---

## Task 15: 菜单集成（场景 11/12）

**Files:**
- Modify: `lib/menu.cjs`
- Modify: `test/menutest.cjs`
- Modify: `wallpaper.bat`

- [ ] **Step 1: menu.cjs 加场景 11/12**

在 `lib/menu.cjs` 的 `SCENARIOS` 数组末尾（场景 10 之后）追加：

```js
  {
    key: "11",
    title: "启动小说阅读器",
    desc: "开一个常驻服务，去 ZCode 浏览器面板打开 reader（边写边看小说）",
    calls: "reader-server",
  },
  {
    key: "12",
    title: "阅读器使用说明",
    desc: "怎么看小说、怎么拖书、URL 怎么填（不启动服务）",
    calls: "reader-help",
  },
```

- [ ] **Step 2: 先更新 menutest 期望（让它失败），再让它过**

打开 `test/menutest.cjs`，找到现有断言场景数量的地方（如检查 10 个场景或 `key: "10"` 的最后一项），追加对 11/12 的检查。具体看现有 menutest.cjs 的结构，**仿照 7/8 视频场景、9/10 透明场景的断言写法**，加：

- 场景总数 = 12（原 10）
- 每个新场景的 title/desc/calls 关键词出现
- `reader-server` / `reader-help` 这两个 calls 至少出现一次

Run: `node test/menutest.cjs`
Expected: 先 FAIL（断言了 12 但只有 10），改完 menu.cjs 后 PASS。

（如果 menutest 用的是"每个 calls 关键词至少出现一次"的宽松检查，加 `reader-server` 到关键词列表即可。）

- [ ] **Step 3: menutest 通过后，改 wallpaper.bat 转发**

打开 `wallpaper.bat`，找到处理 `1`-`10` 各场景的 dispatch（通常是 `if "%CHOICE%"=="1"` ... 的链或 `call`）。仿场景 7/8（视频）的写法，加：

```bat
if "%CHOICE%"=="11" (
  call "%~dp0bin\reader-server.bat"
  goto menu
)
if "%CHOICE%"=="12" (
  node -e "console.log('...帮助文本...')"
  pause
  goto menu
)
```

场景 12 的帮助文本用 node 打印中文（仿 menu.cjs 的 ASCII bat 约束）：
```bat
if "%CHOICE%"=="12" (
  node -e "const s=['小说阅读器使用说明：','','1. 启动：选场景 11（或双击 bin/reader-server.bat）','2. 把 .txt 放进 novels/ 目录','3. 启动后 URL 自动复制到剪贴板','4. 在 ZCode 右侧浏览器面板粘贴回车','5. 从书架选书，或直接拖 .txt 进面板','6. 关闭服务窗口即停止','','快捷键：←/→ 翻章，滚轮滚正文']; console.log(s.join('\n'));"
  pause
  goto menu
)
```

- [ ] **Step 4: 跑 menutest 通过**

Run: `node test/menutest.cjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/menu.cjs test/menutest.cjs wallpaper.bat
git commit -m "feat(menu): 场景 11 启动阅读器 / 12 使用说明 (+menutest 断言)"
```

---

## Task 16: 真机验证（spec §2 待验项 3-6）

**这是单测验不到的胶水/OS/Electron 行为（AGENTS.md 教训 13/15）**。必须真跑。

- [ ] **Step 1: server 起来 + 放书**

```bash
mkdir -p novels && cp 凡人修仙传.txt novels/ && node lib/reader-server.cjs
```
Expected: 打印加载了 1 本书（2004 章），URL 写剪贴板。

- [ ] **Step 2: webview 加载 `http://localhost:17890/reader`（待验项 3）**

在 ZCode 浏览器面板粘贴 URL 回车。
Expected: 看到书架里有"凡人修仙传.txt"，点开能看到目录 + 正文。

**如果失败**：记录现象。可能原因：webview 对 localhost 高端口的限制 → 试关掉 webview 的 CSP / 换端口。降级方案见 spec §11。

- [ ] **Step 3: 拖拽 `.txt` 能拿到 File（待验项 4）**

在 file:// 模式（浏览器直接开 `reader/index.html`）或 http 模式下，把 `凡人修仙传.txt` 拖进阅读区。
Expected: 正常加载、显示目录和正文。

**如果失败**：webview 禁了拖拽。降级：reader 只走 server 模式（spec §11 已写明）。

- [ ] **Step 4: localStorage 持久化（待验项 5）**

在 webview 里读到某章某位置，关掉 ZCode，重开，重连 server/重开 reader。
Expected: 自动跳回上次章节 + 位置。

**如果失败**：partition 不是真 persist，或 webview 清了 storage。降级：进度只在单次会话有效。

- [ ] **Step 5: 剪贴板 URL 粘贴（待验项 6）**

启动 server 后立即去 ZCode 面板 Ctrl+V。
Expected: 粘出 `http://localhost:17890/reader`。

- [ ] **Step 6: 把验证结果写进 spec 的待验清单**

编辑 `docs/superpowers/specs/2026-06-19-novel-reader-design.md` 的 §2 待验清单，把 3-6 项的 ⬜ 改成 ✅（通过）或 ❌（失败 + 降级说明）。

- [ ] **Step 7: 提交验证结果**

```bash
git add docs/superpowers/specs/2026-06-19-novel-reader-design.md
git commit -m "docs(reader): spec §2 真机验证结果 (待验项 3-6)"
```

---

## Task 17: README 加小说阅读器章节

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 在 README 功能列表 + 文件说明 + 故障排查加内容**

在 `README.md` 的功能列表（"## 功能"段）加一条：
```markdown
- **小说阅读器**：在 ZCode 浏览器面板里看本地 .txt 小说，两级目录（卷/章）、滚动阅读、书架多本、进度记忆。
```

在功能详细介绍段（视频壁纸、窗口透明之后）加一节 `## 6. 小说阅读器`：

```markdown
## 6. 小说阅读器（边写边看）

第四种能力，和前三种**完全独立**：不注入 CSS、不改窗口透明度，而是启动一个本地
HTTP 服务，在 ZCode 自带的**浏览器面板**里打开一个阅读器网页。

### 用法

1. 把 `.txt` 小说放进 **`novels/`**（`.gitignore` 已忽略，私人内容不提交）
2. 双击 `wallpaper.bat`，选 **`11 启动小说阅读器`**（或直接双击 `bin/reader-server.bat`）
3. 服务启动后 URL 自动复制到剪贴板
4. 在 ZCode 右侧**浏览器面板**粘贴 URL 回车（面板和编辑器并排，可拖分割条调宽窄）
5. 从书架选书，或直接把 `.txt` 拖进阅读区

### 功能

- 两级目录（卷/章），2000+ 章可滚动，当前章高亮
- 滚动阅读，←/→ 翻章，滚到底预取下一章
- 书架多本管理，每本独立进度（章 + 章内位置）
- 字号、主题（暗/亮/护眼）、编码手动切换（UTF-8/GB18030）
- GB18030 自动识别（中文 txt 无 BOM 是常态）

### 编码

中文 `.txt` 多是 GB18030 编码（无 BOM）。阅读器自动检测：BOM → 严格 UTF-8 验证 →
GB18030 兜底。识别可疑的书带 ⚠️ 标记，顶栏可手动切编码。
```

在文件说明表加：
```markdown
| `bin/reader-server.bat` | 启动小说阅读器服务（常驻，关窗即停） |
| `lib/reader-server.cjs` | 阅读器 HTTP server（扫 novels/、章节切分、API） |
| `lib/reader-codec.cjs` | 编码检测（BOM/fatal-UTF8/GB18030） |
| `lib/reader-toc.cjs` | 章节切分（卷/章正则 + 兜底） |
| `reader/` | 阅读器前端 SPA（HTML/CSS/JS，双模式） |
| `novels/` | **放你的 .txt 小说**（`.gitignore` 已忽略） |
```

在故障排查表加：
```markdown
| 阅读器打不开 | 确认服务窗口还开着；确认 URL 端口对（端口冲突会自动 +1）；直接双击 `bin/reader-server.bat` 看输出 |
| 乱码 | 顶栏编码下拉手动切 UTF-8/GB18030；带 ⚠️ 的书自动检测可疑 |
| 进度丢了 | webview 的 localStorage 在 persist partition 下应持久；ZCode 重装/清缓存会丢 |
| 章节识别错 | 阅读器按"第X章"独占行切分。非此格式的书整文当一章显示 |
```

- [ ] **Step 2: 提交**

```bash
git add README.md
git commit -m "docs(readme): 加小说阅读器章节 (用法/功能/编码/故障排查)"
```

---

## Task 18: AGENTS.md 加子系统说明

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 在 AGENTS.md 加一节"小说阅读器"（对称视频/透明章节）**

在窗口透明模式章节之后，加：

```markdown
---

## 小说阅读器（在 ZCode 里看小说）

第四种能力。和前三种**完全不同层**：图片/视频是 CDP 注入渲染层，透明是原生窗口层，
阅读器是**独立子应用**——本地 HTTP server + 前端 SPA，ZCode 自带浏览器面板加载它。
**不走 CDP，不碰 inject.cjs，不改 ZCode 任何状态**。

### 为什么不复用 CDP 注入

CDP 注入是把 DOM/CSS 塞进 ZCode 主页面。阅读器需要的是"一个完整独立的阅读环境"
（书架、目录、滚动、进度），塞进 ZCode 主页面会有事件穿透/层级/localStorage 污染问题。
而 ZCode **自带浏览器面板**（Electron `<webview>`，`data-testid="browser-webview`，
`partition="persist:zcode-embedded-browser"`）正好是独立渲染进程、独立 storage——
**用它加载本地 reader URL 是天然隔离的容器**。这是真机探出来的，不是设计猜的
（见核心教训：真机数据推翻先验假设）。

### 三组件，互不耦合

- `lib/reader-server.cjs` — HTTP server，扫 `novels/`、章节切分、供 API。**不依赖 inject.cjs**
- `reader/` — 前端 SPA，双模式（`http:` 走 server fetch，`file:` 走拖拽兜底）
- `bin/reader-server.bat` — 独立常驻入口，不进 `wallpaper.bat` 的用完即走流程

### 双模式设计（server 主 + 拖拽兜底）

reader 检测 `location.protocol`：
- `http:` → fetch `/api/...`（完整书架、自动重连）
- `file:` → 拖拽 `.txt` + FileReader（server 没启时的退化，永远能用）

**拖拽是否在 webview 里可用**是真机验过的（spec §2 待验项 4）。不通则退化到"只能 server 模式"。

### 章节切分在 server 不在前端

761 万字不能全量塞 DOM。server 启动时一次性解码 + 正则切章（卷/章两级），
只把"当前章的段落数组"发给前端。前端永远只持有一章。

### 编码：fatal UTF-8 是关键

中文 txt 无 BOM、GB18030 为主。区分 UTF-8 vs GB18030 的决定性手段是
`new TextDecoder('utf8',{fatal:true})`——非严格 UTF-8 解 GBK 会得一堆 U+FFFD 但不报错，
fatal 模式第一个非法字节就抛，捕获后转 GB18030。**前后端各一份 codec**
（server `lib/reader-codec.cjs` + 前端 `reader/lib/codec.js`），跨环境无法共享代码，
靠**同一套测试用例**（`readercodectest.cjs` + `readercodetestweb.cjs`）钉一致。
这是核心教训 12（跨环境胶水靠共享测试）的直接应用。

### server 端口冲突自增

`EADDRINUSE` 时自动 +1（17890→17891…最多 5 次）。**剪贴板必须在 listen 成功后写**
（拿到实际端口），否则会写进去被占的旧端口——这是 spec 自审抓到的时序约束。
`readerservertest.cjs` 专门钉死这个回归（占一个端口再起 server，验它换到 +1）。

### 不偷偷后台常驻

`reader-server.bat` 用 `start "..." cmd /k node ...` 开**独立可见窗口**。关窗即停。
不学某些工具的"装完偷偷开机自启"——显式常驻、显式停止。
```

- [ ] **Step 2: 在核心教训段补一条（教训 4 之类）**

在 AGENTS.md 的"核心教训"区域末尾加（编号续）：

```markdown
### 规则补丁（抄进脑子里）

16. **"在 X 里看 Y"先查 X 有没有原生容器**。想在 ZCode 里看小说，第一反应不该是
    "CDP 注入浮层"，而是"ZCode 有没有浏览器/webview 面板"。这次靠真机探测发现
    `data-testid="browser-webview"` 的内置浏览器面板能加载本地 URL，直接把复杂度
    降了一个数量级。教训 1（先验假设错了全白干）和教训 11（理论打架信事实）的同型应用。
17. **跨环境共享代码不能时，共享测试**。server（Node）和前端（浏览器）各写一份 codec/toc，
    没法共用代码（运行时不同）。但能用**完全相同的测试用例**钉死两边行为一致。
    单测只覆盖单语言内的纯函数，跨环境胶水（这次是 codec 的两份实现）必须靠
    "同一套断言跑两份代码"来覆盖——否则一边改了另一边不知道（教训 12 同型）。
```

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md
git commit -m "docs(AGENTS): 小说阅读器子系统说明 + 教训 16/17 (先查原生容器/跨环境共享测试)"
```

---

## Task 19: 全量回归 + 清理

- [ ] **Step 1: 跑全套测试**

Run: `npm test`
Expected: 全绿（含新增 6 个 reader 测试 + menutest 的新断言）

- [ ] **Step 2: 检查未跟踪文件**

Run: `git status --short`
Expected: `scripts/inspect-*.cjs`（调研产物，按用户意愿处理）+ 无意外文件。
`凡人修仙传.txt` 应在 `novels/`（被忽略）或根目录（不该提交——如还在根目录，移到 novels/）。

- [ ] **Step 3: 清理调研脚本（可选，问用户）**

`scripts/inspect-sidebar.cjs` / `inspect-webview.cjs` / `inspect-panels.cjs` 是这次调研的产物。
问用户：保留（作为以后调试 ZCode 结构的工具）还是删除？默认建议保留（对称已有的 `inspect.cjs`）。

- [ ] **Step 4: 最终提交（如有清理）**

```bash
git add -A
git commit -m "chore(reader): 全量回归通过 + 调研脚本归档"
```

---

## 完成判据

- [ ] `npm test` 全绿（含 6 个新 reader 测试）
- [ ] `bin/reader-server.bat` 能启动，打印 URL + 写剪贴板
- [ ] ZCode 浏览器面板能加载 `http://localhost:17890/reader` 并显示书架
- [ ] `凡人修仙传.txt` 能打开，目录 12 卷 2004 章正确分级，正文 GB18030 正确解码
- [ ] 滚动存进度，重开能续上（如 localStorage 持久化验通）
- [ ] 字号/主题/编码切换工作正常
- [ ] ←/→ 翻章工作正常
- [ ] 拖拽模式（file://）能加载（如 webview 支持拖拽）
- [ ] spec §2 待验项 3-6 全部标 ✅ 或 ❌（+ 降级说明）
- [ ] README + AGENTS.md 更新
```
