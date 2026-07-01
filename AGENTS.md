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

**`.bg-input` 覆盖范围比预期广（2026-06 补）**：wallpaper.css 第 4 段把
`.bg-input` / `.focus-within:bg-input-focused` 强制透明，原本只为让**会话输入框**
透壁纸，但真机发现它顺带让**设置界面的输入框/控件区**也透了（`.bg-input` 全页命中
4 个元素，跨会话框 + 设置面板）。这次是正面收益（一次覆盖多处生效），但反过来也成立：
如果以后 ZCode 某个**不该透明**的输入框（比如需要强对比的弹窗、确认对话框）也吃
`.bg-input`，会被一并误伤。动这层时先 `document.querySelectorAll('.bg-input')`
扫一遍当前命中范围，别默认它只管会话框。改完用 `scripts/inspect-input.cjs` 回归
（读输入框整条祖先链的 computed bg，钉死"无实色元素"）。

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

## 核心教训 5：别信"应该能透/应该能滚"，用探测脚本读真实 DOM 状态（2026-06）

第五次大坑，做控制中心时连续踩的。和前四个同型——**先验假设错了（"应该 X"），全白干**。
这次一连三个子坑，全靠**探测脚本读真实 computed state / getBoundingClientRect** 才定位，
没有一个靠读代码或猜猜出来的。

### 子坑 A：webview 能不能透壁纸

brainstorm 时我断言"webview 必盖壁纸"（基于 CSS 常识），又有人说"reader 能透"。
两个都是猜。`scripts/inspect-webview.cjs` 一跑：**webview 元素及整条祖先链全是 `rgba(0,0,0,0)`**
（wallpaper.css 设 transparent 的效果），是**页面自己**画实色背景盖住。结论：页面写
`background:transparent` 就透。控制中心的整个 A1 设计依据是这个探测，不是任何 CSS 常识。

### 子坑 B：目录滚不到当前章（offsetParent 链走不通）

reader 展开侧栏，目录不滚到当前章。我连改三版：`scrollIntoView` → `offsetTop` 沿 offsetParent
链累加 → `getBoundingClientRect`。前两版都失败，因为：
- `scrollIntoView`：`#toc-list` 是 `overflow:visible` 且 `scrollHeight==clientHeight`，**它不能滚**
  （真正能滚的是 `#sidebar`）——探测 `tocOverflowY: "visible"` 才知道
- `offsetTop` 链：`.chap.offsetParent` 是 `BODY` 不是 `#sidebar`，**链根本走不到 #sidebar**，
  累加结果是错的（滚到 71 章而非 5 章）——探测 offsetParent 链才知道
- 最后用 `getBoundingClientRect` 差值（`cur.top - sidebar.top`，视口坐标，天然包含书架区偏移），
  探测验证"第五章居中位置 292 ≈ 理想 293"才确认。

用户的一个猜想（"目录不只有当前书，还有书架占了空间"）也帮了忙——指向了"书架区在 #sidebar
里占了滚动空间"这个被忽略的事实。

### 子坑 C：自动打开面板（驱动地址栏）

想让 start.bat 自动在 ZCode 浏览器面板打开控制中心。合成 `keydown Enter` 不触发导航
（React 表单不认合成键盘事件）——探测发现地址栏在 `<form>` 里，`form.requestSubmit()` 才行。
又发现"展开侧边面板"按钮在 git working tree 脏时会打开**审查面板**而非浏览器（用户发现的）。
最终因为边界太常见（用未合并分支就一直触发）放弃自动打开。

### 规则补丁（抄进脑子里）

21. **"应该能 X"是假设，用探测脚本读真实 state 是事实。** webview 能不能透、元素能不能滚、
    事件监不监听——全靠 `getComputedStyle`/`getBoundingClientRect`/`offsetParent` 探测，别用
    CSS 常识或"应该"推理。教训 11（探测脚本优先）的第三次重演。
22. **offsetParent 链不可靠（可能通向 BODY 而非你以为的容器），跨元素定位用 getBoundingClientRect 差值。**
    `cur.top - container.top` 是视口坐标差，自动包含中间所有元素（书架区、padding）的偏移，
    不依赖 offsetParent 关系。
23. **合成 DOM 事件（keydown/click）经常不被框架认，用框架的原生提交路径（form.requestSubmit）或 CDP Input 域。**
    React 表单不监听合成 KeyboardEvent；要模拟"回车提交"，`form.requestSubmit()` 才可靠。
24. **"展开/收起"这类通用按钮可能随上下文切换目标。** ZCode 的"展开侧边面板"在 working tree
    脏时展开审查面板、干净时展开浏览器面板——同一按钮不同结果。靠它做自动化不可靠，
    要找**专属**触发器，或接受不可靠降级。
25. **用户给的输出边界 + 用户自己的猜想，都是强信号，别忽略。** 这次子坑 B 用户一句"目录不只有
    当前书还有书架"直接点向根因；子坑 C 用户发现"树脏时开审查"纠正了我所有受污染的探测。
    和教训 1（用户输出边界是最强信号）同型。

---

## 视频壁纸（`--video` 模式）

图片壁纸之外的第二种背景：把 `.mp4`（等视频）当动态背景播。和图片走**同一个 `inject.cjs`**，
只是 MODE 不同——CDP 连接/重试/验证那套踩过坑的逻辑共用，**没有另写一个 inject-video.cjs**
（两份拷贝就是两份能各自再坏一次的机会，见核心教训 1 的二次事故）。

### 为什么不能复用图片的 CSS background-image

**CSS `background-image` 播不了视频。** 这是浏览器的硬限制，不是 ZCode 的事。所以视频模式
走一条**不同的注入路径**：往页面里塞一个真实的 `<video>` DOM 元素（`id=zcode-user-wallpaper-video`），
`position:fixed; object-fit:cover; z-index:-100` 沉到所有 UI 底下，`autoplay loop playsinline`，
IIFE 里 `play()` 试播（成功有声，失败自动降级 muted 重播——见下面"默认有声"小节）。
html/body 强制 transparent 让视频从底层透出，外加复用 `wallpaper.css` 的 UI 透明层。

### 默认有声 + 自动降级 muted（2026-06）

视频壁纸**默认有声**。`buildVideoExpression`（`lib/inject.cjs`）不再强制 `muted`：
创建 `<video>` 后直接 `play()`，`then` 成功就保持有声；`catch` 失败（Chromium autoplay
策略拒绝 unmuted 自动播放）回退 `muted=true` + `play()` 重播，**保证至少有画面**。

让 unmuted 视频能免"用户手势"自动播放靠启动 flag：`bin/launch-zcode.bat` Step 2 的
`ProcessStartInfo.Arguments` 带 `--autoplay-policy=no-user-gesture-required`。**只改这一处**，
三条启动链（start-zcode / start-transparent / start.bat）都带上（根除重复，教训 1 二次事故）。

> ⚠️ **假设必须真机验**（教训 21）：Electron 是否透传这个 flag、ZCode 是否用 `webPreferences`
> 覆盖——不能靠常识判断。实施时第一步就是探测验证（spec §5.2 真机清单第 1 条）。万一
> flag 不生效，"默认有声"目标无法达成，得回退方案 B（用户手势路线，另开 spec）。

