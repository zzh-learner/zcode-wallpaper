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

// === readState / writeState (spec §4.4) ===
var fs = require("fs"), os = require("os"), path = require("path");
var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rotate-"));
var statePath = path.join(tmpDir, rotate.STATE_FILENAME);

// readState on missing file -> { running: false }
check("readState: missing file -> { running: false }", rotate.readState(statePath).running === false);

// writeState then readState round-trips
rotate.writeState(statePath, {
  running: true, mode: "image", intervalMs: 300000, lastSwitchAt: 1718,
  nextSwitchAt: 2000, lastFile: "a.jpg", pid: 123, poolSize: 5, consecutiveFailures: 0,
});
var rd = rotate.readState(statePath);
check("readState: round-trip running", rd.running === true);
check("readState: round-trip mode", rd.mode === "image");
check("readState: round-trip intervalMs", rd.intervalMs === 300000);
check("readState: round-trip lastFile", rd.lastFile === "a.jpg");
check("readState: round-trip pid", rd.pid === 123);
check("readState: round-trip poolSize", rd.poolSize === 5);

// writeState overwrites (not merges) — new values replace old
rotate.writeState(statePath, { running: false });
check("writeState: overwrites running", rotate.readState(statePath).running === false);
check("writeState: overwrite drops old fields (no mode)", rotate.readState(statePath).mode === undefined);

// readState on corrupt JSON -> { running: false } (no throw)
fs.writeFileSync(statePath, "{ not valid json");
check("readState: corrupt json -> { running: false } no throw", rotate.readState(statePath).running === false);

// readState on null/empty path -> { running: false } no throw
check("readState: null path -> { running: false }", rotate.readState(null).running === false);

// cleanup
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
