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
console.log("file | sizeMB | encoding | chaps | vols | suspect | note");
console.log("-----|--------|----------|-------|------|---------|-----");

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
