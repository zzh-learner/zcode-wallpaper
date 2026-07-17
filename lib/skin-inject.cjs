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

// Render a theme into the CSS text for #zcode-user-skin.
// Emits:
//   0) OVERLAY rules (when theme.overlay.enabled): semi-transparent panel/input/
//      sidebar backgrounds via rgba(), on element selectors (NOT CSS vars) so
//      they survive wallpaper.css's --color-background:transparent !important.
//      This is the wallpaper+skin coexistence mechanism (spec §overlay).
//   1) CSS variable overrides on .theme-zai-dark / .theme-zai-light roots
//      (robust to class-name churn — ZCode's whole UI reads these tokens)
//   2) element-class fallback rules from SKIN_ELEMENT_RULES
//   3) font override (whole tree) if theme.font set
//   4) radius override (input/cards/buttons) if theme.radius set
// Each rule uses !important so injected <style> (loaded after ZCode's own)
// wins. null theme values are skipped (null = "don't override").
function renderSkinCss(theme) {
  var lines = ["/* ZCode skin: " + (theme.name || "unnamed") + " */"];
  var c = theme.colors || {};

  // 0) OVERLAY mode: wallpaper coexistence. When enabled, render panel/input/
  //    sidebar backgrounds as rgba(hex, opacity) on ELEMENT selectors. Element
  //    selectors (specificity 0,1,0) override wallpaper's var-based transparent
  //    (which cascades through --color-background inheritance). This is what
  //    lets wallpaper show through semi-transparent UI panels.
  //    Body background is left alone (wallpaper owns it via body background-image).
  var ov = theme.overlay || {};
  if (ov.enabled) {
    var overlayRules = [];
    if (ov.panelBg) {
      var pr = skinModel.hexToRgba(ov.panelBg, ov.panelOpacity);
      // panel = ZCode main content area (the AI conversation + composer region).
      // Real-machine probe (2026-07-17): `main` is 883x982 covering the whole
      // conversation+input region. The old .bg-surface selector hit 24 random
      // tiny elements and missed the actual content area entirely.
      if (pr) overlayRules.push("main, [role='main'] { background-color: " + pr + " !important; }");
    }
    if (ov.inputBg) {
      var ir = skinModel.hexToRgba(ov.inputBg, ov.inputOpacity);
      // input = ALL input controls: composer region (the chat box) + every
      // .bg-input element (settings text fields, search boxes, etc). Real probe:
      // .chat-composer-region is the 868x122 chat box; .bg-input covers the rest.
      if (ir) overlayRules.push(".chat-composer-region, .bg-input, .focus-within\\:bg-input-focused { background-color: " + ir + " !important; }");
    }
    if (ov.sidebarBg) {
      var sr = skinModel.hexToRgba(ov.sidebarBg, ov.sidebarOpacity);
      if (sr) overlayRules.push("#sidebar, aside.h-full { background-color: " + sr + " !important; }");
    }
    if (overlayRules.length) {
      lines.push("/* overlay mode: wallpaper coexistence (rgba panels) */");
      for (var oi = 0; oi < overlayRules.length; oi++) lines.push(overlayRules[oi]);
    }
  }


  // 1) CSS variable token overrides. Set on both theme roots so it applies
  // regardless of which theme (.theme-zai-dark/.theme-zai-light) is active.
  // In overlay mode, skip the background/panel/sidebar/inputBg tokens — those
  // are handled by the overlay's rgba element rules above, and setting the
  // var here would clash with wallpaper.css's transparent override.
  var overlaySkip = ov && ov.enabled
    ? { background: true, panel: true, sidebarBg: true, inputBg: true }
    : {};
  var tokenDecls = [];
  for (var colorKey in c) {
    if (!Object.prototype.hasOwnProperty.call(c, colorKey)) continue;
    if (overlaySkip[colorKey]) continue; // overlay handles these via element rules
    var val = c[colorKey];
    if (!val) continue; // null/empty = skip
    var tokens = sel.COLOR_TO_TOKENS[colorKey] || [];
    for (var i = 0; i < tokens.length; i++) {
      tokenDecls.push(tokens[i] + ": " + val + " !important;");
    }
  }
  if (tokenDecls.length) {
    lines.push(".theme-zai-dark, .theme-zai-light {");
    lines.push("  " + tokenDecls.join("\n  "));
    lines.push("}");
  }

  // 2) Element-class fallback rules. In overlay mode, skip body's
  //    backgroundColor (wallpaper owns body bg); keep body color + other rules.
  var overlayOn = ov && ov.enabled;
  for (var r = 0; r < sel.SKIN_ELEMENT_RULES.length; r++) {
    var rule = sel.SKIN_ELEMENT_RULES[r];
    var propLines = [];
    for (var propName in rule.props) {
      if (!Object.prototype.hasOwnProperty.call(rule.props, propName)) continue;
      var key = rule.props[propName];
      // overlay mode: wallpaper owns body background, skip it
      if (overlayOn && rule.selector === "body" && propName === "backgroundColor") continue;
      var v = c[key];
      if (v) propLines.push(propName + ": " + v + " !important;");
    }
    if (propLines.length) {
      lines.push(rule.selector + " { " + propLines.join(" ") + " }");
    }
  }

  // 3) Font override (whole tree) — only if theme.font is a non-empty string.
  if (theme.font && typeof theme.font === "string") {
    lines.push('html body, html body * { font-family: ' + JSON.stringify(theme.font) + ' !important; }');
  }

  // 4) Radius override — applies to the composer input, cards, and primary
  // buttons. ZCode's input is .bg-input.rounded-2xl; buttons .rounded-lg.
  if (theme.radius != null && theme.radius !== "" && isFinite(Number(theme.radius))) {
    var rad = Number(theme.radius);
    lines.push(".bg-input, .rounded-2xl { border-radius: " + rad + "px !important; }");
    lines.push("button.bg-brand, .rounded-lg { border-radius: " + Math.max(4, Math.round(rad / 2)) + "px !important; }");
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
  var accentAlt = (theme.colors && theme.colors.accentAlt) || "#b45cff";
  var d = theme.decorations || {};
  var rules = [
    "#" + sel.SKIN_CHROME_ID + " {",
    "  position: fixed; inset: 0; z-index: 31; pointer-events: none; overflow: hidden;",
    "}",
    "#" + sel.SKIN_CHROME_ID + " .skin-sparkles { position: absolute; inset: 0; opacity: .6; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-sparkles i {",
    "  position: absolute; width: 4px; height: 4px; border-radius: 50%; background: #fff;",
    "  box-shadow: 0 0 8px 2px " + accentAlt + ";",
    "  animation: skin-twinkle 3s ease-in-out infinite;",
    "}",
    // twinkle pulse: opacity 0.2 -> 1 -> 0.2 + slight scale, so particles
    // breathe like stars. 3s period; per-particle animation-delay (below)
    // staggers them so they don't all blink in unison.
    "@keyframes skin-twinkle {",
    "  0%, 100% { opacity: 0.2; transform: scale(0.5); }",
    "  50% { opacity: 1; transform: scale(1.2); }",
    "}",
    // Accessibility: respect prefers-reduced-motion (user set OS to minimize
    // animation). Stops the pulse; particles show at their base opacity.
    "@media (prefers-reduced-motion: reduce) {",
    "  #" + sel.SKIN_CHROME_ID + " .skin-sparkles i { animation: none !important; opacity: .6 !important; }",
    "}",
  ];
  // Sparkle positions: generate one :nth-child(N) rule per particle.
  // Position is deterministic-but-spread using a hash of the index (no CSS
  // random available). This scales to any sparkleCount instead of the old
  // hardcoded 6 fixed positions. animation-delay staggers the twinkle so
  // particles light up at different times (collective-blink avoidance).
  if (d.sparkle) {
    var count = isFinite(d.sparkleCount) && d.sparkleCount != null ? Math.max(0, Math.min(50, Number(d.sparkleCount))) : 12;
    for (var i = 0; i < count; i++) {
      // pseudo-random but deterministic: golden-angle distribution + index hash
      var leftPct = ((i * 61.8) % 100 + (i * 37 % 13)) % 100;
      var topPct = ((i * 38.2 + 7) % 95) + 2; // keep 2-97% vertical range
      // delay: spread across the 3s period so particles twinkle out-of-phase.
      // (i * 0.37s mod 3s) — irrational-ish step avoids visible patterns.
      var delay = ((i * 0.37) % 3).toFixed(2);
      rules.push("#" + sel.SKIN_CHROME_ID + " .skin-sparkles i:nth-child(" + (i + 1) + ") { " +
        "left: " + leftPct.toFixed(1) + "%; top: " + topPct.toFixed(1) + "%; animation-delay: " + delay + "s; }");
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
