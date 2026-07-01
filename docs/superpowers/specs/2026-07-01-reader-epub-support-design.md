# 设计稿：小说阅读器 epub 支持

**日期**：2026-07-01
**状态**：待实现（spec 已与用户逐段确认：架构定位 / 库选型+加载流程 / XSS防护+资源托管 / 前端渲染 / 测试+改动清单 共 5 节）
**作者**：brainstorming 会话产出
**分支**：`feat/reader-epub`

---

## 1. 目标

在现有小说阅读器（只支持 `.txt`）的基础上，**新增 epub 格式支持**。用户把 `.epub` 放进
`novels/`，server 启动时和 `.txt` 一起扫描加载，前端像看 txt 一样看 epub。

### 起因（用户原话）

> 当前的小说阅读器是不是只支持 txt 格式，我想也支持 epub 格式

### 现状确认（已探测，非假设）

当前阅读器**只支持 `.txt`**，证据：
- `reader/reader.js:195` 拖拽兜底硬判 `if (!/\.txt$/i.test(f.name)) { showErr("仅支持 .txt"); return; }`
- `lib/control-server.cjs:34` `buildLibrary()` 扫 `novels/` 时 `if (!/\.txt$/i.test(name)) continue`
- `lib/reader-codec.cjs` 整套是"区分 UTF-8 vs GB18030"的纯文本编码探测，对 epub 的 zip 容器无效

### epub vs txt：本质差异（不是改 codec 能解决的）

| 维度 | txt | epub |
|---|---|---|
| 容器 | 纯文本 | **zip 压缩包** |
| 内部结构 | 无 | `META-INF/container.xml` → OPF → spine → 每章一个 XHTML |
| 目录 | 靠正则猜（本项目 `reader-toc.cjs` 踩过 86 本批量坑） | **结构化内建**（NCX / nav），不用猜 |
| 编码 | UTF-8/GB18030 探测 | XHTML 强制 UTF-8 |
| 章节 | 自己切 | 已分章（按 spine） |
| 图片/排版 | 无 | 有（CSS、内嵌图） |

### 核心定位（用户确认的三个决策）

1. **呈现保真**：**保留 HTML 片段**（每章返回 sanitize 后的原始 XHTML，保 CSS + 图片 + 排版）。
   - 连带后果：要 sanitize 防 XSS、要托管 CSS、要托管 + 改写图片 src。
2. **依赖**：**用 epub 解析库**（不自己写 OPF/NCX 解析）。
   - 连带后果：加 1 个 epub 库依赖；spec 阶段必须真调研库选型（教训 21：Node epub 库普遍年久失修，不能凭印象拍）。
3. **拖拽兜底**：**epub 仅 server 模式**（拖拽兜底仍只认 `.txt`）。
   - 连带后果：省一套浏览器端 zip 解析；epub 必须放 `novels/` 由 server 加载。

### 架构总原则

**epub 支持是 reader 子系统的新增输入格式，不是新子系统。** reader 现有三组件骨架不动——
只做"加一条 epub 解析路径"。txt 路径一行不改（含编码探测、parseTOC、前言/后记识别、批量
86 本调过的正则全保留），避免回归。对齐项目"控制中心是触发器+状态显示器、不重写动作逻辑"
的精神——这里是"reader 加输入格式、不重写 reader 架构"。

### 显式非目标（YAGNI）

- **不**改 txt 路径任何代码（编码探测/parseTOC/前言后记全保留）
- **不**在拖拽兜底模式支持 epub（仅 server 模式）
- **不**做三级以上目录嵌套（现有前端已支持卷>章两级，epub 三级以上降级到两级）
- **不**做 DRM 解密（加密 epub 跳过）
- **不**预加载所有章节 XHTML（懒加载，防爆内存）
- **不**做 LRU 缓存淘汰（YAGNI，真爆了再加）
- **不**处理 epub 外链图片/资源（webview 自己决定能不能加载）
- **不**做 Shadow DOM（初版用 CSS scope 前缀，列为可选优化）

