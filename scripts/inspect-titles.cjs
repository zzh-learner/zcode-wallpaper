// Find candidate front/back title words in each book.
const fs = require("fs");
const path = require("path");
const { detectEncoding } = require("../lib/reader-codec.cjs");
const { parseTOC } = require("../lib/reader-toc.cjs");

const dir = path.join(__dirname, "..", "novels");
const entries = fs.readdirSync(dir).filter(n => /\.txt$/i.test(n));
// Candidate title markers (from sample inspection + common novel conventions)
const FRONT_MARKERS = ["楔子","序章","序言","序","引子","引言","简介","书籍介绍","内容简介","作品相关","写在前面","题外话"];
const BACK_MARKERS = ["尾声","后记","完本感言","完本感言","完結感言","感言","番外","（全文完）","(全文完)","（全书完）","(全书完)","（全文终）","(全文终)","全书终","全文完","全书完","全文终"];

for (const name of entries) {
  const bytes = fs.readFileSync(path.join(dir, name));
  const enc = detectEncoding(bytes);
  let b = bytes;
  if (enc === "utf8" && b.length >= 3 && b[0] === 0xEF) b = b.slice(3);
  const text = new TextDecoder(enc).decode(b);
  const toc = parseTOC(text, name);
  const firstCh = toc.chapters[0];
  const before = text.slice(0, firstCh.startOffset);
  console.log("\n=== " + name + " ===");
  // FRONT: first non-empty line + any marker found
  const beforeLines = before.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.length>0);
  console.log("  first non-empty line: " + (beforeLines[0]||"(none)").slice(0,60));
  const ffound = FRONT_MARKERS.filter(m => before.includes(m));
  console.log("  FRONT markers found: " + (ffound.length?ffound.join(", "):"(none)"));
  // BACK: scan last chapter body for markers, report position
  const lastCh = toc.chapters[toc.chapters.length-1];
  const lastBody = text.slice(lastCh.startOffset);
  console.log("  last chapter: " + lastCh.title.slice(0,50));
  const bfound = BACK_MARKERS.map(m => {
    const idx = lastBody.indexOf(m);
    return idx>=0 ? m+"@"+idx : null;
  }).filter(Boolean);
  console.log("  BACK markers in last-chapter body: " + (bfound.length?bfound.join(", "):"(none)"));
}
