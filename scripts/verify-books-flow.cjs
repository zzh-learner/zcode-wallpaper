// End-to-end verify multiple books via CDP: for each book filename, click it
// in the shelf, check TOC volume/chapter count + first chapter content renders
// + next-chapter nav works. No user interaction needed.
// Run: node scripts/verify-books-flow.cjs
const http = require("http");
const { WebSocket } = require("ws");
let _callId = 0;
function httpGetJson(p){return new Promise((resolve,reject)=>{http.get({host:"127.0.0.1",port:9222,path:p,headers:{Host:"localhost"}},(res)=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>{try{resolve(JSON.parse(d));}catch(e){reject(e);}});}).on("error",reject);});}
function connect(wsUrl){
  wsUrl = wsUrl.replace(/^ws:\/\/localhost(\/|$)/, "ws://127.0.0.1:9222$1");
  return new Promise((resolve,reject)=>{const ws=new WebSocket(wsUrl);const pending=new Map();ws.on("message",(raw)=>{const m=JSON.parse(raw.toString());if(m.id&&pending.has(m.id)){const{resolve:ok,reject:no}=pending.get(m.id);pending.delete(m.id);m.error?no(new Error("CDP: "+JSON.stringify(m.error))):ok(m.result);}});const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++_callId;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}),(e)=>e&&reject(e));setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error("timeout"));}},10000);});ws.on("open",()=>resolve({ws,call}));ws.on("error",reject);});}
async function ev(call, expr, opts){
  const r=await call("Runtime.evaluate",Object.assign({expression:expr,returnByValue:true},opts||{}));
  if(r.exceptionDetails){return "EXCEPTION: "+JSON.stringify(r.exceptionDetails).slice(0,300);}
  return r.result&&r.result.value!==undefined?r.result.value:JSON.stringify(r.result);
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

(async()=>{
  const targets=await httpGetJson("/json");
  const wv=targets.find(t=>t.type==="webview");
  if(!wv){console.error("no webview target");process.exit(1);}
  const {ws,call}=await connect(wv.webSocketDebuggerUrl);

  const books = ["068.天擎.txt", "073.惟我独仙【公众号：密知圈】.txt", "081.纨绔才子.txt", "013.回到明朝当王爷.txt", "005.斗破苍穹【公众号：密知圈】.txt"];

  for (const bookName of books) {
    console.log("\n========== " + bookName + " ==========");
    // 1. open sidebar, find the shelf item by filename, click it
    await ev(call, "document.getElementById('sidebar').classList.remove('collapsed')");
    await sleep(200);
    const clicked = await ev(call, "(function(){var items=document.querySelectorAll('#shelf-list .shelf-item');for(var i=0;i<items.length;i++){if(items[i].textContent.indexOf('"+bookName.slice(0,8)+"')!==-1){items[i].click();return 'clicked';}}return 'NOT FOUND in shelf';})()");
    console.log("open: " + clicked);
    if (clicked !== "clicked") continue;
    await sleep(2500); // wait for async openBook + renderToc + showChapter

    // 2. book name + chapter name in topbar
    console.log("topbar: " + await ev(call, "document.getElementById('book-name').textContent + ' | ' + document.getElementById('chap-name').textContent"));

    // 3. TOC: volume count + chapter count + first volume title
    console.log("toc: " + await ev(call, "(function(){var v=document.querySelectorAll('#toc-list .vol');var c=document.querySelectorAll('#toc-list .chap');return '卷='+v.length+' 章='+c.length+' 首卷='+((v[0]||{}).textContent||'(无)').slice(0,20);})()"));

    // 4. chapter content: title + paragraph count + first paragraph snippet
    console.log("content: " + await ev(call, "(function(){var h=document.querySelector('#chapter-content h2');var p=document.querySelectorAll('#chapter-content p');var first=p[0]?p[0].textContent.slice(0,30):'';return '标题='+(h?h.textContent.slice(0,25):'无')+' 段落='+p.length+' 首段='+JSON.stringify(first);})()"));

    // 5. err banner
    const errHidden = await ev(call, "document.getElementById('err-banner').classList.contains('hidden')");
    console.log("err-banner hidden: " + errHidden);

    // 6. next chapter nav
    const nextRes = await ev(call, "(function(){var b=document.getElementById('next-chap');if(b.disabled)return 'next disabled (last chapter)';b.click();return 'clicked next';})()");
    await sleep(800);
    console.log("next: " + nextRes + " -> " + await ev(call, "document.getElementById('chap-name').textContent"));
  }

  ws.close();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
