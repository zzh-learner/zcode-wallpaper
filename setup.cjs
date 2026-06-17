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

function fail(msg) {
  console.error("[wallpaper] " + msg);
  process.exit(1);
}

function main() {
  var zcodePath = null;

  // --- Step 1: node version ---
  console.log("[wallpaper] Step 1: check Node.js version");
  var major = parseNodeVersion(process.version);
  if (!isNodeVersionOk(major)) {
    fail(
      "Node.js v" +
        major +
        " is too old (need v" +
        MIN_NODE_MAJOR +
        "+). Download from https://nodejs.org"
    );
  }
  console.log("[wallpaper]   Node " + process.version + " OK");

  // --- Step 2: detect ZCode.exe (non-fatal) ---
  console.log("[wallpaper] Step 2: locate ZCode.exe");
  zcodePath = detectZcode();
  if (zcodePath) {
    console.log("[wallpaper]   Found: " + zcodePath);
  } else {
    console.log("[wallpaper]   WARN: ZCode.exe not found.");
    console.log("[wallpaper]   Install ZCode first, or set ZCODE_EXE in start-zcode.bat later.");
  }

  // --- Step 3: ensure wallpapers/ exists ---
  console.log("[wallpaper] Step 3: ensure wallpapers/ directory");
  var wallpapersDir = path.join(__dirname, "wallpapers");
  try {
    fs.mkdirSync(wallpapersDir, { recursive: true });
  } catch (e) {
    fail("cannot create wallpapers/ directory: " + e.message);
  }
  console.log("[wallpaper]   " + wallpapersDir);

  // --- Step 4: replace placeholder in wallpaper.css (idempotent) ---
  console.log("[wallpaper] Step 4: configure wallpaper path in wallpaper.css");
  var cssPath = path.join(__dirname, "wallpaper.css");
  var css;
  try {
    css = fs.readFileSync(cssPath, "utf8");
  } catch (e) {
    fail("cannot read wallpaper.css: " + e.message);
  }
  if (!hasPlaceholder(css)) {
    console.log("[wallpaper]   wallpaper.css path already configured, skip");
  } else {
    var fileUrl = toFileUrl(wallpapersDir);
    css = replacePlaceholder(css, fileUrl);
    try {
      fs.writeFileSync(cssPath, css, "utf8");
    } catch (e) {
      fail("cannot write wallpaper.css: " + e.message);
    }
    console.log("[wallpaper]   Configured -> " + fileUrl + "/wallpaper.svg");
  }

  // --- Step 5: npm install ---
  console.log("[wallpaper] Step 5: install dependencies (npm install)");
  try {
    execSync("npm install", { cwd: __dirname, stdio: "inherit" });
  } catch (e) {
    fail("npm install failed. Check your network / npm mirror.");
  }

  // --- Step 6: summary ---
  console.log("[wallpaper] ========================================");
  console.log("[wallpaper]  初始化完成！");
  console.log("[wallpaper]  - Node: " + process.version + " ✓");
  console.log("[wallpaper]  - ZCode: " + (zcodePath ? zcodePath + " ✓" : "⚠ 未找到"));
  console.log("[wallpaper]  - 壁纸目录: " + wallpapersDir + " ✓");
  console.log("[wallpaper]  - 壁纸路径已配置 -> wallpaper.svg");
  console.log("[wallpaper]  - 依赖已安装 (ws)");
  console.log("[wallpaper]  下一步:");
  console.log("[wallpaper]   1. 想换图: 把图放进 wallpapers/, 改 wallpaper.css 的文件名");
  console.log("[wallpaper]   2. 完全退出 ZCode -> 双击 start-zcode.bat");
  console.log("[wallpaper] ========================================");
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
