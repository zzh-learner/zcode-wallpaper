# 设计稿：ZCode 窗口透明模式（看桌面）

**日期**：2026-06-18
**状态**：待实现（spec 已与用户逐段确认）
**作者**：brainstorming 会话产出

---

## 1. 目标

新增第三种 ZCode 背景模式：**窗口透明模式**。让 ZCode 主窗口半透明，
用户能透过窗口直接看到背后的桌面（其他窗口、图标、壁纸）。

### 和现有两个模式的关系

| | 图片模式 | 视频模式 | **透明模式（本设计）** |
|---|---|---|---|
| 作用层 | 渲染层（`<style>`） | 渲染层（`<video>`） | **原生窗口层（HWND alpha）** |
| 工具 | CDP + inject.cjs | CDP + inject.cjs | **Win32 API + PowerShell** |
| 走 start-zcode.bat? | 是 | 是 | **否**：`start-transparent.bat` 复用 `launch-zcode.bat`（启动 ZCode）但不走 `start-zcode.bat`（那是图片注入入口）、也不用 CDP |
| 退出方式 | 场景5（inject.cjs --remove） | 场景5 | **热键 / 关控制台** |

### 显式非目标（YAGNI）

- **不**做 alpha 旋钮的 UI 面板（用热键够了）。
- **不**做"只有边框透明、内容区清晰"——Win32 没有这个 API，整个窗口均匀半透明是硬约束。
- **不**做跨平台（Linux/macOS）。Win32 API 是 Windows 专用，本功能 Windows-only。
- **不**复用 inject.cjs 加一个 `--transparent` mode——透明是窗口层的事，和 CDP 注入是两个域（详见 §6）。
- **不**持久化透明设置——每次启动重新跑脚本。（YAGNI，需要再加。）

---

## 2. 关键技术约束（务必读懂，避免重蹈教训 2）

### 2.1 CDP 改不了窗口透明度

这是本项目踩坑预防的核心。现有图片/视频壁纸能成，是因为它们都是**渲染层**的事。
"透过窗口看桌面"是**原生窗口层**的事，两者域不同：

- Electron 的真透明窗口（`transparent: true`）**只能在窗口创建时设**，运行时不能切换。
  ZCode 不是我们用 `transparent: true` 启动的，这条用不上。
- CDP **没有任何设窗口透明度/alpha 的方法**。`Browser.setWindowBounds` 只支持位置/大小/
  最小化/最大化，无 opacity 字段。CDP 只管页面内容，管不了原生窗口。
- `Emulation.setDefaultBackgroundColorOverride` 只让**页面背景**透明，底层还是 ZCode 窗口
  的不透明底色——看到的会是 ZCode 深色底，不是桌面。

**结论**：必须用 Win32 API（`SetLayeredWindowAttributes`）直接对 ZCode 的窗口句柄操作，
走出 CDP 注入的老路子。

### 2.2 alpha = 整个窗口均匀半透明（跷跷板）

`WS_EX_LAYERED + SetLayeredWindowAttributes(LWA_ALPHA)` 对**整个窗口**均匀生效——
代码字、菜单、按钮、背景**一起按同一比例变淡**，桌面从后透出。

- 完全透明 = 完全看不见 ZCode 内容，没法用。
- 必然是中间值，且字越清楚桌面越糊，反之亦然——没有"两头都占"。
- 这和 AGENTS.md 核心教训 2 同型：**"alpha 控制壁纸可见度"那种假设在本模式里要重新校准**——
  这里 alpha 控制的是**整个窗口的可见度**，不是壁纸/UI 背景的分项。

### 2.3 PowerShell 必须写成 .ps1（项目已踩过的环境坑）

`lib/transparent.ps1` 一律用 `-File` 跑，**绝不内联 `-Command`**——bash 会吞掉
PowerShell 里的 `$xxx` 变量（`$hwnd`、`$alpha`、`$_` 会被替换成路径展开）。
（AGENTS.md"环境注意"已记录此坑。`.bat` 里的 `powershell -Command` 不受影响，因为
.bat 走 cmd 不是 bash。）

