// Test for reader/lib/codec.js — browser-side encoding mirror of
// lib/reader-codec.cjs. SAME cases as readercodetest.cjs; both must agree.
// This is the cross-environment glue check (AGENTS.md 教训 12).
// Run: node test/readercodetestweb.cjs
const { detectEncoding, decodeText } = require("../reader/lib/codec.js");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

check("UTF-8 BOM detected",
  detectEncoding(new Uint8Array([0xEF,0xBB,0xBF,0xE4,0xBD,0xA0])) === "utf8");
check("plain UTF-8 detected",
  detectEncoding(new Uint8Array([0xE4,0xBD,0xA0,0xE5,0xA5,0xBD])) === "utf8");
check("GB18030 detected",
  detectEncoding(new Uint8Array([0xC4,0xE3,0xBA,0xC3])) === "gb18030");
check("empty -> utf8", detectEncoding(new Uint8Array(0)) === "utf8");

// decodeText: full pipeline bytes -> decoded string
check("decodeText GB18030 returns 你好",
  decodeText(new Uint8Array([0xC4,0xE3,0xBA,0xC3])) === "你好");
check("decodeText UTF-8 returns 你好",
  decodeText(new Uint8Array([0xE4,0xBD,0xA0,0xE5,0xA5,0xBD])) === "你好");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
