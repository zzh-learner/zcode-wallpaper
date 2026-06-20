# 设计文档：壁纸轮播（图片 + 视频，定时随机切换）

**日期**：2026-06-20
**状态**：待评审
**目标**：在已注入壁纸的基础上，增加"每隔 N 分钟自动随机换一张图 / 换一个视频"的轮播能力。图片和视频是两个独立的轮播模式（互斥），都由控制中心启停。

---

## 1. 背景与动机

现有能力（`random-wallpaper-design.md`）只做**启动时随机选一张**：每次 `start-zcode.bat` 或 `inject-only.bat` 跑一次，随机选一张图/视频注入，之后固定不变。要换得手动重跑。

用户想要的是**运行时定时切换**——ZCode 一直开着，背景自动每隔几分钟换一张。这正是 `random-wallpaper-design.md §13` 当初**明确排除**的东西（"定时切换需要常驻进程或注入定时器逻辑，复杂度高几个数量级"）。现在需求来了，要把这个"排除项"补上。

约束（继承自现有架构，AGENTS.md 的核心原则）：
- 控制中心是「触发器 + 状态显示器」，**绝不重写任何子系统的动作逻辑**（教训 1）。
- 动作靠 spawn 现有命令（`inject.cjs`），不抄一份注入逻辑。
- CDP 改不了窗口透明度同理——这里也"不持有长连接"，每次切换都重新 spawn。

---

## 2. 范围

**包含：**
- 新增 `lib/rotate.cjs`：常驻轮播看门狗，定时 spawn `inject.cjs` 换图/换视频。
- `lib/status.cjs`：`snapshot()` 新增第 6 项 `rotate`（读状态文件）。
- `lib/control-server.cjs`：新增 3 个动作（`startRotateImage`/`startRotateVideo`/`stopRotate`）+ 记 child handle。
- `control/index.html` + `control/control.js` + `control/lib/status-view.js`：轮播控件区 + 状态显示。
- `lib/inject.cjs`：**不改**（复用它已有的 env var 旁路 `ZCODE_WP_CSS`/`ZCODE_WP_VIDEO`）。
- 新增 `test/rotatetest.cjs`；扩 `statustest.cjs`/`controlservertest.cjs`/`statusviewtest.cjs`。

**不包含（YAGNI）：**
- 混合图/视频轮播（图视频分两个独立模式，互斥，见 §3）。
- 跨进程"当前到第几张/还剩几秒"的实时推送（用文件状态 + 2s 轮询读，够用）。
- 菜单场景（轮播只走控制中心，符合"控制中心是统一入口"的设计）。
- 渐变过渡动画（CSS `background-image` 过渡对 `file://` 切换支持差；视频是重建元素无过渡；YAGNI）。
- 重启 ZCode 后自动恢复轮播（rotate 进程不随 ZCode 死；只要 rotate 还活着，下次 tick 会重连 CDP——不需要专门恢复逻辑）。

---

## 3. 核心架构决策

### 3.1 rotate spawn inject.cjs，不持有 CDP 长连接（**最关键**）

rotate.cjs 是个"定时器"：每隔 N 毫秒 `child_process.spawn` 一次现有的 `inject.cjs`，让 inject 去连 CDP、删旧 style/video、建新的。rotate 自己**不碰 CDP、不碰注入表达式、不碰 retry**。

**为什么这样**（直接呼应 AGENTS.md 教训 1 + 控制中心原则）：
- ✅ **零代码重复**：buildExpression/buildVideoExpression/connect/retry/verifyExpression 全在 inject.cjs，rotate 一行不抄。两份注入逻辑 = 两份能各自再坏一次的机会。
- ✅ **rotate.cjs 极简**：setInterval + spawn + 写状态文件，预计 < 150 行。
- ✅ **自愈**：每次切换都重新探测端口、重连 CDP，ZCode 重启 / 页面导航 / target 变了都不影响（inject 的 retry 循环已处理）。
- ⚠️ **代价**：每次切换起一个 node 进程 + 重新探测端口（~几百 ms）。但间隔是分钟级，开销可忽略。

