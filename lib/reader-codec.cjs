// Server-side encoding detection for .txt novels.
// Order: BOM -> fatal UTF-8 -> GB18030 (+ sanity via U+FFFD ratio).
// Mirrored in browser by reader/lib/codec.js; keep both in sync and run
// the same test cases (test/readercodectest*.cjs).
//
// Run standalone: not a runnable script; required by lib/reader-server.cjs.

function tryDecode(bytes, label, fatal) {
  try {
    return new TextDecoder(label, { fatal: !!fatal }).decode(bytes);
  } catch (e) {
    return null;
  }
}

function detectEncoding(bytes) {
  // 1) BOM detection (authoritative)
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return "utf8";
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return "utf-16be";

  // Empty -> utf8 default (TextDecoder handles empty fine)
  if (bytes.length === 0) return "utf8";

  // 2) Strict UTF-8: if it decodes without error, treat as UTF-8
  if (tryDecode(bytes, "utf8", true) !== null) return "utf8";

  // 3) Otherwise GB18030 (superset of GBK/GB2312; decodes any byte seq).
  // Sanity: if it yields lots of U+FFFD replacement chars, still return gb18030
  // (callers mark encodingSuspect), but don't return something nonsensical.
  return "gb18030";
}

// Sanity helper: fraction of U+FFFD in decoded text. >0.01 = suspect.
function replacementRatio(text) {
  if (!text || text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xFFFD) n++;
  return n / text.length;
}

module.exports = { detectEncoding, tryDecode, replacementRatio };
