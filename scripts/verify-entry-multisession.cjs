// E2E: the user's exact failing flow, driven end-to-end.
// switch to ANOTHER conversation -> ensure card-list state -> wait for v3 card
// -> click -> verify control webview becomes VISIBLE in that conversation ->
// switch back to this conversation. All selectors precise; every step logged.
const http = require("http");
const { WebSocket } = require("ws");
let _id = 0;
function getJson(p){return new Promise((res,rej)=>{http.get({host:"127.0.0.1",port:9222,path:p},(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{res(JSON.parse(d));}catch(e){rej(e);}});}).on("error",rej);});}
function connect(wsUrl){wsUrl=wsUrl.replace(/^ws:\/\/localhost(\/|$)/,"ws://127.0.0.1:9222$1");return new Promise((res,rej)=>{const ws=new WebSocket(wsUrl);const pend=new Map();ws.on("message",(raw)=>{const m=JSON.parse(raw.toString());if(m.id&&pend.has(m.id)){const f=pend.get(m.id);pend.delete(m.id);m.error?f.rej(new Error(JSON.stringify(m.error))):f.res(m.result);}});const call=(method,params={})=>new Promise((r2,e2)=>{const i=++_id;pend.set(i,{res:r2,rej:e2});ws.send(JSON.stringify({id:i,method,params}),e=>e&&e2(e));setTimeout(()=>{if(pend.has(i)){pend.delete(i);e2(new Error("timeout"));}},8000);});ws.on("open",()=>res({ws,call}));ws.on("error",rej);});}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

const ME = "task-item-sess_c9e9ded7";       // this conversation (prefix match)
const OTHER = "task-item-sess_f7145b40";    // another conversation (prefix match)

(async()=>{
  const targets=await getJson("/json");
  const page=targets.find(t=>t.type==="page"&&/app\.asar\/out\/renderer\/index\.html/.test(t.url));
  const {ws,call}=await connect(page.webSocketDebuggerUrl);
  const ev=(expr)=>call("Runtime.evaluate",{expression:expr,returnByValue:true}).then(r=>r.result&&r.result.value).catch(e=>"ERR:"+e.message);
  const clickTestid=(testid)=>ev(`(function(){var b=document.querySelector('[data-testid^="${testid}"]');if(!b)return 'not found';b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return 'clicked:'+b.getAttribute('data-testid').slice(0,40);})()`);

  const snap=()=>ev(`(function(){
    var lists=document.querySelectorAll('.side-pane-open-tab-list');
    var visList=null;
    for(var i=0;i<lists.length;i++){var r=lists[i].getBoundingClientRect();if(r.width>0){visList=lists[i];break;}}
    var card=document.querySelector('[data-zz-control-entry]');
    var all=document.querySelectorAll('input[data-testid="browser-address-input"]');
    var inputs=[];
    for(var k=0;k<all.length;k++){var rr=all[k].getBoundingClientRect();inputs.push({v:all[k].value.slice(0,28),vis:rr.width>0});}
    var wvs=[].slice.call(document.querySelectorAll('webview')).map(function(w){var r=w.getBoundingClientRect();return (w.getAttribute('src')||'').slice(0,36)+' w='+Math.round(r.width);});
    return JSON.stringify({visList:!!visList,card:!!card,ver:card?card.getAttribute('data-zz-entry-v'):null,url:card?card.getAttribute('data-control-url'):null,inputs:inputs,wvs:wvs});
  })()`);

  console.log("[0] this-session state:", await snap());

  console.log("[1] switch to other conversation:", await clickTestid(OTHER));
  await sleep(2500);
  console.log("[2] other-session state:", await snap());

  // ensure the card-list (no-panel) state: if no visible list, toggle the pane
  let st=JSON.parse(await snap());
  if(!st.visList){
    console.log("[2b] no card list — close the side pane:", await clickTestid("side-pane-toggle"));
    await sleep(1200);
    console.log("[2c] after pane close:", await snap());
    st=JSON.parse(await snap());
    if(!st.visList){
      console.log("[2d] reopen pane (was closed):", await clickTestid("side-pane-toggle"));
      await sleep(1200);
      console.log("[2e] state:", await snap());
      st=JSON.parse(await snap());
    }
  }

  // wait for the v3 card + URL (install 1.5s + sync 3s cadence)
  let cardOk=false;
  for(let i=0;i<10;i++){
    await sleep(700);
    st=JSON.parse(await snap());
    console.log("[3] t+"+((i+1)*0.7).toFixed(1)+"s:", JSON.stringify(st));
    if(st.card&&st.ver==="3"&&st.url){cardOk=true;break;}
  }
  if(!cardOk){
    console.log("CARD NOT READY (ver/url) — v3 takeover or sync issue");
    console.log("[back] switch home:", await clickTestid(ME));
    ws.close();process.exit(2);
  }

  console.log("[4] CLICK the v3 card in the OTHER session");
  console.log(await ev(`(function(){var c=document.querySelector('[data-zz-control-entry]');if(!c)return 'no card';c.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return 'clicked';})()`));

  let success=false;
  for(let i=0;i<12;i++){
    await sleep(400);
    st=JSON.parse(await snap());
    console.log("[5] click+"+((i+1)*0.4).toFixed(1)+"s:", JSON.stringify(st));
    // success = a control webview that is VISIBLE (non-zero width) — there may
    // also be hidden control webviews from other conversations (w=0); don't
    // grab the first match (that exact mistake hid a real PASS earlier).
    const m=st.wvs.map(w=>/^(.+?) w=(\d+)$/.exec(w)).find(x=>x&&x[1].indexOf("/control/")>=0&&parseInt(x[2],10)>0);
    if(m){success=true;break;}
  }
  console.log(success?">>> SUCCESS: control center visible in the OTHER session":">>> FAILED: no visible control webview");

  console.log("[6] switch back home:", await clickTestid(ME));
  await sleep(1500);
  console.log("[7] home state:", await snap());
  ws.close();
  process.exit(success?0:3);
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
