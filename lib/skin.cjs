// Skin theme model — pure functions shared by server (skin-inject.cjs, tests)
// and frontend (control/lib/skin.js re-exports these + adds localStorage glue).
//
// Design (spec 2026-07-17-skin-overlay-frosted-glass v2): a Theme is a plain
// object with id/name/font/radius/overlay/decorations. NO colors field — the
// frosted-glass overlay's底色 follows ZCode theme via CSS color-mix() reading
// native --color-neutral-* / --color-input / --color-brand vars (spike-verified
// 2026-07-17). Stored in localStorage key `zcode-control:skins` as
// { activeId, themes: {id -> Theme} }. 1 builtin preset seeded on first load.
//
// Pure-function convention (mirrors bookmark.js/shelf.js): validation, id
// generation, preset seeding, duplication are pure + unit-tested. localStorage
// read/write lives in control/lib/skin.js (browser-only, real-machine verified).

var OPACITY_RANGE = { min: 0, max: 100 };
var BLUR_RANGE = { min: 0, max: 30 };

var OVERLAY_DEFAULTS = {
  enabled: true,
  panelOpacity: 70, panelBlur: 12,
  inputOpacity: 70, inputBlur: 12,
  sidebarOpacity: 70, sidebarBlur: 12
};

var DECORATION_EMOJI_POSITIONS = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-right",
  "bottom-left", "bottom-center", "bottom-right"
];

function isValidHex(s) {
  if (typeof s !== "string") return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s);
}

function hexToRgb(s) {
  if (typeof s !== "string") return null;
  var m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s);
  if (!m) return null;
  var hex = m[1];
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

function hexToRgba(hex, opacityPct) {
  var rgb = hexToRgb(hex);
  if (!rgb) return null;
  var a = isFinite(opacityPct) ? Math.max(0, Math.min(100, Number(opacityPct))) / 100 : 1;
  return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + a + ")";
}

function clampNum(v, min, max, defaultIfMissing) {
  if (v == null || v === "" || !isFinite(v)) return defaultIfMissing;
  return Math.max(min, Math.min(max, Number(v)));
}

// Normalize overlay config (frosted-glass, spec §2.1). Legacy *Bg fields silently dropped.
function makeOverlay(partial) {
  var o = (partial && typeof partial === "object") ? partial : {};
  return {
    enabled: o.enabled === true,
    panelOpacity: clampNum(o.panelOpacity, OPACITY_RANGE.min, OPACITY_RANGE.max, OVERLAY_DEFAULTS.panelOpacity),
    panelBlur: clampNum(o.panelBlur, BLUR_RANGE.min, BLUR_RANGE.max, OVERLAY_DEFAULTS.panelBlur),
    inputOpacity: clampNum(o.inputOpacity, OPACITY_RANGE.min, OPACITY_RANGE.max, OVERLAY_DEFAULTS.inputOpacity),
    inputBlur: clampNum(o.inputBlur, BLUR_RANGE.min, BLUR_RANGE.max, OVERLAY_DEFAULTS.inputBlur),
    sidebarOpacity: clampNum(o.sidebarOpacity, OPACITY_RANGE.min, OPACITY_RANGE.max, OVERLAY_DEFAULTS.sidebarOpacity),
    sidebarBlur: clampNum(o.sidebarBlur, BLUR_RANGE.min, BLUR_RANGE.max, OVERLAY_DEFAULTS.sidebarBlur)
  };
}

function normalizeEmojiBadges(deco) {
  if (!deco || typeof deco !== "object") return [];
  var out = [];
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
  if (deco.emojiBadge != null && String(deco.emojiBadge).trim()) {
    var pos2 = DECORATION_EMOJI_POSITIONS.indexOf(deco.emojiPosition) >= 0 ? deco.emojiPosition : "top-left";
    out.push({ emoji: String(deco.emojiBadge).trim(), position: pos2 });
  }
  return out;
}

function makeSkinId() {
  return "skin_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
}

