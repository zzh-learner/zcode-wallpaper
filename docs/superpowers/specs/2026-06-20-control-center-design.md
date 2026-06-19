# 设计稿：ZCode 壁纸控制中心（带界面的桌面程序）

**日期**：2026-06-20
**状态**：待实现（spec 已与用户逐段确认：定位/技术栈/透明/状态范围/轮询/书架/server 合并 + 架构 5 节）
**作者**：brainstorming 会话产出
**分支**：`feat/control-center`

---

## 1. 目标

把现有的 `wallpaper.bat` 文字菜单升级成一个**带界面的控制中心**：一个常驻 HTTP server + 透明背景的前端 SPA，
在 ZCode 自带浏览器 webview 面板里打开。统一操作四个子系统（图片壁纸 / 视频壁纸 / 窗口透明 / 小说阅读器），
并**实时显示状态**。

### 核心定位（用户确认）

**全功能控制中心**：后台常驻、实时反映状态、可改参数、统一触发。不是纯一次性触发面板。

### 和现有子系统的关系

| 子系统 | 现状入口 | 控制中心里的角色 |
|---|---|---|
| 图片壁纸（CDP 注入 `<style>`） | wallpaper.bat 场景 2/3/4 | 状态显示② + 触发"换图/移除" |
| 视频壁纸（CDP 注入 `<video>`） | wallpaper.bat 场景 7/8 | 状态显示② + 触发"注入视频/移除" |
| 窗口透明（Win32 HWND alpha） | wallpaper.bat 场景 9/10 | 状态显示③ + 触发"设透明" |
| 小说阅读器（HTTP server + SPA） | wallpaper.bat 场景 11 | **整合**：server 合并进来 + 书架管理全套 |

**核心原则**：控制中心是「触发器 + 状态显示器」，**不重写任何子系统的动作逻辑**。
动作全靠 spawn 现有命令（inject.cjs / transparent.ps1 / resize.cjs / setup.cjs），只新增「查询」能力。

### 显式非目标（YAGNI）

- **不**重写 inject.cjs / transparent.ps1 的动作逻辑（只 spawn 它们）
- **不**做书架内容 hash 模糊匹配（关联修复只做 filename 同名匹配）
- **不**做透明度 CSS 自适应（控件用固定半透明深色底，壁纸可读性靠选图，教训 2 结论）
- **不**做 Electron 打包 / 独立 .exe（复用 Node web UI 架构，零新增原生依赖）
- **不**做动作队列（全局锁，进行中即 409）
- **不**把控制中心塞进壁纸 CDP 注入（透明靠控制中心自己 CSS，A1）

---

## 2. 真机验证（已确认的关键事实）

这些是设计的地基，都经过真机验证，不是假设：

| # | 事实 | 验证方式 |
|---|------|---------|
| 1 | webview 元素本身及整条祖先链**全是透明**的（`bgColor: rgba(0,0,0,0)`） | `scripts/inspect-webview.cjs` 探测：webview → `div.bg-background` → `aside.bg-background` → `div#browser`，一路 `rgba(0,0,0,0)`。这是 wallpaper.css 把 `--color-background` 设 transparent 的效果 |
| 2 | **webview 内部页面自己决定背景**。brainstorm 框架页 body 是 `rgb(29,29,31)` 实色 → 盖住壁纸 | 同上探测：webview target 的 body `bg:rgb(29,29,31)`，所以看不到壁纸 |
| 3 | reader 页面 `#topbar` 有 `#1E1E22` 实色底（reader.css 主题），**reader 本身没透壁纸** | 用户提供的 element info：`#topbar Background:#1E1E22` |
| 4 | **结论**：控制中心要透壁纸，必须**自己把 body/容器背景设成 transparent**，不依赖壁纸已注入 | 由 1+2 推得，这是 A1（页面自带透明 CSS）的依据 |
| 5 | ZCode webview 可加载 `http://localhost:<port>` | reader-server 已验证（novel-reader spec） |