---

## 3. 文件结构

### 3.1 新增

```
lib/transparent.ps1           核心：探测窗口 → SetLayeredWindowAttributes → RegisterHotKey 循环
lib/windowselect.cjs          新增：Select-MainWindow 的 JS 纯函数版（供测试，规则与 PS 侧一致）
bin/transparent.bat           入口（对已开窗口）：算 WP_ROOT → 调 lib/transparent.ps1 -File
bin/launch-zcode.bat          新抽出的共享启动逻辑（定位/杀/启动/等就绪），不带 inject、不带 hold
bin/start-transparent.bat     入口（一键启动）：调 launch-zcode.bat → 成功后调 transparent.bat
```

### 3.2 改动

```
bin/start-zcode.bat           重构：Step 0-3 抽给 launch-zcode.bat，自身只保留 Step 4 (inject) + hold
lib/menu.cjs                  加场景 9「启动带透明窗口」+ 场景 10「对已开窗口设透明」
test/menutest.cjs             断言 10 个场景齐全、场景 9/10 的 calls 标注对（transparent / transparent.bat）
test/transparenttest.cjs      新增：纯逻辑测试 transparent.ps1 的探测/分类函数（见 §8）
```

---

## 4. `bin/launch-zcode.bat` 抽取细节

### 4.1 为什么抽（根除重复）

透明模式需要"启动 ZCode 但**不注入**图片壁纸"。现状 `start-zcode.bat` 把"启动"和"注入"
焊死了。两个选择：

- (a) 抽 `bin/launch-zcode.bat`（启动+等就绪），`start-zcode.bat` 和 `start-transparent.bat` 都调它；
- (b) `start-transparent.bat` 复制一份启动逻辑。

选 **(a)**。理由直扣 AGENTS.md 核心教训 1 二次事故："两份拷贝就是两份能各自再坏一次的机会"。
顺便修了"start-zcode 启动+注入焊死"这个既有隐患。

### 4.2 抽取范围

`launch-zcode.bat` 包含 `start-zcode.bat` 现有的：

- Step 0：定位 `ZCode.exe`（Get-Process → 注册表 App Paths → 常见路径列表）
- Step 1：杀已运行的 ZCode（taskkill + ping 延迟）
- Step 2：`--remote-debugging-port=9222` 启动，输出重定向到 `zcode-launch.log`
- Step 3：`probe.ps1` 循环等 debug port + page target（最多 40 次）

**不含** Step 4（inject）和 `:hold`（pause）。

### 4.3 关键改造：用 `exit /b !rc!` 收尾，不用 `goto :hold`

现有 `start-zcode.bat` 用 `goto :hold`（pause 等键）收尾——那是给"双击 .bat 弹出控制台"的
交互场景用的。抽成 `launch-zcode.bat` 后它是被**另一个 .bat 调用**的子脚本，**不能 pause**
（会卡住调用方）。所以：

- `launch-zcode.bat` 用 `exit /b !rc!` 把 probe 的 rc（0=就绪 / 1=端口不通 / 2=无 page target）传回。
- `start-zcode.bat` 调它后 `if !errorlevel!==0 goto inject`，否则 `goto :hold` 报错。
- `start-transparent.bat` 调它后 `if !errorlevel!==0 call transparent.bat`，否则 `goto :hold` 报错。

### 4.4 `bin/start-zcode.bat` 重构后形态

```bat
@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title ZCode Wallpaper Launcher
set "WP_ROOT=%~dp0.."
set "MODE_FLAG="
if /i "%~1"=="video" set "MODE_FLAG=--video"

call "%~dp0launch-zcode.bat"
set rc=!errorlevel!
if not "!rc!"=="0" goto :hold

:inject
echo [wallpaper] Step 4: inject wallpaper
node "%WP_ROOT%\lib\inject.cjs" %MODE_FLAG%
...（原 Step 4 的 Done/失败提示，保持不变）

:hold
echo Press any key to close...
pause >nul
endlocal
```

