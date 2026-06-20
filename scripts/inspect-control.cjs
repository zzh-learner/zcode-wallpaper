// End-to-end probe for control center (spec §7.2 E1/E2/E7). One-shot, reads
// state then exits (教训 14: 设完即退、可回读). Run with control-server up +
// ZCode running:
//   node scripts/inspect-control.cjs
// Verifies:
//   E2/E7 — /api/status shape + pageTargets excludes tool pages
//   E1    — control-center webview body computed bg is transparent
const http = require("http");
const { WebSocket } = require("ws");
const CC_PORT = parseInt(process.env.CC_PORT || "17890", 10);
const CDP_PORT = parseInt(process.env.ZCODE_DEBUG_PORT || "9222", 10);

function httpGetJson(p, host, port) {
  return new Promise((resolve, reject) => {
    http.get({ host: host, port: port, path: p }, (r) => {
      let d = ""; r.on("data", (c) => (d += c));
      r.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

(async () => {
  // E2/E7: /api/status — verify tool pages NOT counted
  console.log("=== E2/E7: /api/status (control-server :" + CC_PORT + ") ===");
  try {
    const st = await httpGetJson("/api/status", "127.0.0.1", CC_PORT);
    console.log("  zcode      =", JSON.stringify(st.zcode));
    console.log("  wallpaper  =", JSON.stringify(st.wallpaper));
    console.log("  transparent=", JSON.stringify(st.transparent));
    console.log("  reader     =", JSON.stringify(st.reader));
    console.log("  resources  =", JSON.stringify(st.resources));
    console.log("  probeErrors=", JSON.stringify(st._meta && st._meta.probeErrors));
    if (st.zcode) {
      console.log("  [E7] pageTargets =", st.zcode.pageTargets, "(must NOT include /control/ or /reader/)");
    }
  } catch (e) {
    console.log("  FAIL: control-server not running on :" + CC_PORT + " (" + e.message + ")");
  }

  // E1: connect the control-center webview target, check body bg transparent
  console.log("\n=== E1: control-center webview body background (CDP :" + CDP_PORT + ") ===");
  try {
    const targets = await httpGetJson("/json", "127.0.0.1", CDP_PORT);
    const wv = targets.find((t) => t.type === "webview" && (t.url || "").indexOf("/control") !== -1);
    if (!wv) {
      console.log("  (no control-center webview target open — open http://127.0.0.1:" + CC_PORT + "/control/ in ZCode browser panel first)");
    } else {
      const wsUrl = wv.webSocketDebuggerUrl.replace(/^ws:\/\/localhost(\/)/, "ws://127.0.0.1:" + CDP_PORT + "$1");
      const ws = new WebSocket(wsUrl);
      let id = 0; const pend = new Map();
      ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
      await new Promise((r, e) => { ws.on("open", r); ws.on("error", e); });
      const call = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: method, params: params || {} })); });
      const r = await call("Runtime.evaluate", { expression: "getComputedStyle(document.body).backgroundColor", returnByValue: true });
      console.log("  control body bg =", r.result && r.result.value);
      console.log("  [E1] transparent => rgba(0, 0, 0, 0)  (wallpaper shows through)");
      ws.close();
    }
  } catch (e) {
    console.log("  FAIL:", e.message);
  }
})();