**被否决的方案**（rotate 自己持有 CDP WebSocket 长连接）：切换更快（无进程启动），但要让 rotate 自己实现 connect + 重连 + 换图表达式 + 处理"页面导航后 target 变了"——等于抄一份 inject.cjs。不值。

### 3.2 控制"换成哪张"——复用 inject 的 env var 旁路（零侵入）

inject.cjs 已有两个旁路（见 `inject.cjs:157, 192`）：
- `ZCODE_WP_CSS`：图片模式，直接用指定 CSS 文件（跳过随机选图）。
- `ZCODE_WP_VIDEO`：视频模式，用指定单个视频文件（跳过随机选片）。

rotate 自己负责"排除上次选过的，从池子里挑一张新的"，然后通过这两个 env var 把选中的文件喂给 inject。**inject.cjs 不改一行**。

- **视频**：rotate `pickRandom(videos, exclude=lastVideo)` → 设 `ZCODE_WP_VIDEO=<绝对路径>` → `spawn inject.cjs --video`。
- **图片**：rotate `pickRandom(images, exclude=lastImage)` → 读 `wallpaper.css` + 追加 `body { background-image: url("<fileUrl>") }` → 写临时 css 到系统 temp 目录 → 设 `ZCODE_WP_CSS=<临时css路径>` → `spawn inject.cjs`。临时 css 在 rotate 退出时清理（`SIGINT`/`exit` 钩子）。

`listWallpapers`/`listVideos`/`pickRandom`/`toFileUrl`/`encodeFileUrl` 全部 `require('./inject.cjs')` 复用（inject.cjs 已导出这些纯函数）。

### 3.3 图片/视频分两个独立模式（互斥）

brainstorm 时确认：同一时刻 body 只能有一个背景，所以图轮播和视频轮播互斥。
- rotate 进程**一次只跑一个模式**（`--image` 或 `--video`）。
- 启动视频轮播时若图片轮播在跑，control-server 先停掉旧的再启新的（`startRotateVideo` 内部调 `stopRotate` 逻辑）。
- 反之亦然。控制中心 UI 用单选切换模式，避免同时开两个 rotate 进程。

### 3.4 视频用纯定时器，不监听页面事件

brainstorm 时确认：不监听 `<video>` 的 `ended` 事件（那需要 CDP 监听页面事件，复杂度 +）。视频轮播和图片轮播一样走纯定时器——间隔到了就重建 `<video>` 元素（inject 的 `buildVideoExpression` 已经是"删旧 video + 建新 video + play()"）。代价：可能把一个还没播完的视频切掉。可接受（视频壁纸是动态背景，不是"看完一部片"）。

---

## 4. `lib/rotate.cjs` 详细设计

### 4.1 命令行接口

```
node lib/rotate.cjs --image --interval <ms>      # 图片轮播
node lib/rotate.cjs --video --interval <ms>      # 视频轮播
```

- `--image` / `--video`：二选一，必填。
- `--interval <ms>`：可选，默认 图片 300000 (5min) / 视频 600000 (10min)。
- 项目根用 `__dirname/..` 推算（和 inject.cjs 一致）。

### 4.2 主流程

```
1. 解析参数（mode, intervalMs）。
2. 探测池子：
   - image: listWallpapers(<root>/wallpapers-thumb)
   - video: listVideos(ZCODE_WP_VIDEO_DIR || <root>/wallpapers-video)
     （注意：rotate **忽略继承的 `ZCODE_WP_VIDEO`** 单文件旁路——那是 inject 的"只播这一个"入口，
     轮播必须有池子。若 `ZCODE_WP_VIDEO_DIR` 没设且 `wallpapers-video/` 空 → 池子空 → exit 1。
     轮播模式下 rotate 自己负责选片，总是设 `ZCODE_WP_VIDEO=<选中文件>` 给 inject。）
   空 → 打印提示 + exit 1，不进入轮播。
3. 启动时清理上次残留的临时 css（系统 temp 里 `zcode-rotate-*.css`，防止上次崩溃没清干净）。
4. 写初始状态文件 .rotate.json（running:true, mode, intervalMs, pid, poolSize, nextSwitchAt）。
5. 立即触发一次切换（不等第一个 interval）——让用户马上看到效果。
6. setInterval(tick, intervalMs)：
   - tick(): pickRandom(pool, exclude=lastFile) → 准备 env → spawn inject.cjs → 等 exit → 更新 .rotate.json。
   - spawn 失败（ZCode 没开等）：记失败计数到状态文件，不退出（下个 tick 重试）。
7. SIGINT/SIGTERM/exit 钩子：清理临时 css + 写 running:false 到状态文件 + exit。
```

