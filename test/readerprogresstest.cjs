// Test for reader/lib/progress.js — localStorage progress per-book-id.
// Spec §6. Uses an in-memory localStorage mock (Node has none).
// Run: node test/readerprogresstest.cjs

// --- localStorage mock ---
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { saveProgress, loadProgress, getShelf, addToShelf } = require("../reader/lib/progress.js");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// save + load roundtrip
saveProgress("bookA", { chapterIndex: 156, scrollRatio: 0.23 });
const p = loadProgress("bookA");
check("save/load roundtrip preserves chapter+ratio",
  p.chapterIndex === 156 && p.scrollRatio === 0.23);

// per-book isolation
saveProgress("bookB", { chapterIndex: 3, scrollRatio: 0.9 });
check("books isolated", loadProgress("bookA").chapterIndex === 156 && loadProgress("bookB").chapterIndex === 3);

// missing book -> null
check("missing book returns null", loadProgress("nonexistent") === null);

// scrollRatio clamped to [0,1]
saveProgress("bookC", { chapterIndex: 0, scrollRatio: 5 });
check("ratio clamped to 1", loadProgress("bookC").scrollRatio === 1);
saveProgress("bookD", { chapterIndex: 0, scrollRatio: -2 });
check("ratio clamped to 0", loadProgress("bookD").scrollRatio === 0);

// shelf: add + list + dedup by bookId + sorted by updatedAt desc
addToShelf({ bookId: "bookA", filename: "a.txt", lastChapterTitle: "ch156" });
addToShelf({ bookId: "bookB", filename: "b.txt", lastChapterTitle: "ch3" });
addToShelf({ bookId: "bookA", filename: "a.txt", lastChapterTitle: "ch160" }); // update
const shelf = getShelf();
check("shelf dedups by bookId (2 entries)", shelf.length === 2);
check("shelf latest update wins", shelf.find(s => s.bookId === "bookA").lastChapterTitle === "ch160");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
