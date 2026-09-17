// Per-region glass tuner for the ZCode main page (spec 2026-09-16-ui-glass-tune).
// WHY a separate module (not in cdp.cjs): cdp.cjs is READ-ONLY by design
// (AGENTS.md). This is a WRITE op (injects/updates/removes a second <style>
// layer). Mirrors lib/video-mute.cjs: standalone write module, reuses cdp.cjs
// neutral plumbing (connect/listTargets), never duplicates CDP glue (教训 1).
//
// Single source of truth for persisted state: <root>/ui-tune.json. The <style>
// element in the page is a projection of it — no server-memory mirror (防漂移).
// Default (all-zero) = layer removed = exactly today's full-transparent look.

const fs = require("fs");

const TUNE_STYLE_ID = "zcode-user-ui-tune";
const CONFIG_FILENAME = "ui-tune.json";

const REGION_KEYS = ["sidebar", "chat", "input", "topbar", "panel"];

// Region -> CSS selector list. ANCHORS from the real-machine spike (Task 1,
// recorded in the spec appendix); scripts/inspect-regions.cjs is the diagnostic
// tool when a ZCode update moves the DOM. Single authority — change selectors
// HERE only.
const REGIONS = {
  sidebar: ['aside[data-testid="sidebar"]'],
  chat: ['[data-testid="conversation-column"]'],
  // Scoped composite on purpose: bare ".bg-input" hits 3-5 drifting elements
  // on the real machine (spike-measured); this pins it to the input dock.
  input: ['[data-testid="conversation-bottom-dock-transition"] .bg-input'],
  topbar: ['[data-testid="workspace-header"]'],
  // 右侧面板(浏览器面板,控制中心所在的整块,含地址栏行)。真机补测锚点
  // (2026-09-17 panel-probe2/4:该容器及整条祖先链 computed bg 全透明 = 玻璃层
  // 直接画在壁纸上,透过透明 webview 可见)。多会话多实例并存时全部命中,
  // 隐藏实例零面积无视觉副作用(教训 34 拓扑)。
  panel: ['[data-testid="browser"]'],
};

// Glass tint per ZCode theme (dispatched off <html> class, same signal
// wallpaper.css uses). Dark = dark smoke, light = light frost.
const TINT_DARK = "24,24,28";
const TINT_LIGHT = "248,248,248";

function clampInt(v, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min; // NaN/undefined -> min (0)
  return Math.min(max, Math.max(min, n));
}

function defaultConfig() {
  const regions = {};
  for (const k of REGION_KEYS) regions[k] = { alpha: 0, blur: 0 };
  return { version: 1, regions: regions };
}

// Pure, total (never throws). Unknown shape -> default. version !== 1 -> default
// (spec §4: 未来格式变更时旧文件整体作废,不做迁移).
function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 1 || !raw.regions || typeof raw.regions !== "object") {
    return { config: defaultConfig(), isDefault: true };
  }
  const config = defaultConfig();
  for (const k of REGION_KEYS) {
    const r = raw.regions[k];
    if (!r || typeof r !== "object") continue;
    config.regions[k].alpha = clampInt(r.alpha, 0, 100);
    config.regions[k].blur = clampInt(r.blur, 0, 24);
  }
  let isDefault = true;
  for (const k of REGION_KEYS) {
    if (config.regions[k].alpha !== 0 || config.regions[k].blur !== 0) { isDefault = false; break; }
  }
  return { config: config, isDefault: isDefault };
}

// Pure: normalized config -> full CSS string, or null when every region is at
// zero (caller must then REMOVE the layer — null means "no layer").
function buildTuneStyle(config) {
  const n = normalizeConfig(config);
  let css = "";
  for (const key of REGION_KEYS) {
    const r = n.config.regions[key];
    const sels = REGIONS[key] || [];
    if (sels.length === 0) continue;
    if (r.alpha === 0 && r.blur === 0) continue; // zero region -> no rules
    const a = (r.alpha / 100).toFixed(2);
    [[".theme-zai-dark ", TINT_DARK], [".theme-zai-light ", TINT_LIGHT]].forEach(function (th) {
      css += sels.map(function (s) { return th[0] + s; }).join(",") + "{";
      if (r.alpha > 0) css += "background-color:rgba(" + th[1] + "," + a + ") !important;";
      if (r.blur > 0) css += "backdrop-filter:blur(" + r.blur + "px) !important;-webkit-backdrop-filter:blur(" + r.blur + "px) !important;";
      css += "}";
    });
  }
  return css.length > 0 ? css : null;
}

// Pure: build the Runtime.evaluate expression that creates/replaces (cssOrNull
// truthy) or removes (falsy) the layer. Returns JSON {ok, present} so the
// caller can count affected windows (mirrors buildMuteExpression's JSON shape).
function buildTuneExpression(styleId, cssOrNull) {
  return "(function(){var id=" + JSON.stringify(styleId) +
    ";var old=document.getElementById(id);if(old)old.remove();" +
    (cssOrNull
      ? "var s=document.createElement('style');s.id=id;s.textContent=" + JSON.stringify(cssOrNull) +
        ";document.documentElement.appendChild(s);"
      : "") +
    "return JSON.stringify({ok:true,present:!!document.getElementById(id)});})()";
}

// Shared reader for server (/api/uitune) and inject.cjs (re-apply on inject).
// Missing/corrupt/half-written file -> default (atomic write's .tmp+rename
// makes half-writes near-impossible; this is the second belt).
function readConfigFile(filePath) {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (e) { raw = null; }
  return normalizeConfig(raw);
}

// Effectful: push the layer to every (filtered) page target via CDP.
// listTargets() already excludes tool pages (/control/, /reader/, /api/) —
// the glass layer must never land in our own tool pages. css=null -> removal
// pass (used when config returns to default). Per-target failure is skipped,
// not fatal (mirrors video-mute.cjs setVideoMuted). Rejects only when the
// port itself is unreachable (caller turns that into applied:false).
async function applyTune(config) {
  const cdp = require("./cdp.cjs");
  const expression = buildTuneExpression(TUNE_STYLE_ID, buildTuneStyle(config));
  const targets = await cdp.listTargets();
  let affected = 0;
  for (const t of targets) {
    let ws;
    try {
      const connected = await cdp.connect(t.webSocketDebuggerUrl);
      ws = connected.ws;
      await connected.call("Runtime.evaluate", { expression: expression, returnByValue: true });
      affected++;
    } catch (e) {
      // per-target fail, continue (don't let one bad window abort the rest)
    } finally {
      if (ws) { try { ws.close(); } catch (e) {} }
    }
  }
  return { affected: affected, total: targets.length };
}

module.exports = {
  TUNE_STYLE_ID, CONFIG_FILENAME, REGION_KEYS, REGIONS,
  defaultConfig, normalizeConfig, buildTuneStyle, buildTuneExpression, readConfigFile,
  applyTune,
};
