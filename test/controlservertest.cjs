// Test control-server HTTP layer (spec §7.1).
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
let pass = 0, fail = 0;
function check(n, c) { console.log((c ? "PASS ✓ " : "FAIL ✗ ") + n); c ? pass++ : fail++; }
function httpReq(method, url, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ method, host: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {} }, (res) => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
    if (body) req.write(body);
    req.end();
  });
}
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-"));
  for (const d of ["control", "reader", "novels", "wallpapers", "wallpapers-thumb", "wallpapers-video"])
    fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, "control", "index.html"), "<!doctype html><title>cc</title>");
  fs.writeFileSync(path.join(root, "reader", "index.html"), "<!doctype html><title>r</title>");
  const { createServer } = require("../lib/control-server.cjs");
  const picker = require("net").createServer(); await new Promise(r => picker.listen(0, "127.0.0.1", r));
  const port = picker.address().port; await new Promise(r => picker.close(r));
  const srv = await createServer({ root, port, host: "127.0.0.1" });
  const base = "http://127.0.0.1:" + srv.port;
  try {
    // /control (no slash) -> 302 /control/ (教训 18a)
    const redir = await httpReq("GET", base + "/control");
    check("/control -> 302", redir.status === 302);
    check("/control redirects to /control/", (redir.headers.location || "").indexOf("/control/") !== -1);
    // /control/ serves html
    const cc = await httpReq("GET", base + "/control/");
    check("/control/ returns html", cc.status === 200 && cc.body.indexOf("<title>") !== -1);
    // / (root) -> 302 /control/
    const rootRedir = await httpReq("GET", base + "/");
    check("/ -> 302 /control/", rootRedir.status === 302 && (rootRedir.headers.location || "").indexOf("/control/") !== -1);
    // /api/status: shape + probeErrors array (探查失败不致命)
    const st = JSON.parse((await httpReq("GET", base + "/api/status")).body);
    check("/api/status returns object", st && typeof st === "object");
    check("/api/status has _meta.probeErrors", Array.isArray(st._meta && st._meta.probeErrors));
    // /api/action unknown -> 400
    const bad = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "bogus" }));
    check("/api/action unknown -> 400", bad.status === 400);
    // /api/action missing body -> 400
    const bad2 = await httpReq("POST", base + "/api/action", "not json{");
    check("/api/action bad json -> 400", bad2.status === 400);
    // reader still served (兼容)
    const rd = await httpReq("GET", base + "/reader/");
    check("/reader/ still served (兼容)", rd.status === 200 && rd.body.indexOf("<title>") !== -1);
  } finally { srv.close(); }
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
})();
