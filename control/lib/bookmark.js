// Bookmark library (spec §4/§5). Pure helpers for URL validation/normalization,
// go-url generation, bookmark entry construction. Dual export: CommonJS for Node
// tests + window.__ccBookmark for browser (mirrors control/lib/shelf.js).
//
// localStorage read/write (getBookmarks/addBookmark/removeBookmark) are browser-
// only and NOT unit-tested — mirrors shelf.js convention (shelftest only covers
// pure fns). They are verified by real-machine checklist (spec §9 第四层).

// Allowed URL protocols. http/https only — javascript:/data:/file: etc rejected
// (spec §5 决策 1, XSS defense, no exceptions).
function isAllowedProtocol(u) {
  return u.protocol === "http:" || u.protocol === "https:";
}

// normalizeUrl: validate + normalize user input. Returns {ok,url} or {ok:false,error}.
// (spec §4) Auto-prepends http:// when missing (NOT https:// — let browser handle
// http->https upgrade; this layer shouldn't assume target supports https).
function normalizeUrl(input) {
  var s = input == null ? "" : String(input).trim();
  if (!s) return { ok: false, error: "网址不能为空" };
  var withProto = s.indexOf("://") !== -1 ? s : "http://" + s;
  var parsed;
  try { parsed = new URL(withProto); }
  catch (e) { return { ok: false, error: "URL 无效" }; }
  if (!isAllowedProtocol(parsed)) return { ok: false, error: "只支持 http/https 网址" };
  return { ok: true, url: parsed.href };
}

// buildGoUrl: build the /control/go.html?... URL for a bookmark click. Both url
// and title are encodeURIComponent'd so & = # in URLs don't break query parsing.
function buildGoUrl(url, title) {
  var base = "/control/go.html?url=" + encodeURIComponent(url);
  if (title) base += "&title=" + encodeURIComponent(title);
  return base;
}

// bookmarkId: stable unique id. "bm_" + timestamp base36 + 2 random chars.
// NOT a URL hash (bookmarks can repeat URLs; hash collision would cause wrong
// delete). Timestamp+random guarantees uniqueness (spec §4).
function bookmarkId() {
  var rand = Math.random().toString(36).slice(2, 4);
  return "bm_" + Date.now().toString(36) + rand;
}

// makeBookmarkEntry: build a shelf-shape entry {id,title,url,createdAt}. Pure.
// title defaults to URL hostname when empty (spec §6: don't force user to type name).
function makeBookmarkEntry(input) {
  var title = (input.title || "").trim();
  if (!title) {
    try { title = new URL(input.url).hostname; } catch (e) { title = input.url; }
  }
  return { id: bookmarkId(), title: title, url: input.url, createdAt: Date.now() };
}

// ---- Browser-only localStorage ops (not unit-tested, mirror shelf.js) ----
function getBookmarks() {
  try { return JSON.parse(localStorage.getItem("zcode-control:bookmarks") || "[]"); }
  catch (e) { return []; }
}
function setBookmarks(arr) {
  try { localStorage.setItem("zcode-control:bookmarks", JSON.stringify(arr)); return true; }
  catch (e) { return false; }
}
function addBookmark(entry) {
  var arr = getBookmarks();
  arr.push(entry);  // NO dedup (spec §8 边界 6: user may want same host twice)
  return setBookmarks(arr);
}
function removeBookmark(id) {
  return setBookmarks(getBookmarks().filter(function (b) { return b.id !== id; }));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { isAllowedProtocol: isAllowedProtocol, normalizeUrl: normalizeUrl,
    buildGoUrl: buildGoUrl, bookmarkId: bookmarkId, makeBookmarkEntry: makeBookmarkEntry,
    getBookmarks: getBookmarks, setBookmarks: setBookmarks, addBookmark: addBookmark,
    removeBookmark: removeBookmark };
}
if (typeof window !== "undefined") {
  window.__ccBookmark = { isAllowedProtocol: isAllowedProtocol, normalizeUrl: normalizeUrl,
    buildGoUrl: buildGoUrl, bookmarkId: bookmarkId, makeBookmarkEntry: makeBookmarkEntry,
    getBookmarks: getBookmarks, setBookmarks: setBookmarks, addBookmark: addBookmark,
    removeBookmark: removeBookmark };
}
