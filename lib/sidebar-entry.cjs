// Sidebar "控制中心" entry card, injected into the ZCode MAIN renderer page
// (app.asar/out/renderer/index.html). Adds a fourth card to the side-pane
// empty state ("打开标签页": 审查/终端/浏览器 + ours) so the user no longer
// types http://127.0.0.1:17890/control by hand into the browser panel.
//
// WHY a separate module (not in cdp.cjs): cdp.cjs is READ-ONLY by design
// (AGENTS.md). Installing an entry card is a WRITE op — mirrors
// webview-blankfix.cjs / video-mute.cjs positioning. Reuses cdp.connect +
// cdp.httpGetJson (neutral plumbing, 教训 1).
//
// Verified on the real machine (2026-09-14, scripts/inspect-sidebar*.cjs):
//   - empty-state cards are button.side-pane-open-tab-button, CONDITIONALLY
//     rendered: in the DOM only while the side pane shows the empty state
//   - a native MouseEvent('click',{bubbles:true}) on the 浏览器 card DOES open
//     the browser panel (React handles native clicks; synthetic keydown is
//     what frameworks ignore — 教训 23)
//   - the browser panel's address bar is
//     input[data-testid="browser-address-input"] inside a <form>; navigation
//     must go through the form's native submit path (form.requestSubmit,
//     教训 23 子坑 C) so ZCode itself creates and manages the webview tab.
//     Direct webview.loadURL has no target here — the empty panel has no
//     active webview element to drive.
//
// WORLD-SAFETY (教训 28): Runtime.evaluate may run in an isolated world, so
// the injected code NEVER keeps state in window globals:
//   - idempotency = DOM presence of [data-zz-control-entry]
//   - the target URL travels in a DOM attribute (data-control-url), rewritten
//     by the server on every sync tick (DOM is shared across worlds).
//     buildEntrySource() contains no URL, so a port drift never needs a
//     script re-install.
// The card is re-installed by a slow window.setInterval(install,1500) loop:
// React removes the whole empty-state subtree when a panel opens and rebuilds
// it (without our card) when the pane closes again — the loop re-adds us.
// A MutationObserver would also work, but the timer is dumber and covers
// every React re-render shape (教训 21: don't guess React's reconcile
// behavior; recover unconditionally).

const ENTRY_FLAG = "data-zz-control-entry";
const ENTRY_URL_ATTR = "data-control-url";
const CARD_LABEL = "控制中心";
const ADDRESS_INPUT_TESTID = "browser-address-input";
// Bump when the injected source's behavior changes. The install loop replaces
// any card stamped with an older version (see buildEntrySource) — this lets a
// NEW source take over on a live page where an OLD source is still registered
// (addScriptToEvaluateOnNewDocument registrations persist until ZCode restarts,
// and the old source's install interval keeps running).
const ENTRY_VERSION = 3;

// Heroicons v2 outline "adjustments-horizontal" — visually distinct from the
// review/terminal/browser glyphs. The cloned card's <svg> keeps its own
// fill/stroke styling; we only swap the path.
const ENTRY_ICON_PATH = "M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75";

