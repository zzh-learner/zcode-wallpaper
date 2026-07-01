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

  // Scroll #sidebar so the current TOC chapter is centered.
  // The scroll container is #sidebar (overflow-y:auto). Probed findings that
  // shaped this:
  //   - #toc-list is overflow:visible, scrollHeight==clientHeight -> can't scroll
  //     there; scrollIntoView on .chap is a no-op.
  //   - .chap.offsetParent is BODY (not #sidebar), so walking the offsetParent
  //     chain never reaches #sidebar -> offsetTop-sum is wrong.
  //   - When collapsed, #sidebar.scrollTop holds a STALE value (e.g. 2203 from a
  //     prior view), and scrollHeight differs from the expanded value. So on
  //     expand we MUST re-set scrollTop, not leave it.
  // Reliable approach: use getBoundingClientRect deltas (viewport-relative, no
  // offsetParent dependency). target scrollTop = current scrollTop + (cur's offset
  // from sidebar's top edge) - (half the sidebar height) + half cur height.
  function scrollTocToCurrent(sb, delay) {
    sb = sb || $("sidebar");
    if (!sb) return;
    // delay lets the sidebar width transition (on expand) finish so
    // getBoundingClientRect reflects the visible layout, not the 0-width state.
    requestAnimationFrame(function () {
      setTimeout(function () {
        var cur = document.querySelector("#toc-list .chap.current");
        if (!cur) return;
        var cR = cur.getBoundingClientRect();
        var sR = sb.getBoundingClientRect();
        var offsetFromSidebarTop = cR.top - sR.top;
        var target = sb.scrollTop + offsetFromSidebarTop - (sb.clientHeight - cR.height) / 2;
        sb.scrollTop = Math.max(0, target);
      }, delay || 0);
    });
  }

  // Renders the chapter DOM by format dispatch. Returns the visible container.
  // txt -> the existing #chapter-content article (paragraph list, unchanged).
  // epub -> the #epub-content div (sanitized HTML fragment + cssHrefs links).
  // The body.epub-mode class toggles which container is visible (CSS hides the
  // other) so stale content from the prior format can't show through.
  function showChapterNode(ch) {
    if (ch.format === "epub") {
      document.body.classList.add("epub-mode");
      var ec = $("epub-content");
      ec.removeAttribute("hidden"); // un-hide the container (initially hidden in HTML)
      ec.innerHTML = "";
      // title
      var h = document.createElement("h2"); h.textContent = ch.title; ec.appendChild(h);
      // cssHrefs are absolute /api/book/.../asset URLs. Link-tagged directly here;
      // they are UNSCOPED (could leak to reader UI) — Task 10 replaces this with
      // fetched + scopeCss'd styles. Known transient state.
      var styleWrap = document.createElement("div");
      (ch.cssHrefs || []).forEach(function (href) {
        var link = document.createElement("link");
        link.rel = "stylesheet"; link.type = "text/css"; link.href = href;
        styleWrap.appendChild(link);
      });
      // epub HTML body fragment (already sanitized + src-rewritten server-side)
      var body = document.createElement("div");
      body.innerHTML = ch.html;
      ec.appendChild(styleWrap);
      ec.appendChild(body);
      return ec;
    } else {
      document.body.classList.remove("epub-mode");
      var art = $("chapter-content");
      art.innerHTML = "";
      var h2 = document.createElement("h2"); h2.textContent = ch.title; art.appendChild(h2);
      (ch.paragraphs || []).forEach(function (p) {
        var el = document.createElement("p"); el.textContent = p; art.appendChild(el);
      });
      return art;
    }
  }

  async function showChapter(n, restoreRatio) {
    if (!currentBook) return;
    var ch = await currentBook.getChapter(n);
    if (!ch) { showErr("无此章"); return; }
    currentChapter = n;
    $("chap-name").textContent = ch.title;
    var node = showChapterNode(ch);
    // highlight current in toc
    [].forEach.call(document.querySelectorAll("#toc-list .chap"), function (el) {
      el.classList.toggle("current", parseInt(el.dataset.idx, 10) === n);
    });
    // scroll current chapter into view in sidebar (scrollTocToCurrent handles
    // the real scroll container; the old scrollIntoView was a no-op — probed).
    scrollTocToCurrent();
    // restore scroll ratio
    var reader = $("reader");
    reader.scrollTop = restoreRatio ? restoreRatio * (reader.scrollHeight - reader.clientHeight) : 0;
    $("drop-hint").classList.add("hidden");
    // prefetch next
    if (ch.next !== null) currentBook.getChapter(ch.next).catch(function () {});
    // nav buttons
    $("prev-chap").disabled = (ch.prev === null);
    $("next-chap").disabled = (ch.next === null);
    // update shelf entry + re-render sidebar on chapter change so the "读到: 第X章"
    // label stays current (fix: sidebar only rendered once at init -> stale chapter
    // until manual refresh). Save preserves the current scroll ratio (don't clobber
    // a just-restored position with 0).
    var r2 = $("reader");
    var ratio2 = r2.scrollHeight > r2.clientHeight
      ? r2.scrollTop / (r2.scrollHeight - r2.clientHeight) : 0;
    currentBook.save(n, ratio2);
    shelf.addToShelf({ bookId: currentBook.id, filename: $("book-name").textContent,
      lastChapterTitle: ch.title });
    renderShelf();
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
      if (!/\.txt$/i.test(f.name)) { showErr("拖拽仅支持 .txt。epub 请放入 novels/ 由服务加载。"); return; }
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
      $("btn-shelf").onclick = function () {
        var sb = $("sidebar");
        sb.classList.toggle("collapsed");
        // When EXPANDING the sidebar, scroll the current chapter into view.
        // Pass a delay so the width transition (0 -> 220px) settles before we
        // measure getBoundingClientRect; measuring too early uses the collapsed
        // layout and lands on the wrong chapter.
        if (!sb.classList.contains("collapsed")) scrollTocToCurrent(sb, 150);
      };
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

      // Deep-link: if URL has ?book=<id>, open that book directly (control center
      // shelf click -> /reader/?book=<id>). Needs http mode (fetch /api/books
      // to resolve filename). book-router.js is loaded as window.__readerBookRouter.
      if (window.__readerBookRouter && bookApi.isHttpMode()) {
        var bid = window.__readerBookRouter.parseBookParam(location.search);
        if (bid) {
          fetch("/api/books").then(function (r) { return r.json(); }).then(function (books) {
            var b = null;
            for (var i = 0; i < books.length; i++) { if (books[i].id === bid) { b = books[i]; break; } }
            if (b) openBook(b.id, b.filename);
            else showErr("?book=" + bid + " 没找到对应的书");
          }).catch(function () { /* ignore; shelf still rendered */ });
        }
      }
    } catch (e) { showErr("初始化失败: " + e.message); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