**关键洞察（纠正了 brainstorm 过程中的两个误判）**：
- 误判 A："webview 必盖壁纸" → 错。webview 元素透明，是**页面自己**画实色背景盖住。
- 误判 B："reader 能透壁纸所以 webview 能透" → 错。reader 其实是自己的实色底，没透。
- 正确结论：**页面自己写 transparent 就能透壁纸**（控制中心的设计依据）。

---

## 3. 架构

三层结构，一个常驻 server。

```
┌─────────────────────────────────────────────────────────────┐
│  ZCode webview（用户看到的）                                  │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  │
│  │ 控制中心 SPA             │  │ reader SPA（原有，保留） │  │
│  │ • body bg: transparent   │  │ • 加透明背景             │  │
│  │ • 浮动控件 + 书架管理    │  │ • 其余原样               │  │
│  │ • 自动轮询 /api/status   │  │                          │  │
│  └──────────────────────────┘  └──────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP（同一 server，同端口）
┌───────────────────────────▼─────────────────────────────────┐
│  lib/control-server.cjs（常驻 HTTP server，由 reader-server  │
│  演进而来）                                                   │
│  • 静态托管（控制中心 + reader 前端）                         │
│  • 小说 API（/api/books* 从 reader 迁入）                     │
│  • 状态 API（/api/status 轮询）+ 动作 API（/api/action）      │
└───────────────────────────┬─────────────────────────────────┘
                            │ require / spawn
        ┌───────────────────┴────────────────────┐
        ▼                                        ▼
┌──────────────────────┐              ┌────────────────────────┐
│ ✦新增 lib/status.cjs │              │ 动作逻辑（C1：spawn）  │
│ 纯只读查询模块        │              │ inject.cjs（图/视频/移除）│
│ • 复用 inject listTargets │         │ transparent.ps1（透明） │
│ • alpha 查询（transparent │         │ resize.cjs（缩图）      │
│   .ps1 -Query 只读）  │              │ setup.cjs（装依赖）     │
│ • 查进程/端口/资源     │              │ → server spawn，不改它们│
└──────────────────────┘              └────────────────────────┘
```

### 三个关键设计抉择（用户确认）

| 抉择 | 选项 | 选定 | 理由 |
|---|---|---|---|
| A. 透明背景谁负责 | A1 页面自带透明 CSS / A2 复用 CDP 注入 | **A1** | 自包含，不依赖壁纸已注入；壁纸没注入时退化成 ZCode 默认底，可接受 |
| B. 状态探查怎么做 | B1 内联查询 / B2 抽共享模块 | **B2 轻量** | 新增 `lib/status.cjs` 纯查询，复用 inject.cjs 的 `listTargets`，alpha 查询给 transparent.ps1 加 `-Query` 模式 |
| C. 动作怎么触发 | C1 spawn 现有命令 / C2 内联实现 | **C1** | 根除重复（教训 1），动作逻辑只有一份，控制中心只是触发器 |

---

## 4. 组件

按"做什么 / 怎么用 / 依赖什么"列每个单元。

### A. 后端（server 侧）

**A1. `lib/control-server.cjs`** —— 合并的常驻 HTTP server（由 reader-server.cjs 演进）
- **做什么**：静态托管控制中心 + reader 前端；供三类 API（小说、状态、动作）
- **怎么用**：`node lib/control-server.cjs`（或经 `bin/control-center.bat` / 新菜单场景启动）
- **依赖**：复用 reader-server.cjs 的端口自增/编码/章节切分逻辑（抽成可 require 函数）；`require('./status.cjs')`；`child_process.spawn`
- **职责边界**：只做 HTTP + 编排，**不内联任何注入/透明动作逻辑**

**A2. `lib/status.cjs`** ✦新增 —— 纯查询模块（B2 轻量）
- **做什么**：导出一组**只读**查询函数，返回状态①~⑤快照
- **怎么用**：`const s = require('./status.cjs'); await s.snapshot()`
- **依赖**：复用 inject.cjs 已导出的 `listTargets` 查 CDP（②）；fs 查资源（⑤）；os/进程列表查 ZCode 进程（①）；spawn `transparent.ps1 -Query` 查 alpha（③）
- **职责边界**：**绝不修改任何状态**（只读）。alpha 查询用 transparent.ps1 的 `-Query` 模式（只 `GetLayeredWindowAttributes`，不 `Set`，教训 14 可回读）
- **内部缓存**：alpha 查询做 500ms 去重缓存（spawn PS 较慢，避免拖慢 2s 轮询）