---

## 2. 架构定位与子系统归属（设计第 1 节，已确认）

### 核心原则

epub 的差异**完全封装在 server 端**，前端只在"章节内容渲染"一处分派。

- `lib/control-server.cjs` 的 `buildLibrary()` 现在**只扫 `.txt`**（第 34 行）。
  改动：让它**同时扫 `.epub`**，txt 走老路径，epub 走新路径。
- `bookIdFor(filename)` **不改**——epub 文件名照样 hash 成 `bXXXX`，和 txt 同一个 id 空间。
  **关键**：书架/进度（localStorage）天然通用，不为 epub 单开一套。
- 前端 `reader/lib/book.js` 的 `openHttp(bookId)` **接口不变**——只调
  `/api/book/:id/toc` 和 `/api/book/:id/chapter/:n`，server 返回什么消费什么。

### library 数据结构的统一

现在 `lib.set(id, {id, filename, sizeBytes, encoding, encodingSuspect, toc, text})`。
epub 不切成单个大 `text`（它按 spine 切成多章 XHTML）。改动：

- 加 `format` 字段（`"txt"` / `"epub"`）。
- txt 条目保持原样（补 `format:"txt"`）。
- epub 条目结构（初稿，第 3 节细化）：
  ```js
  {
    id, filename, sizeBytes, format: "epub",
    toc: { chapters: [...], volumes: [...] },  // 形状对齐 txt 的 toc 结构（见下）
    spine: [{ href, title, xhtmlCache }],       // 按 OPF spine 顺序，懒加载
    resources: { css: {...}, images: {...} },   // manifest 非 spine 资源索引
    rawZipHandle: <库提供的句柄>,
  }
  ```
- 章节 API 按 `format` 分派响应（第 4 节）。

**toc 结构必须对齐 txt 现有形状**（自审抓到，已核实 `lib/reader-toc.cjs` + `reader/reader.js:86-93`）：
```js
toc = {
  chapters: [{ title, startOffset, endOffset }],  // txt 用 startOffset/endOffset 切 text
  volumes: [{ title, startChapterIndex }]          // 卷>章两级，前端已支持渲染（reader.js:86-93）
}
```
epub 的 toc **复用这个形状**：
- `chapters[i]` 对应 spine 第 i 项；epub 不用 `startOffset/endOffset`（它是懒加载 XHTML，不是切大
  text），这两个字段 epub 条目里置 `null` 或省略——前端目录渲染只用 `title` 和索引，不读 offset
  （`reader.js:89-93` 遍历靠 `startChapterIndex` 和 `chapters.length`）。
- `volumes`：epub NCX/nav 原生支持多级目录（卷>部>章）。现有前端已支持卷>章两级渲染，epub 的
  嵌套目录**尽量映射到 volumes + chapters**（一级映射 volumes，二级映射 chapters），不拍平。
  epub 三级以上嵌套降级到两级（YAGNI，初版）。

### 为什么这样定位

bookId 共用 + toc 形状统一 + 前端接口不变 = epub 的差异收敛在 server 端的 buildLibrary 和
chapter 端点。书架/进度/翻页/目录渲染全部零改动。

---

## 3. 库选型 + library 加载流程（设计第 2 节，已确认）

### 3.1 库选型（已 spike 验证，2026-07-01）

**库已选定并真机验证通过**（spec §10 要求的第一步已做）：

- **epub 解析库：`@likecoin/epub-ts`**（v0.6.7，2026-06 仍在更新，是 epubjs 的 Node-capable 维护分支）。
  唯一同时满足"原始 XHTML + NCX&nav + spine + manifest 枚举 + 维护活跃"的候选。`epub2`/`epub` 不行（NCX-only，
  不支持 epub3 nav-only 书）；`@lingo-reader/epub-parser` 不行（只给处理后 HTML，不给原始 XHTML）。
- **sanitize 库：`sanitize-html`**（Node 端主流，白名单 + transformTags 一次遍历完成 sanitize + src 改写）。

