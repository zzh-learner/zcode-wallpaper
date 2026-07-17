// Skin frontend lib (spec §5.2). Dual export: CommonJS for Node tests +
// window.__ccSkin for browser. Re-exports the pure model fns from lib/skin.cjs
// and adds localStorage read/write glue (browser-only, real-machine verified,
// mirrors shelf.js/bookmark.js convention — pure fns unit-tested, IO not).
//
// localStorage key: zcode-control:skins = { activeId, themes: {id -> Theme} }.

// --- pull in pure model fns (server-side require; browser-side inline) ---
// In the browser, lib/skin.cjs isn't loaded, so we inline the same fns here
// (cross-env can't share code — mirrors reader/lib/codec.js dual-impl + shared
// test convention). Keep these identical to lib/skin.cjs; skintest runs the
// same assertions against both (lesson 17 mirror consistency).
var skinModel = (function () {
  if (typeof require === "function") {
    try { return require("../../lib/skin.cjs"); } catch (e) {}
  }
  // browser inline copy — MUST stay in sync with lib/skin.cjs (lesson 17 mirror,
  // skintest runs same assertions against both via window.__ccSkin).
  var OPACITY_RANGE = { min: 0, max: 100 };
  var BLUR_RANGE = { min: 0, max: 30 };
  var OVERLAY_DEFAULTS = {
    enabled: true,
    panelOpacity: 70, panelBlur: 12,
    inputOpacity: 70, inputBlur: 12,
    sidebarOpacity: 70, sidebarBlur: 12
  };
  var DECORATION_EMOJI_POSITIONS = ["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"];
  function clampNum(v, min, max, def) {
    if (v == null || v === "" || !isFinite(v)) return def;
    return Math.max(min, Math.min(max, Number(v)));
  }
  return {
    OPACITY_RANGE: OPACITY_RANGE,
    BLUR_RANGE: BLUR_RANGE,
    OVERLAY_DEFAULTS: OVERLAY_DEFAULTS,
    DECORATION_EMOJI_POSITIONS: DECORATION_EMOJI_POSITIONS,
    isValidHex: function (s) {
      if (typeof s !== "string") return false;
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s);
    },
    hexToRgb: function (s) {
      if (typeof s !== "string") return null;
      var m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s);
      if (!m) return null;
      var hex = m[1];
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
    },
    hexToRgba: function (hex, opacityPct) {
      var rgb = this.hexToRgb(hex);
      if (!rgb) return null;
      var a = isFinite(opacityPct) ? Math.max(0, Math.min(100, Number(opacityPct))) / 100 : 1;
      return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + a + ")";
    },
    clampNum: clampNum,
    makeOverlay: function (partial) {
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
    },
    normalizeEmojiBadges: function (deco) {
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
    },
    makeSkinId: function () {
      return "skin_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
    },
    validateTheme: function (t) {
      var errors = [];
      if (!t || typeof t !== "object") return { ok: false, errors: ["theme is not an object"] };
      if (!t.name || !String(t.name).trim()) errors.push("name 不能为空");
      if (t.radius != null && t.radius !== "" && (!isFinite(Number(t.radius)) || Number(t.radius) < 0)) errors.push("radius 必须是非负数字");
      if (t.overlay && typeof t.overlay === "object") {
        function chk(v, key, min, max) {
          if (v == null || v === "") return;
          if (!isFinite(v) || v < min || v > max) errors.push("overlay." + key + " 必须在 " + min + "-" + max);
        }
        chk(t.overlay.panelBlur, "panelBlur", BLUR_RANGE.min, BLUR_RANGE.max);
        chk(t.overlay.inputBlur, "inputBlur", BLUR_RANGE.min, BLUR_RANGE.max);
        chk(t.overlay.sidebarBlur, "sidebarBlur", BLUR_RANGE.min, BLUR_RANGE.max);
        chk(t.overlay.panelOpacity, "panelOpacity", OPACITY_RANGE.min, OPACITY_RANGE.max);
        chk(t.overlay.inputOpacity, "inputOpacity", OPACITY_RANGE.min, OPACITY_RANGE.max);
        chk(t.overlay.sidebarOpacity, "sidebarOpacity", OPACITY_RANGE.min, OPACITY_RANGE.max);
      }
      if (t.decorations && Array.isArray(t.decorations.emojiBadges)) {
        for (var j = 0; j < t.decorations.emojiBadges.length; j++) {
          var b = t.decorations.emojiBadges[j];
          if (b && typeof b === "object" && b.position != null && DECORATION_EMOJI_POSITIONS.indexOf(b.position) === -1) {
            errors.push("emojiBadges[" + j + "].position 无效");
          }
        }
      }
      return errors.length ? { ok: false, errors: errors } : { ok: true };
    },
    makeSkinTheme: function (p) {
      p = p || {}; var d = p.decorations || {};
      return {
        id: p.id || this.makeSkinId(), name: p.name || "未命名皮肤", isBuiltin: p.isBuiltin === true,
        font: p.font || null, radius: (p.radius != null && p.radius !== "") ? Number(p.radius) : null,
        overlay: this.makeOverlay(p.overlay),
        decorations: {
          sparkle: d.sparkle === true,
          sparkleCount: (function () { var n = Number(d.sparkleCount); if (!isFinite(n) || d.sparkleCount == null || d.sparkleCount === "") return 12; return Math.max(0, Math.min(50, Math.round(n))); })(),
          emojiBadges: this.normalizeEmojiBadges(d), emojiBadge: d.emojiBadge || null,
          emojiPosition: DECORATION_EMOJI_POSITIONS.indexOf(d.emojiPosition) >= 0 ? d.emojiPosition : "top-left"
        }
      };
    },
    builtinPresets: function () {
      return [
        { id: "skin-default-builtin", name: "默认主题", isBuiltin: true, font: null, radius: null, overlay: { enabled: true, panelOpacity: 70, panelBlur: 12, inputOpacity: 70, inputBlur: 12, sidebarOpacity: 70, sidebarBlur: 12 }, decorations: { sparkle: false, sparkleCount: 12, emojiBadges: [] } }
      ];
    },
    ensureBuiltinPresets: function (state) {
      var s = state && typeof state === "object" ? state : {};
      var themes = Object.assign({}, s.themes || {});
      var presets = this.builtinPresets();
      for (var i = 0; i < presets.length; i++) { if (!themes[presets[i].id]) themes[presets[i].id] = presets[i]; }
      var activeId = s.activeId && themes[s.activeId] ? s.activeId : null;
      return { activeId: activeId, themes: themes };
    },
    duplicateTheme: function (state, id) {
      if (!state || !state.themes || !state.themes[id]) return null;
      var src = state.themes[id];
      var copy = this.makeSkinTheme(Object.assign({}, src, { id: undefined, decorations: Object.assign({}, src.decorations) }));
      copy.isBuiltin = false; copy.name = src.name + " 副本";
      return copy;
    }
  };
})();

