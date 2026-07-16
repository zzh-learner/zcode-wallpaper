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

// === makeSkinId ===
var id1 = skin.makeSkinId();
var id2 = skin.makeSkinId();
check("id starts with skin_", id1.indexOf("skin_") === 0);
check("ids are unique", id1 !== id2);

// === validateTheme ===
check("valid theme ok", skin.validateTheme({ name: "x", colors: { accent: "#abc" } }).ok === true);
check("missing name -> not ok", skin.validateTheme({ colors: {} }).ok === false);
check("empty name -> not ok", skin.validateTheme({ name: "  " }).ok === false);
check("bad hex -> not ok", skin.validateTheme({ name: "x", colors: { accent: "red" } }).ok === false);
check("null color ok (skip)", skin.validateTheme({ name: "x", colors: { accent: null } }).ok === true);
check("empty string color ok (skip)", skin.validateTheme({ name: "x", colors: { accent: "" } }).ok === true);
check("negative radius -> not ok", skin.validateTheme({ name: "x", radius: -5 }).ok === false);
check("valid radius ok", skin.validateTheme({ name: "x", radius: 16 }).ok === true);
check("null radius ok", skin.validateTheme({ name: "x", radius: null }).ok === true);
check("bad emojiPosition -> not ok", skin.validateTheme({ name: "x", decorations: { emojiBadge: "♡", emojiPosition: "middle" } }).ok === false);
check("good emojiPosition ok", skin.validateTheme({ name: "x", decorations: { emojiBadge: "♡", emojiPosition: "top-left" } }).ok === true);
check("non-object theme -> not ok", skin.validateTheme(null).ok === false);

// === makeSkinTheme: defaults + null preservation ===
var t = skin.makeSkinTheme({ name: "test" });
check("id assigned", !!t.id);
check("name preserved", t.name === "test");
check("isBuiltin defaults false", t.isBuiltin === false);
check("colors all null by default", t.colors.background === null && t.colors.accent === null);
check("font null by default", t.font === null);
check("radius null by default", t.radius === null);
check("sparkle defaults true", t.decorations.sparkle === true);
check("brand null by default", t.decorations.brand === null);
check("emojiBadge null by default", t.decorations.emojiBadge === null);
check("emojiPosition defaults top-left", t.decorations.emojiPosition === "top-left");
// radius numeric coercion
check("radius coerced to number", skin.makeSkinTheme({ radius: "16" }).radius === 16);
check("radius empty -> null", skin.makeSkinTheme({ radius: "" }).radius === null);
// sparkle: false respected
check("sparkle false respected", skin.makeSkinTheme({ decorations: { sparkle: false } }).decorations.sparkle === false);
// bad emojiPosition falls back
check("bad emojiPosition -> top-left", skin.makeSkinTheme({ decorations: { emojiPosition: "x" } }).decorations.emojiPosition === "top-left");

// === builtinPresets ===
var presets = skin.builtinPresets();
check("3 presets", presets.length === 3);
check("all isBuiltin", presets.every(function (p) { return p.isBuiltin; }));
check("ids unique", new Set(presets.map(function (p) { return p.id; })).size === 3);
check("preset ids are skin-*-builtin", presets.every(function (p) { return /skin-.*-builtin$/.test(p.id); }));
check("each preset has all 9 colors", presets.every(function (p) {
  return skin.COLOR_KEYS.every(function (k) { return p.colors[k]; });
}));

// === ensureBuiltinPresets ===
var empty = skin.ensureBuiltinPresets({});
check("empty -> 3 builtins", Object.keys(empty.themes).length === 3);
check("empty activeId null", empty.activeId === null);
// existing user theme preserved
var withUser = skin.ensureBuiltinPresets({ activeId: null, themes: { "skin_user1": { id: "skin_user1", name: "mine", isBuiltin: false } } });
check("user theme preserved", !!withUser.themes["skin_user1"]);
check("builtins added", Object.keys(withUser.themes).length === 4);
// activeId kept if theme exists
var withActive = skin.ensureBuiltinPresets({ activeId: "skin-pink-builtin", themes: {} });
check("activeId kept if exists", withActive.activeId === "skin-pink-builtin");
// activeId null if theme gone
var withGone = skin.ensureBuiltinPresets({ activeId: "skin_ghost", themes: {} });
check("activeId null if theme gone", withGone.activeId === null);
// builtins not overwritten if already present
var withCorrupt = skin.ensureBuiltinPresets({ themes: { "skin-pink-builtin": { id: "skin-pink-builtin", name: "custom" } } });
check("existing builtin kept as-is", withCorrupt.themes["skin-pink-builtin"].name === "custom");

// === duplicateTheme ===
var src = { activeId: null, themes: { "skin-pink-builtin": presets[0] } };
var dup = skin.duplicateTheme(src, "skin-pink-builtin");
check("dup not null", dup !== null);
check("dup isBuiltin false", dup.isBuiltin === false);
check("dup name has 副本", dup.name.indexOf("副本") >= 0);
check("dup has new id", dup.id !== "skin-pink-builtin" && dup.id.indexOf("skin_") === 0);
check("dup colors copied", dup.colors.accent === presets[0].colors.accent);
check("dup source unchanged (builtin still builtin)", src.themes["skin-pink-builtin"].isBuiltin === true);
check("dup missing source -> null", skin.duplicateTheme(src, "nope") === null);

// === mirror consistency: control/lib/skin.js exports same pure fns ===
check("web isValidHex matches", skinWeb.isValidHex("#abc") === skin.isValidHex("#abc"));
check("web isValidHex rejects same", skinWeb.isValidHex("red") === false);
check("web makeSkinId starts skin_", skinWeb.makeSkinId().indexOf("skin_") === 0);
check("web validateTheme agrees ok", skinWeb.validateTheme({ name: "x", colors: { accent: "#abc" } }).ok === true);
check("web validateTheme agrees bad", skinWeb.validateTheme({ name: "" }).ok === false);
check("web COLOR_KEYS same length", skinWeb.COLOR_KEYS.length === skin.COLOR_KEYS.length);
check("web DECORATION_EMOJI_POSITIONS same", JSON.stringify(skinWeb.DECORATION_EMOJI_POSITIONS) === JSON.stringify(skin.DECORATION_EMOJI_POSITIONS));
check("web builtinPresets count 3", skinWeb.builtinPresets().length === 3);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