**spike 验证的真实 API（实现按这个写，不要信文档/调研的二手描述——教训 21）**：

| 能力 | 真实 API（已 spike 跑通） |
|---|---|
| 加载 | `const {Book} = require("@likecoin/epub-ts/node"); const book = new Book(arrayBuffer); await book.opened;` |
| 拿原始 XHTML（含 XSS 探针，lib 不净化） | **不用 `archive.request`**（对二进制/某些路径返回乱码）→ 用底层 jszip：`book.archive.zip.file(zipPath).async("string")` |
| 读 CSS（字符串） | 同上 `zip.file(cssZipPath).async("string")` |
| 读图片（二进制） | `zip.file(imgZipPath).async("arraybuffer")`（PNG 签名验证通过） |
| **路径解析命门** | `book.resolve("images/red.png")` → `"/OEBPS/images/red.png"`（带前导 `/`），**必须 `.replace(/^\//,"")` 去掉**给 jszip |
| 目录（NCX + nav 自动识别） | `book.navigation.toc` → `[{label, href, subitems}]` |
| spine 顺序 | `book.spine.each(section=>section.href)`；`book.spine.first()`/`.get(i)` |
| manifest 枚举（白名单基础） | `Object.values(book.packaging.manifest)` 每项 `{href, "media-type"}`（href 是 OPF 相对，需 resolve） |

**关键纠偏（调研 API 不可信，教训 21 直接体现）**：subagent 调研给的 `book.archive.request(href,"string")` API 对二进制资源返回乱码字符串（len=69 的损坏 PNG）。**生产路径必须用 `book.archive.zip`（底层 jszip 实例）直接读**，并把 `book.resolve()` 的结果 `replace(/^\//,"")` 去前导斜杠。这一步如果跳过直接按调研 API 写代码会全部白写——正是 spec §10"实施第一步是验库"的价值。

**sanitize-html 配置（已 spike 验证）**：白名单 `allowedTags` + `allowedAttributes` + `allowedSchemes:["http","https"]`（挡 javascript:）+
`transformTags.img` 改写 src 到 `/api/book/:id/asset?href=encoded`。一次遍历同时完成剥 XSS（script/onerror/iframe/style 属性）+ 保留正文 + src 改写。

### 3.1a 依赖列表（净增 2 + 1 传递依赖）

- `@likecoin/epub-ts` —— epub 解析（peer dep `linkedom`，Node 端替代浏览器 DOM）
- `sanitize-html` —— XSS sanitize + src 改写
- （`linkedom` 作为 epub-ts 的 peer dep 一并装）

### 3.2 library 加载流程（双格式分派）

```
buildLibrary():
  扫 novels/：
    .txt → 老路径：detectEncoding + decode → parseTOC(text) → lib.set(id, {format:"txt", ..., text})
    .epub → 新路径：epubLoad(fullPath) → {toc, spine, resources} → lib.set(id, {format:"epub", ..., spine, resources})
    其他扩展 → skip
```

### 3.3 epub 条目内存结构

```js
{
  id, filename, sizeBytes, format: "epub",
  toc: { chapters: [...], volumes: [...] },  // 形状对齐 txt 的 toc（见 §2 toc 结构说明）
  spine: [{                             // 按 OPF spine 顺序
    href,                               // zip 内 XHTML 路径
    title,                              // 章节标题（toc 没给则从 XHTML <title>/<h1> fallback）
    xhtmlCache: null | "字符串",        // 懒加载，首次请求章节才解
  }],
  resources: {                          // manifest 所有非 spine 资源的索引（路径穿越白名单基础）
    css: { "OEBPS/css/main.css": "zipEntryPath" },
    images: { "OEBPS/images/cover.jpg": "zipEntryPath" },
  },
  rawZipHandle: <库提供的句柄/缓存>,     // 用于按 href 读 CSS/图片字节
}
```

### 3.4 懒加载

