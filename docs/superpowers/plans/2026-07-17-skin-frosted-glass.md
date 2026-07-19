# 皮肤系统磨砂玻璃重构 Implementation Plan（v2，spike 后修订）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把皮肤系统的「壁纸叠加」从「给 UI 加颜色层」重构为「让 UI 面板半透明 + 模糊化的磨砂玻璃」，删除整个主色面板（7 个颜色选择器），底色用 CSS `color-mix()` + ZCode 原生底层主题变量（真跟随主题）。

**Architecture:** 在注入的 `<style>` 里直接写 `color-mix(in srgb, var(--color-neutral-900) N%, transparent) + backdrop-filter:blur()`，让 CSS 引擎在浏览器里实时解析原生主题变量。**完全不动 wallpaper.css**、不需要 JS 运行时读 computed value、不需要 Node 拼字符串 rgba。底色真跟随主题（ZCode 切深/浅色，磨砂层底色自动变）。前端 UI 删除主色面板、overlay 改透明度+模糊度双滑块、删除颜色预设只留一个默认主题、装饰层默认关闭。

**Tech Stack:** Node.js (CommonJS `.cjs`)、CDP over WebSocket（`lib/cdp.cjs`）、CSS `color-mix()` + `backdrop-filter`、localStorage 前端状态、原生 DOM 事件（无框架）。

**Spec:** `docs/superpowers/specs/2026-07-17-skin-overlay-frosted-glass-design.md`（v2，spike 后修订）

## Spike 结论（2026-07-17，已完成）

原方案「备份原主题色到 `--zcode-wp-orig-*` 自定义变量」**真机失败**——CSS 自定义属性是按引用延迟解析，
不是求值即写入。spike 顺带挖出新方案所需的真机数据：
- 原生底层变量 `--color-neutral-900`/`--color-input`/`--color-brand` 未被 wallpaper.css 覆盖，有真色值
- `color-mix(in srgb, var(--x) N%, transparent)` 在 ZCode Chromium 146（Electron 41）完美工作，输出 `color(srgb R G B / A)`

详见 spec §3.3。**新方案完全不动 wallpaper.css**，比原方案简单一个数量级。

## Global Constraints

- **文件命名**：所有新/改文件保持现有扩展名约定——`.cjs`（Node 模块）、`.js`（前端 lib，dual export CommonJS + `window.__ccXxx`）、`.css`。
- **测试入口**：`npm test`（含 `pretest` 钩子重建 epub fixture）。skin 相关测试在链尾：`... && node test/skintest.cjs && node test/skininjecttest.cjs`。
- **前端 lib dual export 铁律**（AGENTS.md）：`control/lib/skin.js` 的浏览器 inline 副本必须和 `lib/skin.cjs` 字段集完全一致，靠 `test/skintest.cjs` 同时跑两边断言钉一致（教训 17 mirror）。
- **磨砂层选择器不动**：`main, [role='main']` / `.chat-composer-region, .bg-input, .focus-within\\:bg-input-focused` / `#sidebar, aside.h-full` 来自真机探测（`scripts/inspect-skin2.cjs`，2026-07-16，ZCode 3.3.6）。
- **CSS 用 `color-mix()` 不用 `rgba()`**：底色跟随主题靠 CSS 引擎解析 `var()`，**不要**在 Node 侧读 computed value 拼 rgba（已废弃的旧方案）。
- **ZCode 原生变量名是 SPI**：`--color-neutral-900`/`--color-neutral-950`/`--color-input`/`--color-brand` 是真机验过的接口。ZCode 升级要重跑 `scripts/inspect-skin2.cjs` 复验。`var(--x, fallback)` 可加 hex 兜底防崩溃。
- **每步独立 commit**，commit message 用 conventional 前缀（`feat(skin)`/`refactor(skin)`/`test(skin)`）。

## File Structure

| 文件 | 责任 | 操作 |
| --- | --- | --- |
| `lib/skin.cjs` | 皮肤纯模型（Node 端权威） | Modify（删 COLOR_KEYS 相关、改 makeOverlay/makeSkinTheme/builtinPresets/validateTheme） |
| `control/lib/skin.js` | 皮肤前端 lib（dual export，浏览器 inline 副本） | Modify（镜像 `lib/skin.cjs` 改动） |
| `lib/skin-inject.cjs` | CDP 注入皮肤；重写 `renderSkinCss`（color-mix）+ `renderSkinChromeCss`（sparkle 用 var(--color-brand)） | Modify |
| `lib/skin-selectors.cjs` | 选择器/变量映射；新增 `FROST_BASE_VARS` 常量 + overlay 区域→原生底层变量映射 + `OVERLAY_REGION_SELECTORS` | Modify |
| `control/lib/skin-view.js` | 皮肤面板 UI；删主色面板、overlay 改双滑块、改默认主题渲染、改 live-preview/collectEditor | Modify |
| `test/skintest.cjs` | skin.cjs + skin.js mirror 一致性测试 | Modify（重写字段集断言） |
| `test/skininjecttest.cjs` | skin-inject.cjs 纯渲染测试 | Modify（重写 overlay 断言、加 color-mix/blur 断言） |

