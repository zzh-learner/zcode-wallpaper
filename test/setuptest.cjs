// Self-test for setup.cjs pure functions. Run: node test/setuptest.cjs
const setup = require("../lib/setup.cjs");

let pass = 0,
  fail = 0;
function check(name, cond) {
  console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name);
  cond ? pass++ : fail++;
}

// --- Task 1: version parsing ---
check("parseNodeVersion('v24.16.0') -> 24", setup.parseNodeVersion("v24.16.0") === 24);
check("isNodeVersionOk(24) -> true", setup.isNodeVersionOk(24) === true);
check("isNodeVersionOk(17) -> false", setup.isNodeVersionOk(17) === false);

// --- Task 4: detectZcode returns string or null (not asserting real path) ---
(function () {
  var result = setup.detectZcode();
  check("detectZcode returns string or null", result === null || typeof result === "string");
})();

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail > 0 ? 1 : 0);
