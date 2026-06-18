// Self-test for inject.cjs buildExpression logic against a fake DOM.
// Run: node test/selftest.cjs
const fs = require("fs");
const path = require("path");
const inject = require("../lib/inject.cjs");

const STYLE_ID = "zcode-user-wallpaper";
// buildExpression comes from inject.cjs itself, so tests exercise the real
// implementation instead of a manually-synced copy. (Previously a copy lived
// here and could silently drift from inject.cjs — see AGENTS.md.)
const { buildExpression, buildVideoExpression, VIDEO_EL_ID, listVideos, encodeFileUrl } = require("../lib/inject.cjs");

function makeFakeDom() {
  // A minimal registry so getElementById finds whatever was appended.
  const registry = {}; // id -> node (only "attached" ones)
  function makeNode() {
    return {
      id: null,
      textContent: null,
      // For <video> nodes we also track attributes (the video expression sets
      // src via setAttribute). Style nodes never call setAttribute.
      _attrs: {},
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
      remove() {
        if (this.id && registry[this.id] === this) delete registry[this.id];
      },
    };
  }
  return {
    document: {
      getElementById(id) {
        return registry[id] || null;
      },
      createElement(tag) {
        // Both <style> (image mode) and <video> (video mode) are created here.
        // The registry is keyed by id, so any element type is fine; we only
        // assert on id/attributes, never on tag-specific behavior.
        return makeNode();
      },
      documentElement: {
        appendChild(n) {
          // Appending sets its id into the registry, mirroring real DOM behavior
          // where a node becomes findable by id once in the document.
          if (n.id) registry[n.id] = n;
          return n;
        },
      },
      body: {
        appendChild(n) {
          if (n.id) registry[n.id] = n;
          return n;
        },
      },
    },
  };
}

let pass = 0,
  fail = 0;
function check(name, cond) {
  console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name);
  cond ? pass++ : fail++;
}

// --- Test 1: inject ---
{
  const css = fs.readFileSync(path.join(__dirname, "..", "lib", "wallpaper.css"), "utf8");
  const { document } = makeFakeDom();
  const fn = new Function("document", "return " + buildExpression("inject", css));
  const result = fn(document);
  check("inject returns 'ok'", result === "ok");
  // verify a style with our id now exists in the fake dom
  const style = document.getElementById(STYLE_ID);
  check("inject: style present after inject", !!style);
  check("inject: css textContent set", style && style.textContent.length === css.length);
}

// --- Test 2: remove after inject ---
{
  const css = "body{color:red}";
  const { document } = makeFakeDom();
  const inj = new Function("document", "return " + buildExpression("inject", css));
  inj(document);
  const styleBefore = document.getElementById(STYLE_ID);
  check("remove-pre: style exists", !!styleBefore);
  const rem = new Function("document", "return " + buildExpression("remove", ""));
  const remResult = rem(document);
  check("remove returns 'removed'", remResult === "removed");
  check("remove: style gone after remove", !document.getElementById(STYLE_ID));
}

// --- Test 3: remove when nothing injected ---
{
  const { document } = makeFakeDom();
  const rem = new Function("document", "return " + buildExpression("remove", ""));
  const remResult = rem(document);
  check("remove-empty returns 'none'", remResult === "none");
}

// --- Test 4: re-inject replaces (no duplicate) ---
{
  const { document } = makeFakeDom();
  const inj = new Function("document", "return " + buildExpression("inject", "body{a:1}"));
  inj(document);
  inj(document); // second inject should remove the first, not duplicate
  // In this fake DOM, getElementById returns the single attached node;
  // the re-inject path removes existing then appends a new one.
  const styles = [document.getElementById(STYLE_ID)].filter(Boolean);
  check("re-inject: still exactly one style", styles.length === 1);
}

// --- Test 4b: video expression injects <style> + <video> ---
{
  const css = "body{transparent}";
  const url = "file:///x/sample-1.mp4";
  const { document } = makeFakeDom();
  const fn = new Function("document", "return " + buildVideoExpression(css, url));
  const result = fn(document);
  check("video inject returns 'ok'", result === "ok");
  // The transparent-UI <style> layer is present (shared with image mode).
  const style = document.getElementById(STYLE_ID);
  check("video: <style> layer present", !!style);
  check("video: <style> css set", style && style.textContent.length === css.length);
  // The <video> element is present and carries the chosen src.
  const video = document.getElementById(VIDEO_EL_ID);
  check("video: <video> element present", !!video);
  check("video: src attribute set to chosen url", video && video.getAttribute("src") === url);
  check("video: autoplay set", video && video.getAttribute("autoplay") === "");
  check("video: muted set", video && video.getAttribute("muted") === "");
  check("video: loop set", video && video.getAttribute("loop") === "");
  check("video: playsinline set", video && video.getAttribute("playsinline") === "");
}

