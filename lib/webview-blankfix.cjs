// webview _blank link fix (spec 2026-06-22-webview-blankfix-design).
// WHY a separate module (not in cdp.cjs): cdp.cjs is READ-ONLY by design
// (AGENTS.md). Stripping target=_blank is a WRITE op. Keeping it out of cdp.cjs
// preserves the read-only invariant — mirrors video-mute.cjs's positioning.
// But this module REUSES cdp.connect + cdp.httpGetJson (neutral plumbing) —
// no duplicated CDP glue (教训 1).

// JS injected into every non-tool webview page via
// Page.addScriptToEvaluateOnNewDocument. Runs before each new document load.
// Three guarantees (spec §3):
//   1. Strip existing <a target=_blank> on current doc
//   2. MutationObserver catches dynamically-rendered links (SPA)
//   3. capture-phase click catches links added after observer setup
// Idempotent via window.__zzBlankFix guard (prevents observer pile-up on rerun).
const WEBVIEW_BLANKFIX_SOURCE = [
  "(function(){",
  "  if(window.__zzBlankFix)return;",
  "  window.__zzBlankFix=true;",
  "  window.__zzBlankFixCount=0;",
  "  function strip(a){",
  "    if(a&&a.tagName==='A'&&",
  "       (a.getAttribute('target')==='_blank'||a.target==='_blank')){",
  "      a.removeAttribute('target');",
  "      window.__zzBlankFixCount++;",
  "    }",
  "  }",
  "  var all=document.querySelectorAll('a[target=\"_blank\"]');",
  "  for(var i=0;i<all.length;i++)strip(all[i]);",
  "  new MutationObserver(function(muts){",
  "    for(var i=0;i<muts.length;i++){",
  "      for(var j=0;j<muts[i].addedNodes.length;j++){",
  "        var n=muts[i].addedNodes[j];",
  "        if(n.nodeType!==1)continue;",
  "        if(n.tagName==='A')strip(n);",
  "        if(n.querySelectorAll){",
  "          var inner=n.querySelectorAll('a[target=\"_blank\"]');",
  "          for(var k=0;k<inner.length;k++)strip(inner[k]);",
  "        }",
  "      }",
  "    }",
  "  }).observe(document.documentElement,{childList:true,subtree:true});",
  "  document.addEventListener('click',function(e){",
  "    try{",
  "      var a=e.target&&e.target.closest?e.target.closest('a'):null;",
  "      if(a)strip(a);",
  "    }catch(x){}",
  "  },true);",
  "})();"
].join("\n");

// Pure: filter /json targets to "real external-site webviews" (spec §5).
// Mirrors cdp.cjs filterTargets' exclusion rules (devtools + our tool pages)
// but on type==="webview" instead of type==="page". Kept in sync by
// webviewblankfixtest.cjs mirror-consistency assertion (教训 17).
// Excludes: non-webview types, no wsUrl, devtools://, localhost/127.0.0.1
// any-port /control/ /reader/ /api/ paths.
function filterWebviewTargets(targets) {
  return targets.filter(function (t) {
    if (t.type !== "webview") return false;
    if (!t.webSocketDebuggerUrl) return false;
    var url = t.url || "";
    if (url.indexOf("devtools://") === 0) return false;
    var m = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.exec(url);
    if (m) {
      var pathPrefix = m[3] || "/";
      if (pathPrefix.indexOf("/control/") === 0 ||
          pathPrefix.indexOf("/reader/") === 0 ||
          pathPrefix.indexOf("/api/") === 0) return false;
    }
    return true;
  });
}

module.exports = {
  WEBVIEW_BLANKFIX_SOURCE: WEBVIEW_BLANKFIX_SOURCE,
  filterWebviewTargets: filterWebviewTargets,
  sync: sync,
  close: close,
  _reset: _reset
};

// ---- stateful manager (NOT unit-tested — cross-process CDP glue, 教训 12/13) ----
// Maintains Map<targetId, {ws, call}>. sync() diffs current /json vs registered
// set: connects+registers new targets, disconnects gone ones. ws break auto-
// removes from map (next sync reconnects). close() tears down everything.
//
// WHY no test: connect/ws lifecycle is cross-process glue. Verified by real-
// machine checklist (spec §8). Mirrors video-mute.cjs's setVideoMuted being
// untested (only buildMuteExpression pure fn is tested).

const registered = new Map(); // targetId -> {ws, call}

async function registerTarget(cdp, target) {
  const connected = await cdp.connect(target.webSocketDebuggerUrl);
  const ws = connected.ws;
  const call = connected.call;
  // Page.enable is prerequisite for addScriptToEvaluateOnNewDocument (CDP docs)
  await call("Page.enable");
  // Register script for ALL FUTURE new documents (no空窗 across navigations)
  await call("Page.addScriptToEvaluateOnNewDocument", { source: WEBVIEW_BLANKFIX_SOURCE });
  // ALSO run once on current doc — addScriptToEvaluateOnNewDocument only fires
  // on FUTURE docs, but the user's _blank links are on the CURRENT doc right now
  // (spec §6 决策 4 — this is what makes the user's complaint actually get fixed)
  await call("Runtime.evaluate", { expression: WEBVIEW_BLANKFIX_SOURCE });
  // auto-remove on disconnect (webview crash/session lost/ZCode restart)
  ws.on("close", function () { registered.delete(target.id); });
  ws.on("error", function () { registered.delete(target.id); });
  registered.set(target.id, { ws: ws, call: call });
}

async function sync() {
  const cdp = require("./cdp.cjs");
  const all = await cdp.httpGetJson("/json");
  const current = filterWebviewTargets(all);
  const currentIds = new Set(current.map(function (t) { return t.id; }));

  // register new targets (current - registered)
  for (const t of current) {
    if (registered.has(t.id)) continue;
    try { await registerTarget(cdp, t); }
    catch (e) { /* per-target fail non-fatal (mirrors video-mute.cjs) */ }
  }

  // disconnect gone targets (registered - current)
  for (const id of Array.from(registered.keys())) {
    if (!currentIds.has(id)) {
      try { registered.get(id).ws.close(); } catch (e) {}
      registered.delete(id);
    }
  }
}

function close() {
  for (const id of Array.from(registered.keys())) {
    try { registered.get(id).ws.close(); } catch (e) {}
    registered.delete(id);
  }
}

// reset for test isolation (not exported in prod, but harmless)
function _reset() { for (const id of Array.from(registered.keys())) registered.delete(id); }