**A3. `lib/transparent.ps1` 扩展** —— 加 `-Query` 模式（复用窗口选择，不新写文件）
- **做什么**：现有设透明逻辑不动；新增 `-Query` 开关，**直接给 hwnd** 查该窗口当前 Layered alpha（0-255），纯只读
- **为什么不走窗口枚举**：控制中心轮询不能 read-host。setTransparent 成功后 server 记下 hwnd，`-Query` 直接按 hwnd 查，跳过窗口选择（更快、回避多候选）。见 §10"alpha 查询的多窗口处理"。
- **依赖**：只调 `GetLayeredWindowAttributes`（按 hwnd），不 `Set`
- **职责边界**：`-Query` 模式绝不 `Set`。设透明时仍走原窗口选择逻辑（与 transparent.ps1 设透明时一致，transparenttest 钉死）
- **BOM 要求**：transparent.ps1 有中文，**必须存 UTF-8 with BOM**（AGENTS.md 记录的坑）

**A4. 动作执行器**（control-server.cjs 内的一个函数，不单独成文件）
- **做什么**：收 `/api/action` 请求 → spawn 对应现有命令 → 捕获 stdout/exit code
- **依赖**：spawn `node lib/inject.cjs [--video|--remove]`、`lib/transparent.ps1 -Opacity N`、`node lib/resize.cjs`、`node lib/setup.cjs`
- **职责边界**：**不重写**任何动作逻辑（C1）。异步，返回 jobId，前端靠下一次 status 轮询看效果

### B. 前端（控制中心 SPA）

**B1. `control/` 前端目录**（新建，对称 reader/）
- **做什么**：透明背景 SPA，占满 webview，浮动控件 + 书架管理
- **怎么用**：webview 加载 `http://localhost:<port>/control/`
- **依赖**：fetch `/api/status` / `/api/action` / `/api/books*`；localStorage 存控制中心自身偏好
- **职责边界**：`body{background:transparent !important}` 是它自己的事（A1），不依赖壁纸已注入

**B2. `control/lib/status-view.js`** —— 状态渲染
- **做什么**：纯渲染函数，/api/status JSON → DOM 片段
- **怎么用**：`renderStatus(json) → HTMLElement`
- **职责边界**：纯函数（输入→输出），可单测，不碰 fetch

**B3. `control/lib/shelf.js`** —— 书架管理（全套增删改 + 关联修复）
- **做什么**：展示书架、进书读、删书、加书、改名关联修复
- **怎么用**：调 `/api/books*`；本地 localStorage 复用 reader 的 `progress.js`（`window.__readerProgress`）
- **依赖**：复用 `reader/lib/progress.js`（书架数据结构，localStorage key 相同 `zcode-reader:shelf`）；复用 reader 的 codec/toc（章节）
- **职责边界**：书架的"存"在 reader progress（localStorage），"源"在 novels/（server 扫）。关联修复 = bookId 跟丢时按 filename 重新匹配

---

## 5. 数据流 + API 设计

### 5.1 两条主线

**主线 1：状态轮询（只读，高频）**
```
控制中心 SPA --每2s fetch--> /api/status --调--> lib/status.cjs.snapshot()
                                                  ├─ 查 ZCode 进程（os/进程列表）
                                                  ├─ 查 CDP target（复用 inject.cjs listTargets）
                                                  ├─ 查壁纸注入状态（DOM 探测，见 mode 判定）
                                                  ├─ 查透明 alpha（spawn transparent.ps1 -Query，500ms 缓存）
                                                  ├─ 查 reader/控制中心服务自身（端口）
                                                  └─ 查资源盘点（fs.readdir）
              <--JSON 快照--          <--快照--
```

