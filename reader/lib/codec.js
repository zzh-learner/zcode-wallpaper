// Browser-side encoding detection for drag mode. Mirror of lib/reader-codec.cjs
// (server). Same algorithm; keep both in sync. Tested by test/readercodetestweb.cjs
// with the SAME cases as server's readercodetest.cjs.
//
// Input is Uint8Array (from FileReader.readAsArrayBuffer). Output is a
// TextDecoder label string + a decodeText(bytes) helper that strips BOM.

function tryDecode(bytes, label, fatal) {
  try { return new TextDecoder(label, { fatal: !!fatal }).decode(bytes); }
  catch (e) { return null; }
}

function detectEncoding(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return "utf8";
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return "utf-16be";
  if (bytes.length === 0) return "utf8";
  if (tryDecode(bytes, "utf8", true) !== null) return "utf8";
  return "gb18030";
}

// Full pipeline: detect + decode, stripping a UTF-8 BOM if present.
function decodeText(bytes, overrideLabel) {
  const label = overrideLabel || detectEncoding(bytes);
  let b = bytes;
  if (label === "utf8" && b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    b = b.subarray(3);
  }
  return new TextDecoder(label).decode(b);
}

// UMD-ish: works as CommonJS (test) and as a browser global/module.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { detectEncoding, decodeText, tryDecode };
}
