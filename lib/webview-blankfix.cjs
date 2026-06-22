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

module.exports = { WEBVIEW_BLANKFIX_SOURCE: WEBVIEW_BLANKFIX_SOURCE };