**主线 2：动作触发（异步，低频）**
```
点按钮 --POST--> /api/action {action, params}
                    ↓
              分配 jobId，立即返回 {jobId}（不等 spawn 完成）
                    ↓（后台 spawn）
              node lib/inject.cjs --video  或  transparent.ps1 -Opacity N  等
                    ↓
              前端轮询 /api/status 自然看到状态变化
```

### 5.2 API 契约

**1. `GET /api/status` → 状态①~⑤完整快照**
```jsonc
{
  "zcode":        { "running": true, "pid": 21496, "debugPort": 9222, "pageTargets": 2 },
  "wallpaper":    { "mode": "video",            // "image"|"video"|"none"|"unknown"
                    "file": "wallpapers-video/rain.mp4",
                    "injectedWindows": 2, "totalWindows": 2,
                    "lastInjectAt": 1718800000 },
  "transparent":  { "enabled": true, "alpha": 199, "opacityPct": 78, "hwnd": 133212 },
  "reader":       { "running": true, "port": 17890, "bookCount": 86 },
  "resources":    { "images": 12, "thumbs": 12, "videos": 3, "novels": 86,
                    "deps": { "sharp": true, "ws": true } },
  "_meta":        { "fetchedAt": 1718800123, "probeErrors": [] }
}
```

- **mode 判定**：CDP 连 page target，DOM 里查 `#zcode-user-wallpaper-video`（在→video）、`#zcode-user-wallpaper` style + body 背景图（在→image）、都没有→none。复用 inject.cjs 的 `verifyExpression` 思路。
- **探查失败不致命**：任一项查失败，该项填 `null` + 记入 `_meta.probeErrors`，整体仍 200。前端单项显示"未知/错误"。

**2. `POST /api/action` → 触发动作**
```jsonc
// 请求
{ "action": "injectVideo" }
// setTransparent 带参数：
{ "action": "setTransparent", "opacityPct": 78 }
// 响应（立即）
{ "jobId": "j_1f2a", "accepted": true }
```

action 白名单映射到 spawn 命令：

| action | spawn |
|---|---|
| injectImage | `node lib/inject.cjs` |
| injectVideo | `node lib/inject.cjs --video` |
| remove | `node lib/inject.cjs --remove` |
| setTransparent | `lib/transparent.ps1 -Opacity <pct>` |
| resize | `node lib/resize.cjs` |
| setup | `node lib/setup.cjs` |

- **并发控制**：全局一个动作锁，任意 action 进行中时新请求 `409 {"accepted":false,"reason":"busy","activeJob":"j_xxx"}`。不做队列（YAGNI）。
- **成功判定**：不依赖 exit code，靠下一次 status 轮询的**真实 DOM 状态**为准（教训 3）。

**3. `GET /api/job/:id` → 动作结果**（可选，状态轮询通常够了）
```jsonc
{ "jobId": "j_1f2a", "state": "running"|"done"|"failed", "exitCode": 0, "output": "..." }
```

**4. 小说/书架 API（从 reader-server 迁入 + 扩展）**
- `GET /api/books`、`GET /api/book/:id/toc`、`GET /api/book/:id/chapter/:n`（原有，从 reader-server 迁入）
- **reader 体验不变**：reader SPA 仍走 `/reader/`，调的是同一组 `/api/books*`。迁移后 reader-server.bat 改为调 control-server.cjs（或保留为兼容别名）。reader 前端零改动。
- 书架的**增删改在前端 localStorage**（复用 `progress.js`），server 不存书架状态
- ✦新增关联修复：
  - `POST /api/book/resolve { staleBookId, hint }` → server 扫 novels/，按旧 filename 找现在叫什么
  - 返回 `{ newBookId, newFilename } | null`
  - **匹配依据是 filename，不做内容 hash 模糊匹配**（太重）
  - 即：书架存旧 filename，server 看 novels/ 是否还有同名；改名了标 stale，用户手动重拖；关联修复只让"同名还在但 id 变了"这种边界自动修

### 5.3 关键时序约束

1. **/api/status 必须快（<300ms）**：每 2s 轮询。alpha 查询（spawn PS）较慢，用 500ms 缓存去重。
2. **spawn 动作异步**：`/api/action` 立即返回 jobId，不等 spawn 完成。
3. **端口自增沿用 reader-server**（17890→17891...），剪贴板写**实际**端口（教训：listen 成功后写）。

