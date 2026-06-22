# 视频壁纸加声音（默认有声 + 实时切静音）

> spec — 2026-06-22
> 状态：待审

## 1. 背景与目标

视频壁纸当前**强制静音**（`lib/inject.cjs:141-144` 的 `muted` 属性 + `v.muted=true`）。这是
Chromium autoplay 策略的标准做法（muted 视频才能免"用户手势"自动播放），但用户的视频壁纸
**本来就有声**——"有画面没声音"浪费了视频一半的信息。

**目标**：视频壁纸默认有声，开会/录屏时能从控制中心实时切静音（不重建 video 元素、不闪屏）。

**不做（YAGNI）**：
- 不做音量旋钮（0-100）。有/无就够了，音量用系统音量调。
- 不做"按视频自动判断该不该有声"。默认有声是用户意图。
- 不做全局快捷键切静音。控制中心按钮足够。

## 2. 核心约束（决定方案空间）

### 2.1 Chromium autoplay 策略

**未 muted 的视频，没有"用户手势"（click/keydown）就会被浏览器拒绝自动播放**——`v.play()`
返回的 Promise reject，视频连画面都起不来。让 unmuted 视频能自动播有两条路：

- **路 A：启动 flag** — 给 ZCode 进程加 `--autoplay-policy=no-user-gesture-required`，
  Chromium 全局放宽 autoplay 限制。
- **路 B：借用户手势** — 注入时先 muted，等用户在页面 click/keydown 后再 unmute。

本设计走路 A（用户选了"默认有声"），并**强制要求带 fallback**（见 §4.2）。

> ⚠️ **假设必须真机验**（AGENTS.md 教训 21：CSS/浏览器行为别用"应该"推理）：
> Electron 是否真的吃 `--autoplay-policy` flag、ZCode 是否用自己的 `webPreferences`
> 覆盖 autoplay 策略——**不能靠常识判断**。实施第一步必须探测验证（见 §6 真机清单第 1 条）。
> 万一 flag 不生效，回退方案 B（用户手势路线）是单独的 spec，不在本设计内强行兜底。

### 2.2 CDP 写操作 vs 只读模块

AGENTS.md 明确写了 `lib/cdp.cjs` 是**"只读 CDP 共享模块"**（`filterTargets`/`listTargets`/
`connect`/`probeWallpaperMode`）。实时切静音是**写操作**（改 `video.muted` 属性），
**不能塞进 cdp.cjs** 破坏它的只读定位。

但 `cdp.connect` / `cdp.listTargets` 本身是中性工具（连接 + 列举，读写都行），新模块
**复用它们**而不是重写 CDP 胶水（AGENTS.md 教训 1：复用连接逻辑，不是复用"只读"语义）。

## 3. 架构总览

四个改动点，全部复用现有管道，不新造轮子：

```
launch-zcode.bat (Step 2 加 autoplay flag)     ← 默认有声的前提（改 1 处，三条启动链都带）
        │
        ▼
inject.cjs buildVideoExpression (去强制 muted，加 play().catch 回退)
        │                                     ← 只管"建"，不管"切"
        │
        ├─[读] cdp.cjs probeWallpaperMode (顺带返回 videoMuted)
        │                                     ← 状态查询零新增 CDP 往返
        │
        └─[写] lib/video-mute.cjs (新模块，实时改 video.muted)
                                              ← 复用 cdp.connect，不改 cdp 只读定位
        │
        ▼
control-server.cjs (muteVideo/unmuteVideo action，即时返回，不走 spawn/jobId)
        │
        ▼
control/ index.html + control.js (声音按钮，状态显示当前 muted)
```

**数据流（单一权威）**：`video.muted` 是 DOM 真实属性。所有"当前是否静音"的状态读取
都走 `cdp.cjs` 读 DOM，**不另设 server 内存变量**——避免"server 记的"和"DOM 实际的"
两份状态漂移（AGENTS.md 教训 1 的同型：两份状态 = 两份能各自坏的机会）。

