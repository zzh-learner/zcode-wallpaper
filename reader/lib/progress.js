// Per-book reading progress in localStorage. Spec §6.
// key: zcode-reader:progress:<bookId>  value: {chapterIndex, scrollRatio, updatedAt}
// key: zcode-reader:shelf              value: [{bookId, filename, lastChapterTitle, updatedAt}]
//
// localStorage must exist (browser or test mock). In drag mode the partition
// is persist:zcode-embedded-browser, so progress survives ZCode restart
// (待真机验证 — spec §2 待验项 5).

const PROGRESS_PREFIX = "zcode-reader:progress:";
const SHELF_KEY = "zcode-reader:shelf";

function clamp01(x) { x = Number(x) || 0; return x < 0 ? 0 : x > 1 ? 1 : x; }

function saveProgress(bookId, p) {
  const v = {
    bookId,
    chapterIndex: Math.max(0, parseInt(p.chapterIndex, 10) || 0),
    scrollRatio: clamp01(p.scrollRatio),
    updatedAt: Date.now(),
  };
  localStorage.setItem(PROGRESS_PREFIX + bookId, JSON.stringify(v));
  return v;
}

function loadProgress(bookId) {
  const raw = localStorage.getItem(PROGRESS_PREFIX + bookId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function getShelf() {
  const raw = localStorage.getItem(SHELF_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    // sort by updatedAt desc (most recently read first)
    return arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (e) { return []; }
}

function addToShelf(entry) {
  const arr = getShelf();
  const i = arr.findIndex(s => s.bookId === entry.bookId);
  const v = Object.assign({}, entry, { updatedAt: Date.now() });
  if (i >= 0) arr[i] = Object.assign({}, arr[i], v);
  else arr.push(v);
  localStorage.setItem(SHELF_KEY, JSON.stringify(arr));
  return v;
}

// Expose: CommonJS for Node tests, AND a browser global for reader.js/book.js
// (which reference window.__readerProgress). Both must work — the test files
// require() this module (Node), while the browser loads it via <script> and
// needs the global. See Task 3/4/5 fix: codec/toc/progress originally only
// exported CommonJS, so browser globals were undefined -> renderShelf crashed.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { saveProgress, loadProgress, getShelf, addToShelf, clamp01, PROGRESS_PREFIX, SHELF_KEY };
}
if (typeof window !== "undefined") {
  window.__readerProgress = { saveProgress, loadProgress, getShelf, addToShelf };
}