**无新增文件、不改 wallpaper.css**——所有改动都在现有文件上。

---

## Task 1: ~~Spike 验证 CSS 备份变量机制~~（已完成 2026-07-17）

**状态：DONE_WITH_CONCERNS（机制失败，但顺带挖出新方案 color-mix）**

详见 spike 报告 `.superpowers/sdd/task-1-report.md`。结论：
- 备份机制不成立（CSS 自定义属性按引用延迟解析）
- color-mix 方案完美工作（spike 真机验过）
- spec 已更新到 v2（§3.3）
- wallpaper.css 无需改动
- inspect-skin2.cjs 的 backupProbe 改动已丢弃（用 `git checkout`）

**继续 Task 2**——基于新方案。

---

## Task 2: `lib/skin.cjs` 模型重构（删 COLOR_KEYS、overlay 加 blur、改默认主题）

**Files:**
- Modify: `lib/skin.cjs`
- Test: `test/skintest.cjs`

**Interfaces:**
- Produces:
  - `makeOverlay(partial)` → `{ enabled, panelOpacity, panelBlur, inputOpacity, inputBlur, sidebarOpacity, sidebarBlur }`（**无 `*Bg` 字段**）
  - `makeSkinTheme(partial)` → 不再有 `colors` 字段；`overlay` 用新形状；`decorations.sparkle` 默认 `false`
  - `builtinPresets()` → 只返回 1 个「默认主题」`skin-default-builtin`
  - `validateTheme(t)` → 不再校验 `colors`；新增 `overlay.*Blur` 的 0-30 clamp 校验
  - 仍导出 `isValidHex`/`hexToRgb`/`hexToRgba`（兼容性保留）
  - **删除导出**：`COLOR_KEYS`
  - 新增导出：`OPACITY_RANGE = { min: 0, max: 100 }`、`BLUR_RANGE = { min: 0, max: 30 }`、`OVERLAY_DEFAULTS`

- [ ] **Step 1: 写失败测试（在 `test/skintest.cjs` 末尾追加）**

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/skintest.cjs`
Expected: 新断言 FAIL（旧实现还在），整体 `fail > 0`。

- [ ] **Step 3: 重写 `lib/skin.cjs`**

完整替换 `lib/skin.cjs` 内容为：

```js
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
```

- [ ] **Step 4: 删 `test/skintest.cjs` 里针对旧字段集的断言**

打开 `test/skintest.cjs`。删除/改写以下旧断言段：
- 删 line 33-42（旧 `makeOverlay` 带 `panelBg`/`inputBg`/`sidebarBg` 的断言）——已被 Step 1 追加的新断言取代
- 删 line 51-56（旧 `validateTheme` 带 `colors.accent` 的断言）
- line 22-31（`hexToRgb`/`hexToRgba` 断言）：**保留**（这俩函数还在用）
- 改 `makeSkinTheme` 相关断言：把所有访问 `.colors.xxx` 的断言删掉
- 改 builtinPresets 相关旧断言（断言 3 个预设的）：删掉

**注意**：`test/skintest.cjs` 同时跑 `lib/skin.cjs`（`skin`）和 `control/lib/skin.js`（`skinWeb`）的 mirror 一致性断言。本 task 只改 `lib/skin.cjs`，所以 `skinWeb` 的旧断言会 FAIL——**临时把 `skinWeb` 的 mirror 断言注释掉**（加「TODO Task 3」注释），Task 3 恢复。

- [ ] **Step 5: 跑测试确认新断言通过**

Run: `node test/skintest.cjs`
Expected: 所有断言 PASS，`fail: 0`。

- [ ] **Step 6: Commit**

```bash
git add lib/skin.cjs test/skintest.cjs
git commit -m "refactor(skin): 删 COLOR_KEYS、overlay 加 blur 字段、改默认主题