### 实时切静音（lib/video-mute.cjs）

开会/录屏想静音，不重建 video 元素（不闪屏）。控制中心点"🔇 静音"/"🔊 取消静音" →
server `/api/action muteVideo/unmuteVideo` → `lib/video-mute.cjs` 的 `setVideoMuted(muted)`
遍历 page targets，对每个调 CDP `Runtime.evaluate` 改 `video.muted` 属性。

**为什么独立模块不在 cdp.cjs**：cdp.cjs 是**只读模块**（AGENTS.md 明确，
`filterTargets/listTargets/connect/probeWallpaperMode`）。实时切是**写操作**，塞进去
破坏只读定位。但 `cdp.connect`/`cdp.listTargets` 是中性工具（连接+列举），video-mute.cjs
**复用它们**而非重写 CDP 胶水（教训 1：复用连接逻辑，不是复用"只读"语义）。

**单一权威**：`video.muted` 是 DOM 真实属性。状态读取（cdp.cjs `probeWallpaperMode`）和
写入（video-mute.cjs `setVideoMuted`）都直接操作 DOM，**不另设 server 内存变量**——
避免两份状态漂移（教训 1 同型）。

**inject 后声音重置**：mute 后换视频（重新 inject）会变回有声。因为 inject 会重建 video
元素，新元素按 §"默认有声"机制 unmuted 试播。mute 状态不跨 inject 持久化（不做 localStorage
偏好，YAGNI——声音是临时状态，不像书架/书签是用户数据）。

**视频→图片切换必须停掉旧视频的声音**（2026-06 真机抓到的 bug）：用户先注入视频壁纸
（有声），再注入图片壁纸——画面切到图片了，**但旧视频的声音还在响**。根因：图片注入的
`buildExpression("inject", ...)` 原本只清旧的 `<style>`，**不清旧的 `<video>` 元素**，所以旧视频
留在 DOM 里继续播放（声画不同步）。修复：图片注入前也清掉 `VIDEO_EL_ID`，和 `--remove` /
视频注入对称（见下面"三个清理点，一个目标"）。**单测当时漏了"视频→图片"这个 case**（只有
图→图、video 注入、remove 清两个），所以 bug 溜进来了——`selftest.cjs` 的 Test 4e + `cdp-mock-test.cjs`
的第 5 步是为此加的回归。教训 1 的 N 次重演：同型清理逻辑只在 2/3 路径上有 = 第三条能各自再坏。

### 三个清理点，一个目标（原"两个 id，一个 --remove"）

- `zcode-user-wallpaper` —— 图片模式注入的 `<style>`（视频模式也会注入它，放透明层 + 视频层 CSS）
- `zcode-user-wallpaper-video` —— 视频模式注入的 `<video>` 元素

**三条清理路径都必须同时清掉这两个 id**（不管当前注的是图还是视频）：
1. `--remove`（`buildExpression("remove", ...)`）—— 用户显式移除
2. 视频注入（`buildVideoExpression`）—— 先清旧 style + 旧 video，再建新的
3. **图片注入（`buildExpression("inject", ...)`）—— 先清旧 style + 旧 video，再建新 style**
   （2026-06 补：原本只清 style，导致"视频→图片切换声音残留"，见上面"视频→图片切换"小节）

用户不用记自己用了哪个模式、从哪个模式切过来。任一注入/移除路径都保证两条腿走路。
（历史坑：remove 原本只查 style id → 视频模式 remove 时 style 没了但 video 还在；
图片注入原本只清 style → 视频→图片切换时声音残留。两个坑都已用测试钉死，见下。）

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

**前言/后记识别只在 server 端**（`lib/reader-toc.cjs`，spec 2026-06-19-frontmatter-backmatter）：
楔子/序/书籍介绍等前言、尾声/番外/后记/感言/（全文完）等后记会切成独立章节。
前端 file 兜底模式的 `reader/lib/toc.js` **没有**这层——它只做基础卷/章切分。
这是有意的：file 模式是降级兜底，前言/后记是锦上添花，不值得为兜底模式也镜像一份
（两份能各自再坏一次，教训 1）。改 reader-toc 的前言/后记逻辑时**别**指望前端 toc.js
跟着变——它是独立实现，靠 `readertoctest.cjs`（server）+ `readertocwebtest.cjs`（前端）
两套测试分别钉。前端那套测试用例是有意不含前言/后记的。

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

- **~~最后一章吞后记/番外~~（已修复 2026-06-19）**：parseTOC 现在识别前言 + 后记/番外。
  - **前言**：第一章之前 ≥5 行或 ≥200 字的内容作独立前言章节，标题用原文标记词
    （楔子/序/书籍介绍…），回退"前言"。<5 行不生成（斗破苍穹/纨绔才子的开头简介太短）。
  - **后记**：末章正文里的标记词（尾声/番外/后记/感言/（全文完）/（全书完）/全书终…）
    切出独立后记章节。标记词须**独立成行或行首+标点**（守卫，防"全文完成XX任务"误匹，
    教训 20）。
  - **遗留（边界 A，回到明朝型）**：末章正文里**没有任何后记标记词**时无法切分——
    无法可靠区分正文结尾与作者感言，强切误伤风险高于收益（教训 20）。回到明朝当王爷
    的末尾只有 `※※※` 站点广告 + 作者感言，无 `尾声`/`（全文完）` 类词，后记仍并进末章。
    测试 `readertoctest.cjs` 有用例钉死此权衡（spec 2026-06-19-frontmatter-backmatter）。
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

## 控制中心（带界面的统一控制台）

第五种能力。把前四种（图片/视频壁纸、窗口透明、阅读器）收进**一个带界面的面板**。
和前四种**完全不同的层**：那四种各自改 ZCode 某一面，控制中心是个**统一操作台 + 状态显示器**。

### 为什么不是又一个 inject mode

控制中心不是"往 ZCode 塞个新东西"，而是**给已有的四个子系统套一个 UI**。核心原则
（spec 定的，两轮审查后固化）：**控制中心是「触发器 + 状态显示器」，绝不重写任何子系统的
动作逻辑**。动作全靠 spawn 现有命令（`inject.cjs`/`transparent.ps1`/`resize.cjs`/`setup.cjs`），
只新增「查询」能力（且查询抽成共享模块）。两份动作逻辑 = 两份能各自再坏一次的机会（教训 1）。

### 四个组件

- `lib/control-server.cjs` —— 合并的常驻 HTTP server。由 `reader-server.cjs` 演进：
  静态托管 `control/` + `reader/`、小说 API（从 reader 迁入）、`/api/status`（轮询）、
  `/api/action`（触发）、`/api/job/:id`。`reader-server.cjs` 现在是**兼容 wrapper**
  （导出 createServer 委托 control-server），`test/readerservertest.cjs` 不动。
