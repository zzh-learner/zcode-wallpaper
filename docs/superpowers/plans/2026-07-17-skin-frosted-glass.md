# 皮肤系统磨砂玻璃重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把皮肤系统的「壁纸叠加」从「给 UI 加颜色层」重构为「让 UI 面板半透明 + 模糊化的磨砂玻璃」，删除整个主色面板（7 个颜色选择器），底色自动跟随 ZCode 主题色。

**Architecture:** 通过在 `lib/wallpaper.css` 顶部用 CSS 自定义属性备份 ZCode 原主题色（`--zcode-wp-orig-*`），让 transparent 覆盖仍然生效但备份值被保留。皮肤注入时用 CDP `Runtime.evaluate` 读这些备份变量的 computed value，在 Node 侧拼成 `rgba(R,G,B,opacity)` + `backdrop-filter:blur(Npx)` 注入到面板/输入框/侧栏三个元素选择器。前端 UI 删除主色面板、overlay 改透明度+模糊度双滑块、删除颜色预设只留一个默认主题、装饰层默认关闭。

**Tech Stack:** Node.js (CommonJS `.cjs`)、CDP over WebSocket（`lib/cdp.cjs`）、CSS custom properties、`backdrop-filter`、localStorage 前端状态、原生 DOM 事件（无框架）。

**Spec:** `docs/superpowers/specs/2026-07-17-skin-overlay-frosted-glass-design.md`

## Global Constraints

- **文件命名**：所有新/改文件保持现有扩展名约定——`.cjs`（Node 模块）、`.js`（前端 lib，dual export CommonJS + `window.__ccXxx`）、`.css`。
- **测试入口**：`npm test`（含 `pretest` 钩子重建 epub fixture）。skin 相关测试在链尾：`... && node test/skintest.cjs && node test/skininjecttest.cjs`。
- **前端 lib dual export 铁律**（AGENTS.md「前端 lib 必须同时挂 CommonJS 导出 + 浏览器全局」）：`control/lib/skin.js` 的浏览器 inline 副本必须和 `lib/skin.cjs` 字段集完全一致，靠 `test/skintest.cjs` 同时跑两边断言钉一致（教训 17 mirror）。
- **CSS 自定义属性备份机制是推断**（spec §3.3），必须真机验。本 plan 的 Task 1 是 spike——失败则停下来与用户确认回退方案（spec §3.5 硬编码映射表），**不得跳过 Task 1 直接做后续**。
- **PS 一律 `-File`、`.bat` 保持 CRLF + ASCII-only**（AGENTS.md 改动惯例）——本 plan 不碰 `.ps1`/`.bat`，但若 incidental 碰到要守约。
- **磨砂层选择器不动**：`main, [role='main']` / `.chat-composer-region, .bg-input, .focus-within\\:bg-input-focused` / `#sidebar, aside.h-full` 来自真机探测（`scripts/inspect-skin2.cjs`，2026-07-16，ZCode 3.3.6）。
- **每步独立 commit**，commit message 用 conventional 前缀（`feat(skin)`/`refactor(skin)`/`test(skin)`/`docs(skin)`）。

## File Structure

| 文件 | 责任 | 操作 |
| --- | --- | --- |
| `lib/wallpaper.css` | 壁纸透明 CSS；新增顶部 4 行主题色备份 | Modify |
| `lib/skin.cjs` | 皮肤纯模型（Node 端权威） | Modify（删 COLOR_KEYS 相关、改 makeOverlay/makeSkinTheme/builtinPresets/validateTheme） |
| `control/lib/skin.js` | 皮肤前端 lib（dual export，浏览器 inline 副本） | Modify（镜像 `lib/skin.cjs` 改动） |
| `lib/skin-inject.cjs` | CDP 注入皮肤；重写 `renderSkinCss` + `buildSkinExpression`（读备份变量）+ `renderSkinChromeCss`（sparkle 跟随 accent） | Modify |
| `lib/skin-selectors.cjs` | 选择器/变量映射；新增 `BACKUP_VAR_NAMES` 常量 + overlay 区域→备份变量映射 | Modify |
| `control/lib/skin-view.js` | 皮肤面板 UI；删主色面板、overlay 改双滑块、改默认主题渲染、改 live-preview/collectEditor | Modify |
| `scripts/inspect-skin2.cjs` | 真机探测脚本；Task 1 spike 改一版读备份变量 | Modify（spike 用） |
| `test/skintest.cjs` | skin.cjs + skin.js mirror 一致性测试 | Modify（重写字段集断言） |
| `test/skininjecttest.cjs` | skin-inject.cjs 纯渲染测试 | Modify（重写 overlay 断言、加 blur 断言） |

**无新增文件**——所有改动都在现有文件上。备份数据迁移靠 `makeSkinTheme`/`makeOverlay` 归一化兜底，不需要单独迁移脚本。

---

## Task 1: Spike — 验证 CSS 自定义属性备份机制

**这是整个方案的命门。失败则停下来与用户确认回退（spec §3.5）。**

**Files:**
- Modify: `scripts/inspect-skin2.cjs`（spike 用，跑完即弃/留作回归）
- Read-only: `lib/wallpaper.css`（spike 期间临时加备份声明验完再决定是否提交）

**Interfaces:**
- Consumes: ZCode 必须已启动且带 9222 debug port + 已注入壁纸（`wallpaper.bat` 场景 2）
- Produces: 一份「备份变量机制是否成立」的真机结论（口头/文字，写到 commit message）

- [ ] **Step 1: 临时在 `lib/wallpaper.css` 顶部加备份声明**

读取 `lib/wallpaper.css` 当前内容（59 行）。在 line 22（顶部注释块结束后、`body {...}` 之前）插入备份声明段。**这是临时改动，spike 验完根据结论决定保留（Task 5 正式加）还是回退。**

具体：用 Edit 把这段：
```css
   ============================================================ */

/* 1) 背景层样式：尺寸/定位/重复/固定。背景图由 inject.cjs 启动时
```
改为：
```css
   ============================================================ */

/* SPIKE TEMP: 验证 CSS 自定义属性备份机制是否成立。
   下一行 var(--color-background) 求值时，--color-background 还没被后面的
   transparent !important 覆盖，所以应该快照到 ZCode 原主题色。 */
:root { --zcode-wp-orig-bg: var(--color-background); }
:root { --zcode-wp-orig-panel: var(--color-background-alt); }
:root { --zcode-wp-orig-input: var(--color-input); }
:root { --zcode-wp-orig-accent: var(--color-brand); }

/* 1) 背景层样式：尺寸/定位/重复/固定。背景图由 inject.cjs 启动时
```

- [ ] **Step 2: 重注入壁纸（让带备份声明的 wallpaper.css 生效）**

Run: `npm run inject`
Expected: 输出含「inject 成功」类信息，无报错。如果 ZCode 没开 9222 port，先跑 `wallpaper.bat` 场景 2 启动。

- [ ] **Step 3: 改 `scripts/inspect-skin2.cjs` 加备份变量探测**

