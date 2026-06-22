// Inspect: does the chat input box reveal the wallpaper?
// Read computed background on the input box itself + its ancestor chain.
// This is the ONLY way to answer "透不透" — never guess from CSS常识.
// (AGENTS.md 教训 5/21: "应该能透"是假设，读真实 state 是事实。)
//
// Usage: node scripts/inspect-input.cjs

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
  function brief(el){
    if(!el) return null;
    var tag = el.tagName.toLowerCase();
    var cls = (el.className && el.className.toString) ? String(el.className).slice(0,50) : '';
    var id = el.id ? '#'+el.id : '';
    return tag + id + (cls ? '.'+cls.replace(/\\s+/g,'.').slice(0,40) : '');
  }
  function dumpBg(el){
    if(!el) return null;
    var cs = getComputedStyle(el);
    return {
      el: brief(el),
      backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage,
      background: cs.background,        // shorthand; may say 'rgb(...)' or 'rgba(...)'
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
      boxShadow: cs.boxShadow,
      color: cs.color
    };
  }
  // Walk up from a given element, dumping every ancestor until body.
  function chain(el){
    var out = []; var cur = el; var n = 0;
    while(cur && cur !== document.documentElement && n < 20){
      out.push(dumpBg(cur));
      cur = cur.parentElement; n++;
    }
    return out;
  }

  // Find the chat input. Try several shapes ZCode might use.
  // CRITICAL: the browser panel (#browser) also has an <input> (the URL bar).
  // We must EXCLUDE anything inside #browser / [data-testid="browser-webview"],
  // otherwise we grab the wrong input (教训 5: read real DOM, don't assume).
  function insideBrowser(el){
    var cur = el;
    while(cur){
      if(cur.id === 'browser') return true;
      if(cur.getAttribute && cur.getAttribute('data-testid') === 'browser-webview') return true;
      cur = cur.parentElement;
    }
    return false;
  }
  var cands = [];
  var tas = document.querySelectorAll('textarea');
  for(var i=0;i<tas.length;i++){ if(!insideBrowser(tas[i])) cands.push({kind:'textarea', el:tas[i]}); }
  var ces = document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
  for(var j=0;j<ces.length;j++){ if(!insideBrowser(ces[j])) cands.push({kind:'contenteditable', el:ces[j]}); }
  var inps = document.querySelectorAll('input[type="text"], input:not([type])');
  for(var k=0;k<inps.length;k++){ if(!insideBrowser(inps[k])) cands.push({kind:'input', el:inps[k]}); }

  if(!cands.length) return JSON.stringify({error:'no input element found (excluded browser panel)', tried:['textarea','contenteditable','input']}, null, 2);

  // Heuristic: the chat composer is usually a textarea with a placeholder,
  // or a contenteditable at the bottom of the page. Rank: textarea > contenteditable > input.
  function rank(c){
    var ph = (c.el.placeholder || c.el.getAttribute('placeholder') || '') + '';
    var score = 0;
    if(c.kind==='textarea') score += 3;
    if(c.kind==='contenteditable') score += 2;
    if(/问|消息|输入|发送|message|ask|prompt|聊聊|说点什么|Send a message|Shift/i.test(ph)) score += 5;
    // visible + has size
    var r = c.el.getBoundingClientRect();
    if(r.width > 100 && r.height > 20) score += 2;
    return score;
  }
  cands.sort(function(a,b){ return rank(b)-rank(a); });

  // If multiple candidates, surface them all so we can eyeball which is the chat box.
  var ranked = cands.map(function(c){
    var r = c.el.getBoundingClientRect();
    return { kind:c.kind, placeholder:(c.el.placeholder||c.el.getAttribute('placeholder')||'').slice(0,40), brief:brief(c.el), w:Math.round(r.width), h:Math.round(r.height), score:rank(c) };
  });

  var pick = cands[0];
  var rect = pick.el.getBoundingClientRect();

  return JSON.stringify({
    found: { kind: pick.kind, placeholder: pick.el.placeholder || pick.el.getAttribute('placeholder') || '', brief: brief(pick.el) },
    rect: { x: rect.x, y: rect.y, w: Math.round(rect.width), h: Math.round(rect.height) },
    inputSelf: dumpBg(pick.el),
    ancestorChainToBody: chain(pick.el),
    bodyBg: dumpBg(document.body),
    wallpaperInjected: !!document.getElementById('zcode-user-wallpaper'),
    candidateCount: cands.length
  }, null, 2);
})()`;

(async () => {
  const targets = (await httpGetJson("/json")).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!targets.length) { console.error("No page target. Is ZCode running with --remote-debugging-port=9222?"); process.exit(1); }
  const { ws, call } = await connect(targets[0].webSocketDebuggerUrl);
  const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true });
  ws.close();
  console.log(r.result.value);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
