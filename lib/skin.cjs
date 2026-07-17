// Skin theme model — pure functions shared by server (skin-inject.cjs, tests)
// and frontend (control/lib/skin.js re-exports these + adds localStorage glue).
//
// Design (spec §3): a Theme is a plain object with id/name/colors/font/radius/
// decorations. Stored in localStorage key `zcode-control:skins` as
// { activeId, themes: {id -> Theme} }. 3 builtin presets seeded on first load.
//
// Pure-function convention (mirrors bookmark.js/shelf.js): validation, id
// generation, preset seeding, duplication are pure + unit-tested. localStorage
// read/write lives in control/lib/skin.js (browser-only, real-machine verified).

// Color keys a theme may set. Each maps to either a ZCode CSS variable token
// (preferred, robust to class-name changes) or a direct element rule fallback.
// See lib/skin-selectors.cjs for the actual selector/var mapping.
var COLOR_KEYS = [
  "background",    // body / app background
  "panel",         // cards / panels / surfaces
  "accent",        // primary buttons / brand / links
  "accentAlt",     // secondary accent (hovers, active states)
  "text",          // main foreground text
  "muted",         // muted/secondary text
  "sidebarBg",     // sidebar background
  "inputBg",       // input/composer background
  "inputBorder"    // input/composer border
];

var DECORATION_EMOJI_POSITIONS = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-right",
  "bottom-left", "bottom-center", "bottom-right"
];

// Validate a hex color. Accepts #rgb, #rrggbb, #rrggbbaa (alpha optional).
// Case-insensitive. Returns true/false.
function isValidHex(s) {
  if (typeof s !== "string") return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s);
}

// Normalize a theme's emoji decorations into a clean array of badges.
// Accepts BOTH the new array form (decorations.emojiBadges: [{emoji,position}])
// AND the legacy single-value form (decorations.emojiBadge + emojiPosition)
// for backward compat with old localStorage. Drops empty/invalid entries.
// Each badge: { emoji: string, position: one of DECORATION_EMOJI_POSITIONS }.
// Returns [] if no badges.
function normalizeEmojiBadges(deco) {
  if (!deco || typeof deco !== "object") return [];
  var out = [];
  // new array form takes precedence
  if (Array.isArray(deco.emojiBadges)) {
    for (var i = 0; i < deco.emojiBadges.length; i++) {
      var b = deco.emojiBadges[i];
      if (!b || typeof b !== "object") continue;
      var em = (b.emoji != null ? String(b.emoji) : "").trim();
      if (!em) continue;
      var pos = DECORATION_EMOJI_POSITIONS.indexOf(b.position) >= 0 ? b.position : "top-left";
      out.push({ emoji: em, position: pos });
    }
    return out;
  }
  // legacy single-value form -> migrate to a one-element array
  if (deco.emojiBadge != null && String(deco.emojiBadge).trim()) {
    var pos2 = DECORATION_EMOJI_POSITIONS.indexOf(deco.emojiPosition) >= 0 ? deco.emojiPosition : "top-left";
    out.push({ emoji: String(deco.emojiBadge).trim(), position: pos2 });
  }
  return out;
}

// Generate a theme id. "skin_" + base36 timestamp + 2 random chars (mirrors
// bookmarkId pattern). Deterministic-ish but unique enough for local use.
function makeSkinId() {
  var ts = Date.now().toString(36);
  var rnd = Math.random().toString(36).slice(2, 4);
  return "skin_" + ts + rnd;
}

// Validate a theme object. Returns { ok:true } or { ok:false, errors:[...] }.
// Checks: name non-empty, colors all valid hex (if present), radius is a
// non-negative number or null, font is string or null, decorations shape.
function validateTheme(t) {
  var errors = [];
  if (!t || typeof t !== "object") return { ok: false, errors: ["theme is not an object"] };
  if (!t.name || typeof t.name !== "string" || !t.name.trim()) errors.push("name 不能为空");
  if (t.colors) {
    if (typeof t.colors !== "object") {
      errors.push("colors 必须是对象");
    } else {
      for (var i = 0; i < COLOR_KEYS.length; i++) {
        var k = COLOR_KEYS[i];
        var v = t.colors[k];
        if (v != null && v !== "" && !isValidHex(v)) {
          errors.push("colors." + k + " 不是合法 hex (" + v + ")");
        }
      }
    }
  }
  if (t.radius != null && t.radius !== "") {
    var r = Number(t.radius);
    if (!isFinite(r) || r < 0) errors.push("radius 必须是非负数字");
  }
  if (t.font != null && t.font !== "" && typeof t.font !== "string") {
    errors.push("font 必须是字符串");
  }
  if (t.decorations) {
    if (typeof t.decorations !== "object") {
      errors.push("decorations 必须是对象");
    } else {
      // emojiBadges (new array form): each badge must have a valid position.
      if (Array.isArray(t.decorations.emojiBadges)) {
        for (var i = 0; i < t.decorations.emojiBadges.length; i++) {
          var b = t.decorations.emojiBadges[i];
          if (b && typeof b === "object" && b.position != null &&
              DECORATION_EMOJI_POSITIONS.indexOf(b.position) === -1) {
            errors.push("emojiBadges[" + i + "].position 必须是 " + DECORATION_EMOJI_POSITIONS.join("/") + " 之一");
          }
        }
      }
      // legacy single form still validated for position
      if (t.decorations.emojiBadge != null && t.decorations.emojiBadge !== "" &&
          DECORATION_EMOJI_POSITIONS.indexOf(t.decorations.emojiPosition) === -1) {
        errors.push("emojiPosition 必须是 " + DECORATION_EMOJI_POSITIONS.join("/") + " 之一");
      }
    }
  }
  return errors.length ? { ok: false, errors: errors } : { ok: true };
}