- makeOverlay: 删 panelBg/inputBg/sidebarBg，加 panelBlur/inputBlur/sidebarBlur
- makeSkinTheme: 删 colors 字段，decorations.sparkle 默认 false
- builtinPresets: 只留 1 个 skin-default-builtin
- validateTheme: 不再校验 colors，加 overlay.*Blur 0-30 校验
- 新增导出 OPACITY_RANGE/BLUR_RANGE/OVERLAY_DEFAULTS/clampNum
- skintest 同步；mirror 断言临时注释（Task 3 恢复）"
```

---

## Task 3: `control/lib/skin.js` 镜像同步

**Files:**
- Modify: `control/lib/skin.js`

**Interfaces:**
- Produces: `window.__ccSkin` 的 API 与 `lib/skin.cjs` 导出**完全一致**（含 `OPACITY_RANGE`/`BLUR_RANGE`/`OVERLAY_DEFAULTS`/`clampNum`，无 `COLOR_KEYS`）

- [ ] **Step 1: 跑 skintest 确认当前 mirror 断言失败**

Run: `node test/skintest.cjs`
Expected: Task 2 Step 4 注释掉的 mirror 断言已跳过；如有未注释的 mirror 断言 FAIL。

- [ ] **Step 2: 重写 `control/lib/skin.js` 的 inline 副本**

打开 `control/lib/skin.js`，替换 line 13-135 的整个 `skinModel` IIFE：

```js
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
```

- [ ] **Step 3: 改 `control/lib/skin.js` 的 api 导出**

找到 line 159-176 的 `var api = {...}` 块。删除 `COLOR_KEYS: skinModel.COLOR_KEYS,` 行，加 `OPACITY_RANGE/BLUR_RANGE/OVERLAY_DEFAULTS/clampNum`：

```js
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
```

- [ ] **Step 4: 恢复 `test/skintest.cjs` 的 mirror 断言**

把 Task 2 Step 4 注释掉的 mirror 断言全部恢复。加到 skintest 末尾：

```js
// === MIRROR 一致性：skin.cjs vs control/lib/skin.js 必须字段集一致 ===
check("mirror: makeOverlay 字段集一致", JSON.stringify(Object.keys(skin.makeOverlay({})).sort()) === JSON.stringify(Object.keys(skinWeb.makeOverlay({})).sort()));
check("mirror: makeSkinTheme 字段集一致（无 colors）", JSON.stringify(Object.keys(skin.makeSkinTheme({})).sort()) === JSON.stringify(Object.keys(skinWeb.makeSkinTheme({})).sort()));
check("mirror: builtinPresets 长度一致", skin.builtinPresets().length === skinWeb.builtinPresets().length);
check("mirror: builtinPresets[0].id 一致", skin.builtinPresets()[0].id === skinWeb.builtinPresets()[0].id);
check("mirror: OPACITY_RANGE 一致", JSON.stringify(skin.OPACITY_RANGE) === JSON.stringify(skinWeb.OPACITY_RANGE));
check("mirror: BLUR_RANGE 一致", JSON.stringify(skin.BLUR_RANGE) === JSON.stringify(skinWeb.BLUR_RANGE));
check("mirror: COLOR_KEYS 两边都 undefined", skin.COLOR_KEYS === undefined && skinWeb.COLOR_KEYS === undefined);
check("mirror: makeOverlay 相同输入同输出", JSON.stringify(skin.makeOverlay({ panelOpacity: 50, panelBlur: 5 })) === JSON.stringify(skinWeb.makeOverlay({ panelOpacity: 50, panelBlur: 5 })));
```

- [ ] **Step 5: 跑 skintest 确认全绿**

Run: `node test/skintest.cjs`
Expected: 所有断言 PASS（含 mirror），`fail: 0`。

- [ ] **Step 6: Commit**

```bash
git add control/lib/skin.js test/skintest.cjs
git commit -m "refactor(skin): control/lib/skin.js 镜像同步 + 恢复 mirror 断言

浏览器 inline 副本与 lib/skin.cjs 字段集完全一致：
- 删 COLOR_KEYS、删 colors 字段
- makeOverlay 新增 *Blur、删 *Bg
- builtinPresets 只 1 个默认主题
- 新增 OPACITY_RANGE/BLUR_RANGE/OVERLAY_DEFAULTS/clampNum 导出
skintest 恢复 mirror 一致性断言（lesson 17）。"
```

---

## Task 4: `lib/skin-selectors.cjs` 加原生变量映射

**Files:**
- Modify: `lib/skin-selectors.cjs`

**Interfaces:**
- Produces:
  - `FROST_BASE_VARS = { panel: "--color-neutral-900", input: "--color-input", sidebar: "--color-neutral-950", accent: "--color-brand" }`（spec §3.4 真机验过的原生底层变量名）
  - `OVERLAY_REGION_SELECTORS = { panel: "main, [role='main']", input: ".chat-composer-region, .bg-input, .focus-within\\:bg-input-focused", sidebar: "#sidebar, aside.h-full" }`
  - 仍导出 `COLOR_TO_TOKENS`/`SKIN_ELEMENT_RULES`（保留无害）/`SKIN_STYLE_ID`/`SKIN_CHROME_ID`

- [ ] **Step 1: 写失败测试（加到 `test/skininjecttest.cjs` 顶部）**

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/skininjecttest.cjs`
Expected: 新断言 FAIL（`sel.FROST_BASE_VARS` undefined）。