## 4. 组件设计

### 4.1 `bin/launch-zcode.bat`：加 autoplay flag

**只改 Step 2 一行**（当前 `launch-zcode.bat:57`）。`ProcessStartInfo.Arguments` 从

```
--remote-debugging-port=%DEBUG_PORT%
```

改为

```
--remote-debugging-port=%DEBUG_PORT% --autoplay-policy=no-user-gesture-required
```

**为什么只改一处**：`start-zcode.bat` / `start-transparent.bat` / `start.bat` 都调
`launch-zcode.bat`，flag 加在这里三条链都带上——**根除重复**（AGENTS.md 教训 1 二次事故：
两份拷贝就是两份能各自再坏一次的机会）。

**不改的**：`bin/inject-only.bat` 不动（它不启动 ZCode，只注入；flag 是启动期的事）。
`bin/reader-server.bat` / `bin/control-center.bat` 不动（它们不启动 ZCode）。

### 4.2 `lib/inject.cjs`：视频注入去强制 muted + 自动降级

**当前 `buildVideoExpression`（`inject.cjs:123-152`）的关键行**：

```js
v.setAttribute('muted','');     // line 141
...
v.muted=true;                    // line 144
try{var p=v.play();if(p&&p.catch){p.catch(function(){});}}catch(e){}  // line 147
```

**改为**（伪代码，实施时精确对齐）：

```js
// 不再设 muted 属性、不设 v.muted=true。
// 先尝试 unmuted 播放；catch 失败（flag 没生效/无用户手势）回退 muted + 重播。
"try{var p=v.play();if(p&&p.catch){p.catch(function(){v.muted=true;v.play().catch(function(){});});}}catch(e){v.muted=true;try{v.play().catch(function(){});}catch(_){}}"
```

**关键点**：
- `v.play()` 的 reject 是**异步**的（返回 Promise），必须在 `.catch` 里回退，不能在 try/catch 同步路径里判断。
- 回退后**保证至少有画面**（muted 视频总能播）——这就是"自动降级 muted"（用户在 §"不带 flag 场景"选的）。
- **去掉 `inject.cjs` 的 `--mute`/`--unmute` 参数设计**——运行时切换是 `video-mute.cjs` 的事，inject.cjs 回归单一职责（只管初始注入）。

**MODE 路由不变**：`inject.cjs:243` 的 `MODE === "video" ? buildVideoExpression(...) : buildExpression(...)` 不动。

### 4.3 `lib/cdp.cjs`：probeWallpaperMode 顺带返回 videoMuted

**当前 `probeWallpaperMode`（`cdp.cjs:56-70`）** 的 DOM 查询表达式读 `{style, video, videoSrc, bg}`，
返回 `"image"|"video"|"none"`。

**改为**返回 `{ mode, videoMuted }`：
- DOM 查询表达式增加 `v?v.muted:null` 字段（同一句 `Runtime.evaluate`，零新增 CDP 往返）。
  dom 对象从 `{style, video, videoSrc, bg}` 变成 `{style, video, videoSrc, bg, videoMuted}`。
- `classifyWallpaperDom` 纯函数**输入不变**（仍接收完整 dom 对象），**返回类型变**：
  从裸字符串 `"image"|"video"|"none"` 改为对象 `{ mode, videoMuted }`：
  - `mode === "video"` 时 `videoMuted = dom.videoMuted`（DOM 读到的真实布尔）。
  - 其他 mode `videoMuted = null`（无视频，无意义）。
- `probeWallpaperMode` 返回 `{ mode, videoMuted }` 而非裸字符串。