- `lib/cdp.cjs` —— **只读** CDP 共享模块。`filterTargets`/`listTargets`/`connect`/`probeWallpaperMode`。
  `inject.cjs` 也改 `require('./cdp.cjs')` 复用（消除两份 CDP 胶水）。**背景**：spec 原写"复用 inject.cjs
  已导出的 listTargets"是事实错误——它根本没导出（核实 inject.cjs 导出列表无 listTargets/connect/verifyExpression）。
- `lib/status.cjs` —— 纯只读状态查询。`snapshot()` 返回 5 项快照（ZCode/壁纸/透明/阅读器/资源），
  **探查失败不致命**（单项 null + `_meta.probeErrors`，整体仍 200）。透明走状态机（见下）+ 500ms 缓存。
- `control/` —— 前端 SPA。`body{background:transparent !important}` 让壁纸透出（A1：页面自带透明 CSS，
  不依赖壁纸已注入）。浮动控件 + 书架管理。前端 lib 双导出（CommonJS + `window.__ccXxx`）。

### 透明透壁纸的机制（实测确认，纠正了 brainstorm 里的误判）

brainstorm 过程中有两个误判被 `scripts/inspect-webview.cjs` 纠正：
- 误判 A："webview 必盖壁纸" → 错。**webview 元素及整条祖先链全是 `rgba(0,0,0,0)`**
  （wallpaper.css 把 `--color-background` 设 transparent 的效果），壁纸能透到 webview 后面。
- 误判 B："reader 能透壁纸所以 webview 能透" → 错。reader 其实有自己的实色底（reader.css 主题色），
  没透。**真相**：页面自己写 `background:transparent` 就能透壁纸——控制中心的设计依据。

### CDP target 过滤（spec §5.4）

控制中心和 reader 自己跑在 ZCode webview 里，**它们也是 page target**。不过滤会：
① status 把它们算进 `pageTargets`/`injectedWindows`；② inject 误注入工具页。
`cdp.cjs` 的 `filterTargets` 按**路径前缀**（`/control/`、`/reader/`、`/api/`）+ host localhost/127.0.0.1
**任意端口**排除（不按端口——standalone inject.cjs 不知道 server 端口，端口漂移也要正确排除）。
**remove 也走过滤**（不做 mode-aware：工具页从不会被注入，"旧版本残留"是假想场景，YAGNI）。

### 透明状态机（spec §10，单一权威定义）

控制中心轮询**不能 read-host**（会卡住）。server 内存记"上次 setTransparent 的 hwnd"
（设透明加 `-Json` 输出 hwnd，server 解析存下）。查询决策树：
- 有 hwnd → `transparent.ps1 -Query -Hwnd <n>` 直接查（快、准）
- 无 hwnd（server 重启/用户从旧菜单设的）→ `-Query -ProcessName ZCode` 兜底（多候选自动选面积最大，**不 read-host**）
- ZCode 没开 / 窗口明确未 layered → `enabled:false`（**确定**）
- ZCode 开着但多候选无法确定主窗口 → `enabled:"unknown"`（**唯一** unknown 场景，极罕见）
- spawn PS 报错/超时 → 该项 `null` + probeErrors（查询失败，不是 unknown）

**`false` vs `unknown` 边界定死**：unknown 只在"无法确定查哪个窗口"时，不是"没 hwnd 就 unknown"。

### 动作 spawn 契约（spec §5.2，审查 P2-1）

server 收 `/api/action` → spawn 现有命令。契约写死（不靠 PATH）：
- node 命令用 `process.execPath`（当前 node 绝对路径）
- PowerShell 用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <绝对路径>`（AGENTS.md：PS 一律 `-File`）
- `cwd` = 项目根（server 用 `__dirname` 推算）
- 异步：立即返回 jobId，不等 spawn 完成；前端靠下一次 status 轮询看效果（**成功判定以真实 DOM 状态为准，不信 exit code**，教训 3）
- 全局锁：动作进行中再请求 → 409（不做队列，YAGNI）

### 没有 startZcode action（重要设计决定）

控制中心跑在 ZCode webview 里，用户正常开 ZCode 不带 debug port → 注入必败。曾想加 startZcode
action（spawn launch-zcode.bat），但**那是错的**：launch-zcode.bat Step 1 `taskkill /f /im ZCode.exe`
会杀掉当前 ZCode → **控制中心自己（在 webview 里）连带着被杀**，按钮把自己干掉。改为：debug port
不通时**禁用 CDP 按钮 + 引导**用户从 `wallpaper.bat` 场景 2 重启（不自杀）。`open-in-zcode.cjs` 保留备用。

### 端口固定 17890（不是自增）

书架/进度存 localStorage，**localStorage 绑 origin**（`http://127.0.0.1:17890` ≠ `:17891`），
端口自增会让书架"看起来丢了"。所以**默认固定 17890**，只有被占且无法释放才 +1 兜底 +
前端横幅提示"端口漂移，书架进度可能不同步"。

### 书架（localStorage，reader 和控制中心共享）

书架数据在 localStorage（key `zcode-reader:shelf`），**reader 和控制中心同 origin 共享**。
- reader 看书滚动/翻章 → `addToShelf` 写 localStorage（`reader/lib/progress.js`）
- 控制中心每 2 秒轮询重读 → 显示最新进度
- 控制中心书架分两区：「我的书架」（点书跳 `/reader/?book=<id>`、✕ 删除）+「全部小说」（server `/api/books`
  差集，+ 加入）。`shelf.js` 纯函数：`shelfDiff`/`makeShelfEntry`/`addToShelf`/`resolveStaleBookId`（关联修复，
  只按 filename 匹配，不做 content hash）。
- reader 加了 `?book=<id>` 深链（`reader/lib/book-router.js` 纯函数）：控制中心点书 → reader 自动打开那本。

### start.bat 一站式入口

双击 `start.vbs`（根目录，无 cmd 黑窗；它隐藏启动 `start.bat`）：停旧 control-server →
launch-zcode.bat（带 9222 重启 ZCode）→ 后台起 control-server（PowerShell `-WindowStyle Hidden`，无窗，
真机验 MainWindowHandle=0 + API 可达；写剪贴板）。
**重跑 = 自动清旧**：start.bat Step 0 按命令行匹配 kill 旧 control-server node（精确，不误杀别的 node），
所以重跑 start.vbs 即可清理 + 重启，不用任务管理器。
**不自动打开浏览器面板**：试过用 CDP 驱动地址栏，但 ZCode 在 git working tree 有未提交修改时默认开审查面板
（不是浏览器面板），自动打开太不可靠，已移除。需手动开浏览器面板 + 粘 `/control/`。

### 已知遗留

- **自动打开面板没做**（见上，边界太常见）
- **透明 alpha 查询的 PS 字段索引**：`-Query` 分支要么复用 transparent.ps1 现有 6 字段 Dump（注意索引，教训 3），
  要么单独写精简 alpha-only Dump。实现已选按 hwnd 直查（不走 Dump），规避了索引坑。
- **普通浏览器打开控制中心**：降级体验（没壁纸透出，但控件仍能用）。不做检测（YAGNI）。

---

## 书签管理（在 ZCode 里访问常用网址）

