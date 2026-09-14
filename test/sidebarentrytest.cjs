// Test lib/sidebar-entry.cjs pure helpers + injected-source semantics
// (fake DOM, no jsdom — same boundary as webviewblankfixtest).
const se = require("../lib/sidebar-entry.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// === filterPageTargets: only the ZCode main renderer page qualifies ===
function mkPage(url, id) { return { type: "page", id: id || "p1", url: url, webSocketDebuggerUrl: "ws://x/" + (id || "p1") }; }
const MAIN_URL = "file:///D:/zcode/resources/app.asar/out/renderer/index.html?restoreSession=true";

check("keep main renderer page", se.filterPageTargets([mkPage(MAIN_URL)]).length === 1);
check("reject webview type even with matching url", se.filterPageTargets([{ type: "webview", id: "w", url: MAIN_URL, webSocketDebuggerUrl: "ws://x" }]).length === 0);
check("reject devtools url", se.filterPageTargets([mkPage("devtools://devtools/bundled/shell.html")]).length === 0);
check("reject tool page /control/", se.filterPageTargets([mkPage("http://127.0.0.1:17890/control/")]).length === 0);
check("reject reader tool page", se.filterPageTargets([mkPage("http://127.0.0.1:17890/reader/?book=x")]).length === 0);
check("reject external page", se.filterPageTargets([mkPage("https://a.com/")]).length === 0);
check("reject no wsUrl", se.filterPageTargets([{ type: "page", url: MAIN_URL }]).length === 0);
check("reject app.asar non-renderer path", se.filterPageTargets([mkPage("file:///D:/zcode/resources/app.asar/out/main/index.js")]).length === 0);

// mixed
var mixed = [
  mkPage(MAIN_URL, "a"),
  mkPage("https://a.com/", "b"),
  mkPage("http://127.0.0.1:17890/control/", "c"),
  { type: "webview", id: "d", url: MAIN_URL, webSocketDebuggerUrl: "ws://x/d" }
];
check("mixed: keep exactly the main renderer page", se.filterPageTargets(mixed).length === 1 && se.filterPageTargets(mixed)[0].id === "a");

// === buildEntrySource: keyword assertions ===
var src = se.buildEntrySource();
check("SOURCE: contains idempotency flag " + se.ENTRY_FLAG, src.indexOf(se.ENTRY_FLAG) !== -1);
check("SOURCE: stamps entry version", src.indexOf("data-zz-entry-v") !== -1 && src.indexOf(String(se.ENTRY_VERSION)) !== -1);
check("SOURCE: replaces stale-version card", src.indexOf("removeChild(old)") !== -1);
check("SOURCE: queries empty-state list", src.indexOf("side-pane-open-tab-list") !== -1);
check("SOURCE: clones a side-pane card", src.indexOf("side-pane-open-tab-button") !== -1);
check("SOURCE: sets card label 控制中心", src.indexOf("控制中心") !== -1);
check("SOURCE: swaps icon path", src.indexOf("svg.innerHTML") !== -1);
check("SOURCE: opens browser panel via dispatchEvent", src.indexOf("dispatchEvent") !== -1 && src.indexOf("MouseEvent") !== -1);
check("SOURCE: waits for address input", src.indexOf(se.ADDRESS_INPUT_TESTID) !== -1);
check("SOURCE: React-safe value setter", src.indexOf("HTMLInputElement") !== -1 && src.indexOf("getOwnPropertyDescriptor") !== -1);
check("SOURCE: dispatches input event", src.indexOf("Event('input'") !== -1);
check("SOURCE: submits via form.requestSubmit", src.indexOf("requestSubmit") !== -1);
check("SOURCE: retry loop verifies visible webview", src.indexOf("getBoundingClientRect") !== -1 && src.indexOf("r.width>0") !== -1);
check("SOURCE: retry loop does not stop at first submit (no clearInterval before submit)", src.indexOf("window.clearInterval(timer);return;}") !== -1);
check("SOURCE: self-heal loop", src.indexOf("setInterval") !== -1);
check("SOURCE: is IIFE", /^\(function\(\)\{[\s\S]*\}\)\(\);?\s*$/.test(src.trim()));
// URL must NOT be baked into the source (port drift never needs re-install;
// the URL travels via the DOM attribute written by setEntryUrlExpression)
check("SOURCE: no hardcoded URL", src.indexOf("http://") === -1 && src.indexOf("17890") === -1);

// === setEntryUrlExpression ===
var e1 = se.setEntryUrlExpression("http://127.0.0.1:17890");
check("EXPR: writes /control/ url", e1.indexOf("http://127.0.0.1:17890/control/") !== -1);
check("EXPR: sets the URL attribute", e1.indexOf("setAttribute") !== -1 && e1.indexOf(JSON.stringify(se.ENTRY_URL_ATTR).slice(1, -1)) !== -1);
check("EXPR: targets the entry flag", e1.indexOf("[" + se.ENTRY_FLAG + "]") !== -1);
check("EXPR: normalizes trailing slash", se.setEntryUrlExpression("http://127.0.0.1:17890///").indexOf("17890///control") === -1);
check("EXPR: no-op guard when card absent", e1.indexOf("if(c)") !== -1);

// === SOURCE semantics on a minimal fake DOM ===
// No jsdom (YAGNI). Fake node shapes cover exactly what buildEntrySource touches.

function makeFakeCard(text) {
  var card = {
    tagName: "BUTTON",
    _text: text,
    textContent: text,
    _attrs: {},
    _listeners: [],
    _dispatched: [],
    getAttribute: function (n) { return n in this._attrs ? this._attrs[n] : null; },
    setAttribute: function (n, v) { this._attrs[n] = v; },
    addEventListener: function (ev, cb) { this._listeners.push(cb); },
    parentNode: null,
    // real DOM: closest walks ancestors; our cards live one level under a list
    closest: function (sel) {
      return this.parentNode && this.parentNode._isList ? this.parentNode : null;
    },
    dispatchEvent: function (ev) { this._dispatched.push(ev); for (var i = 0; i < this._listeners.length; i++) this._listeners[i](ev); return true; },
    cloneNode: function () { return makeFakeCard(text); },
    querySelector: function (sel) {
      if (sel === ".side-pane-open-tab-button-label") {
        // label writes must flow back to the card's textContent (like real DOM)
        if (!card._label) {
          card._label = {
            get textContent() { return card.textContent; },
            set textContent(v) { card.textContent = v; }
          };
        }
        return card._label;
      }
      if (sel === "svg") {
        if (!card._svg) card._svg = { innerHTML: "" }; // stable object across queries
        return card._svg;
      }
      return null;
    }
  };
  return card;
}

function makeFakeInput(visible) {
  return {
    value: "",
    _events: [],
    _visible: visible,
    dispatchEvent: function (ev) { this._events.push(ev.type); },
    form: { _submitted: 0, requestSubmit: function () { this._submitted++; } },
    closest: function () { return this.form; },
    getBoundingClientRect: function () { return { width: this._visible ? 477 : 0 }; }
  };
}

// Fake DOM mirrors the REAL multi-instance topology (2026-09-14 真机实测):
// several conversation panels coexist — multiple empty-state lists AND
// multiple address inputs (hidden panels' inputs stay in the DOM).
// opts.hiddenInputFirst: DOM order puts a hidden panel's input before the
// visible one (the exact shape that broke v1/v2 in another session).
function makeFakeDom(opts) {
  opts = opts || {};
  function makeList(width, tplText) {
    var tpl = makeFakeCard(tplText);
    var l = {
      _isList: true,
      _w: width,
      _children: [tpl],
      getBoundingClientRect: function () { return { width: this._w }; },
      appendChild: function (c) { c.parentNode = this; this._children.push(c); },
      removeChild: function (c) { var i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); c.parentNode = null; },
      querySelector: function (sel) {
        if (sel === "button.side-pane-open-tab-button") return this._children[0];
        return null;
      },
      querySelectorAll: function (sel) {
        if (sel === "button.side-pane-open-tab-button") return this._children.slice();
        return [];
      }
    };
    tpl.parentNode = l;
    return l;
  }
  var lists = [makeList(320, "打开浏览器")];
  if (opts.secondList) lists.push(makeList(opts.secondList, "打开浏览器"));
  if (opts.firstListHidden) lists[0]._w = 0;
  var list = lists[0];
  var tpl = list._children[0];
  var input = makeFakeInput(true); // the visible one (active conversation)
  var hiddenInput = makeFakeInput(false);
  var inputs = opts.hiddenInputFirst ? [hiddenInput, input] : [input];
  // fake webview: src + rect width, mutated by tests to simulate navigation
  var webview = {
    _src: "",
    _w: 0,
    getAttribute: function (n) { return n === "src" ? this._src : null; },
    getBoundingClientRect: function () { return { width: this._w }; }
  };
  function allCards() {
    var out = [];
    lists.forEach(function (l) { l._children.forEach(function (c) { out.push(c); }); });
    return out;
  }
  var doc = {
    querySelector: function (sel) {
      if (sel === "[" + se.ENTRY_FLAG + "]") {
        var cs = allCards();
        for (var i = 0; i < cs.length; i++) {
          if (cs[i]._attrs && cs[i]._attrs[se.ENTRY_FLAG]) return cs[i];
        }
        return null;
      }
      if (sel === ".side-pane-open-tab-list") return lists[0];
      if (sel === 'input[data-testid="' + se.ADDRESS_INPUT_TESTID + '"]') return inputs[0];
      if (sel === "webview") return webview._src ? webview : null;
      return null;
    },
    querySelectorAll: function (sel) {
      if (sel === ".side-pane-open-tab-list") return lists.slice();
      if (sel === "button.side-pane-open-tab-button") return allCards();
      if (sel === 'input[data-testid="' + se.ADDRESS_INPUT_TESTID + '"]') return inputs.slice();
      if (sel === "webview") return webview._src ? [webview] : [];
      return [];
    }
  };
  var win = {
    _intervalCbs: [],
    _cleared: {},
    _nextId: 0,
    setInterval: function (cb, ms) { this._intervalCbs.push({ id: ++this._nextId, cb: cb, ms: ms }); return this._nextId; },
    clearInterval: function (id) { this._cleared[id] = true; },
    MouseEvent: function (type, opts) { this.type = type; this.bubbles = opts && opts.bubbles; },
    Event: function (type, opts) { this.type = type; },
    HTMLInputElement: undefined // setter lookup throws -> handler falls back to inp.value=u
  };
  function run() { var fn = new Function("window", "document", se.buildEntrySource()); fn(win, doc); }
  return {
    win: win, doc: doc, lists: lists, list: list, tpl: tpl,
    secondList: lists[1] || null,
    input: input, hiddenInput: hiddenInput, webview: webview, run: run
  };
}

