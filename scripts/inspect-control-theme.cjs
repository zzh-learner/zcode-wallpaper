// One-off probe: where can we read ZCode's light/dark theme from?
// Dumps on the MAIN page: prefers-color-scheme, html/body classes, key CSS
// vars, computed bg of root UI elements. On the CONTROL webview: does its
// prefers-color-scheme match the main page (nativeTheme propagation)?
// Purpose: pick a reliable theme signal for control-center theming (教训 21:
// probe real state, don't assume).
const cdp = require("../lib/cdp.cjs");

const mainExpr = `(function(){
  function bg(el){
    if(!el) return null;
    var cs = getComputedStyle(el);
    return { tag: el.tagName.toLowerCase() + (el.id ? '#'+el.id : ''), bg: cs.backgroundColor, color: cs.color };
  }
  var css = getComputedStyle(document.documentElement);
  var vars = {};
  ['--color-background','--background','--bg-color','--vscode-editor-background','--editor-background'].forEach(function(v){
    var val = css.getPropertyValue(v).trim(); if(val) vars[v] = val;
  });
  return JSON.stringify({
    href: location.href.slice(0,80),
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
    htmlClass: document.documentElement.className,
    htmlDataTheme: document.documentElement.getAttribute('data-theme'),
    bodyClass: document.body.className,
    vars: vars,
    body: bg(document.body),
    main: bg(document.querySelector('main, [role="main"]')),
    app: bg(document.getElementById('root') || document.getElementById('app'))
  });
})()`;

const controlExpr = `(function(){
  return JSON.stringify({
    href: location.href.slice(0,80),
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
    htmlDataTheme: document.documentElement.getAttribute('data-theme')
  });
})()`;

async function rawTargets() {
  // /json raw list — includes webview-type targets that listAllTargets filters out
  return cdp.httpGetJson("/json");
}

(async () => {
  const raw = await rawTargets();
  const all = raw.filter((t) => t.webSocketDebuggerUrl);
  const filtered = cdp.filterTargets(all);
  console.log("=== TARGETS ===");
  all.forEach((t) => console.log("  [" + t.type + "] " + (t.url || "").slice(0, 90)));

  const main = filtered[0];
  if (main) {
    console.log("\n=== MAIN PAGE theme signals ===");
    const c = await cdp.connect(main.webSocketDebuggerUrl);
    const r = await c.call("Runtime.evaluate", { expression: mainExpr, returnByValue: true });
    console.log(r.exceptionDetails ? "EXCEPTION: " + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result.value);
    c.ws.close();
  } else {
    console.log("\n(no filtered main page target — ZCode down or no debug port)");
  }

  const control = all.find((t) => t.webSocketDebuggerUrl && /\/control\//.test(t.url || ""));
  if (control) {
    console.log("\n=== CONTROL PAGE (webview) theme signals ===");
    const c = await cdp.connect(control.webSocketDebuggerUrl);
    const r = await c.call("Runtime.evaluate", { expression: controlExpr, returnByValue: true });
    console.log(r.exceptionDetails ? "EXCEPTION: " + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result.value);
    c.ws.close();
  } else {
    console.log("\n(control page NOT among CDP targets)");
  }
  process.exit(0);
})().catch((e) => { console.error("PROBE FAILED:", e.message); process.exit(1); });
