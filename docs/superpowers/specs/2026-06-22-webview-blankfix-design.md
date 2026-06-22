# 设计稿：webview `_blank` 链接同窗口跳转修复

**日期**：2026-06-22
**状态**：待实现（spec 已与用户逐段确认：机制 / 架构 / 注入脚本 / 过滤 / 状态管理 / server 集成 / 测试 / 实现清单 共 8 节）
**作者**：brainstorming 会话产出
**分支**：`feat/webview-blankfix`

---

## 1. 目标

修复 ZCode 内置浏览器面板（webview）里 `target="_blank"` 链接点击后**完全没反应**的问题。

### 起因（用户报告）

用户通过控制中心书签打开外部网站（如智谱开放平台 `open.bigmodel.cn`），该网站里有大量
`<a target="_blank">` 链接（"控制台"、"模型中心"等），在 webview 里点击后**完全没反应**——
不跳转、不开新窗口、不报错。

### 根因（已真机探测定位）

ZCode 的 `<webview>` 元素（`data-testid="browser-webview"`）**没有 `allowpopups` 属性**。
Electron webview 默认禁弹窗，所以 `target="_blank"` 点击后，host 层（ZCode app.asar）决定
"不开新窗口"且"不在 webview 内导航"——表现就是完全没反应。

这是 host 侧（app.asar）的行为，但**我们不需要改 app.asar**——webview 有独立 CDP target
（`type === "webview"`），从 webview 内部页面的 CDP target 改写即可。

### 三个命门（均已真机验证）

1. **webview 无 allowpopups** —— `scripts/inspect-newwindow.cjs` dump webview 属性确认
2. **剥掉 `target="_blank"` 后同窗口跳转成功** —— `scripts/test-blank-rewrite.cjs` + `scripts/install-blank-fix.cjs`
   实测：智谱开放平台 78 个 `_blank` 全部剥除后，用户点击"控制台"在 webview 内成功跳转
3. **`Page.addScriptToEvaluateOnNewDocument` 在 webview target 上生效** —— `scripts/test-addscript-newdoc.cjs`
   实测：注册 marker 脚本后导航，新文档自动出现 marker（跨导航生效）

### 核心定位（用户确认的三个决策）

1. **触发方式**：自动生效（后台轮询，无感）
2. **作用范围**：所有非工具页 webview（排除 control/reader/api）
3. **注册时机**：control-server 后台轮询（每 3 秒）自动注册

### 和现有子系统的关系

这是 control-center 的**又一个常驻职责**（和 rotate spawn、video-mute evaluate 同型）。
新增独立模块 `lib/webview-blankfix.cjs`，复用 `cdp.cjs` 的中性 CDP 工具（connect/httpGetJson），
对齐 `video-mute.cjs` 的架构定位（写操作独立成模块，不污染 cdp.cjs 只读语义）。

### 显式非目标（YAGNI）

- **不**处理 `window.open()` 调用（风险大于收益，见 §3）
- **不**做前端开关 UI（功能默认开）
- **不**用 CDP `Target.targetCreated` 事件替代轮询（未验命门，轮询简单可靠）
- **不**做 per-site 白/黑名单（所有非工具页一视同仁）
- **不**改 app.asar（项目铁律）
- **不**持久化"已注册"状态到文件（内存 Map 即可，重启重新注册无损失）

---

## 2. 方案选择（已确认：方案 B）

三个候选方案的对比：

### 方案 A：纯后台轮询重注入

control-server 每 N 秒扫 webview targets，对每个外部站跑 `Runtime.evaluate` 剥 `_blank` +
装 MutationObserver。

- ✅ 只用已验证的 `Runtime.evaluate`（最稳）
- ❌ **有空窗**：导航到新页后，N 秒内 hook 没装上时点的 `_blank` 还是没用（正是用户抱怨的问题）
- ❌ 轮询持续开销，SPA 动态渲染链接可能错过窗口

### 方案 B：`addScriptToEvaluateOnNewDocument` 长连接 ✅ 已选

control-server 维护"已注册的 webview target"集合（`Map<targetId, ws>`），发现新 webview 就
连上 + `addScriptToEvaluateOnNewDocument` 注册剥离脚本，**保持长连接**。脚本在每次新文档
加载前自动跑，无空窗。

