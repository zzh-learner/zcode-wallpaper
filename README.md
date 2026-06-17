# ZCode 壁纸 (zcode-wallpaper)

给 ZCode 桌面客户端加自定义壁纸，**不修改 app.asar**，ZCode 升级后不会被覆盖。

> ✅ 已端到端验证通过：CDP 连接成功、`<style>` 注入成功（`found:true, attached:true, stylesCount` 实测上涨）。

## 效果预览

![效果预览](EffectPreview.png)

*上图：ZCode 客户端应用自定义壁纸后的实际效果。*

## 安装（每台新电脑都要做一次）

需要 **Node.js**（v18+）和已安装的 ZCode 客户端。

```bash
git clone <你的仓库地址> zcode-wallpaper
cd zcode-wallpaper
```

然后**双击 `setup.bat`**，它会自动完成：

- 检查 Node.js 版本（≥18）
- 探测 ZCode.exe 位置
- 创建 `wallpapers/` 目录（放你自己的图）
- 把壁纸路径自动配置好（指向自带的 wallpaper.svg）
- 安装依赖（`npm install`）

看到 `初始化完成！` 就可以双击 `start-zcode.bat` 启动了。

> 💡 没有 Node.js？去 https://nodejs.org 下载 LTS 版（v18+）装上，再跑 setup.bat。setup.bat 会预检，没装会直接提示，不会报一堆错。

> 🛠 不想用脚本？手动 `npm install` 也行，但 wallpaper.css 里的壁纸路径得自己改成 `file:///` 绝对路径（见下文）。

## 跨电脑使用

这个项目**不包含任何本机专属信息**，clone 到任何 Windows 电脑都能直接用：

- 所有路径都是**动态探测**的（ZCode.exe 位置、项目自身目录），不写死
- 你的私有壁纸图被 `.gitignore` 排除，不会推到仓库
- 唯一需要每台电脑各自做的事：`npm install`（装依赖）+ 把你自己的图放进 `wallpapers/` 并把 `file:///` 绝对路径填进 `wallpaper.css`

**在新电脑上启动 ZCode 的流程和原来一样：**
1. 完全退出 ZCode（窗口 + 托盘）→ 双击 `start-zcode.bat`
2. 想换图：改 `wallpaper.css` 的 `[图]` → 双击 `inject-only.bat`

> ⚠️ ZCode 装在非默认位置（如自定义盘符）时，`start-zcode.bat` 会自动尝试探测；若探测失败，按报错提示手动在 bat 里设 `ZCODE_EXE`。

## 原理

ZCode 是 Electron 应用（UI = 网页技术），但用了最严格的安全配置（contextIsolation+sandbox）且**没有暴露自定义 CSS 入口**。本工具：

1. 用 `--remote-debugging-port=9222` 启动 ZCode，开启 Chrome DevTools 协议；
2. 用 CDP 连上主窗口，执行一段 JS 注入一个 `<style>` 元素；
3. CSS 把壁纸挂在 `body` 上，并把 UI 主背景变量改成半透明，让壁纸透出。

完全运行时注入，**不动任何应用文件**，升级后重跑脚本即可恢复。

## ⚠️ 关键限制：单实例锁

ZCode 是**单实例**应用。只要有一个 ZCode 在跑（含托盘），带调试端口的新实例会**启动后立即退出**，调试端口随之消失。

→ **必须先完全退出所有 ZCode，再用 start-zcode.bat 启动**。这是整条链路能跑通的前提。

## 日常使用（两步）

### 第 1 步：启动带壁纸的 ZCode

1. **完全退出 ZCode**（所有窗口 + 右下角托盘图标）
2. 双击 **`start-zcode.bat`**
   - 自动探测 ZCode.exe 位置（支持 `D:\zcode\`、`%LOCALAPPDATA%\Programs\ZCode\` 等）
   - 检测到残留进程会问 Y/N，按 Y 让它 taskkill
   - 启动 ZCode（输出重定向到 `zcode-launch.log`，不刷屏）
3. 等 ZCode 窗口完全打开

### 第 2 步：注入壁纸

ZCode 窗口打开后，双击 **`inject-only.bat`**：
- 自动探测 9222 端口（最多等 30 秒）
- 连接成功后注入壁纸
- 看到 `Done! Wallpaper applied.` 即成功

> 以后开机用 ZCode，重复这两步即可。两个 bat 可各做桌面快捷方式。

## 换自己的壁纸图

> 💡 跑过 `setup.bat` 后，`wallpaper.css` 里的背景图已自动指向 `wallpapers/wallpaper.svg`。换图时只需把图放进 `wallpapers/`，把 CSS 里那一行的文件名 `wallpaper.svg` 改成你的图名即可，`file:///.../wallpapers/` 这段前缀不用动。

> ⚠️ **必须用 `file:///` 绝对路径**。ZCode 的页面运行在 `app.asar` 内部（URL 是 `.../app.asar/out/renderer/index.html`），写相对路径（如 `url("my.jpg")`）会被解析到 app.asar 里那个不存在的位置，**背景图加载失败、看不到效果**。这是最常踩的坑。

### 推荐做法：把图放进 `wallpapers/` 目录

项目根目录下有个专门的 **`wallpapers/`** 文件夹（已被 `.gitignore` 忽略，你的私人照片不会被提交）。换图三步：

