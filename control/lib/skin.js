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
  // browser inline copy (kept in sync with lib/skin.cjs manually)
  return {
    // The browser build re-defines these — but to keep this file standalone for
    // <script> inclusion, we DO require the duplicates. For simplicity in this
    // project (Node-tested), the browser path is exercised by real-machine only.
    COLOR_KEYS: ["background", "panel", "accent", "accentAlt", "text", "muted", "sidebarBg", "inputBg", "inputBorder"],
    DECORATION_EMOJI_POSITIONS: ["top-left", "top-right", "bottom-left", "bottom-right"],
    isValidHex: function (s) {
      if (typeof s !== "string") return false;
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s);
    },
    makeSkinId: function () {
      return "skin_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
    },
    validateTheme: function (t) {
      var errors = [];
      if (!t || typeof t !== "object") return { ok: false, errors: ["theme is not an object"] };
      if (!t.name || !String(t.name).trim()) errors.push("name 不能为空");
      if (t.colors && typeof t.colors === "object") {
        for (var i = 0; i < this.COLOR_KEYS.length; i++) {
          var k = this.COLOR_KEYS[i]; var v = t.colors[k];
          if (v != null && v !== "" && !this.isValidHex(v)) errors.push("colors." + k + " 不是合法 hex");
        }
      }
      if (t.radius != null && t.radius !== "" && (!isFinite(Number(t.radius)) || Number(t.radius) < 0)) errors.push("radius 必须是非负数字");
      return errors.length ? { ok: false, errors: errors } : { ok: true };
    },
    makeSkinTheme: function (p) {
      p = p || {}; var c = p.colors || {}; var d = p.decorations || {};
      return {
        id: p.id || this.makeSkinId(), name: p.name || "未命名皮肤", isBuiltin: p.isBuiltin === true,
        colors: { background: c.background||null, panel: c.panel||null, accent: c.accent||null, accentAlt: c.accentAlt||null, text: c.text||null, muted: c.muted||null, sidebarBg: c.sidebarBg||null, inputBg: c.inputBg||null, inputBorder: c.inputBorder||null },
        font: p.font || null, radius: (p.radius!=null&&p.radius!=="")?Number(p.radius):null,
        decorations: { brand: d.brand||null, sparkle: d.sparkle!==false, emojiBadge: d.emojiBadge||null, emojiPosition: this.DECORATION_EMOJI_POSITIONS.indexOf(d.emojiPosition)>=0?d.emojiPosition:"top-left" }
      };
    },
    builtinPresets: function () {
      return [
        { id: "skin-pink-builtin", name: "粉紫梦境", isBuiltin: true, colors: { background:"#fff9fc",panel:"#ffffff",accent:"#8b3dce",accentAlt:"#b45cff",text:"#4c2364",muted:"#9e58bd",sidebarBg:"#fff3f9",inputBg:"#fff5fa",inputBorder:"#e484bc" }, font:null, radius:16, decorations:{brand:"粉紫梦境",sparkle:true,emojiBadge:"♡",emojiPosition:"top-left"} },
        { id: "skin-darkgold-builtin", name: "暗夜金", isBuiltin: true, colors: { background:"#1a1410",panel:"#241d16",accent:"#d4a017",accentAlt:"#f0c040",text:"#e8dcc8",muted:"#9a8a70",sidebarBg:"#15110d",inputBg:"#2a2118",inputBorder:"#5a4a30" }, font:null, radius:12, decorations:{brand:"暗夜金",sparkle:true,emojiBadge:"✦",emojiPosition:"top-right"} },
        { id: "skin-sepia-builtin", name: "护眼米黄", isBuiltin: true, colors: { background:"#f5ecd9",panel:"#fbf5e8",accent:"#8b6914",accentAlt:"#a8862f",text:"#3a2f1f",muted:"#7a6a4f",sidebarBg:"#efe4cb",inputBg:"#faf3e0",inputBorder:"#c9b890" }, font:null, radius:10, decorations:{brand:null,sparkle:false,emojiBadge:null,emojiPosition:"top-left"} }
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
      var copy = this.makeSkinTheme(Object.assign({}, src, {
        id: undefined, // force makeSkinTheme to mint a new id
        decorations: Object.assign({}, src.decorations)
      }));
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
  COLOR_KEYS: skinModel.COLOR_KEYS,
  DECORATION_EMOJI_POSITIONS: skinModel.DECORATION_EMOJI_POSITIONS,
  isValidHex: skinModel.isValidHex,
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
