// Test lib/cdp.cjs — pure-function target filtering (spec §5.4, 审查 P1-2).
// filterTargets must exclude our own tool pages by PATH PREFIX on any localhost port.
const cdp = require("../lib/cdp.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// mock /json target shapes (real CDP returns these fields)
const targets = [
  { type: "page", webSocketDebuggerUrl: "ws://x/page1", url: "file:///C:/ZCode/index.html", title: "ZCode" },
  { type: "page", webSocketDebuggerUrl: "ws://x/ctrl",  url: "http://127.0.0.1:17890/control/", title: "控制中心" },
  { type: "page", webSocketDebuggerUrl: "ws://x/ctrl2", url: "http://localhost:17891/control/", title: "控制中心漂移" },
  { type: "page", webSocketDebuggerUrl: "ws://x/reader", url: "http://127.0.0.1:17890/reader/", title: "阅读器" },
  { type: "page", webSocketDebuggerUrl: "ws://x/api",   url: "http://localhost:17890/api/books", title: "api" },
  { type: "page", webSocketDebuggerUrl: "ws://x/devtools", url: "devtools://devtools/abc", title: "DevTools" },
  { type: "webview", webSocketDebuggerUrl: "ws://x/wv", url: "http://127.0.0.1:17890/reader/", title: "wv" }, // non-page
  { type: "page", url: "http://127.0.0.1:17890/reader/", title: "no wsUrl" }, // no webSocketDebuggerUrl
];

const filtered = cdp.filterTargets(targets);
const urls = filtered.map(t => t.url);

check("keeps ZCode main page (file://)", urls.includes("file:///C:/ZCode/index.html"));
check("excludes /control/ on 17890", !urls.includes("http://127.0.0.1:17890/control/"));
check("excludes /control/ on 17891 (port漂移)", !urls.includes("http://localhost:17891/control/"));
check("excludes /reader/", !urls.includes("http://127.0.0.1:17890/reader/"));
check("excludes /api/", !urls.includes("http://localhost:17890/api/books"));
check("excludes devtools://", !urls.includes("devtools://devtools/abc"));
check("excludes non-page (webview)", !filtered.some(t => t.type === "webview"));
check("excludes target without webSocketDebuggerUrl", !filtered.some(t => !t.webSocketDebuggerUrl));
check("exactly 1 target remains (the ZCode main page)", filtered.length === 1);

// === classifyWallpaperDom (pure) — returns {mode, videoMuted} ===
check("classify: video present -> video", cdp.classifyWallpaperDom({ style: true, video: true, videoSrc: "file://x", bg: "url(x)", videoMuted: true }).mode === "video");
check("classify: video present -> videoMuted passthrough", cdp.classifyWallpaperDom({ style: true, video: true, videoSrc: "file://x", bg: "url(x)", videoMuted: true }).videoMuted === true);
check("classify: video present -> videoMuted false passthrough", cdp.classifyWallpaperDom({ style: true, video: true, videoSrc: "file://x", bg: "url(x)", videoMuted: false }).videoMuted === false);
check("classify: style + bg not none -> image", cdp.classifyWallpaperDom({ style: true, video: false, videoSrc: "", bg: "url(x)", videoMuted: null }).mode === "image");
check("classify: image -> videoMuted null", cdp.classifyWallpaperDom({ style: true, video: false, videoSrc: "", bg: "url(x)", videoMuted: null }).videoMuted === null);
check("classify: no style -> none", cdp.classifyWallpaperDom({ style: false, video: false, videoSrc: "", bg: "none", videoMuted: null }).mode === "none");
check("classify: style but bg none -> none", cdp.classifyWallpaperDom({ style: true, video: false, videoSrc: "", bg: "none", videoMuted: null }).mode === "none");
check("classify: video but no src -> none", cdp.classifyWallpaperDom({ style: false, video: true, videoSrc: "", bg: "none", videoMuted: true }).mode === "none");
check("classify: video but no src -> videoMuted null", cdp.classifyWallpaperDom({ style: false, video: true, videoSrc: "", bg: "none", videoMuted: true }).videoMuted === null);
check("classify: video with src -> video", cdp.classifyWallpaperDom({ style: false, video: true, videoSrc: "file://x", bg: "none", videoMuted: false }).mode === "video");

// === listTargets via mock /json server ===
const http = require("http");
(async () => {
  // mock CDP /json returning the same targets
  const mock = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(targets));
  });
  await new Promise(r => mock.listen(0, "127.0.0.1", r));
  const mport = mock.address().port;
  // point cdp at the mock via env, reload module fresh
  process.env.ZCODE_DEBUG_PORT = String(mport);
  delete require.cache[require.resolve("../lib/cdp.cjs")];
  const cdpMocked = require("../lib/cdp.cjs");
  try {
    const pages = await cdpMocked.listTargets();
    check("listTargets returns filtered pages (1)", pages.length === 1);
    check("listTargets page is the ZCode main", pages[0].url === "file:///C:/ZCode/index.html");
  } catch (e) {
    check("listTargets runs without throwing", false);
    console.error(e);
  } finally {
    mock.close();
    delete process.env.ZCODE_DEBUG_PORT;
  }
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
})();