**调用方影响**（全部已查清，3 处）：
1. `lib/status.cjs:59` `probeZcodeAndWallpaper`：`const m = await cdp.probeWallpaperMode(t); if (m !== "none")` → 改为 `const r = await cdp.probeWallpaperMode(t); if (r.mode !== "none")`，并把 `videoMuted` 透传到 `wallpaper` 快照字段。
2. `test/cdptest.cjs:33-38`：`classifyWallpaperDom` 断言从 `=== "video"` 改为 `.mode === "video"`，新增 `videoMuted` 字段断言。
3. `test/statustest.cjs`：snapshot 返回的 `wallpaper` 字段多了 `videoMuted`，无需改断言（现有断言不检查它，但确认不崩）。

**`status.cjs` wallpaper 快照字段**：当前是 `{ mode, injectedWindows, totalWindows, lastInjectAt }`，加 `videoMuted`（video 模式有值，其他 null）。

### 4.4 `lib/video-mute.cjs`（新模块）：实时切静音

**职责单一**：遍历 page targets，对有 `<video>` 壁纸元素的改 `muted` 属性。

**导出**：

```js
// 纯函数（可单测）：构造"改 muted 并返回受影响数量"的 evaluate 表达式。
// muted: true=静音, false=取消静音
function buildMuteExpression(videoElId, muted) {
  return "(function(){var v=document.getElementById(" + JSON.stringify(videoElId) +
    ");if(!v)return JSON.stringify({found:false});v.muted=" + (muted ? "true" : "false") +
    ";return JSON.stringify({found:true,muted:v.muted});})()";
}

// 副作用函数：遍历所有 page targets，对每个执行 buildMuteExpression。
// 返回 { affected: <改了几个 target>, total: <总共几个 page target>, lastMuted: <最后一个的 muted 值或 null> }
async function setVideoMuted(muted) {
  const cdp = require("./cdp.cjs");
  const targets = await cdp.listTargets();
  let affected = 0;
  let lastMuted = null;
  for (const t of targets) {
    const { ws, call } = await cdp.connect(t.webSocketDebuggerUrl);
    try {
      const r = await call("Runtime.evaluate", {
        expression: buildMuteExpression(VIDEO_EL_ID, muted),
        returnByValue: true,
      });
      const obj = JSON.parse(r.result.value);
      if (obj.found) { affected++; lastMuted = obj.muted; }
    } finally { try { ws.close(); } catch (e) {} }
  }
  return { affected, total: targets.length, lastMuted };
}

module.exports = { buildMuteExpression, setVideoMuted, VIDEO_EL_ID };
```

**VIDEO_EL_ID 常量来源**：mirror `inject.cjs` 的 `VIDEO_EL_ID = "zcode-user-wallpaper-video"`。
和 `cdp.cjs` 的 `PROBE_VIDEO_EL_ID` 同款做法（AGENTS.md 已记录："inject.cjs owns the canonical
names, cdp.cjs reads them via probe"——这里是第三处镜像，保持一致，单测钉死字面量）。

**为什么 affected/total 都返回**：让 server 响应能给前端反馈"改了 N 个窗口"。多窗口场景
（ZCode 开了多个 page target）下，用户能确认是不是所有窗口都切了。

**错误处理**：单个 target 的 connect/evaluate 失败不致命，跳过继续（对齐 `probeZcodeAndWallpaper`
的 per-target 容错模式，`status.cjs:60` 注释 "per-target fail, continue"）。整个 `listTargets`
失败（CDP 不通）抛错，由 server 的 action 处理转成 4xx 响应。

### 4.5 `lib/control-server.cjs`：muteVideo/unmuteVideo action

**不走 `buildSpawnArgs`**（那是耗时 spawn 用的，带 jobId + 全局锁）。这两个 action 是
**即时 CDP 调用**（几百 ms），直接 `await videoMute.setVideoMuted(...)` 返回结果。

**`handle` 函数 `/api/action` 分支（`control-server.cjs:216`）加一段**：

```js
if (req2.action === "muteVideo" || req2.action === "unmuteVideo") {
  const videoMute = require("./video-mute.cjs");
  try {
    const r = await videoMute.setVideoMuted(req2.action === "muteVideo");
    return sendJson(res, 200, { accepted: true, affected: r.affected, total: r.total, muted: r.lastMuted });
  } catch (e) {
    return sendJson(res, 200, { accepted: false, error: e.message });
    // 200 而非 500：对齐 status 的"探查失败不致命"哲学，前端靠 accepted 字段判断
  }
}
```

