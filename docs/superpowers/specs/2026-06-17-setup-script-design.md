# 设计文档：初始化脚本（setup.bat + setup.cjs）

**日期**：2026-06-17
**状态**：待评审
**目标**：提供一个一键初始化脚本，让 zcode-wallpaper 项目能在任意 Windows 电脑上快速部署——自动检查环境、配置本机壁纸路径、安装依赖，无需用户手动改任何绝对路径。

---

## 1. 背景与动机

当前项目跨电脑使用时存在几个手动门槛：

1. **`wallpaper.css` 里写死了绝对路径**：仓库提交的 CSS 含本机路径（如 `file:///C:/Users/johnl/...`），新电脑 clone 下来路径不对，壁纸加载失败（这正是上一次"看不到效果"bug 的根因）。
2. **依赖需手动 `npm install`**：新用户容易漏做，导致 `inject.cjs` 报 `Cannot find module 'ws'`。
3. **没有环境前置检查**：用户不知道自己 node 版本够不够、ZCode 装没装，要等到运行时才报错。

初始化脚本的目标：双击一次 `setup.bat`，把上述全部处理好，并保证可重复运行（幂等）。

---

## 2. 范围

**包含：**
- `setup.bat`：薄入口，预检 node 存在性，调用 `setup.cjs`
- `setup.cjs`：6 步顺序初始化逻辑
- `setuptest.cjs`：setup 纯逻辑的自检（6 项）
- 仓库现有文件的配套改动（`wallpaper.css` 占位符化、`package.json`/`README.md` 更新）

**不包含：**
- 自动安装 Node.js（需管理员权限，只给下载提示）
- 自动安装 ZCode（同上）
- 真实启动 ZCode / 注入壁纸（那是 `start-zcode.bat` + `inject-only.bat` 的职责）
- GUI（保持命令行风格，与项目一致）

---

## 3. 架构

遵循项目现有约定"`.bat` 当薄入口、`.cjs` 干实事"（参见 `inject-only.bat` → `inject.cjs`、`remove-wallpaper.bat` → `inject.cjs`）。

```
setup.bat (薄入口, ~25 行)
  │
  │  1. chcp 65001
  │  2. 纯批处理探测 node 是否存在 (where node)
  │  3. 不存在 → 提示 nodejs.org 下载链接 + pause + exit
  │  4. 存在 → node "%~dp0setup.cjs"
  │  5. 透传 exit code + pause
  ▼
setup.cjs (核心逻辑, ~150 行)
  │
  │  require.main === module 守卫，自动执行 main()
  │  module.exports 导出纯函数供 setuptest.cjs 测试
  │
  ├── Step 1: 检查 node 版本 (≥18)
  ├── Step 2: 探测 ZCode.exe (非致命)
  ├── Step 3: 确保 wallpapers/ 目录存在
  ├── Step 4: 替换 wallpaper.css 占位符 (幂等)
  ├── Step 5: npm install
  └── Step 6: 打印总结
```

---

## 4. setup.cjs 详细步骤

全部步骤顺序执行，每步开头打 `[wallpaper] Step N: ...`。只有致命错误才 `process.exit(1)`（见 §6）。

### Step 1：检查 node 版本
- 读 `process.version`（形如 `v24.16.0`），用 `parseNodeVersion()` 解析主版本号
- `isNodeVersionOk(major)` 判断 `>= 18`
- 不达标 → 打错误 + nodejs.org 下载链接 + `exit 1`
- *setup.bat 已预检 node 存在性，这里只校验版本下限*

### Step 2：探测 ZCode.exe（非致命）
- 用 `child_process.execSync` 调 powershell，复用 start-zcode.bat 的探测顺序：
  1. `Get-Process ZCode` 取正在运行的 ZCode 路径
  2. 注册表 `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\ZCode.exe`
  3. 常见路径列表：`%LOCALAPPDATA%\Programs\ZCode\ZCode.exe`、`D:\zcode\ZCode.exe`、`C:\Program Files\ZCode\ZCode.exe`、`C:\Program Files (x86)\ZCode\ZCode.exe`
- 每种探测方式用 try/catch 包裹，任一异常（执行策略、命令不存在、路径不存在）就跳到下一种；全部失败才判定为未找到
- 找到 → 打印路径 ✓
- 找不到 → 打 `WARN: ZCode.exe 未找到`，**继续**（不 exit，用户可能先初始化环境再装 ZCode）

