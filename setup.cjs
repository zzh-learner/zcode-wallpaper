// One-click setup for zcode-wallpaper on a new machine.
// Checks environment, configures the local wallpaper path (via a placeholder
// in wallpaper.css), and installs dependencies. Idempotent: safe to re-run.
//
// Usage: node setup.cjs   (or double-click setup.bat)

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PLACEHOLDER = "__WALLPAPER__";
const MIN_NODE_MAJOR = 18;

// Parse "v24.16.0" -> 24. Throws on malformed input.
function parseNodeVersion(v) {
  const m = /^v?(\d+)/.exec(v);
  if (!m) throw new Error("cannot parse node version: " + v);
  return parseInt(m[1], 10);
}

// True if the major version meets the minimum.
function isNodeVersionOk(major) {
  return major >= MIN_NODE_MAJOR;
}

// Convert a Windows absolute path to a file:/// URL.
// "C:\\a\\b\\wallpapers" -> "file:///C:/a/b/wallpapers"
// Rule: prefix "file:///", then replace all backslashes with forward slashes.
function toFileUrl(p) {
  return "file:///" + String(p).replace(/\\/g, "/");
}

// True if css still contains the __WALLPAPER__ placeholder.
function hasPlaceholder(css) {
  return css.indexOf(PLACEHOLDER) !== -1;
}

// Replace all __WALLPAPER__ occurrences in css with fileUrl.
// If the placeholder is already gone (already configured / user edited),
// returns css unchanged (idempotent + preserves user customizations).
function replacePlaceholder(css, fileUrl) {
  if (!hasPlaceholder(css)) return css;
  return css.split(PLACEHOLDER).join(fileUrl);
}

// Detect ZCode.exe location. Tries, in order:
//   1. running process path
//   2. App Paths registry key
//   3. common install paths
// Each probe is wrapped in try/catch; any error just falls through to the next.
// Returns the path string, or null if not found.
function detectZcode() {
  // 1) running process
  try {
    var out = execSync(
      'powershell -NoProfile -Command "(Get-Process ZCode -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)"',
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();
    if (out) return out;
  } catch (e) {}

  // 2) registry App Paths
  try {
    var reg = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\ZCode.exe" /ve',
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    );
    var m = /REG_SZ\s+(.+)/.exec(reg);
    if (m && m[1].trim()) return m[1].trim();
  } catch (e) {}

  // 3) common paths
  var candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "ZCode", "ZCode.exe"),
    "D:\\zcode\\ZCode.exe",
    "C:\\Program Files\\ZCode\\ZCode.exe",
    "C:\\Program Files (x86)\\ZCode\\ZCode.exe",
  ];
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.existsSync(candidates[i])) return candidates[i];
    } catch (e) {}
  }
  return null;
}

function main() {
  // Task 5 fills this in.
}

// Export pure functions for testing; run main() only when invoked directly.
module.exports = {
  parseNodeVersion,
  isNodeVersionOk,
  toFileUrl,
  hasPlaceholder,
  replacePlaceholder,
  detectZcode,
};

if (require.main === module) {
  main();
}
