# 壁纸轮播 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ZCode 运行时每隔 N 分钟自动随机换一张壁纸图 / 换一个视频，由控制中心启停。

**Architecture:** 新增常驻看门狗 `lib/rotate.cjs`：setInterval 定时器每隔 N ms spawn 一次现有 `inject.cjs`（不改 inject 一行，复用其 `ZCODE_WP_CSS`/`ZCODE_WP_VIDEO` env var 旁路）。rotate 把状态写到项目根 `.rotate.json`，`status.cjs` 读它 + `process.kill(pid,0)` 探活。控制中心 spawn rotate 进程（图/视频互斥），前端加轮播控件区 + status 第 6 行。

**Tech Stack:** Node.js（CommonJS，和现有 lib/*.cjs 一致），纯前端 JS（无构建），标准 `http`/`child_process`，单测用项目既有风格（无框架，`pass/fail` 计数 + `process.exit`）。

**关键约束（来自 AGENTS.md）：**
- 控制中心是「触发器 + 状态显示器」，**不重写动作逻辑**——rotate 必须复用 inject.cjs，不抄一份注入逻辑（教训 1）。
- 跨进程胶水（rotate↔inject、status 读 `.rotate.json` + 探活）单测验不全，**必须真机端到端跑**（教训 12/13）。
- 新增逻辑加测试（纯函数抽出来单测），风格对齐 `test/*.cjs` 现有写法。

**Spec:** `docs/superpowers/specs/2026-06-20-wallpaper-rotation-design.md`

---

## File Structure

| 文件 | 类型 | 职责 |
|------|------|------|
| `lib/rotate.cjs` | **新增** | 常驻轮播看门狗：解析参数 → 探池子 → 写 `.rotate.json` → setInterval spawn inject → 清理。导出纯函数（pickRandomExcluding/parseInterval/readState/writeState/buildImageCss/STATE_FILENAME）供测试。 |
| `lib/status.cjs` | 改 | 新增 `probeRotate(root)` + `rotate` 进 snapshot；`mergeProbeResults` 加 `"rotate"` key。 |
| `lib/control-server.cjs` | 改 | 加 `rotateChild` handle + `stopRotateNow()` + 3 个 rotate 动作分发；`buildSpawnArgs` 加 2 个 case。 |
| `control/index.html` | 改 | actions panel 加轮播控件区（模式单选 + 间隔输入 + 开始/停止按钮）。 |
| `control/control.js` | 改 | startRotate 组装 mode+interval 转 ms；poll 不需改（status-view 读 status.rotate）。 |
| `control/lib/status-view.js` | 改 | renderStatus 追加第 6 行 rotate 状态（4 态：running/未轮播/stale/none）。 |
| `test/rotatetest.cjs` | **新增** | rotate 纯函数测试。 |
| `test/statustest.cjs` | 改 | 加 probeRotate 三态测试。 |
| `test/controlservertest.cjs` | 改 | 加 3 个 rotate 动作 + 互斥 + stopRotate 兜底。 |
| `test/statusviewtest.cjs` | 改 | 加第 6 行 rotate 渲染。 |
| `package.json` | 改 | test 链加 `rotatetest`（放在 statustest 前）。 |
| `.gitignore` | 改 | 加 `.rotate.json`。 |
| `AGENTS.md` | 改 | 加"壁纸轮播"章节 + 教训补丁。 |

---

## Task 1: rotate.cjs 纯函数 — pickRandomExcluding + parseInterval

**Files:**
- Create: `lib/rotate.cjs`
- Test: `test/rotatetest.cjs`

- [ ] **Step 1: 写失败测试 `test/rotatetest.cjs`（先建文件骨架 + 前两个函数的测试）**

创建 `test/rotatetest.cjs`：

```js
// Test lib/rotate.cjs pure helpers (spec §9).
const rotate = require("../lib/rotate.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// === pickRandomExcluding (spec §4.3) ===
check("pick: empty pool -> null", rotate.pickRandomExcluding([], "x") === null);
check("pick: empty pool no last -> null", rotate.pickRandomExcluding([], null) === null);
check("pick: single-element pool returns that element (no exclusion)", rotate.pickRandomExcluding(["only.jpg"], "only.jpg") === "only.jpg");
check("pick: single-element pool no last -> that element", rotate.pickRandomExcluding(["only.jpg"], null) === "only.jpg");
check("pick: two-element pool excludes last", rotate.pickRandomExcluding(["a.jpg", "b.jpg"], "a.jpg") === "b.jpg");
check("pick: two-element pool excludes last (other)", rotate.pickRandomExcluding(["a.jpg", "b.jpg"], "b.jpg") === "a.jpg");
// lastFile not in pool (user deleted it) -> fall back to whole pool, must not return null
var r = rotate.pickRandomExcluding(["a.jpg", "b.jpg", "c.jpg"], "deleted.jpg");
check("pick: lastFile not in pool -> returns a pool member", ["a.jpg", "b.jpg", "c.jpg"].indexOf(r) !== -1);
// determinism: when only one candidate after exclusion, it's that one
check("pick: three-element pool excludes last -> one of the other two", (function () {
  var got = rotate.pickRandomExcluding(["a", "b", "c"], "b");
  return got === "a" || got === "c";
})());

// === parseInterval (spec §4.3: clamp [10000, 86400000], default fallback) ===
check("parse: valid 60000 -> 60000", rotate.parseInterval("60000", 300000) === 60000);
check("parse: valid number string -> number", rotate.parseInterval("120000", 300000) === 120000);
check("parse: undefined -> default", rotate.parseInterval(undefined, 300000) === 300000);
check("parse: empty string -> default", rotate.parseInterval("", 300000) === 300000);
check("parse: non-numeric -> default", rotate.parseInterval("abc", 300000) === 300000);
check("parse: below floor (5000) -> clamped to 10000", rotate.parseInterval("5000", 300000) === 10000);
check("parse: exactly floor (10000) -> 10000", rotate.parseInterval("10000", 300000) === 10000);
check("parse: above ceiling (99999999) -> clamped to 86400000", rotate.parseInterval("99999999", 300000) === 86400000);
check("parse: exactly ceiling (86400000) -> 86400000", rotate.parseInterval("86400000", 300000) === 86400000);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: 跑测试确认失败（模块/函数不存在）**

Run: `node test/rotatetest.cjs`
Expected: 报错 `Cannot find module '../lib/rotate.cjs'` 或 `rotate.pickRandomExcluding is not a function`，脚本非 0 退出。

- [ ] **Step 3: 写 `lib/rotate.cjs` 的这两个纯函数（先只放函数 + 文件头，main 留到 Task 4）**

创建 `lib/rotate.cjs`：

```js
// Wallpaper rotation watchdog (spec §4).
// Resides as a long-lived process spawned by control-server; every N ms it
// spawns inject.cjs once to swap the image/video. It owns NO CDP/注入 logic —
// it reuses inject.cjs's env-var bypass (ZCODE_WP_CSS / ZCODE_WP_VIDEO), per
// AGENTS.md 教训 1 (no duplicated action logic).
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const inject = require("./inject.cjs"); // reuse toFileUrl/listWallpapers/listVideos

const STATE_FILENAME = ".rotate.json";
const DEFAULT_IMAGE_INTERVAL_MS = 5 * 60 * 1000;   // 5 min (spec §6)
const DEFAULT_VIDEO_INTERVAL_MS = 10 * 60 * 1000;  // 10 min (spec §6)
const MIN_INTERVAL_MS = 10000;       // 10 s (spec §11: clamp)
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 h

// Pick a random item from pool, excluding lastFile. Pool <=1 -> no exclusion
// (avoid returning null when the pool genuinely has one item). If lastFile is
// not in pool (user deleted it), fall back to whole pool.
function pickRandomExcluding(pool, lastFile) {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  var candidates = lastFile ? pool.filter(function (f) { return f !== lastFile; }) : pool;
  if (candidates.length === 0) candidates = pool; // lastFile gone -> whole pool
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Parse --interval. Clamp to [MIN, MAX]. Invalid/empty -> default. Returns ms.
function parseInterval(raw, defaultMs) {
  var n = parseInt(raw, 10);
  if (isNaN(n)) return defaultMs;
  if (n < MIN_INTERVAL_MS) return MIN_INTERVAL_MS;
  if (n > MAX_INTERVAL_MS) return MAX_INTERVAL_MS;
  return n;
}

module.exports = {
  pickRandomExcluding,
  parseInterval,
  STATE_FILENAME,
  DEFAULT_IMAGE_INTERVAL_MS,
  DEFAULT_VIDEO_INTERVAL_MS,
  // readState/writeState/buildImageCss added in later tasks (Task 2/3).
  // main() runs only when this file is the entry (Task 4).
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/rotatetest.cjs`
Expected: `20 passed, 0 failed`（pick 10 + parse 10 = 20）。

- [ ] **Step 5: 提交**

```bash
git add lib/rotate.cjs test/rotatetest.cjs
git commit -m "feat(rotate): pickRandomExcluding + parseInterval 纯函数 + 测试"
```

---

## Task 2: rotate.cjs 纯函数 — readState / writeState

**Files:**
- Modify: `lib/rotate.cjs`
- Test: `test/rotatetest.cjs`

- [ ] **Step 1: 在 `test/rotatetest.cjs` 末尾的 `console.log` 之前追加状态读写测试**

在 `console.log("\n" + pass ...)` 那行之前插入（用 tmp 文件测，注意先 require fs/os/path 并清理）：

```js
// === readState / writeState (spec §4.4) ===
var fs = require("fs"), os = require("os"), path = require("path");
var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rotate-"));
var statePath = path.join(tmpDir, rotate.STATE_FILENAME);

// readState on missing file -> { running: false }
check("readState: missing file -> { running: false }", rotate.readState(statePath).running === false);

// writeState then readState round-trips
rotate.writeState(statePath, {
  running: true, mode: "image", intervalMs: 300000, lastSwitchAt: 1718,
  nextSwitchAt: 2000, lastFile: "a.jpg", pid: 123, poolSize: 5, consecutiveFailures: 0,
});
var rd = rotate.readState(statePath);
check("readState: round-trip running", rd.running === true);
check("readState: round-trip mode", rd.mode === "image");
check("readState: round-trip intervalMs", rd.intervalMs === 300000);
check("readState: round-trip lastFile", rd.lastFile === "a.jpg");
check("readState: round-trip pid", rd.pid === 123);
check("readState: round-trip poolSize", rd.poolSize === 5);

// writeState overwrites (not merges) — new values replace old
rotate.writeState(statePath, { running: false });
check("writeState: overwrites running", rotate.readState(statePath).running === false);
check("writeState: overwrite drops old fields (no mode)", rotate.readState(statePath).mode === undefined);

// readState on corrupt JSON -> { running: false } (no throw)
fs.writeFileSync(statePath, "{ not valid json");
check("readState: corrupt json -> { running: false } no throw", rotate.readState(statePath).running === false);

// readState on null/empty path -> { running: false } no throw
check("readState: null path -> { running: false }", rotate.readState(null).running === false);

// cleanup
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/rotatetest.cjs`
Expected: 新增的 readState/writeState 测试 FAIL（`rotate.readState is not a function`）。前面 Task 1 的测试仍 PASS。

- [ ] **Step 3: 在 `lib/rotate.cjs` 加 readState / writeState 实现**

在 `module.exports` 之前插入这两个函数：

```js
// Read .rotate.json. Missing/corrupt/unreadable -> { running: false } (no throw).
// rotate writes; status reads. Single-direction data flow (spec §3.4).
function readState(statePath) {
  if (!statePath) return { running: false };
  var raw;
  try { raw = fs.readFileSync(statePath, "utf8"); } catch (e) { return { running: false }; }
  try { return JSON.parse(raw); } catch (e) { return { running: false }; }
}

// Write state atomically (tmp file + rename, so status never reads a half-write).
function writeState(statePath, obj) {
  if (!statePath) return;
  var tmp = statePath + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
    fs.renameSync(tmp, statePath);
  } catch (e) {
    // best-effort; rotate can't do much if the fs is unwritable. Don't crash.
  }
}
```

在 `module.exports` 的对象里加 `readState, writeState`（在 `parseInterval` 后、注释前）：

```js
module.exports = {
  pickRandomExcluding,
  parseInterval,
  readState,
  writeState,
  STATE_FILENAME,
  DEFAULT_IMAGE_INTERVAL_MS,
  DEFAULT_VIDEO_INTERVAL_MS,
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/rotatetest.cjs`
Expected: 全 PASS（Task 1 的 20 + Task 2 的 11 = 31）。

- [ ] **Step 5: 提交**

```bash
git add lib/rotate.cjs test/rotatetest.cjs
git commit -m "feat(rotate): readState/writeState 原子状态文件读写 + 测试"
```

---

## Task 3: rotate.cjs 纯函数 — buildImageCss

**Files:**
- Modify: `lib/rotate.cjs`
- Test: `test/rotatetest.cjs`

- [ ] **Step 1: 在 `test/rotatetest.cjs` 末尾 `console.log` 之前追加 buildImageCss 测试**

```js
// === buildImageCss (spec §4.3: wallpaper.css + background-image rule) ===
var baseCss = "/* base */\nhtml, body { background: transparent; }";
var url = "file:///C:/path/with%20space/Chapter4_2_8K_34.jpg";
var built = rotate.buildImageCss(baseCss, url);
check("buildImageCss: contains base css", built.indexOf("background: transparent") !== -1);
check("buildImageCss: contains background-image rule", built.indexOf("background-image") !== -1);
check("buildImageCss: contains the file url", built.indexOf(url) !== -1);
check("buildImageCss: rule marked !important", built.indexOf("!important") !== -1);
// empty/missing url -> no background-image line (rotate should guard, but be defensive)
var built2 = rotate.buildImageCss(baseCss, "");
check("buildImageCss: empty url -> still has base, no background-image", built2.indexOf("background: transparent") !== -1 && built2.indexOf("background-image") === -1);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/rotatetest.cjs`
Expected: 新增 5 个 buildImageCss 测试 FAIL。

- [ ] **Step 3: 在 `lib/rotate.cjs` 加 buildImageCss（放在 writeState 之后）**

```js
// Build image-mode css: wallpaper.css base + a body background-image rule
// pointing at the chosen file. Mirrors inject.cjs main()'s image branch so the
// injected result is identical whether rotate picked the file or inject did.
function buildImageCss(baseCss, fileUrl) {
  if (!fileUrl) return baseCss;
  return baseCss +
    "\n/* 轮播选中的壁纸 */\n" +
    'body { background-image: url("' + fileUrl + '") !important; }\n';
}
```

在 `module.exports` 加 `buildImageCss`：

```js
module.exports = {
  pickRandomExcluding,
  parseInterval,
  readState,
  writeState,
  buildImageCss,
  STATE_FILENAME,
  DEFAULT_IMAGE_INTERVAL_MS,
  DEFAULT_VIDEO_INTERVAL_MS,
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/rotatetest.cjs`
Expected: 全 PASS（31 + 5 = 36）。

- [ ] **Step 5: 提交**

```bash
git add lib/rotate.cjs test/rotatetest.cjs
git commit -m "feat(rotate): buildImageCss 拼接 base css + background-image + 测试"
```

---

## Task 4: rotate.cjs main() — spawn inject 循环 + 状态文件 + 清理

**Files:**
- Modify: `lib/rotate.cjs`

> 注意：main() 涉及 `child_process.spawn` + 真实 fs，纯单测难覆盖。本任务**只实现 + 语法检查**，端到端真机验证放 Task 10。先确保 `require` 不报错、`--help` 能跑。

- [ ] **Step 1: 在 `lib/rotate.cjs` 加 main() + CLI 入口（放在 module.exports 之后）**

在文件末尾追加：

```js
// --- CLI (spec §4.1) ---
// node lib/rotate.cjs --image --interval <ms>
// node lib/rotate.cjs --video --interval <ms>
function parseArgs(argv) {
  var mode = null;
  var intervalRaw = null;
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === "--image") mode = "image";
    else if (a === "--video") mode = "video";
    else if (a === "--interval") intervalRaw = argv[i + 1];
  }
  return { mode: mode, intervalRaw: intervalRaw };
}

