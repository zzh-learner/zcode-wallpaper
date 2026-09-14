// E2E step 2: click the injected 控制中心 card -> expect the browser panel to
// open AND the address bar to submit http://127.0.0.1:17890/control/ so a
// webview target navigates there. Screenshot at the end for human eyes.
const http = require("http");
const fs = require("fs");
const { WebSocket } = require("ws");
let _id = 0;
function getJson(p){return new Promise((res,rej)=>{http.get({host:"127.0.0.1",port:9222,path:p},(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{res(JSON.parse(d));}catch(e){rej(e);}});}).on("error",rej);});}
function connect(wsUrl){wsUrl=wsUrl.replace(/^ws:\/\/localhost(\/|$)/,"ws://127.0.0.1:9222$1");return new Promise((res,rej)=>{const ws=new WebSocket(wsUrl);const pend=new Map();ws.on("message",(raw)=>{const m=JSON.parse(raw.toString());if(m.id&&pend.has(m.id)){const f=pend.get(m.id);pend.delete(m.id);m.error?f.rej(new Error(JSON.stringify(m.error))):f.res(m.result);}});const call=(method,params={})=>new Promise((r2,e2)=>{const i=++_id;pend.set(i,{res:r2,rej:e2});ws.send(JSON.stringify({id:i,method,params}),e=>e&&e2(e));setTimeout(()=>{if(pend.has(i)){pend.delete(i);e2(new Error("timeout"));}},8000);});ws.on("open",()=>res({ws,call}));ws.on("error",rej);});}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const before=await getJson("/json");
  const beforeCtrl=before.filter(t=>t.type==="webview"&&/\/control\//.test(t.url));
  console.log("control webviews before:",beforeCtrl.length);

  const page=before.find(t=>t.type==="page"&&/app\.asar\/out\/renderer\/index\.html/.test(t.url));
  const {ws,call}=await connect(page.webSocketDebuggerUrl);
  const ev=(expr)=>call("Runtime.evaluate",{expression:expr,returnByValue:true}).then(r=>r.result&&r.result.value).catch(e=>"ERR:"+e.message);

  console.log("=== click the 控制中心 card ===");
  console.log(await ev(`(function(){
    var card=document.querySelector('[data-zz-control-entry]');
    if(!card) return 'no card';
    var r=card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    return JSON.stringify({dispatched:true,visible:r.width>0,url:card.getAttribute('data-control-url')});
  })()`));

  console.log("=== wait for a /control/ webview target (up to 8s) ===");
  let found=null;
  for(let i=0;i<8;i++){
    await sleep(1000);
    const now=await getJson("/json");
    found=now.find(t=>t.type==="webview"&&/127\.0\.0\.1:17890\/control\//.test(t.url));
    const addr=await ev(`(function(){
      var inp=document.querySelector('input[data-testid=\"browser-address-input\"]');
      var wv=document.querySelector('webview');
      return JSON.stringify({addr:inp?inp.value:null,wvSrc:wv?(wv.getAttribute('src')||'').slice(0,80):null});
    })()`);
    console.log("t+"+(i+1)+"s:",addr,"| target:",found?found.url:"none");
    if(found) break;
  }

  console.log("\n=== address input value now ===");
  console.log(await ev(`(function(){
    var inp=document.querySelector('input[data-testid=\"browser-address-input\"]');
    return inp?inp.value:'(no input / panel closed)';
  })()`));

  // screenshot via the existing helper approach: Page.captureScreenshot
  const shot=await call("Page.captureScreenshot",{format:"png"});
  fs.writeFileSync("screenshot-entry.png",Buffer.from(shot.data,"base64"));
  console.log("[shot] wrote screenshot-entry.png");

  ws.close();
  process.exit(found?0:2);
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