- ✅ **无空窗**（每个新页面加载前 hook 就位）
- ✅ 一次性注册，不持续轮询开销
- ⚠️ 需维持长连接（断了注册失效，靠下次 sync 重连）—— control-server 本就常驻，可接受
- ⚠️ 两个命门都已真机验通（不是赌）

### 方案 C：CDP `Page.setWindowOpenOverride` 拦截

CDP 专门拦截 `window.open`/`_blank` 的 API。

- ❌ 在 Electron webview target 上行为完全未知，无文档
- ❌ 拦截后"怎么导航回同 webview"无解（webview target 可能不支持 Page.navigate 回自身）
- ❌ 风险高，命门未验

### 选 B 的理由

1. 两个命门都已真机验通（剥 `_blank` 生效 + addScript 在 webview 生效）
2. 无空窗是用户体验命门（用户抱怨的就是"点了没反应"，有空窗等于没根治）
3. 架构上和 `video-mute.cjs` 同型（control-server 通过 CDP 操作 webview target），是合理演进
4. target 发现用轮询而非 CDP `Target.targetCreated` 事件，因为后者可靠性也未知（又一命门），
   轮询简单可靠

---

## 3. 注入脚本（`WEBVIEW_BLANKFIX_SOURCE`）

注入到每个 webview 页面的 JS，在**每次新文档加载前**自动跑（`addScriptToEvaluateOnNewDocument`）。
做三件事：

```js
(function () {
  if (window.__zzBlankFix) return;        // 幂等：同文档重复跑无害
  window.__zzBlankFix = true;
  window.__zzBlankFixCount = 0;

  function strip(a) {
    if (a && a.tagName === 'A' &&
        (a.getAttribute('target') === '_blank' || a.target === '_blank')) {
      a.removeAttribute('target');        // 剥掉 → 默认 _self → 同窗口跳转
      window.__zzBlankFixCount++;
    }
  }

  // 1. 剥现有
  var all = document.querySelectorAll('a[target="_blank"]');
  for (var i = 0; i < all.length; i++) strip(all[i]);

  // 2. MutationObserver：动态渲染的链接(SPA 常见)
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      for (var j = 0; j < muts[i].addedNodes.length; j++) {
        var n = muts[i].addedNodes[j];
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'A') strip(n);
        if (n.querySelectorAll) {
          var inner = n.querySelectorAll('a[target="_blank"]');
          for (var k = 0; k < inner.length; k++) strip(inner[k]);
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // 3. capture-phase click 兜底：MutationObserver 装好之后才新加的链接
  //    可能在 click 时还没被 strip，这里最后一道关
  document.addEventListener('click', function (e) {
    try {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a) strip(a);
    } catch (x) {}
  }, true);
})();
```

### 为什么三道关都要

真机探测的证据（智谱开放平台首页 78 个 `_blank`）：
- 大多首屏静态渲染 → 关 1（剥现有）覆盖
- 现代 SPA 路由切换、懒加载动态插入新 `<a>` → 关 2（MutationObserver）覆盖
- 链接在 click 触发到执行之间才插入 → 关 3（capture click）兜底。capture phase 先于
  target 默认导航，来得及改

### 为什么用 `removeAttribute('target')` 而非 `a.target = '_self'`

两者效果相同，但 `removeAttribute` 更彻底（`getAttribute` 返回 null），避免某些框架根据
`hasAttribute('target')` 做特殊处理时残留副作用。

### 幂等保护

`if (window.__zzBlankFix) return`——`addScriptToEvaluateOnNewDocument` 每个新文档只跑一次，
但万一因 bfcache/SPA 路由脚本被重跑，幂等保证不重复装 observer（否则 observer 累积成性能黑洞）。

### 不处理 `window.open()`（已知遗留）

这次**不处理** `window.open()` 调用。理由：
- 用户报告的现象是 `target="_blank"` 链接打不开（HTML `<a>`），是绝大多数站点弹窗方式
- `window.open()` 是 JS 主动调用，要拦得重写 `window.open`，但 `addScriptToEvaluateOnNewDocument`
  在页面脚本之前跑理论上能拦——不过会**破坏依赖 `window.open` 拿返回值**的正常站点逻辑
  （很多站用 `var w = window.open(); w.postMessage(...)` 做弹窗通信）
- 风险大于收益，YAGNI，先不做

如果以后遇到具体站点用 `window.open` 弹窗打不开，再加（且只拦无参/广告型 open）。

