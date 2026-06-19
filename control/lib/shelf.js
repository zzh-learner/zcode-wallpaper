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
// exists in currentFiles, else null (file renamed/deleted -> user re-drags).
function resolveStaleBookId(staleEntry, currentFiles) {
  if (!staleEntry || !staleEntry.filename) return null;
  if (!currentFiles || currentFiles.indexOf(staleEntry.filename) === -1) return null;
  return { newBookId: bookId(staleEntry.filename), newFilename: staleEntry.filename };
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
  module.exports = { resolveStaleBookId: resolveStaleBookId, bookId: bookId, repairAll: repairAll, removeBook: removeBook, getShelf: getShelf };
}
if (typeof window !== "undefined") {
  window.__ccShelf = { resolveStaleBookId: resolveStaleBookId, bookId: bookId, repairAll: repairAll, removeBook: removeBook, getShelf: getShelf };
}