### 4.3 纯函数（可单测，导出）

```js
// 从池子里随机选一个，排除上次选的。池子 ≤1 时不排除（避免选空）。
function pickRandomExcluding(pool, lastFile) {
  if (!pool.length) return null;
  if (pool.length <= 1) return pool[0];
  var candidates = lastFile ? pool.filter(f => f !== lastFile) : pool;
  if (!candidates.length) candidates = pool; // lastFile 不在池子里（用户删了图）
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// 解析 --interval 参数，clamp 到合理范围 [10000, 86400000]（10s ~ 24h）。
// 非法值 → 返回默认。返回 { intervalMs, usedDefault }。
function parseInterval(raw, defaultMs) { ... }

// 读/写状态文件。读不到返回 { running: false }。
function readState(statePath) { ... }
function writeState(statePath, obj) { ... }

// 构造图片模式的临时 css 内容（wallpaper.css + 追加 background-image 规则）。
function buildImageCss(baseCss, fileUrl) { ... }
```

### 4.4 状态文件 `.rotate.json`（项目根，gitignore）

```json
{
  "running": true,
  "mode": "image",
  "intervalMs": 300000,
  "lastSwitchAt": 1718900000000,
  "nextSwitchAt": 1718900300000,
  "lastFile": "Chapter4_2_8K_34.jpg",
  "pid": 12345,
  "poolSize": 34,
  "consecutiveFailures": 0
}
```

rotate 每次切换/启停都原子写（写临时文件 + rename）。`.rotate.json` 加进 `.gitignore`（运行时产物，不进版本库）。

### 4.5 进程存活检测（配合 §6.2 status）

status 读 `.rotate.json` 拿到 `pid` 后，要确认进程还活着（control-server 重启会丢 child handle，但 `.rotate.json` 残留 `running:true`）。
- Node 跨平台探进程存活：`process.kill(pid, 0)`（发信号 0，不真杀，活着不抛错）。
- pid 死了 → status 返回 `{ running: false, stale: true }`（前端显示"轮播已停止（进程退出）"）。

---

## 5. `lib/status.cjs` 改动

### 5.1 新增 `probeRotate(root)`

读 `<root>/.rotate.json` + `process.kill(pid, 0)` 探活：

```js
async function probeRotate(root) {
  const state = readState(path.join(root, ".rotate.json")); // 从 rotate.cjs 复用
  if (!state || !state.running) return { running: false };
  // 进程存活检测
  let alive = false;
  try { process.kill(state.pid, 0); alive = true; } catch (e) {}
  if (!alive) return { running: false, stale: true };
  return {
    running: true,
    mode: state.mode,
    intervalMs: state.intervalMs,
    lastFile: state.lastFile,
    poolSize: state.poolSize,
    lastSwitchAt: state.lastSwitchAt,
    nextSwitchAt: state.nextSwitchAt,
    consecutiveFailures: state.consecutiveFailures,
  };
}
```

`readState` 从 rotate.cjs `require` 复用（共享纯函数，不抄）。

### 5.2 `mergeProbeResults` + `snapshot` 加 `rotate` 项

`mergeProbeResults` 的 key 列表加 `"rotate"`（探查失败 → null + probeErrors，不污染整体，和现有 5 项一致）。`snapshot()` 里 `parts.rotate = await probeRotate(root)`。

---

## 6. `lib/control-server.cjs` 改动

### 6.1 新增 child handle（内存）+ 动作分发

