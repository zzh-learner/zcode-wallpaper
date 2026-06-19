// Read-only status probe (spec §4 A2). snapshot() gathers state①~⑤; NEVER
// mutates anything. Heavy I/O (CDP/PS/fs) is in probe functions (Task 5/7);
// pure helpers here are unit-tested independently.
const os = require("os");
const fs = require("fs");
const path = require("path");
const cdp = require("./cdp.cjs");

// alpha (0-255) <-> opacity percent (0-100).
function alphaToOpacityPct(alpha) { return Math.round((alpha / 255) * 100); }
function opacityPctToAlpha(pct) { return Math.round(pct * 2.55); }

// Merge per-item probe results into one snapshot. Null items = probe failed;
// recorded in _meta.probeErrors, do NOT pollute the whole snapshot (spec §6.2).
function mergeProbeResults(parts) {
  const probeErrors = [];
  for (const k of ["zcode", "wallpaper", "transparent", "reader", "resources"]) {
    if (parts[k] === null || parts[k] === undefined) {
      probeErrors.push({ item: k, reason: parts[k + "Error"] || "probe failed" });
    }
  }
  return Object.assign({}, parts, {
    _meta: { fetchedAt: Date.now(), probeErrors },
  });
}

module.exports = { alphaToOpacityPct, opacityPctToAlpha, mergeProbeResults, snapshot, probeResources, classifyTransparent, probeTransparent };

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

// ---- transparent probe: real PS query added in Task 7. Stub here (null). ----
function classifyTransparent(psResult, ambiguous) { return null; } // replaced Task 7
async function probeTransparent(hwnd) { return null; }             // replaced Task 7

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
  return mergeProbeResults(parts);
}
