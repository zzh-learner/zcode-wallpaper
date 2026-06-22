// One-off probe: why does target="_blank" do nothing in ZCode webview?
// Goal (AGENTS.md 教训 21: "应该能 X"是假设，探测真实 state 是事实):
//   1. Check <webview> element attributes (allowpopups? webpreferences?)
//   2. Connect to the webview's own CDP target, inject a test script — can we
//      run JS inside the external site loaded in the webview?
//   3. Inspect a sample target="_blank" link on the current page (if any) to
//      see how it's wired.
//   4. Try CDP Page.setWindowOpenOverride / Page.windowOpen — does the protocol
//      give us a hook to intercept _blank navigation?
//
// Connects to MAIN page target (find <webview> attrs) + each webview target.

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
    const events = [];
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pending.has(m.id)) {
        const { resolve: ok, reject: no } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? no(new Error("CDP: " + JSON.stringify(m.error))) : ok(m.result);
      } else if (m.method) {
        events.push(m);
      }
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++_callId; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }), (e) => e && reject(e));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout")); } }, 8000);
    });
    ws.on("open", () => resolve({ ws, call, events }));
    ws.on("error", reject);
  });
}
async function ev(call, expr) {
  const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) return "EXCEPTION: " + JSON.stringify(r.exceptionDetails).slice(0, 500);
  return r.result && r.result.value !== undefined ? r.result.value : JSON.stringify(r.result);
}

// Probe MAIN page: find <webview> element, dump ALL its attributes.
const webviewAttrsExpr = `(function(){
  var wv = document.querySelector('webview, [data-testid="browser-webview"]');
  if(!wv) return JSON.stringify({found:false});
  var attrs = {};
  for(var i=0;i<wv.attributes.length;i++){
    var a = wv.attributes[i];
    attrs[a.name] = a.value;
  }
  return JSON.stringify({found:true, tag:wv.tagName.toLowerCase(), attrs:attrs}, null, 2);
})()`;

// Probe a webview page: can we run JS? list any target=_blank links on the page.
const blankProbeExpr = `(function(){
  var blanks = Array.prototype.slice.call(document.querySelectorAll('a[target="_blank"], a[target=\\'_blank\\']')).slice(0,5);
  return JSON.stringify({
    href: location.href,
    canRun: typeof window.__zzProbe === "undefined" ? "yes-first-time" : "already-injected",
    blankCount: blanks.length,
    samples: blanks.map(function(a){ return {href:a.href, target:a.target, onclick: a.onclick ? "has-handler" : "none"}; })
  }, null, 2);
})()`;

(async () => {
  const targets = await httpGetJson("/json");
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const webviews = targets.filter((t) => t.type === "webview" && t.webSocketDebuggerUrl);
  if (!page) { console.error("no page target"); process.exit(1); }

  console.log("=== (1) MAIN PAGE: <webview> element attributes ===");
  const c1 = await connect(page.webSocketDebuggerUrl);
  console.log(await ev(c1.call, webviewAttrsExpr));
  c1.ws.close();

  for (const wv of webviews) {
    console.log("\n=== webview target: " + (wv.url || "").slice(0, 70) + " ===");
    try {
      const c = await connect(wv.webSocketDebuggerUrl);
      console.log("(2) JS injection + blank-link probe:");
      console.log(await ev(c.call, blankProbeExpr));

      // (3) Enable Page domain, see what events exist. Set up a window-open interceptor
      // via CDP and listen briefly. (Just declare intent; real test needs user click.)
      await c.call("Page.enable");
      await c.call("Runtime.enable");
      // Inject a beforeunload-style hook that logs window.open calls + click capture
      const hookExpr = `(function(){
        if(window.__zzHooked) return "already-hooked";
        window.__zzHooked = true;
        window.__zzOpens = [];
        var origOpen = window.open;
        window.open = function(){ window.__zzOpens.push({type:'window.open', args: Array.prototype.slice.call(arguments).slice(0,2)}); return null; };
        document.addEventListener('click', function(e){
          var a = e.target.closest && e.target.closest('a[target="_blank"]');
          if(a){ window.__zzOpens.push({type:'click_blank', href:a.href, ts:Date.now()}); }
        }, true);
        return "hooked-ok";
      })()`;
      console.log("(3) install hook:", await ev(c.call, hookExpr));
      c.ws.close();
    } catch (e) {
      console.log("(could not connect to webview target:", e.message, ")");
    }
  }
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
