// Test lib/skin-inject.cjs pure renderers (spec §7). Mirrors videomutetest.cjs
// style. CDP application (applySkin/removeSkin) is cross-process glue, NOT
// unit-tested — verified by real-machine checklist (spec §8, lesson 12/13).
var si = require("../lib/skin-inject.cjs");
var sel = require("../lib/skin-selectors.cjs");
var pass = 0, fail = 0;
function check(n, c) { console.log((c ? "PASS ✓ " : "FAIL ✗ ") + n); c ? pass++ : fail++; }

// === renderSkinCss: token overrides ===
var css = si.renderSkinCss({ name: "t", colors: { accent: "#8b3dce", background: "#fff" } });
check("css has accent token", css.indexOf("--color-brand: #8b3dce") >= 0 || css.indexOf("--color-primary: #8b3dce") >= 0);
check("css has background token", css.indexOf("--color-background: #fff") >= 0);
check("css has !important", css.indexOf("!important") >= 0);
check("css targets theme roots", css.indexOf(".theme-zai-dark, .theme-zai-light") >= 0);

// === renderSkinCss: null colors skipped ===
var cssNull = si.renderSkinCss({ name: "t", colors: { accent: null, background: "" } });
check("null accent not emitted", cssNull.indexOf("--color-brand:") < 0);
check("empty background not emitted", cssNull.indexOf("--color-background:") < 0);

// === renderSkinCss: font override only when set ===
var cssFont = si.renderSkinCss({ name: "t", colors: {}, font: "Microsoft YaHei" });
check("font emitted when set", cssFont.indexOf("font-family:") >= 0 && cssFont.indexOf("Microsoft YaHei") >= 0);
var cssNoFont = si.renderSkinCss({ name: "t", colors: {}, font: null });
check("font skipped when null", cssNoFont.indexOf("font-family:") < 0);
var cssEmptyFont = si.renderSkinCss({ name: "t", colors: {}, font: "" });
check("font skipped when empty", cssEmptyFont.indexOf("font-family:") < 0);

// === renderSkinCss: radius override ===
var cssRad = si.renderSkinCss({ name: "t", colors: {}, radius: 20 });
check("radius emitted", cssRad.indexOf("border-radius: 20px") >= 0);
check("radius targets .bg-input", cssRad.indexOf(".bg-input") >= 0);
var cssNoRad = si.renderSkinCss({ name: "t", colors: {}, radius: null });

// === renderSkinCss: overlay mode (wallpaper coexistence) ===
var cssOv = si.renderSkinCss({ name: "t", colors: { accent: "#abc" }, overlay: { enabled: true, panelBg: "#1a1410", panelOpacity: 85, inputBg: "#2a2118", inputOpacity: 90, sidebarBg: "#15110d", sidebarOpacity: 80 } });
check("overlay section present", cssOv.indexOf("overlay mode") >= 0);
check("overlay panel rgba emitted", cssOv.indexOf("rgba(26, 20, 16, 0.85)") >= 0);
check("overlay input rgba emitted", cssOv.indexOf("rgba(42, 33, 24, 0.9)") >= 0);
check("overlay sidebar rgba emitted", cssOv.indexOf("rgba(21, 17, 13, 0.8)") >= 0);
check("overlay targets main content area", cssOv.indexOf("main, [role='main']") >= 0);
check("overlay targets composer region", cssOv.indexOf(".chat-composer-region") >= 0);
check("overlay targets #sidebar", cssOv.indexOf("#sidebar") >= 0);
// overlay enabled -> background/panel/sidebarBg tokens SKIPPED (would clash with wallpaper transparent)
check("overlay skips --color-background token", cssOv.indexOf("--color-background:") < 0);
check("overlay still emits accent token", cssOv.indexOf("--color-brand:") >= 0 || cssOv.indexOf("--color-primary:") >= 0);
// overlay disabled -> no rgba, normal token path
var cssNoOv = si.renderSkinCss({ name: "t", colors: { background: "#fff" }, overlay: { enabled: false } });
check("overlay disabled -> no rgba section", cssNoOv.indexOf("overlay mode") < 0);
check("overlay disabled -> background token present", cssNoOv.indexOf("--color-background: #fff") >= 0);