```js
let rotateChild = null; // 记当前轮播进程

function buildSpawnArgs(root, action, params) {
  // ... 现有 case ...
  switch (action) {
    case "startRotateImage": return [exec, [rotateCjs, "--image", "--interval", String((params && params.intervalMs) || 300000)], { cwd: root, detached: false }];
    case "startRotateVideo": return [exec, [rotateCjs, "--video", "--interval", String((params && params.intervalMs) || 600000)], { cwd: root, detached: false }];
    // 注意：stopRotate 不在 buildSpawnArgs 里——它在 /api/action handler
    // 里早于 buildSpawnArgs 拦截（见 §6.2），不会走到这里。
    // ...
  }
}
```

### 6.2 `/api/action` handler 改造（执行顺序关键）

现有 handler（control-server.cjs:183）顺序是：`buildSpawnArgs → 判 null → 全局锁 → spawn`。rotate 的三个动作要在这个流程里正确插队：

```js
// 在现有 const spawnArgs = buildSpawnArgs(...) 之前，先拦 rotate 动作：
if (req2.action === "stopRotate") {
  stopRotateNow();              // 见 §6.3
  return sendJson(res, 200, { accepted: true, note: rotateChild ? "stopped" : "not running" });
}
// startRotateImage/Video：互斥——先停旧的（若有），再走正常 spawn 路径
if (req2.action === "startRotateImage" || req2.action === "startRotateVideo") {
  if (rotateChild) stopRotateNow();   // §6.4 互斥
}
const spawnArgs = buildSpawnArgs(root, req2.action, req2);
if (!spawnArgs) return sendJson(res, 400, { error: "unknown action" });
if (activeJob) return sendJson(res, 409, { accepted: false, reason: "busy", activeJob });
// ... 正常 spawn，但 rotate 动作走 §6.5 的特殊收尾 ...
```

`stopRotateNow()` 是 server 内部辅助函数（kill child + 兜底 pid kill + 清状态），`startRotate*` 互斥和 `stopRotate` 动作都调它，**逻辑只有一份**（教训 1：不抄两份 kill 逻辑）。

### 6.3 `stopRotateNow()` 唯一的停止逻辑

```js
function stopRotateNow() {
  if (rotateChild) { try { rotateChild.kill(); } catch (e) {} rotateChild = null; return; }
  // server 重启丢了 handle，但 .rotate.json 还说在跑 → 用 pid kill 兜底
  const state = rotate.readState(path.join(root, ".rotate.json"));
  if (state && state.running && state.pid) {
    try { process.kill(state.pid); } catch (e) {}
    // rotate 的 exit 钩子会写 running:false；兜底也直接覆盖一次
    rotate.writeState(path.join(root, ".rotate.json"), Object.assign(state, { running: false }));
  }
}
```

`stopRotate` 动作（前端点"停止"）和 `startRotate*` 的互斥停旧，都调 `stopRotateNow()`——**唯一一份 kill 逻辑**。

### 6.4 互斥（已并入 §6.2）

`startRotateImage`/`startRotateVideo` 在 buildSpawnArgs 之前调 `stopRotateNow()`，保证同时只有一个背景模式。`rotateChild` 记当前进程；child `exit` 事件里 `rotateChild = null`。

### 6.5 rotate 动作的 job 收尾（不阻塞全局锁）

把 rotate 的 console 输出收进 job output（前端能从 `/api/job/:id` 看到启动日志），但**不阻塞**——rotate 是常驻进程不 exit，job 在 spawn 成功后立即置 `done` 并释放全局锁：

```js
const child = child_process.spawn(cmd, args, opts2);
if (req2.action === "startRotateImage" || req2.action === "startRotateVideo") {
  rotateChild = child;
  child.on("exit", () => { rotateChild = null; });
  jobs.set(jobId, { state: "done", output: "rotate started, pid=" + child.pid, finishedAt: Date.now() });
  activeJob = null; // 立即释放全局锁（常驻进程不该占着锁）
  return sendJson(res, 200, { jobId, accepted: true });
}
```

---

## 7. 前端 `control/` 改动

### 7.1 `index.html`：轮播控件区（在 actions panel 里加一块）

```html
<div class="rotate-section">
  <strong>壁纸轮播</strong>
  <label><input type="radio" name="rotate-mode" value="image" checked> 图片</label>
  <label><input type="radio" name="rotate-mode" value="video"> 视频</label>
  <label>间隔 <input id="rotate-interval" type="number" min="1" value="5"> 分钟</label>
  <button data-action="startRotate">开始轮播</button>
  <button data-action="stopRotate">停止轮播</button>
</div>
```

