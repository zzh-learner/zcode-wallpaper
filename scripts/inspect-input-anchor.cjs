// Inspect: nail down a UNIQUE selector for the chat input's solid-color ancestor.
// Strategy: from the contenteditable chat input, walk up; find the FIRST ancestor
// with a non-transparent computed background. Dump its full opening tag + test
// candidate selectors for uniqueness (教训 5/21: read real DOM, don't guess).
//
// Usage: node scripts/inspect-input-anchor.cjs

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
  function insideBrowser(el){
    var cur = el;
    while(cur){
      if(cur.id === 'browser') return true;
      if(cur.getAttribute && cur.getAttribute('data-testid') === 'browser-webview') return true;
      cur = cur.parentElement;
    }
    return false;
  }
  // Find the chat contenteditable (exclude browser panel URL bar).
  var ces = document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
  var input = null;
  for(var i=0;i<ces.length;i++){ if(!insideBrowser(ces[i])) { input = ces[i]; break; } }
  if(!input) return JSON.stringify({error:'no chat contenteditable found'});

  // Walk up to find first ancestor with solid (non-transparent) background.
  var solidAncestor = null;
  var cur = input.parentElement;
  var depth = 0;
  while(cur && cur !== document.documentElement && depth < 25){
    var bg = getComputedStyle(cur).backgroundColor;
    // match rgb(...) with no alpha channel, or rgba(..., a) where a > 0
    var m = bg.match(/rgba?\\(([^)]+)\\)/);
    var isSolid = false;
    if(m){
      var parts = m[1].split(',').map(function(s){return s.trim();});
      if(parts.length === 3) isSolid = true;
      else if(parts.length === 4 && parseFloat(parts[3]) > 0.01) isSolid = true;
    }
    if(isSolid){ solidAncestor = cur; break; }
    cur = cur.parentElement; depth++;
  }
  if(!solidAncestor) return JSON.stringify({error:'no solid ancestor found within 25 levels', inputBrief: input.outerHTML.slice(0,120)});

  // Dump full opening tag (attributes intact) so we can read data-testid / aria / etc.
  var tagHtml = solidAncestor.outerHTML;
  var openTag = tagHtml.slice(0, tagHtml.indexOf('>')+1);

  // Grab the computed bg + class list verbatim.
  var cs = getComputedStyle(solidAncestor);
  var cls = (solidAncestor.getAttribute && solidAncestor.getAttribute('class')) || '';

  // Also dump the input's immediate parent chain classes (to build a descendant selector).
  var chain = [];
  var c = input;
  for(var k=0;k<4 && c;k++){ chain.push((c.getAttribute&&c.getAttribute('class'))||c.tagName.toLowerCase()); c=c.parentElement; }

  // Test candidate selectors for uniqueness.
  // Goal: a CSS rule that hits the solid ancestor (or a tight path to it) and NOTHING else.
  function count(sel){
    try { return document.querySelectorAll(sel).length; } catch(e){ return 'INVALID:'+e.message; }
  }
  // Build some candidate anchors from class tokens.
  var classTokens = cls.split(/\\s+/).filter(function(t){return t.length>0;});
  // Pick tokens likely to be stable (not hash-like, not pure utility we'd over-match).
  // We'll just test each single-class selector for uniqueness on its own.
  var tokenCounts = {};
  classTokens.forEach(function(t){ tokenCounts['.'+t] = count('.'+t); });

  return JSON.stringify({
    inputOpenTag: input.outerHTML.slice(0, input.outerHTML.indexOf('>')+1),
    chainClassesTopDown: chain,
    solidAncestor: {
      openTag: openTag,
      className: cls,
      backgroundColor: cs.backgroundColor,
      depth: depth
    },
    classTokenCounts: tokenCounts,
    candidates: {
      // a structural path: the @container/composer is a stable hook
      '@container/composer descendant div with gap-3 + overflow-hidden': count('[class*="@container/composer"] div.gap-3.overflow-hidden'),
      'div with overflow-hidden + gap-3 under form': count('form div.overflow-hidden.gap-3'),
      'just div.overflow-hidden.gap-3': count('div.overflow-hidden.gap-3')
    }
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
