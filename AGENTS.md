# AGENTS.md — 项目记忆与工作约定

给接手这个项目的 AI（或人类）看的。读完再动手。

## 项目是什么

**zcode-wallpaper**：给 ZCode（Electron 应用）做定制的工具集，不改 `app.asar`。
**四种能力，三种不同层**：
- **图片 / 视频壁纸**：CDP（Chrome DevTools Protocol）注入 `<style>`/`<video>` 到 ZCode 主页面
- **窗口透明**：Win32 `SetLayeredWindowAttributes` 改 ZCode 主窗口 HWND 的 alpha
- **小说阅读器**：独立本地 HTTP server + 前端 SPA，ZCode 自带浏览器面板加载它（**不走 CDP，不注入主页面**）

启动链路（关键，调试时按这个顺序看）：

启动链路（关键，调试时按这个顺序看）：

```
wallpaper.bat                 总入口菜单（根目录）：场景化选择（新机器初始化 / 日常启动 / 换图重注入
                              / 只重注入 / 视频壁纸 / 移除 / 重装依赖），按场景调 bin/ 下的脚本，
                              跑完回菜单。ASCII-only cmd 循环，中文菜单由 lib/menu.cjs 打印。
bin/setup.bat  → lib/setup.cjs        装 sharp/ws 依赖
bin/resize.bat → lib/resize.cjs        wallpapers/*.jpg → wallpapers-thumb/*.jpg（2560px 缩图）
bin/start-zcode.bat           启动 ZCode(带 debug port) → 等待 page target → 调 lib/inject.cjs
                              可选参数 "video"：传 --video 给 inject.cjs，注入视频壁纸而非图片
lib/inject.cjs                CDP 连接 → Runtime.evaluate 注入。
                              - 默认（图片）：注入 <style>，body background-image = 随机缩图
                              - --video：注入 <style>(透明层) + 真实 <video> 元素（见下面"视频壁纸"）
                              - --remove：同时清掉 <style> 和 <video>，不管之前注的是图还是视频
bin/probe.ps1                 start-zcode/inject-only 共用的 debug-port 探测（同目录调用，见 bin/ 下两个 .bat）
bin/reader-server.bat         启动小说阅读器服务（**不走 CDP**）。`start` 开独立常驻窗口跑
                              lib/reader-server.cjs（HTTP server :17890，扫 novels/*.txt 切章供 API，
                              监听成功后把 URL 写剪贴板），关窗即停。
                              用户在 ZCode 自带浏览器面板（Electron <webview>）粘 URL 打开 reader。
                              和图片/视频/透明完全不同的子系统，见下面"小说阅读器"。
```

**路径约定**：`wallpaper.bat` 留在根目录当唯一双击入口；所有辅助 `.bat`（`setup`/`resize`/
`start-zcode`/`inject-only`/`start-transparent`/`transparent`/`reader-server`）和 `probe.ps1` 都在
`bin/` 下。每个 `bin/*.bat` 开头算出项目根 `set "WP_ROOT=%~dp0.."`，用它定位根下的 `lib/`；
`probe.ps1` 用 `%~dp0probe.ps1` 同目录调用。改这些 `.bat` 的路径定位时别破坏这个约定。

**这是一条命令链，每环的输出是下一环的输入。出问题时，先确认到底断在哪一环，别默认后面的环被调用了。**

## 环境注意（Windows + 这个 bash）

这个项目的 bash 环境加载了一个 profile，会**吞掉 PowerShell/JS 里的 `$xxx` 变量**（`$r`、`$t`、`$_` 会被替换成路径展开）。
导致 `powershell -Command "..."` 内联命令里的变量被破坏，报一堆奇怪的解析错误。

**对策**：PowerShell 脚本一律写成 `.ps1` 文件用 `-File` 跑，**不要**用 `-Command "..."` 内联。
（注意：`.bat` 里的 `powershell -Command` 不受影响，因为 .bat 走的是 cmd 不是 bash。）

---

## 核心教训：多层系统调试，先查组件边界，别在组件内部瞎钻

这是本项目踩过最大的坑，**务必读完**。

### 事故回放

用户报告"start-zcode.bat 启动后看不到壁纸"。AI 花了大量精力查 `inject.cjs` 内部：
CDP 连接、WebSocket 握手、retry 逻辑、DOM 验证、截图分析、持久性测试……
甚至给 inject.cjs 加了一整套 retry+verify 机制，写了针对性测试，全部通过。

**但问题根本不在 inject.cjs。** 真相是：`start-zcode.bat` 的 Step 3 等待条件写错了，
**`inject.cjs` 从头到尾没被调用过**。所有在 inject.cjs 上的工作都是对空气挥拳。

### 根因

`start-zcode.bat` 旧版第 52 行：

```bat
powershell -NoProfile -Command "...if(($t|Where-Object {$_.type -eq 'page'}).Count -gt 0){exit 0}..."
```

PowerShell 的 `.Count` 陷阱：当 `Where-Object` 只返回**单个对象**时，返回的是对象本身而非数组，
`.Count` 是 **null**，`null -gt 0` 永远 false → 永远 `exit 2` → 永远不 `goto inject` → inject.cjs 永不执行。
（冷启动后主界面只有 1 个 page target，正好触发单对象情况。）

修复：用 `@()` 强制数组化 —— `@($t|Where-Object {...}).Count`。

### 为什么会绕这么大的弯

