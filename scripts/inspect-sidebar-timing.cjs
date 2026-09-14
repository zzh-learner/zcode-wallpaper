// Probe 3: after clicking the browser card, what becomes visible and when?
// Also list all open-tab card labels. Read-only + one card click (feature effect).
const http = require("http");
const { WebSocket } = require("ws");
let _id = 0;
function getJson(p){return new Promise((res,rej)=>{http.get({host:"127.0.0.1",port:9222,path:p},(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{res(JSON.parse(d));}catch(e){rej(e);}});}).on("error",rej);});}
function connect(wsUrl){wsUrl=wsUrl.replace(/^ws:\/\/localhost(\/|$)/,"ws://127.0.0.1:9222$1");return new Promise((res,rej)=>{const ws=new WebSocket(wsUrl);const pend=new Map();ws.on("message",(raw)=>{const m=JSON.parse(raw.toString());if(m.id&&pend.has(m.id)){const f=pend.get(m.id);pend.delete(m.id);m.error?f.rej(new Error(JSON.stringify(m.error))):f.res(m.result);}});const call=(method,params={})=>new Promise((r2,e2)=>{const i=++_id;pend.set(i,{res:r2,rej:e2});ws.send(JSON.stringify({id:i,method,params}),e=>e&&e2(e));setTimeout(()=>{if(pend.has(i)){pend.delete(i);e2(new Error("timeout"));}},8000);});ws.on("open",()=>res({ws,call}));ws.on("error",rej);});}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const targets=await getJson("/json");
  const page=targets.find(t=>t.type==="page"&&/app\.asar\/out\/renderer\/index\.html/.test(t.url));
  const {ws,call}=await connect(page.webSocketDebuggerUrl);
  const ev=(expr)=>call("Runtime.evaluate",{expression:expr,returnByValue:true}).then(r=>r.result&&r.result.value).catch(e=>"ERR:"+e.message);

  const state=()=>ev(`(function(){
    var wvs=[].slice.call(document.querySelectorAll('webview'));
    var vis=wvs.map(function(w){var r=w.getBoundingClientRect();return {src:(w.getAttribute('src')||'').slice(0,60),vis:r.width>0&&r.height>0};});
    return JSON.stringify({
      emptyState:document.body.innerText.indexOf('打开标签页')>=0,
      nWebviews:wvs.length, webviews:vis.slice(0,6)
    });
  })()`);

  console.log("t=0 current state:",await state());
  console.log("cards:",await ev(`JSON.stringify([].slice.call(document.querySelectorAll('button.side-pane-open-tab-button')).map(function(b){return b.textContent.trim();}))`));

  console.log("\n--- click 浏览器 card ---");
  await ev(`(function(){
    var btns=[].slice.call(document.querySelectorAll('button.side-pane-open-tab-button'));
    var t=btns.find(function(b){return (b.textContent||'').indexOf('浏览器')>=0;});
    if(t) t.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    return 'ok';
  })()`);
  for(const ms of [500,1000,2000,4000]){
    await sleep(ms===500?500:ms-(ms===1000?500:ms===2000?1000:2000));
    console.log("t+"+ms+"ms:",await state());
  }

  // does the webview element expose loadURL? (Electron webview API, main-world check)
  console.log("\nloadURL available:",await ev(`(function(){
    var w=document.querySelector('webview');
    if(!w) return 'no webview el';
    return JSON.stringify({loadURL:typeof w.loadURL, src:typeof w.src, stop:typeof w.stop});
  })()`));

  ws.close();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
