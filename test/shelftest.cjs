// Test control/lib/shelf.js — association-repair pure fn + bookId (spec §4 B3, §5.2).
const shelf = require("../control/lib/shelf.js");
let pass = 0, fail = 0;
function check(n, c) { console.log((c ? "PASS ✓ " : "FAIL ✗ ") + n); c ? pass++ : fail++; }

// resolveStaleBookId: filename-based repair (no content hash, spec §5.2)
check("resolve: same filename present -> returns {newBookId}", shelf.resolveStaleBookId({ filename: "a.txt" }, ["a.txt", "b.txt"]) !== null);
check("resolve: filename gone -> null", shelf.resolveStaleBookId({ filename: "x.txt" }, ["a.txt"]) === null);
check("resolve: returns newFilename", shelf.resolveStaleBookId({ filename: "a.txt" }, ["a.txt"]).newFilename === "a.txt");
check("resolve: newBookId is stable hash form (b...)", /^b[0-9a-z]+$/.test(shelf.resolveStaleBookId({ filename: "a.txt" }, ["a.txt"]).newBookId));
check("resolve: same filename -> same bookId as bookId()", shelf.resolveStaleBookId({ filename: "a.txt" }, ["a.txt"]).newBookId === shelf.bookId("a.txt"));
check("resolve: null entry -> null", shelf.resolveStaleBookId(null, ["a.txt"]) === null);
check("resolve: entry without filename -> null", shelf.resolveStaleBookId({}, ["a.txt"]) === null);

// bookId determinism (same as reader's bookIdFor)
check("bookId deterministic", shelf.bookId("a.txt") === shelf.bookId("a.txt"));
check("bookId differs for different filename", shelf.bookId("a.txt") !== shelf.bookId("b.txt"));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