**最明显的信号被忽略了**：用户每次贴的输出都**停在 `Step 3` 的 echo 之后**，
后面的 `Step 4: inject` 和 "Done" 提示**从没出现过**。这本该第一时间让人怀疑"inject 根本没跑"，
但 AI 却假设 inject 跑了，跳过去查它的内部逻辑。

### 规则（抄进脑子里）

1. **命令链出问题时，第一件事是确认断在哪一环。** 不是去深挖某一环的内部。
   - 用户输出停在 `Step 3` → 先查"Step 3 之后发生了什么 / inject.cjs 到底被调了没"。
2. **用户给的输出边界是最强信号。** 输出截断在哪一行，通常就是问题在哪一行附近。别跳过它。
3. **验证组件边界比验证组件内部优先级更高。** 在确认"A 调用了 B"之前，查 B 的内部没有意义。
4. **逐字复现可疑的那一行。** 这次根因是靠"把 .bat 第 52 行的 PowerShell 表达式原样拎出来跑"
   才发现的——跑出来 `.Count` 是空，瞬间定位。比看一百遍代码都有用。
5. **PowerShell 单对象 `.Count` 是 null。** 写 `Where-Object` 结果要数数量，永远包 `@(...)`。

### 二次事故（2026-06）：同一个 bug，第二个文件没修

第一次只改了 `start-zcode.bat`（第 52 行加 `@()`），**漏了 `inject-only.bat` 的同一段探测逻辑**。
用户"一直启动着 ZCode"（单窗口 = 单 page target = 正好触发单对象陷阱），双击 inject-only.bat，
输出 `Could not reach ZCode debug port after 30 tries` + `Port is open but no page window yet`（rc=2），
inject.cjs 再次完全没被调用。

**修复**：把探测逻辑抽成共享的 `probe.ps1`（带 `@()` 包裹），两个 `.bat` 都 `-File probe.ps1` 调它。
**根除重复**才是防再次发生的办法——两份拷贝就是两份能各自再坏一次的机会。

教训补丁：
6. **修一个 bug 时 grep 全代码库的同型写法。** "这段逻辑别处还有吗"必问。
7. **回归测试要测到出错的那个组件边界。** `cdp-retry-test` 测 inject.cjs 内部，抓不到 `.bat` 探测行；
   `probetest` 直接跑 `probe.ps1` 才钉死。测错层 = 没测。

---

## 核心教训 2：透明度旋钮对当前 ZCode UI 结构无效（2026-06）

第二次大坑。和第一个教训同型——**先验假设错了，后面全是白干**。

### 事故回放

用户想"让壁纸淡一点（字更清楚）"。AI 按 CSS 常识判断 `rgba(...,0.82)` 的 alpha
就是旋钮，于是 0.82 → 0.95 → 0.99 → 1.0 一路调。每次调完都截图分析，用户每次都说
"还是清晰可见，没变化"。一直调到 `1.0`（数学上完全不透明），壁纸**依然**清晰可见。

**这违背了 alpha 的定义。`alpha=1.0` 时背景必须 100% 不透明，壁纸绝不可能透出。**
事实和理论打架，说明"alpha 控制壁纸可见度"这个假设本身是错的。

### 根因（靠 `scripts/inspect.cjs` 查出来的）

壁纸挂在 **body 自己的 `background-image`** 上，body 的 `backgroundColor` 是透明。
而那些吃 `--color-background` 的 UI 面板（代码区容器、卡片等）**并不覆盖整个 body**：
面板之间的间隙、窗口上下边缘，以及任何没被实色面板盖住的 body 区域，壁纸都是
**100% 满强度裸露**。

`--color-background` 的 alpha 只控制"那些面板有多透明"，**但面板盖不满整个窗口**。
所以无论 alpha 是 0.82 还是 1.0，没被面板盖住的 body 区域永远是满强度壁纸——
肉眼根本看不出区别。整个"透明度旋钮"对这个 UI 结构基本无效。

`scripts/inspect.cjs` 的关键证据：
```
body.bgImage = url("...Chapter4_2_8K_34.jpg")   ← 壁纸在 body 上
body.bgColor = rgba(0, 0, 0, 0)                  ← body 背景透明
--color-background = rgba(18,18,22, 1.0)         ← alpha 确实生效了
elementsWithWallpaperBg = []                     ← 没有任何子元素有壁纸
```

### 决策

删掉 alpha 旋钮，改为**全屏透明模式**：body 铺满壁纸，所有 UI 背景变量和 Tailwind
背景类强制 `transparent`，让壁纸从底层全屏透出。要么全显要么不显，没有中间态。
（代价：字直接压在壁纸上，可读性只能靠选高对比、深色调壁纸解决，CSS 这层无能为力。）

**已知遗留**：侧边栏有一块实色深色背景是 ZCode 框架硬画的，不走任何我们覆盖的
变量/Tailwind 类，CSS 改不动。要彻底搞定只能从 JS 层在侧边栏元素上做运行时覆盖
——是个新坑，别默认 CSS 全搞定了。

### 规则补丁（抄进脑子里）

8. **用户说"改了没效果"，而且越改越没效果 → 立刻怀疑你改的参数根本不控制那个现象。**
   不要继续在同一参数上加大力度（0.95→0.99→1.0），那是赌徒加注。先停下来确认
   "这个参数到底控制什么"。
9. **CSS 变量被覆盖了、computed value 也确实变了，不代表视觉效果会变。** 中间隔着
   "哪些元素真的吃了这个变量 + 它们覆盖多大区域"两层。要验效果，必须看渲染结果
   （截图 / 人眼），不能只看 computed style 就宣称生效。
