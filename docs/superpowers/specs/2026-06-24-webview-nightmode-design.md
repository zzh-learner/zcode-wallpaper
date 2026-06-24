# 设计稿：webview 网页夜间模式（深黑主题）

**日期**：2026-06-24
**状态**：待实现（spec 已与用户确认：方案 A 独立模块 / 深黑单主题 / 持久化 / 宽覆盖 CSS）
**作者**：brainstorming 会话产出
**分支**：`feat/webview-nightmode`

---

## 1. 目标

在 ZCode 内置浏览器面板（webview）打开的外部网页上，一键切换到**深黑夜间主题**，
方便夜间 / 长时间阅读（典型场景：在 webview 里读 cool18 帖子页这种浅色背景长文）。

### 起因（用户报告）

用户在 ZCode webview 里打开 cool18 帖子页，背景是刺眼的浅色（`#E6E6DD`，画在
`.main-content` / `body` / `<pre>` 多个元素上），想压暗。用户确认要的是**夜间/护眼模式**
（固定预设主题，而非自定义颜色），并选了**深黑**（背景 `#1a1a1a`、文字 `#d4d4d4`）这一种主题，
且要求开关**跨重启持久化**。

### 为什么能做（不赌，已有注入通路）

项目第八种能力 `lib/webview-blankfix.cjs` 已经证明：control-server 能通过 CDP 把 JS
注入到 webview 里打开的**每一个外部网页**，且跨导航自动重注（`Page.addScriptToEvaluateOnNewDocument`
每 3 秒轮询注册新 webview target，已真机验生效——见 AGENTS.md 教训 28）。夜间模式挂**同一层**：
把"创建 `<style>` 元素"的 JS 注进去即可，载体完全复用，无需新通路。

### 和现有子系统的关系

这是 control-center 的**又一个常驻职责**（和 blankfix strip、rotate spawn、video-mute evaluate 同型）。
新增独立模块 `lib/webview-nightmode.cjs`，复用 `cdp.cjs` 的中性 CDP 工具（connect/httpGetJson），
**架构完全对称 `lib/webview-blankfix.cjs`**（对齐 video-mute.cjs 的模块定位：写操作独立成模块，
不污染 cdp.cjs 只读语义，但复用连接逻辑而非重写，教训 1）。

### 显式非目标（YAGNI）

- **不**做完整 Dark Reader（解析每张样式表、按亮度反色图片、智能处理每种子元素）——那是另一个
  数量级的工程。本功能是**宽覆盖式深黑 CSS**：对纯文字站（cool18、贴吧、博客）效果好，对复杂
  图文站（带彩色 banner / 深色设计站 / 重 JS 应用）可能显示异常。这是简化版夜间模式的固有代价，
  先讲明（见 §9 已知遗留）。
- **不**做自定义颜色 / 调色板（用户只要深黑这一种预设）。
- **不**做 per-site 白/黑名单（所有非工具页 webview 一视同仁，开关全局生效）。
- **不**反色图片（照片会变恐怖，且破坏图文站的视觉信息）。
- **不**用 CDP `Target.targetCreated` 事件替代轮询（未验命门，轮询简单可靠，对齐 blankfix 决策）。
- **不**改 app.asar（项目铁律）。
- **不**做主题热切换 UI（单主题只有开/关两个状态，不需要主题选择器）。

---

## 2. 方案选择（已确认：方案 A 独立模块）

三个候选方案的对比：

### 方案 A：新建 `lib/webview-nightmode.cjs`，复刻 blankfix 架构 ✅ 已选

独立模块，自带状态文件（`.nightmode.json`）、注入 JS 源码常量、`nightmodeManager(sync/close/apply)`。
control-server 启动时起一个 3 秒轮询调 `nightmode.sync()`，和 blankfix 并列。

- ✅ 职责单一，和 blankfix 对称（两个独立的 webview 注入职责，互不耦合）
- ✅ 夜间模式有"开关"语义（blankfix 无状态永远注入），状态管理逻辑自成一体不污染 blankfix
- ⚠️ 需要做 `addScriptToEvaluateOnNewDocument` 的 scriptId 生命周期管理（开关切换时移除旧脚本），
  比 blankfix 多一层——但这是"开关"语义的固有成本，无法回避

### 方案 B：扩展 blankfix.cjs，让它同时剥 `_blank` + 注夜间 CSS

