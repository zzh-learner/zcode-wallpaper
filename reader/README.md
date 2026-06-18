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