10. **理论打架时，相信事实。** `alpha=1.0` 却还能透出，按定义不可能——那一定是模型
    （"alpha 控制壁纸可见度"）错了，不是事实错了。
11. **找根因用探测脚本，别用脑子猜 DOM。** `scripts/inspect.cjs` 一次性把 body/各元素
    的 computed 背景全 dump 出来，3 行输出定位问题，比看十遍 wallpaper.css 有用。
    遇到"为什么这个 CSS 不生效"，第一反应写个探测脚本读真实 computed state。

---

## 核心教训 3：语法绿 + 单测绿 ≠ 真跑得通，必须端到端跑一遍（2026-06）

第三次大坑。和前两个同型——**"我以为验证过了"其实是没验证**。
专属于窗口透明模式（见下），但教训通用。

### 事故回放

`transparent.ps1` 写完后：`Parser.ParseFile` 语法 0 错误、`npm test` 全绿
（含 transparenttest 的 10 个纯函数 check）、`windowselect.cjs` 规则单测也绿。
按这些信号看，功能"应该"能跑。**于是 AI 上一轮直接交付，让你去人眼验。**

但人眼验之前应该先**真机跑一次**脚本本身。真机一跑：

```
[transparent] 进程 'ZCode' 在跑，但没找到可见顶层窗口。   ← exit 2
```

可独立探测明明显示 ZCode 有 1 个可见顶层窗口（hwnd 133212，1936x1048）。
**矛盾 = 模型错了。**

### 根因（靠逐字跑 C# Dump 输出查出来的）

`WinEnum::Dump` 的 C# 拼字符串：
```
h.ToInt64() + "|" + pid + "|" + cls + "|" + title + "|"
            + (r.Right - r.Left) + "x" + (r.Bottom - r.Top) + "|" + (owner...)
```
→ 5 个 `|`，**6 个字段，index 0-5**：`hwnd|pid|cls|title|WxH|ownerFlag`。

但 PS 解析写的是：
```powershell
$size = $p[5] -split 'x'    # ← index 5 是 ownerFlag("1")，不是 size
$toplevel = ($p[6] -eq "1") # ← index 6 越界 = $null，永远 false
```

`size` 拿到 `"1"` → `width=1, height=$null→0`；`toplevel=$null→false`。
候选全被 `Where-Object { toplevel -and width>0 -and height>0 }` 过滤掉 → 0 候选 → exit 2。
**C#/PS 两边的字段索引差一位**，单测里测的是纯 JS 函数（`windowselect.cjs`），
根本碰不到这段 C#+PS 的胶水代码，所以单测绿完全没抓住。

### 为什么语法检查 / 单测都抓不到

- `Parser.ParseFile` 只看 PowerShell 语法，`$p[6]` 是合法语法（越界访问返回 $null，不报错）。
- `transparenttest.cjs` 测的是 `windowselect.cjs` 的纯 JS 规则，**不碰 PS 的 `$line -split` 胶水**。
- 这段胶水（C# 拼字符串 ↔ PS 解析）是**跨语言边界**，没有任何测试覆盖它。

### 规则补丁（抄进脑子里）

12. **跨语言/跨进程的胶水代码（C#↔PS、PS↔bat、node↔bat）没有测试覆盖时，必须真机端到端跑一遍。**
    单测只能覆盖单一语言内的纯函数。C# 拼 `|` 然后 PS `-split` 这种，两边各自合法，
    合起来错位——只有真跑才抓得到。
13. **"语法 OK + npm test 绿"不等于"功能跑得通"。** 语法只管能不能 parse，单测只管测到的那层。
    没测到的层（胶水、bat 探测、Win32 调用）必须靠**真机 dry-run** 验，不能靠"看起来对"。
14. **真机验证用"设完即退、可回读"的模式。** transparent.ps1 现在就是设完 alpha
    立即退出，配合 `GetLayeredWindowAttributes` 把 alpha 读回来验——能用真窗口确认
    探测/Set-Alpha 生效，又不会卡死控制台。写类似的"会改系统状态"的脚本，默认做成
    一次性、可回读，避免阻塞监听（早期版本的热键循环 `GetMessage` 就是反例：它把
    调用方菜单一起卡死，验证也麻烦）。
15. **遇到"应该工作却不工作"，逐字跑可疑的那一段输出。** 这次根因是靠
    `WinEnum::Dump` 真跑出来数字段（`raw lines: 1`，`133212|21496|...|1936x1048|1` = 6 字段），
    再对照 PS 的 `$p[5]/$p[6]`，瞬间看出错位。和教训 1 的"逐字复现可疑行"同款手法。

---

## 核心教训 4：先查"环境有没有原生容器"，别默认要自己造（2026-06）

第四次大坑，做小说阅读器时踩的。和前三个同型——**先验假设错了，但这次错在"选错了
实现路径"而不是"参数不控制现象"**。

### 事故回放

需求："在 ZCode 里看小说"。第一反应是沿用项目现有能力——**CDP 注入浮层**（往 ZCode
主页面塞一个 `<div>` 阅读器）。调研 any-reader（VSCode 插件）时也默认"它用 webview，
我们没有 webview API，所以只能 CDP 注入"。

但真机探测 ZCode 的 DOM 结构时发现：ZCode **自带一个 Electron `<webview>` 浏览器面板**
（`data-testid="browser-webview"`，`partition="persist:zcode-embedded-browser"`），
而且用户实测它能加载本地 `file://` 和 `http://localhost`。**这意味着阅读器根本不用
注入浮层——直接写一个本地 HTML，让 ZCode 浏览器面板加载它就行**。复杂度降一个数量级。