**放在 `buildSpawnArgs` 调用之前**（和 `stopRotate` 同级，都是不走 spawn 的特殊 action）。

**不加全局锁**：mute/unmute 是即时的，不会和 inject/transparent 冲突（inject 会重建 video
元素，重建后的新元素按 §4.2 默认 unmuted——如果用户之前 mute 了，inject 后会变回有声，
这是可接受的：inject 是"换视频"语义，重置声音状态合理）。

### 4.6 `control/index.html` + `control/control.js`：声音按钮

**index.html（`#actions` 面板，injectVideo 按钮附近）加**：

```html
<button data-action="muteVideo">🔇 静音</button>
<button data-action="unmuteVideo">🔊 取消静音</button>
```

**control.js 两处改**：

1. **`poll()` 里**（`control.js:17-23`）：根据 `st.wallpaper.videoMuted` 更新按钮可见性/disabled。
   - 非 video 模式（`videoMuted === null`）：两个按钮都 disabled。
   - video + 已静音（`videoMuted === true`）：🔇 disabled，🔊 enabled。
   - video + 未静音（`videoMuted === false`）：🔇 enabled，🔊 disabled。
   - 和现有 CDP 按钮同款 `disabled` 切换模式（`control.js:21-22`）。

2. **actions click 处理**（`control.js:40-61`）：muteVideo/unmuteVideo 走 `dispatchAction`，
   成功后 `setTimeout(poll, 300)` 立即刷新状态（对齐现有 action 的 `setTimeout(poll, 500)`）。

**status-view.js 改一行**（`status-view.js:14-18`）：video 模式的状态串加"有声/静音"标注：

```js
wHtml = esc(w.mode === "video" ? "视频壁纸" : "图片壁纸") +
  ' | 注入 ' + esc(w.injectedWindows) + '/' + esc(w.totalWindows) +
  (w.mode === "video" ? (w.videoMuted ? ' | 🔇 静音' : ' | 🔊 有声') : '');
```

## 5. 测试加固

### 5.1 单测（纯函数层）

**`test/selftest.cjs` Test 4b/4c 改**：
- Test 4b：去掉 `check("video: muted set", ...)` 断言（不再强制 muted）。
- Test 4c：新增断言"默认模式表达式**不含** `v.muted=true`"、"含 `play().catch` 回退"、
  "回退路径里有二次 `v.muted=true`"。
- fakeDom 的 `makeNode` 加 `muted` 属性 + `play()` 方法返回 thenable，让"试播成功"和
  "试播失败回退"两条路径都能在 fakeDom 里跑通（新增 Test 4e）。

**`test/videomutetest.cjs`（新）**：测 `buildMuteExpression(videoElId, true/false)`：
- 输出含 `v.muted=true`（mute）或 `v.muted=false`（unmute）。
- 输出含 video 元素 id。
- 输出是 IIFE（`(function(){...})()`）。
- 输入非布尔（truthy/falsy）按 JS 规则转（`muted ? "true" : "false"`）。

**`test/cdptest.cjs` 改**：
- `classifyWallpaperDom` 断言从 `=== "video"` 改为 `.mode === "video"`。
- 新增 `videoMuted` 字段断言：video 模式 + `dom.videoMuted === true` → `{mode:"video", videoMuted:true}`；
  image/none 模式 → `videoMuted: null`。

**`test/controlservertest.cjs` 加**：muteVideo/unmuteVideo action 在 CDP 不通时（测试环境
无 ZCode）返回 `{accepted:false, error:...}`（不崩、不 500）。加 mock video-mute 模块太重，
只验"action 被识别 + 不崩"。

### 5.2 真机验证清单（必须全过，AGENTS.md 教训 12/13/21）

