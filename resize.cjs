// Resize wallpaper source images into thumbnails that Electron can render.
// Camera originals (30-39MB) are too big for background-image; this scales
// them to <=2560px long edge, JPEG quality 85, output to wallpapers-thumb/.
// Incremental: skips images already resized (mtime check).
//
// Usage: node resize.cjs   (or double-click resize.bat)

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
  // Task 3 fills this in.
}

module.exports = { listSourceImages, needsResize, MAX_WIDTH, JPEG_QUALITY };

if (require.main === module) {
  main().catch(function (e) {
    console.error("[wallpaper] FAILED:", e.message);
    process.exit(1);
  });
}