在 blankfix 的注入脚本里加"建夜间 style"逻辑，开关状态也塞进 blankfix。

- ❌ 两个不相关功能焊死（剥链接 vs 改背景色），违反单一职责
- ❌ blankfix 是无状态永远注入，夜间是有状态开关——状态模型冲突，强行合并会让 blankfix 变复杂
- ❌ 违反项目既定纪律（教训 1 的反面：不同职责各管各的，但复用中性工具）

### 方案 C：当 inject.cjs 的一个 mode

- ❌ 方向错——inject.cjs 改的是 **ZCode 主页面**（page target），夜间模式要改的是
  **webview 里的外部网页**（webview target）。两个完全不同的 target 域。
- ❌ inject.cjs 是一次性注入（跑完即退），夜间模式需要常驻轮询（新开的 webview 也要生效）

### 选 A 的理由

1. 和 blankfix 完全对称，是最自然的架构演进（control-server 已有"轮询注册 webview target"
   的成熟模式，再挂一个同型 manager）
2. 状态管理（开/关 + 持久化）自成一体，不污染无状态的 blankfix
3. 复用 cdp.cjs 中性工具，不重写 CDP 胶水（教训 1）

---

## 3. 注入脚本（`NIGHTMODE_SOURCE`）

注入到每个 webview 页面的 JS，在**每次新文档加载前**自动跑（`addScriptToEvaluateOnNewDocument`）。
做两件事：建一个深黑 `<style>` + 幂等保护。

### 注入的 JS（建 style + 幂等）

```js
(function () {
  if (window.__zzNightMode) return;       // 幂等：同文档重复跑无害（bfcache/SPA 路由重跑）
  window.__zzNightMode = true;
  var existing = document.getElementById('zcode-nightmode');
  if (existing) return;                   // 已有 style（之前注册的脚本建的），不重复建
  var s = document.createElement('style');
  s.id = 'zcode-nightmode';
  s.textContent = NIGHTMODE_CSS;          // §3.1 的 CSS 文本，由模块拼接注入
  (document.head || document.documentElement).appendChild(s);
})();
```

**注意**：`NIGHTMODE_CSS` 在实际模块里是 JS 字符串拼接进 SOURCE 的（不是运行时变量）——因为
`addScriptToEvaluateOnNewDocument` 注入的是**自包含源码**，不能引用外部作用域。模块里
`NIGHTMODE_SOURCE = "(function(){...s.textContent=" + JSON.stringify(NIGHTMODE_CSS) + ";...})()"`。

### 3.1 深黑 CSS（`NIGHTMODE_CSS`）

宽覆盖常见文本容器，全部 `!important`（盖过站点内联样式，如 cool18 的 `#E6E6DD`）。

```css
/* 基础：html + body 深底 */
html, body {
  background-color: #1a1a1a !important;
  color: #d4d4d4 !important;
}
/* 常见文本容器：覆盖站点把背景画在子元素上的情况（cool18 的 .main-content / .post-content / pre） */
.main-content, .post-content, #content, #content-section,
article, main, .article, .content, .post, .entry, .entry-content,
.read, .read-content, .text, .article-content, .chapter, .chapter-content,
pre, blockquote, .quote {
  background-color: #1a1a1a !important;
  color: #d4d4d4 !important;
}
/* 链接：深底上要提亮，默认蓝在深底上太暗 */
a, a:link { color: #6db4ff !important; }
a:visited { color: #b06bdb !important; }
a:hover, a:active { color: #9fd1ff !important; }
/* 表格、代码块配套 */
table, th, td { background-color: #242424 !important; color: #d4d4d4 !important; border-color: #444 !important; }
code, pre, kbd, samp { background-color: #242424 !important; color: #d4d4d4 !important; }
/* 标题提亮一点，增强层次 */
h1, h2, h3, h4, h5, h6 { color: #e0e0e0 !important; }
/* 边框/分隔线调暗 */
hr, hr, .divider { border-color: #444 !important; }
```

### 3.2 明确不覆盖的元素（避免误伤）

- **图片**（`img` / `picture` / `video` / `svg`）——不反色、不改背景，保持原样
- **表单控件**（`input` / `textarea` / `select` / `button`）——不改背景色，避免破坏交互视觉
  （深底上的输入框若被强行变深，光标/占位符可能看不见）
