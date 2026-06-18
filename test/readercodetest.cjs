// Test for lib/reader-codec.cjs — server-side encoding detection.
// Order: BOM -> fatal UTF-8 -> GB18030 + sanity check.
// Run: node test/readercodetest.cjs
const { detectEncoding } = require("../lib/reader-codec.cjs");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// UTF-8 with BOM: EF BB BF prefix -> 'utf8' (strip BOM upstream)
check("UTF-8 BOM detected",
  detectEncoding(Buffer.from([0xEF,0xBB,0xBF,0xE4,0xBD,0xA0])) === "utf8");

// UTF-16 LE BOM
check("UTF-16LE BOM detected",
  detectEncoding(Buffer.from([0xFF,0xFE,0x4F,0x60])) === "utf-16le");

// Plain UTF-8 (no BOM): valid Chinese UTF-8 bytes for "你好" E4 BD A0 E5 A5 BD
check("plain UTF-8 (no BOM) detected",
  detectEncoding(Buffer.from([0xE4,0xBD,0xA0,0xE5,0xA5,0xBD])) === "utf8");

// GB18030: "你好" in GBK = C4 E3 BA C3. As UTF-8 this is invalid (fatal throws).
check("GB18030 detected (fatal UTF-8 fails)",
  detectEncoding(Buffer.from([0xC4,0xE3,0xBA,0xC3])) === "gb18030");

// Empty buffer -> default to utf8 (won't crash)
check("empty buffer -> utf8", detectEncoding(Buffer.alloc(0)) === "utf8");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
