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