- **iframe**——不改（跨 origin 改不了，且内容各异）

这些"不覆盖"是**有意为之的边界**，不是遗漏。如果某站输入框在深底下看不清，是已知遗留（§9）。

### 3.3 幂等保护

两层幂等：
1. `window.__zzNightMode` 标志——`addScriptToEvaluateOnNewDocument` 每个新文档只跑一次，
   但 bfcache/SPA 路由可能重跑，标志挡住重复执行
2. `getElementById('zcode-nightmode')` 检查——即使标志丢了（极少见），已有 style 就不重建，
   避免重复 `<style>` 累积

---

## 4. 架构与组件

### 新模块：`lib/webview-nightmode.cjs`

为什么独立模块（对齐 blankfix/video-mute 的既定纪律）：
- `cdp.cjs` 是**只读模块**（AGENTS.md 明确），改网页背景是**写操作**
- control-server.cjs 已经够大，长连接 + scriptId 管理 + 状态文件逻辑塞进去会让职责模糊
- 和 blankfix 完全对称，是最小惊讶的架构

### 模块职责（导出）

- `NIGHTMODE_CSS` —— 深黑 CSS 文本常量（§3.1）。**纯常量**，单测可断言含关键选择器/颜色
- `NIGHTMODE_SOURCE` —— 注入 JS 源码（§3，含 CSS 拼接）。**纯常量**，单测断言含关键字
  （`__zzNightMode`、`zcode-nightmode`、`createElement('style')`）
- `filterWebviewTargets(targets)` —— **纯函数**：复刻 blankfix 的过滤规则（type==="webview"，
  排除 devtools:// + 工具页路径）。**单测钉死 + 镜像一致性断言**
- `nightmodeManager`（模块级单例，方法**直接挂在 module.exports 上**，对齐 blankfix 的扁平导出
  模式——blankfix 导出 `sync`/`close` 而非一个 manager 对象）：
  - `init(statePath)`：启动时调一次——读 `.nightmode.json` 拿初始 `enabled`，存模块级变量 + 记 statePath
  - `sync()`：对比当前 `/json` 与已注册集合，新增 target 连上+按当前状态注册（开则注册注入脚本，
    关则连上但不注入）、消失 target 断开
  - `apply(enabled)`：开关切换时调——更新 enabled + writeState + 立即对所有已注册 target 执行
    "注册注入脚本"或"移除注入脚本+删当前页 style"
  - `close()`：server 关闭时清理
- `readState(statePath)` / `writeState(statePath, obj)` —— **纯函数化**的状态读写（对称
  rotate.cjs 的 readState/writeState，原子写 tmp+rename）。**单测钉死**（缺失/坏 JSON/原子写）
- `STATE_FILENAME` —— 常量 `".nightmode.json"`（对称 rotate.STATE_FILENAME，供 control-server /
  status.cjs 拼路径，不硬编码字符串）

### 架构图

```
control-server (常驻)
  ├─ 启动: nightmodeManager 读 .nightmode.json 拿初始 enabled
  ├─ 每 3s: nightmodeManager.sync()
  │    ├─ GET /json
  │    ├─ filterWebviewTargets() → 该处理的 webview 列表
  │    ├─ diff vs 已注册集合
  │    ├─ 新增 target:
  │    │    cdp.connect → Page.enable
  │    │    IF enabled: addScriptToEvaluateOnNewDocument(SOURCE) → 存 scriptId
  │    │                + Runtime.evaluate(SOURCE)(覆盖当前页)
  │    │    IF disabled: 不注册（连上即可，方便 apply 时快速注册）
  │    │    → 存 ws + (scriptId?) 进 Map
  │    └─ 消失 target: ws.close() → 从 Map 移除
  ├─ /api/action setNightMode: apply(enabled) → 改状态文件 + 注册/移除所有 target
  └─ close(): clearInterval + nightmodeManager.close()
```

---

## 5. target 过滤（`filterWebviewTargets`）

**完全复刻 `lib/webview-blankfix.cjs` 的 `filterWebviewTargets`**（spec blankfix §5）。
规则：`type === "webview"` + 有 `webSocketDebuggerUrl` + URL 不是 devtools:// + 不是
localhost/127.0.0.1 任意端口的 `/control/` `/reader/` `/api/` 工具页。

