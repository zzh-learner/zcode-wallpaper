// Resize wallpaper source images into thumbnails that Electron can render.
// Camera originals (30-39MB) are too big for background-image; this scales
// them to <=2560px long edge, JPEG quality 85, output to wallpapers-thumb/.
// Incremental: skips images already resized (mtime check).
//
// Usage: node lib/resize.cjs   (or double-click resize.bat)

const fs = require("fs");
const path = require("path");

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"]; // raster only; no .gif/.svg
const MAX_WIDTH = 2560;
const JPEG_QUALITY = 85;

// List raster image filenames in dir. Returns [] if dir missing/empty.
function listSourceImages(dir) {
  try {
    var entries = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  return entries.filter(function (name) {
    var ext = path.extname(name).toLowerCase();
    return IMAGE_EXTS.indexOf(ext) !== -1;
  });
}

// True if src needs (re)resizing: thumb missing, or thumb older than src.
function needsResize(srcPath, thumbPath) {
  try {
    var srcStat = fs.statSync(srcPath);
    var thumbStat = fs.statSync(thumbPath);
    return thumbStat.mtimeMs < srcStat.mtimeMs;
  } catch (e) {
    return true; // thumb missing or stat failed -> resize
  }
}

// sharp is required lazily inside resizeOne so that listSourceImages /
// needsResize can be unit-tested without sharp installed.
async function resizeOne(srcPath, thumbPath) {
  const sharp = require("sharp");
  await sharp(srcPath)
    .resize({
      width: MAX_WIDTH,
      height: MAX_WIDTH,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toFile(thumbPath);
}

async function main() {
  var srcDir = path.join(__dirname, "..", "wallpapers");
  var thumbDir = path.join(__dirname, "..", "wallpapers-thumb");

  console.log("[wallpaper] Step 1: scan source images");
  var images = listSourceImages(srcDir);
  if (images.length === 0) {
    console.log("[wallpaper]   wallpapers/ 为空，没图可缩。把图放进 wallpapers/ 后重跑。");
    process.exit(0);
  }
  console.log("[wallpaper]   found " + images.length + " images");

  console.log("[wallpaper] Step 2: ensure wallpapers-thumb/");
  fs.mkdirSync(thumbDir, { recursive: true });

  console.log("[wallpaper] Step 3: resize (skip already-resized)");
  var added = 0,
    skipped = 0,
    failed = 0;
  for (var i = 0; i < images.length; i++) {
    var name = images[i];
    var srcPath = path.join(srcDir, name);
    var base = name.replace(/\.[^.]+$/, ""); // strip extension
    var thumbPath = path.join(thumbDir, base + ".jpg");
    if (!needsResize(srcPath, thumbPath)) {
      skipped++;
      continue;
    }
    try {
      await resizeOne(srcPath, thumbPath);
      var kb = Math.round(fs.statSync(thumbPath).size / 1024);
      console.log("[wallpaper]   " + base + ".jpg  (" + kb + " KB)");
      added++;
    } catch (e) {
      console.error("[wallpaper]   " + name + " FAILED: " + e.message);
      failed++;
    }
  }

  console.log("[wallpaper] ========================================");
  console.log(
    "[wallpaper]  缩图完成: 新增 " + added + " / 跳过 " + skipped + " / 失败 " + failed
  );
  console.log("[wallpaper]  inject 会从 wallpapers-thumb/ 随机选图");
  console.log("[wallpaper] ========================================");
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = { listSourceImages, needsResize, MAX_WIDTH, JPEG_QUALITY };

if (require.main === module) {
  main().catch(function (e) {
    console.error("[wallpaper] FAILED:", e.message);
    process.exit(1);
  });
}