---

## 4. 架构与组件

### 新模块：`lib/webview-blankfix.cjs`

为什么独立模块（不塞进 cdp.cjs 或 control-server.cjs）：
- `cdp.cjs` 是**只读模块**（AGENTS.md 明确），剥 `_blank` 是**写操作**——和 `video-mute.cjs`
  同型决策（写操作独立成模块，但复用 cdp.cjs 的 connect/httpGetJson 中性工具，不重写 CDP 胶水，教训 1）
- control-server.cjs 已经够大（novel API + status + action + rotate），长连接管理逻辑塞进去
  会让职责模糊

### 模块职责

- `WEBVIEW_BLANKFIX_SOURCE` —— 要注入的 JS 源码字符串（§3）。**纯常量**，单测可断言其内容
  （含 `removeAttribute('target')`、MutationObserver、capture click 关键字）
- `filterWebviewTargets(targets)` —— **纯函数**：从 `/json` 全量 target 筛出"该处理的 webview
  target"。规则：`type === "webview"` + 有 `webSocketDebuggerUrl` + URL 不是工具页。**单测钉死**
- `blankfixManager` —— **有状态对象**：维护 `{targetId → ws连接}` 映射；`sync()` 方法对比当前
  `/json` 与已注册集合，新增的连上+注册、消失的断开。**不单测**（跨进程胶水，教训 12，靠真机验）

### 架构图

```
control-server (常驻)
  ├─ 每 3s: blankfixManager.sync()
  │    ├─ GET /json
  │    ├─ filterWebviewTargets() → 该处理的 webview 列表
  │    ├─ diff vs 已注册集合
  │    ├─ 新增 target: cdp.connect → Page.enable → addScriptToEvaluateOnNewDocument(SOURCE)
  │    │              → Runtime.evaluate(SOURCE)(覆盖当前页) → 存 ws
  │    └─ 消失 target: ws.close() → 从集合移除
  └─ close(): clearInterval + 关所有 ws
```

---

## 5. target 过滤（`filterWebviewTargets`）

决定"哪些 webview 该处理"的纯函数，**必须和 cdp.cjs 的 `filterTargets` 排除规则对齐**。

### 规则

对比现有 `filterTargets`（cdp.cjs:18-34）：
- 它只过 `type === "page"`
- 我们需要过 `type === "webview"`
- **排除规则完全复用**：devtools://、localhost/127.0.0.1 任意端口的 `/control/` `/reader/` `/api/` 路径

### 纯函数定义

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

### 为什么不复用 `cdp.filterTargets`

它硬编码 `t.type !== "page"`，我们要 `"webview"`。强行复用要么改它的签名（破坏现有 5 个调用点 +
5 个测试），要么传参——两种都污染了"filterTargets = page 过滤"的清晰定位。**复制这 15 行排除规则**
更干净，且**单测钉死两边规则一致**（教训 17 同型：两份相同逻辑靠共享测试同步）。

### 测试钉死一致性

`webviewblankfixtest.cjs` 里有**镜像断言**——构造一组 target（page + webview + 工具页 + 外部站），
同时跑 `cdp.filterTargets` 和 `filterWebviewTargets`，断言：两者排除了**完全相同**的工具页/devtools，
只是类型维度不同。这样改 cdp.filterTargets 时这边测试会红，强迫同步。

### 边界：url 为空的 webview

`type === "webview"` 但 url 为空（刚创建还没导航）——**保留**（有 wsUrl 就处理，注册脚本后它一旦
加载页面就生效）。`filterWebviewTargets` 只要求 `type + wsUrl`，不要求 url 非空。

---

## 6. 有状态管理器（`blankfixManager`）

### 状态

一个 `Map`，key = target 的 `id`（CDP `/json` 每项稳定 id），value = `{ ws, call }`（连接句柄）。

### `sync()` 算法（每 3 秒调一次）

```
1. GET /json 拿全量 targets
2. filterWebviewTargets() → 当前该处理的 target 集合 currentSet
3. 已注册 registeredSet = Map 的 keys
4. 新增 = currentSet - registeredSet：
   对每个新 target:
     a. cdp.connect(wsUrl)
     b. Page.enable（addScript 前置要求）
     c. Page.addScriptToEvaluateOnNewDocument(WEBVIEW_BLANKFIX_SOURCE)
     d. Runtime.evaluate(WEBVIEW_BLANKFIX_SOURCE)（覆盖当前已加载页，见决策 4）
     e. 挂 ws.on("close"/"error") → 从 Map 移除（下次 sync 会重连）
     f. 存入 Map
     单个失败 try/catch 跳过，继续其他
5. 消失 = registeredSet - currentSet：
   对每个，ws.close() + 从 Map 移除
```

