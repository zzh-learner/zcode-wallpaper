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
check("SOURCE: queries empty-state list", src.indexOf("side-pane-open-tab-list") !== -1);
check("SOURCE: clones a side-pane card", src.indexOf("side-pane-open-tab-button") !== -1);
check("SOURCE: sets card label 控制中心", src.indexOf("控制中心") !== -1);
check("SOURCE: swaps icon path", src.indexOf("svg.innerHTML") !== -1);
check("SOURCE: opens browser panel via dispatchEvent", src.indexOf("dispatchEvent") !== -1 && src.indexOf("MouseEvent") !== -1);
check("SOURCE: waits for address input", src.indexOf(se.ADDRESS_INPUT_TESTID) !== -1);
check("SOURCE: React-safe value setter", src.indexOf("HTMLInputElement") !== -1 && src.indexOf("getOwnPropertyDescriptor") !== -1);
check("SOURCE: dispatches input event", src.indexOf("Event('input'") !== -1);
check("SOURCE: submits via form.requestSubmit", src.indexOf("requestSubmit") !== -1);
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

function makeFakeDom() {
  var tpl = makeFakeCard("打开浏览器");
  var list = {
    _children: [tpl],
    appendChild: function (c) { this._children.push(c); },
    querySelector: function (sel) {
      if (sel === "button.side-pane-open-tab-button") return this._children[0];
      return null;
    }
  };
  var input = {
    value: "",
    _events: [],
    dispatchEvent: function (ev) { this._events.push(ev.type); },
    form: { _submitted: false, requestSubmit: function () { this._submitted = true; } },
    closest: function () { return this.form; }
  };
  var doc = {
    querySelector: function (sel) {
      if (sel === "[" + se.ENTRY_FLAG + "]") {
        for (var i = 0; i < list._children.length; i++) {
          if (list._children[i]._attrs && list._children[i]._attrs[se.ENTRY_FLAG]) return list._children[i];
        }
        return null;
      }
      if (sel === ".side-pane-open-tab-list") return list;
      if (sel === 'input[data-testid="' + se.ADDRESS_INPUT_TESTID + '"]') return input;
      return null;
    },
    querySelectorAll: function (sel) {
      if (sel === "button.side-pane-open-tab-button") return list._children.slice();
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
  return { win: win, doc: doc, list: list, tpl: tpl, input: input, run: run };
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

// 场景 2: 有空状态 -> 克隆卡插入，label/图标/flag 正确，click 已挂
(function () {
  var dom = makeFakeDom();
  dom.run();
  check("semantics: card appended to list", dom.list._children.length === 2);
  var card = dom.list._children[1];
  check("semantics: card carries flag", card.getAttribute(se.ENTRY_FLAG) === "1");
  check("semantics: card label is 控制中心", card.textContent === se.CARD_LABEL);
  check("semantics: card icon swapped", typeof card.querySelector("svg").innerHTML === "string" && card.querySelector("svg").innerHTML.indexOf("<path") === 0);
  check("semantics: click listener installed", card._listeners.length === 1);
  check("semantics: install loop registered (1500ms)", dom.win._intervalCbs.some(function (t) { return t.ms === 1500; }));
})();

// 场景 3: 幂等 —— 重跑不重复插卡
(function () {
  var dom = makeFakeDom();
  dom.run();
  dom.run(); // addScriptToEvaluateOnNewDocument + Runtime.evaluate double-fire
  check("semantics: re-run does not duplicate card", dom.list._children.length === 2);
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

// 场景 5: 点击链 —— 无 URL 时 no-op；有 URL 时开浏览器面板 + 提交地址栏表单
(function () {
  var dom = makeFakeDom();
  dom.run();
  var card = dom.list._children[1];
  // no URL yet -> handler returns before touching anything
  card._listeners[0]();
  check("semantics: click without URL is a no-op", dom.tpl._dispatched.length === 0 && dom.input._events.length === 0);
  // fill URL, then click
  card.setAttribute(se.ENTRY_URL_ATTR, "http://127.0.0.1:17890/control/");
  card._listeners[0]();
  check("semantics: click dispatches on the 浏览器 card", dom.tpl._dispatched.length === 1 && dom.tpl._dispatched[0].bubbles === true);
  // pump the address-input poll (installed by the click handler)
  var poll = dom.win._intervalCbs.filter(function (t) { return t.ms === 100; });
  check("semantics: address-input poll installed (100ms)", poll.length === 1);
  poll[0].cb();
  check("semantics: input value set to control url", dom.input.value === "http://127.0.0.1:17890/control/");
  check("semantics: input event dispatched (React onChange)", dom.input._events.indexOf("input") !== -1);
  check("semantics: form submitted via requestSubmit", dom.input.form._submitted === true);
})();

// 场景 6: 浏览器卡片不在 DOM（面板已开）时点击 —— 不炸；地址栏可见则直接提交
// （handler 的轮询是无条件装的：面板已开时 input 立即可见，走"直接提交"路径）
(function () {
  var dom = makeFakeDom();
  dom.run();
  var card = dom.list._children[1];
  card.setAttribute(se.ENTRY_URL_ATTR, "http://127.0.0.1:17890/control/");
  dom.doc.querySelectorAll = function () { return []; }; // no browser card anymore
  var threw = false;
  try { card._listeners[0](); } catch (e) { threw = true; }
  check("semantics: click without browser card does not throw", threw === false);
  var poll = dom.win._intervalCbs.filter(function (t) { return t.ms === 100; });
  check("semantics: address poll still installed", poll.length === 1);
  poll[0].cb();
  check("semantics: visible address bar submitted directly", dom.input.form._submitted === true);
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