**向后兼容**：对外行为（双击 → 启动 → 注入 → hold）完全不变。只是内部拆了两层。

---

## 5. `lib/transparent.ps1` 核心逻辑

### 5.1 参数

```powershell
param(
  [string]$ProcessName = "ZCode",        # 进程名（无 .exe 后缀），可覆盖
  [int]   $InitialAlpha = 200,           # 0-255，默认 ~78%（偏不透明保可读）
  [int]   $Step         = 25,            # 每次热键步进
  [int]   $MinAlpha     = 30,            # 防止误操作调到完全看不见
  [int]   $MaxAlpha     = 255
)
```

**进程名做参数的原因**：我不确定 ZCode 的真实进程名（可能是 `ZCode`、`zcode`、或基于
Electron 的别的名）。默认 `ZCode`，但首次使用时如果找不到，提示用户 `Get-Process` 看真实名，
然后用 `-ProcessName` 覆盖。

### 5.2 Win32 P/Invoke 声明

```powershell
$code = @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern bool SetWindowLong(IntPtr h, int n, int v);
  [DllImport("user32.dll")]
  public static extern int  GetWindowLong(IntPtr h, int n);
  [DllImport("user32.dll")]
  public static extern bool SetLayeredWindowAttributes(IntPtr h, uint c, byte a, uint flags);
  [DllImport("user32.dll")]
  public static extern bool RegisterHotKey(IntPtr h, int id, uint mod, uint vk);
  [DllImport("user32.dll")]
  public static extern bool UnregisterHotKey(IntPtr h, int id);
  // GWL_EXSTYLE=-20, WS_EX_LAYERED=0x80000, LWA_ALPHA=0x2, LWA_COLORKEY=0x1
  // MOD_CONTROL=0x2, MOD_ALT=0x1, VK_UP=0x26, VK_DOWN=0x28, VK_0=0x30
}
"@
Add-Type -TypeDefinition $code
```

（实际常量在 PS 侧命名清楚，不在 C# 字面量里裸写 magic number。）

### 5.3 探测窗口（§用户决策："启动时探测最稳"）

```
1. $procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
   如果为空 → 打印 "[transparent] 没找到进程 $ProcessName，请 Get-Process 确认真实名" → exit 1
2. EnumWindows 枚举所有顶层窗口，过滤：
   - IsWindowVisible
   - GetWindowLong(GWL_STYLE) 含 WS_VISIBLE
   - owner == 0（顶层）
   - 窗口的 PID 在 $procs 的 PID 集合里
3. 对每个候选记录 (hwnd, pid, className, title, rect面积)，按面积降序
4. 决策：
   - 0 个候选 → exit 2（"进程在但没找到可见顶层窗口"）
   - 1 个候选 → 直接用
   - 多个候选 → 打印编号列表让用户选（read-host）；记 $script:hwnd
```

**纯函数抽取（便于测试）**：把"给定进程 PID 集合 + 窗口列表 → 选哪个"的逻辑抽成
`Select-MainWindow($pids, $windows)`，返回选中的 hwnd 或 `$null`。这条纯函数是
`test/transparenttest.cjs` 的重点（mock 一组窗口数据，断言选了面积最大那个、多候选返回 null、
PID 不匹配返回 null）。

### 5.4 设透明

```
$style = [Win32]::GetWindowLong($hwnd, -20)        # GWL_EXSTYLE
[Win32]::SetWindowLong($hwnd, -20, $style -bor 0x80000)   # 加 WS_EX_LAYERED
[Win32]::SetLayeredWindowAttributes($hwnd, 0, $InitialAlpha, 0x2)   # LWA_ALPHA
$script:alpha = $InitialAlpha
```

### 5.5 热键循环（阻塞，Ctrl+C 可中断）

