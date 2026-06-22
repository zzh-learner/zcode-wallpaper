// CDP mock server: emulates the /json + WebSocket parts of a Chromium debug
// endpoint enough to exercise inject.cjs end-to-end without a real ZCode.
// Run: node test/cdp-mock-test.cjs
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const path = require("path");

// Video element id, mirrored from inject.cjs so the video->image cleanup
// assertion (test 5) can reference it without hardcoding the string.
const { VIDEO_EL_ID } = require("../lib/inject.cjs");

let lastInjectedCss = null;
let injectedState = false; // tracks whether the mock "page" currently has the wallpaper style
let removeCalled = false;
let lastExpression = ""; // the most recent non-verify evaluate expression (for video assertions)

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
      // Match the remove-verify sentinels regardless of internal whitespace
      // ('present' : 'gone' vs 'present':'gone') so the mock doesn't break on
      // cosmetic formatting changes to verifyExpression().
      const isRemoveVerify = /'present'\s*:\s*'gone'/.test(expr);
      if (expr.includes("'noeffect'") || isRemoveVerify) {
        const value = isRemoveVerify
          ? (injectedState ? "present" : "gone")
          : (injectedState ? "effect" : "noeffect");
        ws.send(JSON.stringify({ id: msg.id, result: { result: { type: "string", value } } }));
        return;
      }
      // The inject/remove action expression itself.
      // Match the remove sentinel regardless of exact phrasing: the old
      // expression was `return 'removed'`, the current one is
      // `return did?'removed':'none'`. Both contain "'removed'" as a literal
      // the image/video inject expressions never produce.
      const isRemove = expr.includes("'removed'");
      let value;
      if (isRemove) {
        value = injectedState ? "removed" : "none";
        injectedState = false;
        removeCalled = true;
      } else {
        injectedState = true; // mark "something was injected"
        lastInjectedCss = true;
        lastExpression = expr; // keep for the video-mode assertion below
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
  function check(name, cond) {
    console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name);
    cond ? pass++ : fail++;
  }
  const run = async (label, args, expectInStdout) => runEnv(label, args, {}, expectInStdout);
  // runEnv: like run but merges extraEnv into the child process env (used to
  // set ZCODE_WP_VIDEO for the video-mode test without polluting other runs).
  const runEnv = async (label, args, extraEnv, expectInStdout) => {
    try {
      const { stdout } = await execFileP(process.execPath, ["lib/inject.cjs", ...args], {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, ZCODE_DEBUG_PORT: "9998", ...extraEnv },
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

  // 4. inject VIDEO mode. ZCODE_WP_VIDEO points the bypass at a fake path
  //    (inject.cjs doesn't stat it -- it only builds the file URL). The mock
  //    handles this identically to image inject because the video expression
  //    returns 'ok' and its verify probe uses the same 'noeffect'/'effect'
  //    sentinels the mock already recognizes.
  lastExpression = ""; // reset so we can assert on the video expression specifically
  await runEnv(
    "inject video via mock CDP",
    ["--video"],
    { ZCODE_WP_VIDEO: "C:\\fake\\clip.mp4" },
    ["生效", "影响窗口 1"]
  );

  // Video-specific assertion: the expression the mock received must actually
  // be the video builder's output (a real <video> element + the chosen URL),
  // not the image builder's. Guards against MODE routing regressions.
  check("video: mock received <video> element creation", lastExpression.indexOf("createElement('video')") !== -1);
  check("video: mock received the chosen src url", lastExpression.indexOf("clip.mp4") !== -1);
  // The image builder appends "body { background-image: url(" at runtime;
  // the video builder never does (it sets <video src> instead). Note we check
  // for that specific appended rule, NOT the bare word "background-image",
  // which also appears inside the CSS comments embedded in textContent.
  check(
    "video: mock did NOT receive image background-image url rule",
    lastExpression.indexOf("body { background-image: url(") === -1
  );

  // 5. VIDEO -> IMAGE switch (regression for the "still hear audio after
  //    switching to image wallpaper" bug). After a video-mode inject, the
  //    next image-mode inject's expression MUST also reference the video
  //    element id (it removes any leftover <video> so its audio stops).
  //    selftest covers the fake-DOM mechanics; this covers that inject.cjs
  //    actually emits that expression end-to-end via the CDP mock.
  lastExpression = ""; // reset so the next inject's expression is captured
  await run("inject image after video via mock CDP", [], ["生效", "影响窗口 1"]);
  check(
    "video->image: image inject expression references video id (cleanup)",
    lastExpression.indexOf(VIDEO_EL_ID) !== -1
  );
  // Sanity: this really was the image builder, not a stray video re-inject.
  check(
    "video->image: image inject did NOT create a new <video>",
    lastExpression.indexOf("createElement('video')") === -1
  );

  console.log("\n[mock] " + pass + " passed, " + fail + " failed.");
  console.log("[mock] an inject was received:", !!lastInjectedCss);
  console.log("[mock] remove was exercised:", removeCalled);

  mockHttp.close();
  wss.close();
  process.exit(fail > 0 ? 1 : 0);
});
