// Targeted test for inject.cjs's retry+verify recovery from cold-start failures.
//
// Reproduces the ORIGINAL bug scenario: during cold start, the first CDP
// connection attempts FAIL (WebSocket handshake rejected because the page
// isn't ready yet). Verifies that inject.cjs's retry loop recovers and the
// wallpaper is eventually applied, exiting 0.
//
// Strategy: a mock that refuses the first 3 WebSocket upgrades (socket.destroy),
// then accepts the 4th and behaves like a real page (verify probe reflects state).

const http = require("http");
const { WebSocketServer } = require("ws");
const { execFile } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const execFileP = promisify(execFile);

const PORT = 9999;
let upgradeCount = 0;
let injectedState = false;

const mockHttp = http.createServer((req, res) => {
  if (req.url === "/json") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify([
        {
          type: "page",
          title: "ZCode (cold-mock)",
          url: "file:///mock/index.html",
          // inject.cjs rewrites ws://localhost/ -> ws://127.0.0.1:PORT/, so this works
          webSocketDebuggerUrl: "ws://127.0.0.1:" + PORT + "/page",
        },
      ])
    );
  } else {
    res.writeHead(404).end();
  }
});

const wss = new WebSocketServer({ noServer: true });
mockHttp.on("upgrade", (req, socket, head) => {
  upgradeCount++;
  if (upgradeCount <= 3) {
    // Simulate cold start: page not ready, WS handshake refused.
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.method === "Runtime.evaluate") {
      const expr = msg.params.expression;
      let value;
      if (expr.includes("'noeffect'")) {
        // verify probe (inject mode)
        value = injectedState ? "effect" : "noeffect";
      } else {
        // inject action
        injectedState = true;
        value = "ok";
      }
      ws.send(JSON.stringify({ id: msg.id, result: { result: { type: "string", value } } }));
    } else {
      ws.send(JSON.stringify({ id: msg.id, result: {} }));
    }
  });
});

mockHttp.listen(PORT, "127.0.0.1", async () => {
  console.log("[retry-test] mock on port " + PORT + " (refuses first 3 WS upgrades)");

  let pass = 0, fail = 0;
  try {
    const { stdout } = await execFileP(process.execPath, ["lib/inject.cjs"], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, ZCODE_DEBUG_PORT: String(PORT) },
      encoding: "utf8",
      timeout: 60000,
    });
    const trimmed = stdout.trim();
    console.log("[retry-test] stdout:\n  " + trimmed.replace(/\n/g, "\n  "));
    const sawRetryRecovery = /第 [2-9] 次生效/.test(trimmed);
    const sawAffected = /影响窗口 1/.test(trimmed);
    if (sawRetryRecovery && sawAffected) {
      console.log("PASS ✓ inject recovered after WS handshake failures (retry worked)");
      pass++;
    } else {
      console.log("FAIL ✗ did not recover via retry. sawRetryRecovery=" + sawRetryRecovery + " sawAffected=" + sawAffected);
      fail++;
    }
  } catch (e) {
    console.log("FAIL ✗ inject.cjs exited non-zero or threw: " + (e.stderr || e.message).split("\n")[0]);
    fail++;
  }
  console.log("\n[retry-test] " + pass + " passed, " + fail + " failed.");
  console.log("[retry-test] total WS upgrade attempts: " + upgradeCount);
  mockHttp.close();
  wss.close();
  process.exit(fail > 0 ? 1 : 0);
});
