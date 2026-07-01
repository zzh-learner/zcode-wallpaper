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
  if (fail > 0) { console.error("\n" + fail + " FAILED"); process.exit(1); }
  console.log("\n" + pass + " passed, " + fail + " failed");
})().catch(e => { console.error("CRASH:", e); process.exit(1); });