// Pure. JS injected into the main renderer page via
// Page.addScriptToEvaluateOnNewDocument + a one-shot Runtime.evaluate.
// Contains NO url — the server fills data-control-url separately (see
// setEntryUrlExpression), so re-registration is never needed for port drift.
//
// Click chain (v3): retry-with-verify (v2) + MULTI-INSTANCE panel awareness.
// ZCode's side panels are PER-CONVERSATION: switching sessions leaves other
// conversations' browser panels in the DOM (verified live 2026-09-14: two
// address inputs at once — the active conversation's visible one plus a hidden
// one). v1/v2 used document.querySelector (first in DOM order): in another
// session the first input belonged to a HIDDEN panel, so v1 filled a hidden
// address bar (submit navigated nothing visible) and v2's visible-wait spun
// forever — "browser opens, no follow-up". v3 iterates ALL inputs and picks
// the VISIBLE one, scopes the 浏览器-card dispatch to our card's own list, and
// keeps the 250ms retry-with-verify loop (webview src match + width>0 = done)
// which also covers the fresh-mount race v2 fixed.
function buildEntrySource() {
  return [
    "(function(){",
    "  var FLAG=" + JSON.stringify(ENTRY_FLAG) + ";",
    "  var URLATTR=" + JSON.stringify(ENTRY_URL_ATTR) + ";",
    "  var VER=" + JSON.stringify(String(ENTRY_VERSION)) + ";",
    "  function visible(el){try{var r=el.getBoundingClientRect();return r.width>0;}catch(e){return false;}}",
    //      multiple conversation panels coexist in the DOM (each with its own
    //      empty-state list); install into the VISIBLE one, fall back to first
    "  function visibleList(){",
    "    var ls=document.querySelectorAll('.side-pane-open-tab-list');",
    "    for(var i=0;i<ls.length;i++){if(visible(ls[i]))return ls[i];}",
    "    return ls[0]||null;",
    "  }",
    "  function install(){",
    "    var old=document.querySelector('['+FLAG+']');",
    "    if(old){",
    //      stale-version card (from an older registered source): replace it so
    //      this version's click handler owns the card; matching version: done.
    "      if(old.getAttribute('data-zz-entry-v')===VER)return;",
    "      if(old.parentNode)old.parentNode.removeChild(old);",
    "    }",
    "    var list=visibleList();",
    "    if(!list)return;",
    "    var tpl=list.querySelector('button.side-pane-open-tab-button');",
    "    if(!tpl)return;",
    "    var card=tpl.cloneNode(true);",
    "    card.setAttribute(FLAG,'1');",
    "    card.setAttribute('data-zz-entry-v',VER);",
    "    var label=card.querySelector('.side-pane-open-tab-button-label');",
    "    if(label)label.textContent=" + JSON.stringify(CARD_LABEL) + ";",
    "    var svg=card.querySelector('svg');",
    "    if(svg)svg.innerHTML=" +
      JSON.stringify('<path stroke-linecap="round" stroke-linejoin="round" d="' + ENTRY_ICON_PATH + '"/>') + ";",
    "    card.addEventListener('click',function(){",
    "      var u=card.getAttribute(URLATTR);",
    "      if(!u)return;",
    //        open the browser panel: scope to OUR card's own list — the first
    //        浏览器 button in document order may live in a hidden panel's list
    "      var scope=(card.closest&&card.closest('.side-pane-open-tab-list'))||document;",
    "      var btns=scope.querySelectorAll('button.side-pane-open-tab-button');",
    "      for(var i=0;i<btns.length;i++){",
    "        if((btns[i].textContent||'').indexOf('浏览器')>=0){",
    "          btns[i].dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true,view:window}));",
    "          break;",
    "        }",
    "      }",
    //      retry-with-verify: success = a webview whose src is our URL AND that
    //      got laid out (width>0). Until then, keep (re)filling + submitting —
    //      idempotent, recovers from the fresh-mount race (v2) too. Abort when
    //      the entry card has been gone for ~2s straight (conversation switched
    //      away mid-retry — don't keep submitting into whatever panel became
    //      visible next; transient re-render removals re-add within 1.5s and
    //      reset the counter; a REPLACED card also counts as alive).
    "      var tries=0;",
    "      var misses=0;",
    "      var timer=window.setInterval(function(){",
    "        if(++tries>48){window.clearInterval(timer);return;}",
    "        if(document.querySelector('['+FLAG+']')){misses=0;}",
    "        else if(++misses>8){window.clearInterval(timer);return;}",
    "        var wvs=document.querySelectorAll('webview');",
    "        for(var i=0;i<wvs.length;i++){",
    "          var s=wvs[i].getAttribute('src')||'';",
    "          if((s===u||s.indexOf(u)===0)&&visible(wvs[i])){window.clearInterval(timer);return;}",
    "        }",
    //        pick the VISIBLE address input — the first in DOM order may belong
    //        to another (hidden) conversation's panel (v2 bug: waited forever)
    "        var all=document.querySelectorAll('input[data-testid=" + JSON.stringify(ADDRESS_INPUT_TESTID) + "]');",
    "        var inp=null;",
    "        for(var j=0;j<all.length;j++){if(visible(all[j])){inp=all[j];break;}}",
    "        if(!inp)return;",
    "        try{",
    "          var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;",
    "          setter.call(inp,u);",
    "        }catch(e){inp.value=u;}",
    "        inp.dispatchEvent(new window.Event('input',{bubbles:true}));",
    "        var f=inp.form||inp.closest('form');",
    "        if(f&&f.requestSubmit)f.requestSubmit();",
    "      },250);",
    "    });",
    "    list.appendChild(card);",
    "  }",
    "  install();",
    "  window.setInterval(install,1500);",
    "})();"
  ].join("\n");
}

// Pure. Expression for a Runtime.evaluate that (re)writes the target URL into
// the card's DOM attribute. base like "http://127.0.0.1:17890" (trailing
// slashes normalized). No-op when the card is not in the DOM right now.
function setEntryUrlExpression(base) {
  const url = String(base).replace(/\/+$/, "") + "/control/";
  return "(function(){var c=document.querySelector('[" + ENTRY_FLAG + "]');" +
    "if(c)c.setAttribute(" + JSON.stringify(ENTRY_URL_ATTR) + "," + JSON.stringify(url) + ");})()";
}

