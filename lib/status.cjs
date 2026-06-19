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

module.exports = { alphaToOpacityPct, opacityPctToAlpha, mergeProbeResults };
// snapshot() + probe functions added in Task 5/7.
