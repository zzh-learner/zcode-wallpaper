// Test for lib/reader-server.cjs — HTTP API shape + port-conflict auto-increment.
// Starts the server on a random free port with a fixture novels/ dir.
// Run: node test/readerservertest.cjs
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    }).on("error", reject);
  });
}

(async () => {
  // fixture novels dir: one tiny UTF-8 txt with 2 chapters
  const tmpNovels = fs.mkdtempSync(path.join(os.tmpdir(), "reader-novels-"));
  const sample = Buffer.from("第一章 开头\n　　正文一。\n第二章 结尾\n　　正文二。\n", "utf8");
  fs.writeFileSync(path.join(tmpNovels, "sample.txt"), sample);

  // fixture reader dir: minimal index.html so /reader serves something
  const tmpReader = fs.mkdtempSync(path.join(os.tmpdir(), "reader-web-"));
  fs.writeFileSync(path.join(tmpReader, "index.html"), "<!doctype html><title>r</title>");

  const { createServer } = require("../lib/reader-server.cjs");

  // pick a free port by binding once then releasing
  const portPicker = require("net").createServer();
  await new Promise(r => portPicker.listen(0, "127.0.0.1", r));
  const port = portPicker.address().port;
  await new Promise(r => portPicker.close(r));

  const server = await createServer({ novelsDir: tmpNovels, readerDir: tmpReader, port: port, host: "127.0.0.1" });
  const base = "http://127.0.0.1:" + server.port;

  try {
    // /api/books -> array with our sample
    const books = JSON.parse((await httpGet(base + "/api/books")).body);
    check("/api/books returns array", Array.isArray(books));
    check("/api/books has sample.txt", books.some(b => b.filename === "sample.txt"));
    check("book has totalChapters", typeof books[0].totalChapters === "number" && books[0].totalChapters === 2);

    // toc
    const id = books[0].id;
    const toc = JSON.parse((await httpGet(base + "/api/book/" + id + "/toc")).body);
    check("/toc has chapters array", Array.isArray(toc.chapters) && toc.chapters.length === 2);
    check("/toc ch0 title contains 开头", toc.chapters[0].title.indexOf("开头") !== -1);

    // chapter content
    const ch = JSON.parse((await httpGet(base + "/api/book/" + id + "/chapter/0")).body);
    check("/chapter has paragraphs array", Array.isArray(ch.paragraphs) && ch.paragraphs.length >= 1);
    check("/chapter paragraphs include 正文一", ch.paragraphs.some(p => p.indexOf("正文一") !== -1));
    check("/chapter paragraphs do NOT include heading line", !ch.paragraphs.some(p => p === "第一章 开头"));
    check("/chapter prev/next fields present", "prev" in ch && "next" in ch);

    // out-of-range chapter -> 404
    const oor = await httpGet(base + "/api/book/" + id + "/chapter/9999");
    check("out-of-range chapter -> 404", oor.status === 404);

    // /reader serves html (directly, no redirect)
    const reader = await httpGet(base + "/reader/");
    check("/reader/ returns html", reader.status === 200 && reader.body.indexOf("<title>") !== -1);

    // /reader (no slash) redirects to /reader/ (so relative hrefs resolve)
    const noSlash = await httpGet(base + "/reader");
    check("/reader redirects to /reader/", noSlash.status === 302 && (noSlash.headers.location || "") === "/reader/");

    // / redirects to /reader/
    const root = await httpGet(base + "/");
    check("/ redirects to /reader/", root.status === 302 && (root.headers.location || "") === "/reader/");
  } finally {
    server.close();
    try { fs.rmSync(tmpNovels, { recursive: true }); } catch (e) {}
    try { fs.rmSync(tmpReader, { recursive: true }); } catch (e) {}
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
})()
.then(() => {
// === port-conflict auto-increment (spec §11 风险钉死) ===
  return (async () => {
    const tmpNovels2 = fs.mkdtempSync(path.join(os.tmpdir(), "reader-novels2-"));
    const tmpReader2 = fs.mkdtempSync(path.join(os.tmpdir(), "reader-web2-"));
    fs.writeFileSync(path.join(tmpReader2, "index.html"), "<!doctype html>");
    const { createServer } = require("../lib/reader-server.cjs");

    // occupy a port
    const blocker = require("net").createServer();
    await new Promise(r => blocker.listen(0, "127.0.0.1", r));
    const blockedPort = blocker.address().port;

    // ask server to use the blocked port -> should auto-increment to blockedPort+1
    const s = await createServer({ novelsDir: tmpNovels2, readerDir: tmpReader2, port: blockedPort, host: "127.0.0.1" });
    check("port conflict auto-incremented", s.port === blockedPort + 1);

    // verify the new port actually serves
    const r = await httpGet("http://127.0.0.1:" + s.port + "/api/books");
    check("incremented port serves API", r.status === 200);

    s.close();
    await new Promise(r => blocker.close(r));
    try { fs.rmSync(tmpNovels2, { recursive: true }); } catch (e) {}
    try { fs.rmSync(tmpReader2, { recursive: true }); } catch (e) {}

    console.log("\n" + pass + " passed, " + fail + " failed");
    process.exit(fail === 0 ? 0 : 1);
  })();
})
.catch(e => { console.error("TEST ERROR:", e); process.exit(1); });