function validateTheme(t) {
  var errors = [];
  if (!t || typeof t !== "object") return { ok: false, errors: ["theme is not an object"] };
  if (!t.name || typeof t.name !== "string" || !t.name.trim()) errors.push("name 不能为空");
  // NOTE: t.colors (legacy) silently ignored, NOT validated.
  if (t.radius != null && t.radius !== "") {
    var r = Number(t.radius);
    if (!isFinite(r) || r < 0) errors.push("radius 必须是非负数字");
  }
  if (t.font != null && t.font !== "" && typeof t.font !== "string") {
    errors.push("font 必须是字符串");
  }
  if (t.overlay) {
    if (typeof t.overlay !== "object") {
      errors.push("overlay 必须是对象");
    } else {
      function checkRange(v, key, min, max) {
        if (v == null || v === "") return;
        if (!isFinite(v) || v < min || v > max) {
          errors.push("overlay." + key + " 必须在 " + min + "-" + max);
        }
      }
      checkRange(t.overlay.panelBlur, "panelBlur", BLUR_RANGE.min, BLUR_RANGE.max);
      checkRange(t.overlay.inputBlur, "inputBlur", BLUR_RANGE.min, BLUR_RANGE.max);
      checkRange(t.overlay.sidebarBlur, "sidebarBlur", BLUR_RANGE.min, BLUR_RANGE.max);
      checkRange(t.overlay.panelOpacity, "panelOpacity", OPACITY_RANGE.min, OPACITY_RANGE.max);
      checkRange(t.overlay.inputOpacity, "inputOpacity", OPACITY_RANGE.min, OPACITY_RANGE.max);
      checkRange(t.overlay.sidebarOpacity, "sidebarOpacity", OPACITY_RANGE.min, OPACITY_RANGE.max);
    }
  }
  if (t.decorations) {
    if (typeof t.decorations !== "object") {
      errors.push("decorations 必须是对象");
    } else {
      if (Array.isArray(t.decorations.emojiBadges)) {
        for (var i = 0; i < t.decorations.emojiBadges.length; i++) {
          var b = t.decorations.emojiBadges[i];
          if (b && typeof b === "object" && b.position != null &&
              DECORATION_EMOJI_POSITIONS.indexOf(b.position) === -1) {
            errors.push("emojiBadges[" + i + "].position 必须是 " + DECORATION_EMOJI_POSITIONS.join("/") + " 之一");
          }
        }
      }
      if (t.decorations.emojiBadge != null && t.decorations.emojiBadge !== "" &&
          DECORATION_EMOJI_POSITIONS.indexOf(t.decorations.emojiPosition) === -1) {
        errors.push("emojiPosition 必须是 " + DECORATION_EMOJI_POSITIONS.join("/") + " 之一");
      }
    }
  }
  return errors.length ? { ok: false, errors: errors } : { ok: true };
}

function makeSkinTheme(partial) {
  var p = partial || {};
  var deco = p.decorations || {};
  return {
    id: p.id || makeSkinId(),
    name: p.name || "未命名皮肤",
    isBuiltin: p.isBuiltin === true,
    font: p.font || null,
    radius: p.radius != null && p.radius !== "" ? Number(p.radius) : null,
    overlay: makeOverlay(p.overlay),
    decorations: {
      sparkle: deco.sparkle === true, // spec §2.4: default FALSE
      sparkleCount: (function () {
        var n = Number(deco.sparkleCount);
        if (!isFinite(n) || deco.sparkleCount == null || deco.sparkleCount === "") return 12;
        return Math.max(0, Math.min(50, Math.round(n)));
      })(),
      emojiBadges: normalizeEmojiBadges(deco),
      emojiBadge: deco.emojiBadge || null,
      emojiPosition: DECORATION_EMOJI_POSITIONS.indexOf(deco.emojiPosition) >= 0
        ? deco.emojiPosition : "top-left"
    }
  };
}

function builtinPresets() {
  return [
    {
      id: "skin-default-builtin",
      name: "默认主题",
      isBuiltin: true,
      font: null,
      radius: null,
      overlay: { enabled: true, panelOpacity: 70, panelBlur: 12, inputOpacity: 70, inputBlur: 12, sidebarOpacity: 70, sidebarBlur: 12 },
      decorations: { sparkle: false, sparkleCount: 12, emojiBadges: [] }
    }
  ];
}

function ensureBuiltinPresets(state) {
  var s = state && typeof state === "object" ? state : {};
  var themes = Object.assign({}, s.themes || {});
  var presets = builtinPresets();
  for (var i = 0; i < presets.length; i++) {
    var p = presets[i];
    if (!themes[p.id]) themes[p.id] = p;
  }
  var activeId = s.activeId && themes[s.activeId] ? s.activeId : null;
  return { activeId: activeId, themes: themes };
}

function duplicateTheme(state, id) {
  if (!state || !state.themes || !state.themes[id]) return null;
  var src = state.themes[id];
  var copy = makeSkinTheme(Object.assign({}, src, {
    id: undefined,
    decorations: Object.assign({}, src.decorations)
  }));
  copy.isBuiltin = false;
  copy.name = src.name + " 副本";
  return copy;
}

module.exports = {
  OPACITY_RANGE: OPACITY_RANGE,
  BLUR_RANGE: BLUR_RANGE,
  OVERLAY_DEFAULTS: OVERLAY_DEFAULTS,
  DECORATION_EMOJI_POSITIONS: DECORATION_EMOJI_POSITIONS,
  isValidHex: isValidHex,
  hexToRgb: hexToRgb,
  hexToRgba: hexToRgba,
  clampNum: clampNum,
  makeOverlay: makeOverlay,
  normalizeEmojiBadges: normalizeEmojiBadges,
  makeSkinId: makeSkinId,
  validateTheme: validateTheme,
  makeSkinTheme: makeSkinTheme,
  builtinPresets: builtinPresets,
  ensureBuiltinPresets: ensureBuiltinPresets,
  duplicateTheme: duplicateTheme
};
