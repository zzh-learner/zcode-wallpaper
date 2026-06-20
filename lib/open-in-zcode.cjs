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

// Build the IIFE expression that fills the address bar + submits the form.
// Two gotchas discovered by probing (教训 11: probe what it listens to):
//   1. React tracks input value via its own tracker; assigning .value directly
//      won't fire onChange -> use the native input value setter + input event.
//   2. The address bar is a <form>; synthesizing keydown/keyup Enter does NOT
//      trigger navigation (React form ignores synthetic keys). The reliable way
//      is form.requestSubmit() (form.submit() bypasses handlers). Verified.
function buildFillExpr(url) {
  return "(function(){"
    + "var inp=document.querySelector('input[data-testid=\"browser-address-input\"]');"
    + "if(!inp){return 'no-address-input';}"
    + "var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;"
    + "setter.call(inp," + JSON.stringify(url) + ");"
    + "inp.dispatchEvent(new Event('input',{bubbles:true}));"
    + "var form=inp.closest('form');"
    + "if(form){ if(form.requestSubmit){form.requestSubmit();} else {form.submit();} return 'submitted'; }"
    + "return 'no-form';"
    + "})()";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// If the browser panel isn't open, click "展开侧边面板" and wait for React to
// mount the address input. NOTE (重要边界): this only opens the BROWSER panel
// when ZCode's git working-tree is CLEAN. If the tree has unstaged changes,
// ZCode defaults the sidebar to the REVIEW panel instead, and the expand button
// opens review (no address-input appears) -> we give up gracefully. This is an
// accepted limitation; the user pastes the URL manually in that case.
async function tryOpenPanel(call) {
  const has = await call("Runtime.evaluate", {
    expression: "!!document.querySelector('input[data-testid=\"browser-address-input\"]')",
    returnByValue: true,
  }).then((r) => r.result && r.result.value);
  if (has) return true;
  // click the expand button
  const clicked = await call("Runtime.evaluate", {
    expression: "(function(){var b=document.querySelectorAll('button[aria-label]');for(var i=0;i<b.length;i++){var al=b[i].getAttribute('aria-label')||'';if(al.indexOf('展开侧边面板')!==-1){b[i].click();return true;}}return false;})()",
    returnByValue: true,
  }).then((r) => r.result && r.result.value);
  if (!clicked) return false;
  // wait for address-input to mount (React lazy render after panel animates)
  for (let i = 0; i < 15; i++) {
    await sleep(200);
    const ok = await call("Runtime.evaluate", {
      expression: "!!document.querySelector('input[data-testid=\"browser-address-input\"]')",
      returnByValue: true,
    }).then((r) => r.result && r.result.value);
    if (ok) return true;
  }
  return false;
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
    const opened = await tryOpenPanel(call);
    if (!opened) {
      console.log("[open] 没打开浏览器面板（侧边栏可能停在审查面板：working tree 有未提交修改时 ZCode 默认开审查）。");
      console.log("[open] 请手动打开浏览器面板后粘 URL: " + TARGET_URL);
      return;
    }
    const r = await call("Runtime.evaluate", { expression: buildFillExpr(TARGET_URL), returnByValue: true });
    const v = r.result && r.result.value;
    if (v === "submitted") {
      console.log("[open] 已在 ZCode 浏览器面板地址栏填入并提交: " + TARGET_URL);
      console.log("[open] 控制中心应已在浏览器面板打开。");
    } else if (v === "no-address-input") {
      console.log("[open] 面板开了但没找到地址栏，请手动粘 URL: " + TARGET_URL);
    } else if (v === "no-form") {
      console.log("[open] 地址栏不在 form 里，无法提交，请手动粘 URL: " + TARGET_URL);
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
