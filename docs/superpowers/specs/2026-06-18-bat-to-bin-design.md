# .bat 集中到 `bin/` 目录 设计

日期：2026-06-18
状态：已确认，待实现

## 背景

项目现有 6 个 `.bat` 平铺在根目录（`wallpaper.bat` + 5 个辅助），加上根目录的 `probe.ps1`。
根目录显得乱。已有 `scripts/` 文件夹装着一次性调试工具（`inspect.cjs`、`screenshot.cjs`）。

需求：把辅助 .bat 集中到一个文件夹，让根目录更干净。

## 用户已确认的决策

1. **新建 `bin/` 文件夹**放核心命令链 .bat，不复用 `scripts/`（那里保持只放调试工具，分类清晰）。
2. **`wallpaper.bat` 留根目录**当唯一双击入口，5 个辅助 .bat + probe.ps1 进 `bin/`。
3. **用"计算项目根"解决路径问题**：每个移走的 .bat 开头算出 `%WP_ROOT%`，后续用它定位 `lib/`。
4. **probe.ps1 跟 .bat 一起进 `bin/`**（只服务 `start-zcode.bat`/`inject-only.bat`），同目录调用最简。

## 技术背景：`%~dp0` 的坑

所有现有 .bat 用 `%~dp0`（脚本自身所在目录）定位 `lib/` 和 `probe.ps1`。
若把 .bat 移进 `bin/` 不改路径，`%~dp0lib\setup.cjs` 会找 `bin/lib/setup.cjs`（不存在）→ 直接断。
被 `call` 的 .bat 是按**自己位置**找文件的，不认调用者（`wallpaper.bat`）的位置。

## 设计

### 目标布局

```
zcode-wallpaper/
├── wallpaper.bat              ← 总入口（留根，用户双击这个）
├── bin/                       ← 新建：核心命令链 .bat
│   ├── setup.bat
│   ├── resize.bat
│   ├── start-zcode.bat
│   ├── inject-only.bat
│   ├── remove-wallpaper.bat
│   └── probe.ps1              ← 跟 .bat 一起（只服务 start-zcode/inject-only）
├── scripts/                   ← 不动，仍是调试工具
│   ├── inspect.cjs
│   └── screenshot.cjs
├── lib/                       ← 不动
├── test/                      ← 仅 probetest.cjs 改一行
└── package.json               ← 不动
```

`scripts/` 完全不动。分类语义：`bin/` = 核心命令链入口，`scripts/` = 一次性调试/探测工具。

### 路径修复

每个移进 `bin/` 的 .bat 开头算出项目根（`bin/` 在根下，根是它的上一级）：

```bat
REM  Project root = parent of this script's dir (bin/ lives under root)
set "WP_ROOT=%~dp0.."
```

逐文件改动（只改路径定位，不改功能逻辑）：

| 文件 | 原引用 | 改成 |
|---|---|---|
| `setup.bat` | `%~dp0lib\setup.cjs` | `%WP_ROOT%\lib\setup.cjs` |
| `resize.bat` | `%~dp0lib\resize.cjs` | `%WP_ROOT%\lib\resize.cjs` |
| `remove-wallpaper.bat` | `%~dp0lib\inject.cjs` | `%WP_ROOT%\lib\inject.cjs` |
| `start-zcode.bat` | `set WP_DIR=%~dp0`；`%WP_DIR%\probe.ps1`；`%WP_DIR%\lib\inject.cjs` | `set WP_ROOT=%~dp0..`；`%~dp0probe.ps1`（同目录）；`%WP_ROOT%\lib\inject.cjs` |
| `inject-only.bat` | 同 start-zcode（WP_DIR、probe.ps1、lib/inject.cjs） | 同样改：WP_ROOT、`%~dp0probe.ps1`、`%WP_ROOT%\lib\inject.cjs` |

**probe.ps1 用 `%~dp0probe.ps1`**：它和 .bat 同在 `bin/`，同目录调用最直接，不走项目根。

### `wallpaper.bat` 的改动（留根，`%~dp0` 仍是项目根）

- `call setup.bat` → `call "%~dp0bin\setup.bat"`（其余 4 个 `.bat` 同理：`resize/start-zcode/inject-only/remove-wallpaper` 全部加 `bin\` 前缀）
- 它自己直接调的 `node lib/menu.cjs` / `lib/setup.cjs` / `lib/resize.cjs` **不变**（`lib/` 还在根下，`%~dp0` 仍指向根）

### 测试影响

- 大多数 `.cjs` 测试不受影响（`lib/` 没动，`__dirname` 相对路径不变）。
- **`probetest.cjs` 一处要改**：`path.join(__dirname, "..", "probe.ps1")` → `path.join(__dirname, "..", "bin", "probe.ps1")`。这是唯一断点。
- `menutest.cjs` 不受影响（测 `menu.cjs`，无路径依赖）。
- `.bat` 控制流本身不在测试覆盖范围内（项目惯例：测 `.ps1`/`.cjs`，不测 `.bat`），所以移 `.bat` 没有别的测试要改，只有 `probetest` 那一处。

### 文档影响

AGENTS.md 的启动链路小节描述了 .bat 的位置和调用关系，需要同步：
- 说明 `wallpaper.bat` 在根目录是总入口
- 5 个辅助 .bat + probe.ps1 现在在 `bin/`
- `start-zcode.bat` 和 `inject-only.bat` 调 `bin/probe.ps1`（同目录）

### 不做（YAGNI）

- **`lib/` 不动**。`__dirname` 相对路径好好的（找 `../wallpapers`、`../wallpapers-thumb`、`wallpaper.css`），没必要动。
- **`scripts/` 不动**。`inspect.cjs`/`screenshot.cjs` 留原处。
- **不搞公共 `paths.bat` 被包含**。6 个文件各加一行算根，够简单，cmd 包含机制反而更脆。
- **不改任何 .bat 的功能逻辑**，只改路径定位。这次纯粹是搬家。

## 验证清单（实现后手动跑）

1. 双击根 `wallpaper.bat`，菜单正常显示，选场景 6（重装依赖）能跑完 setup 并回菜单 → 验证 `call bin\setup.bat` + setup 内 `%WP_ROOT%\lib\setup.cjs` 链路通
2. 直接双击 `bin/setup.bat`（独立运行）也能找到 lib → 验证 `%WP_ROOT%` 计算正确，辅助 .bat 仍可独立双击
3. `npm test` 全绿，重点看 `probetest`（验证 `probe.ps1` 新路径 `bin/probe.ps1` 找得到）
4. （如方便）双击 `bin/inject-only.bat`，能调到 probe.ps1 做端口探测（不要求真的连上 ZCode，能看到它正常探测、报合理错误即可）

## 回滚

纯文件移动 + 路径改字符串。回滚 = `git revert` 单个提交（或一系列提交）。无不可逆操作。