check("radius skipped when null", cssNoRad.indexOf("border-radius:") < 0);

// === renderSkinChrome: decorations ===
// array form (new): multiple badges at different positions
var chrome = si.renderSkinChrome({ decorations: { sparkle: true, sparkleCount: 6, emojiBadges: [
  { emoji: "♡", position: "top-right" },
  { emoji: "✦", position: "bottom-center" },
  { emoji: "🎀", position: "middle-left" }
] } });
check("6 sparkle particles (explicit count)", (chrome.match(/<i><\/i>/g) || []).length === 6);
check("no skin-brand rendered (brand removed)", chrome.indexOf("skin-brand") < 0);
check("emoji badge ♡ rendered", chrome.indexOf("♡") >= 0 && chrome.indexOf("skin-emoji-badge") >= 0);
check("emoji ✦ rendered (2nd badge)", chrome.indexOf("✦") >= 0);
check("emoji 🎀 rendered (3rd badge)", chrome.indexOf("🎀") >= 0);
check("emoji position top-right class", chrome.indexOf("skin-emoji-top-right") >= 0);
check("emoji position bottom-center class", chrome.indexOf("skin-emoji-bottom-center") >= 0);
check("emoji position middle-left class", chrome.indexOf("skin-emoji-middle-left") >= 0);
check("3 badge divs rendered", (chrome.match(/skin-emoji-badge/g) || []).length === 3);
// legacy single form still renders (backward compat)
var chromeLegacy = si.renderSkinChrome({ decorations: { emojiBadge: "♡", emojiPosition: "top-left" } });
check("legacy single emoji renders", chromeLegacy.indexOf("♡") >= 0 && chromeLegacy.indexOf("skin-emoji-top-left") >= 0);
check("legacy single -> 1 badge", (chromeLegacy.match(/skin-emoji-badge/g) || []).length === 1);
// empty emojiBadges array -> no badges
var chromeNoBadge = si.renderSkinChrome({ decorations: { emojiBadges: [] } });
check("empty emojiBadges -> no badge", chromeNoBadge.indexOf("skin-emoji-badge") < 0);
// sparkle false
var chromeNoSparkle = si.renderSkinChrome({ decorations: { sparkle: false } });
check("sparkle false -> no particles", chromeNoSparkle.indexOf("skin-sparkles") < 0);
// sparkleCount configurable: default 12, explicit values, clamp
check("sparkleCount default 12", (si.renderSkinChrome({ decorations: { sparkle: true } }).match(/<i><\/i>/g) || []).length === 12);
check("sparkleCount=20 -> 20 particles", (si.renderSkinChrome({ decorations: { sparkle: true, sparkleCount: 20 } }).match(/<i><\/i>/g) || []).length === 20);
check("sparkleCount=0 -> 0 particles (sparkles div still there)", (si.renderSkinChrome({ decorations: { sparkle: true, sparkleCount: 0 } }).match(/<i><\/i>/g) || []).length === 0);
check("sparkleCount=100 clamps to 50", (si.renderSkinChrome({ decorations: { sparkle: true, sparkleCount: 100 } }).match(/<i><\/i>/g) || []).length === 50);
// position rules generated for each particle (no more hardcoded 6)
var css20 = si.renderSkinChromeCss({ decorations: { sparkle: true, sparkleCount: 20 }, colors: {} });
check("20 particles -> 20 nth-child position rules", (css20.match(/nth-child\(/g) || []).length === 20);
check("position rule 15 exists", css20.indexOf("nth-child(15)") >= 0);
check("position rule has left+top", /nth-child\(1\) {[\s\S]*left: [\d.]+%[\s\S]*top: [\d.]+%/.test(css20));
// twinkle + float: dual animation. twinkle is shared; float is per-particle.
check("twinkle keyframes present", css20.indexOf("@keyframes skin-twinkle") >= 0);
check("float keyframes per particle", css20.indexOf("@keyframes skin-float-0") >= 0 && css20.indexOf("@keyframes skin-float-15") >= 0);
check("20 float keyframes generated", (css20.match(/@keyframes skin-float-\d+/g) || []).length === 20);
check("particle has dual animation (twinkle + float)", /animation: skin-twinkle[\s\S]*skin-float-\d+/.test(css20));
check("float uses translate drift", css20.indexOf("transform: translate(") >= 0);
check("reduced-motion guard present", css20.indexOf("prefers-reduced-motion") >= 0);
// randomness: two renders produce different positions (truly random)
var cssA = si.renderSkinChromeCss({ decorations: { sparkle: true, sparkleCount: 3 }, colors: {} });
var cssB = si.renderSkinChromeCss({ decorations: { sparkle: true, sparkleCount: 3 }, colors: {} });
var posA = (cssA.match(/left: ([\d.]+)%; top: ([\d.]+)%/) || []).slice(1).join(",");
var posB = (cssB.match(/left: ([\d.]+)%; top: ([\d.]+)%/) || []).slice(1).join(",");
check("two renders differ (truly random positions)", posA !== posB);
// all null
var chromeEmpty = si.renderSkinChrome({ decorations: {} });
check("empty decorations -> empty chrome", chromeEmpty === "");

// === renderSkinChromeCss: wrapper styling ===
var chromeCss = si.renderSkinChromeCss({ colors: { accent: "#abc", accentAlt: "#def" } });
check("chrome wrapper pointer-events none", chromeCss.indexOf("pointer-events: none") >= 0);
check("chrome wrapper z-index", chromeCss.indexOf("z-index: 31") >= 0);
check("chrome uses accentAlt color (sparkle glow)", chromeCss.indexOf("#def") >= 0);
check("chrome no longer references accent (brand removed)", chromeCss.indexOf("#abc") < 0);
check("chrome css has all 8 position classes", ["top-left","top-center","top-right","middle-left","middle-right","bottom-left","bottom-center","bottom-right"].every(function(p){return chromeCss.indexOf("skin-emoji-"+p)>=0}));

// === buildSkinExpression: structure ===
var expr = si.buildSkinExpression({ name: "测试", colors: { accent: "#abc" }, decorations: { sparkle: true } });
check("expression is IIFE", expr.indexOf("(function(){") >= 0 && expr.indexOf("})()") >= 0);
check("expression removes old style first", expr.indexOf("remove()") >= 0);
check("expression creates style element", expr.indexOf("createElement('style')") >= 0);
check("expression creates chrome div", expr.indexOf("createElement('div')") >= 0);
check("expression sets data-theme-name", expr.indexOf("data-theme-name") >= 0);
check("expression sets aria-hidden on chrome", expr.indexOf("aria-hidden") >= 0);
check("expression returns ok", expr.indexOf("'ok'") >= 0 || expr.indexOf("\"ok\"") >= 0);
check("expression has skin style id", expr.indexOf(si.SKIN_STYLE_ID) >= 0);
check("expression has chrome id", expr.indexOf(si.SKIN_CHROME_ID) >= 0);
// name with quote escaped (no syntax break)
var exprQuote = si.buildSkinExpression({ name: "it's a 'test'", colors: {} });
check("quote in name doesn't break IIFE", /\}\)\(\)$/.test(exprQuote));