第七种能力。用户发现 ZCode 浏览器面板（webview）能访问互联网（有 URL + 网络即可），
于是做了书签面板：手动维护常用网址（名称 + URL），点击即在 webview 跳转访问。
和前六种**完全不同**：它不触发任何子系统（inject/transparent/rotate 都不碰），
是**纯前端 + 纯 localStorage**的本地小工具，server 只加了一行重定向。

### 为什么是中转页 go.html 而非直接跳外部 URL

跳到外部站后，**外部页我们没控制权**——没法在它上面放"返回控制中心"按钮。
中转页 `control/go.html` 是**留在 `127.0.0.1:17890` origin 的最后一站**：
点书签 → go.html（显示 title + URL +「立即前往」「返回控制中心」）→ 用户点「立即前往」
跳外部站。webview 浏览历史栈：`control/index → control/go.html → 外部站`。
按浏览器后退 → 回 go.html（静态页，**不自动重跳**）→ 再后退或点「返回控制中心」回 control。
没有 go.html，用户跳走后只能手输 control URL 回来（还可能因端口漂移输错）。

### 关键决定：砍掉自动跳转倒计时（不做 2 秒自动跳）

最初设计有 2 秒倒计时自动跳外部站，砍掉了。原因：用户按后退回 go.html 时页面重新执行
script，setTimeout 又跑倒计时又跳走——**"后退"变成"又跳走"，回来路径失效**。解法是用
`performance.navigation.type` / `pageshow.persisted` 判断前进 vs 后退，但 **Electron webview
的 bfcache / navigation API 行为不可靠**，没有稳妥判定。权衡：自动跳转是 nice-to-have，
"后退不重跳"是 must-have，多一次「立即前往」点击彻底消除死循环。**YAGNI 砍掉。**

### 安全：协议白名单 http/https only（防 XSS，无例外）

书签要跳外部 URL，是 XSS 高风险面。`control/lib/bookmark.js` 的 `normalizeUrl`：
- 协议白名单只放行 `http:` / `https:`，`javascript:` / `data:` / `file:` / `vbscript:` / `blob:` /
  `ftp:` 一律拒（`javascript:alert(1)` 存进书签再跳就是 XSS）。
- 无协议前缀自动补 `http://`（不补 https://——让浏览器处理 http→https 升级）。
- **go.html 二次校验**：读 url 参数后再跑一遍协议白名单。双保险：bookmark.js 存时校验一次，
  go.html 跳时校验一次。即使有人手输 `/control/go.html?url=javascript:...` 也拦得住。
  go.html 的校验逻辑是 bookmark.js 的**复制品**（go.html 自包含不引外部 JS），改一处必须同步
  另一处（教训 17 同型：跨环境两份相同逻辑靠同步维护）。
- **不做 open-redirect 防护**（限制 http/https 目标域名范围）——书签是用户自加的，用户跳自己
  加的 URL 无诱导风险。协议白名单挡的是"跳危险协议执行代码"，open-redirect 挡的是"跳危险域名
  钓鱼"，前者做后者不做，别混。

### 数据：localStorage，和书架同范式

- key `zcode-control:bookmarks`，值是 `[{id,title,url,createdAt}]` 数组。
- id = `"bm_" + Date.now().toString(36) + 随机2字符`（不用 URL hash——书签可重复 URL，hash 撞 id 会误删）。
- **不去重**（用户可能想要同 host 不同路径的两个）、**不预置默认书签**（完全手动）。
- title 为空时用 URL 的 hostname 当默认名（用户常只输 URL）。
- localStorage 读写函数（getBookmarks/addBookmark/removeBookmark）**不做单测**——对齐 shelf.js
  惯例（shelftest 也只测纯函数）。单测只覆盖可纯函数化的：normalizeUrl/buildGoUrl/makeBookmarkEntry/bookmarkId。

### 两个真机坑（都是单测盲区，教训 12 同型）

**这两个 bug 都是用户真机验证时抓到的，单测全绿照样中招。** 典型的"跨进程胶水单测验不全"。

**坑 1：点书签没反应（CSS + 事件 target 边界）**
书架的样式选择器写的是 `#shelf-list .book` / `#shelf-list .book-open`，只对书架生效。书签面板是
`#bookmark-list`，完全没匹配到——`.book` 没 `display:flex`（span 没占满可点区域）、`.book-open`
没 `cursor:pointer`（鼠标不变手型）。叠加事件委托只看 `e.target`：书签条目里 URL 包在 `<small>`
里嵌在 `<span data-go>` 内，点到 URL 行时 `e.target` 是 `<small>` 无 `data-go` → 不跳。
修：CSS 加 `#bookmark-list` 镜像样式；事件处理改向上找祖先（closest 模式）。

**坑 2：点书签触发下载 go.html（server MIME）**
`lib/control-server.cjs` 的 `guessMime` 只认 `.js`/`.css`，`.html` 落到 `application/octet-stream`。
`/control/` 和 `/control/index.html` 能正常显示是因为有专门硬编码分支返 `text/html`，但
`/control/go.html` 走通用静态分支用 guessMime → octet-stream → webview 当下载。
修：guessMime 加 `/\.html?$/` → `text/html`。**测试加固**：controlservertest 断言 go.html 的
`Content-Type` 含 `text/html`（原断言只查 body 有 `<title>`，**内容对 ≠ 浏览器会渲染**）。

教训补丁：
27. **`Content-Type` 错会让浏览器下载而非渲染，即使 HTML 内容完全正确。** 单测验 server 响应时
    不能只查 body 内容（"有 `<title>` 就算对"），**必须断言响应头 `Content-Type` 是期望的 MIME**。
    `guessMime` 这类"按扩展名返 MIME"的工具函数，每加一种扩展名支持就要同时加对应断言。这是
    教训 12（跨进程胶水必真机跑）的 MIME 特化版：server 返什么 MIME ↔ 浏览器怎么处理，是
    跨进程契约，单测默认不验响应头就抓不到。和坑 1（CSS 选择器 + 事件 target）一起，再次证明
    **纯前端 DOM/CSS + server↔浏览器契约是单测的双重盲区，必须真机点一遍**。

### 已知遗留

- **外部站加载结果不在职责内**：webview 跳走后控制中心无感知，外部站打不开/拒绝显示是
  网络/站点的事，书签功能到 `location.href = 外部URL` 就完成使命。
- **多 webview 标签并发编辑不强一致**：两个标签都开 control，A 加书签 B 看不到——但每次 poll
  （2 秒）重渲染兜底，最迟 2 秒可见。现有书架同模式，没报过问题。
- **端口漂移对用户本地服务书签的影响**：回来路径用相对路径 `"/control/"`（不带端口，天然免疫），
  但用户如果手动把书签 URL 设成 `http://127.0.0.1:17890/某服务`，端口漂移后那个书签失效——
  是用户自己的地址，不是书签功能责任。

---

## webview `_blank` 链接修复（同窗口跳转）

