# reader/ — ZCode 小说阅读器前端

纯前端 SPA，两种运行模式：

## http 模式（推荐）
启动 `bin/reader-server.bat` 后，在 ZCode 浏览器面板访问
`http://localhost:17890/reader`。从书架选书即用。

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
    └── book.js       # 数据访问层，封装 fetch（http）/拖拽（file）双模式
```

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
要调 server 模式，先 `npm run reader` 起 server，再访问 `http://localhost:17890/reader`。