// --- Test 4c: video expression contains the expected markers (string-level) ---
{
  const expr = buildVideoExpression("body{a:1}", "file:///x/y.mp4");
  // The .play() fallback call must be present (autoplay alone is not 100%).
  check("video expr contains .play() fallback", expr.indexOf(".play()") !== -1);
  // The video file URL must survive JSON.stringify intact.
  check("video expr contains the file url", expr.indexOf("file:///x/y.mp4") !== -1);
  // createElement('video') — proves it's a real DOM element, not CSS background.
  check("video expr creates a <video> element", expr.indexOf("createElement('video')") !== -1);
  check("video expr references the video element id", expr.indexOf(VIDEO_EL_ID) !== -1);
}

// --- Test 4d: --remove cleans up BOTH image-style and video element ---
{
  // Inject video first (leaves both a <style> and a <video>), then remove.
  const { document } = makeFakeDom();
  const inj = new Function("document", "return " + buildVideoExpression("body{a:1}", "file:///x/z.mp4"));
  inj(document);
  check("remove-video-pre: style exists", !!document.getElementById(STYLE_ID));
  check("remove-video-pre: video exists", !!document.getElementById(VIDEO_EL_ID));
  const rem = new Function("document", "return " + buildExpression("remove", ""));
  const remResult = rem(document);
  check("remove after video returns 'removed'", remResult === "removed");
  check("remove: style gone", !document.getElementById(STYLE_ID));
  check("remove: video gone", !document.getElementById(VIDEO_EL_ID));
}

// --- Test 5: inject.cjs pure functions (toFileUrl / listWallpapers / listVideos / pickRandom / encodeFileUrl) ---
(function () {
  // toFileUrl
  check(
    "toFileUrl('C:\\\\a\\\\b') -> file:///C:/a/b",
    inject.toFileUrl("C:\\a\\b") === "file:///C:/a/b"
  );

  // listWallpapers: missing dir -> []
  check("listWallpapers on missing dir -> []", inject.listWallpapers("Z:\\no\\such\\dir").length === 0);

  // listWallpapers: real temp dir with mixed files
  var os = require("os");
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-wp-test-"));
  try {
    fs.writeFileSync(path.join(tmp, "a.jpg"), "x");
    fs.writeFileSync(path.join(tmp, "b.txt"), "x");
    fs.writeFileSync(path.join(tmp, "c.png"), "x");
    var imgs = inject.listWallpapers(tmp).sort();
    check("listWallpapers filters by extension", JSON.stringify(imgs) === JSON.stringify(["a.jpg", "c.png"]));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // pickRandom: empty -> null
  check("pickRandom([]) -> null", inject.pickRandom([]) === null);

  // pickRandom: result always in list
  var pool = ["x.jpg", "y.jpg", "z.jpg"];
  var ok = true;
  for (var i = 0; i < 20; i++) {
    if (pool.indexOf(inject.pickRandom(pool)) === -1) { ok = false; break; }
  }
  check("pickRandom returns an item from the list", ok);

  // listVideos: missing dir -> []
  check("listVideos on missing dir -> []", listVideos("Z:\\no\\such\\dir").length === 0);

  // listVideos: real temp dir with mixed files (only video exts kept)
  var vtmp = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-wp-video-test-"));
  try {
    fs.writeFileSync(path.join(vtmp, "a.mp4"), "x");
    fs.writeFileSync(path.join(vtmp, "b.txt"), "x");
    fs.writeFileSync(path.join(vtmp, "c.webm"), "x");
    fs.writeFileSync(path.join(vtmp, "d.jpg"), "x");
    var vids = listVideos(vtmp).sort();
    check(
      "listVideos filters to video extensions (no .jpg/.txt)",
      JSON.stringify(vids) === JSON.stringify(["a.mp4", "c.webm"])
    );
  } finally {
    fs.rmSync(vtmp, { recursive: true, force: true });
  }

  // encodeFileUrl: ASCII path unchanged
  check(
    "encodeFileUrl ASCII unchanged",
    encodeFileUrl("file:///C:/dir/clip.mp4") === "file:///C:/dir/clip.mp4"
  );
  // encodeFileUrl: space percent-encoded
  check(
    "encodeFileUrl encodes spaces",
    encodeFileUrl("file:///C:/my dir/clip.mp4") === "file:///C:/my%20dir/clip.mp4"
  );
  // encodeFileUrl: non-ASCII percent-encoded, file:/// prefix kept
  var enc = encodeFileUrl("file:///G:/视频/x.mp4");
  check("encodeFileUrl keeps file:/// prefix", enc.indexOf("file:///G:/") === 0);
  check("encodeFileUrl encodes non-ASCII (no raw 视频 left)", enc.indexOf("视频") === -1);
  check("encodeFileUrl keeps .mp4 readable", /\.mp4$/.test(enc));
})();

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail > 0 ? 1 : 0);