---

## 6. 错误处理 + 边界情况

### 6.1 启动/连接类（命令链，教训 1 重灾区）

| 情况 | 处理 | 用户看到 |
|---|---|---|
| node 没装 | server 启动前探测，友好提示（对称 wallpaper.bat 的 node 预检） | "需要 Node.js" |
| 端口 17890 被占 | 自动 +1（沿用 reader-server），最多 5 次 | 剪贴板写实际端口 + 控制中心提示当前端口 |
| webview 加载 `/control`（无尾斜杠）404 | server `/control` → 302 `/control/`（教训 18a） | 正常加载，不空白 |
| ZCode 没开用户点"注入" | spawn 的 inject.cjs 自己报"连不上调试端口"；server 捕获 exit code，记 job.failed | 状态条壁纸项显"未注入" |

### 6.2 状态探查类（查询失败，教训 2/3）

| 情况 | 处理 |
|---|---|
| CDP 连不上（ZCode 没开/没带 debug port） | `wallpaper`/`zcode` 项填 `null` + probeErrors，不抛 |
| 透明 alpha 查询失败（进程名不对/多窗口选错） | `transparent` 项 `null`，不阻塞其它项 |
| spawn PS 查 alpha 超时（>2s） | status.cjs 给 PS 设超时，超时该项 `null` |
| 资源目录不存在（wallpapers-video/ 没建） | `fs.readdirSync` 包 try-catch 返回 0（沿用 inject.cjs listVideos 写法） |

**核心原则**：探查失败不致命。任一项挂，整体 status 仍 200，前端单项显示"未知"。

### 6.3 动作执行类（C1 spawn 的固有风险）

| 情况 | 处理 |
|---|---|
| 动作进行中再点同一动作 | 全局锁，409。前端按钮置灰 |
| spawn 的进程 crash / exit 非 0 | 记 job.state=failed + exitCode + output 尾部。前端显红 + 可看输出 |
| spawn 超时（>30s） | server 给 spawn 设超时，kill，记 failed |
| spawn 成功但状态没变（教训 3 典型） | 不依赖 exit code 判成功，靠**下一次 status 轮询的真实 DOM 状态**为准 |
| 透明窗口重建（ZCode 重启 HWND 变了） | alpha 查询每次重选窗口（不持久化 hwnd）。透明项自然反映 enabled:false |

### 6.4 书架/数据类

| 情况 | 处理 |
|---|---|
| localStorage 书架有 stale bookId（文件改名/删除） | 标 stale，显示"重新拖入关联"；关联修复 API 试同名匹配，匹配上自动更新 |
| novels/ 空文件 / 单行长文件（教训 19 边缘） | 沿用 reader-toc 现有行为，不在控制中心重处理 |
| 书架条目 progress 损坏（JSON 坏） | `progress.js` 已 try-catch 返回 null，控制中心跳过坏条目 |

### 6.5 透明 UI 的边界（A1 的副作用）

| 情况 | 处理 |
|---|---|
| 壁纸**没注入**，控制中心背景透明 | 透出 ZCode 默认底（深色），可接受。控件用半透明深色块保证可读 |
| 壁纸是**浅色高亮图**，控件文字看不清 | 控件用半透明深色底 + 白字。控制中心不试图自适应壁纸亮度（教训 2 结论） |
| 用户在**普通浏览器**（非 webview）打开控制中心 | 没有壁纸透出，背景是浏览器默认白。控件仍可用（A1 自包含）。降级体验，可接受 |

### 6.6 并发/一致性

- status 轮询和 action 执行可能交叉。**status 是只读快照，查的是某一刻真实状态，中间态可接受**（用户多看一次轮询就准）。不做事务。
- 多个 webview 同时打开控制中心：共享一个 server，各自轮询，localStorage 按 webview partition 独立。无冲突。

---

## 7. 测试策略

核心原则：**能纯函数化的抽出来单测，跨语言胶水/组件边界靠端到端，绝不靠"语法绿+单测绿"就宣称能跑（教训 3/12/13）。**