- [ ] **Step 3: 改 `lib/skin-selectors.cjs`**

在 `SKIN_STYLE_ID`/`SKIN_CHROME_ID` 声明之前加：

```js
// Frosted-glass base vars (spec §3.4, spike-verified 2026-07-17). Native ZCode
// theme color vars NOT overridden by wallpaper.css. skin-inject's renderSkinCss
// emits `color-mix(in srgb, var(<these>) N%, transparent)` to follow theme.
// IMPORTANT: these are SPI (real-machine interface). ZCode upgrade may rename
// them → re-run scripts/inspect-skin2.cjs to verify, then update here.
// var(name, fallback) syntax in skin-inject adds hex fallback for safety.
var FROST_BASE_VARS = {
  panel: "--color-neutral-900",   // spike value: oklch(20.5% 0 0) dark
  input: "--color-input",         // spike value: #2b2b2b (hex)
  sidebar: "--color-neutral-950", // spike value: oklch(14.5% 0 0) — deeper than panel
  accent: "--color-brand"         // sparkle glow; spike value: #d4a017 (hex)
};

// Element selectors per frosted-glass region (spec §4.5). Single source of truth.
// From real-machine probe (inspect-skin2.cjs, 2026-07-16, ZCode 3.3.6).
var OVERLAY_REGION_SELECTORS = {
  panel: "main, [role='main']",
  input: ".chat-composer-region, .bg-input, .focus-within\\:bg-input-focused",
  sidebar: "#sidebar, aside.h-full"
};
```

在 `module.exports` 里加：

```js
module.exports = {
  COLOR_TO_TOKENS: COLOR_TO_TOKENS,
  SKIN_ELEMENT_RULES: SKIN_ELEMENT_RULES,
  FROST_BASE_VARS: FROST_BASE_VARS,
  OVERLAY_REGION_SELECTORS: OVERLAY_REGION_SELECTORS,
  SKIN_STYLE_ID: SKIN_STYLE_ID,
  SKIN_CHROME_ID: SKIN_CHROME_ID
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/skininjecttest.cjs`
Expected: 新断言 PASS。**临时把旧 `renderSkinCss` 断言段（line 9-50）注释掉**（加「TODO Task 5」注释），Task 5 恢复。

- [ ] **Step 5: Commit**

```bash
git add lib/skin-selectors.cjs test/skininjecttest.cjs
git commit -m "feat(skin): skin-selectors 新增 FROST_BASE_VARS + OVERLAY_REGION_SELECTORS

color-mix 方案：原生 ZCode 底层变量名（spike-verified）+ 区域选择器。
单一权威定义，skin-inject Task 5 会读这里。
旧 renderSkinCss 断言临时注释（Task 5 恢复）。"
```

---

## Task 5: `lib/skin-inject.cjs` 重写（renderSkinCss 用 color-mix）

**Files:**
- Modify: `lib/skin-inject.cjs`（重写 `renderSkinCss`、`renderSkinChromeCss`，**不需要** `readBackupVarsExpression`/`parseBackupVarsResult`）

**Interfaces:**
- Consumes: `sel.FROST_BASE_VARS`、`sel.OVERLAY_REGION_SELECTORS`（Task 4）
- Produces:
  - `renderSkinCss(theme)` —— 输出含 `color-mix(in srgb, var(--color-...) N%, transparent) + backdrop-filter:blur()` 的 CSS。**单步注入**，无需预先读备份变量。
  - `buildSkinExpression(theme)` —— 回到单步签名（不再需要 themeColors 参数）

- [ ] **Step 1: 写失败测试（恢复 + 新增到 `test/skininjecttest.cjs`）**

打开 `test/skininjecttest.cjs`。**恢复 Task 4 Step 4 注释掉的旧 `renderSkinCss` 断言**并改成新形状。新断言段：

