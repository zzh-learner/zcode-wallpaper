// Self-test for resize.cjs pure functions. Run: node test/resizetest.cjs
const fs = require("fs");
const path = require("path");
const os = require("os");
const resize = require("../lib/resize.cjs");

let pass = 0,
  fail = 0;
function check(name, cond) {
  console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name);
  cond ? pass++ : fail++;
}

// --- listSourceImages ---
check("listSourceImages on missing dir -> []", resize.listSourceImages("Z:\\no\\such\\dir").length === 0);

(function () {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-resize-test-"));
  try {
    fs.writeFileSync(path.join(tmp, "a.jpg"), "x");
    fs.writeFileSync(path.join(tmp, "b.txt"), "x");
    fs.writeFileSync(path.join(tmp, "c.png"), "x");
    fs.writeFileSync(path.join(tmp, "d.svg"), "x");
    var imgs = resize.listSourceImages(tmp).sort();
    check(
      "listSourceImages filters to raster (no svg)",
      JSON.stringify(imgs) === JSON.stringify(["a.jpg", "c.png"])
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();

// --- needsResize ---
(function () {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-resize-test-"));
  try {
    var src = path.join(tmp, "src.jpg");
    var thumb = path.join(tmp, "src-thumb.jpg");
    // thumb missing -> needs resize
    fs.writeFileSync(src, "x");
    check("needsResize: thumb missing -> true", resize.needsResize(src, thumb) === true);
    // thumb newer than src -> skip
    fs.writeFileSync(thumb, "x");
    // bump thumb mtime to be definitely newer
    var future = new Date(Date.now() + 10000);
    fs.utimesSync(thumb, future, future);
    check("needsResize: thumb newer -> false", resize.needsResize(src, thumb) === false);
    // src replaced (newer) -> needs resize again
    var later = new Date(Date.now() + 20000);
    fs.utimesSync(src, later, later);
    check("needsResize: src newer -> true", resize.needsResize(src, thumb) === true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail > 0 ? 1 : 0);
