// Auto-open the control center in ZCode's browser panel (start.bat Step 4).
// Drives ZCode's address bar via CDP: finds input[data-testid="browser-address-
// input"], fills the URL, dispatches Enter (React-compatible native setter trick).
//
// Why this and not navigating the webview target directly: the address input is
// ZCode's own UI; typing into it is what a user would do, and it handles
// panel-open/navigation the same way. If the panel isn't open, this is a no-op
// (harmless) and the user pastes manually (start.bat already put URL in clipboard).
//
// Best-effort, non-fatal: any failure prints a hint and exits 0 (start.bat
// should not abort just because auto-open didn't work).
const http = require("http");
const { WebSocket } = require("ws");
const PORT = parseInt(process.env.ZCODE_DEBUG_PORT || "9222", 10);
const CC_PORT = parseInt(process.env.CC_PORT || "17890", 10);
const TARGET_URL = "http://127.0.0.1:" + CC_PORT + "/control/";

let _id = 0;
function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: p }, (r) => {
      let d = ""; r.on("data", c => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}
function connect(wsUrl) {
  wsUrl = wsUrl.replace(/^ws:\/\/localhost(\/|$)/, "ws://127.0.0.1:" + PORT + "$1");
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    const pend = new Map();
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { const f = pend.get(m.id); pend.delete(m.id); m.error ? f.rej(new Error(JSON.stringify(m.error))) : f.res(m.result); }
    });
    const call = (method, params) => new Promise((r2, e2) => {
      const i = ++_id; pend.set(i, { res: r2, rej: e2 });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }), e => e && e2(e));
      setTimeout(() => { if (pend.has(i)) { pend.delete(i); e2(new Error("timeout")); } }, 8000);
    });
    ws.on("open", () => res({ ws, call }));
    ws.on("error", rej);
  });
}

// Build the IIFE expression that fills the address bar + submits Enter.
// React tracks input value via its own tracker; assigning .value directly won't
// fire onChange. Use the native input value setter, then dispatch input event.
function buildFillExpr(url) {
  return "(function(){"
    + "var inp=document.querySelector('input[data-testid=\"browser-address-input\"]');"
    + "if(!inp){return 'no-address-input';}"
    + "var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;"
    + "setter.call(inp," + JSON.stringify(url) + ");"
    + "inp.dispatchEvent(new Event('input',{bubbles:true}));"
    + "inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));"
    + "return 'submitted';"
    + "})()";
}

async function main() {
  let targets;
  try { targets = await getJson("/json"); }
  catch (e) { console.log("[open] CDP 不可达，跳过自动打开（请手动粘 URL）。"); return; }
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) { console.log("[open] 没找到 ZCode 主页面 target，跳过自动打开。"); return; }

  let ws, call;
  try { ({ ws, call } = await connect(page.webSocketDebuggerUrl)); }
  catch (e) { console.log("[open] 连接 CDP 失败，跳过自动打开: " + e.message); return; }

  try {
    const r = await call("Runtime.evaluate", { expression: buildFillExpr(TARGET_URL), returnByValue: true });
    const v = r.result && r.result.value;
    if (v === "submitted") {
      console.log("[open] 已在 ZCode 浏览器面板地址栏填入并提交: " + TARGET_URL);
      console.log("[open] 如果面板没自动打开，请手动打开面板后粘 URL。");
    } else if (v === "no-address-input") {
      console.log("[open] 没找到浏览器面板地址栏（面板可能没开），请手动打开面板后粘 URL。");
    } else {
      console.log("[open] 自动打开结果未知: " + JSON.stringify(v) + "，请手动粘 URL。");
    }
  } catch (e) {
    console.log("[open] 自动打开出错（不影响启动）: " + e.message + "，请手动粘 URL。");
  } finally {
    try { ws.close(); } catch (e) {}
  }
}
main().catch(() => process.exit(0)); // never fail start.bat