// Prepare one switch: pick a file, set env, spawn inject.cjs, return result.
// mode = "image" | "video"; pool = array of filenames; lastFile = previous pick.
// Returns { chosen, ok } where ok = inject exited 0.
function doOneSwitch(root, mode, pool, lastFile) {
  var chosen = pickRandomExcluding(pool, lastFile);
  if (!chosen) return { chosen: null, ok: false };
  var absPath, env, args;
  if (mode === "video") {
    absPath = path.join(poolDirFor(mode, root), chosen);
    env = Object.assign({}, process.env, { ZCODE_WP_VIDEO: absPath });
    args = [path.join(root, "lib", "inject.cjs"), "--video"];
  } else {
    // image: write temp css (wallpaper.css + chosen bg), point ZCODE_WP_CSS at it
    absPath = path.join(poolDirFor(mode, root), chosen);
    var fileUrl = inject.toFileUrl(absPath);
    var baseCss = fs.readFileSync(path.join(root, "lib", "wallpaper.css"), "utf8");
    var css = buildImageCss(baseCss, fileUrl);
    writeTempCss(css); // writes to a pid-keyed path; path tracked for cleanup
    env = Object.assign({}, process.env, { ZCODE_WP_CSS: tmpCssForCleanup });
    args = [path.join(root, "lib", "inject.cjs")];
  }
  var ok = runSpawnSync(process.execPath, args, { cwd: root, env: env });
  return { chosen: chosen, ok: ok };
}