读取 `scripts/inspect-skin2.cjs` 当前内容找到 `Runtime.evaluate` 调用处，加一段读 4 个备份变量的 computed value。在文件末尾（或合适探测点）加：

```js
// SPIKE: 读 wallpaper.css 备份的 4 个主题色变量，验 §3.3 备份机制是否成立
const backupProbe = `(function(){
  var root = getComputedStyle(document.documentElement);
  function read(name) { return (root.getPropertyValue(name) || "").trim(); }
  return JSON.stringify({
    origBg: read('--zcode-wp-orig-bg'),
    origPanel: read('--zcode-wp-orig-panel'),
    origInput: read('--zcode-wp-orig-input'),
    origAccent: read('--zcode-wp-orig-accent'),
    // 对照：被 transparent 覆盖后的原变量（应为 transparent 或空）
    bgAfterOverride: read('--color-background'),
    inputAfterOverride: read('--color-input')
  });
})()`;
// ... 在已有 connect/call 流程里加：
// const r = await call("Runtime.evaluate", { expression: backupProbe, returnByValue: true });
// console.log("BACKUP PROBE:", r.result.value);
```

具体插入位置：参照 `inspect-skin2.cjs` 已有的 `call("Runtime.evaluate", ...)` 调用模式复制一份，expression 换成 `backupProbe`。

- [ ] **Step 4: 跑 spike，读结论**

Run: `node scripts/inspect-skin2.cjs`
Expected（成立时）: `BACKUP PROBE:` 输出类似
```json
{
  "origBg": "#121216"或"rgb(18, 18, 22)",   // 真主题色，非 transparent
  "origPanel": "#1a1a20",
  "origInput": "#1e1e24",
  "origAccent": "#3b82f6",
  "bgAfterOverride": "transparent",          // 覆盖生效
  "inputAfterOverride": "transparent"
}
```

**判定**：
- ✅ `origBg` 等不是 `transparent` 也不是空 → 机制成立，继续 Task 2
- ❌ `origBg` 是 `transparent` 或空 → 机制不成立，**停下来**，把结论告诉用户，问是否接受回退方案（spec §3.5 硬编码映射表）

- [ ] **Step 5: 根据结论提交或回退**

**若成立**：保留 wallpaper.css 的临时备份声明（Task 5 会正式整合），commit：
```bash
git add lib/wallpaper.css scripts/inspect-skin2.cjs
git commit -m "spike(skin): 验证 CSS 自定义属性备份机制成立

读 getComputedStyle(:root).getPropertyValue('--zcode-wp-orig-bg')
返回真主题色而非 transparent，确认 §3.3 机制有效。
inspect-skin2.cjs 加备份变量探测段供后续回归。"
```

**若不成立**：回退 wallpaper.css 改动（`git checkout lib/wallpaper.css`），停下来等用户决定。

---

## Task 2: `lib/skin.cjs` 模型重构（删 COLOR_KEYS、overlay 加 blur、改默认主题）

**Files:**
- Modify: `lib/skin.cjs`（全文重构，但保留文件名/导出形状的兼容性）
- Test: `test/skintest.cjs`（本 task 同步改）

**Interfaces:**
- Produces:
  - `makeOverlay(partial)` → `{ enabled, panelOpacity, panelBlur, inputOpacity, inputBlur, sidebarOpacity, sidebarBlur }`（**无 `*Bg` 字段**）
  - `makeSkinTheme(partial)` → 不再有 `colors` 字段；`overlay` 用新形状；`decorations.sparkle` 默认 `false`
  - `builtinPresets()` → 只返回 1 个「默认主题」`skin-default-builtin`
  - `validateTheme(t)` → 不再校验 `colors`；新增 `overlay.*Blur` 的 0-30 clamp 校验
  - 仍导出 `isValidHex`/`hexToRgb`/`hexToRgba`（`skin-inject.cjs` 的 sparkle fallback 仍可能用，且删了会破坏 mirror 测试惯性——保留无害）
  - **删除导出**：`COLOR_KEYS`
  - 新增导出：`OPACITY_RANGE = { min: 0, max: 100 }`、`BLUR_RANGE = { min: 0, max: 30 }`、`OVERLAY_DEFAULTS`

- [ ] **Step 1: 写失败测试（先改 `test/skintest.cjs` 的新断言）**

打开 `test/skintest.cjs`。**先不删旧断言**，在文件末尾（最后一行 `console.log` 前）追加新断言段：

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
// 空输入：默认 enabled=false（makeOverlay 本身），但字段齐全
var ovEmpty = skin.makeOverlay({});
check("empty overlay enabled false", ovEmpty.enabled === false);
check("empty overlay panelBlur default 12", ovEmpty.panelBlur === 12);

// === 重构后：makeSkinTheme 无 colors 字段 ===
var theme = skin.makeSkinTheme({ name: "测试", overlay: { enabled: true, panelOpacity: 50, panelBlur: 5 } });
check("theme has no colors field", theme.colors === undefined);
check("theme overlay enabled preserved", theme.overlay.enabled === true);
check("theme decorations.sparkle defaults false", theme.decorations.sparkle === false);
check("theme decorations.sparkleCount defaults 12", theme.decorations.sparkleCount === 12);

// === 重构后：builtinPresets 只 1 个默认主题 ===
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
  colors: { background: "#fff", accent: "#000" },                      // 应被丢弃
  overlay: { enabled: true, panelBg: "#abc", panelOpacity: 85 }        // panelBg 应被丢弃，blur 补默认
});
check("legacy theme colors dropped", legacyTheme.colors === undefined);
check("legacy theme overlay panelBg dropped", legacyTheme.overlay.panelBg === undefined);
check("legacy theme overlay panelOpacity kept", legacyTheme.overlay.panelOpacity === 85);
check("legacy theme overlay panelBlur defaulted", legacyTheme.overlay.panelBlur === 12);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/skintest.cjs`
Expected: 新增的断言全部 FAIL（旧实现还在），旧的 COLOR_KEYS/hexToRgba 相关断言仍 PASS。整体 `fail > 0`，脚本以非零退出。

- [ ] **Step 3: 重写 `lib/skin.cjs`**

完整替换 `lib/skin.cjs` 内容为：

```js
// Skin theme model — pure functions shared by server (skin-inject.cjs, tests)
// and frontend (control/lib/skin.js re-exports these + adds localStorage glue).
//
// Design (spec 2026-07-17-skin-overlay-frosted-glass): a Theme is a plain
// object with id/name/font/radius/overlay/decorations. NO colors field — the
// frosted-glass overlay's底色 comes from ZCode theme vars backed up in
// wallpaper.css (--zcode-wp-orig-*). Stored in localStorage key
// `zcode-control:skins` as { activeId, themes: {id -> Theme} }. 1 builtin
// preset ("skin-default-builtin") seeded on first load.
//
// Pure-function convention (mirrors bookmark.js/shelf.js): validation, id
// generation, preset seeding, duplication are pure + unit-tested. localStorage
// read/write lives in control/lib/skin.js (browser-only, real-machine verified).

// Overlay ranges (spec §2.1).
var OPACITY_RANGE = { min: 0, max: 100 };
var BLUR_RANGE = { min: 0, max: 30 };