### 7.1 纯函数单测（新增 test 文件）

**1. `test/statustest.cjs`** —— 测 `lib/status.cjs` 的纯函数部分
- 把状态探查里的**纯逻辑**抽成可单测函数（不碰 CDP/PS/fs 的部分）：
  - `parseTargetsForStatus(targets)` —— CDP `/json` 结果 → zcode/wallpaper 的运行/target 数部分（喂 mock targets）
  - `classifyWallpaperMode(domProbeResult)` —— DOM 探测结果 → mode 字符串
  - `mergeProbeResults(parts)` —— 各项探查结果（含 null）合并成完整 status + probeErrors
  - `alphaToOpacityPct(alpha)` / `opacityPctToAlpha(pct)` —— 0-255 ↔ 0-100 换算
- 测什么：null 项不污染整体、mode 分类正确、换算边界（0/100/255）、缓存逻辑

**2. `test/controlservertest.cjs`** —— 测 server 的 HTTP 层（沿用 readerservertest.cjs 模式）
- 起 mock 占端口验自增
- 验 `/control` → 302 `/control/`（教训 18a 钉死）
- 验 `/api/status` 探查失败时整体仍 200 + probeErrors 非空
- 验 `/api/action` 全局锁：进行中再请求 → 409
- 验 action 白名单：未知 action → 400
- **不测** spawn 的真实命令执行（那是端到端）

**3. `test/shelftest.cjs`（前端，Node 侧）** —— 测书架管理逻辑
- 复用 reader 的 progress.js 单测基础
- 新增关联修复匹配逻辑（`resolveStaleBookId(shelfEntry, currentFiles)` 纯函数）—— filename 匹配规则
- 测什么：同名还在但 id 变了→自动修；文件改名/删除→标 stale 返回 null

**4. 扩展 `test/menutest.cjs`** —— 新菜单场景
- 新增场景"启动控制中心"，验 calls 标注、顺序、中文说明齐全

### 7.2 必须端到端/真机验证的（教训 12/13/14）

这些单测验不到，必须真跑。**交付前必跑清单：**

| # | 项 | 为什么单测验不到 | 怎么验 |
|---|---|---|---|
| E1 | **透明背景真的透壁纸** | 控制中心 CSS + ZCode 渲染交叉，纯函数测不到 | 真机：webview 加载控制中心，用 inspect-webview.cjs 查 body computed bg 是 transparent + 人眼看壁纸透出 |
| E2 | **/api/status 的 CDP 探查** | 真连 9222，跨进程 | 真机：ZCode 开着，curl /api/status，验 wallpaper.mode 反映真实注入状态 |
| E3 | **alpha 查询（transparent.ps1 -Query）** | Win32 + C#↔PS↔node 胶水（教训 3 同型） | 真机：设透明度，跑查询验读回值一致；逐字 dump PS 输出确认字段（教训 15） |
| E4 | **spawn 动作链** | server spawn inject.cjs，跨进程 + 命令链（教训 1） | 真机：点"移除"，验 inject.cjs 真被调（不是只验 server 返回 200），验下一轮 status 反映 none |
| E5 | **/control 无尾斜杠重定向** | 浏览器相对路径解析，跨层（教训 18a） | 真机：webview 加载 /control，验 CSS/JS 不 404 |
| E6 | **书架关联修复** | 涉及真实文件改名 + localStorage | 真机：novels/ 改文件名，验书架标 stale + 重拖关联 |

写法约定：端到端脚本放 `scripts/`（如 `scripts/inspect-control.cjs`），一次性、设完即退、可回读（教训 14）。

### 7.3 不测什么（避免测错层，教训 7）

- **不测 inject.cjs/transparent.ps1 内部**（已被现有 cdp-retry-test/probetest/transparenttest 覆盖）
- **不测 Win32 API 行为本身**（OS 行为，mock HWND 没意义）
- **不测浏览器渲染**（人眼/截图验，不写自动截图断言——教训 9）

### 7.4 回归保护

