# AGENTS.md — 项目记忆与工作约定

给接手这个项目的 AI（或人类）看的。读完再动手。

## 项目是什么

**zcode-wallpaper**：通过 CDP（Chrome DevTools Protocol）给 ZCode（Electron 应用）注入壁纸，
不改 `app.asar`，靠 `--remote-debugging-port` 启动后往页面注入 `<style>`。

启动链路（关键，调试时按这个顺序看）：

```
setup.bat  → setup.cjs        装 sharp/ws 依赖
resize.bat → resize.cjs        wallpapers/*.jpg → wallpapers-thumb/*.jpg（2560px 缩图）
start-zcode.bat               启动 ZCode(带 debug port) → 等待 page target → 调 inject.cjs
inject.cjs                    CDP 连接 → Runtime.evaluate 注入 wallpaper.css
```

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

## 测试

`npm test` 跑：selftest → cdp-mock-test → cdp-retry-test → setuptest → resizetest → probetest。
30 项。改任何 `.cjs` 或 `.bat` 逻辑前先确保这堆绿的。

`cdp-retry-test.cjs` 是为第一次事故加的回归测试：mock 故意拒掉前 3 次 WS 握手，
验证 inject.cjs 的 retry 能恢复。模拟冷启动握手失败场景。
**注意**：它只覆盖 inject.cjs 内部，不覆盖 `.bat` 的探测行——见下面 `probetest`。

`probetest.cjs` 是为**第二次同型事故**加的（见下）：起一个 mock `/json`，
用单 page target / 多 page target / 无 page target / 端口不通四种 case 跑 `probe.ps1`，
验证退出码 0/0/2/1。专门钉死 PowerShell `.Count` 单对象陷阱。

## 改动惯例

- `.bat` 保持 ASCII-only（中文由 node 自己打印）。
- 新增逻辑加测试（参照现有 `*test.cjs` 风格，纯函数抽出来单测）。
- Windows 保留名文件（`nul` 等）删不掉时，用 `[System.IO.File]::Delete('\\?\C:\...\nul')`。
  **注意**：这个 `\\?\` 前缀里有反斜杠，**绝不能塞进 bash 里的 `powershell -Command "..."`**——
  bash 会吞掉反斜杠（见上面"环境注意"）。必须写成 `.ps1` 文件用 `-File` 跑（见 `del-nul.ps1` 的写法，
  虽然那是一次性脚本没进仓库）。另外 `Test-Path` 对 `\\?\nul` 这种路径会撒谎（把 `nul` 当设备名），
  要直接 `try { Delete } catch`，别先 Test。
