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

// Build image-mode css: wallpaper.css base + a body background-image rule
// pointing at the chosen file. Mirrors inject.cjs main()'s image branch so the
// injected result is identical whether rotate picked the file or inject did.
function buildImageCss(baseCss, fileUrl) {
  if (!fileUrl) return baseCss;
  return baseCss +
    "\n/* 轮播选中的壁纸 */\n" +
    'body { background-image: url("' + fileUrl + '") !important; }\n';
}

module.exports = {
  pickRandomExcluding,
  parseInterval,
  readState,
  writeState,
  buildImageCss,
  STATE_FILENAME,
  DEFAULT_IMAGE_INTERVAL_MS,
  DEFAULT_VIDEO_INTERVAL_MS,
  // main() runs only when this file is the entry (Task 4).
};

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
