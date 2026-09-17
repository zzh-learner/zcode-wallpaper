// E2E for the ui-glass-tune chain (spec 2026-09-16-ui-glass-tune §7, layer 3).
// Proves the full "slider backend equivalent -> server -> CDP -> page style"
// path WITHOUT the GUI:
//   temp server (port 0) -> POST /api/uitune (sidebar 55/12) -> assert
//   saved/applied/affected>=1 -> CDP probe the real ZCode main page for
//   #zcode-user-ui-tune containing rgba(24,24,28,0.55) + blur(12px) -> POST
//   all-zero -> assert applied:true and the style element removed ->
//   server.close(). Any failed assertion -> exit 1; all OK -> exit 0.
//
// CDP access goes through lib/cdp.cjs neutral plumbing only (listTargets /
// connect) — same shape as .superpowers/.../wp-probe.cjs. The temp server's
// blankfix/entry sync timers are cleaned up by inst.close() and are idempotent
// with the user's live server loops (harmless overlap by design).
//
// Side effect (in-contract): the POSTs write the real <root>/ui-tune.json.
// This script ends with the all-zero (default) config on disk; the caller
// (Task 7 Step 2) overwrites it with the non-default handoff config after.
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..");
const { createServer } = require(path.join(ROOT, "lib", "control-server.cjs"));
const cdp = require(path.join(ROOT, "lib", "cdp.cjs"));
const uiTune = require(path.join(ROOT, "lib", "ui-tune.cjs"));

let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log("OK   " + name);
  } else {
    failures++;
    console.log("FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra).slice(0, 300) : ""));
  }
}

function postJson(port, pathname, body) {
  return fetch("http://127.0.0.1:" + port + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

// Probe every app.asar page target (the ZCode main renderer) for the tune
// layer. Returns {present, text} — present=true if ANY page has the element.
async function probeTuneLayer() {
  const targets = await cdp.listTargets();
  const pages = targets.filter((t) => /app\.asar/.test(t.url || ""));
  let present = false;
  let text = "";
  for (const t of pages) {
    const { ws, call } = await cdp.connect(t.webSocketDebuggerUrl);
    try {
      const r = await call("Runtime.evaluate", {
        expression:
          "(function(){var e=document.getElementById('zcode-user-ui-tune');" +
          "return JSON.stringify({present:!!e,text:e?e.textContent:null});})()",
        returnByValue: true,
      });
      const o = JSON.parse(r.result.value);
      if (o.present) { present = true; text = o.text || ""; }
    } finally {
      try { ws.close(); } catch (e) { /* ignore */ }
    }
  }
  return { present: present, text: text, pages: pages.length };
}

function makeConfig(sidebar, input) {
  return {
    version: 1,
    regions: {
      sidebar: sidebar,
      chat: { alpha: 0, blur: 0 },
      input: input,
      topbar: { alpha: 0, blur: 0 },
    },
  };
}

async function main() {
  // ---- A. temp server on an ephemeral port (never fights the user's 17890)
  const inst = await createServer({ root: ROOT, port: 0, host: "127.0.0.1" });
  check("A. temp server listening on ephemeral port", typeof inst.port === "number" && inst.port > 0, inst.port);

  // ---- B. POST sidebar {alpha:55, blur:12}, everything else zero
  const r1 = await postJson(inst.port, "/api/uitune", makeConfig({ alpha: 55, blur: 12 }, { alpha: 0, blur: 0 }));
  check("B1. POST #1 saved:true", r1.saved === true, r1);
  check("B2. POST #1 applied:true", r1.applied === true, r1);
  check("B3. POST #1 affected>=1", typeof r1.affected === "number" && r1.affected >= 1, r1);

  // ---- C. CDP probe: the layer really landed on the main page
  const p1 = await probeTuneLayer();
  check("C1. tune layer present on main page", p1.present === true, p1);
  check("C2. layer css contains rgba(24,24,28,0.55)", p1.text.indexOf("rgba(24,24,28,0.55)") !== -1, p1.text.slice(0, 200));
  check("C3. layer css contains blur(12px)", p1.text.indexOf("blur(12px)") !== -1, p1.text.slice(0, 200));

  // ---- C+. GET roundtrip: the atomic write really landed on disk
  const got = await fetch("http://127.0.0.1:" + inst.port + "/api/uitune").then((r) => r.json());
  const disk = uiTune.readConfigFile(path.join(ROOT, uiTune.CONFIG_FILENAME));
  check("C4. GET returns saved sidebar 55/12", got && got.config && got.config.regions.sidebar.alpha === 55 && got.config.regions.sidebar.blur === 12, got);
  check("C5. disk file matches (sidebar 55/12)", disk.config.regions.sidebar.alpha === 55 && disk.config.regions.sidebar.blur === 12, disk.config);

  // ---- D. POST all-zero -> applied:true AND the style element removed
  const r2 = await postJson(inst.port, "/api/uitune", makeConfig({ alpha: 0, blur: 0 }, { alpha: 0, blur: 0 }));
  check("D1. POST #2 (all-zero) applied:true", r2.applied === true, r2);
  check("D2. POST #2 isDefault:true", r2.isDefault === true, r2);
  const p2 = await probeTuneLayer();
  check("D3. tune layer removed from main page", p2.present === false, p2);

  // ---- E. tear down the temp server (clears its blankfix/entry timers)
  inst.close();
  try { if (inst.server && inst.server.closeAllConnections) inst.server.closeAllConnections(); } catch (e) { /* ignore */ }
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 2000); // hard ceiling: never hang the E2E on teardown
    try { inst.server.once("close", () => { clearTimeout(t); resolve(); }); }
    catch (e) { clearTimeout(t); resolve(); }
  });
  console.log("E. temp server closed");

  if (failures > 0) {
    console.log("E2E FAILED: " + failures + " assertion(s) red");
    process.exit(1);
  }
  console.log("OK e2e-uitune: all assertions passed");
}

main().catch((e) => {
  console.log("E2E ERROR: " + (e && e.message));
  process.exit(1);
});