```
[Win32]::RegisterHotKey(0, 1, 0x2 -bor 0x1, 0x26)   # Ctrl+Alt+Up  id=1
[Win32]::RegisterHotKey(0, 2, 0x2 -bor 0x1, 0x28)   # Ctrl+Alt+Down id=2
[Win32]::RegisterHotKey(0, 3, 0x2 -bor 0x1, 0x30)   # Ctrl+Alt+0    id=3

try {
  $msg = New-Object NativeMethods+MSG   # 用 [System.Windows.Forms.Message] 或 PeekMessage
  while ($true) {
    # 用 GetMessage（阻塞等）或 PeekMessage + Start-Sleep 小循环
    if ([Win32]::PeekMessage(...)) { 处理 WM_HOTKEY (0x0312) }
    switch ($wparam) {
      1 { $script:alpha = [Math]::Min($MaxAlpha, $script:alpha + $Step) }
      2 { $script:alpha = [Math]::Max($MinAlpha, $script:alpha - $Step) }
      3 { break loop }   # 恢复 + 退出
    }
    [Win32]::SetLayeredWindowAttributes($hwnd, 0, $script:alpha, 0x2)
    Write-Host "[transparent] alpha = $script:alpha / 255"
  }
}
finally {
  # 退出清理：即使 Ctrl+C 也恢复
  [Win32]::UnregisterHotKey(0, 1); [Win32]::UnregisterHotKey(0, 2); [Win32]::UnregisterHotKey(0, 3)
  [Win32]::SetLayeredWindowAttributes($hwnd, 0, 255, 0x2)   # 恢复完全不透明
  $style = [Win32]::GetWindowLong($hwnd, -20)
  [Win32]::SetWindowLong($hwnd, -20, $style -band (-bnot 0x80000))   # 清 WS_EX_LAYERED
  Write-Host "[transparent] 已恢复不透明并退出。"
}
```

**消息循环实现细节**（spec 标注，实现时定）：用 Win32 `GetMessage`（阻塞等消息）最省 CPU，
但 PS 里调 native msg 结构略繁琐；备选用 `[System.Windows.Forms.Application]::AddMessageFilter`
+ `RegisterHotKey` 的 .NET 封装。倾向直接 P/Invoke `GetMessage`/`PeekMessage`，少依赖。

### 5.6 退出方式（用户决策："热键退出，一键包干"）

`Ctrl+Alt+0`（热键 id=3）：
1. `SetLayeredWindowAttributes($hwnd, 0, 255, 0x2)` —— 恢复完全不透明
2. 清 `WS_EX_LAYERED`
3. `break` 出消息循环 → 进 `finally` → UnregisterHotKey → 脚本结束

**控制台窗口关闭 / Ctrl+C** 也走 `finally`（PS 的 try/finally 在 trap/Ctrl+C 下会执行），
保证窗口不会卡在半透明状态。

---

## 6. 为什么是独立子系统，不走 CDP（对应 AGENTS.md 教训）

AGENTS.md 核心教训 1 说"两份拷贝就是两份能各自再坏一次的机会"，视频模式就是按这个原则
**复用** inject.cjs 的。那为什么透明模式要**例外**，不也塞进 inject.cjs 加个 `--transparent`？

**因为透明和 CDP 注入根本是两个域**：

- inject.cjs 走的是 **CDP → Runtime.evaluate → 改页面 DOM/CSS**。它的所有基础设施
  （连 9222、`/json`、WS 握手、retry、verify）都是为"操作渲染层"建的。
- 透明走的是 **Win32 API → 操作原生窗口 HWND**。它**根本不需要连 9222**，不需要 page target，
  不需要 ZCode 带 `--remote-debugging-port`。

如果把透明塞进 inject.cjs：

- 要么"透明模式跳过所有 CDP 逻辑直接调 Win32"——那 inject.cjs 里就有一大段和 CDP 完全无关的
  Win32 代码，inject.cjs 的职责（"CDP 注入器"）被稀释，违反单一职责；