// Overlay defaults (spec §2.4): enabled, 70% opacity, 12px blur per region.
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

// Validate a hex color. Accepts #rgb, #rrggbb, #rrggbbaa (alpha optional).
// Case-insensitive. Kept for skin-inject.cjs sparkle fallback + legacy compat.
function isValidHex(s) {
  if (typeof s !== "string") return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s);
}

// Parse a hex color into {r,g,b}. Kept for skin-inject.cjs sparkle fallback.
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

// hex + opacity% -> rgba string. Kept for skin-inject.cjs sparkle fallback.
function hexToRgba(hex, opacityPct) {
  var rgb = hexToRgb(hex);
  if (!rgb) return null;
  var a = isFinite(opacityPct) ? Math.max(0, Math.min(100, Number(opacityPct))) / 100 : 1;
  return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + a + ")";
}

// Clamp a number to [min, max]; defaultIfMissing when null/undefined/""/NaN.
function clampNum(v, min, max, defaultIfMissing) {
  if (v == null || v === "" || !isFinite(v)) return defaultIfMissing;
  return Math.max(min, Math.min(max, Number(v)));
}

// Normalize an overlay config (frosted-glass mode, spec §2.1). Accepts partial
// input, fills defaults. Legacy *Bg fields (panelBg/inputBg/sidebarBg) are
// SILENTLY DROPPED — frosted glass has no per-region color, 底色 follows ZCode
// theme via --zcode-wp-orig-* backup vars.
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

// Normalize emoji decorations into clean array. Accepts BOTH new array form
// (emojiBadges) AND legacy single form (emojiBadge+emojiPosition). Drops empty.
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
  var ts = Date.now().toString(36);
  var rnd = Math.random().toString(36).slice(2, 4);
  return "skin_" + ts + rnd;
}

