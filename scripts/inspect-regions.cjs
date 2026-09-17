// THROWAWAY probe (brainstorm 调研用): dump ZCode 主页面的区域结构。
// 目标:找出"各部分"(侧边栏/顶栏/主对话区/输入框)的真实 DOM 骨架
// —— tag/testid/class + rect + computed bg —— 为按区域透明/模糊功能
// 的选择器设计拿事实(教训 21:探测真实 state,别猜 DOM)。

const http = require("http");
const { WebSocket } = require("ws");

const PORT = parseInt(process.env.ZCODE_DEBUG_PORT || "9222", 10);
const HOST = process.env.ZCODE_DEBUG_HOST || "127.0.0.1";
let _callId = 0;

function httpGetJson(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path: p, headers: { Host: "localhost" } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}
function fixWsHost(u) { return u.replace(/^ws:\/\/localhost(\/)/i, `ws://127.0.0.1:${PORT}$1`); }
function connect(wsUrl) {
  wsUrl = fixWsHost(wsUrl);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pending.has(m.id)) {
        const { resolve: ok, reject: no } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? no(new Error("CDP: " + JSON.stringify(m.error))) : ok(m.result);
      }
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++_callId; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }), (e) => e && reject(e));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout")); } }, 8000);
    });
    ws.on("open", () => resolve({ ws, call }));
    ws.on("error", reject);
  });
}

const expr = `(function(){
  // 1) 所有带 data-testid 的元素(React 应用的语义锚点大概率在这)
  var out = { testids: [], skeleton: [] };
  document.querySelectorAll('[data-testid]').forEach(function(el){
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    out.testids.push({
      testid: el.getAttribute('data-testid'),
      tag: el.tagName,
      cls: String(el.className).slice(0, 80),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      bg: cs.backgroundColor,
      bgImg: cs.backgroundImage === 'none' ? '' : cs.backgroundImage.slice(0, 60)
    });
  });
  // 2) body 下 4 层骨架:有面积、画了背景或是大容器的元素
  function walk(el, depth, path) {
    if (depth > 4 || !el) return;
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      var cs = getComputedStyle(c);
      var r = c.getBoundingClientRect();
      var solid = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none';
      var big = r.width > 100 && r.height > 40;
      if (solid || big) {
        out.skeleton.push({
          depth: depth, path: path + '>' + c.tagName + '[' + i + ']',
          cls: String(c.className).slice(0, 100),
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          bg: cs.backgroundColor,
          bgImg: cs.backgroundImage === 'none' ? '' : cs.backgroundImage.slice(0, 60),
          pos: cs.position
        });
        walk(c, depth + 1, path + '>' + c.tagName + '[' + i + ']');
      }
    }
  }
  walk(document.body, 0, 'body');
  // 3) 定向锚点:四个区域候选选择器的 count/rect/computed bg。
  //    双层叠加检测:input 区的 dock wrapper 与 .bg-input 若嵌套,只取实际画背景层。
  var ANCHORS = ['aside[data-testid="sidebar"]',
    '[data-testid="conversation"]', '[data-testid="conversation-column"]',
    '[data-testid="conversation-bottom-dock-transition"]', '.bg-input',
    '[data-testid="workspace-header"]'];
  out.anchors = ANCHORS.map(function (sel) {
    var els = document.querySelectorAll(sel);
    var first = [];
    for (var i = 0; i < Math.min(els.length, 3); i++) {
      var cs = getComputedStyle(els[i]);
      var r = els[i].getBoundingClientRect();
      first.push({ rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        bg: cs.backgroundColor, tag: els[i].tagName, cls: String(els[i].className).slice(0, 60) });
    }
    return { sel: sel, count: els.length, first: first };
  });
  return JSON.stringify(out);
})()`;

(async () => {
  const targets = await httpGetJson("/json");
  const page = targets.find((t) => t.type === "page" && /app\.asar\/out\/renderer\/index\.html/.test(t.url));
  if (!page) { console.error("main page target not found"); process.exit(2); }
  const { ws, call } = await connect(page.webSocketDebuggerUrl);
  const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true });
  const data = JSON.parse(r.result.value);
  console.log("=== data-testid elements (" + data.testids.length + ") ===");
  data.testids.forEach((t) => console.log(JSON.stringify(t)));
  console.log("=== solid/big skeleton (" + data.skeleton.length + ") ===");
  data.skeleton.forEach((s) => console.log(JSON.stringify(s)));
  if (data.anchors) {
    console.log("=== anchors ===");
    data.anchors.forEach((a) => console.log(JSON.stringify(a)));
  }
  ws.close();
})().catch((e) => { console.error(e); process.exit(1); });