// pool dir per mode. Video honors ZCODE_WP_VIDEO_DIR (spec §4.2). Image always
// wallpapers-thumb (inject's default pool).
function poolDirFor(mode, root) {
  if (mode === "video") return process.env.ZCODE_WP_VIDEO_DIR || path.join(root, "wallpapers-video");
  return path.join(root, "wallpapers-thumb");
}

// Write temp css to OS temp dir; remember path for cleanup. Returns the path.
var tmpCssForCleanup = null;
function writeTempCss(css) {
  var os = require("os");
  var p = path.join(os.tmpdir(), "zcode-rotate-" + process.pid + ".css");
  fs.writeFileSync(p, css, "utf8");
  tmpCssForCleanup = p;
  return p;
}
function cleanupTempCss() {
  // clean own pid's file + scan for stale zcode-rotate-*.css from a prior crash
  try {
    var os = require("os");
    var entries = fs.readdirSync(os.tmpdir()) || [];
    entries.forEach(function (n) {
      if (/^zcode-rotate-.*\.css$/.test(n)) {
        try { fs.unlinkSync(path.join(os.tmpdir(), n)); } catch (e) {}
      }
    });
  } catch (e) {}
  tmpCssForCleanup = null;
}

// Run spawn synchronously (we want exit code before next switch). Returns true
// if child exited 0 (inject reported success).
function runSpawnSync(cmd, args, opts) {
  // use spawnSync to keep main loop simple (interval is minutes; sync is fine)
  var child = require("child_process").spawnSync(cmd, args, Object.assign({ stdio: "pipe" }, opts));
  if (child.stdout) process.stdout.write(child.stdout.toString());
  if (child.stderr) process.stderr.write(child.stderr.toString());
  return child.status === 0;
}

function main() {
  var argv = parseArgs(process.argv.slice(2));
  if (argv.mode !== "image" && argv.mode !== "video") {
    console.error("[rotate] 必须指定 --image 或 --video");
    process.exit(2);
  }
  var root = path.join(__dirname, "..");
  var statePath = path.join(root, STATE_FILENAME);
  // stale temp cleanup from a prior crash (spec §8 边界)
  cleanupTempCss();

  var poolDir = poolDirFor(argv.mode, root);
  var pool = argv.mode === "video" ? inject.listVideos(poolDir) : inject.listWallpapers(poolDir);
  if (pool.length === 0) {
    console.error("[rotate] 池子为空: " + poolDir + "（轮播需要 ≥1 个文件）");
    writeState(statePath, { running: false, mode: argv.mode, reason: "empty pool", poolSize: 0, pid: process.pid });
    process.exit(1);
  }
  if (pool.length === 1) {
    console.log("[rotate] 池子仅 1 项 (" + pool[0] + ")，每次切换仍是它");
  }

  var intervalMs = parseInterval(argv.intervalRaw,
    argv.mode === "video" ? DEFAULT_VIDEO_INTERVAL_MS : DEFAULT_IMAGE_INTERVAL_MS);
  console.log("[rotate] 启动: 模式=" + argv.mode + " 间隔=" + intervalMs + "ms 池子=" + pool.length);

  var lastFile = null;
  var failures = 0;
  function writeRunningState(extra) {
    var now = Date.now();
    writeState(statePath, Object.assign({
      running: true,
      mode: argv.mode,
      intervalMs: intervalMs,
      lastSwitchAt: now,
      nextSwitchAt: now + intervalMs,
      lastFile: lastFile,
      pid: process.pid,
      poolSize: pool.length,
      consecutiveFailures: failures,
    }, extra || {}));
  }

  function tick() {
    var res = doOneSwitch(root, argv.mode, pool, lastFile);
    if (res.chosen) lastFile = res.chosen;
    if (res.ok) { failures = 0; console.log("[rotate] 切换 -> " + res.chosen); }
    else { failures++; console.error("[rotate] 切换失败 (consecutive=" + failures + ")"); }
    writeRunningState();
  }

  // initial switch immediately, then interval
  writeRunningState();
  tick();
  var timer = setInterval(tick, intervalMs);
  // keep node alive (setInterval already does, but be explicit for clarity)
  timer.unref = function () { /* keep ref'd — we WANT to stay alive */ };

  function shutdown(sig) {
    console.log("[rotate] 收到 " + sig + "，清理并退出");
    clearInterval(timer);
    cleanupTempCss();
    writeState(statePath, { running: false, mode: argv.mode, pid: process.pid });
    process.exit(0);
  }
  process.on("SIGINT", function () { shutdown("SIGINT"); });
  process.on("SIGTERM", function () { shutdown("SIGTERM"); });
}

