// Main glue: the only file that touches DOM. Spec §4. Keep it thin.
// libs are loaded as globals: __readerCodec, __readerToc, __readerProgress, __readerBook.
(function () {
  "use strict";
  var currentBook = null;
  var currentChapter = -1;
  var saveTimer = null;

  function $(id) { return document.getElementById(id); }
  var shelf = window.__readerProgress;
  var bookApi = window.__readerBook;

  function showErr(msg) { var b = $("err-banner"); b.textContent = msg; b.classList.remove("hidden"); }
  function clearErr() { $("err-banner").classList.add("hidden"); }

  // ---- shelf list render ----
  async function renderShelf() {
    var box = $("shelf-list");
    box.innerHTML = "";
    var header = document.createElement("div");
    header.className = "vol";
    header.textContent = "书架";
    box.appendChild(header);

    if (bookApi.isHttpMode()) {
      try {
        var books = await fetch("/api/books").then(r => r.json());
        var local = shelf.getShelf();
        // sort: books with progress first (by updatedAt), then the rest
        var progressMap = {}; local.forEach(s => progressMap[s.bookId] = s);
        books.sort(function (a, b) {
          var pa = progressMap[a.id], pb = progressMap[b.id];
          return (pb ? pb.updatedAt : 0) - (pa ? pa.updatedAt : 0);
        });
        if (books.length === 0) {
          var e = document.createElement("div"); e.className = "chap"; e.style.color = "var(--c-fg-muted)";
          e.textContent = "novels/ 为空，把 .txt 放进去后重启服务。"; box.appendChild(e); return;
        }
        books.forEach(function (b) {
          var item = document.createElement("div"); item.className = "shelf-item";
          var p = progressMap[b.id];
          var title = document.createElement("span"); title.textContent = b.filename;
          if (b.encodingSuspect) title.textContent = "⚠️ " + title.textContent;
          item.appendChild(title);
          if (p) { var s = document.createElement("small"); s.textContent = "读到: " + (p.lastChapterTitle || ("第" + (p.chapterIndex + 1) + "章")); item.appendChild(s); }
          item.onclick = function () { openBook(b.id, b.filename); };
          box.appendChild(item);
        });
      } catch (e) {
        var ee = document.createElement("div"); ee.className = "chap"; ee.style.color = "var(--c-fg-muted)";
        ee.textContent = "未连接服务，拖入 .txt 即可阅读。"; box.appendChild(ee);
      }
    } else {
      // drag mode: show only books with progress (greyed, hint to re-drag)
      var local2 = shelf.getShelf();
      if (local2.length === 0) {
        var ne = document.createElement("div"); ne.className = "chap"; ne.style.color = "var(--c-fg-muted)";
        ne.textContent = "拖入 .txt 开始阅读。"; box.appendChild(ne);
      }
      local2.forEach(function (s) {
        var item = document.createElement("div"); item.className = "shelf-item";
        item.textContent = s.filename + " (重新拖入关联)";
        box.appendChild(item);
      });
    }
  }

  async function openBook(bookId, filename) {
    clearErr();
    try {
      currentBook = await bookApi.open(bookId);
      $("book-name").textContent = filename || bookId;
      await renderToc();
      var p = await currentBook.load();
      var start = (p && typeof p.chapterIndex === "number") ? p.chapterIndex : 0;
      var ratio = (p && typeof p.scrollRatio === "number") ? p.scrollRatio : 0;
      await showChapter(start, ratio);
      $("sidebar").classList.add("collapsed");
    } catch (e) { showErr("打开失败: " + e.message); }
  }

  async function renderToc() {
    var box = $("toc-list"); box.innerHTML = "";
    var toc = await currentBook.getToc();
    // if volumes exist, group chapters under them; else flat
    if (toc.volumes.length > 0) {
      toc.volumes.forEach(function (v, vi) {
        var vd = document.createElement("div"); vd.className = "vol"; vd.textContent = v.title; box.appendChild(vd);
        var end = (toc.volumes[vi + 1] || { startChapterIndex: toc.chapters.length }).startChapterIndex;
        for (var i = v.startChapterIndex; i < end; i++) addChapItem(box, i, toc.chapters[i].title);
      });
    } else {
      toc.chapters.forEach(function (c, i) { addChapItem(box, i, c.title); });
    }
  }
  function addChapItem(box, idx, title) {
    var d = document.createElement("div"); d.className = "chap"; d.dataset.idx = idx;
    d.textContent = title; d.onclick = function () { showChapter(idx, 0); };
    box.appendChild(d);
  }

  async function showChapter(n, restoreRatio) {
    if (!currentBook) return;
    var ch = await currentBook.getChapter(n);
    if (!ch) { showErr("无此章"); return; }
    currentChapter = n;
    $("chap-name").textContent = ch.title;
    var art = $("chapter-content");
    art.innerHTML = "";
    var h = document.createElement("h2"); h.textContent = ch.title; art.appendChild(h);
    ch.paragraphs.forEach(function (p) { var el = document.createElement("p"); el.textContent = p; art.appendChild(el); });
    // highlight current in toc
    [].forEach.call(document.querySelectorAll("#toc-list .chap"), function (el) {
      el.classList.toggle("current", parseInt(el.dataset.idx, 10) === n);
    });
    // scroll current into view in toc
    var cur = document.querySelector("#toc-list .chap.current");
    if (cur) cur.scrollIntoView({ block: "nearest" });
    // restore scroll ratio
    var reader = $("reader");
    reader.scrollTop = restoreRatio ? restoreRatio * (reader.scrollHeight - reader.clientHeight) : 0;
    $("drop-hint").classList.add("hidden");
    // prefetch next
    if (ch.next !== null) currentBook.getChapter(ch.next).catch(function () {});
    // nav buttons
    $("prev-chap").disabled = (ch.prev === null);
    $("next-chap").disabled = (ch.next === null);
  }

  // ---- scroll -> save progress (debounced) ----
  function onScroll() {
    if (!currentBook || currentChapter < 0) return;
    var reader = $("reader");
    var ratio = reader.scrollHeight > reader.clientHeight
      ? reader.scrollTop / (reader.scrollHeight - reader.clientHeight) : 0;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      currentBook.save(currentChapter, ratio);
      // also update shelf entry
      shelf.addToShelf({ bookId: currentBook.id, filename: $("book-name").textContent,
        lastChapterTitle: $("chap-name").textContent });
    }, 1000);
  }

  // ---- drag & drop ----
  function setupDrag() {
    document.addEventListener("dragover", function (e) { e.preventDefault(); document.body.classList.add("dragging"); });
    document.addEventListener("dragleave", function (e) { document.body.classList.remove("dragging"); });
    document.addEventListener("drop", async function (e) {
      e.preventDefault(); document.body.classList.remove("dragging");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (!/\.txt$/i.test(f.name)) { showErr("仅支持 .txt"); return; }
      clearErr();
      try {
        var buf = await f.arrayBuffer();
        currentBook = await bookApi.open({ filename: f.name, arrayBuffer: buf, bookId: "drag-" + f.name });
        $("book-name").textContent = f.name;
        await renderToc();
        var p = await currentBook.load();
        await showChapter(p && typeof p.chapterIndex === "number" ? p.chapterIndex : 0,
          p && typeof p.scrollRatio === "number" ? p.scrollRatio : 0);
        $("sidebar").classList.add("collapsed");
      } catch (err) { showErr("读取失败: " + err.message); }
    });
  }

  // ---- font size ----
  function setFont(delta) {
    var root = document.documentElement;
    var cur = parseInt(getComputedStyle(root).getPropertyValue("--font-size"), 10) || 17;
    cur = Math.max(12, Math.min(28, cur + delta));
    root.style.setProperty("--font-size", cur + "px");
  }

  // ---- wiring ----
  function init() {
    try {
      $("btn-shelf").onclick = function () { $("sidebar").classList.toggle("collapsed"); };
      $("font-inc").onclick = function () { setFont(1); };
      $("font-dec").onclick = function () { setFont(-1); };
      $("theme-toggle").onclick = function () {
        var order = ["theme-dark", "theme-light", "theme-sepia"];
        var cur = order.findIndex(function (t) { return document.body.classList.contains(t); });
        document.body.classList.remove(order[cur]);
        document.body.classList.add(order[(cur + 1) % order.length]);
        $("theme-toggle").textContent = { "theme-dark": "🌙", "theme-light": "☀", "theme-sepia": "📜" }[order[(cur + 1) % order.length]];
      };
      $("prev-chap").onclick = function () { if (currentChapter > 0) showChapter(currentChapter - 1, 0); };
      $("next-chap").onclick = function () { showChapter(currentChapter + 1, 0); };
      $("refresh-shelf").onclick = renderShelf;
      $("reader").addEventListener("scroll", onScroll, { passive: true });

      // keyboard: left/right = prev/next chap
      document.addEventListener("keydown", function (e) {
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
        if (e.key === "ArrowLeft" && currentChapter > 0) showChapter(currentChapter - 1, 0);
        if (e.key === "ArrowRight") showChapter(currentChapter + 1, 0);
      });

      setupDrag();
      renderShelf();
    } catch (e) { showErr("初始化失败: " + e.message); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