// 场景 1: 无空状态（面板开着）—— 不炸、自愈循环已装
(function () {
  var dom = {
    win: { setInterval: function () { return 1; }, clearInterval: function () {}, MouseEvent: function () {}, Event: function () {} },
    doc: { querySelector: function () { return null; }, querySelectorAll: function () { return []; } }
  };
  var threw = false;
  try { var fn = new Function("window", "document", se.buildEntrySource()); fn(dom.win, dom.doc); } catch (e) { threw = true; }
  check("semantics: no empty-state -> no throw", threw === false);
})();

// 场景 2: 有空状态 -> 克隆卡插入，label/图标/flag/版本 正确，click 已挂
(function () {
  var dom = makeFakeDom();
  dom.run();
  check("semantics: card appended to list", dom.list._children.length === 2);
  var card = dom.list._children[1];
  check("semantics: card carries flag", card.getAttribute(se.ENTRY_FLAG) === "1");
  check("semantics: card carries version", card.getAttribute("data-zz-entry-v") === String(se.ENTRY_VERSION));
  check("semantics: card label is 控制中心", card.textContent === se.CARD_LABEL);
  check("semantics: card icon swapped", typeof card.querySelector("svg").innerHTML === "string" && card.querySelector("svg").innerHTML.indexOf("<path") === 0);
  check("semantics: click listener installed", card._listeners.length === 1);
  check("semantics: install loop registered (1500ms)", dom.win._intervalCbs.some(function (t) { return t.ms === 1500; }));
})();

