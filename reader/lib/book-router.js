// Pure helper: parse ?book=<id> from a URL/search string, for deep-linking a
// book from the control center (control shelf click -> /reader/?book=<id>).
// Dual export: CommonJS (Node test) + window.__readerBookRouter (browser).
//
// Why a separate file: reader.js is an IIFE with no exports, so this pure
// parser is extracted to be unit-testable (教训: pure functions get tests,
// DOM-wiring gets real-machine verification).
function parseBookParam(searchOrHref) {
  // accept either "?book=xxx" or a full href "http://host/reader/?book=xxx"
  var s = searchOrHref || "";
  var q = s.indexOf("?");
  var query = q >= 0 ? s.slice(q + 1) : s;
  var pairs = query.split("&");
  for (var i = 0; i < pairs.length; i++) {
    var eq = pairs[i].indexOf("=");
    if (eq < 0) continue;
    var k = pairs[i].slice(0, eq);
    var v = pairs[i].slice(eq + 1);
    if (decodeURIComponent(k) === "book") return decodeURIComponent(v);
  }
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseBookParam: parseBookParam };
}
if (typeof window !== "undefined") {
  window.__readerBookRouter = { parseBookParam: parseBookParam };
}
