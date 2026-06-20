// Read-only status probe (spec §4 A2). snapshot() gathers state①~⑤; NEVER
// mutates anything. Heavy I/O (CDP/PS/fs) is in probe functions (Task 5/7);
// pure helpers here are unit-tested independently.
const os = require("os");
const fs = require("fs");
const path = require("path");
const cdp = require("./cdp.cjs");
const rotate = require("./rotate.cjs"); // spec §5.1: readState shared, not duplicated

// alpha (0-255) <-> opacity percent (0-100).
function alphaToOpacityPct(alpha) { return Math.round((alpha / 255) * 100); }
function opacityPctToAlpha(pct) { return Math.round(pct * 2.55); }

// Merge per-item probe results into one snapshot. Null items = probe failed;
// recorded in _meta.probeErrors, do NOT pollute the whole snapshot (spec §6.2).
function mergeProbeResults(parts) {
  const probeErrors = [];
  for (const k of ["zcode", "wallpaper", "transparent", "reader", "resources", "rotate"]) {
    if (parts[k] === null || parts[k] === undefined) {
      probeErrors.push({ item: k, reason: parts[k + "Error"] || "probe failed" });
    }
  }
  return Object.assign({}, parts, {
    _meta: { fetchedAt: Date.now(), probeErrors },
  });
}

module.exports = { alphaToOpacityPct, opacityPctToAlpha, mergeProbeResults, snapshot, probeResources, classifyTransparent, probeTransparent, probeRotate };

// ---- resource counting (spec §⑤) ----
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];
const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".ogg", ".ogv"];
function _listByExt(dir, exts) {
  try { return fs.readdirSync(dir).filter(n => exts.indexOf(path.extname(n).toLowerCase()) !== -1); }
  catch (e) { return []; }
}
function depInstalled(root, name) {
  // fs check (not require.resolve): native modules like sharp have load-time
  // resolution that can throw even when installed; existence of the dir is the
  // reliable signal for "is it installed".
  try { return fs.existsSync(path.join(root, "node_modules", name)); }
  catch (e) { return false; }
}
async function probeResources(root) {
  return {
    images: _listByExt(path.join(root, "wallpapers"), IMAGE_EXTS).length,
    thumbs: _listByExt(path.join(root, "wallpapers-thumb"), IMAGE_EXTS).length,
    videos: _listByExt(path.join(root, "wallpapers-video"), VIDEO_EXTS).length,
    novels: (function () { try { return fs.readdirSync(path.join(root, "novels")).filter(n => /\.txt$/i.test(n)).length; } catch (e) { return 0; } })(),
    deps: { sharp: depInstalled(root, "sharp"), ws: depInstalled(root, "ws") },
  };
}

// ---- zcode + wallpaper (CDP; null if CDP down) ----
async function probeZcodeAndWallpaper() {
  const pages = await cdp.listTargets();   // filtered (excludes tool pages)
  let mode = "none";
  for (const t of pages) {
    try { const m = await cdp.probeWallpaperMode(t); if (m !== "none") { mode = m; break; } }
    catch (e) { /* per-target fail, continue */ }
  }
  return {
    zcode: { running: true, pid: null, debugPort: cdp.PORT, pageTargets: pages.length },
    wallpaper: { mode, injectedWindows: mode === "none" ? 0 : pages.length, totalWindows: pages.length, lastInjectAt: null },
  };
}

// ---- transparent probe (spec §4 A2, §10 状态机, §5.3 500ms 缓存) ----
const { execFile } = require("child_process");
const STATUS_ROOT = path.join(__dirname, "..");

// Pure: spec §10 状态机分类。
// psResult = {found, layered, alpha, hwnd} from PS -Query; ambiguous = 多候选无法确定主窗口。
// Returns { enabled: true|false|"unknown", opacityPct?, alpha?, hwnd? }.
function classifyTransparent(psResult, ambiguous) {
  if (!psResult || !psResult.found) {
    return { enabled: ambiguous ? "unknown" : false };
  }
  if (!psResult.layered || psResult.alpha == null) return { enabled: false };
  if (psResult.alpha >= 255) return { enabled: false };
  return { enabled: true, alpha: psResult.alpha, opacityPct: alphaToOpacityPct(psResult.alpha), hwnd: psResult.hwnd };
}

let _alphaCache = { at: 0, val: null };
const ALPHA_CACHE_MS = 500;

// Run transparent.ps1 -Query with given args; parse last JSON line from stdout.
function _runTransparentQuery(args) {
  return new Promise((resolve) => {
    const ps = path.join(__dirname, "transparent.ps1");
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps].concat(args),
      { cwd: STATUS_ROOT }, (err, stdout) => {
        if (err) { resolve(null); return; }
        const lines = stdout.split(/\r?\n/).filter(l => l.trim().indexOf("{") === 0);
        if (!lines.length) { resolve(null); return; }
        try { resolve(JSON.parse(lines[lines.length - 1])); }
        catch (e) { resolve(null); }
      });
  });
}

// probeTransparent(transparentHwnd): server 记的上次 setTransparent 的 hwnd (无则 null, 走 -ProcessName 兜底)。
// 500ms 缓存 (spec §5.3)：spawn PS 较慢，避免拖慢 2s 轮询。
async function probeTransparent(transparentHwnd) {
  if (Date.now() - _alphaCache.at < ALPHA_CACHE_MS && _alphaCache.val) return _alphaCache.val;
  let psResult = null, ambiguous = false;
  if (transparentHwnd) {
    const r = await _runTransparentQuery(["-Query", "-Hwnd", String(transparentHwnd), "-Json"]);
    if (r) psResult = Object.assign({ found: true }, r);
  }
  if (!psResult) {
    // -ProcessName 兜底 (spec §10 状态机"否"分支)；PS 多候选自动选面积最大不 read-host
    const r = await _runTransparentQuery(["-Query", "-ProcessName", "ZCode", "-Json"]);
    if (r && r.hwnd == null) {
      // 进程没开或无可见窗口 -> 无法确定窗口 (hwnd=null) -> 可能 unknown
      psResult = { found: false };
      ambiguous = true;
    } else if (r) {
      psResult = Object.assign({ found: true }, r);
    }
  }
  const v = classifyTransparent(psResult, ambiguous);
  _alphaCache = { at: Date.now(), val: v };
  return v;
}

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

// ---- main entry ----
// opts: { root, serverPort, transparentHwnd }
async function snapshot(opts) {
  opts = opts || {};
  const root = opts.root || path.join(__dirname, "..");
  const parts = {};
  // resources (always works)
  parts.resources = await probeResources(root);
  // zcode + wallpaper (CDP; null if down)
  try { const zw = await probeZcodeAndWallpaper(); parts.zcode = zw.zcode; parts.wallpaper = zw.wallpaper; }
  catch (e) { parts.zcode = null; parts.wallpaper = null; parts.zcodeError = e.message; }
  // transparent
  try { parts.transparent = await probeTransparent(opts.transparentHwnd); }
  catch (e) { parts.transparent = null; parts.transparentError = e.message; }
  // reader (this server is the reader too)
  parts.reader = { running: true, port: opts.serverPort || null };
  // rotate (file-based state; null if probe throws — shouldn't, but be safe)
  try { parts.rotate = await probeRotate(root); }
  catch (e) { parts.rotate = null; parts.rotateError = e.message; }
  return mergeProbeResults(parts);
}