### Step 3：确保 wallpapers/ 目录存在
- `fs.mkdirSync(path.join(__dirname, "wallpapers"), { recursive: true })`
- `recursive: true` 保证幂等（已存在不报错）
- 不动目录内已有文件

### Step 4：替换 wallpaper.css 占位符（关键步骤）
- **占位符约定**：仓库提交的 `wallpaper.css` 背景图行写作
  ```css
  background-image: url("__WALLPAPER__/wallpaper.svg") !important;
  ```
  其中 `__WALLPAPER__` 是占位符。
- 处理逻辑：
  1. `wallpapersDir = path.join(__dirname, "wallpapers")`
  2. `toFileUrl(wallpapersDir)` 转成 `file:///C:/a/b/wallpapers` 形式（规则：前缀 `file:///` + 反斜杠全换正斜杠）
  3. 读 `wallpaper.css`
  4. `hasPlaceholder(css)` 检测是否含 `__WALLPAPER__`：
     - **有** → 正则替换 `__WALLPAPER__` → file:/// 路径，写回
     - **无**（已替换过 / 用户手改过）→ 打 `wallpaper.css 路径已配置，跳过`，**不改动**（幂等 + 保护用户自定义路径）
- **始终填入 `wallpaper.svg`**，不智能选择 wallpapers/ 里的图。换图是用户的独立步骤。

### Step 5：npm install
- `child_process.execSync("npm install", { cwd: __dirname, stdio: "inherit" })`
- `stdio: "inherit"` 让 npm 输出直接显示
- 非 0 退出 → 打错误 + exit 1

### Step 6：打印总结
- 汇总各步结果，示例：
  ```
  [wallpaper] ========================================
  [wallpaper]  初始化完成！
  [wallpaper]  - Node: v24.16.0 ✓
  [wallpaper]  - ZCode: D:\zcode\ZCode.exe ✓  (或 ⚠ 未找到)
  [wallpaper]  - 壁纸目录: ...\wallpapers ✓
  [wallpaper]  - 壁纸路径已配置 → wallpaper.svg
  [wallpaper]  - 依赖已安装 (ws)
  [wallpaper]  下一步：
  [wallpaper]   1. 想换图：把图放进 wallpapers/，改 wallpaper.css 的文件名
  [wallpaper]   2. 完全退出 ZCode → 双击 start-zcode.bat
  [wallpaper] ========================================
  ```

---

## 5. 对仓库现有文件的改动

### 5.1 `wallpaper.css`：绝对路径 → 占位符
当前：
```css
background-image: url("file:///C:/Users/johnl/Documents/zcode-wallpaper/wallpapers/DSC06952.jpg") !important;
```
改成（仓库提交状态）：
```css
background-image: url("__WALLPAPER__/wallpaper.svg") !important; /* [图] setup.bat 会自动填入 wallpapers 目录的绝对路径；想换图改文件名即可 */
```
*注：你这台机器提交此改动后，wallpaper.css 会指向 wallpaper.svg 而非 DSC06952.jpg。要继续用 DSC06952.jpg，需手动改文件名那段。这是占位符方案的固有取舍。*

### 5.2 `package.json`
- `scripts` 加 `"setup": "node setup.cjs"`（与 `inject`/`remove` 风格一致）
- `scripts.test` 改为 `"node selftest.cjs && node cdp-mock-test.cjs && node setuptest.cjs"`

### 5.3 `.gitignore`
**无需改动**。setup 不生成需忽略的文件（`node_modules/` 已忽略；Step 4 原地替换不生成备份）。

### 5.4 `README.md`
- 「安装」一节：改为推荐双击 `setup.bat`，保留手动 `npm install` 作备选
- 「换自己的壁纸图」一节：加一句说明 setup 已配好默认路径，换图只需改文件名
- 「文件说明」表：加 `setup.bat` / `setup.cjs` / `setuptest.cjs` 三行
- 「验证状态」：加 `setuptest.cjs` 6/6 一项

---

## 6. 错误处理 & 边界情况

