// Probe 2: (a) does a synthetic native click on the "浏览器" card open the
// browser panel? (b) does Page.navigate work on a webview target? Read-mostly;
// the click is the feature's intended effect (reversible: user can close panel).
const http = require("http");
const { WebSocket } = require("ws");
let _id = 0;
function getJson(p){return new Promise((res,rej)=>{http.get({host:"127.0.0.1",port:9222,path:p},(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{res(JSON.parse(d));}catch(e){rej(e);}});}).on("error",rej);});}
function connect(wsUrl){wsUrl=wsUrl.replace(/^ws:\/\/localhost(\/|$)/,"ws://127.0.0.1:9222$1");return new Promise((res,rej)=>{const ws=new WebSocket(wsUrl);const pend=new Map();ws.on("message",(raw)=>{const m=JSON.parse(raw.toString());if(m.id&&pend.has(m.id)){const f=pend.get(m.id);pend.delete(m.id);m.error?f.rej(new Error(JSON.stringify(m.error))):f.res(m.result);}});const call=(method,params={})=>new Promise((r2,e2)=>{const i=++_id;pend.set(i,{res:r2,rej:e2});ws.send(JSON.stringify({id:i,method,params}),e=>e&&e2(e));setTimeout(()=>{if(pend.has(i)){pend.delete(i);e2(new Error("timeout"));}},8000);});ws.on("open",()=>res({ws,call}));ws.on("error",rej);});}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const before=await getJson("/json");
  const beforeWv=new Set(before.filter(t=>t.type==="webview").map(t=>t.id));
  console.log("webview targets before:",[...beforeWv].length);

  const page=before.find(t=>t.type==="page"&&/app\.asar\/out\/renderer\/index\.html/.test(t.url));
  const {ws,call}=await connect(page.webSocketDebuggerUrl);
  const ev=(expr)=>call("Runtime.evaluate",{expression:expr,returnByValue:true}).then(r=>r.result&&r.result.value).catch(e=>"ERR:"+e.message);

  console.log("\n=== (a) synthetic click on 浏览器 card ===");
  console.log(await ev(`(function(){
    var btns=[].slice.call(document.querySelectorAll('button.side-pane-open-tab-button'));
    var target=btns.find(function(b){return (b.textContent||'').indexOf('浏览器')>=0;});
    if(!target) return JSON.stringify({found:false, n:btns.length});
    var r=target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    return JSON.stringify({found:true, n:btns.length, visible:r.width>0, dispatched:true});
  })()`));

  await sleep(2000);
  console.log(await ev(`(function(){
    var wv=document.querySelector('webview');
    var r=wv?wv.getBoundingClientRect():null;
    return JSON.stringify({
      hasOpenTabText:document.body.innerText.indexOf('打开标签页')>=0,
      webviewVisible:!!(r&&r.width>0&&r.height>0),
      webviewSrc:wv?(wv.getAttribute('src')||'').slice(0,80):null
    });
  })()`));

  const after=await getJson("/json");
  const afterWv=after.filter(t=>t.type==="webview");
  console.log("\nwebview targets after click:",afterWv.map(t=>({id:t.id.slice(0,8),url:t.url.slice(0,60)})));

  console.log("\n=== (b) Page.navigate on first webview target (to its own URL) ===");
  const wv=afterWv.find(t=>t.webSocketDebuggerUrl&&t.url.indexOf("127.0.0.1:17890")<0===false);
  const pick=afterWv.find(t=>/127\.0\.0\.1:17890\/reader\//.test(t.url));
  const tgt=pick||afterWv[0];
  if(!tgt){console.log("no webview target to test");ws.close();return;}
  const {ws:w2,call:c2}=await connect(tgt.webSocketDebuggerUrl);
  try{ await c2("Page.enable"); console.log("Page.enable ok"); }
  catch(e){ console.log("Page.enable ERR:",e.message); }
  try{
    const nav=await c2("Page.navigate",{url:tgt.url});
    console.log("Page.navigate result:",JSON.stringify(nav));
  }catch(e){ console.log("Page.navigate ERR:",e.message); }
  await sleep(2500);
  const final=await getJson("/json");
  const same=final.find(t=>t.id===tgt.id);
  console.log("target still present:",!!same,"url:",same?same.url.slice(0,70):null);
  w2.close(); ws.close();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
