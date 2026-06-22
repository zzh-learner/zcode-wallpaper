# ZCode 壁纸 (zcode-wallpaper)

> 本项目使用 [ZCode](https://zcode.z.ai) + [GLM-5.2](https://bigmodel.cn) 协作开发。

给 ZCode 桌面客户端做定制，**不修改 app.asar**，ZCode 升级后不会被覆盖。
五种能力：**图片壁纸**、**视频壁纸**（把 `.mp4` 当动态背景播放）、**窗口透明**（让 ZCode 主窗口半透明，能透过它看到桌面）、**小说阅读器**（在 ZCode 浏览器面板里看本地 .txt 小说，带目录/书架/进度）、**书签管理**（在控制中心里维护常用网址，点击即在 ZCode 浏览器面板访问外部互联网站点）。
前三者是改 ZCode 外观，阅读器和书签是独立子应用 —— 详见各章节。

> 🆕 **控制中心**（`start.vbs`）：带界面的统一控制台，在一个透明 webview 面板里
> 实时显示状态 + 一键操作壁纸/视频/透明/阅读器。**日常推荐双击 `start.vbs`**
> （无任何 cmd 黑窗，只有 ZCode 弹出），而不是逐个跑菜单场景。详见下方「控制中心」章节。

## 效果预览

![效果预览](EffectPreview.png)

## 功能

- **一键菜单**：双击 `wallpaper.bat`，按场景选功能（初始化 / 启动 / 换图 / 视频壁纸 / 窗口透明 / 移除 / …）。
- **图片壁纸**：从壁纸库随机选一张，同一次会话内固定。
- **视频壁纸**：把 `.mp4` / `.webm` / `.mov` 注入成动态背景，`autoplay muted loop` 自动循环播放。
- **窗口透明**：把 ZCode 主窗口设成半透明（0-100 自选），能透过窗口看到桌面。和图片/视频可叠加（半透明窗口 + 里面有壁纸）。
- **小说阅读器**：在 ZCode 浏览器面板里看本地 `.txt` 小说，两级目录（卷/章）、滚动阅读、书架多本、进度记忆。
- **控制中心**（`start.vbs`）：带界面的统一控制台——透明 webview 面板（能透出壁纸），实时显示 ZCode/壁纸/透明/阅读器/资源状态，一键操作所有功能，带书架管理（跳转/删除/加书）+ 书签管理（手动加常用网址，点击即在 webview 跳转访问，经中转页可后退回控制中心）。双击 `start.vbs` 无 cmd 黑窗（server 后台跑），只有 ZCode 弹出。
- **批量缩图**：相机原图（几十 MB）自动缩到可渲染的大小，增量处理、重复跑很快。
- **一键移除**：撤掉已注入的壁纸，立即恢复默认外观（同时清掉图片 `<style>` 和视频 `<video>`）。
- **跨电脑可用**：不包含任何本机专属信息，clone 到任意 Windows 电脑按下方流程跑一遍即可。

## 前置要求

- **Node.js v18+**：https://nodejs.org 下 LTS 版安装。没装的话菜单会提示，不会报一堆错。
- **ZCode 客户端**已安装。

## 1. 安装

```bash
git clone https://github.com/zzh-learner/zcode-wallpaper.git zcode-wallpaper
cd zcode-wallpaper
```

## 2. 启动（图片壁纸）

> ⚠️ **必须先完全退出 ZCode**（所有窗口 + 右下角托盘图标）。ZCode 是单实例应用，有残留进程时带调试端口的新实例会启动失败。

> 💡 **日常推荐**：双击 **`start.vbs`**（一站式：调试模式启动 ZCode + 起控制中心，无 cmd 黑窗），
> 然后在控制中心里点"注入图片壁纸"。下面是经典的菜单流程，适合首次初始化或想精细控制时用。

双击项目根目录的 **`wallpaper.bat`**，选择菜单：

- **首次用 / 新电脑**：选 `1 新机器初始化`（装依赖 + 缩图 + 启动，一条龙）
- **日常开机**：选 `2 日常启动带壁纸`（直接启动并注入）

启动流程会自动完成全部步骤：

1. 探测并杀掉残留的 ZCode 进程
2. 带 `--remote-debugging-port=9222` 启动 ZCode
3. 等待主窗口就绪
4. 注入壁纸（带重试验证，冷启动慢也能兜住）

看到 `Done! Wallpaper applied.` 即成功。

### 放图片

把壁纸原图复制进 **`wallpapers/`** 目录（项目根目录下，已被 `.gitignore` 忽略，私人照片不会提交）。

> ⚠️ 文件名请用**纯英文、别用中文/空格**（`file://` 加载中文路径可能失败）。支持 `.jpg .jpeg .png .webp`。

### 压缩图片

相机原图（30-39MB）体积过大，Electron 的 `background-image` 加载会静默失败，必须先缩图。
首次用菜单 `1` 会自动缩；之后每加一张新图，选菜单 `3 换壁纸图后重注入`（缩图 + 重新注入）即可。

## 3. 视频壁纸（可选）

视频壁纸把 `.mp4` 等视频当动态背景播放。原理和图片不同：CSS `background-image`
**播不了视频**，所以注入的是一个真实的 `<video>` DOM 元素（铺满屏幕、沉到所有 UI 之下）。

### 放视频

把视频文件复制进 **`wallpapers-video/`** 目录（已被 `.gitignore` 忽略）。

> ⚠️ 文件名建议用**纯英文、别用中文/空格**。支持 `.mp4 .webm .mov .ogg .ogv`。
> 视频不经缩放，Electron 直接播原文件——建议挑体积小的（几十 MB 的短 clip 效果最好）。

### 启动视频壁纸

菜单里选：

- **`7 启动带视频壁纸`**：ZCode 没开时，一键启动并注入视频壁纸
- **`8 注入视频壁纸`**：ZCode 已经用 `start-zcode` 开着，直接注入视频（换视频后用这个）

### 指定单个视频 / 指定目录

不一定要把视频拷进 `wallpapers-video/`，也可以用环境变量旁路：

- `ZCODE_WP_VIDEO`：指定**单个文件**绝对路径（跳过随机选片）
- `ZCODE_WP_VIDEO_DIR`：指定一个**目录**，从中随机选一个

视频 URL 会做百分号编码，中文/空格路径基本能用，但仍强烈建议英文文件名。

## 4. 窗口透明（看桌面）

第三种背景，和图片/视频**完全不同的层**：那俩是往页面里塞 CSS / `<video>`（渲染层），
窗口透明是用 Win32 `SetLayeredWindowAttributes` 把 **ZCode 主窗口本身** 设半透明，
能透过窗口看到后面的桌面。**不走 CDP，不需要调试端口**，纯原生窗口操作。

菜单里选：

- **`9 启动带透明窗口`**：ZCode 没开时，一键启动 + 设透明
- **`10 对已开窗口设透明`**：ZCode 已经开着（不管怎么开的），直接设透明

选完会让你**输入透明度 0-100**：

| 输入 | 效果 |
|------|------|
| `100` | 完全不透明（恢复原样） |
| `78`（默认） | 轻微透明，字基本可读，桌面隐约透出 |
| `50` | 半透明，桌面明显透出，字也变淡 |
| `0` | 完全透明，窗口看不见（慎用） |

设完即返回菜单，**不阻塞**——你可以接着选图片/视频壁纸做叠加（半透明窗口 + 里面有壁纸）。
要改透明度重跑场景 9/10；要恢复输 `100`。

> ⚠️ **透明是整个窗口均匀半透明**（Win32 硬约束）：代码、菜单、背景**一起按同一比例变淡**。
> 没有"背景透明字清晰"的选项——字越清楚桌面越糊，反之亦然。所以要保留可读性，透明度别调太低。

> ℹ️ 透明**不影响** CDP 注入的图片/视频壁纸。要撤掉壁纸用菜单 `5`，要关透明跑场景 10 输 `100`。

### 进程名找不到？

默认按进程名 `ZCode` 找主窗口。极少数情况下 Electron 应用进程名不一样，
脚本会提示用 `Get-Process` 查真实名，然后：

```
bin\transparent.bat -ProcessName <真实名>
```

（或在菜单场景 10 后带上参数。）

## 5. 移除壁纸

菜单选 `5 移除壁纸`，当前会话立即恢复默认外观。
**一个移除命令同时清掉图片 `<style>` 和视频 `<video>`**，不用记自己用了哪个模式。

## 6. 小说阅读器（边写边看）

第四种能力，和前三种**完全独立**：不注入 CSS、不改窗口透明度，而是启动一个本地
HTTP 服务，在 ZCode 自带的**浏览器面板**里打开一个阅读器网页。不影响 ZCode 主界面。

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
- 字号（A−/A+）、主题（🌙/☀/📜 三个循环）、编码手动切换（UTF-8/GB18030/自动）
- GB18030 自动识别（中文 txt 无 BOM 是常态）
- 章节正文自动去杂质（标题行、网文"更新时间/本章字数"等元信息）

### 章节识别

支持多种中文网文格式（批量测 86 本起点完结小说，~95% 识别正确）：
- 章节用 **章 / 节 / 回**（`第一章`、`第一节`、`第一回` 等价）
- 卷用 **卷 / 集 / 部 / 篇**，支持"第X卷"和"卷X"两种写法
- 卷和章可**同行**（`卷一 烽火连三月 第一章 九世善人`）
- 章节标记后**分隔符可选**（`第一集第一章`无空格粘连也行）
- 中文数字（含"两"）+ 阿拉伯数字都识别
- 开头的前言（楔子/序/书籍介绍等）和结尾的后记/番外（尾声/后记/感言/（全文完）等）自动切成独立章节（**仅 server/http 模式**；拖拽的 file 兜底模式用前端 `reader/lib/toc.js`，不含此前言/后记切分）

少数极罕见格式不支持：纯数字编号（`1.`/`2、`）、易经卦名当卷名、整本文件无换行。
这种书整文当一章显示，不影响阅读。详见根 `AGENTS.md`"小说阅读器 / 已知遗留"。

### 编码

中文 `.txt` 多是 GB18030 编码（无 BOM）。阅读器自动检测：BOM → 严格 UTF-8 验证 →
GB18030 兜底。识别可疑的书带 ⚠️ 标记，顶栏可手动切编码。

## 7. 控制中心（带界面的统一控制台）

控制中心把上面所有功能收进**一个带界面的面板**：透明背景（能透出你设的壁纸），
实时显示状态，按钮一键操作。**日常推荐用它，而不是逐个跑菜单场景。**

### 启动

双击项目根目录的 **`start.vbs`**（一站式入口，无 cmd 黑窗）。它会：

1. 停掉旧的控制中心 server（重跑自动清理，不用任务管理器 kill）
2. 预检 Node.js
3. **以调试模式重启 ZCode**（带 `--remote-debugging-port=9222`，会先关掉当前 ZCode——这是 CDP 的必须代价）
4. 后台启动控制中心 server（无窗口，URL 自动写剪贴板）

双击后**只看到 ZCode 弹出**，没有 cmd 黑窗。然后在 ZCode **浏览器面板**地址栏粘贴
`http://127.0.0.1:17890/control/` 回车。

> 💡 `start.vbs` 无窗启动；想看启动日志/排错时双击 `start.bat`（有 cmd 窗显示每一步）。
> 想停止 server：再双击一次 `start.vbs`，它自动 kill 旧 server 后起新的。

（也可以双击 `wallpaper.bat` 选 `13 启动控制中心`，只起 server 不重启 ZCode。）

> ⚠️ ZCode 必须以调试模式启动（`start.vbs` 或 `wallpaper.bat` 场景 2/7/9），
> 控制中心才能查到状态、注入壁纸。正常双击打开的 ZCode 不带调试端口，
> 控制中心会显示"调试端口未开"并禁用壁纸按钮。

### 能做什么

- **状态条**（每 2 秒自动刷新）：ZCode 运行/调试端口/窗口数、壁纸模式（图/视频/未注入）、
  窗口透明度、阅读器服务、资源盘点（图/缩图/视频/小说数量 + 依赖是否装好）
- **动作按钮**：注入图片壁纸 / 注入视频壁纸 / 移除壁纸 / 设透明（输 0-100）/ 重新缩图 / 重装依赖
- **书架**：分两区——「我的书架」（点书跳到阅读器并打开那本、✕ 删除）+「全部小说」
  （server 扫到的、还没加入书架的书，点 + 加入）
- **书签**：手动添加常用网址（名称 + URL，名称留空自动用网址主机名当标题）。点书签经中转页
  `go.html` 跳转到外部站点，访问完按浏览器后退可回到控制中心（不用手输 control URL）。
  URL 只允许 `http`/`https` 协议（`javascript:`/`data:` 等危险协议自动拒绝，防 XSS）。
- **打开阅读器**：跳到 reader 阅读界面

### 设计要点

- **透明透出壁纸**：控制中心页面背景设成 `transparent`，壁纸从 ZCode body 透上来
  （不像 reader 那样有自己的深色底）。控件用半透明深色块保证可读。
- **不重写动作逻辑**：控制中心只 spawn 现有命令（`inject.cjs` / `transparent.ps1` / `resize.cjs`），
  动作逻辑只有一份。状态查询走新增的 `lib/cdp.cjs`（只读）+ `lib/status.cjs`（纯查询）。
- **CDP target 过滤**：探测/注入时排除控制中心和阅读器自己的 webview 页面，不把自己算进窗口数、不往自己注入。
- **透明状态机**：窗口透明设完即退，server 通过 `transparent.ps1 -Query` 只读查回 alpha；
  server 重启或用户从旧菜单设的透明，回退到按进程名查，查不到报"未知"不误报。

### 已知边界

- **自动打开面板没做**：曾尝试用 CDP 自动在 ZCode 浏览器面板打开控制中心，但 ZCode 在
  git working tree 有未提交修改时默认开审查面板（不是浏览器面板），自动打开太不可靠，已移除。
  需手动开浏览器面板 + 粘 URL。
- **书架进度**：reader 和控制中心共享同一个 localStorage（同 origin），在 reader 读到新章节后，
  回控制中心书架会显示更新（控制中心每 2 秒重读）。



- **图片壁纸**：改 `lib/wallpaper.css`（全屏透明模式，把 UI 背景变量强制透明让壁纸透出）
- **视频壁纸**：改 `lib/wallpaper-video.css`（视频层定位 / 铺满 / `html,body` 透明）

改完菜单选 `4 只重新注入 CSS`（图片）或 `8 注入视频壁纸`（视频）即时生效，无需重启 ZCode。

> ℹ️ 早期版本有"透明度旋钮"（`rgba(...,0.82)` 调 alpha），实测对当前 ZCode UI 结构基本无效
> （面板盖不满整个窗口，没被面板盖住的区域壁纸永远是满强度），已删除。现在是"全屏透明模式"：
> 要么全显要么不显，没有中间态。字直接压在背景上，可读性只能靠选高对比、深色调的图/视频解决。

## 文件说明

| 文件 | 作用 |
|------|------|
| `start.vbs` | **🆕 推荐入口**：双击它 = 无 cmd 黑窗，调试模式启动 ZCode + 后台起控制中心 |
| `start.bat` | 同 start.vbs 但有 cmd 窗（看日志/排错用）；也可被 start.vbs 隐式调用 |
| `wallpaper.bat` | 文字菜单总入口：双击它出场景菜单（含场景 13 启动控制中心），按需调用下面的脚本 |
| `bin/control-center.bat` | 🆕 启动控制中心 server（常驻窗口，不重启 ZCode） |
| `bin/setup.bat` | 初始化：检查环境 + 准备目录 + 装依赖 |
| `bin/resize.bat` | 把 `wallpapers/` 原图批量缩到 `wallpapers-thumb/` |
| `bin/launch-zcode.bat` | 共享启动逻辑：定位/杀残留/带调试端口启动/等窗口就绪（`start-zcode` 和 `start-transparent` 共用） |
| `bin/start-zcode.bat` | 启动带壁纸的 ZCode（调 `launch-zcode` + 注入；可选参数 `video`） |
| `bin/inject-only.bat` | 单独注入壁纸（改完 CSS 后用，**需要 ZCode 已通过 `start-zcode` 开着**；可选参数 `video`） |
| `bin/start-transparent.bat` | 启动 ZCode 并设窗口透明（调 `launch-zcode` + `transparent.bat`） |
| `bin/transparent.bat` | 把已运行的 ZCode 主窗口设半透明（提示输入透明度 0-100） |
| `bin/remove-wallpaper.bat` | 移除壁纸（同时清图片 + 视频） |
| `bin/reader-server.bat` | 启动小说阅读器服务（常驻，关窗即停） |
| `bin/probe.ps1` | 调试端口探测（`start-zcode` / `inject-only` 共用） |
| `lib/inject.cjs` | CDP 连接 + 注入逻辑（图片 / 视频 / 移除三种模式） |
| `lib/transparent.ps1` | Win32 窗口透明（探测主窗口 + `SetLayeredWindowAttributes` 设 alpha） |
| `lib/windowselect.cjs` | 窗口选择规则纯函数（`transparent.ps1` 的 JS 镜像，供单测） |
| `lib/reader-server.cjs` | 阅读器 HTTP server（扫 novels/、章节切分、API、端口自增、剪贴板） |
| `lib/control-server.cjs` | 🆕 合并控制中心 server（静态托管 control/+reader/ + 小说/状态/动作 API + 书签中转页重定向；reader-server.cjs 现委托它） |
| `lib/cdp.cjs` | 🆕 只读 CDP 共享模块（listTargets/connect/probeWallpaperMode + target 过滤），inject.cjs 也用它 |
| `lib/status.cjs` | 🆕 纯只读状态查询（5 项快照 + 透明状态机 + 500ms 缓存） |
| `lib/open-in-zcode.cjs` | 🆕 CDP 驱动 ZCode 地址栏打开 URL（备用工具，start.bat 当前未调用） |
| `lib/reader-codec.cjs` | 编码检测（BOM/fatal-UTF8/GB18030，server 端） |
| `lib/reader-toc.cjs` | 章节切分（卷/章正则 + 兜底，server 端） |
| `lib/wallpaper.css` | 图片壁纸样式 |
| `lib/wallpaper-video.css` | 视频壁纸样式（视频层定位 + 透明 UI 层） |
| `reader/` | 阅读器前端 SPA（HTML/CSS/JS，双模式：server fetch / 拖拽兜底） |
| `control/` | 🆕 控制中心前端 SPA（透明背景 + 浮动控件 + 书架管理 + 书签管理） |
| `control/go.html` | 🆕 书签中转页（点书签先到这里显示目标 + 前往/返回按钮，再跳外部站；浏览器后退可回到这里） |
| `control/lib/bookmark.js` | 🆕 书签纯函数库（URL 校验/规范化、协议白名单 http/https only、中转 URL 生成、localStorage 增删） |
| `wallpapers/` | **放你的原图**（`.gitignore` 已忽略） |
| `wallpapers-thumb/` | 缩图产物（inject 实际读这里，`.gitignore` 已忽略） |
| `wallpapers-video/` | **放你的视频**（`.gitignore` 已忽略） |
| `novels/` | **放你的 .txt 小说**（`.gitignore` 已忽略） |

## 命令行 / npm 脚本

不想用菜单，也可以直接跑：

```bash
npm run inject          # 注入图片壁纸（随机选图）
npm run inject:video    # 注入视频壁纸（随机选视频）
npm run remove          # 移除壁纸（图片 + 视频都清）
npm run reader          # 启动小说阅读器服务（常驻，Ctrl+C 停）
npm run control         # 🆕 启动控制中心 server（常驻，Ctrl+C 停）
npm test                # 跑全部测试
```

或直接 `node lib/inject.cjs [--video|--remove|--list]`。环境变量 `ZCODE_WP_CSS` / `ZCODE_WP_VIDEO` /
`ZCODE_WP_VIDEO_DIR` 可旁路随机选图/视频。

## 故障排查

| 现象 | 处理 |
|------|------|
| 看不到壁纸 | 确认：① 已缩图（`wallpapers-thumb/` 非空）或 `wallpapers-video/` 有视频 ② 是用 `start-zcode` 启动的（不是直接开 ZCode）③ 启动前已完全退出旧 ZCode |
| 视频壁纸看不到 | 同上，外加：视频文件名是否纯英文、文件是否损坏。视频铺满用的是 `object-fit:cover`，会裁边 |
| `inject-only` 提示 "Could not reach ZCode debug port" | `inject-only` 只注入、不启动 ZCode。**ZCode 必须已通过 `start-zcode` 开着**（带调试端口）。如果 ZCode 是直接开的，端口 9222 没开 → 先完全退出再用 `start-zcode` 重启 |
| `找不到 ZCode.exe` | 自动探测失败，手动编辑 `bin/start-zcode.bat` 里的 `ZCODE_EXE` |
| 壁纸/视频太花看不清字 | 背景直接压在字下，可读性靠选高对比、深色调、构图简洁的图/视频解决，CSS 这层无能为力 |
| 窗口透明"没找到进程" | 默认按进程名 `ZCode` 找。用 `Get-Process` 看真实名，再 `bin\transparent.bat -ProcessName <真实名>` |
| 窗口透明看不到效果 | 透明度调太低（如 0-20）字也几乎看不见。调高到 60-80 试试。改透明度重跑场景 9/10 |
| 侧边栏有一块深色盖住背景 | ZCode 框架硬画的实色背景，不走任何覆盖的 CSS 变量，CSS 改不动。已知遗留 |
| 阅读器打不开 | 确认服务窗口还开着；URL 端口对（端口冲突会自动 +1，看服务窗口打印的实际端口）；直接双击 `bin/reader-server.bat` 看输出 |
| 阅读器书架空 | 刷新 webview 标签（F5）；确认服务窗口还开着、`novels/` 有 `.txt`；服务启动后新加的书要重启服务才扫到 |
| 阅读器乱码 | 顶栏编码下拉手动切 UTF-8/GB18030；带 ⚠️ 的书自动检测可疑 |
| 阅读器进度丢了 | webview 的 localStorage 在 persist partition 下应持久；ZCode 重装/清缓存会丢。书架里旧条目会显示"重新拖入关联" |
| 阅读器章节识别错 | 按"第X(章/节/回) + 可选分隔符"切分，支持卷/集/部/篇、卷章同行、集章粘连等格式（批量测 86 本覆盖 ~95%）。极少数纯数字编号（`1.`/`2、`）或整本无换行的书会整文当一章。末章正文里有"尾声/番外/后记/感言/（全文完）"等标记词的会自动切成独立后记章节；只有**末章正文里完全没有任何后记标记词**的书（如《回到明朝当王爷》，末尾是 `※※※` 广告+作者感言）才把后记并入末章 |
| ZCode 升级后壁纸没了 | 正常，升级会换 app.asar 但不影响本工具。重跑 `start-zcode` 即可 |
| 控制中心显示"调试端口未开" | ZCode 不是以调试模式启动的。双击 `start.bat`（或 `wallpaper.bat` 场景 2）重启 ZCode 即可 |
| 控制中心打不开（webview 空白） | server 后台跑（无窗）。确认它在：浏览器面板粘 `http://127.0.0.1:17890/control/`；端口冲突会 +1（双击 `start.bat` 看 cmd 窗打印的实际端口）；想重启 server 双击 `start.vbs` 即自动清旧起新 |
| 控制中心书架"读到第X章"不更新 | reader 翻章时已自动更新 localStorage；控制中心每 2 秒重读。若仍不更新，刷新控制中心 webview 标签 |
| 点书签没反应 | 刷新控制中心 webview 标签加载最新 control.js/control.css。早期版本 CSS 选择器漏 `#bookmark-list`、事件未向上找祖先致点击 span 子元素（URL 行）不触发跳转，已修复 |
| 点书签触发下载 go.html | **重启控制中心 server**（双击 `start.vbs`，改了 server 端代码必须重启进程才生效）。早期版本 `guessMime` 漏 `.html` 致返回 `application/octet-stream`，浏览器当下载，已修复 |

## 安全说明

- 调试端口 9222 仅监听本机回环（127.0.0.1），不对外网开放；
- 注入的是纯 CSS + 一个 `<video>` DOM 元素，不读写文件、不上传数据；
- 不修改、不替换 ZCode 的任何程序文件。

## License

MIT — 见 [LICENSE](LICENSE)。