if (require.main === module) {
  main();
}
```

- [ ] **Step 2: 语法检查（require 能加载，不报语法错）**

Run: `node -e "require('./lib/rotate.cjs'); console.log('loaded ok')"`
Expected: 打印 `loaded ok`，无异常。

- [ ] **Step 3: --help 行为（无 mode 参数 → exit 2）**

Run: `node lib/rotate.cjs`
Expected: 打印 `[rotate] 必须指定 --image 或 --video`，exit code 2。

确认 exit code：
Run: `node lib/rotate.cjs; echo exit=%errorlevel%`（cmd）或 `node lib/rotate.cjs; echo "exit=$?"`（bash）

- [ ] **Step 4: 纯函数测试仍全绿（确认 main 没污染导出）**

Run: `node test/rotatetest.cjs`
Expected: `36 passed, 0 failed`。

- [ ] **Step 5: 提交**

```bash
git add lib/rotate.cjs
git commit -m "feat(rotate): main() 定时 spawn inject 循环 + 状态/清理/信号处理"
```

---

## Task 5: status.cjs — probeRotate + snapshot 集成

**Files:**
- Modify: `lib/status.cjs:15-25, 27, 126-143`
- Test: `test/statustest.cjs`

- [ ] **Step 1: 在 `test/statustest.cjs` 末尾的 `console.log` 之前追加 probeRotate 测试**

在 `console.log("\n" + pass ...)` 之前插入：

```js
// === probeRotate (spec §5.1): three states ===
// (1) no .rotate.json -> { running: false }
const rotateRoot1 = fs.mkdtempSync(path.join(os.tmpdir(), "rot-"));
check("probeRotate: no state file -> running false", (await status.probeRotate(rotateRoot1)).running === false);
// (2) state file running:true + a pid that's NOT alive (we pick a huge pid) -> stale
fs.writeFileSync(path.join(rotateRoot1, ".rotate.json"), JSON.stringify({
  running: true, mode: "image", intervalMs: 300000, lastFile: "x.jpg",
  pid: 99999999, poolSize: 3, nextSwitchAt: Date.now() + 60000, lastSwitchAt: Date.now(),
}));
var st2 = await status.probeRotate(rotateRoot1);
check("probeRotate: dead pid -> running false", st2.running === false);
check("probeRotate: dead pid -> stale true", st2.stale === true);
// (3) state file running:true + pid = current process (alive) -> running true with fields
fs.writeFileSync(path.join(rotateRoot1, ".rotate.json"), JSON.stringify({
  running: true, mode: "video", intervalMs: 600000, lastFile: "v.mp4",
  pid: process.pid, poolSize: 2, nextSwitchAt: 9999, lastSwitchAt: 1111, consecutiveFailures: 0,
}));
var st3 = await status.probeRotate(rotateRoot1);
check("probeRotate: live pid -> running true", st3.running === true);
check("probeRotate: live pid -> mode video", st3.mode === "video");
check("probeRotate: live pid -> intervalMs 600000", st3.intervalMs === 600000);
check("probeRotate: live pid -> lastFile v.mp4", st3.lastFile === "v.mp4");
check("probeRotate: live pid -> poolSize 2", st3.poolSize === 2);
check("probeRotate: live pid -> NO stale flag", st3.stale === undefined);
try { fs.rmSync(rotateRoot1, { recursive: true, force: true }); } catch (e) {}
```

同时把最外层 `(async () => { ... })();` 已经存在（statustest 现有结构），确认 `await` 在 async 内。若现有 IIFE 包裹了 snapshot 测试，probeRotate 测试加在同一个 IIFE 内即可。

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/statustest.cjs`
Expected: 新增 probeRotate 测试 FAIL（`status.probeRotate is not a function`）。前面的测试仍 PASS。

- [ ] **Step 3: 改 `lib/status.cjs` — require rotate + 加 probeRotate + 扩 mergeProbeResults + snapshot**

3a. 在文件顶部 `const cdp = require("./cdp.cjs");` 后加：

```js
const rotate = require("./rotate.cjs"); // spec §5.1: readState shared, not duplicated
```

3b. 改 `mergeProbeResults`（第 17 行），把 `"rotate"` 加进 key 列表：

```js
  for (const k of ["zcode", "wallpaper", "transparent", "reader", "resources", "rotate"]) {
```

3c. 改 `module.exports`（第 27 行），加 `probeRotate`：

```js
module.exports = { alphaToOpacityPct, opacityPctToAlpha, mergeProbeResults, snapshot, probeResources, classifyTransparent, probeTransparent, probeRotate };
```

3d. 在 `probeTransparent` 函数之后、`snapshot` 之前，加 `probeRotate`：

