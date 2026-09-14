// Probe 4: browser panel URL bar DOM — form/input structure for requestSubmit.
// Read-only. Browser panel is currently open showing its empty state.
const http = require("http");
const { WebSocket } = require("ws");
let _id = 0;
function getJson(p){return new Promise((res,rej)=>{http.get({host:"127.0.0.1",port:9222,path:p},(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{res(JSON.parse(d));}catch(e){rej(e);}});}).on("error",rej);});}
function connect(wsUrl){wsUrl=wsUrl.replace(/^ws:\/\/localhost(\/|$)/,"ws://127.0.0.1:9222$1");return new Promise((res,rej)=>{const ws=new WebSocket(wsUrl);const pend=new Map();ws.on("message",(raw)=>{const m=JSON.parse(raw.toString());if(m.id&&pend.has(m.id)){const f=pend.get(m.id);pend.delete(m.id);m.error?f.rej(new Error(JSON.stringify(m.error))):f.res(m.result);}});const call=(method,params={})=>new Promise((r2,e2)=>{const i=++_id;pend.set(i,{res:r2,rej:e2});ws.send(JSON.stringify({id:i,method,params}),e=>e&&e2(e));setTimeout(()=>{if(pend.has(i)){pend.delete(i);e2(new Error("timeout"));}},8000);});ws.on("open",()=>res({ws,call}));ws.on("error",rej);});}

(async()=>{
  const targets=await getJson("/json");
  const page=targets.find(t=>t.type==="page"&&/app\.asar\/out\/renderer\/index\.html/.test(t.url));
  const {ws,call}=await connect(page.webSocketDebuggerUrl);
  const ev=(expr)=>call("Runtime.evaluate",{expression:expr,returnByValue:true}).then(r=>r.result&&r.result.value).catch(e=>"ERR:"+e.message);

  console.log("=== URL bar input + form chain ===");
  console.log(await ev(`(function(){
    var inputs=[].slice.call(document.querySelectorAll('input'));
    var hits=inputs.filter(function(i){
      var r=i.getBoundingClientRect();
      return r.width>0 && /网址|url|http/i.test((i.placeholder||'')+(i.getAttribute('aria-label')||''));
    });
    return JSON.stringify(hits.map(function(i){
      var f=i.form;
      var chain=[];
      var n=i; var k=0;
      while(n&&n!==document.body&&k<6){chain.push({tag:n.tagName.toLowerCase(),cls:(typeof n.className==='string'?n.className:'').slice(0,60),testid:n.getAttribute('data-testid')||''});n=n.parentElement;k++;}
      return {placeholder:i.placeholder, type:i.type, visible:true,
        inForm:!!f, formAction:f?f.action:null,
        chain:chain};
    }),null,1);
  })()`));

  console.log("\n=== all visible inputs (fallback scan) ===");
  console.log(await ev(`(function(){
    var out=[];
    [].slice.call(document.querySelectorAll('input,textarea')).forEach(function(i){
      var r=i.getBoundingClientRect();
      if(r.width>0&&r.height>0) out.push({tag:i.tagName.toLowerCase(),ph:(i.placeholder||'').slice(0,30),type:i.type,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width)});
    });
    return JSON.stringify(out.slice(0,10));
  })()`));

  ws.close();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