epub 在 `buildLibrary` 时**只解析目录 + spine 索引**，不解所有 XHTML（一本几百章全解内存爆）。
`/api/book/:id/chapter/:n` 首次请求时才从 zip 取对应 XHTML、sanitize、缓存。

**懒加载的代价**：每次取章要重开 zip 句柄（或持有句柄）。spec 阶段看库支不支持
"打开一次、多次按 entry 取内容"——支持就缓存句柄，不支持就每次开（几百 KB epub 重复打开可接受）。

### 3.5 和 txt 的对齐点

- `toc` 形状统一 `{chapters, volumes}`——前端目录渲染代码零改动（含卷>章两级渲染）。
- 章节索引 `:n` 都是 spine/段落顺序的整数，前端翻页逻辑零改动。
- 唯一差异在 `/api/book/:id/chapter/:n` 的**响应体**（第 4 节）。

### 3.6 加载错误处理（对称 txt `readFileSync` 失败处理）

- 加密/DRM epub：解不开 → try/catch 跳过 + log（不致命，其他书正常加载）。
- 破损/非标准 epub：同上跳过。

---

## 4. XSS 防护 + CSS/图片托管（设计第 3 节，已确认）

**整个设计里风险最高、工作量最大的一节。** 三条 txt 路径完全没有的新链路，都是安全敏感的，
思路和书签管理那套"协议白名单防 XSS"同型（教训 17/27）。

### 4.1 三条新链路概览

| 链路 | txt 有没有 | epub 要做的 | 风险 |
|---|---|---|---|
| **XHTML sanitize** | 无 | 剥 `<script>/<iframe>/on*=`/危险标签 | **XSS 命门** |
| **CSS 托管** | 无 | epub css 供出来 + 注入 | CSS 注入（`expression()`/`@import`/`url()`） |
| **图片托管 + src 改写** | 无 | epub 图片供出来 + 改写 `<img src>` | 路径穿越（`../../etc/passwd`） |

txt 路径完全不碰这三条（txt 是纯文本，前端只渲染段落），所以 epub 的安全面**不会污染 txt**。

### 4.2 XSS sanitize（最关键）

epub 里的 XHTML 是**从网上下载的外部内容**，可能有 `<script>`、`<img onerror=...>`、`<iframe>`。
前端**绝不能**直接 `innerHTML`。

**在哪做**：**server 端**，在 `/api/book/:id/chapter/:n` 返回前。理由：
1. 一次到位，前端拿到的就是干净 HTML，信任边界收敛在 server 入口。
2. server 端 sanitize 能在**同一次 DOM 遍历**里顺便做 src 改写（4.4）。
3. 前端 DOMPurify 会把信任边界推到前端，多一层出错面。

**策略：白名单**（不是黑名单）。
- 允许：段落/标题/列表/表格/图片/链接/em/i/b 等正文标签 + `class/href/src/alt/title` 等安全属性。
- 剥：`script/iframe/object/embed/style(外层标签)/form` 等 + 所有 `on*` 事件属性 + `javascript:` 协议。

**库选型（spec 阶段真调研，教训 21）**：自己写 sanitize walker 风险高（漏一个属性就 XSS），
用成熟库。候选如 `sanitize-html`（纯 JS、Node 端主流）。这是**第二个新依赖**（epub 库之外）。

**`<style>` 标签的处理**：epub 章节内联的 `<style>` 块剥掉（CSS 走 4.3 的托管路径，不内联），
避免内容 CSS 绕过托管 sanitize。

### 4.3 资源托管端点（CSS + 图片统一）

新端点 `/api/book/:id/asset?href=<urlencoded 包内路径>`：
- 从 epub zip 按 `href` 取条目字节。
- **路径穿越防护**：`href` 必须**严格等于** `buildLibrary` 时登记进 `resources.css` /
  `resources.images` 的某个 key。不在白名单里的 `href` → 404。挡掉 `?href=../../etc/passwd`、
  `?href=..%2F..%2F`（URL 编码绕过）等。书签"协议白名单"的同型防御。