- 要么强行让透明模式也走 CDP 连接（哪怕只是为了"复用 retry 框架"）——那就是无意义的依赖，
  透明根本不需要 page 就绪，反而引入"端口没开就注不了透明"这种人为故障。

**判据**：视频模式复用 inject.cjs 是对的，因为视频**也是渲染层的事**（塞 `<video>` 元素 + CSS），
和图片共享所有 CDP 基础设施。透明是**窗口层的事**，和 CDP 无关，硬塞进 inject.cjs 是错的
复用对象——恰恰是教训 1 要避免的另一种"想当然的复用"。

**结论**：透明走独立的 `lib/transparent.ps1`，不碰 inject.cjs，不碰 CDP。两个子系统唯一的共享
是 `bin/launch-zcode.bat`（启动 ZCode 的逻辑），那是合理的复用（启动是公共前提）。

---

## 7. 入口脚本

### 7.1 `bin/transparent.bat`（对已开窗口）

```bat
@echo off
chcp 65001 >nul
setlocal
set "WP_ROOT=%~dp0.."
echo [transparent] 对已运行的 ZCode 窗口设透明（Ctrl+Alt+Up/Down 调，Ctrl+Alt+0 恢复并退出）
powershell -NoProfile -ExecutionPolicy Bypass -File "%WP_ROOT%\lib\transparent.ps1" %*
endlocal
```

`%*` 透传参数（`-ProcessName`、`-InitialAlpha` 等）。用户可双击直接跑（ZCode 已开时）。

### 7.2 `bin/start-transparent.bat`（一键启动）

```bat
@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
set "WP_ROOT=%~dp0.."

call "%~dp0launch-zcode.bat"
set rc=!errorlevel!
if not "!rc!"=="0" (
  echo [transparent] ZCode 启动未就绪 (rc=!rc!)，透明模式不启动。
  goto :hold
)

echo [transparent] ZCode 就绪，启动透明窗口模式...
call "%~dp0transparent.bat" %*

:hold
echo Press any key to close...
pause >nul
endlocal
```

---

## 8. 测试计划

### 8.1 `test/transparenttest.cjs`（新增，重点）

透明模式的核心是 `Select-MainWindow` 这个**纯函数**（§5.3）。把它从 PS 里抽出来可测：

- **方案（已定）**：在 `lib/` 下新建 `lib/windowselect.cjs`，把 `Select-MainWindow` 的
  选择逻辑用 **JS 重写一份纯函数版本**（输入是 `{pids: Set, windows: [{pid, className, title, area, visible, toplevel}]}`，输出选中的 window 或 null）。
  `lib/transparent.ps1` 里的探测是 PS 实现（真调 Win32 拿数据），但**选择规则**
  必须和 `windowselect.cjs` 保持一致——spec 里写明规则（面积降序、PID 过滤、visible/toplevel 过滤、多候选返回 null 让 PS 侧 read-host），
  两边各自实现同一规则。测试用 JS 版跑，mock 一组窗口数据，断言：
  - 单候选 → 返回那个 hwnd
  - 多候选 → 返回面积最大那个
  - 候选 PID 不在目标进程集合 → 返回 null
  - 0 候选 → 返回 null
  - 非 visible / 非 toplevel 的窗口被过滤掉

  这套断言**钉死探测逻辑的核心**，防止以后改坏（比如把"面积最大"改成"第一个"导致选错窗口）。

- **Win32 调用本身不测**（mock 真实 HWND 没意义，那是 OS 的事）。只测我们写的纯逻辑。

### 8.2 `test/menutest.cjs`（改）

- 场景数从 8 → 10（加 9「启动带透明窗口」calls=`start-transparent`，
  10「对已开窗口设透明」calls=`transparent`）。
- 断言两个新场景的中文说明和 calls 标注都在。
- 底层脚本名至少出现一次的列表加上 `start-transparent`、`transparent`、`launch-zcode`。