```js
function filterWebviewTargets(targets) {
  return targets.filter(function (t) {
    if (t.type !== "webview") return false;
    if (!t.webSocketDebuggerUrl) return false;
    var url = t.url || "";
    if (url.indexOf("devtools://") === 0) return false;
    var m = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.exec(url);
    if (m) {
      var pathPrefix = m[3] || "/";
      if (pathPrefix.indexOf("/control/") === 0 ||
          pathPrefix.indexOf("/reader/") === 0 ||
          pathPrefix.indexOf("/api/") === 0) return false;
    }
    return true;
  });
}
```

### 为什么不 import blankfix 的 filterWebviewTargets

两份相同过滤逻辑（blankfix + nightmode 各一份）确实是教训 17 同型的"两份能各自漂移"。
但：
- blankfix 当前**没导出** `filterWebviewTargets`（只导出 `WEBVIEW_BLANKFIX_SOURCE`/`filterWebviewTargets`/
  `sync`/`close`/`_reset`——实际有导出，但语义是"blankfix 的过滤"）
- 让 nightmode `require("./webview-blankfix.cjs").filterWebviewTargets` 会建立模块间耦合
  （nightmode 依赖 blankfix 的内部过滤函数），破坏"两个独立 webview 注入职责"的对称设计
- **权衡**：复制 15 行 + 镜像一致性单测（三方对齐：cdp.filterTargets / blankfix.filterWebviewTargets /
  nightmode.filterWebviewTargets 排除相同工具页），比建立跨模块依赖更干净

**镜像一致性断言扩展**：`webviewnightmodetest.cjs` 构造一组 target，同时跑三者的过滤函数，
断言排除的工具页集合**完全相同**。改任一处时另两处测试会红，强迫同步。（这是 blankfix 已建立的
"cdp.filterTargets ↔ blankfix.filterWebviewTargets"镜像断言的三方扩展。）

---

## 6. 有状态管理器（`nightmodeManager`）

这是和 blankfix 的**核心差异**：blankfix 无状态永远注入，nightmode 有开/关两态。

### 状态

- `Map<targetId, { ws, call, scriptId }>` —— 已注册的 webview 连接。`scriptId` 是
  `addScriptToEvaluateOnNewDocument` 返回的 identifier（开启时才有，关闭时为 null）
- 模块级 `enabled` 变量 —— 当前开关状态（启动时从 `.nightmode.json` 读，apply 时更新）

### `.nightmode.json` 格式

```json
{ "enabled": false, "updatedAt": 1719216000000 }
```

- `enabled` —— 开关状态（默认 false，首次无文件时）
- `updatedAt` —— 上次切换时间戳（调试用，不影响逻辑）

### `sync()` 算法（每 3 秒）

```
1. GET /json 拿全量 targets
2. filterWebviewTargets() → currentSet
3. 已注册 registeredSet = Map keys
4. 新增 = currentSet - registeredSet:
   对每个新 target:
     a. cdp.connect(wsUrl)
     b. Page.enable
     c. IF enabled:
          r = addScriptToEvaluateOnNewDocument(NIGHTMODE_SOURCE)
          scriptId = r.identifier
          Runtime.evaluate(NIGHTMODE_SOURCE)  // 覆盖当前页
        ELSE:
          scriptId = null  // 连上但暂不注入，方便 apply 快速注册
     d. ws.on("close"/"error") → 从 Map 移除
     e. Map.set(id, {ws, call, scriptId})
     单个失败 try/catch 跳过
5. 消失 = registeredSet - currentSet:
   对每个，ws.close() + Map 移除
```

### `apply(enabled)` 算法（开关切换时调）

```
1. 更新模块级 enabled + writeState(.nightmode.json, {enabled, updatedAt: now})
2. 对 Map 里每个已注册 target:
   IF 新状态是开 且 当前 scriptId 为 null:
     r = call("Page.addScriptToEvaluateOnNewDocument", {source: NIGHTMODE_SOURCE})
     scriptId = r.identifier
     call("Runtime.evaluate", {expression: NIGHTMODE_SOURCE})  // 当前页立即生效
     更新 Map[id].scriptId
   IF 新状态是关 且 当前 scriptId 非 null:
     call("Page.removeScriptToEvaluateOnNewDocument", {identifier: scriptId})
     call("Runtime.evaluate", {expression: REMOVE_STYLE_EXPR})  // 删当前页的 style
     Map[id].scriptId = null
3. 返回 {affected: 处理的 target 数}
```