// === buildSkinRemoveExpression ===
var rm = si.buildSkinRemoveExpression();
check("remove is IIFE", rm.indexOf("(function(){") >= 0);
check("remove clears style id", rm.indexOf(si.SKIN_STYLE_ID) >= 0);
check("remove clears chrome id", rm.indexOf(si.SKIN_CHROME_ID) >= 0);
check("remove returns removed/none", rm.indexOf("removed") >= 0 && rm.indexOf("none") >= 0);

// === buildSkinVerifyExpression ===
var vf = si.buildSkinVerifyExpression();
check("verify checks style id presence", vf.indexOf(si.SKIN_STYLE_ID) >= 0);
check("verify returns effect/noeffect", vf.indexOf("effect") >= 0);

// === mirror constants: skin-inject vs skin-selectors (drift detection) ===
check("SKIN_STYLE_ID matches selector", si.SKIN_STYLE_ID === sel.SKIN_STYLE_ID);
check("SKIN_CHROME_ID matches selector", si.SKIN_CHROME_ID === sel.SKIN_CHROME_ID);
check("style id is zcode-user-skin", si.SKIN_STYLE_ID === "zcode-user-skin");
check("chrome id is zcode-user-skin-chrome", si.SKIN_CHROME_ID === "zcode-user-skin-chrome");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
