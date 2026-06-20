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

// shelfDiff: books in allBooks not yet on shelf
var allBooks = [
  { id: "b1", filename: "a.txt" }, { id: "b2", filename: "b.txt" }, { id: "b3", filename: "c.txt" }
];
check("shelfDiff: empty shelf -> all 3 addable", shelf.shelfDiff([], allBooks).length === 3);
check("shelfDiff: shelf has b1 -> 2 addable", shelf.shelfDiff([{ bookId: "b1" }], allBooks).length === 2);
check("shelfDiff: addable excludes b1", shelf.shelfDiff([{ bookId: "b1" }], allBooks).every(function (b) { return b.id !== "b1"; }));
check("shelfDiff: full shelf -> 0 addable", shelf.shelfDiff([{ bookId: "b1" }, { bookId: "b2" }, { bookId: "b3" }], allBooks).length === 0);
check("shelfDiff: empty allBooks -> 0", shelf.shelfDiff([], []).length === 0);

// makeShelfEntry: shape
var e = shelf.makeShelfEntry({ id: "b9", filename: "x.txt" });
check("makeShelfEntry: bookId from id", e.bookId === "b9");
check("makeShelfEntry: filename", e.filename === "x.txt");
check("makeShelfEntry: lastChapterTitle null", e.lastChapterTitle === null);
check("makeShelfEntry: updatedAt is number", typeof e.updatedAt === "number");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