第八种能力。和前七种**不同层**：前七种改 ZCode 某一面，这个修复的是 **ZCode 浏览器面板
（webview）里 `target="_blank"` 链接点击无反应**的问题。用户通过书签打开外部站，站里 `target="_blank"`
链接点下去完全没反应（不开新窗口、不跳转），是 webview 的硬限制。

### 根因（webview 无 allowpopups，已真机探测）

ZCode 的 `<webview>` 元素（`data-testid="browser-webview"`）**没有 `allowpopups` 属性**。
Electron webview 默认禁弹窗，所以 `target="_blank"` 点击后 host 层（app.asar）决定"不开新窗口"
且"不在 webview 内导航"——表现就是完全没反应。

这是 host 侧行为，但**我们不改 app.asar**：webview 有独立 CDP target（`type === "webview"`），
从 webview 内部页面注入 JS 剥掉 `target="_blank"` 属性即可（剥后变默认 `_self`，同窗口跳转）。

### 两个命门（都已真机验，不是赌）

1. **剥 `target="_blank"` 后同窗口跳转成功**（`scripts/inspect-newwindow.cjs` + 真机点"控制台"
   验证：78 个 `_blank` 全剥后跳转成功，`blankfixCount` 实测累计到 120）
2. **`Page.addScriptToEvaluateOnNewDocument` 在 webview target 上生效**（`scripts/test-addscript-newdoc.cjs`
   验证：导航后 marker 自动出现在新文档）——这是"无空窗"的关键

### 三道关机制（`WEBVIEW_BLANKFIX_SOURCE`）

注入脚本在每次新文档加载前自动跑，三道关保证 `_blank` 必被剥：
1. **剥现有**：`document.querySelectorAll('a[target="_blank"]')` 全部 `removeAttribute`
2. **MutationObserver**：SPA 动态渲染的链接也能拦到
3. **capture-phase click 兜底**：observer 装好后才插入的链接，click 时最后一道关

幂等保护 `window.__zzBlankFix` 标志防 observer 累积（bfcache/SPA 路由重跑时）。

**不处理 `window.open()` / 非 `<a>` 元素**（已知遗留）：会破坏依赖 `window.open` 返回值的正常站点
弹窗通信逻辑，风险大于收益，YAGNI。智谱开放平台的"开发文档"是 `<li class="external-link">`（非 `<a>`），
走的就是这种机制，**blankfix 不覆盖它**——这是有意的边界，不是 bug。如遇具体站点用 `window.open`
或非 `<a>` 元素跳转打不开，需另写专门拦截逻辑（且要小心不破坏弹窗通信）。

### 模块定位（对齐 video-mute.cjs，复用 cdp.cjs 中性工具）

`lib/webview-blankfix.cjs` 是**写操作**模块（剥 DOM 属性），独立成模块**不塞进 cdp.cjs**
（cdp.cjs 是只读模块，AGENTS.md 明确）。但**复用** cdp.cjs 的 `connect`/`httpGetJson` 中性工具
（教训 1：复用连接逻辑，不是复用"只读"语义）。

### 后台轮询自愈（control-server 每 3 秒 sync）

control-server 启动后 `setInterval(sync, 3000)`：
- sync 调 `cdp.httpGetJson("/json")` → `filterWebviewTargets` → diff 已注册集合
- 新 target：`connect` → `Page.enable` → `addScriptToEvaluateOnNewDocument` → `Runtime.evaluate`
  （后者覆盖当前页，前者覆盖未来页）
- 消失 target：`ws.close()` + 从集合移除
- ws 断开（crash/session 失效）：`ws.on("close"/"error")` 自动移除，下次 sync 重连重注册

**去重键用 target.id 不用 url**：webview 导航时 id 不变但 url 变，用 url 会重复注册。

### target 过滤复制 cdp.filterTargets 规则（教训 17 同型）

`filterWebviewTargets` 复制 `cdp.cjs filterTargets` 的 15 行排除规则（devtools:// + 工具页路径），
但作用在 `type === "webview"` 而非 `type === "page"`。不改 filterTargets 签名（会破坏 5 个调用点），
复制更干净。**`webviewblankfixtest.cjs` 有镜像一致性断言**——同一组 target 跑两边，断言排除的
工具页集合完全相同，改一边时另一边测试会红，强迫同步。

### 已知遗留

- **不带 debug port 则失效**：用户从普通方式启 ZCode（不带 `--remote-debugging-port=9222`），
  CDP 连不上，blankfix 完全失效。这是所有 CDP 能力的共同前提（AGENTS.md "没有 startZcode
  action" 小节）。前端书签区在 status.zcode 为 null 时条件渲染一行提示（`#bm-port-warn`）。
- **`window.open()` / 非 `<a>` 元素不处理**（见上"三道关机制"小节）。
- **blankfixManager.sync/close 不单测**：跨进程 CDP 胶水（教训 12/13），靠真机验证清单钉。
- **首次注册有最多 3 秒延迟**：用户刚打开 webview 标签的瞬间，hook 可能还没装上（轮询还没跑），
  这 3 秒内点 `_blank` 仍无反应。hook 装上后永久有效。这是轮询架构的固有限制（选方案 B 时
  和用户确认过，YAGNI 不用 CDP Target.targetCreated 事件）。

### 教训补丁 28：`addScriptToEvaluateOnNewDocument` 在 Electron webview target 上生效

和 page target 行为不同，Electron 的 `<webview>` 有独立 CDP target（`type === "webview"`），
`Page.addScriptToEvaluateOnNewDocument` 在它上面**生效**——导航到新页面时注册的脚本自动执行。
这不是常识（CDP 对 webview target 的支持不完整是出了名的，很多 page target 的 API 在 webview
上不灵），是靠 `scripts/test-addscript-newdoc.cjs` 真机验出来的。记录下来防以后重踩。

**另一个相关坑（调试时踩的）**：`Runtime.evaluate` 默认跑在 **isolated world**（隔离世界），
不共享页面主世界的 `window`。如果往 webview 注 hook 然后读 `window.__xxx`，可能读到的是 isolated
world 的 window（空的），误判"hook 没装上"。要真正操作页面主世界的 window/DOM，用
`addScriptToEvaluateOnNewDocument`（跑在主世界）或 `Runtime.evaluate` 的 `contextId`/`worldName`
参数指定主世界。blankfix 用前者，所以工作正常（`blankfixCount` 在主世界累积到 120）。

教训补丁：
28. **`addScriptToEvaluateOnNewDocument` 在 Electron webview target 上生效（已验），但 CDP 对
    webview 的支持不完整，每个 API 都要单独真机验。** 不要假设 page target 上 work 的 API 在
    webview target 上也 work——Electron `<webview>` 是独立渲染进程，CDP 支持是子集且版本相关。
    任何"webview target + 某 CDP API"的组合，第一步就是写探测脚本验它生效，再基于它设计。
    这是教训 21（"应该能 X"是假设，探测真实 state 是事实）的 webview 特化版。**另：`Runtime.evaluate`
    默认 isolated world，要操作主世界用 addScriptToEvaluateOnNewDocument 或指定 contextId。**

---

## 小说阅读器 epub 支持（双格式分派：txt + epub）

