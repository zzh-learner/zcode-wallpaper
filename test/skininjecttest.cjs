// Test lib/skin-inject.cjs pure renderers (spec §7). Mirrors videomutetest.cjs
// style. CDP application (applySkin/removeSkin) is cross-process glue, NOT
// unit-tested — verified by real-machine checklist (spec §8, lesson 12/13).
var si = require("../lib/skin-inject.cjs");
var sel = require("../lib/skin-selectors.cjs");
var pass = 0, fail = 0;
function check(n, c) { console.log((c ? "PASS ✓ " : "FAIL ✗ ") + n); c ? pass++ : fail++; }

// === 原生底层变量名 + 区域选择器映射（Task 4，color-mix 方案）===
check("FROST_BASE_VARS has 4 regions", Object.keys(sel.FROST_BASE_VARS).length === 4);
check("FROST_BASE_VARS.panel", sel.FROST_BASE_VARS.panel === "--color-neutral-900");
check("FROST_BASE_VARS.input", sel.FROST_BASE_VARS.input === "--color-input");
check("FROST_BASE_VARS.sidebar", sel.FROST_BASE_VARS.sidebar === "--color-neutral-950");
check("FROST_BASE_VARS.accent", sel.FROST_BASE_VARS.accent === "--color-brand");
check("OVERLAY_REGION_SELECTORS has 3 regions", Object.keys(sel.OVERLAY_REGION_SELECTORS).length === 3);
check("OVERLAY_REGION_SELECTORS.panel", sel.OVERLAY_REGION_SELECTORS.panel.indexOf("main") >= 0);
check("OVERLAY_REGION_SELECTORS.input", sel.OVERLAY_REGION_SELECTORS.input.indexOf(".bg-input") >= 0);
check("OVERLAY_REGION_SELECTORS.sidebar", sel.OVERLAY_REGION_SELECTORS.sidebar.indexOf("#sidebar") >= 0);

// === renderSkinCss: 磨砂玻璃新形状（Task 5，color-mix 方案）===
var cssFrost = si.renderSkinCss({
  name: "磨砂测试",
  overlay: { enabled: true, panelOpacity: 70, panelBlur: 12, inputOpacity: 70, inputBlur: 12, sidebarOpacity: 70, sidebarBlur: 12 }
});
check("frost overlay section present", cssFrost.indexOf("frosted glass") >= 0 || cssFrost.indexOf("overlay") >= 0);
// 面板：color-mix + var(--color-neutral-900, fallback) + 70%
check("frost panel color-mix", cssFrost.indexOf("color-mix(in srgb, var(--color-neutral-900, #121216) 70%, transparent)") >= 0);
check("frost panel backdrop-filter blur 12px", cssFrost.indexOf("backdrop-filter: blur(12px)") >= 0);
check("frost has webkit prefix", cssFrost.indexOf("-webkit-backdrop-filter") >= 0);
// 输入框：var(--color-input, fallback)
check("frost input color-mix", cssFrost.indexOf("color-mix(in srgb, var(--color-input, #2b2b2b)") >= 0);
// 侧栏：var(--color-neutral-950, fallback)
check("frost sidebar color-mix", cssFrost.indexOf("color-mix(in srgb, var(--color-neutral-950, #0c0c0e)") >= 0);
// 选择器
check("frost targets main", cssFrost.indexOf("main, [role='main']") >= 0);
check("frost targets .bg-input", cssFrost.indexOf(".bg-input") >= 0);
check("frost targets #sidebar", cssFrost.indexOf("#sidebar") >= 0);
// 没有旧 rgba(...) 字面量（color-mix 应取代）
check("frost has no literal rgba()", cssFrost.indexOf("rgba(") < 0);
// 没有 readBackupVarsExpression 胶水（方案已简化）
check("no readBackupVarsExpression export", si.readBackupVarsExpression === undefined);
check("no parseBackupVarsResult export", si.parseBackupVarsResult === undefined);

// overlay 关闭：不输出磨砂规则
var cssNoFrost = si.renderSkinCss({
  name: "关闭测试",
  overlay: { enabled: false, panelOpacity: 70, panelBlur: 12, inputOpacity: 70, inputBlur: 12, sidebarOpacity: 70, sidebarBlur: 12 }
});
check("no frost when disabled", cssNoFrost.indexOf("backdrop-filter") < 0);
check("no color-mix when disabled", cssNoFrost.indexOf("color-mix") < 0);

// 不同 opacity/blur 值正确反映
var cssCustom = si.renderSkinCss({
  name: "custom",
  overlay: { enabled: true, panelOpacity: 50, panelBlur: 5, inputOpacity: 80, inputBlur: 0, sidebarOpacity: 30, sidebarBlur: 20 }
});
check("custom panel opacity 50%", cssCustom.indexOf("var(--color-neutral-900, #121216) 50%, transparent)") >= 0);
check("custom panel blur 5px", cssCustom.indexOf("blur(5px)") >= 0);
check("custom input opacity 80%", cssCustom.indexOf("var(--color-input, #2b2b2b) 80%, transparent)") >= 0);
// blur=0 的区域：可以省略 backdrop-filter（无意义 GPU 开销）
// sidebar blur=20
check("custom sidebar blur 20px", cssCustom.indexOf("blur(20px)") >= 0);

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
// Task 5: sparkle glow follows ZCode --color-brand via color var with hex fallback
check("chrome uses var(--color-brand) for sparkle glow", chromeCss.indexOf("var(--color-brand, #b45cff)") >= 0);
check("chrome no longer references accentAlt hex (theme-follow)", chromeCss.indexOf("#def") < 0);
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