var SKINS_KEY = "zcode-control:skins";

// localStorage read/write (browser-only). Returns {activeId, themes} always,
// seeding builtins on first load. NOT unit-tested (mirrors shelf.js IO).
function loadSkins() {
  var raw = null;
  try { raw = localStorage.getItem(SKINS_KEY); } catch (e) {}
  var state = raw ? JSON.parse(raw) : { activeId: null, themes: {} };
  state = skinModel.ensureBuiltinPresets(state);
  try { localStorage.setItem(SKINS_KEY, JSON.stringify(state)); } catch (e) {}
  return state;
}
function saveSkins(state) {
  try { localStorage.setItem(SKINS_KEY, JSON.stringify(state)); } catch (e) {}
  return state;
}
function getActiveSkin(state) {
  if (!state || !state.activeId || !state.themes) return null;
  return state.themes[state.activeId] || null;
}

// Re-export model fns + IO glue under both CommonJS and window.
var api = {
  OPACITY_RANGE: skinModel.OPACITY_RANGE,
  BLUR_RANGE: skinModel.BLUR_RANGE,
  OVERLAY_DEFAULTS: skinModel.OVERLAY_DEFAULTS,
  DECORATION_EMOJI_POSITIONS: skinModel.DECORATION_EMOJI_POSITIONS,
  isValidHex: skinModel.isValidHex,
  hexToRgb: skinModel.hexToRgb,
  hexToRgba: skinModel.hexToRgba,
  clampNum: skinModel.clampNum,
  makeOverlay: skinModel.makeOverlay,
  normalizeEmojiBadges: skinModel.normalizeEmojiBadges,
  makeSkinId: skinModel.makeSkinId,
  validateTheme: skinModel.validateTheme,
  makeSkinTheme: skinModel.makeSkinTheme,
  builtinPresets: skinModel.builtinPresets,
  ensureBuiltinPresets: skinModel.ensureBuiltinPresets,
  duplicateTheme: skinModel.duplicateTheme,
  loadSkins: loadSkins,
  saveSkins: saveSkins,
  getActiveSkin: getActiveSkin
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.__ccSkin = api;
