# 设计稿：ZCode 内置小说阅读器（在 ZCode 里看小说）

**日期**：2026-06-19
**状态**：待实现（spec 已与用户逐段确认 Q1–Q5 + 架构 5 节）
**作者**：brainstorming 会话产出
**分支**：`feat/novel-reader`

---

## 1. 目标

新增第四种 ZCode 定制能力：**本地小说阅读器**。让用户在 ZCode 的"浏览器"webview 面板里
阅读本地 `.txt` 小说，带两级目录（卷/章）、滚动阅读、书架多本管理、阅读进度记忆。

### 和现有三种模式的关系

| | 图片壁纸 | 视频壁纸 | 窗口透明 | **小说阅读器（本设计）** |
|---|---|---|---|---|
| 作用层 | 渲染层（`<style>`） | 渲染层（`<video>`） | 原生窗口层（HWND alpha） | **独立子应用（本地 http server + 前端 SPA）** |
| 注入通道 | CDP `Runtime.evaluate` | CDP `Runtime.evaluate` | Win32 API | **ZCode 自带浏览器 webview 加载 URL**（不注入） |
| 用 inject.cjs? | 是 | 是 | 否 | **否**（webview 直接加载 reader.html） |
| 改 ZCode 状态? | 是（加 DOM） | 是（加 DOM） | 是（设窗口 alpha） | **否**（只在 webview 里跑，ZCode 主界面零改动） |

**核心区别**：前三者都"改"ZCode，本设计"不改"——利用 ZCode 已有的浏览器功能加载一个本地阅读器。
ZCode 升级/重装都不影响（阅读器文件和 server 都在我们项目里）。

### 显式非目标（YAGNI）

- **不**做 epub / markdown 支持（v1 只 txt；架构预留格式解析器扩展点）
- **不**做分页模式（v1 纯滚动；分页 v2）
- **不**做在线书源（本地文件优先；在线源是另一个量级工程）
- **不**做全文搜索 / 书签 / TTS 朗读（v1 范围外）
- **不**做磁盘缓存（解码后全文常驻内存，够用）
- **不**引编码检测第三方库（Node 内置 `TextDecoder` 够用）
- **不**引构建工具做前后端同构（零依赖单文件哲学；前后端 codec 各一份，靠共享测试钉一致）
- **不**把 server 塞进 `wallpaper.bat` 流程（独立 `reader-server.bat`，显式常驻服务）

---

## 2. 真机验证（已确认的关键事实）

这些是设计的地基，都经过真机验证，不是假设：

| # | 事实 | 验证方式 |
|---|------|---------|
| 1 | ZCode 有内置"浏览器"面板，是 Electron `<webview>` 标签 | CDP 探测：`<webview src="about:blank" partition="persist:zcode-embedded-browser" data-testid="browser-webview">` |
| 2 | webview 能加载本地 `file://` URL | 用户实测：`file:///C:/Users/johnl/Documents/fighter_afterburner.html` 成功打开 |
| 3 | webview 能加载 `http://localhost` | 用户实测：在面板输 `http://localhost/` 显示 "It works!"（本机已有 Apache 占 80） |
| 4 | 浏览器面板在右侧、与编辑器并排、宽 468px、有可拖分割条 | CDP 探测 `div#browser` rect (x=1451,w=468) + `role=separator` 分割条 |
| 5 | 面板有 URL 输入栏 + 标签栏 | 用户截图确认 |
| 6 | webview `partition` 是 `persist:` 前缀 | → localStorage 会持久化（设计依赖此，待真机再验） |

**待实现阶段第一步真机验证（设计依赖、单测验不到的胶水）：**
- ⬜ webview 能加载 `http://localhost:17890`（具体端口）
- ⬜ webview 里拖拽 `.txt` 能拿到 `File` 对象（拖拽模式命门）
- ⬜ webview `localStorage` 在 persist partition 下重启不丢（进度持久化命门）
- ⬜ server 启动后剪贴板 URL 能粘进 ZCode 浏览器面板并打开

