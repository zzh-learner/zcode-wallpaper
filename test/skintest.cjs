// Test lib/skin.cjs pure functions (spec §7). Mirrors bookmarktest.cjs style.
// Also runs the same assertions against control/lib/skin.js (frontend mirror,
// lesson 17 mirror consistency — same as readercodetest + readercodetestweb).
var skin = require("../lib/skin.cjs");
var skinWeb = require("../control/lib/skin.js");
var pass = 0, fail = 0;
function check(n, c) { console.log((c ? "PASS ✓ " : "FAIL ✗ ") + n); c ? pass++ : fail++; }

// === isValidHex ===
check("#rgb accepted", skin.isValidHex("#abc") === true);
check("#rrggbb accepted", skin.isValidHex("#aabbcc") === true);
check("#rrggbbaa accepted", skin.isValidHex("#aabbccff") === true);
check("uppercase accepted", skin.isValidHex("#AABBCC") === true);
check("no # rejected", skin.isValidHex("aabbcc") === false);
check("too short rejected", skin.isValidHex("#ab") === false);
check("non-hex rejected", skin.isValidHex("#ggghhh") === false);
check("empty rejected", skin.isValidHex("") === false);
check("non-string rejected", skin.isValidHex(null) === false);
check("4-char #rgba rejected (only 3/6/8)", skin.isValidHex("#abcd") === false);

// === hexToRgb / hexToRgba (overlay support) ===
check("hexToRgb #1a1410", JSON.stringify(skin.hexToRgb("#1a1410")) === JSON.stringify({r:26,g:20,b:16}));
check("hexToRgb #abc expands", JSON.stringify(skin.hexToRgb("#abc")) === JSON.stringify({r:170,g:187,b:204}));
check("hexToRgb invalid -> null", skin.hexToRgb("red") === null);
check("hexToRgb #rrggbbaa -> null (only 3/6)", skin.hexToRgb("#aabbccff") === null);
check("hexToRgba 100% opaque", skin.hexToRgba("#1a1410", 100) === "rgba(26, 20, 16, 1)");
check("hexToRgba 85%", skin.hexToRgba("#1a1410", 85) === "rgba(26, 20, 16, 0.85)");
check("hexToRgba 0% transparent", skin.hexToRgba("#1a1410", 0) === "rgba(26, 20, 16, 0)");
check("hexToRgba clamps >100", skin.hexToRgba("#1a1410", 150) === "rgba(26, 20, 16, 1)");
check("hexToRgba clamps <0", skin.hexToRgba("#1a1410", -10) === "rgba(26, 20, 16, 0)");
check("hexToRgba invalid hex -> null", skin.hexToRgba("red", 50) === null);

// === makeSkinId ===
var id1 = skin.makeSkinId();
var id2 = skin.makeSkinId();
check("id starts with skin_", id1.indexOf("skin_") === 0);
check("ids are unique", id1 !== id2);

// === validateTheme ===
check("missing name -> not ok", skin.validateTheme({ colors: {} }).ok === false);
check("empty name -> not ok", skin.validateTheme({ name: "  " }).ok === false);
check("negative radius -> not ok", skin.validateTheme({ name: "x", radius: -5 }).ok === false);
check("valid radius ok", skin.validateTheme({ name: "x", radius: 16 }).ok === true);
check("null radius ok", skin.validateTheme({ name: "x", radius: null }).ok === true);
// emojiBadges: new array form validation
check("bad emojiBadges position -> not ok", skin.validateTheme({ name: "x", decorations: { emojiBadges: [{ emoji: "♡", position: "middle" }] } }).ok === false);
check("good emojiBadges ok", skin.validateTheme({ name: "x", decorations: { emojiBadges: [{ emoji: "♡", position: "top-left" }] } }).ok === true);
check("good emojiBadges middle-center rejected (not in 8)", skin.validateTheme({ name: "x", decorations: { emojiBadges: [{ emoji: "♡", position: "middle-center" }] } }).ok === false);
check("good emojiBadges bottom-center ok (new position)", skin.validateTheme({ name: "x", decorations: { emojiBadges: [{ emoji: "♡", position: "bottom-center" }] } }).ok === true);
// legacy single-form still validated (backward compat)
check("legacy bad emojiPosition -> not ok", skin.validateTheme({ name: "x", decorations: { emojiBadge: "♡", emojiPosition: "middle" } }).ok === false);
check("legacy good emojiPosition ok", skin.validateTheme({ name: "x", decorations: { emojiBadge: "♡", emojiPosition: "top-left" } }).ok === true);
check("non-object theme -> not ok", skin.validateTheme(null).ok === false);