- **MIME 必须按扩展名返**（教训 27 的直接应用）：`.css→text/css`、`.jpg→image/jpeg`、
  `.png→image/png`、`.gif→image/gif`、`.svg→image/svg+xml`。MIME 错 → webview 当下载
  （go.html 那个坑的 epub 版）。`guessMime` 要扩展，测试要断言 `Content-Type`。

**CSS 的二次 sanitize**（CSS 注入防护）：CSS 返回前剥 `expression(...)`、`@import`、`url(...)`。
CSS 里的 url 能探测/泄漏，`@import` 能拉外部资源，`expression()` 老浏览器执行 JS。

### 4.4 src 改写（一次 DOM 遍历完成三件事）

server 在 sanitize 那次 DOM 遍历里**同时**改写两类引用，指向 4.3 的端点：

```
原始 XHTML:
  <img src="images/cover.jpg">                     ← 包内相对路径
  <link rel="stylesheet" href="css/main.css">

改写后:
  <img src="/api/book/bXXX/asset?href=images%2Fcover.jpg">
  <link rel="stylesheet" href="/api/book/bXXX/asset?href=css%2Fmain.css">
```

改写后前端拿到的就是"干净 XHTML + 绝对可访问 URL"，前端不用关心路径。

**为什么放 server 不放前端**：①前端要重写一遍 DOM 遍历（两份代码，教训 17）；②sanitize 和
改写是同一次遍历，拆两边浪费。

---

## 5. 前端渲染分派（设计第 4 节，已确认）

前端唯一需要知道 epub 的地方：**章节内容怎么渲染**。其余（目录、翻页、进度、书架）零区分。

### 5.1 渲染分派点

`reader/lib/book.js` 的 `openHttp(bookId)` 拿到章节后，分派依据**在响应体不在 URL**。

server 的 `/api/book/:id/chapter/:n` 响应（自审抓到字段对齐，已核实 `control-server.cjs:211`）。
**现有 txt 响应是 `{index, title, paragraphs, prev, next}`，epub 在此基础上加 `format` 字段**：

```js
// txt 路径（现有，加 format 字段）
{ format: "txt", index: n, title: c.title,
  paragraphs: [...], prev: ..., next: ... }

// epub 路径（新增，加 format + 用 html 替代 paragraphs）
{ format: "epub", index: n, title: c.title,
  html: "<p>已 sanitize 的 XHTML 片段</p>",
  cssHrefs: ["/api/book/bXXX/asset?href=css%2Fmain.css"],
  prev: ..., next: ... }
```

`index/title/prev/next` 两个格式共用（前端翻章、章节标题显示靠这些，零区分）。差异只在内容
载体：txt 用 `paragraphs` 数组，epub 用 `html` 字符串 + `cssHrefs`。

前端按 `format` 分派：
- `txt` → 现有 `renderChapter(paragraphs)`（生成 `<p>` 列表，零改动）。
- `epub` → 新增 `renderEpubChapter(html, cssHrefs)`。

### 5.2 epub 内容容器（沙箱化，纵深防御两层）

epub 的 HTML 片段虽然 server 已 sanitize，前端渲染仍要**纵深防御**——sanitize 库可能有漏网，
或未来某 epub 用了 sanitize 库不认识的载体。

**第一层（已在 server）**：sanitize-html 白名单剥危险标签/属性（4.2）。

**第二层（前端）**：epub 内容渲染进一个**隔离容器**。

**CSS 作用域隔离**：epub 的 CSS 设计上是给"整本书"的，可能含 `body{...}` 这类全局规则——
直接注入会污染整个 reader UI（顶栏、目录、按钮全改样）。隔离方案：epub 容器加唯一 id
（如 `#epub-content`），CSS 预处理**给每条选择器加 scope 前缀**（`body{}` → `#epub-content body{}`）。
CSS scope 前缀化是 CSS 工程的成熟手法。

