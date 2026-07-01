// Test for control-server epub integration: buildLibrary dual-format, guessMime.
// Run: node test/epubservertest.cjs
const fs = require("fs");
const path = require("path");
const os = require("os");

const { buildLibrary, bookIdFor, guessMime } = require("../lib/control-server.cjs");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

(async () => {
  // --- buildLibrary scans both .txt and .epub ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "epub-lib-"));
  // a tiny txt
  fs.writeFileSync(path.join(tmp, "sample.txt"), "第一章 测试\n\u3000\u3000正文。\n");
  // copy fixture epub
  const fixture = path.join(__dirname, "fixtures", "normal.epub");
  if (!fs.existsSync(fixture)) {
    console.error("MISSING fixture. Run: node test/fixtures/make-epub.cjs"); process.exit(1);
  }
  fs.copyFileSync(fixture, path.join(tmp, "normal.epub"));

  // buildLibrary is async (awaits loadEpub); must await here.
  const lib = await buildLibrary(tmp);
  check("library has 2 entries", lib.size === 2);
  // both formats present
  const txtEntry = Array.from(lib.values()).find(b => b.filename === "sample.txt");
  const epubEntry = Array.from(lib.values()).find(b => b.filename === "normal.epub");
  check("txt entry exists", !!txtEntry);
  check("epub entry exists", !!epubEntry);
  check("txt entry format", txtEntry.format === "txt");
  check("epub entry format", epubEntry.format === "epub");
  // txt entry keeps legacy fields (encoding, text)
  check("txt entry keeps encoding field", typeof txtEntry.encoding === "string");
  check("txt entry keeps text field", typeof txtEntry.text === "string");
  // epub entry has spine/resources, no text
  check("epub entry has spine", Array.isArray(epubEntry.spine));
  check("epub entry has resources", epubEntry.resources && epubEntry.resources.css);
  check("epub entry has no text field", epubEntry.text === undefined);
  // epub toc shape aligned with txt (chapters + volumes)
  check("epub toc.chapters is array", Array.isArray(epubEntry.toc.chapters));
  check("epub toc.volumes is array", Array.isArray(epubEntry.toc.volumes));
  // bookId space shared
  check("epub bookId deterministic", bookIdFor("normal.epub") === epubEntry.id);
  // _book/_zip retained server-side (non-serializable; /api/books must not leak them)
  check("epub entry retains _book", !!epubEntry._book);
  check("epub entry retains _zip", !!epubEntry._zip);

  // --- guessMime extensions (lesson 27 regression) ---
  check("guessMime .css", guessMime("a.css") === "text/css; charset=utf-8");
  check("guessMime .png", guessMime("a.png") === "image/png");
  check("guessMime .jpg", guessMime("a.jpg") === "image/jpeg");
  check("guessMime .jpeg", guessMime("a.jpeg") === "image/jpeg");
  check("guessMime .gif", guessMime("a.gif") === "image/gif");
  check("guessMime .svg", guessMime("a.svg") === "image/svg+xml");
  check("guessMime .webp", guessMime("a.webp") === "image/webp");
  // legacy mime still works
  check("guessMime .html still works", guessMime("a.html").includes("text/html"));
  check("guessMime .js still works", guessMime("a.js").includes("javascript"));
  check("guessMime unknown -> octet-stream", guessMime("a.xyz") === "application/octet-stream");

  fs.rmSync(tmp, { recursive: true, force: true });

  // --- chapter + asset endpoints via real HTTP (lesson 12/13: cross-process glue) ---
  await (async () => {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "epub-srv-"));
    const novels2 = path.join(tmp2, "novels");
    fs.mkdirSync(novels2);
    fs.writeFileSync(path.join(novels2, "sample.txt"), "第一章 测试\n\u3000\u3000正文段。\n");
    const fx = path.join(__dirname, "fixtures", "normal.epub");
    fs.copyFileSync(fx, path.join(novels2, "normal.epub"));

    const { createServer } = require("../lib/control-server.cjs");
    const srv = await createServer({ root: tmp2, port: 0, host: "127.0.0.1" });
    const port = srv.port;
    const base = "http://127.0.0.1:" + port;
    const epubId = bookIdFor("normal.epub");
    const txtId = bookIdFor("sample.txt");

    // txt chapter: has format field, keeps paragraphs
    const txtCh = await fetch(base + "/api/book/" + txtId + "/chapter/0").then(r => r.json());
    check("txt chapter format field", txtCh.format === "txt");
    check("txt chapter paragraphs kept", Array.isArray(txtCh.paragraphs));

    // epub chapter: html + cssHrefs, no paragraphs
    const epubCh = await fetch(base + "/api/book/" + epubId + "/chapter/0").then(r => r.json());
    check("epub chapter format field", epubCh.format === "epub");
    check("epub chapter has html", typeof epubCh.html === "string" && epubCh.html.length > 0);
    check("epub chapter has cssHrefs", Array.isArray(epubCh.cssHrefs) && epubCh.cssHrefs.length > 0);
    check("epub chapter no paragraphs", epubCh.paragraphs === undefined);
    check("epub chapter prev/next", epubCh.prev === null && epubCh.next === 1);
    // XSS stripped at the endpoint (not just in pure fn)
    check("epub chapter html XSS-stripped", !epubCh.html.includes("<script") && !epubCh.html.includes("onerror"));

    // END-TO-END: the fixture's chap1.xhtml (in OEBPS/Text/) references the image
    // with a RELATIVE src "../Images/red.png". After sanitizeChapterXhtml rewrites
    // it against the chapter's zip dir, the src must point at the RESOLVED absolute
    // zip path OEBPS/Images/red.png (this is the bug fix — a flat fixture masked it).
    const imgSrcMatch = epubCh.html.match(/src="(\/api\/book\/[^"]*\/asset\?href=([^"]+))"/);
    check("chapter html img src rewritten + resolved to absolute zip path",
      !!imgSrcMatch && decodeURIComponent(imgSrcMatch[2]) === "OEBPS/Images/red.png");
    // And that resolved URL must actually serve the image (200 + png bytes).
    if (imgSrcMatch) {
      const resolvedImgRes = await fetch(base + imgSrcMatch[1]);
      check("resolved img src serves 200 + png", resolvedImgRes.status === 200
        && resolvedImgRes.headers.get("content-type").includes("image/png")
        && (await resolvedImgRes.arrayBuffer()).byteLength > 0);
    }

    // asset endpoint: whitelisted CSS returns text/css + body.
    // Whitelist keys are now ABSOLUTE zip paths (OEBPS/Styles/main.css), matching
    // what rewriteRef produces — not the OPF-relative manifest href.
    const cssRes = await fetch(base + "/api/book/" + epubId + "/asset?href=" + encodeURIComponent("OEBPS/Styles/main.css"));
    check("asset CSS status 200", cssRes.status === 200);
    check("asset CSS content-type", cssRes.headers.get("content-type").includes("text/css"));
    const cssBody = await cssRes.text();
    check("asset CSS body has font-family", cssBody.includes("font-family"));
    // CSS sanitize at the endpoint (spec §4.3): fixture's main.css ships an
    // @import probe — it must be stripped before the CSS reaches the webview.
    check("asset CSS body @import stripped", !cssBody.includes("@import"));
    check("asset CSS body @import probe gone", !cssBody.includes("should-be-stripped"));

    // asset endpoint: image returns image/png (queried by absolute zip path key)
    const imgRes = await fetch(base + "/api/book/" + epubId + "/asset?href=" + encodeURIComponent("OEBPS/Images/red.png"));
    check("asset image status 200", imgRes.status === 200);
    check("asset image content-type", imgRes.headers.get("content-type").includes("image/png"));
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    check("asset image bytes > 0", imgBuf.length > 0);

    // asset endpoint: path traversal -> 404 (resolves to "etc/passwd", not in whitelist)
    const evilRes = await fetch(base + "/api/book/" + epubId + "/asset?href=" + encodeURIComponent("../../etc/passwd"));
    check("asset path traversal 404", evilRes.status === 404);
    const evilEnc = await fetch(base + "/api/book/" + epubId + "/asset?href=" + encodeURIComponent("images%2F..%2F..%2Fpasswd"));
    check("asset encoded traversal 404", evilEnc.status === 404);

    // asset endpoint: non-epub book -> 404
    const noAsset = await fetch(base + "/api/book/" + txtId + "/asset?href=x");
    check("asset on txt book 404", noAsset.status === 404);

    fs.rmSync(tmp2, { recursive: true, force: true });
    srv.close();
  })();

  if (fail > 0) { console.error("\n" + fail + " FAILED"); process.exit(1); }
  console.log("\n" + pass + " passed, " + fail + " failed");
})().catch(e => { console.error("CRASH:", e); process.exit(1); });