### 8.3 不测的部分（显式声明）

- `SetLayeredWindowAttributes` 是否真让窗口变透明——那是 OS 行为，靠人眼验，不在自动化测试范围。
- 热键是否真被注册成功——同理，靠人按验。
- 这和图片/视频模式的取舍一致：`probetest` 钉死探测逻辑（纯函数），但"壁纸是否真显示"
  靠人眼看截图。

---

## 9. 已知遗留和风险

### 9.1 DevTools / 弹窗也会被影响（如果选错窗口）

`Select-MainWindow` 靠"面积最大"挑主窗口。如果 ZCode 开着 DevTools 且最大化，可能误选 DevTools。
**缓解**：多候选时打印列表让用户选（§5.3 step 4）；默认启发式是面积最大 + 类名匹配。
**残留风险**：首次使用时用户可能选错一次，第二次起记不住选择（每次重选）。YAGNI——
需要持久化再加（存到 `.transparent-cache.json` 之类的）。

### 9.2 窗口重建后丢透明

ZCode 重启/窗口重建后 HWND 变了，之前设的透明丢失。**预期行为**：重跑 `transparent.bat`。
**不做**自动重连（YAGNI）。

### 9.3 和图片/视频模式叠加

透明模式不碰 CDP，所以如果之前注入了图片/视频壁纸，**两者会叠加**：窗口半透明 + 里面有壁纸。
这不是 bug，是可组合的行为——用户可能想要"半透明窗口 + 里面还能看到壁纸"。
**spec 显式记录**：叠加是允许的，不阻止。`--remove`（场景5）只清 CDP 注入的图/视频，
不影响窗口透明；要关透明只能靠热键/关 transparent.ps1。

### 9.4 进程名不确定

§5.1 已处理（`-ProcessName` 参数 + 找不到时的提示）。首次使用时用户要确认一次。

### 9.5 热键冲突

`Ctrl+Alt+↑/↓/0` 如果和别的软件撞，`RegisterHotKey` 会失败。**处理**：注册失败时
`Write-Warning` 提示哪个键冲突，让用户改脚本里的 VK 常量（YAGNI，不做配置化）。

---

## 10. 实现顺序（给 writing-plans 的输入）

1. 抽 `bin/launch-zcode.bat`，重构 `bin/start-zcode.bat` 调用它（**先确保向后兼容**：
   双击 start-zcode.bat 行为不变，`npm test` 全绿）。
2. 写 `lib/windowselect.cjs`（Select-MainWindow 纯函数 + 写 `test/transparenttest.cjs` 测它）。
3. 写 `lib/transparent.ps1`（探测 + 设透明 + 热键循环 + 退出清理；探测的选择规则对齐 windowselect.cjs）。
4. 写 `bin/transparent.bat` + `bin/start-transparent.bat`。
5. 改 `lib/menu.cjs` 加场景 9/10，改 `test/menutest.cjs`。
6. 跑全 `npm test` + 手动人眼验（窗口真变透明、热键真生效）。

每步之间 `npm test` 必须绿（对齐项目"改任何 .cjs/.bat 前先确保测试绿"的约定）。

---

## 11. 用户确认记录

逐段确认通过（brainstorming 会话）：

- [x] 透明类型：真·窗口透明（看桌面）
- [x] 默认透明度取向：运行时可调（热键）
- [x] 工具：PowerShell（零依赖）
- [x] 启动集成：两个都要（场景9 + bin/transparent.bat，对齐现有模式）
- [x] 热键：Ctrl+Alt+↑/↓ 步进 + Ctrl+Alt+0 恢复并退出
- [x] 找窗口：启动时探测（最稳）
- [x] 退出：热键退出（一键包干）
- [x] 架构：独立子系统，不走 CDP
- [x] launch 复用：抽 `bin/launch-zcode.bat`
- [x] PS 参数：alpha=200 / 步进25 / Ctrl+Alt+↑/↓/0
