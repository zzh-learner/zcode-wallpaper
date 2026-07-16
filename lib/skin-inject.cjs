// Skin injection — applies a Theme to ZCode via CDP. Write-operation module
// (mirrors video-mute.cjs / webview-blankfix.cjs): independent of the read-only
// cdp.cjs, but reuses its neutral connect/listTargets/filterTargets glue.
//
// Two injected elements (ids from skin-selectors.cjs):
//   #zcode-user-skin        <style>  — colors (CSS var overrides + element rules)
//   #zcode-user-skin-chrome  <div>    — decoration layer (brand/sparkle/emoji),
//                                       pointer-events:none so it never blocks UI.
//
// applySkin(theme) is called server-side (require) NOT via spawn — theme is a
// structured object passed in the request body (spec §4.6). removeSkin() clears
// both ids. CLI entry exists for menu/standalone use.

const cdp = require("./cdp.cjs");
const sel = require("./skin-selectors.cjs");

// ---- pure renderers (unit-tested via skininjecttest.cjs) ----

// Render a theme into the CSS text for #zcode-user-skin.
// Emits:
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

  // 1) CSS variable token overrides. Set on both theme roots so it applies
  // regardless of which theme (.theme-zai-dark/.theme-zai-light) is active.
  var tokenDecls = [];
  for (var colorKey in c) {
    if (!Object.prototype.hasOwnProperty.call(c, colorKey)) continue;
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

  // 2) Element-class fallback rules.
  for (var r = 0; r < sel.SKIN_ELEMENT_RULES.length; r++) {
    var rule = sel.SKIN_ELEMENT_RULES[r];
    var propLines = [];
    for (var propName in rule.props) {
      if (!Object.prototype.hasOwnProperty.call(rule.props, propName)) continue;
      var key = rule.props[propName];
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
  if (d.brand) {
    parts.push('<div class="skin-brand"></div>');
    // brand text set via CSS content or data attr — here we put it in a span
    parts[parts.length - 1] = '<div class="skin-brand">' + escapeHtml(d.brand) + '</div>';
  }
  if (d.sparkle) {
    // 6 sparkle particles, pure CSS glow + cross light (mirror Dream Skin).
    parts.push('<div class="skin-sparkles">' +
      '<i></i><i></i><i></i><i></i><i></i><i></i></div>');
  }
  if (d.emojiBadge) {
    parts.push('<div class="skin-emoji-badge skin-emoji-' + (d.emojiPosition || "top-left") +
      '">' + escapeHtml(d.emojiBadge) + '</div>');
  }
  return parts.join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

// The CSS for the chrome wrapper itself (position/pointer-events/z-index +
// sparkle/emoji/brand styling). Appended to the <style>, not inline, so it
// can use :nth-child and pseudo-elements.
function renderSkinChromeCss(theme) {
  var accent = (theme.colors && theme.colors.accent) || "#8b3dce";
  var accentAlt = (theme.colors && theme.colors.accentAlt) || "#b45cff";
  return [
    "#" + sel.SKIN_CHROME_ID + " {",
    "  position: fixed; inset: 0; z-index: 31; pointer-events: none; overflow: hidden;",
    "}",
    "#" + sel.SKIN_CHROME_ID + " .skin-brand {",
    "  position: absolute; top: 8px; left: 16px; font-size: 13px; font-weight: 600;",
    "  color: " + accent + "; opacity: .8; text-shadow: 0 1px 2px rgba(0,0,0,.2);",
    "}",
    "#" + sel.SKIN_CHROME_ID + " .skin-sparkles { position: absolute; inset: 0; opacity: .6; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-sparkles i {",
    "  position: absolute; width: 4px; height: 4px; border-radius: 50%; background: #fff;",
    "  box-shadow: 0 0 8px 2px " + accentAlt + ";",
    "}",
    "#" + sel.SKIN_CHROME_ID + " .skin-sparkles i:nth-child(1) { left: 8%; top: 12%; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-sparkles i:nth-child(2) { left: 25%; top: 8%; opacity: .5; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-sparkles i:nth-child(3) { left: 45%; top: 15%; opacity: .8; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-sparkles i:nth-child(4) { left: 68%; top: 6%; opacity: .6; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-sparkles i:nth-child(5) { left: 85%; top: 20%; opacity: .9; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-sparkles i:nth-child(6) { left: 55%; top: 45%; opacity: .4; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-badge {",
    "  position: absolute; font-size: 20px; filter: drop-shadow(0 2px 4px rgba(0,0,0,.3));",
    "}",
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-top-left { top: 50px; left: 20px; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-top-right { top: 50px; right: 20px; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-bottom-left { bottom: 20px; left: 20px; }",
    "#" + sel.SKIN_CHROME_ID + " .skin-emoji-bottom-right { bottom: 20px; right: 20px; }"
  ].join("\n");
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