### 根因

"在 X 里做 Y" 的需求，第一反应不该是"用项目现有的注入/修改手段"，而是**"X 有没有
原生支持 Y 的容器"**。这次 ZCode 原生就有浏览器面板（能加载任意 URL），用它加载
本地 reader HTML 是天然隔离的容器；而 CDP 注入浮层是次优解（事件穿透、层级、
localStorage 共享 origin 污染）。差点走错路。

### 规则补丁（抄进脑子里）

16. **"在 X 里做 Y" 先查 X 有没有原生容器**。想在 ZCode 里看小说，第一反应不该是
    "CDP 注入浮层"，而是"ZCode 有没有浏览器/webview 面板"。靠真机探测（CDP 列 target +
    dump `<webview>` 属性 + 用户实测加载）发现内置浏览器面板能加载本地 URL，直接把
    复杂度降了一个数量级。教训 1（先验假设错了全白干）和教训 10（理论打架信事实）的同型应用。
17. **跨环境共享代码不能时，共享测试**。server（Node）和前端（浏览器）各写一份 codec/toc，
    没法共用代码（运行时不同）。但能用**完全相同的测试用例**钉死两边行为一致。
    单测只覆盖单语言内的纯函数，跨环境胶水（这次是 codec 的两份实现）必须靠
    "同一套断言跑两份代码"来覆盖——否则一边改了另一边不知道（教训 12 同型）。
18. **"浏览器加载本地 SPA"有两个隐性陷阱，单测验不到，必须真机跑**：
    (a) **`/reader`（无尾斜杠）会让相对路径解析错位**：浏览器把 `/reader` 当文件名，
        `reader.css` 解析成 `/reader.css`（404）而不是 `/reader/reader.css`。所有 script
        加载失败 → JS 崩 → 静默无报错（书架空、顶栏还在）。server 必须 `/reader` → `/reader/`。
    (b) **前端 lib 只导 CommonJS 不挂浏览器全局**：`module.exports` 在浏览器里不生效，
        reader.js 调 `window.__readerProgress.getShelf()` 会因 undefined 抛错。前端 lib 必须
        同时 `module.exports`（Node 测）和 `window.__readerXxx = {...}`（浏览器用）。
    这两个都是"server API 全对、单测全绿、但 webview 里就是空"的典型——CDP 连 webview
    查 `window.__readerXxx` 类型 + shelf DOM 才定位。**真机验证必须查运行时全局状态，
    不能只看 server 返回**。
19. **正则/解析类的功能，必须用大批量真实样本测，不能只看手头两三本**。章节识别最初
    只拿凡人修仙传 + 回到明朝当王爷调，自以为覆盖全了；用户丢来 86 本起点完结小说批量
    跑（`scripts/batch-test-novels.cjs`），立刻暴露 12 本异常——"节"unit、"第一集第一章"
    无分隔粘连、"正文 第一章"前缀、"卷X"无"第"，全是不看大批样本想不到的格式变体。
    调到 v2（异常 12→4）也是靠批量脚本快速反馈。**写解析正则时，先找一批真实样本
    （几十上百个）批量跑，比盯着一两个样本调有用十倍**。教训 1（先验假设错了全白干）
    的同型：手头样本的"代表性"是假设，批量数据是事实。
20. **"守卫"防误匹的代价常大于误匹本身，谨慎加守卫**。v2 想加守卫防正文"翻开第一章"
    误入目录，条件是"章标记必须在行首或卷前缀后"——结果误杀了斗破苍穹"正文 第一章"、
    张三丰"外传 第一章"、横刀立马"江湖篇 第一章"等合法前缀，批量异常从 4 飙到 19。
    撤掉守卫回到"接受少量假阳性"，异常降回 4。**加防误匹守卫前，先算它会让多少合法
    case 漏掉（用批量脚本验），别只盯着它挡掉的假阳性**。两害相权取其轻，记录权衡
    （`readertoctest.cjs` 有用例钉死"接受假阳性"这个决策）。

---

## 视频壁纸（`--video` 模式）

图片壁纸之外的第二种背景：把 `.mp4`（等视频）当动态背景播。和图片走**同一个 `inject.cjs`**，
只是 MODE 不同——CDP 连接/重试/验证那套踩过坑的逻辑共用，**没有另写一个 inject-video.cjs**
（两份拷贝就是两份能各自再坏一次的机会，见核心教训 1 的二次事故）。

### 为什么不能复用图片的 CSS background-image

**CSS `background-image` 播不了视频。** 这是浏览器的硬限制，不是 ZCode 的事。所以视频模式
走一条**不同的注入路径**：往页面里塞一个真实的 `<video>` DOM 元素（`id=zcode-user-wallpaper-video`），
`position:fixed; object-fit:cover; z-index:-100` 沉到所有 UI 底下，`autoplay muted loop playsinline`，
IIFE 里再 `.play()` 兜底（muted+autoplay 在 Chromium/Electron 基本可靠，但显式 play() 防个别 build）。
html/body 强制 transparent 让视频从底层透出，外加复用 `wallpaper.css` 的 UI 透明层。

### 两个 id，一个 --remove

- `zcode-user-wallpaper` —— 图片模式注入的 `<style>`（视频模式也会注入它，放透明层 + 视频层 CSS）
- `zcode-user-wallpaper-video` —— 视频模式注入的 `<video>` 元素

**`--remove` 会同时清掉这两个 id**，不管之前注的是图还是视频。用户不用记自己用了哪个模式。
（之前 remove 只查 style id；视频模式下用户 remove 会发现 style 没了但 video 还在——这个坑
在 `selftest.cjs` 的 "remove cleans up BOTH" 测试里钉死了。）

