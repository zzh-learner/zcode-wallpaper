// Test命门: does Page.addScriptToEvaluateOnNewDocument work on Electron webview
// CDP targets? If yes -> approach B (no空窗). If no -> approach A (polling).
//
// Method: connect to a webview target, register a script via addScriptToEvaluateOnNewDocument
// that sets window.__zzNewDoc = Date.now(). Then navigate the webview to a fresh URL via
// Page.navigate. Reload-style navigation is safest (same URL). Check if __zzNewDoc changed
// on the new document.

const http = require("http");
const { WebSocket } = require("ws");
const PORT = parseInt(process.env.ZCODE_DEBUG_PORT || "9222", 10);
const HOST = "127.0.0.1";
let _callId = 0;
function httpGetJson(p){return new Promise((res,rej)=>{http.get({host:HOST,port:PORT,path:p,headers:{Host:"localhost"}},(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on("error",rej)})}
function fixWsHost(u){return u.replace(/^ws:\/\/localhost\//i,`ws://127.0.0.1:${PORT}/`).replace(/^ws:\/\/localhost(?=[:/])/i,"ws://127.0.0.1")}
function connect(wsUrl){wsUrl=fixWsHost(wsUrl);return new Promise((res,rej)=>{const ws=new WebSocket(wsUrl);const pending=new Map();ws.on("message",raw=>{const m=JSON.parse(raw.toString());if(m.id&&pending.has(m.id)){const{resolve:ok,reject:no}=pending.get(m.id);pending.delete(m.id);m.error?no(new Error("CDP:"+JSON.stringify(m.error))):ok(m.result)}});const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++_callId;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}),e=>e&&reject(e));setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error("timeout"))}},8000)});ws.on("open",()=>res({ws,call}));ws.on("error",rej)})}

(async () => {
  const targets = await httpGetJson("/json");
  const wv = targets.find(t => t.type === "webview" && (t.url || "").indexOf("open.bigmodel") >= 0);
  if (!wv) { console.error("no open.bigmodel webview target. Open it first."); process.exit(1); }
  console.log("Target:", (wv.url || "").slice(0, 60));

  const c = await connect(wv.webSocketDebuggerUrl);
  await c.call("Page.enable");
  await c.call("Runtime.enable");

  // Read current marker (should be undefined before we register anything)
  const before = await c.call("Runtime.evaluate", { expression: "window.__zzNewDocMark || 'none'", returnByValue: true });
  console.log("before register:", before.result.value);

  // Register a script to run on every new document
  const marker = "ZZ_" + Date.now();
  let regErr = null;
  try {
    const r = await c.call("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.__zzNewDocMark = '" + marker + "';"
    });
    console.log("register ok, identifier:", JSON.stringify(r.identifier || r).slice(0, 60));
  } catch (e) { regErr = e.message; console.log("register FAILED:", regErr); }

  if (!regErr) {
    // Navigate (reload the same URL — cleanest way to test new-doc injection)
    console.log("navigating (reload)...");
    try {
      await c.call("Page.navigate", { url: wv.url });
    } catch (e) { console.log("navigate err:", e.message); }

    // Wait for new doc to settle
    await new Promise(r => setTimeout(r, 4000));

    const after = await c.call("Runtime.evaluate", { expression: "window.__zzNewDocMark || 'none'", returnByValue: true });
    console.log("after navigate:", after.result.value);
    if (after.result.value === marker) {
      console.log("\n>>> addScriptToEvaluateOnNewDocument WORKS on webview target. Approach B is viable.");
    } else {
      console.log("\n>>> marker NOT applied on new doc. Approach B does NOT work here -> fall back to A (polling).");
    }
  }
  c.ws.close();
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
