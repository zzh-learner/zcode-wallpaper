// Inspect: what's actually controlling the background? Read computed styles
// on body + the main framework elements, and check for stray wallpaper layers.

const http = require("http");
const { WebSocket } = require("ws");

const PORT = parseInt(process.env.ZCODE_DEBUG_PORT || "9222", 10);
const HOST = process.env.ZCODE_DEBUG_HOST || "127.0.0.1";
let _callId = 0;

function httpGetJson(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path: p, headers: { Host: "localhost" } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}
function fixWsHost(u) { return u.replace(/^ws:\/\/localhost(\/)/i, `ws://127.0.0.1:${PORT}$1`); }
function connect(wsUrl) {
  wsUrl = fixWsHost(wsUrl);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pending.has(m.id)) {
        const { resolve: ok, reject: no } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? no(new Error("CDP: " + JSON.stringify(m.error))) : ok(m.result);
      }
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++_callId; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }), (e) => e && reject(e));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout")); } }, 8000);
    });
    ws.on("open", () => resolve({ ws, call }));
    ws.on("error", reject);
  });
}

const expr = `(function(){
  function dump(el){
    if(!el) return 'NULL';
    var cs=getComputedStyle(el);
    return {
      tag: el.tagName + (el.className ? '.'+String(el.className).slice(0,60) : ''),
      bgImage: cs.backgroundImage,
      bgColor: cs.backgroundColor,
      bgVars: {
        '--color-background': cs.getPropertyValue('--color-background'),
        '--color-background-win-alt': cs.getPropertyValue('--color-background-win-alt')
      },
      opacity: cs.opacity,
      zIndex: cs.zIndex
    };
  }
  // The likely framework divs
  var root = document.documentElement;
  var body = document.body;
  // find elements with background-image set to something non-none
  var all = document.querySelectorAll('div, aside, main, section');
  var withBg = [];
  for (var i=0;i<all.length && i<200;i++){
    var cs = getComputedStyle(all[i]);
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && cs.backgroundImage.indexOf('file://') !== -1){
      withBg.push({ tag: all[i].tagName + '.' + String(all[i].className).slice(0,40), bg: cs.backgroundImage.slice(0,80), zIndex: cs.zIndex });
    }
  }
  return JSON.stringify({
    htmlEl: dump(root),
    body: dump(body),
    elementsWithWallpaperBg: withBg.slice(0, 10),
    injectedStylePresent: !!document.getElementById('zcode-user-wallpaper')
  }, null, 2);
})()`;

(async () => {
  const targets = (await httpGetJson("/json")).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const { ws, call } = await connect(targets[0].webSocketDebuggerUrl);
  const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true });
  ws.close();
  console.log(r.result.value);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