---

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  你的 Windows                                                │
│                                                              │
│  ┌──────────────┐    ┌──────────────────────────────────┐  │
│  │ reader-       │    │  ZCode (Electron)                │  │
│  │ server.bat    │    │  ┌────────────────────────────┐  │  │
│  │ (双击常驻)     │    │  │ 浏览器面板 webview          │  │  │
│  │  ↓            │    │  │  ┌──────────────────────┐  │  │  │
│  │ node http srv │◄──HTTP──│ reader.html (SPA)    │  │  │  │
│  │ :17890        │    │  │  │ 双模式:server/拖拽   │  │  │  │
│  │  ↓            │    │  │  └──────────────────────┘  │  │  │
│  │ 读 novels/*.txt│   │  └────────────────────────────┘  │  │
│  │ 提供 API+静态  │    └──────────────────────────────────┘  │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

### 三组件

1. **`lib/reader-server.cjs`** — Node http server，常驻
   - 启动时扫描 `novels/*.txt`，每本：读 bytes → 检测编码 → 解码 → 切章 → 记 offset 表
   - 路由：`/`→`/reader`、`/reader`→reader.html、`/reader/lib/*`→静态、`/api/books`、`/api/book/:id/toc`、`/api/book/:id/chapter/:n`
   - **章节切分在 server 端做**，前端只收当前章文本（解决 761 万字不能全量渲染）
   - 不依赖项目现有 CDP 代码（独立组件）

2. **`reader/`** — 阅读器前端 SPA（server 当静态文件供，也能 file:// 单开）
   - `index.html` / `reader.js` / `reader.css` + `lib/{book,toc,progress,codec}.js`
   - 双模式：`http:` 协议→fetch（server 模式）；`file:` 协议→拖拽（兜底，永远能用）

3. **`bin/reader-server.bat`** — 启动入口
   - `start` 开独立窗口常驻 server
   - **监听成功后**（端口冲突已解决、拿到实际 PORT）才把 `http://localhost:PORT/reader` 写剪贴板——
     顺序必须是先监听后写剪贴板，否则会把被占用的旧端口写进去
   - 关窗口即停服务（不偷偷后台常驻）

### 数据流（server 模式）

```
用户拖 .txt 进 novels/ → server 启动/刷新扫描 → 建 BookRecord
→ webview 加载 http://localhost:17890/reader
→ reader 调 /api/books 渲染书架（localStorage 有进度的排前）
→ 点书 → /api/book/:id/toc 取目录 + 读 localStorage progress 取上次章节
       → /api/book/:id/chapter/last → 渲染，scrollTo(ratio * scrollHeight)
→ 滚动 → debounce 1s → 存 localStorage
→ 点下一章/目录某章 → /api/book/:id/chapter/N → 渲染，ratio 归 0
→ 滚到 95% → 预取 N+1 章（缓存，不渲染）
```

---

## 4. reader 前端模块拆分

```
reader/
├── index.html        # 入口骨架
├── reader.css        # 主题/布局/阅读区排版
├── reader.js         # 主控（状态/视图切换/事件分发；唯一碰 DOM 的胶水）
├── lib/
│   ├── book.js       # 数据访问层：fetch/拖拽双模式适配，暴露统一 Book API
│   ├── toc.js        # 目录模型：解析卷/章树，扁平化导航
│   ├── progress.js   # 进度存取：localStorage，按书 id 存
│   └── codec.js      # 前端编码兜底（拖拽模式解码 ArrayBuffer→文本）
└── README.md         # reader 怎么单独跑（浏览器调试用）
```

**拆分原则**：`book.js`/`toc.js`/`progress.js`/`codec.js` 都是纯逻辑（不碰 DOM），可独立单测。
`reader.js` 是唯一 DOM 胶水，应保持薄——变重说明该再抽。**双模式差异完全封装在 `book.js` 内**，
上层只调 `book.open(id)` / `book.getChapter(n)`，不知道数据来源。

### Book API 契约（`book.js` 对外）

```js
const book = await Book.open(bookId);       // server:id; 拖拽:文件名 hash
const toc  = await book.getToc();           // [{type:'volume'|'chapter', title, index}]
const ch   = await book.getChapter(n);      // { title, paragraphs:[...], prev, next }
await book.saveProgress(n, scrollRatio);
const p    = await book.loadProgress();     // {chapter, ratio}
```

`book.js` 内部按 `location.protocol` 切换：`http:`→`fetch('/api/...')`；`file:`→拖拽缓存 ArrayBuffer + `codec.js` 解码 + 前端正则切章。

### 三栏布局

```
┌─────────────────────────────────────────────────────────┐
│ 顶栏: [书架] 《书名》·第X章 标题        [字号-][+] [☀/🌙] │  44px 固定
├──────────┬──────────────────────────────────────────────┤
│ 左栏目录  │              正文区                           │
│ (默认收起)│   第一章 山边小村                              │
│ 第一卷   │   　　二愣子睁大着双眼……                       │
│ ▸ 第一章 │   　　在他身边紧挨着的另一人……                  │
│   第二   │                                              │
│   …(滚动)│           [← 上一章]        [下一章 →]       │
├──────────┴──────────────────────────────────────────────┤
```

- **顶栏**：始终可见。中间书名+章节；右侧字号、主题、（server 模式）刷新书单、编码切换
- **左栏目录**：默认收起（468px 窄面板让正文最大化），点书架按钮展开。卷名=分组标题（不可点），章节可点。2000+ 章用原生 `overflow:auto`，当前章高亮+滚进可视区
- **正文区**：`padding` 留白、`line-height:1.8`、`font-size` 可调、`text-indent:2em` 段首缩进。纯滚动。章末有"下一章"按钮 + 滚到 95% 预取（不自动衔接，避免堆 DOM 撑爆内存）

---

## 5. server 端章节切分算法

抽成纯函数（`lib/reader-toc.cjs`），可单测（对称 `windowselect.cjs`/`resize.cjs` 惯例）：

```js
// 输入：解码后全文 + 文件名（诊断用）
// 输出：{ volumes:[{title, startChapterIndex}], chapters:[{title, startOffset, endOffset}] }
function parseTOC(text, filename) {
  const lines = text.split(/\r?\n/);
  const chapters = [], volumes = [];
  let offset = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^第[一二三四五六七八九十百千零0-9]+卷(\s|\u3000)/.test(line)) {
      volumes.push({ title: line, startChapterIndex: chapters.length });
    } else if (/^第[一二三四五六七八九十百千零0-9]+章(\s|\u3000)/.test(line)) {
      chapters.push({ title: line, startOffset: offset });
    }
    offset += raw.length + 1;  // +1 换行
  }
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].endOffset = (i + 1 < chapters.length)
      ? chapters[i + 1].startOffset : text.length;
  }
  if (chapters.length === 0) {  // 兜底：整文当一章
    chapters.push({ title: '全文', startOffset: 0, endOffset: text.length });
  }
  return { volumes, chapters };
}
```

**容错（对照样本实测坑）：**
- **重复标题**（样本"第十一卷"出现 2 次）：不去重，如实展示，用户能区分
- **正文里出现"第X章"字样**：要求独占一行 + 后接空格/全角空格 + 标题文字，大幅降低误判（样本"第一章 山边小村"满足，正文"翻开第一章"不独占行→不误判）
- **空卷**：某卷 `startChapterIndex` 等于下一卷→该卷下 0 章，不报错显示空卷名

### 段落切分（`splitParagraphs`，server 端）

```js
function splitParagraphs(chunk) {
  return chunk.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
}
```

trim 去掉行首全角空格缩进，正文靠 CSS `text-indent:2em` 重新加（字号变化时缩进自适应）。

### API 契约

| 方法 | 路径 | 返回 |
|------|------|------|
| GET | `/` | 302 → `/reader` |
| GET | `/reader` | reader.html |
| GET | `/reader/lib/*` | 静态 JS/CSS |
| GET | `/api/books` | `[{id,filename,totalChapters,hasVolumes,encodingSuspect}]` |
| GET | `/api/book/:id/toc` | `{volumes:[...], chapters:[...]}` |
| GET | `/api/book/:id/chapter/:n` | `{index,title,paragraphs:[...],prev,next}` |
| GET | `/api/book/:id/progress` | `null`（进度全在前端） |

`paragraphs` 是已分段数组，前端不用再切。

---

## 6. 进度模型（localStorage）

```js
// key: "zcode-reader:progress:<bookId>"   bookId = filename 稳定 hash
{
  bookId, chapterIndex, scrollRatio,  // scrollTop/scrollHeight，适应窗口大小变化
  updatedAt
}

// key: "zcode-reader:shelf"
[{ bookId, filename, lastChapterTitle, updatedAt }]
```

书架 = server `/api/books`（当前可用书）∪ localStorage（进度）。两边 join 显示。
server 没启动时书架只显示有进度的条目（灰色，提示"启动服务后可继续"）。

**bookId 用 filename hash 的权衡**：重命名会跟丢进度。书架里旧进度条目变"孤立记录"，
可点"找文件重新关联"重新拖入关联。接受这个限制（YAGNI，不做路径模糊匹配）。

---

## 7. 编码处理

### 检测策略（`lib/reader-codec.cjs`，纯函数可单测）

中文 txt 现实：**无 BOM、GB18030 为主、偶有 UTF-8**（样本印证）。检测顺序：

```
1. BOM 检测（最快最可靠）
   - EF BB BF → UTF-8 with BOM（剥 BOM）
   - FF FE / FE FF → UTF-16（兜底）
   有 BOM = 终极判定，跳过下面

2. 无 BOM → UTF-8 严格解码验证
   - TextDecoder('utf8',{fatal:true}) 试解整文件
   - 成功 = UTF-8；失败 → 进 3

3. UTF-8 失败 → GB18030 解码
   - TextDecoder('gb18030')（兼容 GBK/GB2312 超集，不抛错）
   - 靠"解码结果合理性"二次校验：U+FFFD 占比 + 常用字置信度

4. 可疑 → warn 日志，但仍按 GB18030 给（带 encodingSuspect:true 标记）
```

**fatal UTF-8 是区分 UTF-8 vs GB18030 的决定性手段**（非严格 UTF-8 解 GBK 会得一堆 U+FFFD 但不报错）。

### 编码发生时机

```
server 启动 → 扫 novels/ → 每本：读 bytes → detectEncoding → 记 encoding
→ decode → parseTOC → 记 offset 表 → 解码后全文以字符串常驻内存（offset 切片不复制）
```

解码只发生一次（启动时）。内存：单本解码后约 28MB（中文 UTF-16），几本 OK；超 200MB warn 不阻止。
进程退出（关 bat 窗口）= 内存全释放。

### 拖拽模式编码（前端 `reader/lib/codec.js`）

拖拽收 ArrayBuffer，前端复用**同一套检测逻辑的 JS 实现**（`fatal:true` UTF-8 + GB18030 fallback）。

**重要权衡：`reader/lib/codec.js` 与 `lib/reader-codec.cjs` 是两份逻辑镜像**。
看似违反 AGENTS.md"根除重复"，**实则不违反**：
- server 在 Node、前端在浏览器，运行时不同（`Buffer`/`fs` vs `ArrayBuffer`/`FileReader`），无法共享一份代码
- 引构建工具做同构会违背"零依赖单文件"哲学
- 折中：**用同一套测试用例**钉死两边一致（`test/readercodec*.cjs` 跑同样断言）
- 这是 AGENTS.md 教训 12 的直接应用：跨环境胶水靠共享测试覆盖

---

## 8. 错误处理（按"用户能感知什么"组织）

| 场景 | 处理 | 用户感知 |
|------|------|---------|
| 端口被占 | 自动 +1 重试 17890→17891…（最多 5 次）→ 都占则报错退出 | 自动换端口后实际 URL 写剪贴板，无感 |
| `novels/` 空/不存在 | 照常起 server，自动建空目录，书架空状态 | 友好提示，不崩 |
| 某本解码可疑 | 仍加载标记 `encodingSuspect`，书架⚠️图标，正文顶部黄条 | 可读不中断 |
| 编码手动覆盖 | 顶栏 UTF-8/GB18030/自动 切换按钮 | 一键纠正 |
| 章节越界 | 404 + `{error}`，前端"无此章" | 不崩 |
| 目录全空 | 兜底"全文"章 | 任何 txt 都能开 |
| server 没启动/webview 打不开 | reader 自动切拖拽模式 + 提示 | server 模式独立成立；拖拽模式是否可用待真机验（见 §11 风险），通了则双保险 |
| 拖拽非 txt | "仅支持 .txt" | 友好报错 |
| 重命名文件进度跟丢 | 旧条目变"孤立记录"，可重新拖入关联 | 进度可找回 |
| 章节超长 | 纯滚动，`-webkit-overflow-scrolling:touch` | 无感 |

**两条核心容错原则**：
1. **永不白屏**：任何错误都有降级路径。`reader.js` 顶层 try/catch，渲染错误页而非崩
2. **能用就先给，可疑就标注，别直接拒**：编码可疑照样显示带⚠️；空目录照样起服务

---

## 9. 测试策略

对称项目现有 `*test.cjs` 风格，纯函数抽出来单测：

```
test/
├── readertoctest.cjs       # parseTOC:卷/章切分、重复标题、空文件、兜底、独占行判定
├── readercodectest.cjs     # detectEncoding(server):BOM/fatal-UTF8/GB18030/可疑
├── readercodectestweb.cjs  # detectAndDecode(前端版):同上用例，钉一致
├── readertocwebtest.cjs    # 前端正则切章:同 readertoctest 用例
├── readerprogresstest.cjs  # progress.js:存取、按书 id 隔离、scrollRatio 边界
├── readerservertest.cjs    # server API:mock http 起 server，验证 /api/* + 端口自动换
└── (menutest.cjs 加断言)   # 新菜单项渲染、calls 标注
```

**真机验证清单（单测覆盖不到的胶水/OS/Electron 行为）**：
1. ✅ webview 能加载 `file://`（已验）
2. ✅ webview 能加载 `http://localhost`（已验）
3. ⬜ webview 能加载 `http://localhost:17890`
4. ⬜ webview 拖拽 `.txt` 能拿 `File` 对象
5. ⬜ webview localStorage 在 persist partition 下重启不丢
6. ⬜ 剪贴板 URL 能粘进 ZCode 浏览器面板

`npm test` 加新测试，放现有 `transparenttest` 之后：
```
... → transparenttest → readertoctest → readercodectest → readercodectestweb
→ readertocwebtest → readerprogresstest → readerservertest
```

---

## 10. 文件清单

**新增**：
- `reader/index.html`, `reader/reader.js`, `reader/reader.css`
- `reader/lib/{book,toc,progress,codec}.js`
- `reader/README.md`
- `lib/reader-server.cjs`, `lib/reader-toc.cjs`, `lib/reader-codec.cjs`
- `bin/reader-server.bat`
- `test/reader*test.cjs`（6 个）
- `novels/`（放 txt，加 `.gitignore` + `.gitkeep`）

**改动**：
- `lib/menu.cjs`（加场景 11 启动阅读器服务 / 12 使用说明）
- `wallpaper.bat`（转发新场景）
- `package.json`（test 脚本 + `npm run reader`）
- `.gitignore`（加 `novels/*` + `!novels/.gitkeep`）
- `README.md`（加"小说阅读器"章节）
- `AGENTS.md`（加新子系统说明 + 教训，对称视频/透明章节）

### 菜单新增

- 场景 11：**启动小说阅读器服务**（`reader-server.bat`）
- 场景 12：**阅读器使用说明**（打印 URL + 拖拽指引，不启服务）

---

## 11. 已知遗留 / 风险

- **拖拽是否在 webview 里可用**：未真机验。设计已留 file:// 兜底；若拖拽不可用，
  reader 退化到"必须启 server 才能用"，仍能用（B 的 A 兜底失效，但 server 模式独立成立）。
  实现第一步即验，不通则在 spec 里降级。
- **localStorage 持久化**：依赖 `persist:zcode-embedded-browser` partition。待真机验。
  不持久化则进度重启丢失——严重降级，但功能仍可用（每次手动找章节）。
- **端口冲突**：自动 +1 重试，但极端情况下用户机器端口全被占——打印手动改 PORT 指引。
- **大书内存**：761 万字 × N 本常驻内存。超阈值 warn 不阻止。真遇到再加磁盘缓存。
- **侧边栏硬画背景**（AGENTS.md 核心教训 2 已知遗留）：本设计在 webview 独立渲染进程，
  **不受此影响**——webview 是独立 origin，不共享 ZCode 的 CSS 变量。这是本设计相对壁纸方案的额外优势。

---

## 12. 教训预防（写进 AGENTS.md，对称前三次事故）

- **不假设 webview 能加载 localhost/能拖拽/能持久化**——任何一条不通都要有降级。
  设计已把降级路径写进错误处理表。
- **章节切分正则不能只看样本**：`fatal:true` UTF-8 区分编码、独占行+空格分隔降低误判，
  都是从样本反推的防线。加新格式书要重测 `readertoctest`。
- **前后端 codec 镜像靠共享测试钉**：跨环境胶水（教训 12 同型）单测验不到，
  必须两份代码跑同一套断言。
- **server 是显式常驻服务，不偷偷后台**：独立 bat + 独立窗口，关窗即停。
  不学某些工具的"装完偷偷开机自启"。
