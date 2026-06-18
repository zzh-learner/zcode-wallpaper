// One-off: capture a PNG screenshot of the first ZCode page target via CDP
// (Page.captureScreenshot). Prints base64 -> writes screenshot.png.
// Usage:  node screenshot.cjs

const http = require("http");
const fs = require("fs");
const { WebSocket } = require("ws");

const PORT = parseInt(process.env.ZCODE_DEBUG_PORT || "9222", 10);
const HOST = process.env.ZCODE_DEBUG_HOST || "127.0.0.1";
let _callId = 0;

function httpGetJson(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: HOST, port: PORT, path: urlPath, headers: { Host: "localhost" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (!data) return reject(new Error("empty response"));
          try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("bad JSON")); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(4000, () => req.destroy(new Error("timeout")));
  });
}

function fixWsHost(wsUrl) {
  return wsUrl
    .replace(/^ws:\/\/localhost\//i, `ws://127.0.0.1:${PORT}/`)
    .replace(/^ws:\/\/localhost(?=[:/])/i, "ws://127.0.0.1");
}

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
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++_callId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }), (err) => err && reject(err));
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject(new Error("CDP timeout: " + method)); }
        }, 8000);
      });
    ws.on("open", () => resolve({ ws, call }));
    ws.on("error", reject);
  });
}

async function main() {
  const targets = (await httpGetJson("/json")).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (targets.length === 0) { console.error("no page targets"); process.exit(1); }
  console.log("[shot] target: " + (targets[0].title || "").slice(0, 40));
  const { ws, call } = await connect(targets[0].webSocketDebuggerUrl);
  await call("Page.enable");
  const res = await call("Page.captureScreenshot", { format: "png" });
  ws.close();
  const buf = Buffer.from(res.data, "base64");
  fs.writeFileSync("screenshot.png", buf);
  console.log("[shot] wrote screenshot.png (" + buf.length + " bytes)");
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
