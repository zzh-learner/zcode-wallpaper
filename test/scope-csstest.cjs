// Mirror consistency: reader/lib/scope-css.js must behave identically to lib/epub.cjs scopeCss.
// Same inputs, same outputs (lesson 17). If lib/epub.cjs's scopeCss changes, this test forces
// the reader-side mirror to be updated too.
const srv = require("../lib/epub.cjs");
const web = require("../reader/lib/scope-css.js");
let pass = 0, fail = 0;
function check(n, c) { console.log((c ? "PASS ✓ " : "FAIL ✗ ") + n); c ? pass++ : fail++; }
const cases = [
  "p { color: red; }",
  "body { font-family: serif; }",
  ".x { text-indent: 2em; }",
  "ul li { margin: 0; }",
  "h1, h2 { color: black; }",
  "@media (max-width: 600px) { p { font-size: 14px; } }",
  "#cover { display: none; }",
  "",
  "/* comment */ p { color: blue; }",
  // body/html mapping (must be byte-identical across runtimes)
  "html { font-size: 18px; }",
  "BODY { color: #333; }",
  "body, p { color: red; }",
  "body p { margin: 0; }",
  "body.night { color: #ccc; }",
];
for (const c of cases) {
  check("mirror: " + JSON.stringify(c).slice(0, 30), srv.scopeCss(c, "epub-content") === web.scopeCss(c, "epub-content"));
}
if (fail > 0) { console.error("\n" + fail + " FAILED"); process.exit(1); }
console.log("\n" + pass + " passed, " + fail + " failed");