### 关键设计决策

1. **去重键用 `target.id`，不用 url**：webview 导航时 `id` 不变但 `url` 变（智谱首页 → 控制台，
   同一个 webview target）。用 url 当 key 会导致每次导航后误判"新 target"重复注册。`id` 稳定，
   注册一次永久有效。

2. **ws 断开自动清理 + 下次 sync 重连**：CDP 连接可能因 webview crash、session 失效、ZCode 重启
   而断。挂 `ws.on("close"/"error")` 立即从 Map 移除，下次 `sync()` 发现"这个 id 不在 Map 里但
   还在 currentSet"→ 重连重注册。**自愈**，无需额外重试逻辑。

3. **`Page.enable` 是 `addScriptToEvaluateOnNewDocument` 的前置**：CDP 文档要求先启用 Page 域。
   忘了这步，addScript 静默不生效（又一个单测验不到的坑，靠真机验）。

4. **注册后立即也跑一次 evaluate（覆盖当前页）**：`addScriptToEvaluateOnNewDocument` 只对**未来**
   的新文档生效，当前已加载的文档不会自动跑。所以注册后**立刻** `Runtime.evaluate(SOURCE)` 一次，
   覆盖当前页。否则用户打开 webview 后，当前页的 `_blank` 链接点不动，没法触发导航让 hook 生效。
   这一步是必做的（真机探测时正是这么干的）。

5. **`addScriptToEvaluateOnNewDocument` 返回的 identifier 不存**：理论上可以用
   `removeScriptToEvaluateOnNewDocument` 清理，但我们用"断开 ws = 注册失效"更简单（CDP 连接断开时
   所有注册的脚本自动清除）。identifier 只在调试时打印。

6. **并发安全**：`sync()` 用 `async`，但 Map 读写无锁。3 秒间隔 + 每次操作都很快（几十 ms），
   实际不会重叠。万一重叠，最坏情况是同一 target 被注册两次——但 `__zzBlankFix` 幂等标志会挡住
   重复装 observer（§3），第二次只是多一次无意义 evaluate。可接受，不加锁（YAGNI）。

### `close()` 方法（server 关闭时调）

```
clearInterval(syncTimer)
对 Map 每个 ws: ws.close()
Map.clear()
```

### 单测策略

- `filterWebviewTargets` —— 纯函数，全测
- `WEBVIEW_BLANKFIX_SOURCE` —— 纯常量，断言含关键关键字（`removeAttribute('target')`、
  `MutationObserver`、`__zzBlankFix`、`addEventListener('click'`）
- `blankfixManager.sync()` / `close()` —— **不单测**（跨进程 CDP 胶水 + ws 生命周期，教训 12/13，
  靠真机验）

---

## 7. control-server 集成

### 集成点（control-server.cjs 改动）

1. **启动时**：`createServer` 的 `tryListen` 成功回调里，resolve 之前启动 manager：
   ```js
   const blankfix = require("./webview-blankfix.cjs");
   const blankfixTimer = setInterval(() => {
     blankfix.sync().catch(() => {});  // 失败不致命,下次重试
   }, 3000);
   ```

2. **关闭时**：`close()` 里加 `blankfix.close()`（clearInterval + 关所有 ws）。

3. **返回对象**里加 `blankfixTimer`（供测试/调试用，参照现有 `port`/`library` 的暴露模式）。

### 为什么 sync 失败用 `.catch(() => {})` 吞掉

ZCode 没开 / debug port 不通时，`cdp.httpGetJson("/json")` 会抛。这种情况下整个 blankfix 静默
不工作，**不应该让 control-server 崩**。和 status.cjs 的"探查失败不致命"哲学一致。下次 sync 又会重试。

### 架构澄清（避免循环依赖误判）

