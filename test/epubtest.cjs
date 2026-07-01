// Test for lib/epub.cjs — epub parsing pure functions (spec §3, §5).
// Run: node test/epubtest.cjs
const lib = require("../lib/epub.cjs");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// --- scopeCss: prefix every selector with #scopeId ---
(function(){
  const { scopeCss } = lib;
  // simple tag selector
  check("tag selector scoped",
    scopeCss("p { color: red; }", "epub-content").includes("#epub-content p"));
  // body/global selector
  check("body scoped",
    scopeCss("body { font-family: serif; }", "epub-content").includes("#epub-content body"));
  // class selector
  check("class scoped",
    scopeCss(".chapter-text { text-indent: 2em; }", "epub-content").includes("#epub-content .chapter-text"));
  // descendant selector — only outermost gets prefix
  check("descendant scoped (prefix outermost)",
    /#epub-content\s+ul\s+li/.test(scopeCss("ul li { margin: 0; }", "epub-content")));
  // comma-separated selectors — both get prefix
  const comma = scopeCss("h1, h2 { color: black; }", "epub-content");
  check("comma list both scoped", comma.includes("#epub-content h1") && comma.includes("#epub-content h2"));
  // @media preserved, inner selectors scoped
  const media = scopeCss("@media (max-width: 600px) { p { font-size: 14px; } }", "epub-content");
  check("@media block kept", media.includes("@media"));
  check("@media inner scoped", media.includes("#epub-content p"));
  // declarations untouched
  const decl = scopeCss("p { color: red; background: url(x); }", "epub-content");
  check("declaration block untouched", decl.includes("color: red") && decl.includes("url(x)"));
})();

// --- scopeCss edge cases ---
(function(){
  const { scopeCss } = lib;
  // id selector
  check("id selector scoped",
    scopeCss("#cover { display: none; }", "epub-content").includes("#epub-content #cover"));
  // empty input
  check("empty css returns empty", scopeCss("", "epub-content") === "");
  // css with no selectors (only comment)
  check("comment-only preserved",
    scopeCss("/* hi */", "epub-content").includes("hi") || scopeCss("/* hi */", "epub-content") === "");
})();

// --- isAllowedAssetHref: path-traversal defense (spec §4.3) ---
(function(){
  const { isAllowedAssetHref } = lib;
  const allowed = new Set(["images/red.png", "styles/main.css", "OEBPS/chap1.xhtml"]);
  // whitelist member
  check("exact whitelist member allowed", isAllowedAssetHref("images/red.png", allowed) === true);
  check("another whitelist member", isAllowedAssetHref("styles/main.css", allowed) === true);
  // not in whitelist
  check("unknown href rejected", isAllowedAssetHref("images/secret.png", allowed) === false);
  // path traversal attempts
  check("../../etc/passwd rejected", isAllowedAssetHref("../../etc/passwd", allowed) === false);
  check("..\\..\\windows rejected", isAllowedAssetHref("..\\..\\win.ini", allowed) === false);
  // URL-encoded traversal
  check("encoded ..%2f rejected", isAllowedAssetHref("images%2F..%2F..%2Fetc%2Fpasswd", allowed) === false);
  // empty/null
  check("empty href rejected", isAllowedAssetHref("", allowed) === false);
  check("null href rejected", isAllowedAssetHref(null, allowed) === false);
  // absolute path (not in whitelist as-is)
  check("/etc/passwd rejected", isAllowedAssetHref("/etc/passwd", allowed) === false);
  // case-sensitive (don't normalize — strict equality)
  check("case-sensitive: IMAGES/RED.PNG != images/red.png",
    isAllowedAssetHref("IMAGES/RED.PNG", allowed) === false);
  // empty whitelist rejects everything
  check("empty whitelist rejects all", isAllowedAssetHref("images/red.png", new Set()) === false);
})();

if (fail > 0) { console.error("\n" + fail + " FAILED"); process.exit(1); }
console.log("\n" + pass + " passed, " + fail + " failed");
