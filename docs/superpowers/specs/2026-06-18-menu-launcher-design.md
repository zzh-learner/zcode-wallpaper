# 总入口菜单 `wallpaper.bat` 设计

日期：2026-06-18
状态：已确认，待实现

## 背景

项目现有 5 个独立 `.bat`，各有职责但用户得自己记顺序和依赖关系：

| 脚本 | 做什么 | 前置条件 |
|---|---|---|
| `setup.bat` | 装 sharp/ws 依赖 | Node.js |
| `resize.bat` | `wallpapers/*.jpg` → 缩图到 `wallpapers-thumb/` | 依赖已装 |
| `start-zcode.bat` | 杀旧 ZCode → 带 debug port 启动 → 等窗口 → 注入壁纸 | 缩图已生成 |
| `inject-only.bat` | ZCode 已在跑时只重新注入（换 CSS / 补刀） | ZCode 已用 debug port 启动 |
| `remove-wallpaper.bat` | 移除已注入的壁纸 | ZCode 已用 debug port 启动 |

需求：做一个总入口 `.bat`，启动时显示菜单，列出能做什么（带说明），用户选择后执行对应流程。

## 用户已确认的决策

1. **菜单组织 = 场景化**。不裸列 5 个脚本，而是按使用场景打包，底层复用现有 5 个脚本。
2. **执行完返回菜单**。跑完一个场景后回到菜单，不退出，方便连续操作（如初始化后调试 CSS 反复注入）。

## 设计

### 文件结构

新增 2 个文件，**不改任何现有 `.bat` / `.cjs`**：

```
wallpaper.bat          ← 总入口菜单（ASCII-only，纯英文 echo）
lib/menu.cjs           ← 菜单显示 + 场景说明（中文，node 打印）
```

**为什么不改现有文件**：5 个 `.bat` 仍可独立双击使用（测试 `npm test` 也不受影响），降低耦合。也符合 AGENTS.md 第二次事故的教训——别复制逻辑、别给现有文件加参数引入新的"两份拷贝各自能坏"的机会。

**为什么中文走 `lib/menu.cjs`**：AGENTS.md 明确要求 `.bat` 保持 ASCII-only，中文由 node 打印。菜单的中文说明写进 `.bat` 的 `echo` 在 OEM codepage 下会乱码。

### 菜单内容

```
================  ZCode 壁纸工具箱  ================

  1  新机器初始化        第一次用必跑。装依赖 + 缩图 + 启动带壁纸的 ZCode
                         (顺序调用 setup → resize → start-zcode)

  2  日常启动带壁纸      ZCode 没开时，一键启动并注入壁纸
                         (start-zcode)

  3  换壁纸图后重注入    放了新图到 wallpapers/，缩图后重新注入
                         (resize → inject-only)

  4  只重新注入 CSS      ZCode 已经开着，改完 wallpaper.css 想立刻看效果
                         (inject-only)

  5  移除壁纸            撤掉已注入的壁纸，恢复 ZCode 原样
                         (remove-wallpaper)

  6  重装依赖            sharp/ws 坏了想重装
                         (setup)

  0  退出

======================================================
请输入选项编号:
```

每项一句话说明 **做什么 + 调用哪些脚本**。

### 场景与底层调用映射

| 选项 | 调用 |
|---|---|
| 1 新机器初始化 | `node lib/setup.cjs` → `node lib/resize.cjs` → `call start-zcode.bat` |
| 2 日常启动带壁纸 | `call start-zcode.bat` |
| 3 换壁纸图后重注入 | `node lib/resize.cjs` → `call inject-only.bat` |
| 4 只重新注入 CSS | `call inject-only.bat` |
| 5 移除壁纸 | `call remove-wallpaper.bat` |
| 6 重装依赖 | `call setup.bat` |
| 0 退出 | `exit /b 0` |

**调用方式分两类**：

- **组合场景（1、3）**：前几步直接调底层 `node lib/xxx.cjs`，绕过子 `.bat` 的 `pause`（否则每个子脚本都 pause 会打断组合流程）。组合场景自己控制节奏。
- **单脚本场景（2、4、5、6）**：`call` 对应 `.bat`，保留它们的 `pause`。pause 之后回到菜单，符合"执行完返回菜单"。

**场景 1 第三步用 `call start-zcode.bat`**（不复制它的探测+注入逻辑）：`start-zcode.bat` 内部的杀进程、`probe.ps1` 探端口、调 `inject.cjs` 这一整套不能复制（AGENTS.md 第二次事故教训：复制逻辑 = 两份能各自坏的机会）。它的 `pause` 也正好让用户确认壁纸应用成功再回菜单。

### 执行流程

`wallpaper.bat` 主循环：

1. `cls` 清屏
2. `node lib/menu.cjs` 打印中文菜单
3. `set /p choice=` 读用户输入
4. `goto` 到对应分支：
   - 执行（组合场景：按序调底层 cjs + 最后一个 .bat；单脚本场景：call 一个 .bat）
   - 每步检查 `%errorlevel%`，非 0 则打印"第 N 步失败，已停止"并 `goto :menu`
5. 跑完 `goto :menu` 回到第 1 步

### 错误处理

每步检查 `%errorlevel%`，**非 0 不静默继续往下跑**——比如 setup 失败还去跑 resize 没意义。打印 `[wallpaper] Step N failed (rc=X). Stopped.` 然后 `goto :menu`，让用户看清楚命令链断在哪一环（呼应 AGENTS.md "命令链出问题先确认断在哪一环"）。

### ASCII-only 约束

- `wallpaper.bat` 所有 `echo` 用英文（`[wallpaper] Running setup...` 之类进度提示）。
- 中文菜单和中文说明全在 `lib/menu.cjs` 里用 `console.log` 打印。
- 文件头照例 `chcp 65001 >nul`。

## 不做（YAGNI）

- **不给现有 .bat 加 `--no-pause` 参数**。组合场景绕到底层 cjs 即可，不改现有文件。
- **不复制 `start-zcode.bat` 的启动逻辑到组合场景**。直接 `call` 它。
- **不加"修改 wallpaper.css 后自动提示重新注入"之类的智能**。场景 4 已经覆盖手动重注入。
- **不缓存用户上次选择**。每次重新选，简单可预测。

## 测试策略

参照现有 `*test.cjs` 风格（在 `test/` 目录下）。重点测 `lib/menu.cjs` 的菜单输出（纯输出函数，容易单测）：

- 菜单包含 6 个场景项 + 退出项
- 每项有中文说明 + 调用脚本标注
- 输出无乱码（UTF-8）

`wallpaper.bat` 的循环 / 分支逻辑是纯 cmd 控制流，不易单测（参照现有项目对 `.bat` 的测试边界——`probetest` 测 `.ps1` 不测 `.bat` 本身），靠手动双击验证。

## 验证清单（实现后手动跑）

1. 双击 `wallpaper.bat`，菜单正确显示中文，无乱码
2. 选 0 能退出
3. 选 6（重装依赖）能跑完 setup 并返回菜单
4. 选 2（日常启动）能跑完 start-zcode 并返回菜单
5. 组合场景中某步故意失败（如断网让 setup 失败），能看到"第 N 步失败"提示并返回菜单，不继续往下跑
