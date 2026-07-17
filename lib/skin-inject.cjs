// Skin injection — applies a Theme to ZCode via CDP. Write-operation module
// (mirrors video-mute.cjs / webview-blankfix.cjs): independent of the read-only
// cdp.cjs, but reuses its neutral connect/listTargets/filterTargets glue.
//
// Two injected elements (ids from skin-selectors.cjs):
//   #zcode-user-skin        <style>  — colors (CSS var overrides + element rules)
//   #zcode-user-skin-chrome  <div>    — decoration layer (sparkle/emoji badges),
//                                       pointer-events:none so it never blocks UI.
//
// applySkin(theme) is called server-side (require) NOT via spawn — theme is a
// structured object passed in the request body (spec §4.6). removeSkin() clears
// both ids. CLI entry exists for menu/standalone use.

const cdp = require("./cdp.cjs");
const sel = require("./skin-selectors.cjs");
const skinModel = require("./skin.cjs");

// ---- pure renderers (unit-tested via skininjecttest.cjs) ----

// Render a theme into CSS for #zcode-user-skin (spec §4 frosted-glass, color-mix).
// NO themeColors parameter — color-mix + var() lets the CSS engine resolve
// ZCode's native theme vars at runtime in the browser. Spec §3.3 (v2 after spike).
// Emits:
//   0) OVERLAY rules (when theme.overlay.enabled): color-mix(var(--base), N%, transparent)
//      + backdrop-filter:blur() on 3 element selectors. 底色真跟随主题.
//   1) font override if theme.font set
//   2) radius override if theme.radius set
function renderSkinCss(theme) {
  var lines = ["/* ZCode skin: " + (theme.name || "unnamed") + " */"];
  var ov = theme.overlay || {};

  if (ov.enabled) {
    var regions = [
      { name: "panel", selector: sel.OVERLAY_REGION_SELECTORS.panel, baseVar: sel.FROST_BASE_VARS.panel, opacity: ov.panelOpacity, blur: ov.panelBlur },
      { name: "input", selector: sel.OVERLAY_REGION_SELECTORS.input, baseVar: sel.FROST_BASE_VARS.input, opacity: ov.inputOpacity, blur: ov.inputBlur },
      { name: "sidebar", selector: sel.OVERLAY_REGION_SELECTORS.sidebar, baseVar: sel.FROST_BASE_VARS.sidebar, opacity: ov.sidebarOpacity, blur: ov.sidebarBlur }
    ];
    lines.push("/* frosted glass overlay: wallpaper coexistence */");
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i];
      var opPct = isFinite(r.opacity) ? Math.max(0, Math.min(100, Number(r.opacity))) : 100;
      var colorMix = "color-mix(in srgb, var(" + r.baseVar + ") " + opPct + "%, transparent)";
      var blurDecl = r.blur > 0
        ? " backdrop-filter: blur(" + r.blur + "px) !important; -webkit-backdrop-filter: blur(" + r.blur + "px) !important;"
        : "";
      lines.push(r.selector + " { background-color: " + colorMix + " !important;" + blurDecl + " }");
    }
  }

  if (theme.font && typeof theme.font === "string" && theme.font.trim()) {
    lines.push("* { font-family: " + JSON.stringify(theme.font.trim()) + " !important; }");
  }

  if (theme.radius != null && theme.radius !== "" && isFinite(Number(theme.radius))) {
    var rad = Number(theme.radius);
    lines.push(".bg-input, button, [class*='card'], [class*='rounded'] { border-radius: " + rad + "px !important; }");
  }

  return lines.join("\n");
}

