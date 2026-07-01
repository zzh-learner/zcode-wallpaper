# reader/ — ZCode 小说阅读器前端

纯前端 SPA，支持 **txt + epub** 两种图书格式，两种运行模式：

## http 模式（推荐）
启动 `bin/reader-server.bat` 后，在 ZCode 浏览器面板访问
`http://localhost:17890/reader/`（**尾斜杠别省**：`/reader` 会被 server 302 重定向到
`/reader/`，否则页面里的相对路径 `reader.css`/`lib/codec.js` 会解析成 `/reader.css`
等根路径而 404，书架空 + JS 全 undefined）。从书架选书即用。

## file 模式（兜底）
直接用 `file:///.../reader/index.html` 打开（拖入 .txt 阅读）。
此模式下书架只显示有进度的条目（localStorage 持久），新书靠拖拽。

## 文件结构

```
reader/
├── index.html        # 入口骨架（顶栏/侧栏目录/正文区）
├── reader.css        # 三栏布局 + 主题（暗/亮/护眼）+ 阅读排版
├── reader.js         # 主控胶水（书架/目录/章节/进度/拖拽/主题/字号，唯一碰 DOM）
└── lib/
    ├── codec.js      # 编码检测（拖拽模式，server lib/reader-codec.cjs 的镜像）
    ├── toc.js        # 章节切分（拖拽模式，server lib/reader-toc.cjs 的镜像）
    ├── progress.js   # localStorage 进度存取（按书 id 隔离）
    ├── scope-css.js  # epub CSS 作用域隔离（mirror of lib/epub.cjs scopeCss）
    ├── book.js       # 数据访问层，封装 fetch（http）/拖拽（file）双模式
    └── book-router.js # ?book=<id> 深链解析（控制中心点书跳 reader）
```

## epub 支持（仅 server/http 模式）

epub 是 txt 之外的第二种格式。把 `.epub` 放进 `novels/` 由 server 加载，**不支持拖拽**
（解 zip 需要文件系统 + jszip，浏览器 FileReader 读不到目录）。

- **唯一分叉点**在 `reader.js` 的 `showChapterNode`：按 `ch.format` 分派——txt 走段落列表
  `#chapter-content`，epub 走 `#epub-content` 容器（sanitized HTML fragment + scoped `<style>`）。
  书架/目录/进度/翻页全部复用 txt 路径，epub 差异全封装在 server 端。
- **XSS 防护**：epub XHTML 经 server 端 `sanitize-html` 白名单过滤（剥 `<script>`/`onerror`/
  `javascript:`），图片/链接相对路径改写到 `/api/book/:id/asset` 端点。
- **CSS 隔离**：epub 自带 CSS 经 `scopeCss` 给每个选择器加 `#epub-content` 前缀，防止泄漏到
  reader UI（顶栏/侧栏）。其中 `body{...}`/`html{...}` 整词选择器映射到容器本身（章节片段无
  `<body>`/`<html>` 元素，简单加前缀会永不匹配）。
- **主题色优先**：`#epub-content` 设 `background/color: var(--c-*) !important`，切主题时阅读区
  背景+默认文字色跟随三种主题（暗/亮/护眼），**覆盖** epub 作者在 `body{}` 上设的颜色。子元素
  上作者设的特定颜色（标题/链接/强调）保留作者原色，不强制跟随主题。

## 章节识别能力

## 章节识别能力

`lib/toc.js` 的 `parseTOC` 支持（镜像 server，用同一套测试钉一致）：
- **章节 unit**：章 / 节 / 回（`第一X章`、`第一X节`、`第一X回` 等价）
- **章标记位置**：行中任意位置（不要求行首）—— 支持"卷一 ... 第一章 ..."同行格式
- **分隔符可选**：`第一集第一章`（无空格粘连）也能识别
- **卷 unit**：卷 / 集 / 部 / 篇，支持"第X卷"和"卷X"两种写法
- **数字**：中文数字（含"两"，两千 = 二千）+ 阿拉伯数字
- 兜底：一个章节都识别不出时，整文当"全文"一章

`cleanChapterParagraphs` 过滤章节正文里的杂质行：标题行（含带卷前缀的）、
网文元信息（更新时间/本章字数/字数/发布时间 等）。

批量测 86 本起点完结小说，~95% 识别正确。剩 4 类罕见格式不支持
（纯数字编号 / 易经卦名 / 整本无换行 / 正文引用假阳性），见根 AGENTS.md。

## 编码

`lib/codec.js` 自动检测：BOM → fatal UTF-8 → GB18030 兜底。
中文 txt 无 BOM、GB18030 为主是常态，自动检测正确率 ~100%（86 本批量验过）。
可疑的书（U+FFFD 占比高）带 ⚠️，顶栏可手动切 UTF-8/GB18030。

## 浏览器调试

reader 的纯逻辑模块可在普通浏览器或 Node 跑：
- `lib/codec.js` / `lib/toc.js` / `lib/progress.js` 都有对应 `test/reader*webtest.cjs`
- `lib/book.js` 是薄适配层，靠端到端覆盖（`scripts/verify-books-flow.cjs` 用 CDP 在
  真实 webview 里验多本）

直接在浏览器开 `reader/index.html`（file://）+ 拖入任意 .txt 即可调试。
要调 server 模式，先 `npm run reader` 起 server，再访问 `http://localhost:17890/reader/`（尾斜杠别省，见上）。