- 现有 `npm test` 全部保留，新增 4 个 test 文件加进 `package.json` 的 test 串联
- 关键回归用例：
  - "探查失败不致命" → 防一个子系统挂导致全白
  - "/control 重定向" → 防教训 18a 复发
  - "spawn 动作被真实调用" → 防教训 1 复发（server 看着对但 inject 没跑）
  - "alpha 查询只读" → 防查询误改窗口状态

---

## 8. 实现注意事项（来自 AGENTS.md 教训）

- **PowerShell 脚本一律 `-File` 跑**，不内联 `-Command`（bash 吞 `$xxx` 变量）。transparent.ps1 的 `-Query` 模式同样。
- **transparent.ps1 必须存 UTF-8 with BOM**（中文 + here-string，无 BOM 解析崩）。
- **`.bat` 保持 ASCII-only**（中文由 node 打印）；`.bat` 必须 CRLF 行尾；`.bat` 的 `if/for` 块内 echo 别写裸括号。
- **跨语言胶水（C#↔PS↔node）必端到端跑**：alpha 查询的 C# 拼字符串 ↔ PS 解析 ↔ node 接收，三段各自合法合起来可能错位（教训 3/12），必须真跑。
- **不改 inject.cjs / transparent.ps1 的动作逻辑**，只给 transparent.ps1 加只读 `-Query` 分支。status.cjs 复用 inject.cjs **已导出**的函数（`listTargets` 等），不侵入。
- **探测脚本优先**：遇到"为什么这个状态不对"，第一反应写探测脚本读真实 computed/state（教训 11），不靠脑子猜 DOM。
- **Windows 保留名文件**（`nul` 等）删除用 `\\?\` 前缀 + `.ps1 -File` 跑（bash 吞反斜杠）。

---

## 9. 文件清单（新增/修改）

### 新增
- `lib/control-server.cjs` —— 合并的常驻 HTTP server
- `lib/status.cjs` —— 纯只读查询模块
- `control/` —— 前端 SPA 目录（index.html / control.css / control.js / lib/）
- `control/lib/status-view.js` —— 状态渲染纯函数
- `control/lib/shelf.js` —— 书架管理
- `bin/control-center.bat` —— 独立常驻入口（对称 reader-server.bat）
- `scripts/inspect-control.cjs` —— 端到端验证脚本
- `test/statustest.cjs`、`test/controlservertest.cjs`、`test/shelftest.cjs`

### 修改
- `lib/transparent.ps1` —— 加 `-Query` 只读分支（不改设透明逻辑）
- `lib/reader-server.cjs` → 逻辑迁入 control-server.cjs（reader-server.bat 改为调 control-server，或保留为兼容入口）
- `lib/menu.cjs` + `wallpaper.bat` —— 新增"启动控制中心"场景（场景 13）
- `package.json` —— test 串联加新 test 文件
- `test/menutest.cjs` —— 加新场景断言
- `.gitignore` —— 若有新产物目录需忽略

---

## 10. 已知遗留 / 待真机确认

- **alpha 查询的 PS 字段索引**：transparent.ps1 现有 Dump 是 6 字段（教训 3 踩过的坑）。`-Query` 分支要么复用现有 Dump（注意字段索引），要么单独写一个精简的 alpha-only Dump。**实现时必须逐字跑输出确认**（教训 15）。
- **普通浏览器打开控制中心**：降级体验（没壁纸）。不做检测、不给提示（YAGNI，能用就行）。

### alpha 查询的多窗口处理（已定）

控制中心自动轮询**不能 read-host**（会卡住），所以 alpha 查询的多候选处理与设透明时不同：
- **控制中心在内存记"上次 setTransparent 的 hwnd"**（setTransparent 动作成功后 server 存下 hwnd）
- alpha 查询**只查这个 hwnd**（直接 `GetLayeredWindowAttributes`，跳过窗口枚举/选择）
- 没有记录的 hwnd（用户没通过控制中心设过透明）→ `transparent` 项返回 `{ enabled:false }`，前端显"未设透明"
- 这样彻底回避多窗口 read-host 问题，且 alpha 查询单 HWND 极快（不用枚举所有窗口）