- control-server 跑在 `http://127.0.0.1:17890/control/`，这个页面**本身就在一个 webview target 里**
- 但 `filterWebviewTargets` **排除了** `/control/` 路径（§5），所以 blankfix **不会处理它自己** ✅
- control-server **进程本身是 node 进程**，它通过 CDP 连 ZCode 的 debug port（9222）。这个 node
  进程和 webview 里的 control/ 页面是**两回事**——node 进程跑在 ZCode 外部，CDP 连进去操作 webview

```
┌─ ZCode (Electron, debug port 9222) ─────────────────────┐
│  ├─ page target (主页面)                                  │
│  ├─ webview target #1: https://open.bigmodel.cn/  ← 处理 │
│  └─ webview target #2: http://127.0.0.1:17890/control/   │
│        └─ 这里运行 control/ 前端 SPA                     │
│           (用户在这里点按钮 → fetch /api/action)         │
└──────────────────────────────────────────────────────────┘
        ▲                              ▲
        │ CDP ws 连接(9222)            │ HTTP(17890)
        │                              │
┌───────┴──────────┐  ┌────────────────┴──────────────────┐
│ control-server   │  │ control/ 前端 SPA                  │
│ (node 进程)      │  │ (在 webview #2 里跑,localStorage)  │
│ - HTTP server    │←→│ - 点书签 → go.html → 外部站        │
│ - blankfix 每3s  │  │ - 外部站就是 webview #1            │
│   连 9222 操作   │  │   (blankfix 会让它的 _blank 同窗口)│
│   webview targets│  └────────────────────────────────────┘
└──────────────────┘
```

### 已知遗留：不带 debug port 则失效

**ZCode 必须带 debug port 启动，blankfix 才工作**。如果用户从普通方式启动 ZCode（没带
`--remote-debugging-port=9222`），control-server 的 CDP 连不上，blankfix 完全失效。

这和图片/视频壁纸/透明等所有 CDP 依赖的能力是**同一个前提**（AGENTS.md "没有 startZcode action"
小节：用户正常开 ZCode 不带 debug port → 注入必败）。不是新坑，是已有约束的延伸。

### 前端提示（最小改动）

control/index.html 的书签区，加一行小字提示，**条件渲染**（status 显示 zcode 不通时才显示），
不破坏现有布局。不做开关 UI（YAGNI——功能默认开，提示就够了）。文案如：
"`_blank` 链接修复需 ZCode 带 debug port 启动，请从 wallpaper.bat 场景 2/13 重启"

---

## 8. 测试策略

### 单测覆盖（`webviewblankfixtest.cjs`，新增，加入 `npm test` 链）

1. **`filterWebviewTargets` 纯函数**——全测，模仿 `transparenttest.cjs` 测 `selectMainWindow` 风格：
   - 排除非 webview 类型（page/iframe/worker）→ 0 结果
   - 排除无 wsUrl 的 → 0
   - 排除 devtools:// → 0
   - 排除 localhost/127.0.0.1 任意端口的 /control/ /reader/ /api/ → 0
   - **保留**外部站 webview（https://open.bigmodel.cn/）→ 1
   - **保留** url 为空但有 wsUrl 的 webview（§5 边界）→ 1
   - **镜像一致性断言**（教训 17）：同一组 target 跑 `cdp.filterTargets` 和 `filterWebviewTargets`，
     断言两者排除的工具页集合**完全相同**，只是类型维度不同

2. **`WEBVIEW_BLANKFIX_SOURCE` 纯常量**——断言含关键字（钉死脚本结构，防漂移）：
   - `__zzBlankFix`（幂等标志）
   - `removeAttribute('target')`（剥除核心）
   - `MutationObserver`（动态链接）
   - `addEventListener('click'`（capture 兜底）
   - `childList: true, subtree: true`（observer 配置）

3. **执行脚本 against fake DOM**（验证脚本语义正确，非纯语法）：
   - 预置 `<a target="_blank">` 被剥掉 target
   - 动态 append `<a target="_blank">` 后被 observer 剥掉
   - 重复执行 `WEBVIEW_BLANKFIX_SOURCE`（幂等）不报错、observer 不叠加
   - **决策**：检查项目是否已有 jsdom 依赖，**没有就不引入**（YAGNI）。退而用更轻的
     `new Function(SOURCE)` 在沙箱里跑 + 手写最小 fake `document`/`window`。这一步实施时定。

### 不单测（靠真机验）