// 场景 3: 幂等 —— 重跑不重复插卡（版本匹配则跳过）
(function () {
  var dom = makeFakeDom();
  dom.run();
  dom.run(); // addScriptToEvaluateOnNewDocument + Runtime.evaluate double-fire
  check("semantics: re-run does not duplicate card", dom.list._children.length === 2);
})();

// 场景 3b: 版本接管 —— 旧版本（无版本戳）的卡被替换成本版本的卡
// （旧 source 的 addScriptToEvaluateOnNewDocument 注册在页面上活到 ZCode 重启，
//  新 source 靠版本戳接管卡片，否则卡片会一直带着旧的坏 handler）
(function () {
  var dom = makeFakeDom();
  // simulate a v1 card: flag present, no version attr, no listener
  var stale = makeFakeCard("控制中心");
  stale.setAttribute(se.ENTRY_FLAG, "1");
  dom.list.appendChild(stale);
  dom.run();
  check("semantics: stale card replaced", dom.list._children.indexOf(stale) === -1);
  var fresh = dom.list._children.filter(function (c) { return c.getAttribute(se.ENTRY_FLAG); });
  check("semantics: replacement is versioned", fresh.length === 1 && fresh[0].getAttribute("data-zz-entry-v") === String(se.ENTRY_VERSION));
})();

