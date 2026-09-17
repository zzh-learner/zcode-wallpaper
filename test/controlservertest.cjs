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
  // applyTune stub (预检裁决): 第一次 reject(降级分支), 第二次 resolve(字段映射)
  let applyCalls = 0;
  const srv = await createServer({ root, port, host: "127.0.0.1",
    applyTune: function () {
      applyCalls++;
      if (applyCalls === 1) return Promise.reject(new Error("no cdp in test"));
      return Promise.resolve({ affected: 2, total: 3 });
    } });
  const base = "http://127.0.0.1:" + srv.port;
  try {
    // /control (no slash) -> 302 /control/ (教训 18a)
    const redir = await httpReq("GET", base + "/control");
    check("/control -> 302", redir.status === 302);
    check("/control redirects to /control/", (redir.headers.location || "").indexOf("/control/") !== -1);
    // bookmark: /control/go -> 302 /control/go.html (spec §3 server 改动)
    fs.writeFileSync(path.join(root, "control", "go.html"), "<!doctype html><title>go</title>");
    const goRedir = await httpReq("GET", base + "/control/go");
    check("/control/go -> 302", goRedir.status === 302);
    check("/control/go redirects to /control/go.html", (goRedir.headers.location || "").indexOf("/control/go.html") !== -1);
    // /control/go.html served as static (existing /control/ branch covers it).
    // MUST assert Content-Type text/html — 真机抓到 guessMime 漏 .html 致 octet-stream,
    // webview 把 go.html 当下载 (用户报 "点书签让我保存 go.html"). 只验 body 有 <title>
    // 抓不到 MIME 错 (内容对但浏览器下载). 教训 12: 跨进程胶水 (server MIME ↔ 浏览器) 必验响应头.
    const goHtml = await httpReq("GET", base + "/control/go.html");
    check("/control/go.html -> 200 html", goHtml.status === 200 && goHtml.body.indexOf("<title>") !== -1);
    check("/control/go.html -> Content-Type text/html", (goHtml.headers["content-type"] || "").indexOf("text/html") !== -1);
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
    // === rotate actions (spec §6) ===
    // stopRotate with nothing running -> 200 accepted
    const stop1 = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "stopRotate" }));
    check("stopRotate (nothing running) -> 200", stop1.status === 200);
    check("stopRotate -> accepted true", JSON.parse(stop1.body).accepted === true);
    // startRotateImage with a tiny interval -> 200 + jobId (rotates wallpapers-thumb which is empty here, so rotate child will exit 1, but action dispatch still accepted)
    const start1 = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "startRotateImage", intervalMs: 60000 }));
    check("startRotateImage -> 200", start1.status === 200);
    check("startRotateImage -> jobId present", typeof JSON.parse(start1.body).jobId === "string");
    // give child a moment to start + exit (empty pool)
    await new Promise(r => setTimeout(r, 300));
    // stopRotate cleans up (child already dead from empty pool, but no error)
    const stop2 = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "stopRotate" }));
    check("stopRotate after start -> 200", stop2.status === 200);
    // bad interval (NaN string) -> still accepted, server uses default (doesn't crash)
    const start2 = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "startRotateVideo", intervalMs: "notanumber" }));
    check("startRotateVideo bad interval -> 200 (default used)", start2.status === 200);
    await new Promise(r => setTimeout(r, 300));
    const stop3 = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "stopRotate" }));
    check("stopRotate after video start -> 200", stop3.status === 200);

    // === video mute/unmute actions (spec §4.5) ===
    // 这些 action 走即时 CDP 写路径（非 spawn/jobId）。测试环境 9222 行为不可控
    // （可能有别的服务监听），所以不假设 accepted 的值，只验证：
    // ① action 被正确识别（不是 400 unknown）
    // ② 响应是即时结构 {accepted, ...} 而非 {jobId}（证明走的是 mute 分支不是 spawn）
    // ③ 不返回 500（CDP 失败应转 {accepted:false}）
    const muteRes = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "muteVideo" }));
    check("muteVideo -> 200 (not 400/500)", muteRes.status === 200);
    var muteJson = JSON.parse(muteRes.body);
    check("muteVideo -> has accepted field", typeof muteJson.accepted === "boolean");
    check("muteVideo -> NO jobId (instant path, not spawn)", typeof muteJson.jobId === "undefined");

    const unmuteRes = await httpReq("POST", base + "/api/action", JSON.stringify({ action: "unmuteVideo" }));
    check("unmuteVideo -> 200 (not 400/500)", unmuteRes.status === 200);
    var unmuteJson = JSON.parse(unmuteRes.body);
    check("unmuteVideo -> has accepted field", typeof unmuteJson.accepted === "boolean");
    check("unmuteVideo -> NO jobId (instant path, not spawn)", typeof unmuteJson.jobId === "undefined");

    // === hindsight 管理路由（self-hosted 模式）===
    // 读真机的 ~/.hindsight/coding-agent.json + 探真实服务（本机 9077 可能开也可能关），
    // 断言必须机况无关：结构 + 优雅降级，不假设 running/banks 的值。
    // ⚠ 红线：POST /api/hindsight/server/stop 不在这里测 —— 会端口杀掉本机真实
    // 记忆服务。写路径逻辑由 hindsighttest.cjs 纯函数覆盖（parseNetstatPids /
    // startServer 拒非法 profile）。
    const hsStatus = await httpReq("GET", base + "/api/hindsight/status");
    check("/api/hindsight/status -> 200", hsStatus.status === 200);
    var hsStatusJson = JSON.parse(hsStatus.body);
    check("hindsight status: running boolean", typeof hsStatusJson.running === "boolean");
    check("hindsight status: serverMode + apiUrl + profile", typeof hsStatusJson.serverMode === "string"
      && typeof hsStatusJson.apiUrl === "string" && typeof hsStatusJson.profile === "string");
    check("hindsight status: embedAvailable boolean + paths", typeof hsStatusJson.embedAvailable === "boolean"
      && hsStatusJson.paths && typeof hsStatusJson.paths.daemonLog === "string");

    const hsCfg = await httpReq("GET", base + "/api/hindsight/config");
    check("/api/hindsight/config -> 200", hsCfg.status === 200);
    var hsCfgJson = JSON.parse(hsCfg.body);
    check("hindsight config: items array with key/group/source", Array.isArray(hsCfgJson.items)
      && hsCfgJson.items.length > 0 && hsCfgJson.items.every(i => i.key && i.group && i.source));
    check("hindsight config: exists boolean", typeof hsCfgJson.exists === "boolean");
    // 敏感字段必须脱敏（apiToken 条目 + raw 里任何 *key* 字样；机况无关——有则必脱）
    const tokItem = hsCfgJson.items.find(i => i.key === "apiToken");
    if (tokItem && typeof tokItem.value === "string" && tokItem.value !== "") {
      check("hindsight config: apiToken masked", tokItem.value.indexOf("configured") === 0);
    }
    if (hsCfgJson.raw && hsCfgJson.raw.llm && typeof hsCfgJson.raw.llm.apiKey === "string" && hsCfgJson.raw.llm.apiKey !== "") {
      check("hindsight config: raw llm.apiKey masked", hsCfgJson.raw.llm.apiKey.indexOf("configured") === 0);
    }

    const hsBanks = await httpReq("GET", base + "/api/hindsight/banks");
    check("/api/hindsight/banks -> 200 (graceful up or down)", hsBanks.status === 200);
    var hsBanksJson = JSON.parse(hsBanks.body);
    check("hindsight banks: banks array XOR error string", Array.isArray(hsBanksJson.banks)
      ? hsBanksJson.banks.every(b => typeof b.bank_id === "string")
      : typeof hsBanksJson.error === "string");

    const hsLogs = await httpReq("GET", base + "/api/hindsight/logs?lines=5");
    check("/api/hindsight/logs -> 200", hsLogs.status === 200);
    var hsLogsJson = JSON.parse(hsLogs.body);
    check("hindsight logs: pluginLog + daemonLog shapes", hsLogsJson.pluginLog && typeof hsLogsJson.pluginLog.path === "string"
      && Array.isArray(hsLogsJson.pluginLog.lines) && hsLogsJson.daemonLog && typeof hsLogsJson.daemonLog.path === "string");
    check("hindsight logs: lines param clamped (max 5)", hsLogsJson.pluginLog.lines.length <= 5 && hsLogsJson.daemonLog.lines.length <= 5);

    const hs404 = await httpReq("GET", base + "/api/hindsight/nope");
    check("/api/hindsight/nope -> 404", hs404.status === 404);

    // ---- /api/uitune (玻璃调节, spec 2026-09-16 §7 第二层) ----
    const tunePath = path.join(root, "ui-tune.json");
    const g0 = await httpReq("GET", base + "/api/uitune");
    check("uitune GET: 200 default", g0.status === 200);
    const g0j = JSON.parse(g0.body);
    check("uitune GET: no file -> isDefault true", g0j.isDefault === true && g0j.config.version === 1);
    check("uitune GET: all regions zero",
      ["sidebar", "chat", "input", "topbar", "panel"].every(function (k) {
        return g0j.config.regions[k].alpha === 0 && g0j.config.regions[k].blur === 0;
      }));
    const p1 = await httpReq("POST", base + "/api/uitune",
      JSON.stringify({ version: 1, regions: { sidebar: { alpha: 55, blur: 12 } } }));
    check("uitune POST: 200 saved", p1.status === 200);
    const p1j = JSON.parse(p1.body);
    check("uitune POST: saved true + isDefault false", p1j.saved === true && p1j.isDefault === false);
    check("uitune POST: applyTune reject -> applied:false + reason (降级分支)", p1j.applied === false && typeof p1j.reason === "string");
    check("uitune POST: file written to disk", fs.existsSync(tunePath));
    const onDisk = JSON.parse(fs.readFileSync(tunePath, "utf8"));
    check("uitune POST: disk content correct", onDisk.regions.sidebar.alpha === 55 && onDisk.regions.sidebar.blur === 12);
    const g1 = await httpReq("GET", base + "/api/uitune");
    check("uitune GET after POST: round-trip", JSON.parse(g1.body).config.regions.sidebar.alpha === 55);
    const p2 = await httpReq("POST", base + "/api/uitune",
      JSON.stringify({ version: 1, regions: { sidebar: { alpha: 999, blur: -3 } } }));
    const p2j = JSON.parse(p2.body);
    const onDisk2 = JSON.parse(fs.readFileSync(tunePath, "utf8"));
    check("uitune POST: clamp on write (999->100, -3->0)", p2.status === 200 &&
      onDisk2.regions.sidebar.alpha === 100 && onDisk2.regions.sidebar.blur === 0);
    check("uitune POST: applyTune resolve -> applied:true + affected/total 映射", p2j.applied === true && p2j.affected === 2 && p2j.total === 3);
    const p3 = await httpReq("POST", base + "/api/uitune", "not json{");
    check("uitune POST: bad json -> 400 (不触 applyTune)", p3.status === 400);

    // cleanup any .rotate.json the test wrote into tmp root
    try { require("fs").unlinkSync(path.join(root, ".rotate.json")); } catch (e) {}
  } finally { srv.close(); }
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
})();
