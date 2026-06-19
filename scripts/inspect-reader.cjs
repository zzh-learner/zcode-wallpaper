// Diagnose reader webview: why is the shelf empty even though API returns data?
// Connects to the webview CDP target, checks DOM state + globals + fetch result.
const http = require("http");
const { WebSocket } = require("ws");
let _callId = 0;
function httpGetJson(p){return new Promise((resolve,reject)=>{http.get({host:"127.0.0.1",port:9222,path:p,headers:{Host:"localhost"}},(res)=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>{try{resolve(JSON.parse(d));}catch(e){reject(e);}});}).on("error",reject);});}
function connect(wsUrl){
  // CDP returns ws://localhost/devtools/... (port 80) — rewrite to the real debug port.
  wsUrl = wsUrl.replace(/^ws:\/\/localhost(\/|$)/, "ws://127.0.0.1:9222$1");
  return new Promise((resolve,reject)=>{const ws=new WebSocket(wsUrl);const pending=new Map();ws.on("message",(raw)=>{const m=JSON.parse(raw.toString());if(m.id&&pending.has(m.id)){const{resolve:ok,reject:no}=pending.get(m.id);pending.delete(m.id);m.error?no(new Error("CDP: "+JSON.stringify(m.error))):ok(m.result);}});const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++_callId;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}),(e)=>e&&reject(e));setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error("timeout"));}},8000);});ws.on("open",()=>resolve({ws,call}));ws.on("error",reject);});}

(async()=>{
  const targets=await httpGetJson("/json");
  const wv=targets.find(t=>t.type==="webview");
  if(!wv){console.error("no webview target");process.exit(1);}
  console.log("connecting to:",wv.webSocketDebuggerUrl);
  const {ws,call}=await connect(wv.webSocketDebuggerUrl);

  async function ev(expr, opts){
    const r=await call("Runtime.evaluate",Object.assign({expression:expr,returnByValue:true},opts||{}));
    if(r.exceptionDetails){return "EXCEPTION: "+JSON.stringify(r.exceptionDetails).slice(0,300);}
    return r.result&&r.result.value!==undefined?JSON.stringify(r.result.value):JSON.stringify(r.result);
  }

  console.log("=== 1. globals ===");
  console.log(await ev("JSON.stringify({codec:typeof window.__readerCodec, toc:typeof window.__readerToc, prog:typeof window.__readerProgress, book:typeof window.__readerBook, href:location.href})"));

  console.log("=== 2. shelf DOM ===");
  console.log(await ev("document.getElementById('shelf-list').innerHTML.slice(0,300)"));

  console.log("=== 3. err banner ===");
  console.log(await ev("document.getElementById('err-banner').className + ' | ' + document.getElementById('err-banner').textContent"));

  console.log("=== 4. fetch from webview ===");
  console.log(await ev("(async()=>{try{const r=await fetch('/api/books');return 'status='+r.status+' body='+await r.text();}catch(e){return 'ERR:'+e.message;}})()", {awaitPromise:true}));

  ws.close();
})().catch(e=>{console.error("FAIL:",e.message,e.stack);process.exit(1);});