```js
// === renderSkinCss: 磨砂玻璃新形状（Task 5，color-mix 方案）===
var cssFrost = si.renderSkinCss({
  name: "磨砂测试",
  overlay: { enabled: true, panelOpacity: 70, panelBlur: 12, inputOpacity: 70, inputBlur: 12, sidebarOpacity: 70, sidebarBlur: 12 }
});
check("frost overlay section present", cssFrost.indexOf("frosted glass") >= 0 || cssFrost.indexOf("overlay") >= 0);
// 面板：color-mix + var(--color-neutral-900) + 70%
check("frost panel color-mix", cssFrost.indexOf("color-mix(in srgb, var(--color-neutral-900) 70%, transparent)") >= 0);
check("frost panel backdrop-filter blur 12px", cssFrost.indexOf("backdrop-filter: blur(12px)") >= 0);
check("frost has webkit prefix", cssFrost.indexOf("-webkit-backdrop-filter") >= 0);
// 输入框：var(--color-input)
check("frost input color-mix", cssFrost.indexOf("color-mix(in srgb, var(--color-input)") >= 0);
// 侧栏：var(--color-neutral-950)
check("frost sidebar color-mix", cssFrost.indexOf("color-mix(in srgb, var(--color-neutral-950)") >= 0);
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
check("custom panel opacity 50%", cssCustom.indexOf("var(--color-neutral-900) 50%, transparent)") >= 0);
check("custom panel blur 5px", cssCustom.indexOf("blur(5px)") >= 0);
check("custom input opacity 80%", cssCustom.indexOf("var(--color-input) 80%, transparent)") >= 0);
// blur=0 的区域：可以省略 backdrop-filter（无意义 GPU 开销）
// sidebar blur=20
check("custom sidebar blur 20px", cssCustom.indexOf("blur(20px)") >= 0);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/skininjecttest.cjs`
Expected: 新断言 FAIL（`renderSkinCss` 还是旧签名）。

- [ ] **Step 3: 重写 `lib/skin-inject.cjs` 的 `renderSkinCss`**

替换 line 33-110 左右的整个 `renderSkinCss` 函数（从 `function renderSkinCss(theme) {` 到对应的 `}`）：

