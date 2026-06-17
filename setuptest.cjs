// Self-test for setup.cjs pure functions. Run: node setuptest.cjs
const setup = require("./setup.cjs");

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

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail > 0 ? 1 : 0);
