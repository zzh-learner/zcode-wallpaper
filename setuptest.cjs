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

// --- Task 2: toFileUrl ---
check(
  "toFileUrl('C:\\\\a\\\\b\\\\wallpapers') -> file:///C:/a/b/wallpapers",
  setup.toFileUrl("C:\\a\\b\\wallpapers") === "file:///C:/a/b/wallpapers"
);

// --- Task 3: placeholder replacement + idempotency ---
(function () {
  var withPh = 'background-image: url("__WALLPAPER__/wallpaper.svg");';
  var replaced = setup.replacePlaceholder(withPh, "file:///C:/proj/wallpapers");
  check(
    "replacePlaceholder fills the placeholder",
    replaced === 'background-image: url("file:///C:/proj/wallpapers/wallpaper.svg");'
  );
  var already = 'background-image: url("file:///C:/proj/wallpapers/DSC.jpg");';
  check(
    "replacePlaceholder is idempotent when placeholder gone",
    setup.replacePlaceholder(already, "file:///X") === already
  );
  check("hasPlaceholder true when present", setup.hasPlaceholder(withPh) === true);
  check("hasPlaceholder false when absent", setup.hasPlaceholder(already) === false);
})();

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail > 0 ? 1 : 0);