```js
// Render a theme into CSS for #zcode-user-skin (spec §4 frosted-glass, color-mix).
// NO themeColors parameter — color-mix + var() lets the CSS engine resolve
// ZCode's native theme vars at runtime in the browser. Spec §3.3 (v2 after spike).
// Emits:
//   0) OVERLAY rules (when theme.overlay.enabled): color-mix(var(--base), N%, transparent)
//      + backdrop-filter:blur() on 3 element selectors. 底色真跟随主题.
//   1) font override if theme.font set
//   2) radius override if theme.radius set
function renderSkinCss(theme) {
  var lines = ["/* ZCode skin: " + (theme.name || "unnamed") + " */"];
  var ov = theme.overlay || {};

  if (ov.enabled) {
    var regions = [
      { name: "panel", selector: sel.OVERLAY_REGION_SELECTORS.panel, baseVar: sel.FROST_BASE_VARS.panel, opacity: ov.panelOpacity, blur: ov.panelBlur },
      { name: "input", selector: sel.OVERLAY_REGION_SELECTORS.input, baseVar: sel.FROST_BASE_VARS.input, opacity: ov.inputOpacity, blur: ov.inputBlur },
      { name: "sidebar", selector: sel.OVERLAY_REGION_SELECTORS.sidebar, baseVar: sel.FROST_BASE_VARS.sidebar, opacity: ov.sidebarOpacity, blur: ov.sidebarBlur }
    ];
    lines.push("/* frosted glass overlay: wallpaper coexistence */");
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i];
      var opPct = isFinite(r.opacity) ? Math.max(0, Math.min(100, Number(r.opacity))) : 100;
      var colorMix = "color-mix(in srgb, var(" + r.baseVar + ") " + opPct + "%, transparent)";
      var blurDecl = r.blur > 0
        ? " backdrop-filter: blur(" + r.blur + "px) !important; -webkit-backdrop-filter: blur(" + r.blur + "px) !important;"
        : "";
      lines.push(r.selector + " { background-color: " + colorMix + " !important;" + blurDecl + " }");
    }
  }

  if (theme.font && typeof theme.font === "string" && theme.font.trim()) {
    lines.push("* { font-family: " + JSON.stringify(theme.font.trim()) + " !important; }");
  }

  if (theme.radius != null && theme.radius !== "" && isFinite(Number(theme.radius))) {
    var rad = Number(theme.radius);
    lines.push(".bg-input, button, [class*='card'], [class*='rounded'] { border-radius: " + rad + "px !important; }");
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: 简化 `buildSkinExpression`（去掉 themeColors 参数）**

找到 `buildSkinExpression` 函数，改回单步签名（不再需要 themeColors）：

```js
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
```

- [ ] **Step 5: 改 `renderSkinChromeCss` 让 sparkle 辉光用 `var(--color-brand)`**

找到 `renderSkinChromeCss` 函数（约 line 196）。改 line 197（`accentAlt` 来源）+ box-shadow 那行：

```js
function renderSkinChromeCss(theme) {
  // sparkle glow: follow ZCode theme accent (spec §4.4). Use CSS var() with
  // hex fallback — if ZCode renames --color-brand, falls back to purple.
  var accentColor = "var(" + sel.FROST_BASE_VARS.accent + ", #b45cff)";
  var d = theme.decorations || {};
  // ... 函数其余部分保持不变 ...
```

把原 `box-shadow: 0 0 8px 2px " + accentAlt + ";` 改为：
```js
"  box-shadow: 0 0 8px 2px " + accentColor + ";",
```

- [ ] **Step 6: 简化 `applySkin`（单步注入，不读备份变量）**

找到 `applySkin` 函数，去掉"先读备份变量再注入"的逻辑，回到单步 evaluate：

```js
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
```

- [ ] **Step 7: 更新 `module.exports`**

确认 `module.exports` 里有：`renderSkinCss`、`renderSkinChrome`、`renderSkinChromeCss`、`buildSkinExpression`、`buildSkinRemoveExpression`、`buildSkinVerifyExpression`、`applySkin`、`removeSkin`。**不要**导出 `readBackupVarsExpression`/`parseBackupVarsResult`（这些已废弃）。

- [ ] **Step 8: 跑 skininjecttest 确认新断言通过**

Run: `node test/skininjecttest.cjs`
Expected: 所有新断言 PASS，`fail: 0`。

- [ ] **Step 9: Commit**

```bash
git add lib/skin-inject.cjs test/skininjecttest.cjs
git commit -m "feat(skin): renderSkinCss 改 color-mix 磨砂玻璃（v2 spike 后方案）

- renderSkinCss 单步签名 (theme)，输出 color-mix + backdrop-filter:blur
- color-mix(in srgb, var(--color-neutral-900) N%, transparent) 让 CSS 引擎
  实时解析原生底层变量，底色真跟随主题
- buildSkinExpression 回到单步注入（不需读备份变量，方案简化）
- renderSkinChromeCss sparkle 辉光用 var(--color-brand, #b45cff)
- 废弃 readBackupVarsExpression/parseBackupVarsResult（旧方案残留）
- skininjecttest 新增 color-mix/blur/无 rgba 断言"
```

---

## ~~Task 6: wallpaper.css 改动~~（v2 废弃，新方案不动 wallpaper.css）

跳过。spec §6 已记录：新方案完全不碰 wallpaper.css。这是 color-mix 方案的最大优势之一。

---

## Task 6（新）: 前端 UI 重构（`control/lib/skin-view.js`）

**Files:**
- Modify: `control/lib/skin-view.js`

**Interfaces:** 无

（内容同原 plan 的 Task 7，步骤不变：重写 renderOverlaySection、删主色面板、改 collectEditor、改 live-preview、人工跑控制中心验证）

- [ ] **Step 1: 重写 `renderOverlaySection`**

打开 `control/lib/skin-view.js`，找到 `renderOverlaySection` 函数（line 188-213），整段替换：

```js
// Render the frosted-glass overlay section (spec §5.2): enable toggle +
// per-region (面板/输入框/侧栏) opacity + blur sliders. NO color pickers —
// 底色 follows ZCode theme via color-mix + native vars.
function renderOverlaySection(theme) {
  var ov = theme.overlay || {};
  function rangeRow(kind, region, label, max) {
    var key = region + (kind === "op" ? "Opacity" : "Blur");
    var def = skin.OVERLAY_DEFAULTS[key];
    var v = (ov[key] != null) ? ov[key] : def;
    var unit = kind === "op" ? "%" : "px";
    var dataAttr = kind === "op" ? "data-ov-op" : "data-ov-blur";
    var valAttr = kind === "op" ? "data-ov-op-val" : "data-ov-blur-val";
    return '<label class="skin-row skin-opacity-row">' + label + " " + (kind === "op" ? "透明度" : "模糊度") + " " +
      '<input type="range" ' + dataAttr + '="' + key + '" min="0" max="' + max + '" value="' + v + '">' +
      "<span " + valAttr + '="' + key + '">' + v + unit + "</span></label>";
  }
  function regionBlock(region, label) {
    return '<div class="skin-region">' +
      rangeRow("op", region, label, 100) +
      rangeRow("blur", region, label, 30) +
      "</div>";
  }
  return '<details class="skin-overlay-section"' + (ov.enabled ? " open" : "") + ">" +
    '<summary>磨砂玻璃（面板半透明+模糊，让壁纸透出）' + (ov.enabled ? " ✅已启用" : "") + "</summary>" +
    '<label class="skin-checkbox"><input type="checkbox" data-ov-field="enabled"' + (ov.enabled ? " checked" : "") + "> 启用磨砂玻璃</label>" +
    regionBlock("panel", "面板") +
    regionBlock("input", "输入框") +
    regionBlock("sidebar", "侧栏") +
    '<div class="muted" style="font-size:11px">启用后，面板/输入框/侧栏呈半透明磨砂玻璃，壁纸从后面透出且被模糊。底色自动跟随 ZCode 主题色。</div>' +
    "</details>";
}
```

- [ ] **Step 2: 删主色面板（COLOR_KEYS 渲染段）**

找到 `renderEditor` 函数（line 109-160），删除 line 121-127（`var c = editing.colors` + `colorRow` 内部函数）和 line 137-145（「颜色 (9)」`<details>` 块）。保留 line 132-136 的「基本信息」`<details>` 和 line 146-154 的装饰层 `<details>`。

新 `renderEditor` 的 html 拼接顺序（spec §5.3）：
1. legend（含 name badge）
2. 基本信息 details（name/font/radius）
3. 角标与闪光 details（sparkle/emoji）
4. overlay section（renderOverlaySection 返回）
5. 保存按钮

- [ ] **Step 3: 改 `collectEditor`**

找到 `collectEditor` 函数（line 234-291）。删除 line 265-271（COLOR_KEYS 收集循环）。改 overlay 收集段：

```js
// overlay: collect enable + 3 opacities + 3 blurs (no colors — frosted glass)
var ovEnabled = !!(ed.querySelector('[data-ov-field="enabled"]') || {}).checked;
function ovNum(selectorKey, attr, defKey) {
  var el = ed.querySelector("[" + attr + '="' + selectorKey + '"]');
  if (!el) return skin.OVERLAY_DEFAULTS[defKey];
  var n = Number(el.value);
  return isFinite(n) ? n : skin.OVERLAY_DEFAULTS[defKey];
}
editing.overlay = {
  enabled: ovEnabled,
  panelOpacity: ovNum("panelOpacity", "data-ov-op", "panelOpacity"),
  panelBlur: ovNum("panelBlur", "data-ov-blur", "panelBlur"),
  inputOpacity: ovNum("inputOpacity", "data-ov-op", "inputOpacity"),
  inputBlur: ovNum("inputBlur", "data-ov-blur", "inputBlur"),
  sidebarOpacity: ovNum("sidebarOpacity", "data-ov-op", "sidebarOpacity"),
  sidebarBlur: ovNum("sidebarBlur", "data-ov-blur", "sidebarBlur")
};
return editing;
```

- [ ] **Step 4: 删主色面板事件处理（color text↔picker 同步）**

找到 line 297-332 的 `panel.addEventListener("change", ...)` 块。删除 line 300-320（`data-ck`/`data-ck-text`/`data-ov-ck`/`data-ov-ck-text` 的同步逻辑——这些字段都不存在了）。保留 `data-ov-op` label 更新（line 322-326），**加 `data-ov-blur` label 更新**：

```js
// overlay blur slider: live-update the value label (px)
var ovbl = t.getAttribute && t.getAttribute("data-ov-blur");
if (ovbl) {
  var blbl = panel.querySelector('[data-ov-blur-val="' + ovbl + '"]');
  if (blbl) blbl.textContent = t.value + "px";
}
```

- [ ] **Step 5: 改 live-preview 触发条件**

找到 line 452-459 的 `panel.addEventListener("input", ...)` 块。改 line 455-456 的 `interesting` 判断——删 `data-ck`，加 `data-ov-blur`：

```js
var interesting = t.getAttribute("data-ov-op") || t.getAttribute("data-ov-blur") ||
  t.getAttribute("data-field");
```

- [ ] **Step 6: 人工跑控制中心验证 UI 渲染**

Run: `npm run control`
Expected: server 起在 17890。在 ZCode 浏览器面板开 `http://127.0.0.1:17890/control/`，皮肤 Tab 应显示：
- 「主题选择」下拉（只「默认主题 [预设]」一项）
- 「基本信息」（名称/字体/圆角）
- 「磨砂玻璃」section（启用 checkbox + 面板/输入框/侧栏各两个滑块）
- 「装饰层」section（sparkle + emoji）
- **不应有**任何颜色选择器

人眼验：拖滑块、勾选框、切换主题都不报 JS 错。

- [ ] **Step 7: Commit**

```bash
git add control/lib/skin-view.js
git commit -m "refactor(skin): 删主色面板 + overlay 改透明度+模糊度双滑块

- 删 COLOR_KEYS 渲染 + 颜色选择器 + colors 收集
- renderOverlaySection: 每区域 2 滑块（透明度 0-100、模糊度 0-30），无颜色
- collectEditor: 收集 overlay.*Opacity + overlay.*Blur（删 *Bg）
- 标题改名「壁纸叠加」→「磨砂玻璃」
- live-preview 触发条件加 data-ov-blur"
```

---

## Task 7（新）: 回归 + 真机验证清单

**Files:** 无（验证性 task）

- [ ] **Step 1: 跑全量测试**

Run: `npm test`
Expected: 所有 28+ 个 test 文件全绿，含 skintest + skininjecttest。若任一 FAIL，定位修复后重跑。

- [ ] **Step 2: 真机验证清单（spec §8.3）—— 逐项人眼验**

需要：ZCode 已带壁纸运行（`wallpaper.bat` 场景 2）+ 控制中心已起（`npm run control`）。

逐项验：
1. **~~备份变量机制~~**（已废弃，spike 已验完）
2. **overlay 启用**：控制中心启用磨砂玻璃 → 面板/输入框/侧栏呈半透明，壁纸透出且被模糊
3. **overlay 关闭**：取消勾选 → 完全透明（壁纸满强度），与改前行为一致
4. **拖滑块实时生效**：透明度 0→100、模糊度 0→30 视觉连续
5. **切 ZCode 主题**（**关键**）：深色↔浅色主题切换 → 磨砂层底色自动跟随（这是 color-mix 方案的核心卖点）
6. **sparkle 辉光跟主题**：启用 sparkle → 辉光颜色跟随 ZCode accent（不再固定紫色）
7. **装饰层正常**：sparkle 闪烁、emoji 角标 8 个位置可放
8. **视频壁纸叠加**：先注视频壁纸（场景 7）→ 启用磨砂玻璃 → 磨砂层正常透出视频
9. **新用户首次打开**：localStorage 清空后重开 → 只看到磨砂玻璃（overlay 默认开 70/12、装饰层默认关）
10. **旧 localStorage 兼容**：手动塞一份带 colors 的旧数据 → 读取不报错、字段自动归一化

- [ ] **Step 3: 验侧栏硬画背景遗留仍在（不恶化）**

切到 ZCode 侧边栏，确认那块「框架硬画的实色深色背景」仍然在（spec §4.6 已知遗留）——磨砂玻璃**没有**让它变透明。这是预期，不是 bug。

- [ ] **Step 4: Commit 验证记录**

```bash
git commit --allow-empty -m "test(skin): 真机验证清单 10/10 通过

1-10 项人眼验：磨砂玻璃生效、跟随主题、装饰层正常、
视频壁纸兼容、旧 localStorage 归一化。
侧栏硬画背景遗留仍在（spec §4.6 已知，不恶化）。"
```

---

## Self-Review Notes（v2）

**Spec coverage check**：
- §3.2-3.5 备份机制 → 已废弃（spike 失败），color-mix 替代 → Task 4+5
- §4 renderSkinCss color-mix → Task 5
- §5 前端 UI → Task 6（新编号）
- §6 wallpaper.css → 不动（Task 6 旧编号废弃）
- §8 真机验证 → Task 7（新编号）

**v2 简化点**：
- Task 5 不再有 `readBackupVarsExpression`/`parseBackupVarsResult`/`FALLBACK_THEME_COLORS` 胶水
- buildSkinExpression 回到单步签名（不传 themeColors）
- applySkin 不再两步 evaluate（单步注入）
- wallpaper.css 不改（少一个文件、少一个漂移点）

**Type/name consistency**：
- `FROST_BASE_VARS`（Task 4）→ Task 5 `renderSkinCss` 用 ✓
- `OVERLAY_REGION_SELECTORS`（Task 4）→ Task 5 `renderSkinCss` 用 ✓
- `OVERLAY_DEFAULTS`（Task 2）→ Task 6 `renderOverlaySection`/`collectEditor` 用 ✓
- `BLUR_RANGE.max = 30`（Task 2）→ Task 6 滑块 `max="30"` ✓
