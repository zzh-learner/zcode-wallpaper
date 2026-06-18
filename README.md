# ZCode 壁纸 (zcode-wallpaper)

给 ZCode 桌面客户端加自定义壁纸，**不修改 app.asar**，ZCode 升级后不会被覆盖。
支持三种背景：**图片壁纸**、**视频壁纸**（把 `.mp4` 当动态背景播放）、**窗口透明**（让 ZCode 主窗口半透明，能透过它看到桌面）。

## 效果预览

![效果预览](EffectPreview.png)

## 功能

- **一键菜单**：双击 `wallpaper.bat`，按场景选功能（初始化 / 启动 / 换图 / 视频壁纸 / 窗口透明 / 移除 / …）。
- **图片壁纸**：从壁纸库随机选一张，同一次会话内固定。
- **视频壁纸**：把 `.mp4` / `.webm` / `.mov` 注入成动态背景，`autoplay muted loop` 自动循环播放。
- **窗口透明**：把 ZCode 主窗口设成半透明（0-100 自选），能透过窗口看到桌面。和图片/视频可叠加（半透明窗口 + 里面有壁纸）。
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

## 进阶：改样式

- **图片壁纸**：改 `lib/wallpaper.css`（全屏透明模式，把 UI 背景变量强制透明让壁纸透出）
- **视频壁纸**：改 `lib/wallpaper-video.css`（视频层定位 / 铺满 / `html,body` 透明）

改完菜单选 `4 只重新注入 CSS`（图片）或 `8 注入视频壁纸`（视频）即时生效，无需重启 ZCode。

> ℹ️ 早期版本有"透明度旋钮"（`rgba(...,0.82)` 调 alpha），实测对当前 ZCode UI 结构基本无效
> （面板盖不满整个窗口，没被面板盖住的区域壁纸永远是满强度），已删除。现在是"全屏透明模式"：
> 要么全显要么不显，没有中间态。字直接压在背景上，可读性只能靠选高对比、深色调的图/视频解决。

## 文件说明

| 文件 | 作用 |
|------|------|
| `wallpaper.bat` | **总入口**：双击它出场景菜单，按需调用下面的脚本 |
| `bin/setup.bat` | 初始化：检查环境 + 准备目录 + 装依赖 |
| `bin/resize.bat` | 把 `wallpapers/` 原图批量缩到 `wallpapers-thumb/` |
| `bin/launch-zcode.bat` | 共享启动逻辑：定位/杀残留/带调试端口启动/等窗口就绪（`start-zcode` 和 `start-transparent` 共用） |
| `bin/start-zcode.bat` | 启动带壁纸的 ZCode（调 `launch-zcode` + 注入；可选参数 `video`） |
| `bin/inject-only.bat` | 单独注入壁纸（改完 CSS 后用，**需要 ZCode 已通过 `start-zcode` 开着**；可选参数 `video`） |
| `bin/start-transparent.bat` | 启动 ZCode 并设窗口透明（调 `launch-zcode` + `transparent.bat`） |
| `bin/transparent.bat` | 把已运行的 ZCode 主窗口设半透明（提示输入透明度 0-100） |
| `bin/remove-wallpaper.bat` | 移除壁纸（同时清图片 + 视频） |
| `bin/probe.ps1` | 调试端口探测（`start-zcode` / `inject-only` 共用） |
| `lib/inject.cjs` | CDP 连接 + 注入逻辑（图片 / 视频 / 移除三种模式） |
| `lib/transparent.ps1` | Win32 窗口透明（探测主窗口 + `SetLayeredWindowAttributes` 设 alpha） |
| `lib/windowselect.cjs` | 窗口选择规则纯函数（`transparent.ps1` 的 JS 镜像，供单测） |
| `lib/wallpaper.css` | 图片壁纸样式 |
| `lib/wallpaper-video.css` | 视频壁纸样式（视频层定位 + 透明 UI 层） |
| `wallpapers/` | **放你的原图**（`.gitignore` 已忽略） |
| `wallpapers-thumb/` | 缩图产物（inject 实际读这里，`.gitignore` 已忽略） |
| `wallpapers-video/` | **放你的视频**（`.gitignore` 已忽略） |

## 命令行 / npm 脚本

不想用菜单，也可以直接跑：

```bash
npm run inject          # 注入图片壁纸（随机选图）
npm run inject:video    # 注入视频壁纸（随机选视频）
npm run remove          # 移除壁纸（图片 + 视频都清）
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
| ZCode 升级后壁纸没了 | 正常，升级会换 app.asar 但不影响本工具。重跑 `start-zcode` 即可 |

## 安全说明

- 调试端口 9222 仅监听本机回环（127.0.0.1），不对外网开放；
- 注入的是纯 CSS + 一个 `<video>` DOM 元素，不读写文件、不上传数据；
- 不修改、不替换 ZCode 的任何程序文件。

## License

MIT — 见 [LICENSE](LICENSE)。