**JS 残留兜底**：sanitize 已剥 `<script>`，前端容器只 `innerHTML` 干净 HTML，reader 自己不引
epub 的 JS（epub 正文不该有 JS，有就是攻击）。

### 5.3 图片/资源懒加载

epub 章节里 `<img src="/api/book/.../asset?href=...">` 是普通 HTTP URL，浏览器/webview 原生
懒加载（`<img loading="lazy">` server 端可顺手加）。前端不为 epub 写单独图片加载逻辑——它就是
普通 img。CSS 同理。

### 5.4 Shadow DOM 取舍（spec 阶段定，不影响框架）

更彻底的 CSS 隔离是 Shadow DOM：epub 内容挂在 `attachShadow({mode:'open'})` 内，CSS 天然封闭。
**优点**：CSS 隔离零成本且彻底。**风险**：①阅读进度（基于 `getBoundingClientRect` 算 scroll ratio，
核心教训 5 子坑 B）——Shadow DOM 内元素滚动计算要重新验（教训 21/22：shadow 边界行为不能假设）；
②webview 对 Shadow DOM 支持要验。

**决定**：spec/实现阶段先做"scope 前缀"（稳妥、无未知），Shadow DOM 列为可选优化。如果 scope
前缀在真书上有漏（CSS 渗出污染 reader UI），再升级到 Shadow DOM。

### 5.5 与 txt 共享的部分（强调零改动）

| 功能 | 是否区分 txt/epub |
|---|---|
| 目录渲染 | **不区分**（toc 形状统一 `{title,...}`） |
| 翻章（上/下一章） | **不区分**（章节索引都是整数） |
| 阅读进度保存 | **不区分**（都是 `{chapterIndex, scrollRatio}`） |
| 书架/书签 | **不区分**（bookId 共用空间） |
| 章节内容渲染 | **区分**（txt→段落列表，epub→HTML 容器） |

只有"章节内容渲染"一个函数分派。和 server 端封装对称。

### 5.6 前端 lib 双导出

新增/改动的 `reader/lib/*` 文件沿用现有惯例：同时 `module.exports`（Node 测）和
`window.__readerXxx = {...}`（浏览器用）。这是核心教训 4 真机踩过的坑——只导 CommonJS 会导致
webview 里 undefined 崩溃。

---

## 6. 测试策略（设计第 5 节，已确认）

紧扣项目"教训 12/13：跨环境胶水必真机跑"。纯函数抽出来单测，跨进程/跨环境胶水靠真机验。

### 6.1 单测覆盖（抽纯函数）

`lib/epub.cjs`（新模块）的纯函数：
- `buildTocFromNav(ncxOrNav)` / `buildSpineIndex(opf)` —— OPF/NCX/nav → 统一 toc/spine 结构，
  给固定 XML 片段断言输出。
- `scopeCss(cssText, scopeId)` —— CSS scope 前缀化，各种选择器形式（标签/class/id/后代/`@media`）。
- `rewriteRefs(xhtml, bookId)` —— src/href 改写，相对路径/已绝对/外部 URL 的分派。
- `isAllowedAssetHref(href, resourceSet)` —— 路径穿越防护（`../../etc/passwd` 拒、白名单内放、
  URL 编码绕过 `..%2f..%2f` 拒）。

`control-server.cjs`：
- `guessMime` 扩展断言（.css/.jpg/.png/.gif/.svg → 正确 MIME，**教训 27 的直接回归**）。
- asset 端点的 Content-Type 断言（`controlservertest.cjs` 加 case：请求 `.css` asset → 响应头
  含 `text/css`，不只查 body）。

### 6.2 镜像一致性断言（教训 17 同型）

epub 的 toc 形状必须和 txt 的 toc 在前端可消费层面一致。`readertoctest.cjs`（server）已有 toc
结构断言，epub 的 toc 也过**同一套"前端消费契约"断言**（`{title, ...}` 形状、章节索引连续）。

### 6.3 真机验证清单（最关键，写进实现的"真机验证"小节）