// === normalizeEmojiBadges: array form + legacy migration ===
check("normalize empty -> []", skin.normalizeEmojiBadges({}).length === 0);
check("normalize array form passes through", JSON.stringify(skin.normalizeEmojiBadges({ emojiBadges: [{ emoji: "♡", position: "top-left" }] })) === JSON.stringify([{ emoji: "♡", position: "top-left" }]));
check("normalize array drops empty emoji", skin.normalizeEmojiBadges({ emojiBadges: [{ emoji: "", position: "top-left" }, { emoji: "♡", position: "top-right" }] }).length === 1);
check("normalize array fixes bad position", skin.normalizeEmojiBadges({ emojiBadges: [{ emoji: "♡", position: "nope" }] })[0].position === "top-left");
check("normalize legacy single -> 1-element array", skin.normalizeEmojiBadges({ emojiBadge: "✦", emojiPosition: "top-right" }).length === 1);
check("normalize legacy single emoji preserved", skin.normalizeEmojiBadges({ emojiBadge: "✦", emojiPosition: "top-right" })[0].emoji === "✦");
check("normalize array form wins over legacy", skin.normalizeEmojiBadges({ emojiBadges: [{ emoji: "A", position: "top-left" }], emojiBadge: "B", emojiPosition: "top-right" })[0].emoji === "A");
check("normalize 8 positions all accepted", skin.DECORATION_EMOJI_POSITIONS.length === 8);

// === makeSkinTheme: defaults + null preservation ===
var t = skin.makeSkinTheme({ name: "test" });
check("id assigned", !!t.id);
check("name preserved", t.name === "test");
check("isBuiltin defaults false", t.isBuiltin === false);
check("font null by default", t.font === null);
check("radius null by default", t.radius === null);
check("sparkleCount defaults 12", t.decorations.sparkleCount === 12);
check("sparkleCount explicit 20 preserved", skin.makeSkinTheme({ decorations: { sparkleCount: 20 } }).decorations.sparkleCount === 20);
check("sparkleCount clamps >50", skin.makeSkinTheme({ decorations: { sparkleCount: 99 } }).decorations.sparkleCount === 50);
check("sparkleCount clamps <0", skin.makeSkinTheme({ decorations: { sparkleCount: -5 } }).decorations.sparkleCount === 0);
check("sparkleCount null -> default 12", skin.makeSkinTheme({ decorations: { sparkleCount: null } }).decorations.sparkleCount === 12);
check("emojiBadges empty array by default", Array.isArray(t.decorations.emojiBadges) && t.decorations.emojiBadges.length === 0);
check("overlay defaults disabled", t.overlay.enabled === false);
check("overlay object present by default", typeof t.overlay === "object");
// radius numeric coercion
check("radius coerced to number", skin.makeSkinTheme({ radius: "16" }).radius === 16);
check("radius empty -> null", skin.makeSkinTheme({ radius: "" }).radius === null);
// sparkle: false respected
check("sparkle false respected", skin.makeSkinTheme({ decorations: { sparkle: false } }).decorations.sparkle === false);
// makeSkinTheme migrates legacy single form -> emojiBadges array
var migrated = skin.makeSkinTheme({ decorations: { emojiBadge: "♡", emojiPosition: "top-right" } });
check("makeSkinTheme migrates legacy -> array len 1", migrated.decorations.emojiBadges.length === 1);
check("makeSkinTheme migrates legacy emoji", migrated.decorations.emojiBadges[0].emoji === "♡");
check("makeSkinTheme migrates legacy position", migrated.decorations.emojiBadges[0].position === "top-right");
// makeSkinTheme passes array form through
var arrTheme = skin.makeSkinTheme({ decorations: { emojiBadges: [{ emoji: "✦", position: "bottom-center" }, { emoji: "🎀", position: "top-left" }] } });
check("makeSkinTheme array form len 2", arrTheme.decorations.emojiBadges.length === 2);
check("makeSkinTheme array form pos preserved", arrTheme.decorations.emojiBadges[0].position === "bottom-center");

// === builtinPresets ===
var presets = skin.builtinPresets();