```js
// ---- rotate probe (spec §5.1) ----
// Read <root>/.rotate.json + check pid alive (process.kill(pid,0)).
// Returns { running: false } when not running; { running: false, stale: true }
// when the file says running but the pid is dead (server restarted, child lost).
async function probeRotate(root) {
  const state = rotate.readState(path.join(root, rotate.STATE_FILENAME));
  if (!state || !state.running) return { running: false };
  let alive = false;
  if (state.pid) { try { process.kill(state.pid, 0); alive = true; } catch (e) { alive = false; } }
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

3e. 在 `snapshot()` 的 `parts.reader = ...` 之后、`return mergeProbeResults(parts)` 之前加：

```js
  // rotate (file-based state; null if probe throws — shouldn't, but be safe)
  try { parts.rotate = await probeRotate(root); }
  catch (e) { parts.rotate = null; parts.rotateError = e.message; }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/statustest.cjs`
Expected: 全 PASS（原有 + 11 个新增 probeRotate）。

- [ ] **Step 5: 确认 snapshot 集成（含 rotate 项）**

Run: `node -e "const s=require('./lib/status.cjs'); s.snapshot({root:require('path').join(__dirname)}).then(x=>{console.log('rotate key present:', 'rotate' in x); console.log('rotate value:', JSON.stringify(x.rotate));})"`
Expected: 打印 `rotate key present: true`，值 `{ running: false }`（项目根没有 .rotate.json，或只有 stale 的）。

- [ ] **Step 6: 提交**

```bash
git add lib/status.cjs test/statustest.cjs
git commit -m "feat(status): probeRotate 读 .rotate.json + pid 探活, snapshot 加 rotate 项"
```

---

## Task 6: control-server.cjs — rotate 动作分发 + child handle + stopRotateNow

**Files:**
- Modify: `lib/control-server.cjs:71-86, 176-211`

- [ ] **Step 1: 在 `buildSpawnArgs`（第 71 行）加两个 rotate case**

把现有 switch（第 75-85 行）改为（在 `case "setup"` 之前插入两个 rotate case）：

```js
  switch (action) {
    case "injectImage":    return [exec, [injectCjs], { cwd: root }];
    case "injectVideo":    return [exec, [injectCjs, "--video"], { cwd: root }];
    case "remove":         return [exec, [injectCjs, "--remove"], { cwd: root }];
    case "startRotateImage": return [exec, [path.join(root, "lib", "rotate.cjs"), "--image",
      "--interval", String((params && params.intervalMs) || 300000)], { cwd: root }];
    case "startRotateVideo": return [exec, [path.join(root, "lib", "rotate.cjs"), "--video",
      "--interval", String((params && params.intervalMs) || 600000)], { cwd: root }];
    case "setTransparent": return ["powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tps, "-Opacity", String((params && params.opacityPct) || 78), "-Json"],
      { cwd: root }];
    case "resize":         return [exec, [path.join(root, "lib", "resize.cjs")], { cwd: root }];
    case "setup":          return [exec, [path.join(root, "lib", "setup.cjs")], { cwd: root }];
    default:               return null;
  }
```

（`stopRotate` 故意不进 switch —— 它在 action handler 里早拦截，不 spawn。spec §6.2。）

- [ ] **Step 2: 在 `createServer` 顶部状态变量区（第 100-102 行附近）加 rotateChild + require rotate**

在 `let transparentHwnd = null;` 之后加：

```js
    let rotateChild = null; // rotate watchdog child handle (spec §6.1)
    const rotate = require("./rotate.cjs"); // readState/writeState for stopRotateNow fallback
    const rotateStatePath = path.join(root, rotate.STATE_FILENAME);
```

- [ ] **Step 3: 加 `stopRotateNow()` 辅助函数（唯一一份 kill 逻辑，spec §6.3）**

在第 102 行（刚加的 rotateStatePath 之后）、`const server = http.createServer(...)` 之前插入：

```js
    // Stop rotate watchdog. Used by both the stopRotate action and the
    // startRotate* mutual-exclusion guard (single source of kill logic, spec §6.3).
    // 1) if we have the child handle, kill it.
    // 2) else (server restarted, handle lost) but .rotate.json says running +
    //    pid alive -> kill by pid (fallback, spec §8 边界).
    function stopRotateNow() {
      if (rotateChild) {
        try { rotateChild.kill(); } catch (e) {}
        rotateChild = null;
        return;
      }
      const st = rotate.readState(rotateStatePath);
      if (st && st.running && st.pid) {
        try { process.kill(st.pid); } catch (e) {}
        // rotate's own exit hook writes running:false; also overwrite to be safe
        rotate.writeState(rotateStatePath, Object.assign(st, { running: false }));
      }
    }
```

- [ ] **Step 4: 改 `/api/action` handler（第 177-211 行）插入 rotate 分发**

在 `const spawnArgs = buildSpawnArgs(root, req2.action, req2);`（第 183 行）**之前**插入 rotate 拦截：

```js
          // stopRotate: kill child (or pid fallback), no spawn (spec §6.2)
          if (req2.action === "stopRotate") {
            stopRotateNow();
            return sendJson(res, 200, { accepted: true });
          }
          // startRotate*: mutual exclusion — stop any running rotate first
          if (req2.action === "startRotateImage" || req2.action === "startRotateVideo") {
            stopRotateNow();
          }
          const spawnArgs = buildSpawnArgs(root, req2.action, req2);
```

- [ ] **Step 5: 改 spawn 后的收尾（第 189-208 行），rotate 动作记 child + 不阻塞全局锁**

把现有 spawn 收尾：

```js
          const [cmd, args, opts2] = spawnArgs;
          const child = child_process.spawn(cmd, args, opts2);
          let out = "";
          child.stdout.on("data", (c) => (out += c));
          child.stderr.on("data", (c) => (out += c));
          const timeout = setTimeout(() => { try { child.kill(); } catch (e) {} }, 30000);
          child.on("exit", (code) => {
            clearTimeout(timeout);
            // parse setTransparent -Json hwnd line (spec §10 链路建立)
            if (req2.action === "setTransparent") {
              const lines = out.split(/\r?\n/).filter((l) => l.trim().indexOf("{") === 0);
              for (const l of lines) {
                try { const o = JSON.parse(l); if (o.event === "set" && o.hwnd) { transparentHwnd = o.hwnd; break; } }
                catch (e) {}
              }
            }
            jobs.set(jobId, { state: code === 0 ? "done" : "failed", exitCode: code, output: out.slice(-2000), finishedAt: Date.now() });
            activeJob = null;
          });
          return sendJson(res, 200, { jobId, accepted: true });
```

改为（rotate 是常驻进程，立即置 done + 释放锁 + 记 child）：

```js
          const [cmd, args, opts2] = spawnArgs;
          const child = child_process.spawn(cmd, args, opts2);
          // rotate is a long-lived process: remember handle, mark job done
          // immediately, and DON'T hold the global lock (spec §6.5)
          if (req2.action === "startRotateImage" || req2.action === "startRotateVideo") {
            rotateChild = child;
            child.on("exit", () => { rotateChild = null; });
            let out = "";
            child.stdout.on("data", (c) => (out += c));
            child.stderr.on("data", (c) => (out += c));
            jobs.set(jobId, { state: "done", output: "rotate started, pid=" + child.pid + "\n" + out.slice(0, 200), finishedAt: Date.now() });
            activeJob = null;
            return sendJson(res, 200, { jobId, accepted: true });
          }
          let out = "";
          child.stdout.on("data", (c) => (out += c));
          child.stderr.on("data", (c) => (out += c));
          const timeout = setTimeout(() => { try { child.kill(); } catch (e) {} }, 30000);
          child.on("exit", (code) => {
            clearTimeout(timeout);
            if (req2.action === "setTransparent") {
              const lines = out.split(/\r?\n/).filter((l) => l.trim().indexOf("{") === 0);
              for (const l of lines) {
                try { const o = JSON.parse(l); if (o.event === "set" && o.hwnd) { transparentHwnd = o.hwnd; break; } }
                catch (e) {}
              }
            }
            jobs.set(jobId, { state: code === 0 ? "done" : "failed", exitCode: code, output: out.slice(-2000), finishedAt: Date.now() });
            activeJob = null;
          });
          return sendJson(res, 200, { jobId, accepted: true });
