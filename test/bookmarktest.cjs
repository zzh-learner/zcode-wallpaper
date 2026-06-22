// Test control/lib/bookmark.js pure functions (spec §9 第一层).
// Mirrors test/shelftest.cjs style. localStorage ops NOT tested (browser-only,
// verified by real-machine checklist) — same boundary as shelftest.
var bm = require("../control/lib/bookmark.js");
var pass = 0, fail = 0;
function check(n, c) { console.log((c ? "PASS ✓ " : "FAIL ✗ ") + n); c ? pass++ : fail++; }

// === normalizeUrl: protocol whitelist (XSS defense, most critical) ===
check("javascript: -> rejected", bm.normalizeUrl("javascript:alert(1)").ok === false);
check("data: -> rejected", bm.normalizeUrl("data:text/html,<script>").ok === false);
check("file: -> rejected", bm.normalizeUrl("file:///C:/x").ok === false);
check("vbscript: -> rejected", bm.normalizeUrl("vbscript:msgbox").ok === false);
check("blob: -> rejected", bm.normalizeUrl("blob:http://x/abc").ok === false);
check("ftp: -> rejected", bm.normalizeUrl("ftp://example.com").ok === false);

// === normalizeUrl: http/https accepted ===
check("github.com -> ok (auto-prepend http)", bm.normalizeUrl("github.com").ok === true);
check("github.com -> http://", bm.normalizeUrl("github.com").url === "http://github.com/");
check("https://github.com -> ok", bm.normalizeUrl("https://github.com").ok === true);
check("https preserved", bm.normalizeUrl("https://github.com").url === "https://github.com/");
check("http://  preserved", bm.normalizeUrl("http://example.com").url === "http://example.com/");

// === normalizeUrl: trim ===
check("whitespace trimmed", bm.normalizeUrl("  GitHub.com  ").url === "http://github.com/");

// === normalizeUrl: local addresses auto-prepend http ===
check("localhost:3000 -> http", bm.normalizeUrl("localhost:3000").url === "http://localhost:3000/");
check("127.0.0.1:8080 -> http", bm.normalizeUrl("127.0.0.1:8080").url === "http://127.0.0.1:8080/");

// === normalizeUrl: unicode/punycode accepted ===
check("unicode host -> ok", bm.normalizeUrl("http://中文.com").ok === true);

// === normalizeUrl: invalid inputs ===
check("empty string -> not ok", bm.normalizeUrl("").ok === false);
check("whitespace only -> not ok", bm.normalizeUrl("   ").ok === false);
check("not a url at all -> not ok", bm.normalizeUrl("not a url at all").ok === false);
check("null -> not ok", bm.normalizeUrl(null).ok === false);

// === buildGoUrl ===
check("buildGoUrl basic", bm.buildGoUrl("http://github.com/") ===
  "/control/go.html?url=" + encodeURIComponent("http://github.com/"));
check("buildGoUrl encodes & = #", bm.buildGoUrl("http://x.com/a?b=c&d=e").indexOf(encodeURIComponent("http://x.com/a?b=c&d=e")) !== -1);
check("buildGoUrl with title includes title param", bm.buildGoUrl("http://x.com/", "My Title").indexOf("&title=" + encodeURIComponent("My Title")) !== -1);
check("buildGoUrl without title omits title param", bm.buildGoUrl("http://x.com/", undefined).indexOf("title=") === -1);
check("buildGoUrl empty title omits title param", bm.buildGoUrl("http://x.com/", "").indexOf("title=") === -1);

// === bookmarkId: uniqueness + shape ===
var id1 = bm.bookmarkId(), id2 = bm.bookmarkId();
check("bookmarkId starts with bm_", /^bm_/.test(id1));
check("bookmarkId unique (2 calls differ)", id1 !== id2);

// === makeBookmarkEntry ===
var e1 = bm.makeBookmarkEntry({ title: "GitHub", url: "http://github.com/" });
check("makeBookmarkEntry: id present", typeof e1.id === "string" && /^bm_/.test(e1.id));
check("makeBookmarkEntry: title from input", e1.title === "GitHub");
check("makeBookmarkEntry: url from input", e1.url === "http://github.com/");
check("makeBookmarkEntry: createdAt is number", typeof e1.createdAt === "number");
// title defaults to hostname when empty
var e2 = bm.makeBookmarkEntry({ title: "", url: "http://github.com/" });
check("makeBookmarkEntry: empty title -> hostname", e2.title === "github.com");
var e3 = bm.makeBookmarkEntry({ title: "  ", url: "http://x.com/" });
check("makeBookmarkEntry: whitespace title -> hostname", e3.title === "x.com");
var e4 = bm.makeBookmarkEntry({ url: "http://y.com/" });
check("makeBookmarkEntry: missing title -> hostname", e4.title === "y.com");

// === isAllowedProtocol ===
check("isAllowedProtocol http true", bm.isAllowedProtocol({ protocol: "http:" }) === true);
check("isAllowedProtocol https true", bm.isAllowedProtocol({ protocol: "https:" }) === true);
check("isAllowedProtocol javascript false", bm.isAllowedProtocol({ protocol: "javascript:" }) === false);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