// === ensureBuiltinPresets ===
var empty = skin.ensureBuiltinPresets({});
check("empty -> 1 builtin", Object.keys(empty.themes).length === 1);
check("empty activeId null", empty.activeId === null);
// existing user theme preserved
var withUser = skin.ensureBuiltinPresets({ activeId: null, themes: { "skin_user1": { id: "skin_user1", name: "mine", isBuiltin: false } } });
check("user theme preserved", !!withUser.themes["skin_user1"]);
check("builtins added", Object.keys(withUser.themes).length === 2);
// activeId kept if theme exists
var withActive = skin.ensureBuiltinPresets({ activeId: "skin-default-builtin", themes: {} });
check("activeId kept if exists", withActive.activeId === "skin-default-builtin");
// activeId null if theme gone
var withGone = skin.ensureBuiltinPresets({ activeId: "skin_ghost", themes: {} });
check("activeId null if theme gone", withGone.activeId === null);
// builtins not overwritten if already present
var withCorrupt = skin.ensureBuiltinPresets({ themes: { "skin-default-builtin": { id: "skin-default-builtin", name: "custom" } } });
check("existing builtin kept as-is", withCorrupt.themes["skin-default-builtin"].name === "custom");

// === duplicateTheme ===
var src = { activeId: null, themes: { "skin-default-builtin": presets[0] } };
var dup = skin.duplicateTheme(src, "skin-default-builtin");
check("dup not null", dup !== null);
check("dup isBuiltin false", dup.isBuiltin === false);
check("dup name has 副本", dup.name.indexOf("副本") >= 0);
check("dup has new id", dup.id !== "skin-default-builtin" && dup.id.indexOf("skin_") === 0);
check("dup source unchanged (builtin still builtin)", src.themes["skin-default-builtin"].isBuiltin === true);
check("dup missing source -> null", skin.duplicateTheme(src, "nope") === null);

// === mirror consistency: control/lib/skin.js exports same pure fns ===
check("web isValidHex matches", skinWeb.isValidHex("#abc") === skin.isValidHex("#abc"));
check("web isValidHex rejects same", skinWeb.isValidHex("red") === false);
check("web makeSkinId starts skin_", skinWeb.makeSkinId().indexOf("skin_") === 0);
check("web validateTheme agrees ok", skinWeb.validateTheme({ name: "x", colors: { accent: "#abc" } }).ok === true);
check("web validateTheme agrees bad", skinWeb.validateTheme({ name: "" }).ok === false);
check("web COLOR_KEYS both undefined", skinWeb.COLOR_KEYS === undefined && skin.COLOR_KEYS === undefined);
check("web DECORATION_EMOJI_POSITIONS same", JSON.stringify(skinWeb.DECORATION_EMOJI_POSITIONS) === JSON.stringify(skin.DECORATION_EMOJI_POSITIONS));
check("web builtinPresets count 1", skinWeb.builtinPresets().length === 1);

// === 重构后：overlay 无 *Bg 字段，有 *Blur 字段 ===
var ovNew = skin.makeOverlay({ enabled: true, panelOpacity: 70, panelBlur: 12, inputOpacity: 70, inputBlur: 12, sidebarOpacity: 70, sidebarBlur: 12 });
check("new overlay has no panelBg", ovNew.panelBg === undefined);
check("new overlay has no inputBg", ovNew.inputBg === undefined);
check("new overlay has no sidebarBg", ovNew.sidebarBg === undefined);
check("new overlay panelOpacity preserved", ovNew.panelOpacity === 70);
check("new overlay panelBlur preserved", ovNew.panelBlur === 12);
check("new overlay inputBlur preserved", ovNew.inputBlur === 12);
check("new overlay sidebarBlur preserved", ovNew.sidebarBlur === 12);
// 旧字段被丢弃
var ovMigrated = skin.makeOverlay({ enabled: true, panelBg: "#fff", panelOpacity: 85, panelBlur: null });
check("legacy panelBg dropped", ovMigrated.panelBg === undefined);
check("missing blur -> default 12", ovMigrated.panelBlur === 12);
check("missing inputBlur -> default 12", ovMigrated.inputBlur === 12);
check("missing sidebarBlur -> default 12", ovMigrated.sidebarBlur === 12);
// 空输入
var ovEmpty = skin.makeOverlay({});
check("empty overlay enabled false", ovEmpty.enabled === false);
check("empty overlay panelBlur default 12", ovEmpty.panelBlur === 12);

