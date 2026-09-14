// E2E verify for control-center theming (教训 12/13: 跨进程胶水真机验).
// Signals (2026-09 真机结论): webview matchMedia 跟随 ZCode 深浅切换（可信）；
// ZCode <html> 的 theme-zai-* class 不跟随（不可信，CDP class 探测已撤销）。
// Checks, on the real control page (must be open in a CDP-visible webview):
//   1) data-theme resolves dark/light per matchMedia
//   2) theme vars actually applied (panel bg / text color / text-shadow)
//   3) body.no-wallpaper backdrop: when no wallpaper injected, page paints
//      opaque --page-bg (ZCode webview 内联白底不再漏出)
// Note: webview 类 CDP target 只有面板开着才在 /json 里（2026-09 观察）。
const cdp = require("../lib/cdp.cjs");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const cssExpr = `(function(){
  function cs(el, prop){ return el ? getComputedStyle(el)[prop] : null; }
  return JSON.stringify({
    dataTheme: document.documentElement.getAttribute('data-theme'),
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
    colorScheme: cs(document.documentElement, 'colorScheme'),
    noWallpaper: document.body.classList.contains('no-wallpaper'),
    bodyBg: cs(document.body, 'backgroundColor'),
    panelBg: cs(document.querySelector('.panel'), 'backgroundColor'),
    bodyColor: cs(document.body, 'color'),
    textShadow: cs(document.body, 'textShadow'),
    toggleText: (document.getElementById('theme-toggle')||{}).textContent || null,
    toggleTitle: (document.getElementById('theme-toggle')||{}).title || null,
    statusMode: null
  });
})()`;

(async () => {
  let bad = 0;
  function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); if (!cond) bad++; }

  const raw = await cdp.httpGetJson("/json");
  const ctrls = raw.filter((t) => t.webSocketDebuggerUrl && /\/control\//.test(t.url || ""));
  if (!ctrls.length) { console.log("FAIL ✗ control page not in CDP targets (panel closed? open it and re-run)"); process.exit(1); }
  // /json 里可能有多条 /control/ 条目（含已死的），逐个尝试直到连通
  let c = null;
  for (const t of ctrls) {
    try {
      c = await cdp.connect(t.webSocketDebuggerUrl);
      await c.call("Page.enable");
      break;
    } catch (e) { c = null; }
  }
  if (!c) { console.log("FAIL ✗ no live /control/ target"); process.exit(1); }
  await c.call("Page.reload");
  await sleep(2500);
  const r = await c.call("Runtime.evaluate", { expression: cssExpr, returnByValue: true });
  c.ws.close();
  if (r.exceptionDetails) { console.log("FAIL ✗ evaluate: " + JSON.stringify(r.exceptionDetails).slice(0, 300)); process.exit(1); }
  const css = JSON.parse(r.result.value);
  console.log("  control page css:", JSON.stringify(css, null, 2));

  const wantDark = css.prefersDark;
  check("data-theme=" + (wantDark ? "dark" : "light") + " follows matchMedia", css.dataTheme === (wantDark ? "dark" : "light"));
  check("color-scheme synced", css.colorScheme === (wantDark ? "dark" : "light"));
  check("toggle button rendered with emoji", css.toggleText === "🌙" || css.toggleText === "☀️");
  check("toggle title shows 跟随 ZCode (auto)", /跟随 ZCode/.test(css.toggleTitle || ""));
  if (wantDark) {
    check("dark: panel is dark glass", /^rgba\((1\d|2\d|[3-5]\d),/.test(css.panelBg || ""));
    check("dark: text is light", /^rgba?\((2[0-9][0-9]|1[89][0-9]),/.test(css.bodyColor || ""));
    check("dark: text-shadow present", css.textShadow !== "none");
  } else {
    check("light: panel is light glass (r>200)", /^rgba?\((2[0-9][0-9]|1[89][0-9]),/.test(css.panelBg || ""));
    check("light: text is dark (r<100)", /^rgba?\((\d|[1-9][0-9]),/.test(css.bodyColor || ""));
    check("light: text-shadow none", css.textShadow === "none");
  }
  if (css.noWallpaper) {
    // opaque themed backdrop covers the webview's inline white
    const m = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(css.bodyBg || "");
    const opaque = m && (m[4] === undefined || parseFloat(m[4]) >= 0.99);
    const lum = m ? (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255 : null;
    check("no-wallpaper: body bg opaque", opaque);
    check("no-wallpaper: body bg matches theme luminance", lum !== null && (wantDark ? lum < 0.35 : lum > 0.65));
  } else {
    console.log("  (wallpaper injected — transparent A1 mode, backdrop checks skipped)");
  }

  console.log("\n" + (bad === 0 ? "ALL PASS" : bad + " FAILED"));
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
