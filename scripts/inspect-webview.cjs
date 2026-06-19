// One-off probe: how does the wallpaper show through the reader webview?
// Dumps the <webview> element's computed style + ancestor chain, and checks
// whether the reader page (inside webview) has its own opaque background.
//
// Connects to the ZCode PAGE target (not the webview's own CDP target), finds
// the webview element, walks its ancestors, and reports backgrounds/opacities.
// Then (if a webview CDP target exists) connects to it and dumps the reader
// page's body/#topbar/#reader/#main computed backgrounds.

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

// Probe the MAIN page: find the webview element + walk its ancestors.
const mainPageExpr = `(function(){
  function desc(el){
    if(!el) return null;
    var cs = getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase() + (el.id ? '#'+el.id : '') + (el.className ? '.'+String(el.className).slice(0,50) : ''),
      bgImage: cs.backgroundImage.slice(0,70),
      bgColor: cs.backgroundColor,
      opacity: cs.opacity,
      zIndex: cs.zIndex,
      rect: Math.round(rect.width)+'x'+Math.round(rect.height)
    };
  }
  var wv = document.querySelector('webview, [data-testid="browser-webview"]');
  if(!wv){
    // list candidates that might be the browser panel container
    var cands = [];
    document.querySelectorAll('[data-testid]').forEach(function(e){
      var t = e.getAttribute('data-testid')||'';
      if(/browser|webview|embed/i.test(t)) cands.push(e.tagName.toLowerCase()+'[data-testid="'+t+'"]');
    });
    return JSON.stringify({ webviewFound:false, browserCandidates: cands.slice(0,10) }, null, 2);
  }
  var chain = [];
  var node = wv, n = 0;
  while(node && n < 8){ chain.push(desc(node)); node = node.parentElement; n++; }
  return JSON.stringify({ webviewFound:true, tag: wv.tagName.toLowerCase(), attr: {
    src: (wv.getAttribute('src')||'').slice(0,60),
    partition: wv.getAttribute('partition'),
    'data-testid': wv.getAttribute('data-testid')
  }, ancestorChain: chain }, null, 2);
})()`;

// Probe the READER page (inside webview): body + key elements backgrounds.
const readerPageExpr = `(function(){
  function pick(sel){
    var el = document.querySelector(sel);
    if(!el) return sel+': NOT FOUND';
    var cs = getComputedStyle(el);
    return sel+' => bg:'+cs.backgroundColor+' img:'+cs.backgroundImage.slice(0,40)+' opacity:'+cs.opacity;
  }
  return JSON.stringify({
    href: location.href,
    body: pick('body'),
    topbar: pick('#topbar'),
    main: pick('#main'),
    reader: pick('#reader'),
    sidebar: pick('#sidebar')
  }, null, 2);
})()`;

(async () => {
  const targets = await httpGetJson("/json");
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const wv = targets.find((t) => t.type === "webview" && t.webSocketDebuggerUrl);
  if (!page) { console.error("no page target"); process.exit(1); }

  console.log("=== MAIN PAGE: webview element + ancestors ===");
  const c1 = await connect(page.webSocketDebuggerUrl);
  console.log(await ev(c1.call, mainPageExpr));
  c1.ws.close();

  if (wv) {
    console.log("\n=== WEBVIEW target type:", wv.type, "===");
    console.log("webview url:", (wv.url || "").slice(0, 70));
    console.log("webview title:", wv.title);
    try {
      const c2 = await connect(wv.webSocketDebuggerUrl);
      console.log("\n=== READER page (inside webview): backgrounds ===");
      console.log(await ev(c2.call, readerPageExpr));
      c2.ws.close();
    } catch (e) {
      console.log("(could not connect to webview target:", e.message, ")");
    }
  } else {
    console.log("\n(no webview target found in /json — reader not open in webview?)");
  }
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