// 场景 4: setEntryUrlExpression 在卡上生效；无卡时不炸
(function () {
  var dom = makeFakeDom();
  dom.run();
  var card = dom.list._children[1];
  var expr = se.setEntryUrlExpression("http://127.0.0.1:17890");
  new Function("document", expr)(dom.doc);
  check("semantics: URL attribute filled", card.getAttribute(se.ENTRY_URL_ATTR) === "http://127.0.0.1:17890/control/");
  var emptyDoc = { querySelector: function () { return null; } };
  var threw = false;
  try { new Function("document", expr)(emptyDoc); } catch (e) { threw = true; }
  check("semantics: URL expr no-ops without card", threw === false);
})();

// 场景 5: 点击链 —— 无 URL 时 no-op；有 URL 时开浏览器面板 + 重试提交直到
// 目标 webview 可见（fresh-mount 竞态：首次提交造出 0 宽僵尸 webview，重试后成功）
(function () {
  var dom = makeFakeDom();
  dom.run();
  var card = dom.list._children[1];
  // no URL yet -> handler returns before touching anything
  card._listeners[0]();
  check("semantics: click without URL is a no-op", dom.tpl._dispatched.length === 0 && dom.input._events.length === 0);
  // fill URL, then click
  var URL = "http://127.0.0.1:17890/control/";
  card.setAttribute(se.ENTRY_URL_ATTR, URL);
  card._listeners[0]();
  check("semantics: click dispatches on the 浏览器 card", dom.tpl._dispatched.length === 1 && dom.tpl._dispatched[0].bubbles === true);

  var poll = dom.win._intervalCbs.filter(function (t) { return t.ms === 250; });
  check("semantics: retry loop installed (250ms)", poll.length === 1);
  var tick = poll[0].cb;

  // tick 1: no webview yet -> fill + submit (#1)
  tick();
  check("semantics: input value set to control url", dom.input.value === URL);
  check("semantics: input event dispatched (React onChange)", dom.input._events.indexOf("input") !== -1);
  check("semantics: form submitted via requestSubmit", dom.input.form._submitted === 1);

  // tick 2: mount-race zombie — webview exists with our src but 0 width -> retry
  dom.webview._src = URL; dom.webview._w = 0;
  tick();
  check("semantics: 0-width zombie webview does NOT count as success", dom.input.form._submitted === 2);

  // tick 3: webview laid out -> success, loop stops
  dom.webview._w = 800;
  tick();
  var timerId = poll[0].id;
  check("semantics: visible webview stops the retry loop", dom.win._cleared[timerId] === true);
  var submittedAt = dom.input.form._submitted;
  tick(); // a stray late tick must not re-submit
  check("semantics: no re-submit after success", dom.input.form._submitted === submittedAt);

  // NO visible address input at all (all panels hidden/mid-mount) -> wait
  dom.webview._src = ""; dom.webview._w = 0; dom.input._visible = false;
  dom.input.form._submitted = 0;
  tick();
  check("semantics: no visible input is not submitted (waits for panel mount)", dom.input.form._submitted === 0);
})();

