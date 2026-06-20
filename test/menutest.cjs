// Test for lib/menu.cjs renderMenu().
// Verifies the launcher menu has all 12 scenarios + exit, each with a
// Chinese description and a "calls" annotation. Guard against accidental
// menu drift (someone deleting a scenario, breaking the call chain docs, etc.)
//
// Run: node test/menutest.cjs

const { renderMenu, SCENARIOS } = require("../lib/menu.cjs");

let pass = 0,
  fail = 0;
function check(name, cond) {
  console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name);
  cond ? pass++ : fail++;
}

const out = renderMenu();

// --- Structure ---
check("menu is a non-empty string", typeof out === "string" && out.length > 0);
check("menu has banner", out.indexOf("ZCode 壁纸工具箱") !== -1);
check("menu has prompt line", out.indexOf("请输入选项编号:") !== -1);
check("menu has exit option 0", out.indexOf("  0  退出") !== -1);

// --- Exactly 13 scenarios in order ---
check("SCENARIOS has 13 entries", SCENARIOS.length === 13);
check("scenario keys are 1..13", SCENARIOS.map((s) => s.key).join("") === "12345678910111213");

// --- Each scenario present in output with title, desc, calls ---
const requiredCalls = [
  "setup → resize → start-zcode",
  "start-zcode",
  "resize → inject-only",
  "inject-only",
  "remove-wallpaper",
  "setup",
  "start-zcode(video)",
  "inject-only(video)",
  "start-transparent",
  "transparent",
  "reader-server",
  "reader-help",
  "control-center",
];
SCENARIOS.forEach((s, i) => {
  check("scenario " + s.key + " title in output", out.indexOf(s.title) !== -1);
  check("scenario " + s.key + " desc in output", out.indexOf(s.desc) !== -1);
  check(
    "scenario " + s.key + " calls annotation correct",
    s.calls === requiredCalls[i] && out.indexOf(s.calls) !== -1
  );
});

// --- Call-chain coverage: every underlying script appears at least once ---
["setup", "resize", "start-zcode", "inject-only", "remove-wallpaper", "start-transparent", "transparent", "reader-server", "reader-help", "control-center"].forEach((name) => {
  check("calls mention " + name, out.indexOf(name) !== -1);
});

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail > 0 ? 1 : 0);