`REMOVE_STYLE_EXPR` = `(function(){var s=document.getElementById('zcode-nightmode');if(s)s.remove();})()`

### 关键设计决策

1. **去重键用 `target.id` 不用 url**（对齐 blankfix 决策 1）：webview 导航时 id 不变 url 变。

2. **ws 断开自动清理 + 下次 sync 重连**（对齐 blankfix 决策 2）：自愈，无需额外重试。

3. **`Page.enable` 是 `addScriptToEvaluateOnNewDocument` 前置**（对齐 blankfix 决策 3，CDP 文档要求）。

4. **开启时注册后立即 evaluate 覆盖当前页**（对齐 blankfix 决策 4）：`addScriptToEvaluateOnNewDocument`
   只对未来文档生效，当前已加载页要立即跑一次 evaluate 才生效。否则用户点"开启"后当前页不变，
   要导航一次才变——体验坏。

5. **关闭用 `removeScriptToEvaluateOnNewDocument` + evaluate 删 style 双管齐下**：
   - `removeScriptToEvaluateOnNewDocument` 阻止**未来**文档再注入（命门，见 §10 必须真机验）
   - `Runtime.evaluate` 删**当前**页已建的 style（立即生效）
   两者缺一：要么未来页还会变深（remove 没生效），要么当前页不变浅（style 没删）。

6. **关闭时不断开 ws**：apply 关闭只移除脚本 + 删 style，ws 连接保留（下次开启能快速重新注册，
   不用等 sync 重连）。只有 target 消失（webview 关闭）才断 ws。

7. **状态文件是单一权威**：enabled 的真值在 `.nightmode.json`，模块级变量是缓存。apply 写文件 +
   更新缓存；sync 读缓存。status.cjs 读文件（不读缓存，避免和 server 内存漂移，教训 1）。
   对齐 rotate 的"rotate 写 /rotate.json，status 读它"单向数据流。

8. **并发安全**（对齐 blankfix 决策 6）：sync 和 apply 都 async，Map 读写无锁。3 秒间隔 + apply
   是用户点击触发（低频），实际不重叠。最坏情况同 target 被注册两次——`__zzNightMode` 幂等标志
   挡住重复建 style。不加锁（YAGNI）。

### `close()` 方法

```
clearInterval(由 control-server 管)
对 Map 每个 ws: ws.close()
Map.clear()
```

### 单测策略

- `filterWebviewTargets` —— 纯函数，全测 + 镜像一致性（三方对齐）
- `NIGHTMODE_CSS` / `NIGHTMODE_SOURCE` —— 纯常量，断言含关键字
- `readState` / `writeState` —— 纯函数，测缺失/坏 JSON/原子写（对称 rotatetest）
- `nightmodeManager.sync()` / `apply()` / `close()` —— **不单测**（跨进程 CDP 胶水 + ws 生命周期，
  教训 12/13，靠真机验）

---

## 7. control-server 集成

### 集成点（control-server.cjs 改动）

1. **启动时**：`createServer` 的 `tryListen` 成功回调里，和 blankfix 并列启动 manager：
   ```js
   const nightmode = require("./webview-nightmode.cjs");
   const nightmodeStatePath = path.join(root, nightmode.STATE_FILENAME);
   nightmode.init(nightmodeStatePath);  // 读 .nightmode.json 拿初始 enabled
   const nightmodeTimer = setInterval(() => {
     nightmode.sync().catch(() => {});  // 失败不致命
   }, 3000);
   ```

2. **action 处理**：在 `/api/action` 的 `req.on("end")` 里加分支（和 muteVideo 同型，即时返回不等 spawn）：
   ```js
   if (req2.action === "setNightMode") {
     const enabled = !!req2.enabled;
     nightmode.apply(enabled).then(function (r) {
       return sendJson(res, 200, { accepted: true, enabled: enabled, affected: r.affected });
     }).catch(function (e) {
       return sendJson(res, 200, { accepted: false, error: e.message });
     });
     return;
   }
   ```

3. **关闭时**：`close()` 里加 `nightmode.close()`。

4. **返回对象**加 `nightmodeTimer`（供测试/调试，参照 blankfixTimer）。

### 为什么 setNightMode 走即时返回（不走 spawn/jobId）