epub 路径全是跨环境胶水：epub 库解 zip ↔ server 响应、sanitize ↔ 前端渲染、CSS scope ↔ webview
实际样式、asset 端点 ↔ webview 加载。**单测验不全，必须真机跑（教训 12/13）。** 至少覆盖：

1. **库选型阶段**：候选库能否拿原始 XHTML（拿不到反向影响保真度决策）。
2. **加载**：真 epub 放 `novels/` → server 启动 → 书架出现 → 目录正确。
3. **章节渲染**：打开 epub 章节 → 正文显示 → 图片显示 → CSS 生效（字体/缩进可见）。
4. **XSS 防护**（命门，必须真机验）：构造恶意 epub（`<script>`/`onerror=`/`javascript:`/路径穿越 href）
   → 加载后确认全被挡。单测验 sanitize 函数，真机验"恶意内容在 webview 里真被挡"。
5. **CSS 隔离**：epub CSS 不污染 reader 顶栏/目录/按钮（scope 前缀验）。
6. **进度**：epub 翻章+滚动 → 进度保存 → 重开回到原位（验 scrollRatio 在 epub 容器上也工作）。
7. **webview 兼容**：ZCode webview 实际加载 epub 章节的兼容性（教训 28：webview target 行为不能假设）。

### 6.4 固定测试 fixtures

放 `test/fixtures/`：
1. 正常 epub（有 CSS + 图片 + 多章）。
2. 恶意 epub（XSS 探针：`<script>`、`onerror=`、`javascript:`、路径穿越 href）。
3. epub3 nav-only（验 nav 目录）。
4. epub2 NCX-only（验 NCX 目录）。

---

## 7. 改动清单

### 7.1 新增文件

- `lib/epub.cjs` —— epub 解析纯函数层（OPF/spine/NCX/nav 解析、toc 构造、scopeCss、rewriteRefs、
  isAllowedAssetHref）。**纯函数，可单测**。
- `lib/epub-load.cjs`（或并入 epub.cjs）—— epub 加载胶水（调库解 zip + 调纯函数组装 library 条目）。
  胶水部分真机验。
- 测试：`test/epubtest.cjs`（纯函数）、`test/epubloadtest.cjs`（若有可纯函数化的部分）。
- 固定测试 epub 样本（`test/fixtures/`）：见 6.4。

### 7.2 改动现有文件

- `lib/control-server.cjs`：
  - `buildLibrary()` —— 加 `.epub` 扩展分派（txt 老路径不动）。
  - library 条目结构加 `format` 字段。
  - `/api/book/:id/chapter/:n` —— 按 `format` 分派响应（txt 返 paragraphs，epub 返 html+cssHrefs）。
  - 新端点 `/api/book/:id/asset` —— CSS/图片托管 + 路径穿越防护。
  - `guessMime()` —— 加 `.css/.jpg/.png/.gif/.svg`。
- `reader/lib/book.js`：`openHttp` 章节响应处理加 `format` 分派（txt 走老路，epub 调新
  `renderEpubChapter`）。
- `reader/reader.js`：新增 `renderEpubChapter(html, cssHrefs)` + epub 内容容器（`#epub-content`）。
- `reader/reader.css`：epub 容器基础样式 + scope 容器规则。
- `reader/reader.js:195`：拖拽兜底错误提示从"仅支持 .txt"改为"仅支持 .txt（epub 请放入 novels/ 由服务加载）"
  ——**明确边界**，不假装拖拽支持 epub。
- `reader/index.html`：加 `#epub-content` 容器节点（或 JS 动态创建）。
- `package.json`：加 2 个依赖（epub 库 + sanitize 库，具体名 spec 选型定）。
- `AGENTS.md`：加"小说阅读器 epub 支持"小节 + 教训补丁（库选型/真机验/XSS 防护的心得）。

### 7.3 不动（强调）

- txt 路径全套（`reader-codec.cjs`、`reader-toc.cjs` 的前言/后记/批量正则、`detectEncoding`、
  parseTOC）——一行不改。
