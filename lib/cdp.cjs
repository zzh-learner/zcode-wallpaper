// Shared read-only CDP helpers. Extracted from inject.cjs so both inject.cjs
// (action) and status.cjs (query) reuse ONE copy of the CDP glue (spec §4 A2b,
// 审查 P1-1). Action logic stays in inject.cjs; this module only connects +
// queries.
//
// Port/host mirror inject.cjs defaults.
const http = require("http");
const { WebSocket } = require("ws");

const PORT = parseInt(process.env.ZCODE_DEBUG_PORT || "9222", 10);
const HOST = process.env.ZCODE_DEBUG_HOST || "127.0.0.1";

// Pure function: filter /json targets to "real" ZCode pages (spec §5.4).
// Excludes our OWN tool pages by PATH PREFIX on any localhost/127.0.0.1 port
// (审查 P1-target过滤端口: don't depend on knowing our own port — standalone
// inject.cjs and port-drift both still filter correctly).
// Excludes: /control/, /reader/, /api/ paths; devtools://; non-page; no wsUrl.
function filterTargets(targets) {
  return targets.filter((t) => {
    if (t.type !== "page") return false;
    if (!t.webSocketDebuggerUrl) return false;
    const url = t.url || "";
    if (url.indexOf("devtools://") === 0) return false;
    // localhost or 127.0.0.1, any port, then check path prefix
    const m = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.exec(url);
    if (m) {
      const path = m[3] || "/";
      if (path.indexOf("/control/") === 0 || path.indexOf("/reader/") === 0 || path.indexOf("/api/") === 0) {
        return false;
      }
    }
    return true;
  });
}

module.exports = { filterTargets, PORT, HOST };

if (require.main === module) {
  // quick self-check when run directly
  console.log("cdp.cjs loaded. PORT=" + PORT + " HOST=" + HOST);
}