// Render the decoration chrome HTML for a theme.
// Returns an HTML string for #zcode-user-skin-chrome's innerHTML.
// Each piece is optional (null/false = skip). The wrapper is
// position:fixed; pointer-events:none; z-index:31 (set by CSS, not here).
function renderSkinChrome(theme) {
  var d = theme.decorations || {};
  var parts = [];
  if (d.sparkle) {
    // Sparkle particles: count from theme.sparkleCount (default 12, was 6).
    // Each particle is an <i>. Positions are generated programmatically in
    // renderSkinChromeCss (no hardcoded nth-child) so any count distributes
    // reasonably across the viewport.
    var count = isFinite(d.sparkleCount) && d.sparkleCount != null ? Math.max(0, Math.min(50, Number(d.sparkleCount))) : 12;
    var is = "";
    for (var i = 0; i < count; i++) is += "<i></i>";
    parts.push('<div class="skin-sparkles">' + is + '</div>');
  }
  // emoji badges: iterate the normalized array (handles BOTH new array form
  // d.emojiBadges AND legacy single form d.emojiBadge+d.emojiPosition via
  // the model's normalizeEmojiBadges). Multiple badges render at their own
  // positions so a theme can decorate many spots (spec §decorations expansion).
  var badges = normalizeBadgesForRender(d);
  for (var bi = 0; bi < badges.length; bi++) {
    var badge = badges[bi];
    parts.push('<div class="skin-emoji-badge skin-emoji-' + badge.position +
      '">' + escapeHtml(badge.emoji) + '</div>');
  }
  return parts.join("");
}

