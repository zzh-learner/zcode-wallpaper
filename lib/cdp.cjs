// Shared read-only CDP helpers. Extracted from inject.cjs so both inject.cjs
// (action) and status.cjs (query) reuse ONE copy of the CDP glue (spec §4 A2b,
// 审查 P1-1). Action logic stays in inject.cjs; this module only connects +
// queries.
//
// Port/host mirror inject.cjs defaults.
const http = require("http");
const { WebSocket } = require("ws");

const PORT = parseInt(process.env.ZCODE_DEBUG_PORT || "9222", 10);
const HOST = process.env.ZCODE_DEBUG_HOST || "127.0.0.1";

// Pure function: filter /json targets to "real" ZCode pages (spec §5.4).
// Excludes our OWN tool pages by PATH PREFIX on any localhost/127.0.0.1 port
// (审查 P1-target过滤端口: don't depend on knowing our own port — standalone
// inject.cjs and port-drift both still filter correctly).
// Excludes: /control/, /reader/, /api/ paths; devtools://; non-page; no wsUrl.
function filterTargets(targets) {
  return targets.filter((t) => {
    if (t.type !== "page") return false;
    if (!t.webSocketDebuggerUrl) return false;
    const url = t.url || "";
    if (url.indexOf("devtools://") === 0) return false;
    // localhost or 127.0.0.1, any port, then check path prefix
    const m = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.exec(url);
    if (m) {
      const path = m[3] || "/";
      if (path.indexOf("/control/") === 0 || path.indexOf("/reader/") === 0 || path.indexOf("/api/") === 0) {
        return false;
      }
    }
    return true;
  });
}

module.exports = { filterTargets, listTargets, listAllTargets, httpGetJson, connect, fixWsHost, classifyWallpaperDom, probeWallpaperMode, PORT, HOST };

// ---- wallpaper mode probing (spec §5.2 mode 判定, 复用 inject.cjs verifyExpression 思路) ----

// IDs mirror inject.cjs STYLE_ID / VIDEO_EL_ID (kept in sync manually; inject.cjs
// owns the canonical names, cdp.cjs reads them via probe).
const PROBE_STYLE_ID = "zcode-user-wallpaper";
const PROBE_VIDEO_EL_ID = "zcode-user-wallpaper-video";

// Pure: classify wallpaper mode from a DOM probe result.
// dom = { style: bool, video: bool, videoSrc: string, bg: string, videoMuted: bool|null }
// video takes priority (a <video> element means video mode regardless of style).
// Returns { mode: "video"|"image"|"none", videoMuted: boolean|null }.
// videoMuted is the DOM-truth (dom.videoMuted) when in video mode, null
// otherwise (no video = mute state meaningless). Single source of truth =
// the DOM property; we never mirror it in server memory (防漂移, 教训 1).
function classifyWallpaperDom(dom) {
  if (dom.video && dom.videoSrc) return { mode: "video", videoMuted: dom.videoMuted };
  if (dom.style && dom.bg && dom.bg !== "none") return { mode: "image", videoMuted: null };
  return { mode: "none", videoMuted: null };
}

// Probe one page target's wallpaper state. Returns {mode, videoMuted}.
// Throws on CDP/connect failure (caller catches -> treat as "none"/unknown).
async function probeWallpaperMode(target) {
  const { ws, call } = await connect(target.webSocketDebuggerUrl);
  try {
    const r = await call("Runtime.evaluate", {
      expression: "(function(){var s=document.getElementById(" + JSON.stringify(PROBE_STYLE_ID) +
        ");var v=document.getElementById(" + JSON.stringify(PROBE_VIDEO_EL_ID) +
        ");return JSON.stringify({style:!!s,video:!!v,videoSrc:v?v.getAttribute('src'):'',videoMuted:v?v.muted:null,bg:getComputedStyle(document.body).backgroundImage});})()",
      returnByValue: true,
    });
    const dom = JSON.parse(r.result.value);
    return classifyWallpaperDom(dom);
  } finally {
    try { ws.close(); } catch (e) {}
  }
}

// ---- implementations (migrated verbatim from inject.cjs, 审查 P1-1) ----

function httpGetJson(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: HOST, port: PORT, path: urlPath, headers: { Host: "localhost" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (!data) return reject(new Error("empty response"));
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error("bad JSON: " + data.slice(0, 120))); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(4000, () => req.destroy(new Error("timeout")));
  });
}

// listTargets returns FILTERED page targets (spec §5.4 — exclude our own tool
// pages so status/inject don't pollute counts or inject into themselves).
async function listTargets() {
  const targets = await httpGetJson("/json");
  return filterTargets(targets);
}

// listAllTargets returns ALL page targets (unfiltered). Kept for any future
// caller that genuinely needs the raw list; current plan does not call it
// (spec §5.4: remove also goes through filtered listTargets).
async function listAllTargets() {
  const targets = await httpGetJson("/json");
  return targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

// Chromium returns ws://localhost/... with no explicit port; rewrite to the
// real host:port. On some machines localhost does not resolve to 127.0.0.1
// (IPv6-only, proxy, hosts file), and ws://host/path defaults to port 80.
function fixWsHost(wsUrl) {
  return wsUrl
    .replace(/^ws:\/\/localhost\//i, "ws://127.0.0.1:" + PORT + "/")
    .replace(/^wss:\/\/localhost\//i, "wss://127.0.0.1:" + PORT + "/")
    .replace(/^ws:\/\/localhost(?=[:/])/i, "ws://127.0.0.1")
    .replace(/^wss:\/\/localhost(?=[:/])/i, "wss://127.0.0.1");
}

let _callId = 0;
// connect opens a CDP WebSocket and returns { ws, call } where call(method,
// params) -> Promise<result>. Mirrors inject.cjs's original connect.
function connect(wsUrl) {
  wsUrl = fixWsHost(wsUrl);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: no } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? no(new Error("CDP: " + JSON.stringify(msg.error))) : ok(msg.result);
      }
    });
    const call = (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++_callId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params: params || {} }), (err) => err && reject(err));
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject(new Error("CDP timeout: " + method)); }
        }, 8000);
      });
    ws.on("open", () => resolve({ ws, call }));
    ws.on("error", reject);
  });
}

if (require.main === module) {
  // quick self-check when run directly
  console.log("cdp.cjs loaded. PORT=" + PORT + " HOST=" + HOST);
}
