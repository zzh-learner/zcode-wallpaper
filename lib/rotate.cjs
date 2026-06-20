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