对齐 muteVideo/unmuteVideo（control-server.cjs:241-249）：夜间模式是即时 CDP 写操作（注册/移除脚本），
不是 spawn 子进程的长任务。即时返回 `{accepted, enabled, affected}`，前端靠下一次 status 轮询确认。
不走全局 activeJob 锁（那是给 spawn 动作用的）。

### 架构澄清（避免循环依赖误判）

和 blankfix 完全同型：control-server 跑在 `http://127.0.0.1:17890/control/`，这个页面本身在一个
webview target 里，但 `filterWebviewTargets` **排除了** `/control/` 路径，所以 nightmode **不会
处理它自己**（也不会把自己的控制面板变深黑——控制面板有自己的主题，不需要夜间模式）。

---

## 8. status.cjs 集成

### 新增 probe 项：`nightmode`

读 `.nightmode.json`（不读 server 内存缓存，单一权威 = 文件）：

```js
async function probeNightmode(root) {
  const state = nightmode.readState(path.join(root, nightmode.STATE_FILENAME));
  return { enabled: !!state.enabled, updatedAt: state.updatedAt || null };
}
```

加进 `snapshot()` 的 parts（对称 probeRotate）：

```js
try { parts.nightmode = await probeNightmode(root); }
catch (e) { parts.nightmode = null; parts.nightmodeError = e.message; }
```

`mergeProbeResults` 的循环加 `"nightmode"`（对称 rotate）。探查失败不致命（文件读不了返回 null +
probeErrors，整体仍 200）。

### status JSON 新增字段

```json
{
  "nightmode": { "enabled": false, "updatedAt": 1719216000000 }
}
```

---

## 9. 前端集成

### control/index.html 加开关

在 `#actions` 面板加一个开关按钮（和 muteVideo 同型）：

```html
<button data-action="toggleNightMode">🌙 夜间模式</button>
```

按钮文字随状态变（开 = "🌙 夜间模式: 开"，关 = "🌙 夜间模式: 关"），由 control.js poll 时更新。

### control.js 改动

1. **poll 时更新按钮状态**：读 `st.nightmode.enabled`，更新按钮文字 + disabled（debug port 不通时禁用，
   对齐 cdpBtns 逻辑）。
2. **点击 dispatch `toggleNightMode`**：读当前状态取反，发 `setNightMode {enabled: 反值}`。

```js
// poll 里：
var nm = st.nightmode || {};
var nmBtn = document.querySelector('[data-action="toggleNightMode"]');
if (nmBtn) {
  nmBtn.disabled = !cdpOk;
  nmBtn.textContent = nm.enabled ? "🌙 夜间模式: 开" : "🌙 夜间模式: 关";
}
// 点击处理（actions 容器监听里加）：
if (action === "toggleNightMode") {
  var nmNow = /* 从上次 poll 缓存的 st.nightmode.enabled */;
  finalAction = "setNightMode";
  params = { enabled: !nmNow };
}
```

（实现时 `nmNow` 用一个模块级变量在 poll 里更新，避免点击时再 fetch。）

### 为什么不放状态面板（status-panel）而放动作面板（actions）

夜间模式是**可触发动作**（点按钮切换），不是纯状态显示。放 actions 面板和 mute/透明度等
"可操作项"一致。状态面板只显示只读快照。

---

## 10. 命门与已知遗留

### 必须真机验的命门（实施第一步）

1. **`Page.removeScriptToEvaluateOnNewDocument` 在 Electron webview target 上是否生效** ——
   这是关闭功能的命门。教训 28 明确：CDP 对 webview 的支持是子集，page target 上 work 的 API
   webview 上不一定 work。`addScriptToEvaluateOnNewDocument` 已验生效（blankfix），但
   `removeScriptToEvaluateOnNewDocument` **没验过**。万一不生效，关闭后未来导航的页还会变深——
   得有兜底（见下）。

   **兜底设计**：即使 `removeScriptToEvaluateOnNewDocument` 不生效，`apply(关闭)` 仍会
   `Runtime.evaluate` 删当前页的 style。最坏情况是"当前页变浅了，但下次导航又变深"——此时
   降级方案是"关闭时直接断开该 target 的 ws"（CDP 连接断开时所有注册脚本自动清除，对齐 blankfix
   决策 5 的"断 ws = 注册失效"思路）。实施时先验 remove，不灵就用断 ws 兜底。