间隔用"分钟"（用户直觉），前端 `*60000` 转毫秒传给后端。

### 7.2 `control.js`：`startRotate` 组装 mode + interval

```js
// click handler 里：
if (action === "startRotate") {
  var mode = document.querySelector('input[name="rotate-mode"]:checked').value;
  var min = parseInt(document.getElementById("rotate-interval").value, 10) || 5;
  params = { intervalMs: min * 60000 };
  action = (mode === "video") ? "startRotateVideo" : "startRotateImage";
}
```

### 7.3 `status-view.js`：renderStatus 加第 6 行

```js
var rot = st.rotate;
var rotHtml;
if (!rot) rotHtml = '<span class="muted">—</span>';
else if (!rot.running) rotHtml = rot.stale ? '<span class="warn">轮播已停（进程退出）</span>' : '<span class="muted">未轮播</span>';
else {
  var next = rot.nextSwitchAt ? new Date(rot.nextSwitchAt).toLocaleTimeString() : '—';
  rotHtml = esc(rot.mode === 'video' ? '视频' : '图片') + ' 轮播 | 每 ' + esc(Math.round(rot.intervalMs/60000)) + 'min | 下次 ' + esc(next) + ' | 当前 ' + esc(rot.lastFile || '—');
}
return ... + '<div class="st">' + rotHtml + '</div>';
```

---

## 8. 边界情况与错误处理

| 情况 | 处理 |
|------|------|
| 池子空 | rotate 启动时检测 → 打印提示 + exit 1，写 `.rotate.json {running:false, reason:"empty pool"}` |
| 池子仅 1 项 | `pickRandomExcluding` 池子 ≤1 不排除 → 继续轮播（每次还是它），日志提示 |
| `lastFile` 已不在池子（用户删图） | `pickRandomExcluding` 回退到全池随机 |
| ZCode 没开 / debug port 断 | spawn inject.cjs 返回 rc=1 → rotate 记 `consecutiveFailures++` 到状态文件，不退出，下个 tick 重试 |
| ZCode 重启换 HWND/页面 | 不影响（每次重新连 CDP） |
| control-server 重启丢 child handle | `.rotate.json` 残留 `running:true` → status 的 `process.kill(pid,0)` 探活 → 死了显示 `stale:true`；用户点"停止"时 server 无 child 但 `.rotate.json` 还在 → `stopRotateNow()`（§6.3）走 pid kill 兜底 |
| 用户直接关了 rotate 的窗口（如有） | rotate.cjs 是 control-server spawn 的子进程，无独立窗口；control-server 关则 rotate 被杀（OS 级）。和 reader"关窗即停"一致的模型 |
| 临时 css 文件残留（rotate 崩溃） | 临时 css 在系统 temp，OS 会清；rotate 启动时也扫描清理上次残留（§4.2 步骤 3） |
| interval 太短（< 10s） | `parseInterval` clamp 到 10000ms（切换有进程启动开销，太短没意义） |

---

## 9. 测试策略

| 测试文件 | 改动 | 重点 |
|----------|------|------|
| **新增 `test/rotatetest.cjs`** | 全新 | `pickRandomExcluding`（空池/单元素/排除上次/lastFile 不在池）、`parseInterval`（非法/越界/默认）、`readState`/`writeState`（文件存在/不存在/坏 JSON）、`buildImageCss`（含 fileUrl） |
| `statustest.cjs` | 扩 | `probeRotate`（文件不存在→`{running:false}`、文件在+pid活→`{running:true,...}`、文件在+pid死→`{running:false,stale:true}`） |
| `controlservertest.cjs` | 扩 | `startRotateImage`/`startRotateVideo`/`stopRotate` 动作返回 jobId + 互斥（启视频前杀图片 child）、stopRotate 无 child 时兜底 |
| `statusviewtest.cjs` | 扩 | renderStatus 第 6 行（running/未运行/stale/none 四态） |
| `menutest.cjs` | 不动 | 轮播只走控制中心，不加菜单场景 |
| `selftest.cjs` | 不动 | inject.cjs 纯函数不变 |

