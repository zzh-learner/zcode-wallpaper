// Novel-reader HTTP server. Scans novels/*.txt once at startup, decodes,
// builds TOC, serves /api/* + the reader SPA. Port conflicts auto-increment.
// Spec §3, §5. Not coupled to inject.cjs or CDP.
//
// run standalone:  node lib/reader-server.cjs
// (bin/reader-server.bat wraps this; test imports createServer directly)

const http = require("http");
const fs = require("fs");
const path = require("path");
const { detectEncoding, replacementRatio } = require("./reader-codec.cjs");
const { parseTOC, cleanChapterParagraphs } = require("./reader-toc.cjs");

const DEFAULT_PORT = parseInt(process.env.ZCODE_READER_PORT || "17890", 10);
const DEFAULT_HOST = process.env.ZCODE_READER_HOST || "127.0.0.1";

// Stable id from filename (spec §6: hash so rename loses progress, accepted).
function bookIdFor(filename) {
  let h = 5381;
  for (let i = 0; i < filename.length; i++) h = ((h << 5) + h + filename.charCodeAt(i)) | 0;
  return "b" + (h >>> 0).toString(36);
}

// Scan + decode all books. Returns Map<id, BookRecord>.
function buildLibrary(novelsDir) {
  const lib = new Map();
  if (!fs.existsSync(novelsDir)) { try { fs.mkdirSync(novelsDir, { recursive: true }); } catch (e) {} }
  let entries = [];
  try { entries = fs.readdirSync(novelsDir); } catch (e) {}
  for (const name of entries) {
    if (!/\.txt$/i.test(name)) continue;
    const full = path.join(novelsDir, name);
    let bytes;
    try { bytes = fs.readFileSync(full); } catch (e) { continue; }
    const enc = detectEncoding(bytes);
    let text;
    try { text = new TextDecoder(enc === "utf8" && bytes[0] === 0xEF ? "utf8" : enc).decode(bytes); }
    catch (e) { text = new TextDecoder("gb18030").decode(bytes); }
    // strip UTF-8 BOM from text if present
    if (enc === "utf8" && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const toc = parseTOC(text, name);
    const suspect = replacementRatio(text) > 0.01;
    const id = bookIdFor(name);
    lib.set(id, { id, filename: name, sizeBytes: bytes.length, encoding: enc, encodingSuspect: suspect, toc, text });
  }
  return lib;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

// Factory: create + listen, auto-increment port on EADDRINUSE (up to +5).
// Returns { server, port, close, library }.
function createServer(opts) {
  return new Promise((resolve, reject) => {
    const novelsDir = opts.novelsDir;
    const readerDir = opts.readerDir;
    const startPort = opts.port || DEFAULT_PORT;
    const host = opts.host || DEFAULT_HOST;
    const library = buildLibrary(novelsDir);

    const server = http.createServer((req, res) => handle(req, res, library, readerDir));
    let tries = 0;
    function tryListen(port) {
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && tries < 5) { tries++; tryListen(port + 1); }
        else reject(err);
      });
      server.listen(port, host, () => {
        // resolve with the ACTUAL bound port (spec §3: write clipboard AFTER listen)
        resolve({ server, port: server.address().port, host, library, close: () => server.close() });
      });
    }
    tryListen(startPort);
  });
}

function handle(req, res, library, readerDir) {
  // WHATWG URL needs a base for relative paths; req.url is always path-first.
  const u = new URL(req.url, "http://localhost");
  const p = u.pathname;

  if (p === "/" ) { res.writeHead(302, { Location: "/reader/" }); res.end(); return; }

  // "/reader" (no trailing slash) -> redirect to "/reader/" so that relative
  // hrefs in index.html (reader.css, lib/codec.js) resolve under /reader/
  // instead of being treated as siblings of a file named "reader" at root.
  if (p === "/reader") { res.writeHead(302, { Location: "/reader/" }); res.end(); return; }

  if (p === "/reader/" || p === "/reader/index.html") {
    return serveStatic(res, path.join(readerDir, "index.html"), "text/html; charset=utf-8");
  }
  if (p.indexOf("/reader/lib/") === 0) {
    const rel = p.slice("/reader/".length); // lib/x.js
    return serveStatic(res, path.join(readerDir, rel), guessMime(rel));
  }
  // /reader/reader.css, /reader/reader.js (other static under reader/)
  if (p.indexOf("/reader/") === 0) {
    const rel = p.slice("/reader/".length); // reader.css / reader.js
    return serveStatic(res, path.join(readerDir, rel), guessMime(rel));
  }

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
    const chs = b.toc.chapters;
    if (n < 0 || n >= chs.length) return sendJson(res, 404, { error: "chapter out of range" });
    const c = chs[n];
    const chunk = b.text.slice(c.startOffset, c.endOffset);
    // paragraphs: split, trim, drop empty; then drop heading + metadata lines
    const raw = chunk.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
    const paras = cleanChapterParagraphs(raw, c.title);
    return sendJson(res, 200, { index: n, title: c.title, paragraphs: paras, prev: n > 0 ? n - 1 : null, next: n + 1 < chs.length ? n + 1 : null });
  }

  // progress endpoint is a no-op placeholder (progress lives in localStorage)
  m = /^\/api\/book\/([^/]+)\/progress$/.exec(p);
  if (m) return sendJson(res, 200, null);

  sendJson(res, 404, { error: "not found" });
}

function serveStatic(res, full, mime) {
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": mime || "application/octet-stream" });
    res.end(data);
  });
}
function guessMime(rel) {
  if (/\.js$/i.test(rel)) return "text/javascript; charset=utf-8";
  if (/\.css$/i.test(rel)) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

// Standalone entry (bin/reader-server.bat calls this).
if (require.main === module) {
  const root = path.join(__dirname, "..");
  const novelsDir = path.join(root, "novels");
  const readerDir = path.join(root, "reader");
  createServer({ novelsDir, readerDir, port: DEFAULT_PORT, host: DEFAULT_HOST })
    .then(({ port, host, library }) => {
      console.log("[reader] 服务已启动: http://" + host + ":" + port + "/reader");
      console.log("[reader] 共加载 " + library.size + " 本书:");
      for (const b of library.values()) {
        console.log("  - " + b.filename + " (" + b.toc.chapters.length + " 章, " + b.encoding +
          (b.encodingSuspect ? ", 编码可疑" : "") + ")");
      }
      console.log("[reader] 关闭此窗口即停止服务。");
      // Write the actual URL to the clipboard (after listen, so the port is real).
      try { require("child_process").execSync(
        'powershell -NoProfile -Command "Set-Clipboard -Value \\"http://' + host + ':' + port + '/reader\\""',
        { stdio: "ignore" });
        console.log("[reader] URL 已复制到剪贴板，去 ZCode 浏览器面板粘贴回车。");
      } catch (e) { console.log("[reader] (剪贴板写入失败，请手动复制上方 URL)"); }
    })
    .catch((e) => { console.error("[reader] 启动失败: " + e.message); process.exit(1); });
}

module.exports = { createServer, buildLibrary, bookIdFor };