第九种能力（小说阅读器的格式扩展）。**不是新子系统**——阅读器子系统（见上"小说阅读器"章节）
早就支持 txt；epub 是给同一套前端/书架/进度加**第二种章节格式**。设计铁律：**epub 差异全封装在
server 端**，bookId/toc 形状/书架/进度/翻页全部复用 txt 路径，**前端只在"渲染章节内容"一处分派**。

### 架构：纯函数 + 胶水，前端只渲染分派

- `lib/epub.cjs` —— **纯函数**层（无 CDP/server/side effect）：`scopeCss`（CSS 作用域隔离）、
  `isAllowedAssetHref`（路径穿越白名单）、`buildSpineIndex`/`buildTocFromNav`（spine+nav→目录）、
  `sanitizeChapterXhtml`（XSS sanitize + src 改写一次完成）。`test/epubtest.cjs` 钉。
- `lib/epub-load.cjs` —— **胶水**层（调库解 zip + 组装 library 条目）：`loadEpub(path)`、
  `getEpubChapter(entry,n,bookId)`、`readEpubAsset(entry,href)`。`test/epubloadtest.cjs` 钉。
- `lib/control-server.cjs` —— `buildLibrary` 加 epub 分派（扫 `.epub`）+ 章节端点（按 format 分派）+
  asset 端点（供 CSS/图片）。`test/epubservertest.cjs` 钉端到端。
- `reader/reader.js` —— `showChapterNode` 按 `ch.format` 分派：txt 走段落列表，epub 走
  `#epub-content` 容器（sanitized HTML fragment + scoped `<style>`）。**这是唯一的 epub/txt 分叉点**。

### epub 仅 server 模式（无拖拽兜底）

txt 有双模式（`http:` 走 server、`file:` 走拖拽 FileReader 兜底）。**epub 只在 server 模式**——
解 zip 需要文件系统 + jszip，浏览器 FileReader 读不到目录、`@likecoin/epub-ts` 是 Node 库。
拖拽 epub 在前端直接提示"请放入 novels/ 由服务加载"，不做降级（YAGNI）。

### XSS sanitize + asset 端点路径穿越防护（双保险）

epub XHTML 是不可信输入（可塞 `<script>`/`onerror`/`javascript:`）。两道关：
1. **`sanitizeChapterXhtml`**（spec §4.2/§4.4）：`sanitize-html` 白名单 tag/attribute +
   `allowedSchemes:["http","https"]`（挡 `javascript:`/`data:`）+ `transformTags.img/a` 把相对
   src/href 改写成 `/api/book/:id/asset?href=encoded`（一次遍历同时剥 XSS + 改写 src）。
   `<script>`/`<iframe>`/`<style>`/事件属性全被白名单挡掉。
2. **asset 端点路径穿越防护**（spec §4.3）：`isAllowedAssetHref(href, allowedSet)` 是**严格集合
   成员判定**——只接受 load 时构建的白名单（manifest 全量 resolve 后的 zip 路径）里的 href，
   不做任何规范化/解码/路径运算。`../../etc/passwd`、`..%2f..%2f`（编码穿越）一律拒。asset 端点
   先查白名单，不在集合里直接 404。

### scopeCss 隔离：双实现 mirror（教训 17 同型）

epub CSS 不能直接 `<link>` 加载——`body{...}` 这类规则会泄漏到 reader UI（顶栏/侧边栏被改样式）。
解法：fetch 每个 CSS → `scopeCss(text, "epub-content")` 给每个选择器加 `#epub-content` 前缀 →
注入成一个 `<style>`。**`scopeCss` 是纯函数，两个运行时各一份**：
- Node 端：`lib/epub.cjs` 的 `scopeCss`（server 调它测、test 也调）。
- 浏览器端：`reader/lib/scope-css.js` 的 `scopeCss`（mirror，dual export：CommonJS + `window.__readerScopeCss`）。

`test/scope-csstest.cjs` 是**镜像一致性保证**（教训 17）：同一组输入跑两边，断言输出字节一致。
改 `lib/epub.cjs` 的 scopeCss 而不同步 mirror，scope-csstest 立刻红——强迫双实现同步。这和
`readercodetest.cjs`+`readercodetestweb.cjs`（codec）、`webviewblankfixtest.cjs`（filterTargets mirror）
是同一套"跨运行时两份逻辑靠共享测试钉一致"的范式。`reader/lib/scope-css.js` dual export 模式
对齐 `reader/lib/{codec,toc,progress}.js`（见上"前端 lib 必须同时挂 CommonJS 导出 + 浏览器全局"）。

### 真实 API 命门（spec §3.1，spike 验证；教训 29）

`@likecoin/epub-ts` 的 API **必须按 spike 真跑结果写，不能信文档/二手调研**（教训 29）：
- **读 XHTML/CSS/图片必须用 `book.archive.zip`（底层 jszip 实例）**：`book.archive.zip.file(zipPath).async("string")`（文本）/`.async("arraybuffer")`（二进制）。**不用 `book.archive.request`**——它对二进制/某些路径返回乱码（损坏的 PNG）。
- **`book.resolve(href)` 返回带前导 `/` 的路径**（如 `"/OEBPS/images/red.png"`），给 jszip 前**必须 `.replace(/^\//,"")` 去掉**，否则 jszip 找不到文件。
- 加载：`const {Book}=require("@likecoin/epub-ts/node"); const book=new Book(arrayBuffer); await book.opened;`
- 目录：`book.navigation.toc` → `[{label,href,subitems}]`（NCX + nav 自动识别）。

### 已知遗留

- **CSS 是异步 fetch 后注入**：章节 HTML 先渲染（无样式），CSS fetch+scopeCss resolve 后再填进
  `<style>`。有短暂无样式闪现，但 CSS 可选（fetch 失败 `.catch` 静默，章节仍可读）。
- **epub 仅 server 模式**（见上，无 file 兜底）。
- **scopeCss 是简化解析**：不处理嵌套 at-rule（`@media` 里再套 `@media`，epub CSS 极罕见）；
  `@font-face`/`@import`/`@charset` 保留原样（`@import` 被 sanitize 阶段挡掉）。
- **真机验证清单（spec §6.3）需 webview 实跑**：书架显示 epub、章节渲染+图片+CSS、恶意 epub 不弹窗、
  epub CSS 不污染顶栏、进度保存恢复、看完 epub 切 txt 正常（epub-mode class 移除）。这些是 DOM
  渲染层，单测盲区（教训 12），靠真机验。

### 教训补丁 29：subagent/二手调研给的库 API 必须自己 spike 真跑，不能直接信

教训补丁：
29. **subagent/二手调研给的库 API 必须自己 spike 真跑，不能直接信。** 这次调研给的
    `book.archive.request(href,"string")` 对二进制返回乱码，真跑才发现要改用底层 `book.archive.zip`。
    "文档说支持 X"≠"X 真能用"——和教训 21（"应该能 X"是假设）同型，但这次的"假设"来自调研报告
    而非自己的 CSS 常识，更隐蔽。任何引入新库的 spec，实施第一步必须是 spike 验证真实 API 形状，
    把验证结果（含命门/坑）写进 spec，再基于真实 API 写实现计划。