```

- [ ] **Step 6: server close 时清理 rotate child（防孤儿进程）**

`createServer` 在第 111-114 行 resolve 一个对象，其 `close` 方法（第 113 行）是内联箭头函数 `close: () => server.close()`。改为先杀 rotate child 再关 server：

把第 111-114 行：

```js
      server.listen(port, host, () => resolve({
        server, port: server.address().port, host, library,
        close: () => server.close(),
      }));
```

改为：

```js
      server.listen(port, host, () => resolve({
        server, port: server.address().port, host, library,
        close: () => {
          if (rotateChild) { try { rotateChild.kill(); } catch (e) {} rotateChild = null; }
          server.close();
        },
      }));
```

- [ ] **Step 7: 语法检查**

Run: `node -e "require('./lib/control-server.cjs'); console.log('loaded ok')"`
Expected: `loaded ok`。

- [ ] **Step 8: 提交**

```bash
git add lib/control-server.cjs
git commit -m "feat(control): rotate 动作分发 + child handle + stopRotateNow 单一 kill 逻辑"
```

---

## Task 7: controlservertest — rotate 动作测试

**Files:**
- Modify: `test/controlservertest.cjs`

- [ ] **Step 1: 在 `test/controlservertest.cjs` 的 try 块末尾（`} finally { srv.close(); }` 之前）追加 rotate 动作测试**

在 `// reader still served (兼容)` 那组 check 之后插入：

```js
    // === rotate actions (spec §6) ===
    // unknown action still 400 (baseline)
    // stopRotate with nothing running -> 200 accepted
    const stop1 = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "stopRotate" }));
    check("stopRotate (nothing running) -> 200", stop1.status === 200);
    check("stopRotate -> accepted true", JSON.parse(stop1.body).accepted === true);
    // startRotateImage with a tiny interval -> 200 + jobId (rotates wallpapers-thumb which is empty here, so rotate child will exit 1, but action dispatch still accepted)
    const start1 = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "startRotateImage", intervalMs: 60000 }));
    check("startRotateImage -> 200", start1.status === 200);
    check("startRotateImage -> jobId present", typeof JSON.parse(start1.body).jobId === "string");
    // give child a moment to start + exit (empty pool)
    await new Promise(r => setTimeout(r, 300));
    // stopRotate cleans up (child already dead from empty pool, but no error)
    const stop2 = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "stopRotate" }));
    check("stopRotate after start -> 200", stop2.status === 200);
    // bad interval (NaN string) -> still accepted, server uses default (doesn't crash)
    const start2 = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "startRotateVideo", intervalMs: "notanumber" }));
    check("startRotateVideo bad interval -> 200 (default used)", start2.status === 200);
    await new Promise(r => setTimeout(r, 300));
    const stop3 = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "stopRotate" }));
    check("stopRotate after video start -> 200", stop3.status === 200);
    // cleanup any .rotate.json the test wrote into tmp root
    try { require("fs").unlinkSync(path.join(root, ".rotate.json")); } catch (e) {}
```

- [ ] **Step 2: 跑测试确认通过**

Run: `node test/controlservertest.cjs`
Expected: 全 PASS（原有 + 8 个新增 rotate）。

> 注意：测试用空的 wallpapers-thumb/wallpapers-video（tmp root），rotate 子进程会因池子空 exit 1，但**动作分发本身**应该 200 accepted + jobId。这正是测的边界（spec §8 第一行）。若 startRotateImage 返回非 200，说明 spawn 路径有 bug，要查 Task 6。

- [ ] **Step 3: 提交**

```bash
git add test/controlservertest.cjs
git commit -m "test(control): rotate 动作 (start/stop/互斥/坏 interval) 不崩"
```

---

## Task 8: 前端 — index.html 轮播控件区

**Files:**
- Modify: `control/index.html:16-19`

- [ ] **Step 1: 在 `control/index.html` 的 actions panel 里，`<button data-action="setup">` 之后、`<button id="open-reader">` 之前插入轮播控件区**

把现有：

```html
    <button data-action="resize">重新缩图</button>
    <button data-action="setup">重装依赖</button>
    <button id="open-reader">打开阅读器</button>
```

改为：

```html
    <button data-action="resize">重新缩图</button>
    <button data-action="setup">重装依赖</button>
    <fieldset class="rotate-section">
      <legend>壁纸轮播</legend>
      <label><input type="radio" name="rotate-mode" value="image" checked> 图片</label>
      <label><input type="radio" name="rotate-mode" value="video"> 视频</label>
      <label>间隔 <input id="rotate-interval" type="number" min="1" value="5"> 分钟</label>
      <button data-action="startRotate">开始轮播</button>
      <button data-action="stopRotate">停止轮播</button>
    </fieldset>
    <button id="open-reader">打开阅读器</button>
```

- [ ] **Step 2: 提交**

```bash
git add control/index.html
git commit -m "feat(control-ui): actions panel 加壁纸轮播控件区 (模式/间隔/启停)"
```

---

## Task 9: 前端 — control.js startRotate 分发 + status-view 第 6 行

**Files:**
- Modify: `control/control.js:39-50`
- Modify: `control/lib/status-view.js:8-34`
- Test: `test/statusviewtest.cjs`

- [ ] **Step 1: 改 `control/control.js` 的 click handler，把 startRotate 翻译成 startRotateImage/Video + ms**

把现有（第 39-50 行）：

```js
  document.getElementById("actions").addEventListener("click", function (e) {
    var action = e.target.getAttribute && e.target.getAttribute("data-action");
    if (!action) return;
    var params = action === "setTransparent"
      ? { opacityPct: parseInt(document.getElementById("opacity").value, 10) }
      : {};
    dispatchAction(action, params).then(function (res) {
      if (res.status === 409) setJobMsg("忙，请等当前动作完成");
      else if (!res.json.accepted) setJobMsg("拒绝: " + (res.json.error || ""));
      else { setJobMsg("已提交 (" + res.json.jobId + ")"); setTimeout(poll, 500); }
    }).catch(function (err) { setJobMsg("错误: " + err.message); });
  });
```

改为（startRotate 组装 mode+interval；其它不变）：

```js
  document.getElementById("actions").addEventListener("click", function (e) {
    var action = e.target.getAttribute && e.target.getAttribute("data-action");
    if (!action) return;
    var params, finalAction = action;
    if (action === "setTransparent") {
      params = { opacityPct: parseInt(document.getElementById("opacity").value, 10) };
    } else if (action === "startRotate") {
      var modeEl = document.querySelector('input[name="rotate-mode"]:checked');
      var mode = modeEl ? modeEl.value : "image";
      var min = parseInt(document.getElementById("rotate-interval").value, 10);
      if (isNaN(min) || min < 1) min = 5;
      params = { intervalMs: min * 60000 };
      finalAction = (mode === "video") ? "startRotateVideo" : "startRotateImage";
    } else {
      params = {};
    }
    dispatchAction(finalAction, params).then(function (res) {
      if (res.status === 409) setJobMsg("忙，请等当前动作完成");
      else if (!res.json.accepted) setJobMsg("拒绝: " + (res.json.error || ""));
      else { setJobMsg("已提交 (" + res.json.jobId + ")"); setTimeout(poll, 500); }
    }).catch(function (err) { setJobMsg("错误: " + err.message); });
  });
```

