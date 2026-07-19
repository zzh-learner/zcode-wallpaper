// ZCode DOM selector + CSS variable mapping for the skin system.
// Populated from real-machine probe (scripts/inspect-skin2.cjs, 2026-07-16,
// ZCode 3.3.6 Electron 41). Lesson 21: these come from probing real DOM, not
// from CSS common sense. If a ZCode update breaks skin coloring, re-run
// inspect-skin2.cjs and update this file.
//
// Strategy: prefer overriding CSS variable tokens (--color-*) over element
// classes — variable names are more stable across ZCode updates than class
// names, and ZCode's whole UI reads from these tokens. Element-class fallbacks
// only for things that have no clean token (e.g. emoji badge positioning).

// Map theme.colors.* -> ZCode CSS variable token(s) to override.
// Each value is an array of token names; we set them all to the theme color.
// Verified present on .theme-zai-dark / .theme-zai-light roots via probe.
var COLOR_TO_TOKENS = {
  // background: the main app background. ZCode uses --color-background on the
  // theme root; bg-background-* utility classes inherit it.
  background: ["--color-background", "--color-background-win-alt"],
  // panel: card/surface backgrounds. ZCode uses --color-background-alt + the
  // bg-surface/bg-background-alt utility classes.
  panel: ["--color-background-alt"],
  // accent: primary buttons / brand. ZCode send button uses .bg-brand which
  // reads --color-brand. Also alias to --color-primary for buttons using that.
  accent: ["--color-brand", "--color-primary"],
  accentAlt: ["--color-brand-hover"],
  // text: main foreground. --color-foreground drives text-foreground utility.
  text: ["--color-foreground"],
  muted: ["--color-foreground-muted", "--color-muted-foreground"],
  // sidebarBg: the left sidebar. ZCode's #sidebar reads --color-background by
  // default; we override --color-sidebar if present, else fall back to a direct
  // rule in renderSkinCss (see SKIN_ELEMENT_RULES).
  sidebarBg: [],
  // inputBg / inputBorder: composer input. .bg-input reads --color-input,
  // .border-input-border reads --color-input-border.
  inputBg: ["--color-input"],
  inputBorder: ["--color-input-border"]
};

// Element-class fallback rules for things tokens don't cleanly cover.
// Each entry: { selector, props: { cssProp: themeColorKey } }.
// renderSkinCss emits `selector { prop: <theme value> !important }` per entry.
// Kept minimal — tokens handle most; this is the safety net.
var SKIN_ELEMENT_RULES = [
  // Sidebar: ZCode's #sidebar has no dedicated bg token (inherits background),
  // so set it directly when sidebarBg is provided.
  { selector: "#sidebar, aside.h-full", props: { backgroundColor: "sidebarBg" } },
  // Body fallback: if tokens somehow don't cascade, set body bg directly.
  { selector: "body", props: { backgroundColor: "background", color: "text" } }
];

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

// DOM ids for the injected skin elements (mirror inject.cjs STYLE_ID convention).
// Keep these in sync with skin-inject.cjs; skintest mirrors them to detect drift.
var SKIN_STYLE_ID = "zcode-user-skin";
var SKIN_CHROME_ID = "zcode-user-skin-chrome";

module.exports = {
  COLOR_TO_TOKENS: COLOR_TO_TOKENS,
  SKIN_ELEMENT_RULES: SKIN_ELEMENT_RULES,
  FROST_BASE_VARS: FROST_BASE_VARS,
  OVERLAY_REGION_SELECTORS: OVERLAY_REGION_SELECTORS,
  SKIN_STYLE_ID: SKIN_STYLE_ID,
  SKIN_CHROME_ID: SKIN_CHROME_ID
};
