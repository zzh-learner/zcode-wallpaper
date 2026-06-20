// Test lib/rotate.cjs pure helpers (spec §9).
const rotate = require("../lib/rotate.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// === pickRandomExcluding (spec §4.3) ===
check("pick: empty pool -> null", rotate.pickRandomExcluding([], "x") === null);
check("pick: empty pool no last -> null", rotate.pickRandomExcluding([], null) === null);
check("pick: single-element pool returns that element (no exclusion)", rotate.pickRandomExcluding(["only.jpg"], "only.jpg") === "only.jpg");
check("pick: single-element pool no last -> that element", rotate.pickRandomExcluding(["only.jpg"], null) === "only.jpg");
check("pick: two-element pool excludes last", rotate.pickRandomExcluding(["a.jpg", "b.jpg"], "a.jpg") === "b.jpg");
check("pick: two-element pool excludes last (other)", rotate.pickRandomExcluding(["a.jpg", "b.jpg"], "b.jpg") === "a.jpg");
// lastFile not in pool (user deleted it) -> fall back to whole pool, must not return null
var r = rotate.pickRandomExcluding(["a.jpg", "b.jpg", "c.jpg"], "deleted.jpg");
check("pick: lastFile not in pool -> returns a pool member", ["a.jpg", "b.jpg", "c.jpg"].indexOf(r) !== -1);
// determinism: when only one candidate after exclusion, it's that one
check("pick: three-element pool excludes last -> one of the other two", (function () {
  var got = rotate.pickRandomExcluding(["a", "b", "c"], "b");
  return got === "a" || got === "c";
})());

// === parseInterval (spec §4.3: clamp [10000, 86400000], default fallback) ===
check("parse: valid 60000 -> 60000", rotate.parseInterval("60000", 300000) === 60000);
check("parse: valid number string -> number", rotate.parseInterval("120000", 300000) === 120000);
check("parse: undefined -> default", rotate.parseInterval(undefined, 300000) === 300000);
check("parse: empty string -> default", rotate.parseInterval("", 300000) === 300000);
check("parse: non-numeric -> default", rotate.parseInterval("abc", 300000) === 300000);
check("parse: below floor (5000) -> clamped to 10000", rotate.parseInterval("5000", 300000) === 10000);
check("parse: exactly floor (10000) -> 10000", rotate.parseInterval("10000", 300000) === 10000);
check("parse: above ceiling (99999999) -> clamped to 86400000", rotate.parseInterval("99999999", 300000) === 86400000);
check("parse: exactly ceiling (86400000) -> 86400000", rotate.parseInterval("86400000", 300000) === 86400000);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
