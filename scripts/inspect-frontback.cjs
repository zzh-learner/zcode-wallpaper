// Inspect what's BEFORE the first chapter and AFTER the last chapter in each book.
// One-off probe to design 前言/后记/番外 recognition (教训19: 看大批真实样本).
const fs = require("fs");
const path = require("path");
const { detectEncoding } = require("../lib/reader-codec.cjs");
const { parseTOC } = require("../lib/reader-toc.cjs");

const dir = path.join(__dirname, "..", "novels");
const entries = fs.readdirSync(dir).filter(n => /\.txt$/i.test(n));
for (const name of entries) {
  const bytes = fs.readFileSync(path.join(dir, name));
  const enc = detectEncoding(bytes);
  let b = bytes;
  if (enc === "utf8" && b.length >= 3 && b[0] === 0xEF) b = b.slice(3);
  const text = new TextDecoder(enc).decode(b);
  const toc = parseTOC(text, name);
  const firstCh = toc.chapters[0];
  console.log("\n========== " + name + "  (" + toc.chapters.length + " chs) ==========");
  // BEFORE first chapter
  const before = text.slice(0, firstCh.startOffset);
  const beforeLines = before.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
  console.log("--- BEFORE first chapter (" + beforeLines.length + " non-empty lines) ---");
  beforeLines.slice(0, 15).forEach((l, i) => console.log("  [" + i + "] " + l.slice(0, 80)));
  // AFTER last chapter
  const lastCh = toc.chapters[toc.chapters.length - 1];
  const after = text.slice(lastCh.startOffset);
  const afterLines = after.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
  console.log("--- AFTER last-chapter-start (chunk has " + afterLines.length + " non-empty lines) ---");
  console.log("  last chapter title: " + lastCh.title);
  console.log("  last chapter chunk paragraph count: " + afterLines.length);
  // show the lines that are clearly NOT body (short, or match markers)
  console.log("  last 25 non-empty lines of file:");
  afterLines.slice(-25).forEach(l => console.log("    " + l.slice(0, 80)));
}