**跨进程胶水**（教训 12/13）：rotate spawn inject.cjs 的链路、`.rotate.json` 读写、`process.kill(pid,0)` 探活——这些单测验不全，**必须真机端到端跑**：
1. `node lib/rotate.cjs --image --interval 10000`（10s 快测）→ 看 ZCode 每 10s 换图 + `.rotate.json` 更新。
2. Ctrl+C 停 rotate → `.rotate.json` 变 `running:false` + 临时 css 清理。
3. 控制中心点"开始轮播"→ 看 rotate 进程起来 + status 显示轮播中。
4. 点"停止"→ rotate 进程死 + status 显示未轮播。
5. kill control-server（模拟重启）→ `.rotate.json` 残留 → status 显示 `stale` → 点"停止"兜底 kill。

---

## 10. 文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `lib/rotate.cjs` | 新增 | 常驻轮播看门狗（spawn inject.cjs + 写 .rotate.json） |
| `lib/status.cjs` | 改 | 加 `probeRotate` + `rotate` 项进 snapshot |
| `lib/control-server.cjs` | 改 | 加 3 个 rotate 动作 + child handle + 互斥/兜底 kill |
| `control/index.html` | 改 | 加轮播控件区 |
| `control/control.js` | 改 | startRotate 组装 mode+interval |
| `control/lib/status-view.js` | 改 | renderStatus 第 6 行 rotate 状态 |
| `test/rotatetest.cjs` | 新增 | rotate 纯函数测试 |
| `test/statustest.cjs` | 改 | 加 probeRotate 测试 |
| `test/controlservertest.cjs` | 改 | 加 rotate 动作测试 |
| `test/statusviewtest.cjs` | 改 | 加 rotate 状态行测试 |
| `.gitignore` | 改 | 加 `.rotate.json` |
| `lib/inject.cjs` | **不改** | 复用现有 env var 旁路 |
| `AGENTS.md` | 改 | 加"壁纸轮播"章节 + 教训补丁 |

---

## 11. 设计决策记录

- **为何 rotate spawn inject.cjs 而非自己持有 CDP**：零代码重复（教训 1）+ 自愈（每次重连）+ rotate 极简。代价是每次切换几百 ms 进程开销，但分钟级间隔下可忽略。
- **为何复用 inject 的 env var 旁路（不改 inject.cjs）**：`ZCODE_WP_CSS`/`ZCODE_WP_VIDEO` 已经是"指定单文件"的入口，rotate 选好文件喂进去即可。改 inject.cjs 会扩大表面积，且旁路已经测过（selftest）。
- **为何图/视频分两个独立模式而非混合**：brainstorm 确认；body 同时只能一个背景；视频切换体验（重建元素、可能切掉未播完的）单独处理更可控。
- **为何视频用纯定时器不监听 ended**：监听页面事件需要 CDP Runtime 监听 + 跨进程回传，复杂度大；视频壁纸是动态背景不是"看片"，切掉可接受。
- **为何状态用文件而非 IPC/socket**：单向数据流（rotate 写、status 读），文件最简单；process 存活检测（`process.kill(pid,0)`）弥补"文件残留"问题。socket 要管连接生命周期，YAGNI。
- **为何 `.rotate.json` 放项目根而非 temp**：status 和 rotate 都用项目根定位（`__dirname/..`），放 temp 要多传路径。项目根 + gitignore 干净。
- **为何 rotate 是 control-server 的子进程（detached:false）而非独立窗口**：和 reader 的"独立可见窗口"不同——轮播不需要用户看输出，control-server 关则轮播停（OS 级 kill 子进程）是可接受且更干净的模型（不留孤儿进程）。
- **为何不加菜单场景**：轮播需要"启/停/调间隔"交互，菜单的"选编号跑一次"模型不匹配；控制中心面板是天然入口，符合 spec §"控制中心是统一入口"。
- **为何 interval clamp 到 [10s, 24h]**：10s 以下切换开销占比过高没意义；24h 以上基本等于不轮播。clamp 防误操作。