// Local badge normalizer (mirrors skin.cjs normalizeEmojiBadges so the renderer
// doesn't need to require skin.cjs — keeps skin-inject.cjs dependency-light).
// Accepts array form or legacy single form. Drops empty/invalid entries.
function normalizeBadgesForRender(d) {
  if (!d || typeof d !== "object") return [];
  var POSITIONS = ["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"];
  var out = [];
  if (Array.isArray(d.emojiBadges)) {
    for (var i = 0; i < d.emojiBadges.length; i++) {
      var b = d.emojiBadges[i];
      if (!b || typeof b !== "object") continue;
      var em = (b.emoji != null ? String(b.emoji) : "").trim();
      if (!em) continue;
      var pos = POSITIONS.indexOf(b.position) >= 0 ? b.position : "top-left";
      out.push({ emoji: em, position: pos });
    }
    return out;
  }
  if (d.emojiBadge != null && String(d.emojiBadge).trim()) {
    var pos2 = POSITIONS.indexOf(d.emojiPosition) >= 0 ? d.emojiPosition : "top-left";
    out.push({ emoji: String(d.emojiBadge).trim(), position: pos2 });
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

// The CSS for the chrome wrapper itself (position/pointer-events/z-index +
// sparkle/emoji styling). Appended to the <style>, not inline, so it
// can use :nth-child and pseudo-elements.
function renderSkinChromeCss(theme) {
  // sparkle glow: follow ZCode theme accent (spec §4.4). Use CSS var() with
  // hex fallback — if ZCode renames --color-brand, falls back to purple.
  var accentColor = "var(" + sel.FROST_BASE_VARS.accent + ", #b45cff)";
  var d = theme.decorations || {};
  var rules = [
    "#" + sel.SKIN_CHROME_ID + " {",
    "  position: fixed; inset: 0; z-index: 31; pointer-events: none; overflow: hidden;",
    "}",
    "#" + sel.SKIN_CHROME_ID + " .skin-sparkles { position: absolute; inset: 0; opacity: .6; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-sparkles i {",
    "  position: absolute; width: 4px; height: 4px; border-radius: 50%; background: #fff;",
    "  box-shadow: 0 0 8px 2px " + accentColor + ";",
    // Two stacked animations: twinkle (opacity/scale pulse) + float (position
    // drift). Per-particle float keyframes (skin-float-N) are generated below
    // with random endpoints via Math.random() — so positions differ every
    // applySkin call. The nth-child rule below sets the per-particle animation
    // combo + staggered twinkle delay.
    "}",
    // twinkle pulse: opacity 0.2 -> 1 -> 0.2 + slight scale (breathing stars).
    "@keyframes skin-twinkle {",
    "  0%, 100% { opacity: 0.2; }",
    "  50% { opacity: 1; }",
    "}",
    // Accessibility: respect prefers-reduced-motion. Stops both animations;
    // particles show at base opacity in their initial random position.
    "@media (prefers-reduced-motion: reduce) {",
    "  #" + sel.SKIN_CHROME_ID + " .skin-sparkles i { animation: none !important; opacity: .6 !important; }",
    "}",
  ];
  // Per-particle: random start position + a slow drift path via dedicated
  // @keyframes skin-float-N. Positions use Math.random() so every applySkin
  // produces a different layout (truly random, non-reproducible per user wish).
  // Drift range kept moderate (±12% from start) so particles stay spread out
  // and don't all clump in one corner over time.
  if (d.sparkle) {
    var count = isFinite(d.sparkleCount) && d.sparkleCount != null ? Math.max(0, Math.min(50, Number(d.sparkleCount))) : 12;
    for (var i = 0; i < count; i++) {
      // random start position (3-97% to keep particles off the very edges)
      var startLeft = (3 + Math.random() * 94).toFixed(1);
      var startTop = (3 + Math.random() * 94).toFixed(1);
      // random drift offsets (±12%), 3 waypoints for organic non-linear path
      var d1l = (Math.random() * 24 - 12).toFixed(1);
      var d1t = (Math.random() * 24 - 12).toFixed(1);
      var d2l = (Math.random() * 24 - 12).toFixed(1);
      var d2t = (Math.random() * 24 - 12).toFixed(1);
      // drift period: 14-22s per particle (varied so they don't sync)
      var period = (14 + Math.random() * 8).toFixed(1);
      // twinkle delay: stagger across 3s so blinks are out of phase
      var twDelay = ((i * 0.37) % 3).toFixed(2);
      // dedicated float keyframes for this particle (translate from start)
      rules.push("@keyframes skin-float-" + i + " {");
      rules.push("  0%, 100% { transform: translate(0, 0); }");
      rules.push("  33% { transform: translate(" + d1l + "px, " + d1t + "px); }");
      rules.push("  66% { transform: translate(" + d2l + "px, " + d2t + "px); }");
      rules.push("}");
      // this particle: start position + both animations + twinkle delay
      rules.push("#" + sel.SKIN_CHROME_ID + " .skin-sparkles i:nth-child(" + (i + 1) + ") {");
      rules.push("  left: " + startLeft + "%; top: " + startTop + "%;");
      rules.push("  animation: skin-twinkle 3s ease-in-out " + twDelay + "s infinite, skin-float-" + i + " " + period + "s ease-in-out infinite;");
      rules.push("}");
    }
  }
  rules.push("#" + sel.SKIN_CHROME_ID + " .skin-emoji-badge {",
    "  position: absolute; font-size: 20px; filter: drop-shadow(0 2px 4px rgba(0,0,0,.3));",
    "  z-index: 1;",
    "}",
    // 8 anchor positions (4 corners + 4 edge midpoints). Corners offset from
    // edges by 20px; top-* sit below the top bar (50px); middle-* vertically
    // centered via top:50%+translate.
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-top-left { top: 50px; left: 20px; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-top-center { top: 50px; left: 50%; transform: translateX(-50%); }",
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-top-right { top: 50px; right: 20px; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-middle-left { top: 50%; left: 20px; transform: translateY(-50%); }",
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-middle-right { top: 50%; right: 20px; transform: translateY(-50%); }",
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-bottom-left { bottom: 20px; left: 20px; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-bottom-center { bottom: 20px; left: 50%; transform: translateX(-50%); }",
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-bottom-right { bottom: 20px; right: 20px; }"
  );
  return rules.join("\n");
}

// Build the JS expression for Runtime.evaluate that injects (or refreshes)
// the skin. Idempotent: removes existing #zcode-user-skin + chrome first.
// Stores theme name as data-theme-name on the style for status probe.
function buildSkinExpression(theme) {
  var cssText = renderSkinCss(theme) + "\n" + renderSkinChromeCss(theme);
  var chromeHtml = renderSkinChrome(theme);
  var styleId = sel.SKIN_STYLE_ID;
  var chromeId = sel.SKIN_CHROME_ID;
  var themeName = (theme.name || "").replace(/'/g, "");
  return [
    "(function(){",
    "  var sid=" + JSON.stringify(styleId) + ";",
    "  var cid=" + JSON.stringify(chromeId) + ";",
    "  var oldS=document.getElementById(sid); if(oldS) oldS.remove();",
    "  var oldC=document.getElementById(cid); if(oldC) oldC.remove();",
    "  var s=document.createElement('style'); s.id=sid;",
    "  s.setAttribute('data-theme-name'," + JSON.stringify(themeName) + ");",
    "  s.textContent=" + JSON.stringify(cssText) + ";",
    "  (document.head||document.documentElement).appendChild(s);",
    "  var c=document.createElement('div'); c.id=cid; c.setAttribute('aria-hidden','true');",
    "  c.innerHTML=" + JSON.stringify(chromeHtml) + ";",
    "  document.body.appendChild(c);",
    "  return 'ok';",
    "})()"
  ].join("");
}

// Build the remove expression: clear both skin ids.
function buildSkinRemoveExpression() {
  var styleId = sel.SKIN_STYLE_ID;
  var chromeId = sel.SKIN_CHROME_ID;
  return [
    "(function(){",
    "  var sid=" + JSON.stringify(styleId) + "; var cid=" + JSON.stringify(chromeId) + ";",
    "  var s=document.getElementById(sid); var c=document.getElementById(cid);",
    "  var did=false; if(s){s.remove();did=true;} if(c){c.remove();did=true;}",
    "  return did?'removed':'none';",
    "})()"
  ].join("");
}

// Build the verify expression: read back whether the skin style is present.
function buildSkinVerifyExpression() {
  var styleId = sel.SKIN_STYLE_ID;
  return "(document.getElementById(" + JSON.stringify(styleId) + ")?'effect':'noeffect')";
}

// ---- CDP application (requires live ZCode; not unit-tested, real-machine only) ----

// Apply a theme to all ZCode page targets. Returns {affected, total}.
// Throws on CDP connect failure (caller catches). Mirrors inject.cjs retry shape.
async function applySkin(theme, opts) {
  var o = opts || {};
  var expression = buildSkinExpression(theme);
  var verify = buildSkinVerifyExpression();
  var targets = await cdp.listTargets();
  var affected = 0;
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    var ws;
    try {
      var r = await cdp.connect(t.webSocketDebuggerUrl);
      ws = r.ws; var call = r.call;
      await call("Runtime.evaluate", { expression: expression, returnByValue: true });
      var vres = await call("Runtime.evaluate", { expression: verify, returnByValue: true });
      var v = vres.result && vres.result.value;
      try { ws.close(); } catch (e) {}
      if (v === "effect") affected++;
    } catch (e) {
      if (ws) { try { ws.close(); } catch (_) {} }
    }
  }
  return { affected: affected, total: targets.length };
}

// Remove skin from all ZCode page targets. Returns {affected, total}.
async function removeSkin() {
  var expression = buildSkinRemoveExpression();
  var verify = "(document.getElementById(" + JSON.stringify(sel.SKIN_STYLE_ID) + ")?'present':'gone')";
  var targets = await cdp.listTargets();
  var affected = 0;
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    var ws;
    try {
      var r = await cdp.connect(t.webSocketDebuggerUrl);
      ws = r.ws; var call = r.call;
      await call("Runtime.evaluate", { expression: expression, returnByValue: true });
      var vres = await call("Runtime.evaluate", { expression: verify, returnByValue: true });
      var v = vres.result && vres.result.value;
      try { ws.close(); } catch (e) {}
      if (v === "gone") affected++;
    } catch (e) {
      if (ws) { try { ws.close(); } catch (_) {} }
    }
  }
  return { affected: affected, total: targets.length };
}

module.exports = {
  renderSkinCss: renderSkinCss,
  renderSkinChrome: renderSkinChrome,
  renderSkinChromeCss: renderSkinChromeCss,
  buildSkinExpression: buildSkinExpression,
  buildSkinRemoveExpression: buildSkinRemoveExpression,
  buildSkinVerifyExpression: buildSkinVerifyExpression,
  applySkin: applySkin,
  removeSkin: removeSkin,
  SKIN_STYLE_ID: sel.SKIN_STYLE_ID,
  SKIN_CHROME_ID: sel.SKIN_CHROME_ID
};
