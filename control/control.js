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
      // render shelf if shelf lib loaded
      if (window.__ccShelf) renderShelf();
    }).catch(function () { /* server down; retry next tick */ });
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

  function renderShelf() {
    var list = window.__ccShelf.getShelf();
    var el = document.getElementById("shelf-list");
    if (!el) return;
    if (!list.length) { el.innerHTML = '<span class="muted">书架空（在阅读器里打开书后会出现在这里）</span>'; return; }
    el.innerHTML = list.map(function (b) {
      return '<div class="book' + (b.stale ? " stale" : "") + '" data-book="' + encodeURIComponent(b.bookId) + '">' +
        esc(b.filename) + (b.lastChapterTitle ? ' · <small>' + esc(b.lastChapterTitle) + '</small>' : "") + '</div>';
    }).join("");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  setInterval(poll, POLL_MS);
  poll();
})();
