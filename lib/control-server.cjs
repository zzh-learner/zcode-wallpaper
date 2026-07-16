// Merged control-center + reader HTTP server (spec §4 A1). Serves /control/ +
// /reader/ static + novel API (migrated verbatim from reader-server.cjs) +
// /api/status + /api/action + /api/job/:id.
//
// Port fixed at 17890 (canonical, spec §5.3 — localStorage binds to origin so
// port drift loses shelf/progress); +1 only as EADDRINUSE fallback.
//
// createServer({ root }) OR createServer({ novelsDir, readerDir }) — the latter
// for backward compat with test/readerservertest.cjs (审查 P2-reader迁移).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const child_process = require("child_process");
const status = require("./status.cjs");
const { detectEncoding, replacementRatio } = require("./reader-codec.cjs");
const { parseTOC, cleanChapterParagraphs } = require("./reader-toc.cjs");
const epubLoad = require("./epub-load.cjs");

const DEFAULT_PORT = 17890;   // canonical, fixed (spec §5.3)
const DEFAULT_HOST = "127.0.0.1";

// ---- novel library (verbatim from reader-server.cjs) ----
function bookIdFor(filename) {
  let h = 5381;
  for (let i = 0; i < filename.length; i++) h = ((h << 5) + h + filename.charCodeAt(i)) | 0;
  return "b" + (h >>> 0).toString(36);
}
async function buildLibrary(novelsDir) {
  const lib = new Map();
  if (!fs.existsSync(novelsDir)) { try { fs.mkdirSync(novelsDir, { recursive: true }); } catch (e) {} }
  let entries = [];
  try { entries = fs.readdirSync(novelsDir); } catch (e) {}
  // txt path: sync, unchanged except for added format:"txt" field (spec §3.3).
  for (const name of entries) {
    if (!/\.txt$/i.test(name)) continue;
    const full = path.join(novelsDir, name);
    let bytes;
    try { bytes = fs.readFileSync(full); } catch (e) { continue; }
    const enc = detectEncoding(bytes);
    let text;
    try { text = new TextDecoder(enc === "utf8" && bytes[0] === 0xEF ? "utf8" : enc).decode(bytes); }
    catch (e) { text = new TextDecoder("gb18030").decode(bytes); }
    if (enc === "utf8" && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const toc = parseTOC(text, name);
    const suspect = replacementRatio(text) > 0.01;
    const id = bookIdFor(name);
    lib.set(id, { id, filename: name, format: "txt", sizeBytes: bytes.length, encoding: enc, encodingSuspect: suspect, toc, text });
  }
  // epub path: async (loadEpub awaits book.opened). Separate loop after the sync
  // txt loop. Skip-on-error for broken/DRM epub (symmetric to txt readFileSync failure).
  for (const name of entries) {
    if (!/\.epub$/i.test(name)) continue;
    const full = path.join(novelsDir, name);
    try {
      const entry = await epubLoad.loadEpub(full);
      const id = bookIdFor(name);
      lib.set(id, Object.assign({ id, filename: name, sizeBytes: fs.statSync(full).size }, entry));
    } catch (e) {
      console.error("[reader] skipping epub " + name + ": " + e.message);
    }
  }
  return lib;
}

function sendJson(res, st, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(st, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function serveStatic(res, full, mime) {
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": mime || "application/octet-stream" });
    res.end(data);
  });
}
function guessMime(rel) {
  if (/\.html?$/i.test(rel)) return "text/html; charset=utf-8";
  if (/\.js$/i.test(rel)) return "text/javascript; charset=utf-8";
  if (/\.css$/i.test(rel)) return "text/css; charset=utf-8";
  if (/\.png$/i.test(rel)) return "image/png";
  if (/\.jpe?g$/i.test(rel)) return "image/jpeg";
  if (/\.gif$/i.test(rel)) return "image/gif";
  if (/\.svg$/i.test(rel)) return "image/svg+xml";
  if (/\.webp$/i.test(rel)) return "image/webp";
  return "application/octet-stream";
}

// ---- action spawn contract (spec §5.2, 审查 P2-1) ----
// Returns [cmd, args, opts] or null for unknown action.
function buildSpawnArgs(root, action, params) {
  const exec = process.execPath;
  const injectCjs = path.join(root, "lib", "inject.cjs");
  const tps = path.join(root, "lib", "transparent.ps1");
  switch (action) {
    case "injectImage":    return [exec, [injectCjs], { cwd: root }];
    case "injectVideo":    return [exec, [injectCjs, "--video"], { cwd: root }];
    case "remove":         return [exec, [injectCjs, "--remove"], { cwd: root }];
    case "startRotateImage": return [exec, [path.join(root, "lib", "rotate.cjs"), "--image",
      "--interval", String((params && params.intervalMs) || 300000)], { cwd: root }];
    case "startRotateVideo": return [exec, [path.join(root, "lib", "rotate.cjs"), "--video",
      "--interval", String((params && params.intervalMs) || 600000)], { cwd: root }];
    case "setTransparent": return ["powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tps, "-Opacity", String((params && params.opacityPct) || 78), "-Json"],
      { cwd: root }];
    case "resize":         return [exec, [path.join(root, "lib", "resize.cjs")], { cwd: root }];
    case "setup":          return [exec, [path.join(root, "lib", "setup.cjs")], { cwd: root }];
    default:               return null;
  }
}

function createServer(opts) {
  return new Promise((resolve, reject) => {
    // The executor is a plain function, so we can't `await` directly in it.
    // Wrap the body in an async IIFE so buildLibrary (now async) can be awaited,
    // while keeping the outer Promise signature callers expect (spec §3.3).
    (async () => {
    // Accept either { root } (control-center) or { novelsDir, readerDir } (reader compat).
    const root = opts.root || path.join(opts.novelsDir, "..");
    const novelsDir = opts.novelsDir || path.join(root, "novels");
    const controlDir = path.join(root, "control");
    const readerDir = opts.readerDir || path.join(root, "reader");
    const startPort = opts.port || DEFAULT_PORT;
    const host = opts.host || DEFAULT_HOST;
    const library = await buildLibrary(novelsDir);

    // action job state (single global lock, spec §5.2)
    let activeJob = null;
    const jobs = new Map();
    let transparentHwnd = null; // remembered from setTransparent -Json (spec §10)
    let rotateChild = null; // rotate watchdog child handle (spec §6.1)
    const rotate = require("./rotate.cjs"); // readState/writeState for stopRotateNow fallback
    const rotateStatePath = path.join(root, rotate.STATE_FILENAME);

    // Stop rotate watchdog. Used by both the stopRotate action and the
    // startRotate* mutual-exclusion guard (single source of kill logic, spec §6.3).
    // 1) if we have the child handle, kill it.
    // 2) else (server restarted, handle lost) but .rotate.json says running +
    //    pid alive -> kill by pid (fallback, spec §8 边界).
    // After kill, the PARENT writes running:false to .rotate.json — we don't rely
    // on the child's SIGTERM handler, because on Windows child.kill() terminates
    // the process WITHOUT delivering SIGTERM, so the child's own shutdown() (which
    // would write running:false) never runs. Single source of truth = parent.
    function stopRotateNow() {
      if (rotateChild) {
        try { rotateChild.kill(); } catch (e) {}
        rotateChild = null;
      } else {
        const st = rotate.readState(rotateStatePath);
        if (st && st.running && st.pid) {
          try { process.kill(st.pid); } catch (e) {}
        }
      }
      // Always overwrite state to running:false (covers both paths + Windows).
      const cur = rotate.readState(rotateStatePath);
      if (cur && cur.running) {
        rotate.writeState(rotateStatePath, Object.assign(cur, { running: false }));
      }
    }

    const server = http.createServer((req, res) => handle(req, res));
    // webview _blank fix: background poll registers strip-script on every
    // external webview target (spec §7). sync failure non-fatal (ZCode down /
    // debug port closed -> blankfix silently no-ops, control-server lives on,
    // mirrors status.cjs "探查失败不致命" philosophy).
    const blankfix = require("./webview-blankfix.cjs");
    const blankfixTimer = setInterval(() => { blankfix.sync().catch(() => {}); }, 3000);
    let tries = 0;
    function tryListen(port) {
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && tries < 5) { tries++; tryListen(port + 1); }
        else reject(err);
      });
      server.listen(port, host, () => resolve({
        server, port: server.address().port, host, library, blankfixTimer,
        close: () => {
          clearInterval(blankfixTimer);
          blankfix.close();
          if (rotateChild) { try { rotateChild.kill(); } catch (e) {} rotateChild = null; }
          server.close();
        },
      }));
    }
    tryListen(startPort);

    async function handle(req, res) {
      const u = new URL(req.url, "http://localhost");
      const p = u.pathname;
      const method = req.method;

      // root + control redirects (教训 18a: no-trailing-slash -> with slash)
      if (p === "/") { res.writeHead(302, { Location: "/control/" }); res.end(); return; }
      if (p === "/control") { res.writeHead(302, { Location: "/control/" }); res.end(); return; }
      // bookmark: /control/go (no .html) -> /control/go.html (same anti-trap as 教训 18a)
      if (p === "/control/go") { res.writeHead(302, { Location: "/control/go.html" }); res.end(); return; }
      if (p === "/control/" || p === "/control/index.html")
        return serveStatic(res, path.join(controlDir, "index.html"), "text/html; charset=utf-8");
      if (p.indexOf("/control/") === 0)
        return serveStatic(res, path.join(controlDir, p.slice("/control/".length)), guessMime(p));

      // reader static (unchanged behavior, spec §5.2 reader 体验不变)
      if (p === "/reader") { res.writeHead(302, { Location: "/reader/" }); res.end(); return; }
      if (p === "/reader/" || p === "/reader/index.html")
        return serveStatic(res, path.join(readerDir, "index.html"), "text/html; charset=utf-8");
      if (p.indexOf("/reader/") === 0)
        return serveStatic(res, path.join(readerDir, p.slice("/reader/".length)), guessMime(p));

      // novel API (verbatim from reader-server.cjs)
      if (p === "/api/books") {
        const list = [];
        for (const b of library.values()) {
          list.push({ id: b.id, filename: b.filename, totalChapters: b.toc.chapters.length,
            hasVolumes: b.toc.volumes.length > 0, encoding: b.encoding, encodingSuspect: b.encodingSuspect });
        }
        return sendJson(res, 200, list);
      }
      let m = /^\/api\/book\/([^/]+)\/toc$/.exec(p);
      if (m) {
        const b = library.get(m[1]);
        if (!b) return sendJson(res, 404, { error: "book not found" });
        return sendJson(res, 200, b.toc);
      }
      m = /^\/api\/book\/([^/]+)\/chapter\/(\d+)$/.exec(p);
      if (m) {
        const b = library.get(m[1]);
        if (!b) return sendJson(res, 404, { error: "book not found" });
        const n = parseInt(m[2], 10);
        if (b.format === "epub") {
          try {
            const ch = await epubLoad.getEpubChapter(b, n, b.id);
            if (!ch) return sendJson(res, 404, { error: "chapter out of range" });
            return sendJson(res, 200, ch);
          } catch (e) {
            return sendJson(res, 500, { error: "epub chapter read failed: " + e.message });
          }
        }
        // txt path (existing logic, +format field)
        const chs = b.toc.chapters;
        if (n < 0 || n >= chs.length) return sendJson(res, 404, { error: "chapter out of range" });
        const c = chs[n];
        const chunk = b.text.slice(c.startOffset, c.endOffset);
        const raw = chunk.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
        const paras = cleanChapterParagraphs(raw, c.title);
        return sendJson(res, 200, { format: "txt", index: n, title: c.title, paragraphs: paras, prev: n > 0 ? n - 1 : null, next: n + 1 < chs.length ? n + 1 : null });
      }
      m = /^\/api\/book\/([^/]+)\/asset$/.exec(p);
      if (m && method === "GET") {
        const b = library.get(m[1]);
        if (!b || b.format !== "epub") { res.writeHead(404); res.end("not found"); return; }
        // URL.searchParams.get already decodes (%2F -> /), so the value matches
        // the OPF-relative whitelist keys directly. No extra decodeURIComponent
        // (that was a redundant double-decode AND it sat outside try/catch, where
        // a malformed %zz query would throw URIError and hang the request — lesson 27).
        const href = u.searchParams.get("href") || "";
        try {
          const asset = await epubLoad.readEpubAsset(b, href);
          if (!asset) { res.writeHead(404); res.end("not found"); return; }
          if (typeof asset.data === "string") {
            res.writeHead(200, { "Content-Type": asset.mime });
            res.end(asset.data);
          } else {
            const buf = Buffer.from(asset.data);
            res.writeHead(200, { "Content-Type": asset.mime, "Content-Length": buf.length });
            res.end(buf);
          }
        } catch (e) { res.writeHead(500); res.end("asset read failed"); return; }
        return;
      }
      m = /^\/api\/book\/([^/]+)\/progress$/.exec(p);
      if (m) return sendJson(res, 200, null);

      // status API (探查失败不致命 — snapshot 内部已处理)
      if (p === "/api/status" && method === "GET") {
        return status.snapshot({ root, serverPort: server.address().port, transparentHwnd })
          .then((s) => sendJson(res, 200, s))
          .catch((e) => sendJson(res, 200, { _meta: { fetchedAt: Date.now(), probeErrors: [{ item: "status", reason: e.message }] } }));
      }

      // action API (spec §5.2: global lock, async spawn, jobId)
      if (p === "/api/action" && method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          let req2;
          try { req2 = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: "bad json" }); }
          // stopRotate: kill child (or pid fallback), no spawn (spec §6.2)
          if (req2.action === "stopRotate") {
            stopRotateNow();
            return sendJson(res, 200, { accepted: true });
          }
          // applySkin/removeSkin: skin subsystem (spec §4.6, §6.1). These use
          // server-side require('./skin-inject.cjs') NOT spawn — theme is a
          // structured object in the request body. applySkin runs wallpaper
          // removal FIRST (mutual exclusion, spec §6.1): spawn inject.cjs
          // --remove, wait for exit, then apply skin. Test env has no ZCode ->
          // skin-inject throws -> {accepted:false} (aligns "探查失败不致命").
          if (req2.action === "applySkin") {
            if (activeJob) return sendJson(res, 409, { accepted: false, reason: "busy", activeJob });
            const skinInject = require("./skin-inject.cjs");
            const skinModel = require("./skin.cjs");
            const theme = req2.theme;
            const vres = skinModel.validateTheme(theme || {});
            if (!vres.ok) return sendJson(res, 400, { accepted: false, error: "invalid theme: " + vres.errors.join("; ") });
            const jobId = "j_" + crypto.randomBytes(3).toString("hex");
            activeJob = jobId;
            jobs.set(jobId, { state: "running", startedAt: Date.now() });
            // mutual exclusion: remove wallpaper first (spawn inject.cjs --remove),
            // then apply skin via require. Both async; resolve job when done.
            (async () => {
              let log = "";
              try {
                // 1) remove wallpaper (mutual exclusion)
                const r = child_process.spawnSync(process.execPath,
                  [path.join(root, "lib", "inject.cjs"), "--remove"], { cwd: root, timeout: 20000 });
                log += "[skin] wallpaper remove rc=" + r.status + "\n";
              } catch (e) { log += "[skin] wallpaper remove failed: " + e.message + "\n"; }
              // 2) apply skin
              try {
                const r2 = await skinInject.applySkin(theme);
                log += "[skin] applied " + r2.affected + "/" + r2.total + " windows\n";
                jobs.set(jobId, { state: r2.affected > 0 ? "done" : "failed", output: log, finishedAt: Date.now() });
              } catch (e) {
                log += "[skin] apply failed: " + e.message + "\n";
                jobs.set(jobId, { state: "failed", output: log, finishedAt: Date.now() });
              }
              activeJob = null;
            })();
            return sendJson(res, 200, { jobId, accepted: true });
          }
          if (req2.action === "removeSkin") {
            if (activeJob) return sendJson(res, 409, { accepted: false, reason: "busy", activeJob });
            const skinInject = require("./skin-inject.cjs");
            const jobId = "j_" + crypto.randomBytes(3).toString("hex");
            activeJob = jobId;
            jobs.set(jobId, { state: "running", startedAt: Date.now() });
            skinInject.removeSkin().then(function (r) {
              jobs.set(jobId, { state: "done", output: "[skin] removed " + r.affected + "/" + r.total, finishedAt: Date.now() });
              activeJob = null;
            }).catch(function (e) {
              jobs.set(jobId, { state: "failed", output: "[skin] remove failed: " + e.message, finishedAt: Date.now() });
              activeJob = null;
            });
            return sendJson(res, 200, { jobId, accepted: true });
          }
          // muteVideo/unmuteVideo: instant CDP write, no spawn/jobId (spec §4.5).
          // Test env has no ZCode -> setVideoMuted throws -> {accepted:false},
          // not 500 (aligns with status "探查失败不致命" philosophy).
          // Note: req.on("end") callback is NOT async, so use .then/.catch here
          // rather than await (changing the callback signature would affect all
          // other action branches — keep the blast radius minimal).
          if (req2.action === "muteVideo" || req2.action === "unmuteVideo") {
            const videoMute = require("./video-mute.cjs");
            videoMute.setVideoMuted(req2.action === "muteVideo").then(function (r) {
              return sendJson(res, 200, { accepted: true, affected: r.affected, total: r.total, muted: r.lastMuted });
            }).catch(function (e) {
              return sendJson(res, 200, { accepted: false, error: e.message });
            });
            return;
          }
          // startRotate*: mutual exclusion — stop any running rotate first
          if (req2.action === "startRotateImage" || req2.action === "startRotateVideo") {
            stopRotateNow();
          }
          // injectImage/injectVideo: mutual exclusion — remove skin first so the
          // wallpaper's transparent-UI layer doesn't fight the skin's color overrides
          // (spec §6.1 双向互斥). Best-effort: ignore errors (skin may not be applied).
          if (req2.action === "injectImage" || req2.action === "injectVideo") {
            try { await require("./skin-inject.cjs").removeSkin(); } catch (e) {}
          }
          const spawnArgs = buildSpawnArgs(root, req2.action, req2);
          if (!spawnArgs) return sendJson(res, 400, { error: "unknown action" });
          if (activeJob) return sendJson(res, 409, { accepted: false, reason: "busy", activeJob });
          const jobId = "j_" + crypto.randomBytes(3).toString("hex");
          activeJob = jobId;
          jobs.set(jobId, { state: "running", startedAt: Date.now() });
          const [cmd, args, opts2] = spawnArgs;
          const child = child_process.spawn(cmd, args, opts2);
          // rotate is a long-lived process: remember handle, mark job done
          // immediately, and DON'T hold the global lock (spec §6.5)
          if (req2.action === "startRotateImage" || req2.action === "startRotateVideo") {
            rotateChild = child;
            child.on("exit", () => { rotateChild = null; });
            let out = "";
            child.stdout.on("data", (c) => (out += c));
            child.stderr.on("data", (c) => (out += c));
            jobs.set(jobId, { state: "done", output: "rotate started, pid=" + child.pid + "\n" + out.slice(0, 200), finishedAt: Date.now() });
            activeJob = null;
            return sendJson(res, 200, { jobId, accepted: true });
          }
          let out = "";
          child.stdout.on("data", (c) => (out += c));
          child.stderr.on("data", (c) => (out += c));
          const timeout = setTimeout(() => { try { child.kill(); } catch (e) {} }, 30000);
          child.on("exit", (code) => {
            clearTimeout(timeout);
            // parse setTransparent -Json hwnd line (spec §10 链路建立)
            if (req2.action === "setTransparent") {
              const lines = out.split(/\r?\n/).filter((l) => l.trim().indexOf("{") === 0);
              for (const l of lines) {
                try { const o = JSON.parse(l); if (o.event === "set" && o.hwnd) { transparentHwnd = o.hwnd; break; } }
                catch (e) {}
              }
            }
            jobs.set(jobId, { state: code === 0 ? "done" : "failed", exitCode: code, output: out.slice(-2000), finishedAt: Date.now() });
            activeJob = null;
          });
          return sendJson(res, 200, { jobId, accepted: true });
        });
        return;
      }
      m = /^\/api\/job\/([^/]+)$/.exec(p);
      if (m && method === "GET") {
        const j = jobs.get(m[1]);
        return sendJson(res, j ? 200 : 404, j || { error: "not found" });
      }

      sendJson(res, 404, { error: "not found" });
    }
    })().catch(reject);
  });
}

// Standalone entry (bin/control-center.bat calls this).
if (require.main === module) {
  const root = path.join(__dirname, "..");
  createServer({ root, port: DEFAULT_PORT, host: DEFAULT_HOST })
    .then(({ port, host, library }) => {
      console.log("[control] 服务已启动: http://" + host + ":" + port + "/control");
      console.log("[control] 共加载 " + library.size + " 本书");
      console.log("[control] 关闭此窗口即停止服务。");
      try {
        child_process.execSync(
          'powershell -NoProfile -Command "Set-Clipboard -Value \\"http://' + host + ':' + port + '/control\\""',
          { stdio: "ignore" });
        console.log("[control] URL 已复制到剪贴板，去 ZCode 浏览器面板粘贴回车。");
      } catch (e) { console.log("[control] (剪贴板写入失败，请手动复制上方 URL)"); }
    })
    .catch((e) => { console.error("[control] 启动失败: " + e.message); process.exit(1); });
}

module.exports = { createServer, buildLibrary, bookIdFor, guessMime, buildSpawnArgs };
