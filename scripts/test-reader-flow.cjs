// Verify reader flow end-to-end via CDP: click the book, check TOC + chapter render.
// This validates the "章节导航" 命门 without needing user to manually click.
const http = require("http");
const { WebSocket } = require("ws");
let _callId = 0;
function httpGetJson(p){return new Promise((resolve,reject)=>{http.get({host:"127.0.0.1",port:9222,path:p,headers:{Host:"localhost"}},(res)=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>{try{resolve(JSON.parse(d));}catch(e){reject(e);}});}).on("error",reject);});}
function connect(wsUrl){
  wsUrl = wsUrl.replace(/^ws:\/\/localhost(\/|$)/, "ws://127.0.0.1:9222$1");
  return new Promise((resolve,reject)=>{const ws=new WebSocket(wsUrl);const pending=new Map();ws.on("message",(raw)=>{const m=JSON.parse(raw.toString());if(m.id&&pending.has(m.id)){const{resolve:ok,reject:no}=pending.get(m.id);pending.delete(m.id);m.error?no(new Error("CDP: "+JSON.stringify(m.error))):ok(m.result);}});const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++_callId;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}),(e)=>e&&reject(e));setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error("timeout"));}},8000);});ws.on("open",()=>resolve({ws,call}));ws.on("error",reject);});}
async function ev(call, expr, opts){
  const r=await call("Runtime.evaluate",Object.assign({expression:expr,returnByValue:true},opts||{}));
  if(r.exceptionDetails){return "EXCEPTION: "+JSON.stringify(r.exceptionDetails).slice(0,400);}
  return r.result&&r.result.value!==undefined?r.result.value:JSON.stringify(r.result);
}

(async()=>{
  const targets=await httpGetJson("/json");
  const wv=targets.find(t=>t.type==="webview");
  if(!wv){console.error("no webview target");process.exit(1);}
  const {ws,call}=await connect(wv.webSocketDebuggerUrl);

  console.log("=== A. 点击书架里的凡人修仙传 ===");
  console.log(await ev(call, "(function(){var item=document.querySelector('#shelf-list .shelf-item'); if(!item) return 'no shelf item'; item.click(); return 'clicked: '+item.textContent;})()"));

  // wait for async openBook
  await new Promise(r=>setTimeout(r,1500));

  console.log("\n=== B. 目录是否加载 (应含 12 卷) ===");
  console.log(await ev(call, "(function(){var vols=document.querySelectorAll('#toc-list .vol');var chaps=document.querySelectorAll('#toc-list .chap');return '卷数='+vols.length+' 章数='+chaps.length+' 首卷='+((vols[0]||{}).textContent||'').slice(0,30);})()"));

  console.log("\n=== C. 正文是否渲染 (应含第一章标题) ===");
  console.log(await ev(call, "(function(){var h=document.querySelector('#chapter-content h2');var ps=document.querySelectorAll('#chapter-content p');return '标题='+(h?h.textContent:'无')+' 段落数='+ps.length;})()"));

  console.log("\n=== D. 顶栏书名+章名 ===");
  console.log(await ev(call, "document.getElementById('book-name').textContent + ' | ' + document.getElementById('chap-name').textContent"));

  console.log("\n=== E. 测翻章:点下一章按钮 ===");
  console.log(await ev(call, "(function(){var b=document.getElementById('next-chap'); if(b.disabled) return 'next disabled'; b.click(); return 'clicked next';})()"));
  await new Promise(r=>setTimeout(r,1000));
  console.log(await ev(call, "document.getElementById('chap-name').textContent"));

  ws.close();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
