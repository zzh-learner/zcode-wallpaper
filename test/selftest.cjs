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

// Local helper: self-contained copy of ui-tune's expression builder. Deliberately
// NOT a require of lib/ui-tune.cjs — what these tests pin is how inject.cjs's
// expressions MANAGE the tune element id, not ui-tune itself.
function buildTuneExprForTest(styleId, css) {
  return "(function(){var id=" + JSON.stringify(styleId) +
    ";var old=document.getElementById(id);if(old)old.remove();" +
    (css ? "var s=document.createElement('style');s.id=id;s.textContent=" + JSON.stringify(css) +
      ";document.documentElement.appendChild(s);" : "") +
    "return JSON.stringify({ok:true});})()";
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
  // webview 透明规则必须存在：ZCode 给浏览器面板 <webview> 加了内联白底
  // （browser-use-viewport），没有这条 !important 规则壁纸会被白块挡住
  // （2026-09 真机）。内联样式只有 !important 能盖过，别改成普通规则。
  check(
    "inject: wallpaper.css forces webview transparent (!important beats inline white)",
    /webview\s*\{[^}]*background-color:\s*transparent\s*!important/.test(css)
  );
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
  check("video: loop set", video && video.getAttribute("loop") === "");
  check("video: playsinline set", video && video.getAttribute("playsinline") === "");
}

// --- Test 4c: video expression default mode = unmuted + auto-fallback ---
{
  const expr = buildVideoExpression("body{a:1}", "file:///x/y.mp4");
  // Default mode must NOT force muted at top level. The auto-fallback
  // (play().catch -> set muted + replay) handles the no-flag case. So
  // `v.muted=true` should appear ONLY inside the catch/fallback paths, never
  // as an unconditional top-level statement. Count occurrences: exactly 2
  // (one in the async .catch callback, one in the sync catch(e) block).
  var muteCount = (expr.match(/v\.muted=true/g) || []).length;
  check("video default: v.muted=true only in fallback (exactly 2x)", muteCount === 2);
  // Sanity: the two occurrences must both be inside catch/try blocks, not at
  // top level. Verify by checking the substring BEFORE the first v.muted=true
  // ends with a function/catch opener (i.e. muted is inside a callback).
  var firstIdx = expr.indexOf("v.muted=true");
  var before = expr.slice(0, firstIdx);
  check("video default: first v.muted=true is inside a catch callback", /[(){]\s*$/.test(before));
  // The .play() call must be present, and its .catch must re-mute + replay
  // (auto-degrade when flag not effective: AGENTS.md 教训 13/21).
  check("video default: contains .play()", expr.indexOf(".play()") !== -1);
  check("video default: catch path re-mutes", expr.indexOf("v.muted=true") !== -1);
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

// --- Test 4e: image inject after video cleans up the lingering <video> ---
// Regression for the "video -> image, still hear audio" bug. The image inject
// path must remove any prior <video> (with its audio), not just refresh the
// <style>. --remove already did this; the image-inject path was the gap.
{
  const { document } = makeFakeDom();
  // Start in video mode: both a <style> and a (playing, audible) <video>.
  const videoFn = new Function("document", "return " + buildVideoExpression("body{a:1}", "file:///x/sound.mp4"));
  videoFn(document);
  check("video->image pre: style exists", !!document.getElementById(STYLE_ID));
  check("video->image pre: video exists", !!document.getElementById(VIDEO_EL_ID));
  // Now inject an image wallpaper (the bug scenario).
  const imgFn = new Function("document", "return " + buildExpression("inject", "body{bg:url(x.jpg)}"));
  const result = imgFn(document);
  check("video->image: inject returns 'ok'", result === "ok");
  // The new image <style> is present...
  check("video->image: style present (refreshed)", !!document.getElementById(STYLE_ID));
  // ...and the old <video> (carrying audio) is GONE. This is the fix.
  check("video->image: old <video> removed (no leftover audio)", !document.getElementById(VIDEO_EL_ID));
}

// --- Test 4f/4g/4h: 玻璃调节层 (zcode-user-ui-tune) 三路径管理 ---
// 不变量(spec 2026-09-16 §3):任何注入/移除路径都必须管理 tune 层——
// remove 清掉;inject/video 清掉旧的,配置非默认时再建新的。
const TUNE_ID = "zcode-user-ui-tune";

// 4f: --remove 清掉 tune 层
{
  const { document } = makeFakeDom();
  const tuneFn = new Function("document", "return " + buildTuneExprForTest(TUNE_ID, "body{g:1}"));
  tuneFn(document);
  check("tune-remove pre: tune el exists", !!document.getElementById(TUNE_ID));
  const rem = new Function("document", "return " + buildExpression("remove", "", null));
  rem(document);
  check("remove: tune layer gone", !document.getElementById(TUNE_ID));
  check("remove: style+video also gone", !document.getElementById(STYLE_ID) && !document.getElementById(VIDEO_EL_ID));
}

// 4g: inject 不带 tuneCss -> 清掉残留 tune 层,不重建(配置为默认)
{
  const { document } = makeFakeDom();
  const tuneFn = new Function("document", "return " + buildTuneExprForTest(TUNE_ID, "body{old:1}"));
  tuneFn(document);
  const imgFn = new Function("document", "return " + buildExpression("inject", "body{bg:url(x.jpg)}", null));
  imgFn(document);
  check("inject-no-tune: stale tune layer cleared", !document.getElementById(TUNE_ID));
  check("inject-no-tune: wallpaper style present", !!document.getElementById(STYLE_ID));
}

// 4h: inject 带 tuneCss -> 清旧建新
{
  const { document } = makeFakeDom();
  const tuneFn = new Function("document", "return " + buildTuneExprForTest(TUNE_ID, "body{old:1}"));
  tuneFn(document);
  const imgFn = new Function("document", "return " + buildExpression("inject", "body{bg:url(x.jpg)}", "aside[data-testid=x]{background:rgba(0,0,0,.5)}"));
  imgFn(document);
  const tuneEl = document.getElementById(TUNE_ID);
  check("inject-with-tune: tune layer rebuilt", !!tuneEl);
  check("inject-with-tune: new css applied", tuneEl && tuneEl.textContent === "aside[data-testid=x]{background:rgba(0,0,0,.5)}");
}

// 4i: video 注入带 tuneCss -> 同样重建
{
  const { document } = makeFakeDom();
  const vidFn = new Function("document", "return " + buildVideoExpression("body{a:1}", "file:///x/v.mp4", "aside[data-testid=x]{g:1}"));
  vidFn(document);
  check("video-with-tune: tune layer present", !!document.getElementById(TUNE_ID));
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
    fs.writeFileSync(path.join(vtmp, "e.m4v"), "x");
    var vids = listVideos(vtmp).sort();
    check(
      "listVideos filters to video extensions (no .jpg/.txt)",
      JSON.stringify(vids) === JSON.stringify(["a.mp4", "c.webm", "e.m4v"])
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
