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

// === classifyTransparent: spec §10 状态机纯分类 ===
// psResult = {found, layered, alpha, hwnd}, ambiguous = 多候选无法确定
check("classify: layered alpha<255 -> enabled true", status.classifyTransparent({found:true,layered:true,alpha:199}, false).enabled === true);
check("classify: layered alpha<255 -> opacityPct 78", status.classifyTransparent({found:true,layered:true,alpha:199}, false).opacityPct === 78);
check("classify: layered alpha 255 -> enabled false", status.classifyTransparent({found:true,layered:true,alpha:255}, false).enabled === false);
check("classify: not layered -> enabled false", status.classifyTransparent({found:true,layered:false,alpha:0}, false).enabled === false);
check("classify: not found + ambiguous -> unknown", status.classifyTransparent({found:false}, true).enabled === "unknown");
check("classify: not found + not ambiguous -> false", status.classifyTransparent({found:false}, false).enabled === false);

// === snapshot() with tmp project root (no ZCode on 9222 in test env) ===
const fs = require("fs"), os = require("os"), path = require("path");
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-root-"));
  for (const d of ["wallpapers", "wallpapers-thumb", "wallpapers-video", "novels"]) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  fs.writeFileSync(path.join(root, "wallpapers", "a.jpg"), "x");
  fs.writeFileSync(path.join(root, "novels", "b.txt"), "x");
  fs.mkdirSync(path.join(root, "node_modules", "sharp"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "sharp", "package.json"), "{}");
  fs.mkdirSync(path.join(root, "node_modules", "ws"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "ws", "package.json"), "{}");

  const s = await status.snapshot({ root, transparentHwnd: null });
  check("snapshot resources counts images", s.resources.images === 1);
  check("snapshot resources counts novels", s.resources.novels === 1);
  check("snapshot resources thumbs 0", s.resources.thumbs === 0);
  check("snapshot deps sharp true", s.resources.deps.sharp === true);
  check("snapshot deps ws true", s.resources.deps.ws === true);
  // zcode: either {running:true,...} (ZCode up) or null (CDP down). Either way
  // it must NOT crash. Don't assume CDP down — test env may have ZCode running.
  check("snapshot zcode is object-or-null (no crash)", s.zcode === null || (s.zcode && typeof s.zcode.running === "boolean"));
  check("snapshot _meta always has probeErrors array", Array.isArray(s._meta.probeErrors));
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
})();