- `blankfixManager.sync()` —— CDP 长连接 + ws 生命周期，跨进程胶水（教训 12/13）
- `addScriptToEvaluateOnNewDocument` 在 webview 生效 —— 已真机验（§设计依据）
- 剥 `_blank` 后同窗口跳转 —— 已真机验（用户确认"跳过去了"）
- sync 的增/删/重连 —— 实施时新增真机验证步骤

### 真机验证清单（写进 spec，实施后执行）

1. 启 control-server + ZCode 带 9222
2. 在 webview 打开 `open.bigmodel.cn`（或任意有 `_blank` 的站）
3. 等 ≤3 秒，点"控制台"等 `_blank` 链接 → 应同窗口跳转
4. 跳到新页后，新页里的 `_blank` 链接也能同窗口跳转（验 `addScriptToEvaluateOnNewDocument` 跨导航生效）
5. 关闭该 webview 标签 → sync 应自动清理（看 control-server 日志不报错、无 ws 泄漏）
6. 重开 webview 标签 → ≤3 秒后自动重新生效
7. 重启 control-server → 现有 webview 重新注册（无状态丢失）

### 回归测试关注点

新增 `webview-blankfix.cjs` 后，确保现有测试仍绿。特别 `menutest`（菜单场景标注）和 `cdptest`
（filterTargets 一致性）不受影响。

---

## 9. 实现清单（给 writing-plans 用）

### 新增文件

| 文件 | 作用 | 测试 |
|------|------|------|
| `lib/webview-blankfix.cjs` | WEBVIEW_BLANKFIX_SOURCE 常量 + filterWebviewTargets 纯函数 + blankfixManager(sync/close) | 部分单测 + 真机验 |
| `test/webviewblankfixtest.cjs` | 纯函数 + SOURCE 常量 + fake DOM 测 | — |

### 探测脚本（已写，brainstorming 期间产物）

brainstorming 期间写了 5 个 CDP 探测脚本验证命门。**决策**：只保留有长期回归价值的，其余删（避免
scripts/ 堆积一次性脚本）。实施时按此处理：

| 脚本 | 是否留仓库 | 理由 |
|------|-----------|------|
| `scripts/inspect-newwindow.cjs` | ✅ 留 | 命门 1+2 探测（webview 属性 + 能否注 JS），可复用于"以后排查 webview 行为" |
| `scripts/test-addscript-newdoc.cjs` | ✅ 留 | 命门 3 探测（addScript 在 webview 是否生效），实施第一步要重跑确认 |
| `scripts/test-blank-rewrite.cjs` | ❌ 删 | 临时手测脚本（install + hold 5 分钟等用户点），一次性验证已完成 |
| `scripts/install-blank-fix.cjs` | ❌ 删 | 同上，install-blank-fix 的更完整版，但也是一次性 |
| `scripts/check-blank-hook.cjs` | ❌ 删 | 临时调试 hook 是否装上的小脚本，无长期价值 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `lib/control-server.cjs` | createServer 启动后 setInterval(sync, 3000) + close() 调 blankfix.close() |
| `control/index.html` | 条件渲染一行提示（status.zcode 不通时显示） |
| `package.json` | test 链加 `webviewblankfixtest` |
| `AGENTS.md` | 新增"webview `_blank` 修复"章节 + 教训补丁 28 |

### AGENTS.md 新章节要点（实施时写）

- 根因（webview 无 allowpopups）+ 为什么不用改 app.asar
- 三道关机制 + 两个命门已真机验
- 模块定位（写操作独立，复用 cdp.cjs 中性工具，对齐 video-mute.cjs）
- 已知遗留：不带 debug port 则失效（同所有 CDP 能力的前提）
- **教训补丁 28**（预估）：`addScriptToEvaluateOnNewDocument` 在 Electron webview target 上**生效**
  （已验）——这是不同于 page target 的发现，记录下来防以后重新踩

### 风险/未验点（实施时第一步验）

1. `Page.enable` → `addScriptToEvaluateOnNewDocument` 在 webview target 上的完整序列（探测只验了
   addScript 单步）——实施时跑一次完整 sync 流程确认
2. 同一 webview target 被多次 sync（幂等性）——靠 `__zzBlankFix` 标志挡，但要真机确认 observer 不叠加
3. ZCode 浏览器面板"新开标签"是否产生新 webview target（若是，sync 自动覆盖；若是同 target 导航，
   id 不变仍覆盖）——任一情况都 work，但要观察实际行为