### 视频从哪来（三种方式，优先级从高到低）

1. `ZCODE_WP_VIDEO` 环境变量 —— 指定**单个文件**的绝对路径，旁路随机选片（对称图片的 `ZCODE_WP_CSS`）
2. `ZCODE_WP_VIDEO_DIR` 环境变量 —— 指定一个**目录**，从中随机选一个视频
3. 默认 —— `<项目根>/wallpapers-video/`

空目录会打印提示并 `exit 0`（对称图片空目录的处理），不会注入。

### 中文路径 / 空格路径

视频 URL 走 `encodeFileUrl()`（百分号编码 path 部分，保留 `file:///` 前缀）。原始中文目录
（如 `ZCODE_WP_VIDEO_DIR=G:\新建文件夹\...`）能用，但**强烈建议把样本拷进 `wallpapers-video/`
并重命名成纯 ASCII**——`file://` 加载中文/空格路径在某些 Chromium build 上仍可能翻车，
编码只是兜底不是银弹。

### 菜单集成

菜单场景 7（启动带视频壁纸，一键）和 8（注入视频壁纸，ZCode 已开）是场景 2/4 的视频变体：
它们把字面量参数 `"video"` 传给 `start-zcode.bat` / `inject-only.bat`，后者转成 `--video` 传给
`inject.cjs`。不传参 = 图片模式（向后兼容）。

### 视频不缩放

`resize.cjs` **不碰视频**。Electron 直接播原文件，mp4 多大就吃多大。`wallpapers-video/` 里的样本
建议挑体积小的（本项目测试用的是 ~80-110MB 的短 clip）。

### 已知遗留（和图片模式同款）

侧边栏那块实色深色背景是 ZCode 框架硬画的，不走任何我们覆盖的变量/Tailwind 类，
**会盖住视频**（和盖住图片一模一样，见核心教训 2 的"已知遗留"）。要彻底搞定只能从 JS 层
在侧边栏元素上做运行时覆盖——是个新坑，别默认 CSS/视频层全搞定了。

---

## 窗口透明模式（看桌面）

第三种背景。和图片/视频**完全不同的层**：那俩是渲染层（CDP 注入 CSS/DOM），
透明是**原生窗口层**——用 Win32 `SetLayeredWindowAttributes` 把 ZCode 主窗口
HWND 设半透明，能透过窗口看桌面。**不走 CDP，不需要 debug port**。

### 为什么不能复用图片/视频的 CDP 路径

**CDP 改不了窗口透明度**（spec §2.1，查过 Electron + CDP 官方文档）：
- Electron 的 `transparent:true` 只在窗口创建时设，运行时不能切；
- CDP 的 `Browser.setWindowBounds` 只有位置/大小/最小化，没 opacity；
- `Emulation.setDefaultBackgroundColorOverride` 只让页面背景透明，底层还是
  ZCode 窗口的不透明底色——看到的会是深色底不是桌面。

所以透明走独立的 `lib/transparent.ps1`，不碰 inject.cjs，不碰 CDP。
**两个子系统的唯一共享是 `bin/launch-zcode.bat`**（启动 ZCode 的逻辑，
那是公共前提）。别把透明塞进 inject.cjs 当个 mode——那是错的复用对象
（核心教训 1 要避免的不是这种跨域的分离，而是同型写法的拷贝重复）。

### alpha 是整个窗口均匀半透明（跷跷板）

`WS_EX_LAYERED + LWA_ALPHA` 对**整个窗口**均匀生效——代码字、菜单、背景
**一起按同一比例变淡**。完全透明 = 看不见 ZCode，没法用。必然是中间值，
且字越清楚桌面越糊。这是核心教训 2 的同型坑：**别假设能"背景透明字清晰"**，
Win32 没这个 API。

### 三件套

- `lib/transparent.ps1` —— 探测窗口 + 设透明（**设完即退，无热键循环**）。参数
  `-Opacity 0-100`（直觉百分比，100=不透明，0=全透明），内部换算成 alpha 0-255；
  `-InitialAlpha 0-255` 为旧用法兼容（设了就以它为准）。`-ProcessName ZCode` 可覆盖。
- `bin/transparent.bat` —— 入口（对已开窗口）：提示输入透明度 0-100（默认 78），
  clamp + warn 越界/非数字（不用 re-ask 循环——`set /p` 循环在管道 stdin 下脆弱），
  调 `transparent.ps1 -Opacity <n>`。
- `bin/start-transparent.bat` —— 入口（一键启动，调 launch-zcode.bat 启动 ZCode，
  成功后调 transparent.bat 让你选透明度）。
- `bin/launch-zcode.bat` —— 从 start-zcode.bat 抽出的共享启动逻辑，
  透明模式用它"启动 ZCode 但不注入图片壁纸"。**根除重复**（核心教训 1），
  顺便修了 start-zcode"启动+注入焊死"的隐患。start-zcode.bat 重构后只剩
  Step 4 (inject) + hold，对外行为不变。

### 交互模型：设完就完（无热键）

**早期版本**曾用 `Ctrl+Alt+↑/↓/0` 热键循环（`RegisterHotKey` + `GetMessage` 阻塞）。
问题是热键循环把调用方 `wallpaper.bat` 菜单一并卡死——开了透明就没法选别的选项
（比如边透明边注视频壁纸的叠加组合做不到）。**已按用户要求移除热键循环**：
现在选场景 9/10 → 输入透明度 → 设上即返回菜单，菜单立即可用。要改透明度重跑，
要恢复输 100。**设完就完、无阻塞**是当前设计；如果以后要"运行时调"，再单独引入
独立窗口方案（不要回到阻塞主菜单的热键循环）。

