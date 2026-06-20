// Control center SPA controller: poll /api/status, dispatch actions, render.
// debug-port-down case (方案 1a, spec §6.1): CDP-dependent buttons disabled +
// guidance shown — control center never kills its own ZCode host.
(function () {
  var POLL_MS = 2000;

  function setStatusHtml(html) {
    var el = document.getElementById("status-panel");
    if (el) el.innerHTML = html;
  }
  function setJobMsg(text) {
    var el = document.getElementById("job-msg");
    if (el) el.textContent = text;
  }

  // poll status; disable CDP buttons when debug port down
  function poll() {
    fetch("/api/status").then(function (r) { return r.json(); }).then(function (st) {
      setStatusHtml(window.__ccStatusView.renderStatus(st));
      var cdpOk = !!(st.zcode && st.zcode.running);
      var cdpBtns = document.querySelectorAll('[data-action="injectImage"],[data-action="injectVideo"],[data-action="remove"]');
      for (var i = 0; i < cdpBtns.length; i++) cdpBtns[i].disabled = !cdpOk;
    }).catch(function () { /* server down; retry next tick */ });
    // refresh book list (for shelf add-region) + re-render shelf each poll
    fetch("/api/books").then(function (r) { return r.json(); }).then(function (books) {
      cachedBooks = books;
    }).catch(function () { /* keep last cached */ }).then(function () {
      if (window.__ccShelf) renderShelf();
    });
  }

  function dispatchAction(action, params) {
    var body = JSON.stringify(Object.assign({ action: action }, params || {}));
    setJobMsg("执行中: " + action + "...");
    return fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: body })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); });
  }

  document.getElementById("actions").addEventListener("click", function (e) {
    var action = e.target.getAttribute && e.target.getAttribute("data-action");
    if (!action) return;
    var params = action === "setTransparent"
      ? { opacityPct: parseInt(document.getElementById("opacity").value, 10) }
      : {};
    dispatchAction(action, params).then(function (res) {
      if (res.status === 409) setJobMsg("忙，请等当前动作完成");
      else if (!res.json.accepted) setJobMsg("拒绝: " + (res.json.error || ""));
      else { setJobMsg("已提交 (" + res.json.jobId + ")"); setTimeout(poll, 500); }
    }).catch(function (err) { setJobMsg("错误: " + err.message); });
  });

  document.getElementById("open-reader").addEventListener("click", function () {
    location.href = "/reader/"; // reader SPA, same server (spec §5.2 OQ)
  });

  // cached /api/books result (refreshed each poll) so renderShelf + add-region
  // share one fetch.
  var cachedBooks = null;

  function renderShelf() {
    var el = document.getElementById("shelf-list");
    if (!el || !window.__ccShelf) return;
    var list = window.__ccShelf.getShelf();
    var html = "";

    // Region 1: 我的书架 (localStorage) — click to open in reader, ✕ to remove
    html += '<div class="shelf-section-title">我的书架 (' + list.length + ')</div>';
    if (!list.length) {
      html += '<div class="muted">空 — 从下面"全部小说"加入，或在阅读器里打开书</div>';
    } else {
      list.forEach(function (b) {
        html += '<div class="book' + (b.stale ? " stale" : "") + '">' +
          '<span class="book-open" data-open="' + encodeURIComponent(b.bookId) + '" title="打开阅读">' +
          esc(b.filename) + (b.lastChapterTitle ? ' · <small>' + esc(b.lastChapterTitle) + '</small>' : "") + '</span>' +
          '<button class="book-del" data-del="' + encodeURIComponent(b.bookId) + '" title="从书架移除">✕</button>' +
          '</div>';
      });
    }

    // Region 2: 全部小说 (server /api/books) not yet on shelf — + to add
    if (cachedBooks) {
      var addable = window.__ccShelf.shelfDiff(list, cachedBooks);
      html += '<div class="shelf-section-title">全部小说 (可加入 ' + addable.length + ')</div>';
      if (!addable.length) {
        html += '<div class="muted">都已加入书架</div>';
      } else {
        addable.forEach(function (b) {
          html += '<div class="book addable">' +
            '<span>' + esc(b.filename) + ' <small>(' + b.totalChapters + ' 章)</small></span>' +
            '<button class="book-add" data-add="' + encodeURIComponent(b.id) + '" title="加入书架">+</button>' +
            '</div>';
        });
      }
    }
    el.innerHTML = html;
  }

  // shelf event delegation: open / del / add (one listener on the container)
  document.getElementById("shelf-list").addEventListener("click", function (e) {
    var t = e.target;
    var openId = t.getAttribute && t.getAttribute("data-open");
    var delId = t.getAttribute && t.getAttribute("data-del");
    var addId = t.getAttribute && t.getAttribute("data-add");
    if (openId) {
      // jump to reader with ?book=<id> (reader deep-links to that book)
      location.href = "/reader/?book=" + openId;
    } else if (delId) {
      window.__ccShelf.removeBook(decodeURIComponent(delId));
      renderShelf();
    } else if (addId && cachedBooks) {
      // find the api book by id, add it
      var found = null;
      for (var i = 0; i < cachedBooks.length; i++) { if (cachedBooks[i].id === addId) { found = cachedBooks[i]; break; } }
      if (found) { window.__ccShelf.addToShelf(found); renderShelf(); }
    }
  });

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  setInterval(poll, POLL_MS);
  poll();
})();