| 情况 | 处理 | 退出码 |
|------|------|--------|
| node 没装 | setup.bat 批处理检测，提示 nodejs.org 链接，pause 退出，不调 cjs | 1 |
| node 版本 < 18 | Step 1 报错 + 下载链接，exit 1 | 1 |
| ZCode.exe 探测不到 | Step 2 警告，继续 | 0（非致命） |
| `wallpaper.css` 读取失败 | Step 4 报错 exit 1 | 1 |
| CSS 无 `__WALLPAPER__`（已替换/手改过） | Step 4 跳过，视为成功 | 0 |
| `npm install` 失败 | Step 5 报错，提示检查网络/镜像源 | 1 |
| 重复运行 setup.bat | 幂等：mkdir recursive 幂等、npm install 重跑无害、CSS 占位符已无则跳过 | 0 |
| `wallpapers/` 已有用户图 | 不动用户文件，只确保目录存在 | 0 |

**关键安全特性**：用户手动改成自定义图路径后（如 `DSC06952.jpg`），再跑 setup 不会覆盖——因为占位符已消失，Step 4 判定"已配置"跳过。

---

## 7. 测试策略

对齐项目现有测试风格：纯 node、无外部框架、`npm test` 跑。

### 7.1 `setuptest.cjs`（6 项纯逻辑自检）

setup.cjs 用 `module.exports` 导出纯函数，主流程用 `if (require.main === module) main()` 守卫。setuptest.cjs `require("./setup.cjs")` 取函数测试。

| 测试项 | 被测函数 | 断言 |
|--------|----------|------|
| 1. 版本解析 | `parseNodeVersion("v24.16.0")` | 返回 `24` |
| 2. 版本判断 | `isNodeVersionOk(24)` / `isNodeVersionOk(17)` | `true` / `false` |
| 3. 路径转 file:/// | `toFileUrl("C:\\a\\b\\wallpapers")` | `file:///C:/a/b/wallpapers` |
| 4. 占位符替换 | `replacePlaceholder(cssWithPlaceholder, fileUrl)` | 占位符消失、路径正确 |
| 5. 幂等：已替换不再动 | `replacePlaceholder(cssWithoutPlaceholder, fileUrl)` | 原样返回、无改动 |
| 6. 占位符检测 | `hasPlaceholder(css)` 有/无两种 | true / false |

### 7.2 不测的部分（理由）
- 真实 `npm install` / ZCode 探测 / mkdir：有副作用、慢、依赖环境。靠手动验证 + 设计幂等性保证。
- setup.bat 的 node 预检：批处理难自动化，靠代码审查 + 手动验证。

### 7.3 手动验证清单（实现后执行）
1. 删除 `node_modules` + 把 wallpaper.css 手动改回占位符 → 跑 setup.bat → 验证 CSS 正确替换、依赖装好
2. 立即再跑一次 setup.bat → 验证幂等（CSS 不被二次改动、不报错）
3. `npm test` → 三个测试文件全过（selftest 8 + cdp-mock 3 + setuptest 6）

---

## 8. 文件清单（实现产出）

| 文件 | 类型 | 说明 |
|------|------|------|
| `setup.bat` | 新增 | 薄入口（~25 行 ASCII，chcp 65001，预检 node，调 cjs） |
| `setup.cjs` | 新增 | 核心逻辑（~150 行，6 步，module.exports 纯函数 + main 守卫） |
| `setuptest.cjs` | 新增 | 6 项纯逻辑自检 |
| `wallpaper.css` | 改 | 绝对路径 → `__WALLPAPER__/wallpaper.svg` 占位符 |
| `package.json` | 改 | 加 setup 脚本入口 + test 加 setuptest |
| `README.md` | 改 | 安装/换图/文件说明/验证状态 4 处更新 |

---

## 9. 设计决策记录

- **为何 setup.bat + setup.cjs 而非纯 bat**：批处理做字符串替换/版本比较脆弱，且违反项目"复杂逻辑放 .cjs"约定。
- **为何占位符替换而非模板重写**：模板重写会覆盖用户对透明度/模糊的调整；占位符替换只动路径行，保护其他修改。
- **为何始终用 wallpaper.svg 而非智能选图**：职责单一、可预测。换图是独立步骤，setup 不该替用户决定用哪张图。
- **为何 ZCode 未找到不报错**：用户可能先初始化环境、之后再装 ZCode。强制报错反而阻碍合理使用流程。
- **为何用 `require.main === module` 守卫**：让 setup.cjs 既能直接 `node setup.cjs` 运行，又能被 setuptest.cjs require 测试纯函数，两不误。