### 窗口选择规则（PS 和 JS 必须一致）

`lib/transparent.ps1` 探测窗口的选择规则**必须**和 `lib/windowselect.cjs`
的 `selectMainWindow` 一致：pid 过滤 + visible + toplevel + 零面积过滤；
单候选自动选，多候选 read-host。规则抽到 JS 单测（`test/transparenttest.cjs`）
防 PS 侧漂移。Win32 调用本身不测（OS 行为）。

### `transparent.ps1` 必须存 UTF-8 with BOM（踩过的坑）

PowerShell 5.1 **无 BOM 时按本地 ANSI（中文 Windows 是 GBK）解析 .ps1**。
`transparent.ps1` 里有中文注释和 here-string，无 BOM 时中文字节被按 GBK 读，
here-string 分隔符 `@"..."@` 解析崩掉，整文件报一堆 C# 语法错。**必须有
UTF-8 BOM**（`EF BB BF`）。probe.ps1 靠**纯 ASCII**避开这个坑；transparent.ps1
有中文 echo/注释，只能靠 BOM。**改 transparent.ps1 时别用会剥 BOM 的工具存盘**
（比如某些编辑器"保存为 UTF-8"其实是 UTF-8 no-BOM）。验语法用 Parser.ParseFile：
```ps1
$e=$null; [System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$null,[ref]$e); $e
```

### 已知遗留

- **多窗口可能选错**：DevTools 最大化时面积可能超主窗口。多候选时 read-host
  让用户选（对齐 ambiguous 分支），但每次重跑要重选（不持久化，YAGNI）。
- **窗口重建丢透明**：ZCode 重启后 HWND 变了，重跑 transparent.bat。
- **和图片/视频叠加**：透明不碰 CDP，所以可叠加（半透明窗口 + 里面有壁纸）。
  这是允许的。`--remove`（场景5）只清 CDP 注入，不影响窗口透明；要关透明跑
  `transparent.ps1 -Opacity 100`（或场景 10 输 100）。
- **进程名不确定**：默认 `-ProcessName ZCode`，找不到时提示用户
  `Get-Process` 看真实名再用 `-ProcessName <真实名>` 覆盖（Electron 应用进程名
  可能是别的）。
- **管道 stdin 测不出菜单链里的二次 `set /p`**：直接跑 `transparent.bat` 喂数字
  正常，但 `wallpaper.bat → 场景 10 → transparent.bat` 链式 + 管道喂两个数字时，
  第二个 `set /p`（透明度）会读到默认值。**真实交互（键盘）无此问题**——
  `set /p` 跨 `call` 读键盘是可靠的，只是管道 stdin 跨 call 不可靠。所以这个
  只影响自动化测试，不影响用户双击使用。真机验证要靠键盘，不能只靠管道。

### PowerShell 必须写 .ps1（环境注意，复述）

`lib/transparent.ps1` 一律 `-File` 跑，绝不内联 `-Command`——bash 会吞掉
PS 里的 `$hwnd`/`$alpha`/`$_` 变量（见上面"环境注意"）。`.bat` 里的
`powershell -Command` 不受影响（走 cmd 不是 bash）。

---

## 小说阅读器（在 ZCode 里看小说）

第四种能力。和前三种**完全不同层**：图片/视频是 CDP 注入渲染层，透明是原生窗口层，
阅读器是**独立子应用**——本地 HTTP server + 前端 SPA，ZCode 自带浏览器面板加载它。
**不走 CDP，不碰 inject.cjs，不改 ZCode 任何状态**。

### 为什么不复用 CDP 注入

CDP 注入是把 DOM/CSS 塞进 ZCode 主页面。阅读器需要"完整独立的阅读环境"（书架、
目录、滚动、进度），塞进主页面会有事件穿透/层级/localStorage 污染问题。而 ZCode
**自带浏览器面板**（Electron `<webview>`，`data-testid="browser-webview"`，
`partition="persist:zcode-embedded-browser"`）正好是独立渲染进程、独立 storage——
**用它加载本地 reader URL 是天然隔离的容器**。这是真机探出来的（CDP 探测 + 用户
实测 `file://` 和 `http://localhost` 都能加载），不是设计猜的（见核心教训 4）。

### 三组件，互不耦合

- `lib/reader-server.cjs` — HTTP server，扫 `novels/`、章节切分、供 API。**不依赖 inject.cjs**
- `reader/` — 前端 SPA，双模式（`http:` 走 server fetch，`file:` 走拖拽兜底）
- `bin/reader-server.bat` — 独立常驻入口，不进 `wallpaper.bat` 的用完即走流程

### 双模式设计（server 主 + 拖拽兜底）

reader 检测 `location.protocol`：
- `http:` → fetch `/api/...`（完整书架、自动重连）
- `file:` → 拖拽 `.txt` + FileReader（server 没启时的退化，永远能用）

两种模式都已真机验过（核心教训 4 的验证清单）。

### 章节切分在 server 不在前端

761 万字不能全量塞 DOM。server 启动时一次性解码 + 正则切章（卷/章两级），
只把"当前章的段落数组"发给前端。前端永远只持有一章。

### 编码：fatal UTF-8 是关键