// Build a complete Theme object from a partial input, filling defaults.
// id/isBuiltin preserved if present, else defaulted. null/empty fields kept
// as-is (null = "don't override"). Does NOT validate — caller should call
// validateTheme separately when needed.
function makeSkinTheme(partial) {
  var p = partial || {};
  var colors = p.colors || {};
  var deco = p.decorations || {};
  return {
    id: p.id || makeSkinId(),
    name: p.name || "未命名皮肤",
    isBuiltin: p.isBuiltin === true,
    colors: {
      background: colors.background || null,
      panel: colors.panel || null,
      accent: colors.accent || null,
      accentAlt: colors.accentAlt || null,
      text: colors.text || null,
      muted: colors.muted || null,
      sidebarBg: colors.sidebarBg || null,
      inputBg: colors.inputBg || null,
      inputBorder: colors.inputBorder || null
    },
    font: p.font || null,
    radius: p.radius != null && p.radius !== "" ? Number(p.radius) : null,
    decorations: {
      brand: deco.brand || null,
      sparkle: deco.sparkle !== false, // default true
      // emojiBadges: normalized array of {emoji, position}. Accepts the new
      // array form (deco.emojiBadges) OR the legacy single-value form
      // (deco.emojiBadge + deco.emojiPosition), migrating the latter. Legacy
      // single fields are also kept on the object for round-trip compat with
      // old localStorage entries + older code paths.
      emojiBadges: normalizeEmojiBadges(deco),
      emojiBadge: deco.emojiBadge || null,
      emojiPosition: DECORATION_EMOJI_POSITIONS.indexOf(deco.emojiPosition) >= 0
        ? deco.emojiPosition : "top-left"
    }
  };
}

// Builtin preset themes (spec §3.3). Seeded into localStorage on first load.
// Colors chosen to be coherent palettes (pink-purple dream / dark gold / sepia).
function builtinPresets() {
  return [
    {
      id: "skin-pink-builtin",
      name: "粉紫梦境",
      isBuiltin: true,
      colors: {
        background: "#fff9fc", panel: "#ffffff", accent: "#8b3dce", accentAlt: "#b45cff",
        text: "#4c2364", muted: "#9e58bd", sidebarBg: "#fff3f9",
        inputBg: "#fff5fa", inputBorder: "#e484bc"
      },
      font: null, radius: 16,
      decorations: {
        brand: "粉紫梦境", sparkle: true,
        emojiBadges: [
          { emoji: "♡", position: "top-left" },
          { emoji: "✦", position: "top-right" },
          { emoji: "🎀", position: "bottom-right" }
        ]
      }
    },
    {
      id: "skin-darkgold-builtin",
      name: "暗夜金",
      isBuiltin: true,
      colors: {
        background: "#1a1410", panel: "#241d16", accent: "#d4a017", accentAlt: "#f0c040",
        text: "#e8dcc8", muted: "#9a8a70", sidebarBg: "#15110d",
        inputBg: "#2a2118", inputBorder: "#5a4a30"
      },
      font: null, radius: 12,
      decorations: { brand: "暗夜金", sparkle: true, emojiBadges: [{ emoji: "✦", position: "top-right" }] }
    },
    {
      id: "skin-sepia-builtin",
      name: "护眼米黄",
      isBuiltin: true,
      colors: {
        background: "#f5ecd9", panel: "#fbf5e8", accent: "#8b6914", accentAlt: "#a8862f",
        text: "#3a2f1f", muted: "#7a6a4f", sidebarBg: "#efe4cb",
        inputBg: "#faf3e0", inputBorder: "#c9b890"
      },
      font: null, radius: 10,
      decorations: { brand: null, sparkle: false, emojiBadges: [] }
    }
  ];
}

// Ensure a skins state object contains all builtin presets.
// Pure: takes a state, returns a new state with builtins merged (existing
// user themes preserved; builtin ids overwritten only if missing or corrupted).
// Used by control/lib/skin.js on load. Returns { activeId, themes }.
function ensureBuiltinPresets(state) {
  var s = state && typeof state === "object" ? state : {};
  var themes = Object.assign({}, s.themes || {});
  var presets = builtinPresets();
  var changed = false;
  for (var i = 0; i < presets.length; i++) {
    var p = presets[i];
    if (!themes[p.id]) {
      themes[p.id] = p;
      changed = true;
    }
  }
  // keep activeId only if it still exists
  var activeId = s.activeId && themes[s.activeId] ? s.activeId : null;
  return { activeId: activeId, themes: themes };
}

// Duplicate a theme as a user theme (isBuiltin:false, new id). Pure.
// Returns a new theme object or null if source not found.
function duplicateTheme(state, id) {
  if (!state || !state.themes || !state.themes[id]) return null;
  var src = state.themes[id];
  var copy = makeSkinTheme(Object.assign({}, src, {
    id: undefined,  // force makeSkinTheme to mint a new id
    decorations: Object.assign({}, src.decorations)
  }));
  copy.isBuiltin = false;
  copy.name = src.name + " 副本";
  return copy;
}

module.exports = {
  COLOR_KEYS: COLOR_KEYS,
  DECORATION_EMOJI_POSITIONS: DECORATION_EMOJI_POSITIONS,
  isValidHex: isValidHex,
  normalizeEmojiBadges: normalizeEmojiBadges,
  makeSkinId: makeSkinId,
  validateTheme: validateTheme,
  makeSkinTheme: makeSkinTheme,
  builtinPresets: builtinPresets,
  ensureBuiltinPresets: ensureBuiltinPresets,
  duplicateTheme: duplicateTheme
};
