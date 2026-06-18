// Test for probe.ps1 — the shared debug-port probe used by start-zcode.bat
// and inject-only.bat.
//
// Regression guard for the bug documented in AGENTS.md:
// "PowerShell 单对象 .Count 是 null". The .bat probe line historically forgot
// to wrap the Where-Object result in @(...). When /json returns exactly ONE
// page target (the common "ZCode already running, one window open" case),
// Where-Object returns the single object, .Count is $null, $null -gt 0 is $false,
// so the probe wrongly exits 2 ("no page yet") and inject.cjs never runs.
//
// Strategy: stand up a fake /json endpoint that returns a single page target,
// run probe.ps1 against it, assert it exits 0. Also covers the multi-target
// and empty-list cases so the fix stays honest.

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

let pass = 0,
  fail = 0;
function check(name, cond) {
  console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name);
  cond ? pass++ : fail++;
}

function runProbe(port) {
  return new Promise((resolve) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "..", "probe.ps1"), "-Port", String(port)],
      { windowsHide: true }
    );
    ps.on("exit", (code) => resolve(code));
    ps.on("error", (e) => resolve({ error: e }));
  });
}

function serve(jsonBody) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/json") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(jsonBody));
      } else {
        res.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  // Case 1: single page target (THE regression case — breaks the buggy version)
  {
    const server = await serve([
      { type: "page", title: "ZCode", url: "file:///x/index.html", webSocketDebuggerUrl: "ws://127.0.0.1/x" },
    ]);
    const port = server.address().port;
    const code = await runProbe(port);
    server.close();
    check("single page target -> probe exits 0 (THE .Count-trap case)", code === 0);
  }

  // Case 2: multiple page targets
  {
    const server = await serve([
      { type: "page", title: "ZCode", url: "file:///x/index.html", webSocketDebuggerUrl: "ws://127.0.0.1/x" },
      { type: "page", title: "ZCode 2", url: "file:///x/index2.html", webSocketDebuggerUrl: "ws://127.0.0.1/y" },
    ]);
    const port = server.address().port;
    const code = await runProbe(port);
    server.close();
    check("multiple page targets -> probe exits 0", code === 0);
  }

  // Case 3: only background/service targets, no page -> exit 2
  {
    const server = await serve([
      { type: "service_worker", title: "sw", url: "file:///x/sw.html", webSocketDebuggerUrl: "ws://127.0.0.1/sw" },
    ]);
    const port = server.address().port;
    const code = await runProbe(port);
    server.close();
    check("no page target -> probe exits 2", code === 2);
  }

  // Case 4: port unreachable -> exit 1
  {
    // port 1 is reserved/unassigned on Windows -> connection refused fast
    const code = await runProbe(1);
    check("unreachable port -> probe exits 1", code === 1);
  }

  console.log("\n" + pass + " passed, " + fail + " failed.");
  process.exit(fail > 0 ? 1 : 0);
})();
