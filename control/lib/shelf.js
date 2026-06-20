// Shelf management (spec §4 B3). Reuses reader's progress in localStorage
// (key zcode-reader:shelf) so bookshelf state is shared with the reader SPA.
// Dual export: CommonJS for Node tests + window.__ccShelf for browser.
// bookId mirrors reader-server.cjs bookIdFor (stable filename hash).
function bookId(filename) {
  var h = 5381;
  for (var i = 0; i < filename.length; i++) h = ((h << 5) + h + filename.charCodeAt(i)) | 0;
  return "b" + (h >>> 0).toString(36);
}

// resolveStaleBookId: filename-based association repair (spec §5.2, NO content
// hash). Returns {newBookId, newFilename} if the stale entry's filename still
// exists in currentFiles, else null (file renamed/deleted -> user re-drag).
function resolveStaleBookId(staleEntry, currentFiles) {
  if (!staleEntry || !staleEntry.filename) return null;
  if (!currentFiles || currentFiles.indexOf(staleEntry.filename) === -1) return null;
  return { newBookId: bookId(staleEntry.filename), newFilename: staleEntry.filename };
}

// shelfDiff: books in `allBooks` (from /api/books, shape {id,filename,...}) that
// are NOT yet on the local shelf. Used to render the "全部小说 (可加入)" region.
// Pure — takes the shelf array + allBooks array, returns the addable subset.
function shelfDiff(shelfArr, allBooks) {
  var onShelf = {};
  (shelfArr || []).forEach(function (s) { onShelf[s.bookId] = true; });
  return (allBooks || []).filter(function (b) { return !onShelf[b.id]; });
}

// makeShelfEntry: build a shelf entry (localStorage shape) from an /api/books
// item. Pure constructor.
function makeShelfEntry(apiBook) {
  return { bookId: apiBook.id, filename: apiBook.filename, lastChapterTitle: null, updatedAt: Date.now() };
}

// Browser-only shelf ops (guarded by localStorage availability).
function getShelf() {
  try { return JSON.parse(localStorage.getItem("zcode-reader:shelf") || "[]"); }
  catch (e) { return []; }
}
function setShelf(arr) {
  try { localStorage.setItem("zcode-reader:shelf", JSON.stringify(arr)); } catch (e) {}
}
function removeBook(bookId) {
  setShelf(getShelf().filter(function (b) { return b.bookId !== bookId; }));
}
// addToShelf: add an /api/books item to the local shelf (no-op if already there).
function addToShelf(apiBook) {
  var arr = getShelf();
  var entry = makeShelfEntry(apiBook);
  if (arr.some(function (b) { return b.bookId === entry.bookId; })) return false;
  arr.push(entry);
  setShelf(arr);
  return true;
}
// repairAll: walk shelf, re-key any entry whose filename still exists but whose
// bookId drifted (e.g. hash scheme change). Returns count repaired.
function repairAll(currentFiles) {
  var s = getShelf();
  var n = 0;
  var fixed = s.map(function (b) {
    var r = resolveStaleBookId(b, currentFiles);
    if (r && r.newBookId !== b.bookId) { n++; return Object.assign({}, b, { bookId: r.newBookId }); }
    return b;
  });
  setShelf(fixed);
  return n;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { resolveStaleBookId: resolveStaleBookId, bookId: bookId, repairAll: repairAll, removeBook: removeBook, getShelf: getShelf, shelfDiff: shelfDiff, makeShelfEntry: makeShelfEntry, addToShelf: addToShelf };
}
if (typeof window !== "undefined") {
  window.__ccShelf = { resolveStaleBookId: resolveStaleBookId, bookId: bookId, repairAll: repairAll, removeBook: removeBook, getShelf: getShelf, shelfDiff: shelfDiff, makeShelfEntry: makeShelfEntry, addToShelf: addToShelf };
}
