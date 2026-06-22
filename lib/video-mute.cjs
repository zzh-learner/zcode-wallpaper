// Real-time video wallpaper mute toggle (spec §4.4).
// WHY a separate module (not in cdp.cjs): cdp.cjs is READ-ONLY by design
// (AGENTS.md: filterTargets/listTargets/connect/probeWallpaperMode). Mute
// toggle is a WRITE op (changes video.muted). Keeping it out of cdp.cjs
// preserves the read-only invariant. But this module REUSES cdp.connect +
// cdp.listTargets (neutral plumbing) — no duplicated CDP glue (教训 1).
//
// Single source of truth for "is muted": the DOM video.muted property itself.
// We never mirror it in server memory — status reads it via cdp.cjs probe,
// mute/unmute writes it here. Two copies = drift (教训 1).

// Mirror inject.cjs VIDEO_EL_ID (canonical owner). Kept in sync manually like
// cdp.cjs's PROBE_VIDEO_EL_ID; pinned by videomutetest.cjs string assertion.
const VIDEO_EL_ID = "zcode-user-wallpaper-video";

// Pure: build the evaluate expression that flips video.muted and reports back.
// Returns a JSON string {found:bool, muted:bool} so the caller can count
// affected windows. `muted` is coerced via ternary (true/false literal only).
function buildMuteExpression(videoElId, muted) {
  return "(function(){var v=document.getElementById(" + JSON.stringify(videoElId) +
    ");if(!v)return JSON.stringify({found:false});v.muted=" + (muted ? "true" : "false") +
    ";return JSON.stringify({found:true,muted:v.muted});})()";
}

// Effectful: iterate all page targets, flip video.muted on each that has one.
// Per-target connect/evaluate failure is non-fatal (skip, continue) — mirrors
// status.cjs probeZcodeAndWallpaper's per-target tolerance.
// Returns { affected, total, lastMuted }.
async function setVideoMuted(muted) {
  const cdp = require("./cdp.cjs");
  const targets = await cdp.listTargets();
  let affected = 0;
  let lastMuted = null;
  for (const t of targets) {
    let ws;
    try {
      const connected = await cdp.connect(t.webSocketDebuggerUrl);
      ws = connected.ws;
      const call = connected.call;
      const r = await call("Runtime.evaluate", {
        expression: buildMuteExpression(VIDEO_EL_ID, muted),
        returnByValue: true,
      });
      const obj = JSON.parse(r.result.value);
      if (obj.found) { affected++; lastMuted = obj.muted; }
    } catch (e) {
      // per-target fail, continue (don't let one bad window abort the rest)
    } finally {
      if (ws) { try { ws.close(); } catch (e) {} }
    }
  }
  return { affected: affected, total: targets.length, lastMuted: lastMuted };
}

module.exports = { buildMuteExpression, setVideoMuted, VIDEO_EL_ID };
