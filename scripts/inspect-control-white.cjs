// One-off probe: why does the control page render on a white background?
// Dumps (1) all CDP targets, (2) control page computed backgrounds + loaded
// styles, (3) main page wallpaper injection state and
// the webview ancestor chain (what actually sits behind the control page).
const http = require("http");
const { WebSocket } = require("ws");
const PORT = parseInt(process.env.ZCODE_DEBUG_PORT || "9222", 10);
const HOST = "127.0.0.1";
let _callId = 0;

function httpGetJson(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path: p, headers: { Host: "localhost" } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}
function fixWsHost(u) {
  return u
    .replace(/^ws:\/\/localhost\//i, `ws://127.0.0.1:${PORT}/`)
    .replace(/^ws:\/\/localhost(?=[:/])/i, "ws://127.0.0.1");
}
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
async function ev(call, expr) {
  const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.exceptionDetails) return "EXCEPTION: " + JSON.stringify(r.exceptionDetails).slice(0, 400);
  return r.result && r.result.value !== undefined ? r.result.value : JSON.stringify(r.result);
}

const controlExpr = `(function(){
  function bg(el){
    if(!el) return null;
    var cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0,60), color: cs.color };
  }
  var styleIds = [];
  document.querySelectorAll('style[id]').forEach(function(s){ styleIds.push(s.id); });
  return JSON.stringify({
    href: location.href,
    html: bg(document.documentElement),
    body: bg(document.body),
    panel: bg(document.querySelector('.panel')),
    styleIds: styleIds,
    sheetHrefs: Array.from(document.styleSheets).map(function(s){ return s.href ? s.href.split('/').pop() : '(inline)'; }),
  }, null, 2);
})()`;

const mainPageExpr = `(function(){
  function desc(el){
    if(!el) return null;
    var cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase() + (el.id ? '#'+el.id : ''),
      bgColor: cs.backgroundColor,
      bgImage: cs.backgroundImage.slice(0,70)
    };
  }
  var wp = document.getElementById('zcode-user-wallpaper');
  var video = document.getElementById('zcode-user-wallpaper-video');
  var wv = document.querySelector('webview, [data-testid="browser-webview"]');
  var chain = [];
  var node = wv, n = 0;
  while(node && n < 8){ chain.push(desc(node)); node = node.parentElement; n++; }
  return JSON.stringify({
    wallpaperStyle: wp ? { cssRules: (wp.textContent||'').length } : null,
    videoEl: video ? { src: (video.getAttribute('src')||'').slice(0,60), muted: video.muted } : null,
    body: desc(document.body),
    main: desc(document.querySelector('main, [role=\"main\"]')),
    sidebar: desc(document.querySelector('#sidebar')),
    webviewFound: !!wv,
    webviewAncestors: chain
  }, null, 2);
})()`;

(async () => {
  const targets = await httpGetJson("/json");
  console.log("=== TARGETS ===");
  targets.forEach((t) => console.log(`  [${t.type}] ${t.url.slice(0, 90)}`));

  const control = targets.find((t) => t.webSocketDebuggerUrl && /\/control\//.test(t.url));
  if (control) {
    console.log("\n=== CONTROL PAGE (" + control.type + ") ===");
    const c = await connect(control.webSocketDebuggerUrl);
    console.log(await ev(c.call, controlExpr));
    c.ws.close();
  } else {
    console.log("\n(control page NOT among CDP targets — likely opened in an external browser)");
  }

  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (page) {
    console.log("\n=== MAIN PAGE: wallpaper state + webview ancestors ===");
    const c = await connect(page.webSocketDebuggerUrl);
    console.log(await ev(c.call, mainPageExpr));
    c.ws.close();
  }
  process.exit(0);
})().catch((e) => { console.error("PROBE FAILED:", e.message); process.exit(1); });
