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
check("radius skipped when null", cssNoRad.indexOf("border-radius:") < 0);

// === renderSkinChrome: decorations ===
var chrome = si.renderSkinChrome({ decorations: { brand: "我的皮肤", sparkle: true, emojiBadge: "♡", emojiPosition: "top-right" } });
check("brand rendered", chrome.indexOf("我的皮肤") >= 0 && chrome.indexOf("skin-brand") >= 0);
check("6 sparkle particles", (chrome.match(/<i><\/i>/g) || []).length === 6);
check("emoji badge rendered", chrome.indexOf("♡") >= 0 && chrome.indexOf("skin-emoji-badge") >= 0);
check("emoji position class", chrome.indexOf("skin-emoji-top-right") >= 0);
// sparkle false
var chromeNoSparkle = si.renderSkinChrome({ decorations: { sparkle: false } });
check("sparkle false -> no particles", chromeNoSparkle.indexOf("skin-sparkles") < 0);
// all null
var chromeEmpty = si.renderSkinChrome({ decorations: {} });
check("empty decorations -> empty chrome", chromeEmpty === "");

// === renderSkinChromeCss: wrapper styling ===
var chromeCss = si.renderSkinChromeCss({ colors: { accent: "#abc", accentAlt: "#def" } });
check("chrome wrapper pointer-events none", chromeCss.indexOf("pointer-events: none") >= 0);
check("chrome wrapper z-index", chromeCss.indexOf("z-index: 31") >= 0);
check("chrome uses accent color", chromeCss.indexOf("#abc") >= 0);

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