// Pure. The injection target is the ZCode main renderer page — identified by
// its file URL, not by cdp.filterTargets (whose job is excluding OUR tool
// pages from the generic page set; here we positively match one page kind).
function filterPageTargets(targets) {
  return targets.filter(function (t) {
    if (t.type !== "page") return false;
    if (!t.webSocketDebuggerUrl) return false;
    return (t.url || "").indexOf("/app.asar/out/renderer/index.html") !== -1;
  });
}

module.exports = {
  ENTRY_FLAG: ENTRY_FLAG,
  ENTRY_URL_ATTR: ENTRY_URL_ATTR,
  CARD_LABEL: CARD_LABEL,
  ADDRESS_INPUT_TESTID: ADDRESS_INPUT_TESTID,
  ENTRY_VERSION: ENTRY_VERSION,
  buildEntrySource: buildEntrySource,
  setEntryUrlExpression: setEntryUrlExpression,
  filterPageTargets: filterPageTargets,
  sync: sync,
  close: close,
  _reset: _reset
};

// ---- stateful manager (NOT unit-tested — cross-process CDP glue, 教训 12/13;
//      same boundary as webview-blankfix's sync/close) ----
// Map<targetId, {ws, call, base}>. sync(base) diffs /json vs registered:
// connects+registers new main-renderer targets, drops gone ones, and rewrites
// the URL attribute on every already-registered page (page reload wipes the
// DOM; port drift changes the URL; both healed on the next 3s tick). ws
// break auto-removes from the map (next sync reconnects).

const registered = new Map();
// set by close(): sync() checks it at each phase so an in-flight sync never
// registers (and leaves dangling) ws connections after teardown — that leak
// keeps the node event loop alive and hangs tests that rely on natural exit
// (epubservertest has no process.exit on success).
let closedFlag = false;
// re-entrancy guard: a slow sync (CDP timeouts) overlapping the next 3s tick
// would double-register the same target — two ws for one Map key, the first
// becomes an orphan nobody ever closes. Skip the tick instead.
let syncing = false;

async function registerTarget(cdp, target, base) {
  const connected = await cdp.connect(target.webSocketDebuggerUrl);
  const ws = connected.ws;
  const call = connected.call;
  if (closedFlag) { try { ws.close(); } catch (e) {} return; }
  // Page.enable is prerequisite for addScriptToEvaluateOnNewDocument (CDP docs)
  await call("Page.enable");
  // Card installer for ALL FUTURE documents (ZCode page reload / app restart
  // of the renderer keeps the entry without server-side re-register).
  await call("Page.addScriptToEvaluateOnNewDocument", { source: buildEntrySource() });
  // ALSO run once on the current doc — the user wants the card NOW.
  await call("Runtime.evaluate", { expression: buildEntrySource() });
  await call("Runtime.evaluate", { expression: setEntryUrlExpression(base) });
  ws.on("close", function () { registered.delete(target.id); });
  ws.on("error", function () { registered.delete(target.id); });
  registered.set(target.id, { ws: ws, call: call, base: base });
  // close() may have run while we were registering (sync/close race)
  if (closedFlag) {
    try { ws.close(); } catch (e) {}
    registered.delete(target.id);
  }
}

async function sync(base) {
  if (closedFlag || syncing) return;
  syncing = true;
  try {
    const cdp = require("./cdp.cjs");
    const all = await cdp.httpGetJson("/json");
    if (closedFlag) return;
    const current = filterPageTargets(all);
    const currentIds = new Set(current.map(function (t) { return t.id; }));

    for (const t of current) {
      if (closedFlag) break;
      if (registered.has(t.id)) continue;
      try { await registerTarget(cdp, t, base); }
      catch (e) { /* per-target fail non-fatal (mirrors webview-blankfix) */ }
    }

    for (const id of Array.from(registered.keys())) {
      if (!currentIds.has(id)) {
        try { registered.get(id).ws.close(); } catch (e) {}
        registered.delete(id);
      }
    }

    // Refresh the URL attribute on live pages (see module header). buildEntrySource
    // has no URL, so this is the ONLY port/reload-sensitive bit — cheap evaluate.
    for (const r of registered.values()) {
      if (closedFlag) break;
      try { await r.call("Runtime.evaluate", { expression: setEntryUrlExpression(base) }); }
      catch (e) { /* dead session — ws close handler removes it; next sync re-adds */ }
    }
  } finally {
    syncing = false;
  }
}

function close() {
  closedFlag = true;
  for (const id of Array.from(registered.keys())) {
    try { registered.get(id).ws.close(); } catch (e) {}
    registered.delete(id);
  }
}

// test isolation only
function _reset() { closedFlag = false; syncing = false; for (const id of Array.from(registered.keys())) registered.delete(id); }