---

## 壁纸轮播（定时随机切换）

第六种能力。和前五种不同：它不改 ZCode 某一面，而是**驱动现有的注入子系统定时重跑**。
`lib/rotate.cjs` 是个常驻看门狗，每隔 N 分钟 spawn 一次 `inject.cjs` 换图/换视频。
**rotate 自己不碰 CDP、不碰注入逻辑**——完全复用 inject 的 env var 旁路（`ZCODE_WP_CSS`/
`ZCODE_WP_VIDEO`），符合"控制中心/触发器不重写动作逻辑"（教训 1）。

### 为什么 rotate spawn inject 而非自己持有 CDP

复用 = 零代码重复。rotate 自己持有 CDP 长连接能省每次几百 ms 的进程启动开销，但要把
connect/retry/buildExpression/buildVideoExpression 抄一份，还要处理"页面导航后 target 变了"。
两份拷贝 = 两份能各自再坏一次的机会（教训 1 二次事故）。不值。间隔是分钟级，开销可忽略。

### 状态用文件 + pid 探活（非 IPC）

rotate 写 `<root>/.rotate.json`（gitignore，运行时产物），status 读它。
"control-server 重启丢 child handle 但 .rotate.json 残留 running:true"靠
`process.kill(pid, 0)` 探活弥补——pid 死了 status 返回 `{running:false, stale:true}`。
单向数据流（rotate 写、status 读），比 IPC/socket 简单（不用管连接生命周期）。

### 互斥 + 单一 kill 逻辑

图轮播和视频轮播互斥（body 同时只能一个背景）。control-server 的 `stopRotateNow()` 是
**唯一一份** kill 逻辑：前端"停止"按钮和 `startRotate*` 的"先停旧"互斥守卫都调它。
server 重启丢 handle 时，`stopRotateNow()` 走 pid kill 兜底（spec §8 边界）。

### Windows kill 不触发子进程 SIGTERM（2026-06 踩的坑，教训补丁）

**这是真机端到端验证才发现的 bug，单测完全抓不到**（教训 13 的直接实例）。

`stopRotateNow()` kill rotate 子进程后，**父进程（control-server）必须自己写
`running:false` 到 `.rotate.json`**，不能依赖子进程的 SIGTERM 处理。原因：Windows 上
`child.kill()` 直接 `TerminateProcess`，**不投递 SIGTERM/SIGINT 信号**——子进程里注册的
`process.on("SIGTERM", shutdown)` 永远不触发，子进程的 `shutdown()`（本会写 running:false
+ 清理临时 css）完全不跑。`.rotate.json` 残留 `running:true` → status 读到 `stale:true`
→ 用户点"停止"后状态还显示"轮播已停（进程退出）"，体验坏。

修复：`stopRotateNow()` 两条路径（child-handle / pid-fallback 兜底）**都**在 kill 后
读当前状态 + 覆盖 `running:false`。父进程是状态权威，不信子进程会自己清理。

教训补丁：
26. **Windows 上 child.kill() 不投递信号，TerminateProcess 直接终止**。任何"kill 子进程
    后期望它跑清理逻辑"的设计在 Windows 上必坏。父进程必须自己负责清理共享状态
    （文件/锁/注册表）。Linux/Mac 的 SIGTERM 优雅关闭在 Windows 不成立——要么父进程兜底，
    要么用 job object / 父子进程关系。这是教训 12（跨进程胶水必真机跑）的 Windows 特化版：
    信号语义跨 OS 不一致，单测（默认 Linux 语义）抓不到。

### 已知遗留

- **rotate 是 control-server 的子进程（非独立窗口）**：control-server 关则 rotate 被连带杀
  （OS 级），和 reader"关窗即停"一致的模型。要脱离 control-server 独立跑可直连
  `node lib/rotate.cjs --image --interval <ms>`。
- **视频用纯定时器不监听 ended**：可能切掉一个还没播完的视频。视频壁纸是动态背景不是
  "看片"，可接受（spec §3.4）。
- **临时 css 残留**：rotate 崩溃没清掉的 `zcode-rotate-*.css` 在系统 temp，rotate 启动时
  扫描清理（spec §8）。OS 也会清。
- **图片轮播需要 wallpapers-thumb/ 非空**：空池子 rotate 直接 exit 1（和 inject 空池行为
  对称）。图片轮播和视频轮播（wallpapers-video/）都已真机验过：随机切换不重复 + 启停 + stale 探活全链路。

---

## 测试

`npm test` 跑：selftest → cdp-mock-test → cdp-retry-test → cdptest → setuptest → resizetest → probetest → menutest → transparenttest → readertoctest → readercodetest → readercodetestweb → readertocwebtest → readerprogresstest → readerservertest → bookroutertest → rotatetest → statustest → controlservertest → statusviewtest → shelftest → videomutetest → bookmarktest → webviewblankfixtest → epubtest → epubloadtest → epubservertest → scope-csstest。
改任何 `.cjs` 或 `.bat` 逻辑前先确保这堆绿的。

`rotatetest.cjs` 测 `lib/rotate.cjs` 的纯函数：`pickRandomExcluding`（空池/单元素/排除上次/
lastFile 不在池）、`parseInterval`（非法/越界 clamp/默认）、`readState`/`writeState`（缺失/
坏 JSON/原子写）、`buildImageCss`（base + background-image 拼接）。rotate↔inject 的 spawn
链路和 pid 探活靠真机验证（教训 12/13：跨进程胶水单测验不全；Windows kill 不触发 SIGTERM
那个 bug 就是真机跑出来的，见上面"壁纸轮播"章节）。

`menutest.cjs` 测 `lib/menu.cjs` 的 `renderMenu()` 输出：13 个场景 + 退出项齐全、顺序对、
每个场景的中文说明和"调用哪些脚本"标注都在、10 个底层脚本/动作名至少出现一次
（`setup`/`resize`/`start-zcode`/`inject-only`/`remove-wallpaper`/`start-transparent`/`transparent`/
`reader-server`/`reader-help`/`control-center`）。
防止菜单被人改坏（删场景、改错调用链说明）却没人发现。
（场景 7/8 是视频壁纸变体，calls 标注是 `start-zcode(video)` / `inject-only(video)`；
场景 9/10 是窗口透明模式，calls 标注 `start-transparent` / `transparent`；
场景 11/12 是小说阅读器，calls 标注 `reader-server` / `reader-help`；
场景 13 是控制中心，calls 标注 `control-center`。）

`transparenttest.cjs` 测 `lib/windowselect.cjs` 的 `selectMainWindow` 纯函数：pid/visible/
toplevel/零面积过滤、单候选自动选、多候选返回 `{ambiguous, candidates}`（按面积降序）。
规则是 `lib/transparent.ps1` 探测窗口的 JS 镜像——**PS 侧规则必须和这里一致**，
抽出来单测防漂移。Win32 调用本身不测（OS 行为，mock 真 HWND 没意义）。
这和 probetest 同思路：钉死可纯函数化的那一层。

