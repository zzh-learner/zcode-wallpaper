// Test for lib/epub-load.cjs — epub loading glue (spec §3.3, §3.4).
// Uses real fixture (regenerate with: node test/fixtures/make-epub.cjs).
// Run: node test/epubloadtest.cjs
const fs = require("fs");
const path = require("path");

const fixture = path.join(__dirname, "fixtures", "normal.epub");
if (!fs.existsSync(fixture)) {
  console.error("MISSING fixture. Run: node test/fixtures/make-epub.cjs");
  process.exit(1);
}

const { loadEpub, getEpubChapter, readEpubAsset } = require("../lib/epub-load.cjs");
const { bookIdFor } = require("../lib/control-server.cjs");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

(async () => {
  // --- loadEpub ---
  const entry = await loadEpub(fixture);
  check("format is epub", entry.format === "epub");
  check("toc has 2 chapters", entry.toc.chapters.length === 2);
  check("chapter 0 title", entry.toc.chapters[0].title === "第一章 开始");
  check("chapter 0 spineIndex", entry.toc.chapters[0].spineIndex === 0);
  check("chapter 1 spineIndex", entry.toc.chapters[1].spineIndex === 1);
  check("spine length 2", entry.spine.length === 2);
  check("resources.css has main.css", Object.values(entry.resources.css).some(h => h.includes("main.css")));
  check("resources.images has red.png", Object.values(entry.resources.images).some(h => h.includes("red.png")));

  // --- getEpubChapter (sanitize + lazy) ---
  const bookId = bookIdFor("normal.epub");
  const ch0 = await getEpubChapter(entry, 0, bookId);
  check("chapter format epub", ch0.format === "epub");
  check("chapter index 0", ch0.index === 0);
  check("chapter title set", ch0.title === "第一章 开始");
  check("chapter html non-empty", typeof ch0.html === "string" && ch0.html.length > 0);
  // XSS probes stripped
  check("chapter html no <script>", !ch0.html.includes("<script"));
  check("chapter html no onerror", !ch0.html.includes("onerror"));
  // src rewritten
  check("chapter html img src rewritten", ch0.html.includes("/api/book/" + bookId + "/asset?href="));
  // cssHrefs provided (link to asset endpoint)
  check("chapter cssHrefs is array", Array.isArray(ch0.cssHrefs) && ch0.cssHrefs.length > 0);
  check("chapter cssHrefs point to asset endpoint", ch0.cssHrefs[0].includes("/api/book/" + bookId + "/asset?href="));
  // prev/next
  check("chapter 0 prev null", ch0.prev === null);
  check("chapter 0 next 1", ch0.next === 1);
  const ch1 = await getEpubChapter(entry, 1, bookId);
  check("chapter 1 prev 0", ch1.prev === 0);
  check("chapter 1 next null", ch1.next === null);
  // out of range
  const chBad = await getEpubChapter(entry, 99, bookId);
  check("out-of-range returns null", chBad === null);

  // --- readEpubAsset (whitelist + path traversal defense) ---
  const cssHref = Object.keys(entry.resources.css).find(h => h.includes("main.css"));
  // resources map: key is the OPF-relative href (what buildLibrary registered), value is zip path.
  // readEpubAsset takes the OPF-relative href (the whitelist key).
  const css = await readEpubAsset(entry, cssHref);
  check("CSS asset read returns data", css && typeof css.data === "string" && css.data.includes("font-family"));
  check("CSS asset mime text/css", css && css.mime === "text/css");
  const imgHref = Object.keys(entry.resources.images).find(h => h.includes("red.png"));
  const img = await readEpubAsset(entry, imgHref);
  check("image asset read returns buffer", img && img.data && img.data.byteLength > 0);
  check("image asset mime image/png", img && img.mime === "image/png");
  // path traversal rejected
  const evil = await readEpubAsset(entry, "../../etc/passwd");
  check("path traversal href returns null", evil === null);
  const evilEnc = await readEpubAsset(entry, "images%2F..%2F..%2Fetc%2Fpasswd");
  check("encoded path traversal returns null", evilEnc === null);
  // non-whitelisted legit-looking path rejected
  const unknown = await readEpubAsset(entry, "styles/other.css");
  check("unknown href rejected", unknown === null);

  if (fail > 0) { console.error("\n" + fail + " FAILED"); process.exit(1); }
  console.log("\n" + pass + " passed, " + fail + " failed");
})().catch(e => { console.error("CRASH:", e); process.exit(1); });