- [ ] **Step 2: 改 `control/lib/status-view.js` renderStatus 加第 6 行（rotate 状态）**

把现有（第 8-34 行的 renderStatus 函数体），在 `var resHtml = ...` 那段之后、`return ...` 之前插入 rotate 行计算：

```js
  var rot = st.rotate;
  var rotHtml;
  if (!rot) rotHtml = '<span class="muted">—</span>';
  else if (!rot.running) rotHtml = rot.stale ? '<span class="warn">轮播已停（进程退出）</span>' : '<span class="muted">未轮播</span>';
  else {
    var nextStr = rot.nextSwitchAt ? new Date(rot.nextSwitchAt).toLocaleTimeString() : '—';
    rotHtml = esc(rot.mode === 'video' ? '视频' : '图片') + ' 轮播 | 每 ' + esc(Math.round(rot.intervalMs / 60000)) + 'min | 下次 ' + esc(nextStr) + ' | 当前 ' + esc(rot.lastFile || '—');
  }
```

然后把 return 语句（第 29-33 行）追加第 6 个 `<div class="st">`：

```js
  return '<div class="st">' + zHtml + '</div>' +
    '<div class="st">' + wHtml + '</div>' +
    '<div class="st">' + tHtml + '</div>' +
    '<div class="st">' + rHtml + '</div>' +
    '<div class="st">' + resHtml + '</div>' +
    '<div class="st">' + rotHtml + '</div>';
```

- [ ] **Step 3: 在 `test/statusviewtest.cjs` 末尾 `console.log` 之前追加 rotate 渲染测试**

```js
// === rotate row (spec §7.3) ===
const rotRunning = sv.renderStatus({
  zcode: { running: true }, wallpaper: { mode: "none" }, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  rotate: { running: true, mode: "image", intervalMs: 300000, lastFile: "Chapter4.jpg", nextSwitchAt: 1718900000000 },
  _meta: { probeErrors: [] },
});
check("render rotate running shows 轮播", rotRunning.indexOf("轮播") !== -1);
check("render rotate running shows interval 5min", rotRunning.indexOf("5min") !== -1);
check("render rotate running shows mode 图片", rotRunning.indexOf("图片") !== -1);
check("render rotate running shows lastFile", rotRunning.indexOf("Chapter4.jpg") !== -1);

const rotVideo = sv.renderStatus({
  zcode: null, wallpaper: null, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  rotate: { running: true, mode: "video", intervalMs: 600000, lastFile: "v.mp4", nextSwitchAt: 0 },
  _meta: { probeErrors: [] },
});
check("render rotate video mode shows 视频", rotVideo.indexOf("视频") !== -1);
check("render rotate video shows 10min", rotVideo.indexOf("10min") !== -1);

const rotOff = sv.renderStatus({
  zcode: null, wallpaper: null, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  rotate: { running: false },
  _meta: { probeErrors: [] },
});
check("render rotate off shows 未轮播", rotOff.indexOf("未轮播") !== -1);

const rotStale = sv.renderStatus({
  zcode: null, wallpaper: null, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  rotate: { running: false, stale: true },
  _meta: { probeErrors: [] },
});
check("render rotate stale shows 进程退出", rotStale.indexOf("进程退出") !== -1);

const rotNull = sv.renderStatus({
  zcode: null, wallpaper: null, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  rotate: null,
  _meta: { probeErrors: [{ item: "rotate" }] },
});
check("render rotate null shows placeholder", rotNull.indexOf("—") !== -1);
```

注意：现有 statusviewtest 的 html1/html2/html3 没传 `rotate` 字段，renderStatus 新代码里 `st.rotate` 会是 undefined → `!rot` 分支 → 显示 `—`，不崩。但为了让既有断言明确，把 html1/html2/html3 各补一个 `rotate: { running: false }` 字段（或保持不传也行，因为 `!undefined` 走 `—` 分支）。**保持不传**，验证"缺字段不崩"也是好测试。

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/statusviewtest.cjs`
Expected: 全 PASS（原有 + 10 个新增 rotate）。

- [ ] **Step 5: 提交**

```bash
git add control/control.js control/lib/status-view.js test/statusviewtest.cjs
git commit -m "feat(control-ui): startRotate 分发 mode+interval + status 第6行 rotate 渲染"
```

---

## Task 10: package.json + .gitignore + 全测试链

**Files:**
- Modify: `package.json:22`
- Modify: `.gitignore`

- [ ] **Step 1: 把 `rotatetest` 加进 `package.json` 的 test 链**

把第 22 行 test 字符串里 `node test/statustest.cjs` 之前插入 `node test/rotatetest.cjs && `：

```json
    "test": "node test/selftest.cjs && node test/cdp-mock-test.cjs && node test/cdp-retry-test.cjs && node test/cdptest.cjs && node test/setuptest.cjs && node test/resizetest.cjs && node test/probetest.cjs && node test/menutest.cjs && node test/transparenttest.cjs && node test/readertoctest.cjs && node test/readercodetest.cjs && node test/readercodetestweb.cjs && node test/readertocwebtest.cjs && node test/readerprogresstest.cjs && node test/readerservertest.cjs && node test/bookroutertest.cjs && node test/rotatetest.cjs && node test/statustest.cjs && node test/controlservertest.cjs && node test/statusviewtest.cjs && node test/shelftest.cjs"