2. **`addScriptToEvaluateOnNewDocument` 在 webview 上跨导航持续生效** —— blankfix 已验（AGENTS.md
   教训 28），nightmode 复用同一机制，理论同效。实施时跑一次完整 sync 流程确认。

### 已知遗留（先讲明，不是 bug）

- **宽覆盖 CSS 对纯文字站效果好，对复杂图文站可能异常**：带彩色 banner / 深色设计站 / 重 JS 应用
  （如某些 SaaS 后台）可能显示错乱。这是简化版夜间模式的固有代价（§1 显式非目标：不做完整 Dark Reader）。
  遇到具体站显示坏，用户可临时关掉夜间模式看原页。
- **不覆盖图片/表单控件**（§3.2 有意为之）：某站输入框在深底下看不清是已知边界。
- **首次开启有最多 3 秒延迟**：用户刚打开 webview 标签的瞬间，hook 可能还没装上（轮询还没跑），
  这 3 秒内夜间模式未生效。hook 装上后导航的新页永久有效。和 blankfix 同款轮询架构限制。
- **不带 debug port 则失效**：ZCode 必须带 `--remote-debugging-port=9222` 启动，CDP 连不上则
  nightmode 完全失效。和所有 CDP 能力同前提（AGENTS.md "没有 startZcode action"）。前端按钮在
  status.zcode 为 null 时禁用（对齐 cdpBtns）。
- **`window.open()` 弹出的窗口不覆盖**：blankfix 已知遗留同款，nightmode 也不处理（webview 无
  allowpopups，弹不出，无需覆盖）。
- **非 webview target（page target = ZCode 主页面）不受影响**：filterWebviewTargets 只过
  `type === "webview"`，ZCode 主页面（壁纸注入目标）不会被夜间模式误伤。

---

## 11. 测试策略

### 单测覆盖（`test/webviewnightmodetest.cjs`，新增，加入 `npm test` 链）

1. **`filterWebviewTargets` 纯函数**——全测，模仿 blankfix test：
   - 排除非 webview 类型 → 0
   - 排除无 wsUrl → 0
   - 排除 devtools:// → 0
   - 排除 localhost/127.0.0.1 任意端口的 /control/ /reader/ /api/ → 0
   - 保留外部站 webview → 1
   - 保留 url 为空但有 wsUrl 的 webview → 1
   - **三方镜像一致性断言**（教训 17 扩展）：同一组 target 跑 `cdp.filterTargets`、
     `blankfix.filterWebviewTargets`、`nightmode.filterWebviewTargets`，断言三者排除的工具页集合
     **完全相同**（只是类型维度 page vs webview 不同）

2. **`NIGHTMODE_CSS` 纯常量**——断言含关键选择器/颜色（防漂移）：
   - `background-color: #1a1a1a`（深黑底）
   - `color: #d4d4d4`（浅灰字）
   - `.main-content`（cool18 命中）
   - `!important`（盖站点内联）
   - `a:link`（链接提亮）

3. **`NIGHTMODE_SOURCE` 纯常量**——断言含关键字：
   - `__zzNightMode`（幂等标志）
   - `zcode-nightmode`（style id）
   - `createElement('style')`（建 style）
   - `addEventListener` 不应有（夜间模式不需要 observer/click，一次性建 style 即可——
     和 blankfix 的三道关不同，CSS 应用后浏览器自动处理后续渲染）

4. **`readState` / `writeState` 纯函数**（对称 rotatetest）：
   - 缺失文件 → `{enabled: false}`
   - 坏 JSON → `{enabled: false}`
   - 正常读 → 保留 enabled/updatedAt
   - writeState 原子写（tmp + rename，写后 readState 能读回）

5. **执行 SOURCE against fake DOM**（验证建 style 语义）：
   - 预置空 document，跑 SOURCE → `#zcode-nightmode` style 存在，textContent 含 CSS
   - 重复跑 SOURCE（幂等）→ 不报错、不建第二个 style
   - 用手写最小 fake `document`/`window`（不引 jsdom，YAGNI，对齐 blankfix test 决策）

### 不单测（靠真机验）

- `nightmodeManager.sync()` / `apply()` / `close()` —— CDP 长连接 + ws 生命周期 + scriptId 管理，
  跨进程胶水（教训 12/13）