1. 把图复制进 `wallpapers/`，例如：
   ```
   C:\Users\<你的用户名>\Documents\zcode-wallpaper\wallpapers\my-wallpaper.jpg
   ```
2. 打开 `wallpaper.css`，改第 1 处 **`[图]`**，用 `file:///` + 正斜杠的绝对路径：
   ```css
   background-image: url("file:///C:/Users/<你的用户名>/Documents/zcode-wallpaper/wallpapers/my-wallpaper.jpg") !important;
   ```
3. 双击 `inject-only.bat`，秒换图（不用重启 ZCode）

### 路径怎么从 Windows 路径转成 `file:///` 形式

规则很简单：
- 开头加 `file:///`（三个斜杠）
- 盘符后的反斜杠 `\` **全部换成正斜杠 `/`**
- 路径里别用中文、别用空格（`file://` 加载中文/空格路径可能失败）

```
C:\Users\john\Pictures\bg.jpg
→ file:///C:/Users/john/Pictures/bg.jpg
```

支持 `.jpg .jpeg .png .webp .gif .svg`。

## 调透明度 / 毛玻璃

打开 `wallpaper.css`，按注释调：
- **`[透明度]`**：`rgba(..., 0.82)` 最后一位（0~1），越小壁纸越显、字越淡
- **`[模糊]`**：取消第 4 段注释，设 `blur(8px)`

改完双击 `inject-only.bat`。

## 关掉壁纸

双击 **`remove-wallpaper.bat`**（当前会话立即生效）。

## 文件说明

| 文件 | 作用 |
|------|------|
| **`start-zcode.bat`** | 第 1 步：退出旧 ZCode → 带调试端口启动（ASCII，无乱码） |
| **`inject-only.bat`** | 第 2 步：探测端口 → 注入壁纸（带友好诊断） |
| `remove-wallpaper.bat` | 移除壁纸 |
| **`setup.bat`** | 新电脑一键初始化（检查环境 + 配路径 + 装依赖） |
| `setup.cjs` | setup.bat 的核心逻辑（6 步初始化） |
| `setuptest.cjs` | setup 逻辑自检（9 项） |
| `inject.cjs` | 核心注入器（CDP 客户端，含 ws://localhost→127.0.0.1 修复） |
| `wallpaper.css` | 壁纸样式（图/透明度/模糊都在这调） |
| `wallpapers/` | **放你自己的壁纸图**（`.gitignore` 已忽略，不会提交私人照片） |
| `wallpaper.svg` | 自带测试图（紫蓝渐变 + 字样） |
| `selftest.cjs` | 注入逻辑自检（8 项） |
| `cdp-mock-test.cjs` | CDP 协议链路自检（mock，3 项） |

## 验证状态

- [x] 注入逻辑自检 `node selftest.cjs` → **8/8 通过**
- [x] CDP 协议链路 `node cdp-mock-test.cjs` → **3/3 通过**
- [x] 真实端到端：带端口启动 ZCode → inject.cjs 注入 → DOM 查询确认 `found:true, attached:true, stylesCount 15→17` → **通过**
- [x] setup 逻辑自检 `node setuptest.cjs` → **9/9 通过**

## 故障排查

| 现象 | 原因 / 处理 |
|------|------------|
| `Could not reach ZCode debug port` (rc=1) | ZCode 不是用 start-zcode.bat 启动的；或被单实例锁挡了（先完全退出再启动） |
| `Port is open but no page window yet` (rc=2) | 端口开了但主窗口还没渲染完，等几秒重跑 inject-only.bat |
| 双击 bat 一闪而过 | 旧版本的中文乱码问题，已全部改 ASCII；若仍有请确认文件没被改回中文 |
| 找不到 ZCode.exe | 自动探测失败，手动编辑 start-zcode.bat 里的 `ZCODE_EXE` |
| 壁纸太花看不清字 | 调高 wallpaper.css 里的 alpha，或开毛玻璃模糊 |
| ZCode 升级后壁纸没了 | 正常，app.asar 被替换不影响本工具。重跑 start-zcode.bat + inject-only.bat |

## 安全说明

- 调试端口 9222 仅监听本机回环（127.0.0.1），不对外网开放；
- 注入的是纯 CSS，不读写文件、不上传数据；
- 不修改、不替换 ZCode 的任何程序文件。

### 提交到 GitHub 前 ⚠️

本项目代码**不含任何密钥或本机账号信息**（源码全部用动态探测）。但你自己用的时候要注意：

- **私有壁纸图**：`.gitignore` 已排除 `*.jpg/png/bmp`，但如果你用了其他扩展名或改了 gitignore，提交前用 `git status` 确认没有你的私人照片被加进来。
- **`wallpaper.css` 里的图路径**：默认是占位 `wallpaper.svg`。如果你本地改成了指向私人图的绝对路径（如 `file:///C:/Users/你的名字/...`），**提交前改回占位**，避免泄露你的用户名/目录结构。
- **`zcode-launch.log`**：ZCode 启动日志（含本机路径、可能的 token 片段）已被 `.gitignore` 排除，千万别手动加进去。
- 检查命令：`git diff --cached` 看看暂存区里有没有意外的东西再 push。

## License

MIT — 见 [LICENSE](LICENSE)。
