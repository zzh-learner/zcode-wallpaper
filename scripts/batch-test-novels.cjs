// Batch-test chapter recognition across a directory of novels.
// For each .txt: detect encoding, decode, run parseTOC, report stats +
// flag anomalies (0 chapters, suspiciously low count, encoding suspect).
// Usage: node scripts/batch-test-novels.cjs "G:\path\to\novels"
const fs = require("fs");
const path = require("path");
const { detectEncoding, replacementRatio } = require("../lib/reader-codec.cjs");
const { parseTOC } = require("../lib/reader-toc.cjs");

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("Usage: node scripts/batch-test-novels.cjs <novels-dir>");
  process.exit(1);
}

let entries = [];
try { entries = fs.readdirSync(dir).filter(n => /\.txt$/i.test(n)); } catch (e) {}
console.log("Scanning " + entries.length + " .txt files in: " + dir + "\n");
console.log("file | sizeMB | encoding | chaps | vols | pref | aft | suspect | note");
console.log("-----|--------|----------|-------|------|------|-----|---------|-----");

const anomalies = [];
for (const name of entries) {
  const full = path.join(dir, name);
  let bytes, enc, text, suspect = false, note = "";
  try {
    bytes = fs.readFileSync(full);
    enc = detectEncoding(bytes);
    // decode; strip UTF-8 BOM if present
    let b = bytes;
    if (enc === "utf8" && b.length >= 3 && b[0] === 0xEF) b = b.slice(3);
    text = new TextDecoder(enc).decode(b);
    suspect = replacementRatio(text) > 0.01;
    if (suspect) note = "FFFD>1%";
  } catch (e) {
    anomalies.push({ name, error: "decode: " + e.message });
    console.log(name.slice(0,30).padEnd(30) + " | ERROR " + e.message);
    continue;
  }
  const toc = parseTOC(text, name);
  const nchap = toc.chapters.length;
  const nvol = toc.volumes.length;
  // 前言：第一章标题不是"第X章/节/回"且不是"全文" -> 是前言/楔子类
  const firstCh = toc.chapters[0];
  const hasPreface = firstCh && firstCh.title !== "全文" && !/第[一二两三四五六七八九十百千零0-9]+(章|节|回)/.test(firstCh.title);
  const prefLabel = hasPreface ? firstCh.title.slice(0, 8) : "-";
  // 后记：最后一章标题不是"第X章/节/回"且不是"全文"（且不止1章）-> 尾声/后记类
  const lastCh = toc.chapters[toc.chapters.length - 1];
  const hasAfterword = lastCh && lastCh.title !== "全文" && !/第[一二两三四五六七八九十百千零0-9]+(章|节|回)/.test(lastCh.title) && toc.chapters.length > 1;
  const aftLabel = hasAfterword ? lastCh.title.slice(0, 6) : "-";
  // anomaly heuristics
  if (nchap === 1 && toc.chapters[0].title === "全文") { note = "FALLBACK全文"; anomalies.push({name, note}); }
  else if (nchap > 0 && nchap < 20) { note = "low chaps"; anomalies.push({name, note, nchap}); }
  const sizeMB = (bytes.length / 1024 / 1024).toFixed(1);
  console.log(
    name.slice(0,30).padEnd(30) + " | " +
    sizeMB.padStart(5) + " | " +
    enc.padEnd(8) + " | " +
    String(nchap).padStart(5) + " | " +
    String(nvol).padStart(4) + " | " +
    prefLabel.padEnd(8) + " | " +
    aftLabel.padEnd(6) + " | " +
    (suspect ? "  yes" : "   no") + " | " +
    note
  );
}

console.log("\n=== SUMMARY ===");
console.log("total files: " + entries.length);
console.log("anomalies: " + anomalies.length);
if (anomalies.length > 0) {
  console.log("\nAnomalous files (need closer look):");
  anomalies.forEach(a => console.log("  - " + a.name + "  " + (a.note||"") + "  " + (a.error||"")));
}
