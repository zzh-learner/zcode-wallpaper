// Inspect ZCode skin targets v2: focus on sidebar, composer, primary button, message cards.
// Dump first-match class lists so we can write precise selectors.

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
    ws.on("message", (raw) => { const m = JSON.parse(raw.toString());
      if (m.id && pending.has(m.id)) { const { resolve: ok, reject: no } = pending.get(m.id); pending.delete(m.id);
        m.error ? no(new Error("CDP: " + JSON.stringify(m.error))) : ok(m.result); } });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++_callId; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }), (e) => e && reject(e));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout")); } }, 8000); });
    ws.on("open", () => resolve({ ws, call })); ws.on("error", reject);
  });
}

const PROBE = `(() => {
  const dump = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName, id: el.id || null,
      classes: (el.className && el.className.toString().split(/\\s+/)) || [],
      dataset: Object.keys(el.dataset || {}),
      bg: cs.backgroundColor, color: cs.color,
      borderColor: cs.borderColor, borderRadius: cs.borderRadius,
      rect: Math.round(r.width) + "x" + Math.round(r.height),
      testid: el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('role'))
    };
  };
  const out = {};
  // Sidebar: look for the left nav rail/panel. Try multiple heuristics.
  out.aside = dump(document.querySelector('aside'));
  out.asideShellLeft = dump(document.querySelector('[class*="shell-left"], [class*="sidebar"], [class*="activity"], nav'));
  // Composer / chat input
  out.composerClass = dump(document.querySelector('[class*="composer"], [class*="chat-input"], [class*="message-input"]'));
  out.textarea = dump(document.querySelector('textarea'));
  out.contentEditable = dump(document.querySelector('[contenteditable="true"]'));
  out.bgInput = dump(document.querySelector('.bg-input'));
  // Primary / send button
  out.sendBtn = dump(document.querySelector('button[type="submit"], button[aria-label*="发送"], button[aria-label*="Send"], button[class*="send"]'));
  out.primaryBtn = dump(document.querySelector('button.bg-primary, button[class*="primary"]'));
  // Message bubbles / cards
  out.messageClass = dump(document.querySelector('[class*="message"], [data-message], [class*="bubble"], [class*="turn"]'));
  // Top bar
  out.header = dump(document.querySelector('header, [class*="app-header"], [class*="titlebar"], [class*="top-bar"]'));
  // CSS variables on root (the real color tokens ZCode uses)
  const root = document.documentElement;
  const cssVars = {};
  // dump all custom properties starting with --color or -- on html
  try {
    const sheets = document.styleSheets;
    for (const s of sheets) {
      try {
        for (const rule of s.cssRules) {
          if (rule.style) {
            for (let i = 0; i < rule.style.length; i++) {
              const prop = rule.style[i];
              if (prop && prop.indexOf('--') === 0 && (prop.indexOf('color') >= 0 || prop.indexOf('background') >= 0 || prop.indexOf('border') >= 0)) {
                const val = rule.style.getPropertyValue(prop);
                if (val && !cssVars[prop]) cssVars[prop] = val.trim().slice(0, 30);
              }
            }
          }
        }
      } catch (e) {} // cross-origin sheets
    }
  } catch (e) {}
  out.cssVars = cssVars;
  // computed theme var values on html
  out.themeVars = {
    '--color-background': getComputedStyle(root).getPropertyValue('--color-background'),
    '--color-background-alt': getComputedStyle(root).getPropertyValue('--color-background-alt'),
    '--color-foreground': getComputedStyle(root).getPropertyValue('--color-foreground'),
    '--color-primary': getComputedStyle(root).getPropertyValue('--color-primary'),
    '--color-input': getComputedStyle(root).getPropertyValue('--color-input'),
    '--color-border': getComputedStyle(root).getPropertyValue('--color-border')
  };
  return JSON.stringify(out, null, 2);
})()`;

(async () => {
  const targets = await httpGetJson("/json/list");
  const pages = targets.filter(t => t.type === "page" && /^(https?|file|app):/.test(t.url || "") && !/devtools/.test(t.url || ""));
  const main = pages.find(t => !/127\.0\.0\.1|localhost/.test(t.url || "")) || pages[0];
  console.log("# " + (main.url || "").slice(0, 70));
  const { ws, call } = await connect(main.webSocketDebuggerUrl);
  try { const r = await call("Runtime.evaluate", { expression: PROBE, returnByValue: true }); console.log(r.result.value); }
  finally { try { ws.close(); } catch (e) {} }
})().catch(e => { console.error(e.message); process.exit(1); });
