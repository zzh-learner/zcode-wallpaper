// Test reader/lib/book-router.js — pure URL param parsing for ?book=<id>.
const router = require("../reader/lib/book-router.js");
let pass = 0, fail = 0;
function check(n, c) { console.log((c ? "PASS ✓ " : "FAIL ✗ ") + n); c ? pass++ : fail++; }

check("parse ?book=bxmeoht", router.parseBookParam("?book=bxmeoht") === "bxmeoht");
check("parse full href with /reader/?book=abc", router.parseBookParam("http://127.0.0.1:17890/reader/?book=abc") === "abc");
check("parse empty -> null", router.parseBookParam("") === null);
check("parse no book param -> null", router.parseBookParam("?foo=bar") === null);
check("parse other params + book", router.parseBookParam("?x=1&book=zzz&y=2") === "zzz");
check("parse encoded book id", router.parseBookParam("?book=b%2D1") === "b-1");
check("parse undefined -> null", router.parseBookParam(undefined) === null);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