中文 txt 无 BOM、GB18030 为主。区分 UTF-8 vs GB18030 的决定性手段是
`new TextDecoder('utf8',{fatal:true})`——非严格 UTF-8 解 GBK 会得一堆 U+FFFD 但不报错，
fatal 模式第一个非法字节就抛，捕获后转 GB18030。**前后端各一份 codec**
（server `lib/reader-codec.cjs` + 前端 `reader/lib/codec.js`），跨环境无法共享代码，
靠**同一套测试用例**（`readercodetest.cjs` + `readercodetestweb.cjs`）钉一致。
这是核心教训 3/4（跨环境胶水靠共享测试）的直接应用。

### server 端口冲突自增

`EADDRINUSE` 时自动 +1（17890→17891…最多 5 次）。**剪贴板必须在 listen 成功后写**
（拿到实际端口），否则会写进去被占的旧端口——这是 spec 自审抓到的时序约束。
`readerservertest.cjs` 专门钉死这个回归（占一个端口再起 server，验它换到 +1）。

### 路径陷阱：`/reader` 必须重定向到 `/reader/`

浏览器把 `http://host/reader` 当成"名为 reader 的文件"，所以 HTML 里相对路径
`reader.css` / `lib/codec.js` 会解析成 `/reader.css` / `/lib/codec.js`（**404**），
而不是 `/reader/reader.css`。server 必须 `/reader` → 302 `/reader/`（带尾斜杠），
相对路径才正确解析到 `/reader/` 下。**这是真机踩的坑**（书架空 + JS 全 undefined，
见核心教训 4），`readerservertest.cjs` 有断言钉死。

### 前端 lib 必须同时挂 CommonJS 导出 + 浏览器全局

`reader/lib/{codec,toc,progress}.js` 要**两边都能用**：
- Node 测试 `require()` 它们 → 需要 `module.exports`
- 浏览器 `<script>` 加载 + reader.js/book.js 用 → 需要 `window.__readerXxx = {...}`

只导 CommonJS 会导致 webview 里 `window.__readerProgress` 是 undefined → renderShelf 崩 →
书架空。**这也是真机踩的坑**（核心教训 4）。`book.js` 用 IIFE 挂全局是对的，
codec/toc/progress 当初漏了浏览器分支，已补。

### 不偷偷后台常驻

`reader-server.bat` 用 `start "..." cmd /k node ...` 开**独立可见窗口**。关窗即停。
不学某些工具的"装完偷偷开机自启"——显式常驻、显式停止。

### 调试 webview 的 ws URL 坑

CDP `/json` 返回的 webview `webSocketDebuggerUrl` 是 `ws://localhost/devtools/page/XXX`
（**无端口，默认 80 连不上**）。任何脚本连 webview（如 `scripts/inspect-reader.cjs`、
`test-reader-flow.cjs`）都要把 `ws://localhost` 重写成 `ws://127.0.0.1:9222`。
不带端口这个坑只在连 webview target 时出现（page target 的 wsUrl 带端口）。

### 已知遗留

- **最后一章吞后记/番外**：parseTOC 末章 `endOffset = text.length`，没有"第X章"标题
  的内容（后记、番外、网站声明）全被并进最后一章（实测样本最后一章 29278 段 / 147 万字）。
  修复思路：末章 endOffset 用"明显分界"（如"（全书完）"、"——后记——"）而非 text.length。v2。
- **章节识别覆盖 ~95% 常见格式，剩 4 类罕见格式不支持**（批量测 86 本起点完结小说，
  v2 把异常从 12 本降到 4 本，这 4 本是边缘格式，YAGNI 不再硬磕）：
  1. **纯数字编号无"第X章"词**：如战国福星大事记 `第一卷 尾张纪事 1. 沧海桑田`、
     `2、我是谁？`。正文里也大量有数字列表，加正则会海量误匹，得不偿失。
  2. **易经卦名当卷名**：红尘有梦 `第一卷乾，九二，见龙在田` —— 卷名含卦象辞，
     被当成正文引用杂质过滤掉（或反之混入）。极罕见。
  3. **整本文件无换行**：021我们是冠军 / 102龙战星野 / 047网游之职业人生 这 3 本
     整个文件是**一长行**（可能源文件损坏或被压成单行）。parseTOC 按行 split，
     单行文件只能识别 1 章。这不是正则问题，是文件格式问题——要支持得先按段落
     （句号/全角空格）二次切分，另案。
  4. **body-mention 假阳性**（v2 主动接受的代价）：正文里"他翻开第一章看了看"
     会被当成一个（假）章节进目录。因为守卫（要求章标记在行首或卷前缀后）会
     误杀"正文 第一章"/"外传 第一章"/"江湖篇 第一章"等合法前缀，代价更大。
     假章节在目录里可见，用户能识别跳过。测试 `readertoctest.cjs` 有用例记录此权衡。
- **重命名文件进度跟丢**：bookId 是 filename hash，改名后变新 id。书架旧条目显示
  "重新拖入关联"，可点重拖关联（不做路径模糊匹配，YAGNI）。
- **侧边栏硬画背景不影响本子系统**：阅读器在 webview 独立渲染进程，不共享 ZCode 的
  CSS 变量——这是本设计相对壁纸方案的额外优势（见核心教训 2 的"已知遗留"对壁纸的影响，
  阅读器无此问题）。

---

## 测试

`npm test` 跑：selftest → cdp-mock-test → cdp-retry-test → setuptest → resizetest → probetest → menutest → transparenttest → readertoctest → readercodetest → readercodetestweb → readertocwebtest → readerprogresstest → readerservertest。
改任何 `.cjs` 或 `.bat` 逻辑前先确保这堆绿的。