> 跨进程胶水（Chromium autoplay flag ↔ Electron 透传 ↔ DOM play() Promise ↔ CDP 写 muted）
> 是单测的盲区，**必须真机端到端跑**。

1. **flag 生效验证**（教训 21，gate 后续所有）：
   - `start-zcode.bat` 启动（带 flag）+ 注入视频 → **有声音** ✓
   - 如果无声 → flag 没生效，**停下来**排查（Electron 是否透传、ZCode 是否覆盖），不要继续。
2. **自动降级**（无 flag 场景）：直接双击 ZCode（不走 launch-zcode）+ `inject-only.bat --video`
   → 无声但**画面在**（降级生效，`play().catch` 回退到 muted 重播）。
3. **实时切静音**：带 flag 场景下，控制中心点"🔇 静音" → **瞬间无声**（不闪屏、不重建视频）；
   点"🔊 取消静音" → **瞬间有声**。
4. **状态显示**：视频壁纸注入后状态条显示"视频壁纸 | 注入 1/1 | 🔊 有声"；点静音后 2 秒内
   （轮询周期）显示"🔇 静音"。
5. **非视频模式按钮禁用**：图片壁纸或未注入时，🔇/🔊 按钮都 disabled。
6. **flag 不破坏透明链路**：`start-transparent.bat` 启动（也走 launch-zcode，带 flag）→
   透明功能正常（flag 对透明无副作用，只是个 autoplay 策略开关）。
7. **inject 后声音重置**：用户 mute 了 → 点"注入视频壁纸"换一个 → 新视频默认有声（mute 状态不跨 inject 持久化，§4.5 设计决定）。

## 6. 已知遗留与边界

- **flag 没生效的根因排查不在本 spec 兜底**：如果 §5.2 第 1 条验不过，说明 ZCode 的 Electron
  版本不吃 `--autoplay-policy` flag 或被 `webPreferences` 覆盖。这时**本设计的"默认有声"
  目标无法达成**，需要回退到方案 B（用户手势路线，单独 spec）。**实施时第 1 条验不过就停下
  找用户商量，不要硬推**。
- **多窗口声音不一致**：多 page target 场景下，`setVideoMuted` 遍历改所有，但 CDP 调用是
  串行的，极端情况下几百 ms 内多窗口声音不同步。可接受（视频壁纸不是多窗口同步播放场景）。
- **inject 重置声音状态**：mute 后换视频会变回有声（§4.5）。用户若想"永久静音"需每次 inject
  后再点静音。不做"静音偏好持久化"（YAGNI，localStorage 那套是为书架/书签这种用户数据，
  声音偏好是临时状态）。
- **无 flag 场景下"取消静音"无效**：直接双击开的 ZCode（无 flag），unmuted 视频本来就播不了，
  点"取消静音"虽然把 `v.muted` 改成 false，但视频会卡住（play 被 reject）。**不专门处理**——
  用户用控制中心的前提是 ZCode 带 debug port 启动，而带 debug port 启动 = 走 launch-zcode.bat
  = 带 flag。这个边界和"调试端口未开就禁用 CDP 按钮"是同款前提，文档写清楚即可。

## 7. 文档同步

实施完成后更新：
- **README.md**「视频壁纸」章节：补"默认有声，控制中心可切静音"+ flag 说明。
- **README.md**「控制中心 能做什么」章节：补"声音 开/关按钮"。
- **README.md** 文件表：加 `lib/video-mute.cjs`。
- **AGENTS.md**「视频壁纸」章节：补"默认 unmuted + 自动降级 muted"机制 + flag 位置 +
  video-mute.cjs 的定位（复用 cdp.connect，不改 cdp 只读）。
- **AGENTS.md** 测试章节：加 videomutetest.cjs、selftest/cdptest/controlservertest 的更新点。
- **AGENTS.md** 改动惯例：无需新增（无新 .bat / .ps1，无新跨语言胶水）。