// === makeSkinTheme 无 colors 字段 ===
var theme = skin.makeSkinTheme({ name: "测试", overlay: { enabled: true, panelOpacity: 50, panelBlur: 5 } });
check("theme has no colors field", theme.colors === undefined);
check("theme overlay enabled preserved", theme.overlay.enabled === true);
check("theme decorations.sparkle defaults false", theme.decorations.sparkle === false);
check("theme decorations.sparkleCount defaults 12", theme.decorations.sparkleCount === 12);

// === builtinPresets 只 1 个默认主题 ===
var presets = skin.builtinPresets();
check("only 1 builtin preset", presets.length === 1);
check("preset id is skin-default-builtin", presets[0].id === "skin-default-builtin");
check("preset has no colors", presets[0].colors === undefined);
check("preset overlay enabled true", presets[0].overlay.enabled === true);
check("preset overlay panelOpacity 70", presets[0].overlay.panelOpacity === 70);
check("preset overlay panelBlur 12", presets[0].overlay.panelBlur === 12);
check("preset decorations.sparkle false", presets[0].decorations.sparkle === false);

// === validateTheme 不再校验 colors，加 blur 范围校验 ===
check("validate accepts no colors", skin.validateTheme({ name: "x" }).ok === true);
check("validate ignores legacy colors", skin.validateTheme({ name: "x", colors: { accent: "red" } }).ok === true);
check("validate rejects blur > 30", skin.validateTheme({ name: "x", overlay: { panelBlur: 50 } }).ok === false);
check("validate rejects blur < 0", skin.validateTheme({ name: "x", overlay: { inputBlur: -1 } }).ok === false);
check("validate accepts blur 0-30", skin.validateTheme({ name: "x", overlay: { panelBlur: 0, inputBlur: 15, sidebarBlur: 30 } }).ok === true);

// === 新常量导出 ===
check("OPACITY_RANGE exported", skin.OPACITY_RANGE && skin.OPACITY_RANGE.min === 0 && skin.OPACITY_RANGE.max === 100);
check("BLUR_RANGE exported", skin.BLUR_RANGE && skin.BLUR_RANGE.min === 0 && skin.BLUR_RANGE.max === 30);
check("COLOR_KEYS no longer exported", skin.COLOR_KEYS === undefined);

// === 迁移：旧 localStorage 数据（带 colors + 旧 overlay）读取不报错 ===
var legacyTheme = skin.makeSkinTheme({
  name: "旧主题",
  colors: { background: "#fff", accent: "#000" },
  overlay: { enabled: true, panelBg: "#abc", panelOpacity: 85 }
});
check("legacy theme colors dropped", legacyTheme.colors === undefined);
check("legacy theme overlay panelBg dropped", legacyTheme.overlay.panelBg === undefined);
check("legacy theme overlay panelOpacity kept", legacyTheme.overlay.panelOpacity === 85);
check("legacy theme overlay panelBlur defaulted", legacyTheme.overlay.panelBlur === 12);

// === MIRROR 一致性：skin.cjs vs control/lib/skin.js 必须字段集一致 ===
check("mirror: makeOverlay 字段集一致", JSON.stringify(Object.keys(skin.makeOverlay({})).sort()) === JSON.stringify(Object.keys(skinWeb.makeOverlay({})).sort()));
check("mirror: makeSkinTheme 字段集一致（无 colors）", JSON.stringify(Object.keys(skin.makeSkinTheme({})).sort()) === JSON.stringify(Object.keys(skinWeb.makeSkinTheme({})).sort()));
check("mirror: builtinPresets 长度一致", skin.builtinPresets().length === skinWeb.builtinPresets().length);
check("mirror: builtinPresets[0].id 一致", skin.builtinPresets()[0].id === skinWeb.builtinPresets()[0].id);
check("mirror: OPACITY_RANGE 一致", JSON.stringify(skin.OPACITY_RANGE) === JSON.stringify(skinWeb.OPACITY_RANGE));
check("mirror: BLUR_RANGE 一致", JSON.stringify(skin.BLUR_RANGE) === JSON.stringify(skinWeb.BLUR_RANGE));
check("mirror: COLOR_KEYS 两边都 undefined", skin.COLOR_KEYS === undefined && skinWeb.COLOR_KEYS === undefined);
check("mirror: makeOverlay 相同输入同输出", JSON.stringify(skin.makeOverlay({ panelOpacity: 50, panelBlur: 5 })) === JSON.stringify(skinWeb.makeOverlay({ panelOpacity: 50, panelBlur: 5 })));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
