// CDP mock server: emulates the /json + WebSocket parts of a Chromium debug
// endpoint enough to exercise inject.cjs end-to-end without a real ZCode.
// Run: node cdp-mock-test.cjs
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

let lastInjectedCss = null;
let injectedState = false; // tracks whether the mock "page" currently has the wallpaper style
let removeCalled = false;

const mockHttp = http.createServer((req, res) => {
  if (req.url === "/json/version") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ Browser: "ZCode-mock", webSocketDebuggerUrl: "ws://127.0.0.1:9998" }));
  } else if (req.url === "/json") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify([
        {
          type: "page",
          title: "ZCode (mock)",
          url: "file:///mock/index.html",
          webSocketDebuggerUrl: "ws://127.0.0.1:9998/page",
        },
      ])
    );
  } else {
    res.writeHead(404).end();
  }
});

const wss = new WebSocketServer({ noServer: true });
mockHttp.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws) => {
  // Tiny CDP over WebSocket: handle Runtime.evaluate only.
  // Simulates a real page: inject/remove expressions update server-side state,
  // and the *verify* expression (sent by inject.cjs after injecting) reads that
  // state back, so inject.cjs's retry+verify logic gets realistic responses.
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.method === "Runtime.evaluate") {
      const expr = msg.params.expression;
      // Verify probe (inject.cjs sends this to confirm the change took effect).
      if (expr.includes("'noeffect'") || expr.includes("'present' : 'gone'")) {
        const isRemoveVerify = expr.includes("'present' : 'gone'");
        const value = isRemoveVerify
          ? (injectedState ? "present" : "gone")
          : (injectedState ? "effect" : "noeffect");
        ws.send(JSON.stringify({ id: msg.id, result: { result: { type: "string", value } } }));
        return;
      }
      // The inject/remove action expression itself.
      const isRemove = expr.includes("return 'removed'");
      let value;
      if (isRemove) {
        value = injectedState ? "removed" : "none";
        injectedState = false;
        removeCalled = true;
      } else {
        injectedState = true; // mark "something was injected"
        lastInjectedCss = true;
        value = "ok";
      }
      ws.send(JSON.stringify({ id: msg.id, result: { result: { type: "string", value } } }));
    } else {
      ws.send(JSON.stringify({ id: msg.id, result: {} }));
    }
  });
});

mockHttp.listen(9998, "127.0.0.1", async () => {
  console.log("[mock] CDP mock on http://127.0.0.1:9998");

  const { execFile } = require("child_process");
  const { promisify } = require("util");
  const execFileP = promisify(execFile);
  let pass = 0,
    fail = 0;
  const run = async (label, args, expectInStdout) => {
    try {
      const { stdout } = await execFileP(process.execPath, ["inject.cjs", ...args], {
        cwd: __dirname,
        env: { ...process.env, ZCODE_DEBUG_PORT: "9998" },
        encoding: "utf8",
      });
      const ok = expectInStdout.every((s) => stdout.includes(s));
      console.log((ok ? "PASS ✓ " : "FAIL ✗ ") + label);
      if (!ok) console.log("   stdout: " + stdout.trim().replace(/\n/g, "\n   "));
      ok ? pass++ : fail++;
      return stdout;
    } catch (e) {
      console.log("FAIL ✗ " + label + " (threw: " + (e.stderr || e.message).split("\n")[0] + ")");
      fail++;
      return "";
    }
  };

  // 1. inject
  await run("inject via mock CDP", [], ["生效", "影响窗口 1"]);
  // 2. list
  await run("list targets", ["--list"], ["ZCode (mock)", "页面目标"]);
  // 3. remove (after inject, mock should report the style gone)
  await run("remove via mock CDP", ["--remove"], ["生效", "影响窗口 1"]);

  console.log("\n[mock] " + pass + " passed, " + fail + " failed.");
  console.log("[mock] an inject was received:", !!lastInjectedCss);
  console.log("[mock] remove was exercised:", removeCalled);

  mockHttp.close();
  wss.close();
  process.exit(fail > 0 ? 1 : 0);
});