// 场景 5e: 重试中途用户切走会话（卡片上下文消失 ~2s）→ 循环中止，不误伤别的会话
// （卡片被替换不算消失——只要 document 里还有任一入口卡就算活着）
(function () {
  var dom = makeFakeDom();
  dom.run();
  var card = dom.list._children[1];
  var URL = "http://127.0.0.1:17890/control/";
  card.setAttribute(se.ENTRY_URL_ATTR, URL);
  card._listeners[0]();
  var poll = dom.win._intervalCbs.filter(function (t) { return t.ms === 250; });
  var tick = poll[0].cb;
  var timerId = poll[0].id;
  // card present: ticks run fine
  tick(); tick();
  check("semantics: card present keeps retrying", dom.win._cleared[timerId] !== true);
  // card removed (conversation switched): 8 consecutive miss-ticks abort
  var list = dom.list;
  list.removeChild(card);
  for (var i = 0; i < 9; i++) tick();
  check("semantics: card gone 2s+ aborts the retry loop", dom.win._cleared[timerId] === true);
  // transient removal (re-added within 8 ticks) does NOT abort
  var dom2 = makeFakeDom();
  dom2.run();
  var card2 = dom2.list._children[1];
  card2.setAttribute(se.ENTRY_URL_ATTR, URL);
  card2._listeners[0]();
  var poll2 = dom2.win._intervalCbs.filter(function (t) { return t.ms === 250; });
  var tick2 = poll2[0].cb;
  var timerId2 = poll2[0].id;
  for (var k = 0; k < 3; k++) tick2();            // some ticks with card
  dom2.list.removeChild(card2); tick2(); tick2(); // brief removal
  dom2.list.appendChild(card2); tick2(); tick2(); // re-added (transient)
  check("semantics: transient card removal does not abort", dom2.win._cleared[timerId2] !== true);
})();

// 场景 5b: 用户真机 bug 的确切形态 —— 另一个会话的隐藏地址栏排在 DOM 前面。
// v1/v2 用 querySelector 拿第一个 input：填进隐藏面板（v1）或永远等待（v2）。
// v3 必须跳过隐藏的、填可见的那个。
(function () {
  var dom = makeFakeDom({ hiddenInputFirst: true });
  dom.run();
  var card = dom.list._children[1];
  var URL = "http://127.0.0.1:17890/control/";
  card.setAttribute(se.ENTRY_URL_ATTR, URL);
  card._listeners[0]();

  var poll = dom.win._intervalCbs.filter(function (t) { return t.ms === 250; });
  poll[0].cb();
  check("semantics: hidden panel's input is NOT filled (DOM order first)", dom.hiddenInput.value === "" && dom.hiddenInput.form._submitted === 0);
  check("semantics: visible input is the one filled", dom.input.value === URL);
  check("semantics: visible input's form submitted", dom.input.form._submitted === 1);
})();

// 场景 5c: 多会话多列表 —— dispatch 限定在自己卡所在的列表，不打扰别的会话的卡；
// install 优先可见列表
(function () {
  var dom = makeFakeDom({ secondList: 320 });
  dom.run();
  // install targets a visible list — first one is visible here, card lands there
  check("semantics: install lands in a visible list", dom.list._children.length === 2);
  var card = dom.list._children[1];
  var URL = "http://127.0.0.1:17890/control/";
  card.setAttribute(se.ENTRY_URL_ATTR, URL);
  card._listeners[0]();
  var otherTpl = dom.secondList._children[0]; // another session's 浏览器 card
  check("semantics: dispatch scoped to own list", dom.tpl._dispatched.length === 1 && otherTpl._dispatched.length === 0);
})();

// 场景 5d: 第一个列表隐藏（非活跃会话）时 install 选可见的第二个列表
(function () {
  var dom = makeFakeDom({ firstListHidden: true, secondList: 320 });
  dom.run();
  check("semantics: hidden list does not get the card", dom.list._children.length === 1);
  check("semantics: visible second list gets the card", dom.secondList._children.length === 2);
})();

// 场景 6: 浏览器卡片不在（面板已开）时点击 —— 不炸；地址栏可见则直接提交
(function () {
  var dom = makeFakeDom();
  dom.run();
  var card = dom.list._children[1];
  card.setAttribute(se.ENTRY_URL_ATTR, "http://127.0.0.1:17890/control/");
  // panel already open: no empty-state 浏览器 card anymore, no webview yet
  dom.list.removeChild(dom.tpl);
  var threw = false;
  try { card._listeners[0](); } catch (e) { threw = true; }
  check("semantics: click without browser card does not throw", threw === false);
  var poll = dom.win._intervalCbs.filter(function (t) { return t.ms === 250; });
  check("semantics: retry loop still installed", poll.length === 1);
  poll[0].cb();
  check("semantics: visible address bar submitted directly", dom.input.form._submitted >= 1);
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
