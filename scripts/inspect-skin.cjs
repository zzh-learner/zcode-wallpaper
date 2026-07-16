// Inspect ZCode's real DOM selectors for the skin system.
// Probe: sidebar, main content area, input/composer, primary buttons, cards/panels,
// and the theme class hooks (.theme-zai-dark/light) we already know from wallpaper.css.
// Output: dump computed bg/border/radius/font for each candidate so we can write
// accurate selectors in lib/skin-selectors.cjs (lesson 21: don't guess, probe).

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

// Probe expression: walk candidate selectors, return computed style + sample count.
const PROBE = `(() => {
  const out = {};
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false, count: document.querySelectorAll(sel).length };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      found: true, count: document.querySelectorAll(sel).length,
      tag: el.tagName, id: el.id || null,
      classes: el.className && el.className.toString().split(/\\s+/).slice(0, 8),
      bg: cs.backgroundColor, color: cs.color,
      borderColor: cs.borderColor, borderRadius: cs.borderRadius,
      fontFamily: cs.fontFamily.slice(0, 40),
      rect: Math.round(r.width) + "x" + Math.round(r.height),
      dataset: Object.keys(el.dataset || {}).slice(0, 5)
    };
  };
  // Candidate selectors to probe (from wallpaper.css + common patterns)
  const cands = {
    "body": "body",
    "html theme attr": "html.theme-zai-dark, html.theme-zai-light",
    ".theme-zai-dark root": ".theme-zai-dark",
    ".bg-background": ".bg-background",
    ".bg-background-alt": ".bg-background-alt",
    ".bg-surface": ".bg-surface",
    ".bg-input": ".bg-input",
    "aside/sidebar": "aside, [class*='sidebar'], [class*='side-bar'], nav[class*='shell']",
    "main surface": "main, [class*='main-surface'], [role='main']",
    "composer/input": "[class*='composer'], [class*='chat-input'], textarea, [contenteditable='true']",
    "primary button": "button[class*='primary'], button[class*='bg-token-foreground'], button[type='submit']",
    "card/panel": "[class*='card'], [class*='panel'], [class*='message']",
    "header": "header, [class*='app-header']"
  };
  for (const [label, sel] of Object.entries(cands)) {
    try { out[label] = pick(sel); } catch (e) { out[label] = { error: e.message }; }
  }
  // Also: dump the actual class names on the biggest visible elements (top 15 by area)
  const all = Array.from(document.body.querySelectorAll("*"));
  const sized = all.map(el => ({ el, area: el.getBoundingClientRect().width * el.getBoundingClientRect().height }))
    .filter(x => x.area > 20000)
    .sort((a, b) => b.area - a.area)
    .slice(0, 15);
  out["__topElementsByArea"] = sized.map(x => {
    const cs = getComputedStyle(x.el);
    return {
      tag: x.el.tagName,
      classes: (x.el.className && x.el.className.toString().split(/\\s+/).slice(0, 6)) || [],
      bg: cs.backgroundColor === "rgba(0, 0, 0, 0)" ? "(transparent)" : cs.backgroundColor,
      area: Math.round(x.area)
    };
  });
  return JSON.stringify(out, null, 2);
})()`;

(async () => {
  let targets;
  try {
    targets = await httpGetJson("/json/list");
  } catch (e) { console.error("无法连 9222: " + e.message); process.exit(1); }
  const pages = targets.filter(t => t.type === "page" && /^(https?|file|app):/.test(t.url || "") && !/devtools/.test(t.url || ""));
  if (!pages.length) { console.error("没有 page target"); process.exit(1); }
  // pick the biggest/main page (skip webviews of our own tools)
  const main = pages.find(t => !/127\.0\.0\.1|localhost/.test(t.url || "")) || pages[0];
  console.log("# probing target: " + (main.title || "").slice(0, 40) + "  " + (main.url || "").slice(0, 60));
  const { ws, call } = await connect(main.webSocketDebuggerUrl);
  try {
    const r = await call("Runtime.evaluate", { expression: PROBE, returnByValue: true });
    console.log(r.result.value);
  } finally { try { ws.close(); } catch (e) {} }
})().catch(e => { console.error(e.message); process.exit(1); });
