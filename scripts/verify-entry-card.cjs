// E2E step 1: close the browser-panel tab (back to the side-pane empty state),
// then wait for the injected install loop to add the 控制中心 card and fill
// its data-control-url. Read-mostly (closing the panel = UI state, reversible).
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

  // 教训（2026-09-14）：本脚本最初用 /close|关闭/i 全文档匹配，命中了整个 ZCode
  // 窗口的「关闭窗口」按钮（window-control-close）并 dispatch 了合成点击——差点
  // 关掉用户窗口。关闭类按钮必须精确匹配：范围限定在 #browser 面板容器内，
  // aria-label 以「关闭」开头（标签条按钮是「关闭 <标签标题>」，如「关闭 ZCode
  // 控制中心」），并显式排除 window-control-* testid（窗口最小化/最大化/关闭）。
  console.log("=== find the browser-tab close button (scoped to #browser) ===");
  console.log(await ev(`(function(){
    var panel=document.querySelector('#browser')||document.querySelector('[data-testid=browser]');
    if(!panel) return 'no #browser container';
    var cands=[];
    panel.querySelectorAll('button').forEach(function(e){
      var r=e.getBoundingClientRect();
      if(r.width===0) return;
      var label=(e.getAttribute('aria-label')||e.getAttribute('title')||'').trim();
      var testid=e.getAttribute('data-testid')||'';
      if(/^关闭/.test(label) && testid.indexOf('window-control-')!==0)
        cands.push({label:label.slice(0,30),testid:testid,x:Math.round(r.x),y:Math.round(r.y)});
    });
    return JSON.stringify(cands);
  })()`));

  console.log("\n=== close browser panel tab (exact tab-strip match) ===");
  console.log(await ev(`(function(){
    var panel=document.querySelector('#browser')||document.querySelector('[data-testid=browser]');
    if(!panel) return 'no #browser container';
    var close=[].slice.call(panel.querySelectorAll('button')).find(function(b){
      var r=b.getBoundingClientRect();
      if(r.width===0) return false;
      var lab=(b.getAttribute('aria-label')||b.getAttribute('title')||'');
      var testid=b.getAttribute('data-testid')||'';
      return /^关闭/.test(lab) && testid.indexOf('window-control-')!==0;
    });
    if(!close) return 'no tab close button found (panel may already be at empty state)';
    close.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    return 'dispatched on: '+(close.getAttribute('aria-label')||close.getAttribute('title'));
  })()`));

  console.log("\n=== wait for empty state + injected card (up to 8s) ===");
  for(let i=0;i<8;i++){
    await sleep(1000);
    const st=await ev(`(function(){
      var card=document.querySelector('[data-zz-control-entry]');
      var list=document.querySelector('.side-pane-open-tab-list');
      return JSON.stringify({
        emptyState:document.body.innerText.indexOf('打开标签页')>=0,
        hasList:!!list,
        listCards:list?list.querySelectorAll('button').length:0,
        cardLabels:list?[].slice.call(list.querySelectorAll('.side-pane-open-tab-button-label')).map(function(s){return s.textContent;}):null,
        hasCard:!!card,
        cardUrl:card?card.getAttribute('data-control-url'):null
      });
    })()`);
    console.log("t+"+(i+1)+"s:",st);
    const parsed=JSON.parse(st);
    if(parsed.hasCard&&parsed.cardUrl) break;
  }

  ws.close();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
