// Reproduce the user's exact failing flow:
// close side pane entirely -> reopen -> wait for our card -> click it ->
// record a 300ms-resolution timeline of the navigation attempt.
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
  const clickTestid=(testid)=>ev(`(function(){var b=document.querySelector('[data-testid="${testid}"]');if(!b)return 'not found';b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return 'clicked';})()`);

  const state=()=>ev(`(function(){
    var inp=document.querySelector('input[data-testid=\"browser-address-input\"]');
    var ir=inp?inp.getBoundingClientRect():null;
    var wvs=[].slice.call(document.querySelectorAll('webview')).map(function(w){var r=w.getBoundingClientRect();return {src:(w.getAttribute('src')||'').slice(0,45),w:Math.round(r.width)};});
    var card=document.querySelector('[data-zz-control-entry]');
    return JSON.stringify({inp:inp?{vis:ir.width>0,val:inp.value.slice(0,40)}:null,wvs:wvs,card:!!card,empty:document.body.innerText.indexOf('打开标签页')>=0});
  })()`);

  console.log("t=0:", await state());

  console.log("close side pane:", await clickTestid("side-pane-toggle"));
  await sleep(1200);
  console.log("t+1.2s (pane closed):", await state());
  console.log("reopen side pane:", await clickTestid("side-pane-toggle"));

  // wait for our card to appear (install loop 1.5s cadence)
  let cardReady=false;
  for(let i=0;i<10;i++){
    await sleep(500);
    const st=JSON.parse(await state());
    if(st.card&&st.empty){cardReady=true;console.log("t+"+(1.2+(i+1)*0.5).toFixed(1)+"s card ready:",JSON.stringify(st));break;}
  }
  if(!cardReady){console.log("CARD NEVER APPEARED — install loop problem");ws.close();process.exit(2);}

  console.log("\n--- CLICK 控制中心 card ---");
  console.log(await ev(`(function(){var c=document.querySelector('[data-zz-control-entry]');if(!c)return 'no card';c.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return 'clicked';})()`));

  for(let i=0;i<20;i++){
    await sleep(300);
    const st=await state();
    console.log("click+"+((i+1)*0.3).toFixed(1)+"s:", st);
    const p=JSON.parse(st);
    if(p.wvs.some(w=>w.src.indexOf("/control/")>=0&&w.w>0)){console.log(">>> SUCCESS: control webview visible");break;}
  }

  // final: any /control/ webview target?
  const now=await getJson("/json");
  console.log("control targets:", now.filter(t=>/17890\/control\//.test(t.url)).map(t=>t.type+" "+t.url.slice(0,50)));
  ws.close();process.exit(0);
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
