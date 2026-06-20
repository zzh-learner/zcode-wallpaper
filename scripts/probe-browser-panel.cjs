// Probe: how does ZCode open its browser panel? Is there a URL bar / API we
// can drive via CDP to auto-navigate to /control/? Read-only.
// Connects to the ZCode PAGE target, inspects the browser-panel DOM + globals.
const http = require("http");
const { WebSocket } = require("ws");
let _id = 0;
function getJson(p){return new Promise((res,rej)=>{http.get({host:"127.0.0.1",port:9222,path:p},(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{res(JSON.parse(d));}catch(e){rej(e);}});}).on("error",rej);});}
function connect(wsUrl){wsUrl=wsUrl.replace(/^ws:\/\/localhost(\/|$)/,"ws://127.0.0.1:9222$1");return new Promise((res,rej)=>{const ws=new WebSocket(wsUrl);const pend=new Map();ws.on("message",(raw)=>{const m=JSON.parse(raw.toString());if(m.id&&pend.has(m.id)){const f=pend.get(m.id);pend.delete(m.id);m.error?f.rej(new Error(JSON.stringify(m.error))):f.res(m.result);}});const call=(method,params={})=>new Promise((r2,e2)=>{const i=++_id;pend.set(i,{res:r2,rej:e2});ws.send(JSON.stringify({id:i,method,params}),e=>e&&e2(e));setTimeout(()=>{if(pend.has(i)){pend.delete(i);e2(new Error("timeout"));}},8000);});ws.on("open",()=>res({ws,call}));ws.on("error",rej);});}

(async()=>{
  const targets=await getJson("/json");
  const page=targets.find(t=>t.type==="page"&&t.webSocketDebuggerUrl);
  if(!page){console.error("no page target");process.exit(1);}
  const {ws,call}=await connect(page.webSocketDebuggerUrl);
  const ev=(expr)=>call("Runtime.evaluate",{expression:expr,returnByValue:true}).then(r=>r.result&&r.result.value).catch(e=>"ERR:"+e.message);

  console.log("=== 1. browser panel container + URL bar ===");
  console.log(await ev(`(function(){
    var el=document.querySelector('[data-testid="browser-webview"]')||document.getElementById('browser');
    if(!el) return 'no browser-webview element found';
    var r=el.getBoundingClientRect();
    var info={tag:el.tagName, id:el.id, testid:el.getAttribute('data-testid'), visible: r.width>0&&r.height>0, w:Math.round(r.width), h:Math.round(r.height)};
    // is there an existing webview child?
    var wv=el.querySelector('webview');
    info.hasWebviewChild=!!wv;
    if(wv){info.webviewSrc=(wv.getAttribute('src')||'').slice(0,60);}
    return JSON.stringify(info);
  })()`));

  console.log("\n=== 2. URL input bar (for browser panel) ===");
  console.log(await ev(`(function(){
    var inputs=document.querySelectorAll('input');
    var urlLike=[];
    inputs.forEach(function(i){ var ph=i.placeholder||'', ti=i.title||'', type=i.type||''; if(/url|地址|网址|http/i.test(ph+ti) || (type==='text' && ph)) urlLike.push({placeholder:ph.slice(0,30), type:type, testid:i.getAttribute('data-testid')||''}); });
    return JSON.stringify(urlLike.slice(0,5));
  })()`));

  console.log("\n=== 3. how is the panel opened? look for a 'browser'/'open browser' trigger ===");
  console.log(await ev(`(function(){
    var cands=[];
    document.querySelectorAll('[data-testid],[aria-label],[title]').forEach(function(e){
      var t=(e.getAttribute('data-testid')||'')+' '+(e.getAttribute('aria-label')||'')+' '+(e.getAttribute('title')||'');
      if(/browser|浏览|面板|panel/i.test(t)) cands.push({tag:e.tagName.toLowerCase(), testid:e.getAttribute('data-testid'), label:(e.getAttribute('aria-label')||e.getAttribute('title')||'').slice(0,30)});
    });
    return JSON.stringify(cands.slice(0,10));
  })()`));

  ws.close();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