`selftest.cjs` 现在还覆盖视频模式：`buildVideoExpression()` 的输出含 `<video>` 元素创建、
src/autoplay/muted/loop/playsinline、`.play()` 兜底；**`--remove` 同时清掉 `<style>` 和
`<video>` 两个元素**（不管之前注的是图还是视频，Test 4d）；**图片注入也清掉残留的 `<video>`**
（Test 4e——钉死"视频→图片切换声音残留"的回归，见上面"视频→图片切换必须停掉旧视频的声音"）。
`listVideos` / `encodeFileUrl` 也有纯函数测试。

`cdp-mock-test.cjs` 现在多跑一条 `inject.cjs --video`：mock 不用改（视频表达式返回 `'ok'`、
verify 沿用 `'effect'`/`'noeffect'` 哨兵），但会断言 mock **确实收到了 `<video>` 创建指令和
文件 URL**，且**没收到图片模式的 `background-image: url(...)` 规则**——钉死 MODE 路由不会
串台。**第 5 步验"视频→图片切换"**：视频注入后再跑一次图片注入，断言图片注入的表达式
引用了 `VIDEO_EL_ID`（说明它在清旧 video），且没有 `createElement('video')`（没有误建新 video）。
注意：mock 对 verify 哨兵和 remove 动作的检测用的是**宽松匹配**（正则 `'present'\s*:\s*'gone'`、
子串 `'removed'`），不是逐字符匹配，因为表达式的内部空格/措辞是实现细节，不该让 mock 脆断。

`cdp-retry-test.cjs` 是为第一次事故加的回归测试：mock 故意拒掉前 3 次 WS 握手，
验证 inject.cjs 的 retry 能恢复。模拟冷启动握手失败场景。
**注意**：它只覆盖 inject.cjs 内部，不覆盖 `.bat` 的探测行——见下面 `probetest`。

`probetest.cjs` 是为**第二次同型事故**加的（见下）：起一个 mock `/json`，
用单 page target / 多 page target / 无 page target / 端口不通四种 case 跑 `probe.ps1`，
验证退出码 0/0/2/1。专门钉死 PowerShell `.Count` 单对象陷阱。

`videomutetest.cjs` 测 `lib/video-mute.cjs` 的纯函数 `buildMuteExpression(videoElId, muted)`：
mute/unmute 两个方向的表达式正确性（含 `v.muted=true/false`、IIFE 包裹、JSON 返回）、
truthy/falsy 转换、`VIDEO_EL_ID` 常量镜像 inject.cjs（防漂移）。执行表达式 against fake DOM
验 `found:true/false` 路径。`setVideoMuted` 的 CDP 遍历靠真机验（教训 12/13：跨进程胶水）。

`bookmarktest.cjs` 测 `control/lib/bookmark.js` 的纯函数：`normalizeUrl`（协议白名单——
`javascript:`/`data:`/`file:`/`vbscript:`/`blob:`/`ftp:` 全拒、http/https 放行、自动补 http://、
trim、空/空白/非 URL 拒、unicode/punycode 放行）、`buildGoUrl`（url+title 编码、& = # 不破坏
query）、`makeBookmarkEntry`（id/title/url/createdAt、空 title 回退 hostname）、`bookmarkId`
（bm_ 前缀 + 唯一性）、`isAllowedProtocol`。**最关键的是协议白名单断言**——那是防 XSS 的命门。
localStorage 读写函数不测（对齐 shelftest 只测纯函数的边界，靠真机验）。
真机还抓到两个单测验不到的坑（见上面"书签管理"章节）：CSS 选择器漏 `#bookmark-list` + 事件
未向上找祖先、guessMime 漏 `.html` 致 go.html 被下载——后者已在 controlservertest 加
`Content-Type: text/html` 断言钉死。

`webviewblankfixtest.cjs` 测 `lib/webview-blankfix.cjs` 的纯函数：`filterWebviewTargets`（排除
非 webview 类型/无 wsUrl/devtools://，排除 localhost/127.0.0.1 任意端口的 `/control/` `/reader/`
`/api/` 工具页，保留外部站、保留 url 为空的 webview 边界、不误杀 localhost 非工具路径）、
`WEBVIEW_BLANKFIX_SOURCE` 常量（含 `__zzBlankFix`/`removeAttribute('target')`/`MutationObserver`/
`addEventListener('click'`/IIFE 结构）、**镜像一致性断言**（同一组 target 跑 `cdp.filterTargets`
和 `filterWebviewTargets`，排除的工具页集合完全相同——教训 17 同型，改一边时另一边测试会红）。
还用手写 fake DOM（不引入 jsdom，YAGNI）跑 SOURCE 验语义：预置 `_blank` 被剥、动态 append 的被
observer 剥、重跑幂等不叠加 observer。`blankfixManager.sync/close` 不测（跨进程 CDP 胶水，
教训 12/13，靠真机验）。

`epubtest.cjs` 测 `lib/epub.cjs` 的纯函数：`scopeCss`（选择器加前缀、`@media` 递归、`@font-face`
原样保留、注释、空输入）、`isAllowedAssetHref`（白名单严格集合成员判定、拒 `../../`/`..%2f` 编码穿越、
拒非成员）、`buildSpineIndex`、`buildTocFromNav`（两层目录：带 subitems 的成卷、平铺成章、spine basename
匹配、dedupe）、`sanitizeChapterXhtml`（剥 `<script>`/`onerror`/`javascript:`、img src 改写到 asset 端点、
白名单 tag/attribute）。这是 epub 的"可纯函数化层"，server 胶水靠 epubloadtest/epubservertest。

`epubloadtest.cjs` 测 `lib/epub-load.cjs` 的胶水（用真实 fixture `test/fixtures/normal.epub`）：
`loadEpub`（spine + resources + toc + bookId 确定性）、`getEpubChapter`（format:epub、html 非空、
XSS 已剥、img src 改写、cssHrefs 指向 asset 端点、prev/next、越界返 null）、`readEpubAsset`
（CSS 文本、图片 buffer、mime、路径穿越拒）。**用真实 zip + jszip 跑通整条加载链**（教训 29 的
`book.archive.zip`/`resolve` 去前导 `/` 命门在这验）。

`epubservertest.cjs` 端到端验 `lib/control-server.cjs` 的 epub 集成：起真实 server → buildLibrary
扫到 epub + txt 双格式 → 章节 API 返 format:epub/html/cssHrefs → asset 端点返 CSS（200, text/css）、
图片（200, image/png）、**路径穿越 404**、txt book 上请求 asset 404。跨进程胶水（教训 12/13）。

`scope-csstest.cjs` 是**镜像一致性测试**（教训 17）：同一组 CSS 输入跑 `lib/epub.cjs`（Node）和
`reader/lib/scope-css.js`（浏览器 mirror）的 `scopeCss`，断言输出字节完全一致。改 Node 端而不同步
浏览器 mirror，此测试立刻红——强迫双实现同步（scopeCss 在两个运行时各一份，跨环境无法共享代码）。

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