```

- [ ] **Step 2: `.gitignore` 加 `.rotate.json`**

在文件末尾（`!novels/.gitkeep` 之后）追加：

```
# Wallpaper rotation runtime state (written by lib/rotate.cjs, read by status).
# Never commit — it's machine-local runtime data.
.rotate.json
.rotate.json.tmp
```

- [ ] **Step 3: 跑全测试链**

Run: `npm test`
Expected: 全绿，所有测试文件 PASS。若某个 FAIL，先单独跑那个文件定位。

- [ ] **Step 4: 提交**

```bash
git add package.json .gitignore
git commit -m "chore: rotatetest 进测试链 + .rotate.json 进 gitignore"
```

---

## Task 11: 真机端到端验证（无自动化测试，按清单人工跑）

**Files:** 无（验证步骤）

> AGENTS.md 教训 12/13：跨进程胶水（rotate↔inject、status 读状态 + 探活）单测验不全，必须真机跑。**这一步不能跳。** 每条跑完记录实际现象，失败就回对应 Task 修。

- [ ] **Step 1: 确认 ZCode 已用 start-zcode.bat 启动（带 9222 debug port），wallpapers-thumb/ 有图**

（若没有缩图，先双击 `bin/resize.bat` 生成。）

- [ ] **Step 2: 直接跑 rotate 图片轮播（快间隔验证）**

Run: `node lib/rotate.cjs --image --interval 15000`（15 秒切一次）

观察：
- 控制台立即打印 `[rotate] 启动...` + 第一次 `[rotate] 切换 -> <某图>.jpg`
- 15 秒后第二次切换，**和上次不是同一张**（pickRandomExcluding 生效）
- ZCode 主窗口背景跟着变（人眼看）

保持运行，下一个 step 另开终端。

- [ ] **Step 3: 验证 `.rotate.json` 写入**

Run: `node -e "console.log(require('fs').readFileSync('.rotate.json','utf8'))"`

Expected: JSON 含 `running:true, mode:"image", intervalMs:15000, lastFile:<图名>, pid:<数字>, nextSwitchAt:<未来时间戳>`。

- [ ] **Step 4: Ctrl+C 停 rotate，验证清理**

在跑 rotate 的终端按 Ctrl+C。

Expected:
- 打印 `[rotate] 收到 SIGINT，清理并退出`
- `.rotate.json` 变成 `{ running:false, ... }`
- 系统 temp 里没有 `zcode-rotate-*.css` 残留（Run: `node -e "console.log(require('fs').readdirSync(require('os').tmpdir()).filter(n=>/^zcode-rotate-/.test(n)))"` → 空数组）

- [ ] **Step 5: 视频轮播验证（若有 wallpapers-video/ 里的 mp4）**

Run: `node lib/rotate.cjs --video --interval 20000`

Expected: 第一次切换注入 `<video>`，20 秒后换另一个视频文件（`[rotate] 切换 -> <视频>.mp4`），ZCode 背景视频跟着变。Ctrl+C 停。

- [ ] **Step 6: 控制中心端到端**

- 双击 `start.vbs`（或 `bin/reader-server.bat`）起 control-server。
- ZCode 浏览器面板打开 `http://127.0.0.1:17890/control/`。
- 在轮播控件区选"图片"、间隔输 1、点"开始轮播"。
- status 区第 6 行应显示 `图片 轮播 | 每 1min | 下次 <时间> | 当前 <图名>`。
- 等 1 分钟（或改间隔更快），看到切换 + status 的"当前"和"下次"更新。
- 点"停止轮播" → status 第 6 行变 `未轮播`。

- [ ] **Step 7: stale 恢复验证（模拟 server 重启丢 child）**

- 控制中心点"开始轮播"（图片，1min）。
- 任务管理器或 `taskkill /f /im node.exe` 杀掉 control-server 进程（**只杀 server，不杀 rotate 子进程**——rotate 是独立 node，PID 不同。若分不清，用 `wmic process where "commandline like '%rotate.cjs%'"` 找到 rotate 的 PID 单独留活，杀其余）。
- 重新起 control-server，打开控制中心。
- status 第 6 行应显示 `轮播已停（进程退出）`（rotate 子进程随父 node 被杀 → stale）。
- 若 rotate 子进程还活着（没被连带杀），status 显示 `running:true` 正常——这也是合法的（说明没连带死）。
- 点"停止轮播" → 即使 server 没 child handle，`stopRotateNow()` 走 pid kill 兜底，状态变 `未轮播`。

- [ ] **Step 8: 验证完成后提交验证记录（可选）**

无需改代码，记录验证结论即可。若发现 bug，回对应 Task 修 + 加回归测试。

---

## Task 12: AGENTS.md 文档更新

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 在 `AGENTS.md` 的"控制中心"章节之后（"## 测试"之前）加"壁纸轮播"小节**

在 `## 测试` 之前插入：

```markdown
---

## 壁纸轮播（定时随机切换）

第六种能力。和前五种不同：它不改 ZCode 某一面，而是**驱动现有的注入子系统定时重跑**。
`lib/rotate.cjs` 是个常驻看门狗，每隔 N 分钟 spawn 一次 `inject.cjs` 换图/换视频。
**rotate 自己不碰 CDP、不碰注入逻辑**——完全复用 inject 的 env var 旁路（`ZCODE_WP_CSS`/
`ZCODE_WP_VIDEO`），符合"控制中心/触发器不重写动作逻辑"（教训 1）。

### 为什么 rotate spawn inject 而非自己持有 CDP

复用 = 零代码重复。rotate 自己持有 CDP 长连接能省每次几百 ms 的进程启动开销，但要把
connect/retry/buildExpression/buildVideoExpression 抄一份，还要处理"页面导航后 target 变了"。
两份拷贝 = 两份能各自再坏一次的机会（教训 1 二次事故）。不值。间隔是分钟级，开销可忽略。

### 状态用文件 + pid 探活（非 IPC）

rotate 写 `<root>/.rotate.json`（gitignore，运行时产物），status 读它。
"control-server 重启丢 child handle 但 .rotate.json 残留 running:true"靠
`process.kill(pid, 0)` 探活弥补——pid 死了 status 返回 `{running:false, stale:true}`。
单向数据流（rotate 写、status 读），比 IPC/socket 简单（不用管连接生命周期）。

### 互斥 + 单一 kill 逻辑

图轮播和视频轮播互斥（body 同时只能一个背景）。control-server 的 `stopRotateNow()` 是
**唯一一份** kill 逻辑：前端"停止"按钮和 `startRotate*` 的"先停旧"互斥守卫都调它。
server 重启丢 handle 时，`stopRotateNow()` 走 pid kill 兜底（spec §8 边界）。

### 已知遗留

- **rotate 是 control-server 的子进程（非独立窗口）**：control-server 关则 rotate 被连带杀
  （OS 级），和 reader"关窗即停"一致的模型。要脱离 control-server 独立跑可直连
  `node lib/rotate.cjs --image --interval <ms>`。
- **视频用纯定时器不监听 ended**：可能切掉一个还没播完的视频。视频壁纸是动态背景不是
  "看片"，可接受（spec §3.4）。
- **临时 css 残留**：rotate 崩溃没清掉的 `zcode-rotate-*.css` 在系统 temp，rotate 启动时
  扫描清理（spec §8）。OS 也会清。
```

- [ ] **Step 2: 在 `## 测试` 小节里加 rotatetest 说明**

在 `## 测试` 那段开头（`npm test 跑：` 之后）的列表/说明里，补一句：

```markdown
`rotatetest.cjs` 测 `lib/rotate.cjs` 的纯函数：`pickRandomExcluding`（空池/单元素/排除上次/
lastFile 不在池）、`parseInterval`（非法/越界 clamp/默认）、`readState`/`writeState`（缺失/
坏 JSON/原子写）、`buildImageCss`（base + background-image 拼接）。rotate↔inject 的 spawn
链路和 pid 探活靠 Task 11 真机验证（教训 12/13：跨进程胶水单测验不全）。
```

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md
git commit -m "docs(AGENTS): 加壁纸轮播章节 + rotatetest 说明"
```

---

## 完成标准

全部 Task 1-12 完成：
- `npm test` 全绿（含新增 rotatetest + 扩充的 statustest/controlservertest/statusviewtest）。
- Task 11 真机验证清单全过（图片轮播、视频轮播、控制中心启停、stale 恢复）。
- AGENTS.md 更新。
```
