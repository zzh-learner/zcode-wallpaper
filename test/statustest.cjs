// Test lib/status.cjs pure helpers (spec §7.1).
const status = require("../lib/status.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// alphaToOpacityPct / opacityPctToAlpha
check("alpha 0 -> 0%", status.alphaToOpacityPct(0) === 0);
check("alpha 255 -> 100%", status.alphaToOpacityPct(255) === 100);
check("alpha 199 -> 78% (round)", status.alphaToOpacityPct(199) === 78);
check("opacity 0 -> alpha 0", status.opacityPctToAlpha(0) === 0);
check("opacity 100 -> alpha 255", status.opacityPctToAlpha(100) === 255);
check("opacity 78 -> alpha 199 (round)", status.opacityPctToAlpha(78) === 199);

// mergeProbeResults: null items don't pollute, go to probeErrors
const merged = status.mergeProbeResults({
  zcode: { running: true, pid: 1 },
  wallpaper: null,           // probe failed
  transparent: { enabled: true, opacityPct: 78 },
  reader: null,
  resources: { images: 5 },
});
check("merge keeps non-null zcode", merged.zcode.running === true);
check("merge null wallpaper -> null field", merged.wallpaper === null);
check("merge records probeErrors for nulls", Array.isArray(merged._meta.probeErrors) && merged._meta.probeErrors.length === 2);
check("merge _meta.fetchedAt is number", typeof merged._meta.fetchedAt === "number");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