`menutest.cjs` 测 `lib/menu.cjs` 的 `renderMenu()` 输出：10 个场景 + 退出项齐全、顺序对、
每个场景的中文说明和"调用哪些脚本"标注都在、7 个底层脚本名至少出现一次。
防止菜单被人改坏（删场景、改错调用链说明）却没人发现。
（场景 7/8 是视频壁纸变体，calls 标注是 `start-zcode(video)` / `inject-only(video)`；
场景 9/10 是窗口透明模式，calls 标注 `start-transparent` / `transparent`。）

`transparenttest.cjs` 测 `lib/windowselect.cjs` 的 `selectMainWindow` 纯函数：pid/visible/
toplevel/零面积过滤、单候选自动选、多候选返回 `{ambiguous, candidates}`（按面积降序）。
规则是 `lib/transparent.ps1` 探测窗口的 JS 镜像——**PS 侧规则必须和这里一致**，
抽出来单测防漂移。Win32 调用本身不测（OS 行为，mock 真 HWND 没意义）。
这和 probetest 同思路：钉死可纯函数化的那一层。

`selftest.cjs` 现在还覆盖视频模式：`buildVideoExpression()` 的输出含 `<video>` 元素创建、
src/autoplay/muted/loop/playsinline、`.play()` 兜底；以及 **`--remove` 同时清掉 `<style>` 和
`<video>` 两个元素**（不管之前注的是图还是视频）。`listVideos` / `encodeFileUrl` 也有纯函数测试。

`cdp-mock-test.cjs` 现在多跑一条 `inject.cjs --video`：mock 不用改（视频表达式返回 `'ok'`、
verify 沿用 `'effect'`/`'noeffect'` 哨兵），但会断言 mock **确实收到了 `<video>` 创建指令和
文件 URL**，且**没收到图片模式的 `background-image: url(...)` 规则**——钉死 MODE 路由不会
串台。注意：mock 对 verify 哨兵和 remove 动作的检测用的是**宽松匹配**（正则 `'present'\s*:\s*'gone'`、
子串 `'removed'`），不是逐字符匹配，因为表达式的内部空格/措辞是实现细节，不该让 mock 脆断。

`cdp-retry-test.cjs` 是为第一次事故加的回归测试：mock 故意拒掉前 3 次 WS 握手，
验证 inject.cjs 的 retry 能恢复。模拟冷启动握手失败场景。
**注意**：它只覆盖 inject.cjs 内部，不覆盖 `.bat` 的探测行——见下面 `probetest`。

`probetest.cjs` 是为**第二次同型事故**加的（见下）：起一个 mock `/json`，
用单 page target / 多 page target / 无 page target / 端口不通四种 case 跑 `probe.ps1`，
验证退出码 0/0/2/1。专门钉死 PowerShell `.Count` 单对象陷阱。

## 改动惯例

- `.bat` 保持 ASCII-only（中文由 node 自己打印）。
- **`.bat` 里 `if (...)` / `for (...)` 块内的 `echo` 别写裸 `(`/`)`**。cmd 解析整个
  括号块时（哪怕条件不满足、不执行），echo 文本里的未转义 `(` 会被当成嵌套块开始，
  在最近的 `)` 后报 `X was unexpected at this time`，**中止整个脚本链**（包括调用方）。
  这是踩过的坑（`start-transparent.bat` 的 `echo ... (rc=!rc!) ...` 在 `if not rc==0 (...)`
  块里，rc=0 不执行那个分支照样炸，把场景 9 整条链炸断 + wallpaper.bat 闪退）。
  **写法**：块内 echo 要么不带括号，要么用 `^(` `^)` 转义（仓库里 `inject-only.bat:55`、
  `resize.bat:37`、`setup.bat:37` 都是 `^(rc=%rc%^)` 这个规范）。新增/改 .bat 时 grep
  一遍 `if.*\(` 下的 echo 行，确认没裸括号。
- **`.bat` 文件必须用 CRLF 行尾**。编辑器/工具默认存 LF 时，cmd 会把整文件当成"一行"
  乱解析（`chcp 65001 >nul` 被拆成 `chcp`/`cp` 报错、`setlocal` 变 `tlocal` 等一堆怪错，
  脚本完全跑不起来）。这是踩过的坑（编辑器存了 LF 的 transparent.bat，双击直接崩）。
  **写法**：改完 .bat 用 `[IO.File]::ReadAllBytes` 检查有没有 `0D 0A`；只有 LF 就转 CRLF
  （见 `bin/` 下已提交的 .bat 都是 CRLF）。`.ps1` 不受此限（PowerShell LF/CRLF 都吃），
  但 `.ps1` 有中文时**必须 UTF-8 with BOM**（见上面"窗口透明模式"章节的 BOM 段）。
- 新增逻辑加测试（参照现有 `*test.cjs` 风格，纯函数抽出来单测）。
- Windows 保留名文件（`nul` 等）删不掉时，用 `[System.IO.File]::Delete('\\?\C:\...\nul')`。
  **注意**：这个 `\\?\` 前缀里有反斜杠，**绝不能塞进 bash 里的 `powershell -Command "..."`**——
  bash 会吞掉反斜杠（见上面"环境注意"）。必须写成 `.ps1` 文件用 `-File` 跑（见 `del-nul.ps1` 的写法，
  虽然那是一次性脚本没进仓库）。另外 `Test-Path` 对 `\\?\nul` 这种路径会撒谎（把 `nul` 当设备名），
  要直接 `try { Delete } catch`，别先 Test。
