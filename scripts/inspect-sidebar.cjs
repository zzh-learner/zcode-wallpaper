// Probe: dump the sidebar "open tab" empty-state DOM (审查/终端/浏览器 cards)
// in the ZCode main page target. Read-only.
const http = require("http");
const { WebSocket } = require("ws");
let _id = 0;
function getJson(p){return new Promise((res,rej)=>{http.get({host:"127.0.0.1",port:9222,path:p},(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{res(JSON.parse(d));}catch(e){rej(e);}});}).on("error",rej);});}
function connect(wsUrl){wsUrl=wsUrl.replace(/^ws:\/\/localhost(\/|$)/,"ws://127.0.0.1:9222$1");return new Promise((res,rej)=>{const ws=new WebSocket(wsUrl);const pend=new Map();ws.on("message",(raw)=>{const m=JSON.parse(raw.toString());if(m.id&&pend.has(m.id)){const f=pend.get(m.id);pend.delete(m.id);m.error?f.rej(new Error(JSON.stringify(m.error))):f.res(m.result);}});const call=(method,params={})=>new Promise((r2,e2)=>{const i=++_id;pend.set(i,{res:r2,rej:e2});ws.send(JSON.stringify({id:i,method,params}),e=>e&&e2(e));setTimeout(()=>{if(pend.has(i)){pend.delete(i);e2(new Error("timeout"));}},8000);});ws.on("open",()=>res({ws,call}));ws.on("error",rej);});}

(async()=>{
  const targets=await getJson("/json");
  const page=targets.find(t=>t.type==="page"&&/app\.asar\/out\/renderer\/index\.html/.test(t.url));
  if(!page){console.error("no main page target");process.exit(1);}
  console.log("main page target:",page.id,page.url.slice(0,80));
  const {ws,call}=await connect(page.webSocketDebuggerUrl);
  const ev=(expr)=>call("Runtime.evaluate",{expression:expr,returnByValue:true}).then(r=>r.result&&r.result.value).catch(e=>"ERR:"+e.message);

  console.log("\n=== 1. find text 打开标签页 / 审查 / 终端 / 浏览器 ===");
  console.log(await ev(`(function(){
    function chain(el){
      var out=[]; var n=el; var i=0;
      while(n && n!==document.documentElement && i<8){
        out.push({i:i, tag:n.tagName.toLowerCase(),
          id:n.id||'', testid:n.getAttribute('data-testid')||'',
          cls:(n.className&&typeof n.className==='string')?n.className.slice(0,80):'',
          role:n.getAttribute('role')||''});
        n=n.parentElement; i++;
      }
      return out;
    }
    var res={};
    ['打开标签页','审查','终端','浏览器'].forEach(function(txt){
      var hits=[];
      var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      var node;
      while((node=walker.nextNode())){
        if(node.textContent.trim()===txt){
          var el=node.parentElement;
          hits.push({tag:el.tagName.toLowerCase(), clickable:!!el.closest('button,[role=button],a'),
            chain:chain(el)});
        }
      }
      res[txt]=hits.slice(0,3);
    });
    return JSON.stringify(res,null,1);
  })()`));

  console.log("\n=== 2. does the empty-state exist while a panel is open? ===");
  console.log(await ev(`(function(){
    var webview=document.querySelector('webview');
    return JSON.stringify({
      hasWebview:!!webview,
      webviewVisible:(function(w){if(!w)return false;var r=w.getBoundingClientRect();return r.width>0&&r.height>0;})(webview),
      hasOpenTabText:document.body.innerText.indexOf('打开标签页')>=0,
      bodyTextSample:document.body.innerText.slice(0,200).replace(/\\n/g,'|')
    });
  })()`));

  console.log("\n=== 3. top-right buttons (help / panel toggle) ===");
  console.log(await ev(`(function(){
    var cands=[];
    document.querySelectorAll('button,[role=button]').forEach(function(e){
      var r=e.getBoundingClientRect();
      if(r.width===0) return;
      var label=(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||'').trim().slice(0,40);
      if(label) cands.push({tag:e.tagName.toLowerCase(),label:label,testid:e.getAttribute('data-testid')||'',
        x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)});
    });
    return JSON.stringify(cands.slice(0,30),null,1);
  })()`));

  ws.close();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