- `bookIdFor`、书架、进度、书签、控制中心状态查询——bookId 共用，零改动。
- CDP/壁纸/透明/视频——完全不碰，epub 是 reader 子系统内的事。

---

## 8. 已知遗留

1. **加密/DRM epub**：解不开，加载时跳过 + log。
2. **破损 epub**：跳过（对称 txt `readFileSync` 失败处理）。
3. **epub 外链图片/资源**：不改写，webview 自己决定能不能加载（对称书签"外部站不在职责内"）。
4. **目录嵌套深度**：现有前端已支持卷>章两级（`reader.js:86-93`）。epub NCX/nav 三级以上
   嵌套（卷>部>分卷>章）降级到两级——多余层级折叠进 volumes 的 title 或忽略（YAGNI，初版）。
5. **内联 `<style>`**：server 剥掉，靠章节 CSS 兜底。
6. **拖拽 epub**：不支持（明确提示用户放 `novels/`）。
7. **sanitize 白名单误伤**：拿真书验，初版给宽。
8. **Shadow DOM**：列为可选优化，初版用 CSS scope 前缀。
9. **epub 库年久失修风险**：选型时筛"近 2 年有更新"，但库本身可能有未修 bug——选型文档记录权衡。
10. **大 epub 内存**：懒加载 XHTML，先不做 LRU（YAGNI，真爆了再加）。

---

## 9. 依赖净增说明

当前依赖（`package.json`）：`sharp` + `ws`。

epub 支持净增 **2 个依赖**：
1. **epub 解析库**（具体名 spec 选型阶段定，候选见 3.1）。
2. **sanitize 库**（候选 `sanitize-html`，spec 阶段定）。

这与项目"只 sharp+ws"的克制风格有偏离，但 epub 解析 + XSS sanitize 都是"自己写风险高、漏一个
就出事"的领域（OPF/NCX 解析有坑、XSS 白名单漏一个属性就中招），用成熟库符合"复用连接逻辑、
不重复造易坏的轮子"的精神。**spec 选型阶段会逐个验候选库的活跃度，死的库不用。**

---

## 10. 真机验证优先级（实施时第一步）

按教训 21/28，**实施的第一步不是写代码，是验库**。

**✅ 已完成（2026-07-01 spike）**：库选型 + API 真机验证全部通过，见 §3.1 真实 API 表。
两个库（`@likecoin/epub-ts` + `sanitize-html`）已确认满足 6 条硬指标，sanitize 对 XSS 探针的剥离
已验证。spike 发现的"用 `book.archive.zip` 直读、`resolve()` 去前导斜杠"命门已记录进 §3.1。

**实施时仍需真机验的（跨环境胶水，单测验不全，教训 12/13）**——这部分不能在 spec 阶段提前做，
要在实现到对应环节时真机跑：
1. server 端 buildLibrary 加载真 epub → library 条目正确（Task 完成时验）。
2. asset 端点供 CSS/图片 → webview 实际能加载（CSS 生效、图片显示）。
3. CSS scope 前缀是否真的隔离（epub CSS 不污染 reader UI）。
4. 恶意 epub 在 webview 里真被挡（端到端 XSS，不只单测 sanitize 函数）。
5. 进度 scrollRatio 在 epub 容器上工作。
6. ZCode webview 加载 epub 章节的兼容性（教训 28）。

**教训补丁（写进 AGENTS.md）**：
29. **subagent/二手调研给的库 API 必须自己 spike 真跑，不能直接信。** 这次调研给的
    `book.archive.request(href,"string")` 对二进制返回乱码，真跑才发现要改用底层 `book.archive.zip`。
    "文档说支持 X"≠"X 真能用"——和教训 21（"应该能 X"是假设）同型，但这次的"假设"来自调研报告
    而非自己的 CSS 常识，更隐蔽。任何引入新库的 spec，实施第一步必须是 spike 验证真实 API 形状，
    把验证结果（含命门/坑）写进 spec，再基于真实 API 写实现计划。