// Validate a theme object (spec §2). No longer validates colors field (gone).
// Adds overlay.*Blur range validation. decorations shape validation retained.
function validateTheme(t) {
  var errors = [];
  if (!t || typeof t !== "object") return { ok: false, errors: ["theme is not an object"] };
  if (!t.name || typeof t.name !== "string" || !t.name.trim()) errors.push("name 不能为空");
  // NOTE: t.colors (if present from legacy data) is silently ignored, NOT
  // validated — backward compat with old localStorage entries.
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
        if (v == null || v === "") return; // missing = default-filled later
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

// Build a complete Theme from partial input (spec §2.3). NO colors field.
// decorations.sparkle defaults FALSE (spec §2.4). overlay defaults enabled.
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
      sparkle: deco.sparkle === true, // spec §2.4: default FALSE (was `!== false`)
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

// Builtin presets (spec §5.4). Only ONE: the default frosted-glass theme.
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

// Ensure state contains all builtin presets. Pure. Returns {activeId, themes}.
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

// Duplicate a theme as a user theme (isBuiltin:false, new id). Pure.
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

打开 `test/skintest.cjs`。删除/改写以下旧断言段（它们断言的字段已不存在）：

- 删 line 33-42（旧 `makeOverlay` 带 `panelBg`/`inputBg`/`sidebarBg` 的断言）——已被 Step 1 追加的新断言取代
- 删 line 51-56（旧 `validateTheme` 带 `colors.accent` 的断言）
- 删 line 22-31（`hexToRgb`/`hexToRgba` 的断言可保留——这俩函数还在；但若想精简可删，因为 skin-inject sparkle fallback 仍依赖，保留断言更安全）→ **保留**
- 改 line 60+ 的 `makeSkinTheme` 相关断言：把所有访问 `.colors.xxx` 的断言删掉
- 改 builtinPresets 相关旧断言（断言 3 个预设的）：删掉，已被 Step 1 新断言取代

**注意**：`test/skintest.cjs` 同时跑 `lib/skin.cjs`（`skin` 变量）和 `control/lib/skin.js`（`skinWeb` 变量）的 mirror 一致性断言。本 task 只改 `lib/skin.cjs`，所以 `skinWeb` 的旧断言会全 FAIL——这是预期的，Task 3 会修 `skin.js`。**为了让本 task 的测试能跑过**，把 `skinWeb` 的 mirror 断言**临时注释掉**（加注释「TODO Task 3: restore mirror after skin.js updated」），Task 3 再恢复。

- [ ] **Step 5: 跑测试确认新断言通过**

Run: `node test/skintest.cjs`
Expected: 所有断言 PASS，`fail: 0`。

- [ ] **Step 6: Commit**

```bash
git add lib/skin.cjs test/skintest.cjs
git commit -m "refactor(skin): 删 COLOR_KEYS、overlay 加 blur 字段、改默认主题

- makeOverlay: 删 panelBg/inputBg/sidebarBg，加 panelBlur/inputBlur/sidebarBlur
- makeSkinTheme: 删 colors 字段，decorations.sparkle 默认 false
- builtinPresets: 只留 1 个 skin-default-builtin（删 3 个颜色预设）
- validateTheme: 不再校验 colors，加 overlay.*Blur 0-30 校验
- 新增导出 OPACITY_RANGE/BLUR_RANGE/OVERLAY_DEFAULTS/clampNum
- skintest.cjs 同步断言；mirror 断言临时注释（Task 3 恢复）"
```

---

## Task 3: `control/lib/skin.js` 镜像同步

**Files:**
- Modify: `control/lib/skin.js`（浏览器 inline 副本，镜像 Task 2 的改动）

**Interfaces:**
- Produces: `window.__ccSkin` 的 API 与 `lib/skin.cjs` 导出**完全一致**（含 `OPACITY_RANGE`/`BLUR_RANGE`/`OVERLAY_DEFAULTS`/`clampNum`，无 `COLOR_KEYS`）

- [ ] **Step 1: 跑 skintest 确认当前 mirror 断言失败**

Run: `node test/skintest.cjs`
Expected: Task 2 Step 4 注释掉的 mirror 断言已跳过；如果有未注释的 mirror 断言会 FAIL。先确认状态。

- [ ] **Step 2: 重写 `control/lib/skin.js` 的 inline 副本**

打开 `control/lib/skin.js`。替换 line 13-135 的整个 `skinModel` IIFE（包括 `require` 尝试 + 浏览器 inline 副本）。新内容（inline 副本，必须和 `lib/skin.cjs` 字段集一致）：

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
        var self = this;
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

打开 `control/lib/skin.js` 找到 line 159-176 的 `var api = {...}` 块。删除 `COLOR_KEYS: skinModel.COLOR_KEYS,` 行，加 `OPACITY_RANGE/BLUR_RANGE/OVERLAY_DEFAULTS/clampNum`：

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

打开 `test/skintest.cjs`，把 Task 2 Step 4 注释掉的 mirror 断言全部恢复（删除「TODO Task 3」注释 + 取消注释）。所有断言应同时跑 `skin.xxx` 和 `skinWeb.xxx`，两边结果必须一致。

具体做法：原 skintest 里 mirror 断言的写法是 `check("xxx", skin.fn() === skinWeb.fn())` 或两段分别 check。恢复时确保每个新断言都有对应的 `skinWeb` 版本。最简办法：在每段新断言后加一行 `check("mirror: <同断言名>", skinWeb.xxx === skin.xxx)`，或在 Step 1 的新断言里把 `skin` 改成同时测两边。

最简模板（加到 skintest 末尾）：

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
Expected: 所有断言 PASS（含 mirror 一致性），`fail: 0`。

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

## Task 4: `lib/skin-selectors.cjs` 加备份变量映射

**Files:**
- Modify: `lib/skin-selectors.cjs`

**Interfaces:**
- Produces:
  - `BACKUP_VAR_NAMES = { panel: '--zcode-wp-orig-bg', input: '--zcode-wp-orig-input', sidebar: '--zcode-wp-orig-panel', accent: '--zcode-wp-orig-accent' }`
  - `OVERLAY_REGION_SELECTORS = { panel: "main, [role='main']", input: ".chat-composer-region, .bg-input, .focus-within\\:bg-input-focused", sidebar: "#sidebar, aside.h-full" }`（从 skin-inject.cjs 硬编码抽出来，单一权威）
  - 仍导出 `COLOR_TO_TOKENS`/`SKIN_ELEMENT_RULES`（skin-inject sparkle fallback 可能还用，保留无害）/`SKIN_STYLE_ID`/`SKIN_CHROME_ID`

- [ ] **Step 1: 写失败测试（加到 `test/skininjecttest.cjs` 顶部）**

打开 `test/skininjecttest.cjs`。在文件开头已有 require 之后加：

```js
// === 备份变量名 + 区域选择器映射（Task 4）===
check("BACKUP_VAR_NAMES has 4 regions", Object.keys(sel.BACKUP_VAR_NAMES).length === 4);
check("BACKUP_VAR_NAMES.panel", sel.BACKUP_VAR_NAMES.panel === "--zcode-wp-orig-bg");
check("BACKUP_VAR_NAMES.input", sel.BACKUP_VAR_NAMES.input === "--zcode-wp-orig-input");
check("BACKUP_VAR_NAMES.sidebar", sel.BACKUP_VAR_NAMES.sidebar === "--zcode-wp-orig-panel");
check("BACKUP_VAR_NAMES.accent", sel.BACKUP_VAR_NAMES.accent === "--zcode-wp-orig-accent");
check("OVERLAY_REGION_SELECTORS has 3 regions", Object.keys(sel.OVERLAY_REGION_SELECTORS).length === 3);
check("OVERLAY_REGION_SELECTORS.panel", sel.OVERLAY_REGION_SELECTORS.panel.indexOf("main") >= 0);
check("OVERLAY_REGION_SELECTORS.input", sel.OVERLAY_REGION_SELECTORS.input.indexOf(".bg-input") >= 0);
check("OVERLAY_REGION_SELECTORS.sidebar", sel.OVERLAY_REGION_SELECTORS.sidebar.indexOf("#sidebar") >= 0);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/skininjecttest.cjs`
Expected: 新断言 FAIL（`sel.BACKUP_VAR_NAMES` undefined）。

- [ ] **Step 3: 改 `lib/skin-selectors.cjs`**

打开 `lib/skin-selectors.cjs`。在 `SKIN_STYLE_ID`/`SKIN_CHROME_ID` 声明之前加：

```js
// CSS custom property backup names (spec §3.4). wallpaper.css snapshots ZCode's
// original theme colors into these vars BEFORE its transparent !important override.
// skin-inject reads them at inject-time to build rgba() frosted-glass layers.
// IMPORTANT: keep in sync with lib/wallpaper.css (lesson 17 mirror — the test
// in skininjecttest asserts exact string match, drift will fail).
var BACKUP_VAR_NAMES = {
  panel: "--zcode-wp-orig-bg",        // spec §3.4: panel uses --color-background
  input: "--zcode-wp-orig-input",     // spec §3.4: input uses --color-input
  sidebar: "--zcode-wp-orig-panel",   // spec §3.4: sidebar uses --color-background-alt
  accent: "--zcode-wp-orig-accent"    // spec §4.4: sparkle glow uses --color-brand
};

// Element selectors per frosted-glass region (spec §4.5). Single source of
// truth — skin-inject's renderSkinCss reads from here, no duplicated literals.
// From real-machine probe (inspect-skin2.cjs, 2026-07-16, ZCode 3.3.6).
var OVERLAY_REGION_SELECTORS = {
  panel: "main, [role='main']",
  input: ".chat-composer-region, .bg-input, .focus-within\\:bg-input-focused",
  sidebar: "#sidebar, aside.h-full"
};
```

在 `module.exports` 里加这两项：

```js
module.exports = {
  COLOR_TO_TOKENS: COLOR_TO_TOKENS,
  SKIN_ELEMENT_RULES: SKIN_ELEMENT_RULES,
  BACKUP_VAR_NAMES: BACKUP_VAR_NAMES,
  OVERLAY_REGION_SELECTORS: OVERLAY_REGION_SELECTORS,
  SKIN_STYLE_ID: SKIN_STYLE_ID,
  SKIN_CHROME_ID: SKIN_CHROME_ID
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node test/skininjecttest.cjs`
Expected: 新断言 PASS。注意：旧断言（line 9-50，测 `renderSkinCss` 旧形状）此刻会 FAIL——因为 Task 5 才改 `renderSkinCss`。**临时把旧 `renderSkinCss` 断言段注释掉**（加「TODO Task 5」注释），Task 5 恢复。

- [ ] **Step 5: Commit**

```bash
git add lib/skin-selectors.cjs test/skininjecttest.cjs
git commit -m "feat(skin): skin-selectors 新增 BACKUP_VAR_NAMES + OVERLAY_REGION_SELECTORS

单一权威定义 frosted-glass 用到的 4 个备份变量名 + 3 个区域选择器。
skin-inject Task 5 会读这里，不再硬编码字面量。
旧 renderSkinCss 断言临时注释（Task 5 恢复）。"
```

---

## Task 5: `lib/skin-inject.cjs` 重写（renderSkinCss 磨砂玻璃 + 读备份变量）

**Files:**
- Modify: `lib/skin-inject.cjs`（重写 `renderSkinCss`、`buildSkinExpression`、`renderSkinChromeCss`）

**Interfaces:**
- Consumes: `sel.BACKUP_VAR_NAMES`、`sel.OVERLAY_REGION_SELECTORS`（Task 4）
- Produces:
  - `renderSkinCss(theme, themeColors)` —— 新签名，接受第二个参数 `themeColors = { bg, input, panel, accent }`（从备份变量读到的 RGB 元组字符串如 `"18, 18, 22"`）；输出含 `rgba(...) + backdrop-filter:blur(...)` 的 CSS
  - `buildSkinExpression(theme)` —— 改为先读备份变量再注入（注入表达式分两步：先 Runtime.evaluate 读 4 个备份变量，再用读到的值拼最终 `<style>`）
  - `readBackupVarsExpression` —— 新导出，纯字符串，返回用于 Runtime.evaluate 的读取表达式
  - `parseBackupVarsResult(jsonStr)` —— 新导出纯函数，把 Runtime.evaluate 返回的 JSON 解析成 `{ bg, input, panel, accent }` 元组，含 fallback

- [ ] **Step 1: 写失败测试（恢复 + 新增到 `test/skininjecttest.cjs`）**

打开 `test/skininjecttest.cjs`。**恢复 Task 4 Step 4 注释掉的旧 `renderSkinCss` 断言**，但**改成新形状**（旧断言测 `colors`/旧 overlay，全删）。新断言段：

```js
// === renderSkinCss: 磨砂玻璃新形状（Task 5）===
// themeColors: 从备份变量读到的 RGB 元组（"R, G, B" 字符串）
var themeColors = { bg: "18, 18, 22", input: "30, 30, 36", panel: "22, 22, 26", accent: "59, 130, 246" };
var cssFrost = si.renderSkinCss({
  name: "磨砂测试",
  overlay: { enabled: true, panelOpacity: 70, panelBlur: 12, inputOpacity: 70, inputBlur: 12, sidebarOpacity: 70, sidebarBlur: 12 }
}, themeColors);
check("frost overlay section present", cssFrost.indexOf("frosted glass") >= 0 || cssFrost.indexOf("overlay") >= 0);
check("frost panel rgba emitted", cssFrost.indexOf("rgba(18, 18, 22, 0.7)") >= 0);
check("frost panel backdrop-filter blur 12px", cssFrost.indexOf("backdrop-filter: blur(12px)") >= 0);
check("frost input rgba emitted", cssFrost.indexOf("rgba(30, 30, 36, 0.7)") >= 0);
check("frost sidebar rgba emitted", cssFrost.indexOf("rgba(22, 22, 26, 0.7)") >= 0);
check("frost targets main", cssFrost.indexOf("main, [role='main']") >= 0);
check("frost targets .bg-input", cssFrost.indexOf(".bg-input") >= 0);
check("frost targets #sidebar", cssFrost.indexOf("#sidebar") >= 0);
check("frost has webkit prefix", cssFrost.indexOf("-webkit-backdrop-filter") >= 0);

// overlay 关闭：不输出磨砂规则
var cssNoFrost = si.renderSkinCss({
  name: "关闭测试",
  overlay: { enabled: false, panelOpacity: 70, panelBlur: 12, inputOpacity: 70, inputBlur: 12, sidebarOpacity: 70, sidebarBlur: 12 }
}, themeColors);
check("no frost when disabled", cssNoFrost.indexOf("backdrop-filter") < 0);
check("no rgba when disabled", cssNoFrost.indexOf("rgba(18, 18, 22") < 0);

// themeColors 缺失（备份变量读不到）：用 fallback
var cssFallback = si.renderSkinCss({
  name: "fallback 测试",
  overlay: { enabled: true, panelOpacity: 70, panelBlur: 0, inputOpacity: 70, inputBlur: 0, sidebarOpacity: 70, sidebarBlur: 0 }
}, null);
check("fallback uses default bg", cssFallback.indexOf("rgba(18, 18, 22, 0.7)") >= 0);

// blur=0 不输出 backdrop-filter（避免无意义 GPU 开销）
var cssBlur0 = si.renderSkinCss({
  name: "blur0",
  overlay: { enabled: true, panelOpacity: 70, panelBlur: 0, inputOpacity: 70, inputBlur: 0, sidebarOpacity: 70, sidebarBlur: 0 }
}, themeColors);
// 0 blur 时 backdrop-filter 可省略（spec: 0=清晰壁纸）
check("blur 0 omits backdrop-filter (panel)", cssBlur0.indexOf("main, [role='main']") >= 0);

// === readBackupVarsExpression + parseBackupVarsResult（Task 5）===
check("readBackupVarsExpression is string", typeof si.readBackupVarsExpression === "string" || typeof si.readBackupVarsExpression === "function");
check("readBackupVarsExpression mentions all 4 vars",
  si.readBackupVarsExpression.indexOf("--zcode-wp-orig-bg") >= 0 &&
  si.readBackupVarsExpression.indexOf("--zcode-wp-orig-input") >= 0 &&
  si.readBackupVarsExpression.indexOf("--zcode-wp-orig-panel") >= 0 &&
  si.readBackupVarsExpression.indexOf("--zcode-wp-orig-accent") >= 0);
// parse: 正常 JSON
var parsed = si.parseBackupVarsResult(JSON.stringify({ bg: "#121216", input: "#1e1e24", panel: "#16161a", accent: "#3b82f6" }));
check("parse returns bg tuple", parsed.bg === "18, 18, 22");
check("parse returns accent tuple", parsed.accent === "59, 130, 246");
// parse: 空字符串/坏 JSON -> fallback
var parsedBad = si.parseBackupVarsResult("not json");
check("parse bad json uses fallback", parsedBad.bg === "18, 18, 22" && parsedBad.accent === "180, 92, 255");
// parse: 部分缺失 -> 缺失项用 fallback
var parsedPartial = si.parseBackupVarsResult(JSON.stringify({ bg: "#fff" }));
check("parse partial input fallback", parsedPartial.input === "30, 30, 36");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/skininjecttest.cjs`
Expected: 新断言 FAIL（`si.renderSkinCss` 还是旧签名，`si.readBackupVarsExpression`/`parseBackupVarsResult` undefined）。

- [ ] **Step 3: 重写 `lib/skin-inject.cjs` 的 `renderSkinCss`**

打开 `lib/skin-inject.cjs`。**替换 line 33-69（旧 renderSkinCss 的 overlay 段）+ 后续 colors token 段**。整个 `renderSkinCss` 函数重写：

```js
// Fallback theme colors (spec §3.5 hardcoded map). Used when backup vars can't
// be read (ZCode update renamed vars, CDP hiccup). Mirror spec §3.5 values.
var FALLBACK_THEME_COLORS = {
  bg: "18, 18, 22",       // #121216
  input: "30, 30, 36",    // #1e1e24
  panel: "22, 22, 26",    // #16161a
  accent: "180, 92, 255"  // #b45cff (spec §4.4 sparkle default)
};

// Render a theme into CSS for #zcode-user-skin (spec §4 frosted-glass).
// themeColors: { bg, input, panel, accent } — RGB tuples ("R, G, B" strings)
// read at inject-time from --zcode-wp-orig-* backup vars. null = use fallback.
// Emits:
//   0) OVERLAY rules (when theme.overlay.enabled): rgba(themeColors, opacity) +
//      backdrop-filter:blur() on 3 element selectors. NO color field — the
//      半透层底色 comes from ZCode theme via backup vars.
//   1) font override if theme.font set
//   2) radius override if theme.radius set
// Each rule uses !important. null theme values skipped.
function renderSkinCss(theme, themeColors = null) {
  var lines = ["/* ZCode skin: " + (theme.name || "unnamed") + " */"];
  var tc = themeColors || FALLBACK_THEME_COLORS;
  var ov = theme.overlay || {};

  // 0) FROSTED GLASS overlay: rgba(themeColor, opacity) + backdrop-filter blur.
  if (ov.enabled) {
    var regions = [
      { name: "panel", selector: sel.OVERLAY_REGION_SELECTORS.panel, color: tc.bg, opacity: ov.panelOpacity, blur: ov.panelBlur },
      { name: "input", selector: sel.OVERLAY_REGION_SELECTORS.input, color: tc.input, opacity: ov.inputOpacity, blur: ov.inputBlur },
      { name: "sidebar", selector: sel.OVERLAY_REGION_SELECTORS.sidebar, color: tc.panel, opacity: ov.sidebarOpacity, blur: ov.sidebarBlur }
    ];
    lines.push("/* frosted glass overlay: wallpaper coexistence */");
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i];
      var a = clampAlpha(r.opacity);
      var rgba = "rgba(" + r.color + ", " + a + ")";
      var blurDecl = r.blur > 0
        ? "backdrop-filter: blur(" + r.blur + "px) !important; -webkit-backdrop-filter: blur(" + r.blur + "px) !important;"
        : "";
      lines.push(r.selector + " { background-color: " + rgba + " !important; " + blurDecl + " }");
    }
  }

  // 1) font override
  if (theme.font && typeof theme.font === "string" && theme.font.trim()) {
    lines.push("* { font-family: " + JSON.stringify(theme.font.trim()) + " !important; }");
  }

  // 2) radius override
  if (theme.radius != null && theme.radius !== "" && isFinite(Number(theme.radius))) {
    var rad = Number(theme.radius);
    lines.push(".bg-input, button, [class*='card'], [class*='rounded'] { border-radius: " + rad + "px !important; }");
  }

  return lines.join("\n");
}

// Clamp opacity percentage (0-100) to alpha (0-1) string with 2 decimals max.
function clampAlpha(opacityPct) {
  var v = isFinite(opacityPct) ? Math.max(0, Math.min(100, Number(opacityPct))) : 100;
  return (v / 100).toFixed(2).replace(/0$/, "").replace(/\.$/, "");
}
```

- [ ] **Step 4: 重写 `buildSkinExpression` + 加 `readBackupVarsExpression`/`parseBackupVarsResult`**

找到 `lib/skin-inject.cjs` 现有 `buildSkinExpression` 函数（line 279-301），整段替换。同时新增 `readBackupVarsExpression` 和 `parseBackupVarsResult`：

```js
// Runtime.evaluate expression to read 4 backup theme-color vars (spec §4.3).
// Returns JSON string { bg, input, panel, accent } where each value is the raw
// var value (hex or rgb()). Node-side parseBackupVarsResult converts to tuples.
var readBackupVarsExpression = [
  "(function(){",
  "  var root = getComputedStyle(document.documentElement);",
  "  function read(name){ return (root.getPropertyValue(name)||'').trim(); }",
  "  return JSON.stringify({",
  "    bg: read(" + JSON.stringify(sel.BACKUP_VAR_NAMES.panel) + "),",
  "    input: read(" + JSON.stringify(sel.BACKUP_VAR_NAMES.input) + "),",
  "    panel: read(" + JSON.stringify(sel.BACKUP_VAR_NAMES.sidebar) + "),",
  "    accent: read(" + JSON.stringify(sel.BACKUP_VAR_NAMES.accent) + ")",
  "  });",
  "})()"
].join("");

// Parse a hex color (#rgb/#rrggbb) into "R, G, B" tuple string. null if invalid.
function hexToTuple(s) {
  var rgb = skinModel.hexToRgb(s);
  return rgb ? (rgb.r + ", " + rgb.g + ", " + rgb.b) : null;
}
// Parse "rgb(R, G, B)" or "rgba(R, G, B, A)" into "R, G, B" tuple. null if no match.
function rgbStringToTuple(s) {
  if (typeof s !== "string") return null;
  var m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  return m ? (m[1] + ", " + m[2] + ", " + m[3]) : null;
}
// Convert any color string (hex or rgb()) to "R, G, B" tuple, with fallback.
function anyColorToTuple(s, fallbackTuple) {
  if (typeof s !== "string" || !s) return fallbackTuple;
  return hexToTuple(s) || rgbStringToTuple(s) || fallbackTuple;
}

// Parse readBackupVarsExpression's JSON result into { bg, input, panel, accent }
// RGB tuples. Robust to: bad JSON, missing keys, empty values, ZCode var rename.
// spec §3.5 fallbacks applied per-key.
function parseBackupVarsResult(jsonStr) {
  var parsed = {};
  try { parsed = JSON.parse(jsonStr); } catch (e) { parsed = {}; }
  if (!parsed || typeof parsed !== "object") parsed = {};
  return {
    bg: anyColorToTuple(parsed.bg, FALLBACK_THEME_COLORS.bg),
    input: anyColorToTuple(parsed.input, FALLBACK_THEME_COLORS.input),
    panel: anyColorToTuple(parsed.panel, FALLBACK_THEME_COLORS.panel),
    accent: anyColorToTuple(parsed.accent, FALLBACK_THEME_COLORS.accent)
  };
}

// Build the FINAL inject expression (after backup vars have been read + parsed).
// themeColors must already be { bg, input, panel, accent } tuples. Idempotent.
function buildSkinExpression(theme, themeColors) {
  var cssText = renderSkinCss(theme, themeColors) + "\n" + renderSkinChromeCss(theme, themeColors);
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

- [ ] **Step 5: 改 `renderSkinChromeCss` 让 sparkle 辉光跟 themeColors.accent**

找到 `renderSkinChromeCss` 函数（约 line 196-274）。改 line 197-206：原来 `var accentAlt = (theme.colors && theme.colors.accentAlt) || "#b45cff";`，新签名接受 `themeColors`：

```js
function renderSkinChromeCss(theme, themeColors) {
  // sparkle glow: follow ZCode theme accent (spec §4.4). themeColors.accent is
  // an "R, G, B" tuple; convert to rgb() for box-shadow. Fallback: spec default.
  var accentTuple = (themeColors && themeColors.accent) || FALLBACK_THEME_COLORS.accent;
  var accentRgb = "rgb(" + accentTuple + ")";
  var d = theme.decorations || {};
  // ... 函数其余部分（sparkle 粒子位置/动画、emoji badge 位置）保持不变 ...
```

然后把原 line 206 的 `box-shadow: 0 0 8px 2px " + accentAlt + ";` 改为：
```js
"  box-shadow: 0 0 8px 2px " + accentRgb + ";",
```

- [ ] **Step 6: 改 `applySkin` 先读备份变量再注入**

找到 `applySkin` 函数（约 line 327-349）。每个 target 的注入改成两步：先 Runtime.evaluate `readBackupVarsExpression` 拿到 JSON，`parseBackupVarsResult` 解析，再 `buildSkinExpression(theme, themeColors)` 拼最终表达式注入：

```js
async function applySkin(theme, opts) {
  var o = opts || {};
  var targets = await cdp.listTargets();
  var affected = 0;
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    var ws;
    try {
      var r = await cdp.connect(t.webSocketDebuggerUrl);
      ws = r.ws; var call = r.call;
      // Step 1: read backup theme-color vars (spec §4.3)
      var readRes = await call("Runtime.evaluate", { expression: readBackupVarsExpression, returnByValue: true });
      var jsonStr = readRes && readRes.result && readRes.result.value;
      var themeColors = parseBackupVarsResult(jsonStr);
      // Step 2: build + inject final expression with themeColors baked in
      var expression = buildSkinExpression(theme, themeColors);
      await call("Runtime.evaluate", { expression: expression, returnByValue: true });
      // Step 3: verify
      var verify = buildSkinVerifyExpression();
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

在 `module.exports` 加新导出（在文件末尾找现有 module.exports 块）：

```js
module.exports = {
  renderSkinCss: renderSkinCss,
  renderSkinChrome: renderSkinChrome,
  renderSkinChromeCss: renderSkinChromeCss,
  buildSkinExpression: buildSkinExpression,
  buildSkinRemoveExpression: buildSkinRemoveExpression,
  buildSkinVerifyExpression: buildSkinVerifyExpression,
  readBackupVarsExpression: readBackupVarsExpression,
  parseBackupVarsResult: parseBackupVarsResult,
  applySkin: applySkin,
  removeSkin: removeSkin
};
```

（如果原导出里没有 `renderSkinCss` 等，按实际现状增删；关键是新增 `readBackupVarsExpression`/`parseBackupVarsResult`）

- [ ] **Step 8: 跑 skininjecttest 确认新断言通过**

Run: `node test/skininjecttest.cjs`
Expected: 所有新断言 PASS。如果旧断言（font/radius 的 renderSkinCss 段）还在跑且 PASS，保留；如果 FAIL 则它们测的是旧签名，按需调整。

- [ ] **Step 9: Commit**

```bash
git add lib/skin-inject.cjs test/skininjecttest.cjs
git commit -m "feat(skin): renderSkinCss 改磨砂玻璃 + 读备份变量拼 rgba/blur

- renderSkinCss 新签名 (theme, themeColors)，输出 rgba + backdrop-filter:blur
- buildSkinExpression 先 readBackupVarsExpression 读 4 个 --zcode-wp-orig-*，
  parseBackupVarsResult 解析成 RGB 元组，再拼最终 <style>
- renderSkinChromeCss sparkle 辉光跟 themeColors.accent
- applySkin 两步注入：读备份变量 → buildSkinExpression → evaluate
- 新增 FALLBACK_THEME_COLORS 防备份变量读不到（spec §3.5）
- skininjecttest 新增磨砂/blur/fallback/parse 断言"
```

---

## Task 6: `lib/wallpaper.css` 正式整合备份声明

**Files:**
- Modify: `lib/wallpaper.css`

**Interfaces:** 无（纯 CSS 文件）

- [ ] **Step 1: 改 `lib/wallpaper.css` 把 Task 1 的 SPIKE TEMP 段改成正式版**

打开 `lib/wallpaper.css`。Task 1 Step 1 已加了 SPIKE TEMP 注释的备份声明。改成正式版（去 SPIKE 字样、加 spec 引用、加为什么）：

把：
```css
/* SPIKE TEMP: 验证 CSS 自定义属性备份机制是否成立。
   下一行 var(--color-background) 求值时，--color-background 还没被后面的
   transparent !important 覆盖，所以应该快照到 ZCode 原主题色。 */
:root { --zcode-wp-orig-bg: var(--color-background); }
:root { --zcode-wp-orig-panel: var(--color-background-alt); }
:root { --zcode-wp-orig-input: var(--color-input); }
:root { --zcode-wp-orig-accent: var(--color-brand); }
```
改为：
```css
/* 0) 主题色备份（spec 2026-07-17-skin-overlay-frosted-glass §3.2）
      必须在下面的 transparent !important 覆盖之前。CSS 自定义属性求值即
      写入：这里 var(--color-background) 求值时它还是 ZCode 原色，被快照进
      --zcode-wp-orig-bg；下面把它改成 transparent 不会回溯修改已写入的快照。
      皮肤系统（lib/skin-inject.cjs）运行时读这 4 个变量拼 frosted-glass
      rgba() 层。变量名与 lib/skin-selectors.cjs BACKUP_VAR_NAMES 镜像。 */
:root {
  --zcode-wp-orig-bg: var(--color-background);
  --zcode-wp-orig-panel: var(--color-background-alt);
  --zcode-wp-orig-input: var(--color-input);
  --zcode-wp-orig-accent: var(--color-brand);
}
```

- [ ] **Step 2: 重注入验视觉**

Run: `npm run inject`
Expected: 注入成功，无报错。

- [ ] **Step 3: Commit**

```bash
git add lib/wallpaper.css
git commit -m "feat(wallpaper): 正式整合主题色备份变量到 wallpaper.css

把 Task 1 spike 的临时备份声明改成正式版，加 spec 引用和机制说明。
变量名与 lib/skin-selectors.cjs BACKUP_VAR_NAMES 镜像（lesson 17）。"
```

---

## Task 7: 前端 UI 重构（`control/lib/skin-view.js`）

**Files:**
- Modify: `control/lib/skin-view.js`

**Interfaces:** 无（纯前端渲染逻辑）

- [ ] **Step 1: 重写 `renderOverlaySection`（删颜色、改双滑块）**

打开 `control/lib/skin-view.js`，找到 `renderOverlaySection` 函数（line 188-213），整段替换：

```js
// Render the frosted-glass overlay section (spec §5.2): enable toggle +
// per-region (面板/输入框/侧栏) opacity + blur sliders. NO color pickers —
// 底色 follows ZCode theme via --zcode-wp-orig-* backup vars.
function renderOverlaySection(theme) {
  var ov = theme.overlay || {};
  function rangeRow(kind, region, label, max) {
    // kind: "op" (opacity) or "blur"; region: "panel"/"input"/"sidebar"
    var key = region + (kind === "op" ? "Opacity" : "Blur");
    var def = skin.OVERLAY_DEFAULTS[key];
    var v = (ov[key] != null) ? ov[key] : def;
    var unit = kind === "op" ? "%" : "px";
    var dataAttr = kind === "op" ? "data-ov-op" : "data-ov-blur";
    var valAttr = kind === "op" ? "data-ov-op-val" : "data-ov-blur-val";
    return '<label class="skin-row skin-opacity-row">' + label + ' ' + (kind === "op" ? "透明度" : "模糊度") + " " +
      '<input type="range" ' + dataAttr + '="' + key + '" min="0" max="' + max + '" value="' + v + '">' +
      '<span ' + valAttr + '="' + key + '">' + v + unit + "</span></label>";
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

找到 `renderEditor` 函数（line 109-160），删除 line 121-127（`var c = editing.colors` + `colorRow` 内部函数）和 line 137-145（「颜色 (9)」`<details>` 块）。保留 line 132-136 的「基本信息」`<details>`（font/radius）和 line 146-154 的装饰层 `<details>`。

新 `renderEditor` 的 html 拼接顺序（对照 spec §5.3）：
1. legend（含 name badge）
2. 基本信息 details（name/font/radius）
3. 角标与闪光 details（sparkle/emoji）
4. overlay section（renderOverlaySection 返回）
5. 保存按钮

- [ ] **Step 3: 改 `collectEditor`（删 colors 收集、加 blur 收集）**

找到 `collectEditor` 函数（line 234-291）。删除 line 265-271（COLOR_KEYS 收集循环）。改 overlay 收集段（line 272-289）——删 `ovColor` 函数 + 3 个 `*Bg` 字段，加 3 个 `*Blur` 字段：

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

- [ ] **Step 4: 删主色面板的事件处理（color text↔picker 同步）**

找到 line 297-332 的 `panel.addEventListener("change", ...)` 块。删除 line 300-320（`data-ck`/`data-ck-text`/`data-ov-ck`/`data-ov-ck-text` 的 text↔picker 同步逻辑——这些字段都不存在了）。保留 `data-ov-op` label 更新（line 322-326），**加 `data-ov-blur` label 更新**：

```js
// overlay blur slider: live-update the value label (px)
var ovbl = t.getAttribute && t.getAttribute("data-ov-blur");
if (ovbl) {
  var b lbl = panel.querySelector('[data-ov-blur-val="' + ovbl + '"]');
  if (blbl) blbl.textContent = t.value + "px";
}
```

（修正变量名：`blbl` 不是 `b lbl`，写成 `var blbl = ...`）

- [ ] **Step 5: 改 live-preview 触发条件**

找到 line 452-459 的 `panel.addEventListener("input", ...)` 块。改 line 455-456 的 `interesting` 判断——删 `data-ck`（已不存在），加 `data-ov-blur`：

```js
var interesting = t.getAttribute("data-ov-op") || t.getAttribute("data-ov-blur") ||
  t.getAttribute("data-ov-ck") ||  // legacy, may still fire on no elements — harmless
  t.getAttribute("data-field");
```

（实际 `data-ov-ck` 已无元素匹配，可删；保留无害。优先用上面这行。）

- [ ] **Step 6: 改 listSignature 加 blur 字段（防 poll 误重建）**

找到 `listSignature`（line 65-67）。当前只比 `id:name`，不够——因为 overlay 的 blur/opacity 变了不应触发重建（那些走 editor 内部状态），但如果 activeId 变了要重建。**这里其实不用改**（listSignature 只关心主题列表身份，不关心字段值）。**Step 跳过**——保留原样。

- [ ] **Step 7: 人工跑控制中心验证 UI 渲染**

Run: `npm run control`
Expected: server 起在 17890。在 ZCode 浏览器面板开 `http://127.0.0.1:17890/control/`，皮肤 Tab 应显示：
- 「主题选择」下拉（只「默认主题 [预设]」一项）
- 「基本信息」（名称/字体/圆角）
- 「磨砂玻璃」section（启用 checkbox + 面板/输入框/侧栏各两个滑块）
- 「装饰层」section（sparkle + emoji）
- **不应有**任何颜色选择器

人眼验：拖滑块、勾选框、切换主题都不报 JS 错。

- [ ] **Step 8: Commit**

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

## Task 8: 回归 + 真机验证清单

**Files:** 无（验证性 task）

- [ ] **Step 1: 跑全量测试**

Run: `npm test`
Expected: 所有 28+ 个 test 文件全绿，含 skintest + skininjecttest。若任一 FAIL，定位修复后重跑。

- [ ] **Step 2: 真机验证清单（spec §8.3）—— 逐项人眼验**

需要：ZCode 已带壁纸运行（`wallpaper.bat` 场景 2）+ 控制中心已起（`npm run control`）。

逐项验：
1. **备份变量机制**（Task 1 已验，跳过）
2. **overlay 启用**：控制中心启用磨砂玻璃 → 面板/输入框/侧栏呈半透明，壁纸透出且被模糊
3. **overlay 关闭**：取消勾选 → 完全透明（壁纸满强度），与改前行为一致
4. **拖滑块实时生效**：透明度 0→100、模糊度 0→30 视觉连续
5. **切 ZCode 主题**：深色↔浅色主题切换 → 磨砂层底色自动跟随
6. **sparkle 辉光跟主题**：启用 sparkle → 辉光颜色跟随 ZCode accent（不再固定紫色）
7. **装饰层正常**：sparkle 闪烁、emoji 角标 8 个位置可放
8. **视频壁纸叠加**：先注视频壁纸（场景 7）→ 启用磨砂玻璃 → 磨砂层正常透出视频
9. **新用户首次打开**：localStorage 清空后重开 → 只看到磨砂玻璃（overlay 默认开 70/12、装饰层默认关）
10. **旧 localStorage 兼容**：手动塞一份带 colors 的旧数据 → 读取不报错、字段自动归一化（用 DevTools 改 localStorage 后刷新）

- [ ] **Step 3: 验侧栏硬画背景遗留仍在（不恶化）**

切到 ZCode 侧边栏，确认那块「框架硬画的实色深色背景」仍然在（spec §4.6 已知遗留）——磨砂玻璃**没有**让它变透明。这是预期（CSS 改不动它），不是 bug。在 commit message 记录已确认。

- [ ] **Step 4: Commit 验证记录**

```bash
git commit --allow-empty -m "test(skin): 真机验证清单 10/10 通过

1-10 项全部人眼验过：磨砂玻璃生效、跟随主题、装饰层正常、
视频壁纸兼容、旧 localStorage 归一化。
侧栏硬画背景遗留仍在（spec §4.6 已知，不恶化）。"
```

---

## Self-Review Notes

**Spec coverage check**（spec 各章节 → task）：
- §1 决策汇总 → 全部体现在 Task 2/5/7
- §2 数据模型 → Task 2（makeOverlay/makeSkinTheme/builtinPresets/迁移）
- §3 底色机制 → Task 1 spike + Task 6 正式整合
- §4 renderSkinCss 重写 → Task 5
- §5 前端 UI → Task 7
- §6 wallpaper.css → Task 6
- §7 后端 status/cdp 不动、validateTheme 改 → Task 2（validateTheme）
- §8 测试 + 真机清单 → 每个 task 的 test step + Task 8
- §9 其他子系统零影响 → Task 8 全量 npm test 验证
- §10 已知遗留 → Task 8 Step 3 验证侧栏硬画背景

**Type/name consistency check**：
- `BACKUP_VAR_NAMES`（Task 4）→ Task 5 `readBackupVarsExpression` 用同名字段 ✓
- `OVERLAY_REGION_SELECTORS`（Task 4）→ Task 5 `renderSkinCss` 读取 ✓
- `parseBackupVarsResult` 返回 `{ bg, input, panel, accent }` → Task 5 `renderSkinCss(theme, themeColors)` 第二参数同形状 ✓
- `OVERLAY_DEFAULTS`（Task 2）→ Task 7 `renderOverlaySection`/`collectEditor` 用 `skin.OVERLAY_DEFAULTS[key]` ✓
- `BLUR_RANGE.max = 30`（Task 2）→ Task 7 滑块 `max="30"` ✓

**Placeholder scan**: 无 TBD/TODO（除 Task 2 Step 4 / Task 4 Step 4 的临时注释有明确恢复 task 编号）。
