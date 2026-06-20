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
