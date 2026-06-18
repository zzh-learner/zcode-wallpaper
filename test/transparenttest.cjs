// Test for lib/windowselect.cjs — the pure window-selection rule shared
// with lib/transparent.ps1 (which does the real Win32 work; this is the
// JS mirror so the rule can be unit-tested, see spec §8.1).
//
// Guards against rule drift: if someone changes PS to pick "first window"
// instead of "area-largest", or forgets the pid/visible/toplevel filters,
// these tests catch it (the JS mirror would also need to change, forcing
// a spec revisit).
//
// Run: node test/transparenttest.cjs

const { selectMainWindow } = require("../lib/windowselect.cjs");

let pass = 0,
  fail = 0;
function check(name, cond) {
  console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name);
  cond ? pass++ : fail++;
}

const PIDS = new Set([1234]);

// --- single candidate: auto-pick ---
check(
  "single candidate is auto-picked",
  selectMainWindow(PIDS, [
    { hwnd: 1, pid: 1234, className: "Chrome_WidgetWin_1", title: "ZCode", width: 800, height: 600, visible: true, toplevel: true },
  ]).hwnd === 1
);

// --- pid filter ---
check(
  "window with wrong pid is filtered out -> null",
  selectMainWindow(PIDS, [
    { hwnd: 2, pid: 9999, className: "X", title: "other", width: 800, height: 600, visible: true, toplevel: true },
  ]) === null
);

// --- visible filter ---
check(
  "non-visible window is filtered out -> null",
  selectMainWindow(PIDS, [
    { hwnd: 3, pid: 1234, className: "X", title: "hidden", width: 800, height: 600, visible: false, toplevel: true },
  ]) === null
);

// --- toplevel filter ---
check(
  "non-toplevel window (child/owned) is filtered out -> null",
  selectMainWindow(PIDS, [
    { hwnd: 4, pid: 1234, className: "X", title: "child", width: 800, height: 600, visible: true, toplevel: false },
  ]) === null
);

// --- zero-area filter ---
check(
  "zero-size window is filtered out -> null",
  selectMainWindow(PIDS, [
    { hwnd: 5, pid: 1234, className: "X", title: "zero", width: 0, height: 0, visible: true, toplevel: true },
  ]) === null
);

// --- empty input ---
check("empty windows list -> null", selectMainWindow(PIDS, []) === null);

// --- ambiguous: multiple candidates -> {ambiguous, candidates} sorted desc ---
const amb = selectMainWindow(PIDS, [
  { hwnd: 10, pid: 1234, className: "A", title: "small",  width: 400, height: 300, visible: true, toplevel: true },
  { hwnd: 11, pid: 1234, className: "B", title: "big",    width: 1200, height: 800, visible: true, toplevel: true },
  { hwnd: 12, pid: 1234, className: "C", title: "medium", width: 800, height: 600, visible: true, toplevel: true },
]);
check("multiple candidates -> ambiguous result", amb && amb.ambiguous === true);
check(
  "ambiguous candidates sorted by area desc",
  amb && amb.candidates.map((c) => c.hwnd).join(",") === "11,12,10"
);

// --- pids can be an array or a Set ---
check(
  "pids accepts array (not just Set)",
  selectMainWindow([1234], [
    { hwnd: 20, pid: 1234, className: "X", title: "x", width: 100, height: 100, visible: true, toplevel: true },
  ]).hwnd === 20
);

// --- mixed: one valid + some noise -> single valid auto-picked (NOT ambiguous) ---
check(
  "one valid + invisible noise -> single auto-pick, not ambiguous",
  selectMainWindow(PIDS, [
    { hwnd: 30, pid: 1234, className: "X", title: "main", width: 800, height: 600, visible: true, toplevel: true },
    { hwnd: 31, pid: 1234, className: "X", title: "hidden-noise", width: 2000, height: 2000, visible: false, toplevel: true },
  ]).hwnd === 30
);

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail > 0 ? 1 : 0);
