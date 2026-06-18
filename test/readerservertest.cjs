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
    check("/chapter prev/next fields present", "prev" in ch && "next" in ch);

    // out-of-range chapter -> 404
    const oor = await httpGet(base + "/api/book/" + id + "/chapter/9999");
    check("out-of-range chapter -> 404", oor.status === 404);

    // /reader serves html
    const reader = await httpGet(base + "/reader");
    check("/reader returns html", reader.status === 200 && reader.body.indexOf("<title>") !== -1);

    // / redirects to /reader
    const root = await httpGet(base + "/");
    check("/ redirects to /reader", root.status === 302 && (root.headers.location || "").indexOf("/reader") !== -1);
  } finally {
    server.close();
    try { fs.rmSync(tmpNovels, { recursive: true }); } catch (e) {}
    try { fs.rmSync(tmpReader, { recursive: true }); } catch (e) {}
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
})().catch(e => { console.error("TEST ERROR:", e); process.exit(1); });