- `removeScriptToEvaluateOnNewDocument` 在 webview 生效 —— 命门，§10 必须真机验
- 开关切换后当前页 + 未来页都正确变深/变浅 —— 真机验

### 真机验证清单（写进 spec，实施后执行）

1. 启 control-server + ZCode 带 9222
2. 在 webview 打开 cool18 帖子页（或任意浅色长文站）
3. 控制中心点"🌙 夜间模式" → 应 ≤3 秒内当前页变深黑（背景 #1a1a1a、文字 #d4d4d4）
4. webview 里导航到新页（点站内链接）→ 新页也自动深黑（验 addScript 跨导航生效）
5. 点"🌙 夜间模式: 开"关闭 → 当前页立即变回浅色（验 evaluate 删 style）
6. 再导航到新页 → 新页是浅色（验 removeScriptToEvaluateOnNewDocument 生效——**命门**）
7. 重启 control-server → 夜间模式状态保持上次（验 .nightmode.json 持久化）
8. 关闭该 webview 标签 → sync 自动清理（日志不报错、无 ws 泄漏）
9. debug port 不通时 → 按钮禁用（验前端 cdpOk 守卫）

### 回归测试关注点

新增 `webview-nightmode.cjs` 后确保现有测试仍绿。特别：
- `statustest` / `statusviewtest` —— snapshot 多了 nightmode 项，断言要更新
- `controlservertest` —— /api/action 多了 setNightMode 分支
- `menutest` —— 不受影响（菜单没加场景，夜间模式纯控制中心触发）

---

## 12. 实现清单（给 writing-plans 用）

### 新增文件

| 文件 | 作用 | 测试 |
|------|------|------|
| `lib/webview-nightmode.cjs` | NIGHTMODE_CSS/SOURCE 常量 + filterWebviewTargets + readState/writeState + nightmodeManager(init/sync/apply/close) | 部分单测 + 真机验 |
| `test/webviewnightmodetest.cjs` | 纯函数 + 常量 + fake DOM + 状态读写 | — |

### 修改文件

| 文件 | 改动 |
|------|------|
| `lib/control-server.cjs` | 启动 nightmode.init + setInterval(sync,3000) + /api/action setNightMode 分支 + close() 调 nightmode.close() + 返回对象加 nightmodeTimer |
| `lib/status.cjs` | 新增 probeNightmode + snapshot 加 nightmode 项 + mergeProbeResults 循环加 "nightmode" |
| `control/lib/status-view.js` | renderStatus 加 nightmode 行（显示开/关） |
| `control/index.html` | #actions 加 toggleNightMode 按钮 |
| `control/control.js` | poll 更新按钮状态/文字 + 点击 dispatch toggleNightMode → setNightMode |
| `package.json` | test 链加 `webviewnightmodetest`（在 webviewblankfixtest 后） |
| `.gitignore` | 加 `.nightmode.json`（对称 .rotate.json） |
| `AGENTS.md` | 新增"webview 网页夜间模式"章节 + 教训补丁（removeScript 命门） |

### AGENTS.md 新章节要点（实施时写）

- 目标（webview 外部网页深黑主题，纯文字站效果好）
- 为什么能做（复用 blankfix 的 webview 注入通路）
- 模块定位（独立模块，对称 blankfix，复用 cdp.cjs 中性工具）
- 开关状态管理（.nightmode.json 持久化 + scriptId 生命周期）
- 已知遗留（宽覆盖 CSS 对复杂图文站可能异常 / removeScript 命门 / 首次 3 秒延迟）
- 教训补丁：`removeScriptToEvaluateOnNewDocument` 在 webview 上是否生效必须真机验（教训 28 同型）

### 风险/未验点（实施时第一步验）

1. **`removeScriptToEvaluateOnNewDocument` 命门**（§10）—— 实施第一步写真机探测脚本验它生效；
   不灵则降级为"关闭时断 ws"兜底（CDP 连接断开自动清注册脚本）。
2. **三方 filterWebviewTargets 一致性**——镜像断言已覆盖，但实施时要确认 cdp/blankfix/nightmode
   三处的 15 行规则逐字一致（不是"差不多"）。
3. **apply 并发**——用户快速连点开关可能触发 apply 重叠。最坏情况 style 多建/多删一次，
   幂等标志兜底。不加锁（YAGNI），但实施时观察有无异常。
