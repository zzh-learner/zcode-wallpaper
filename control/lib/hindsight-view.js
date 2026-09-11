// Hindsight 面板渲染 + 接线。镜像 status-view.js / skin-view.js 形态：
// 纯渲染函数（state JSON -> HTML 字符串）+ IIFE 接线（节流刷新、事件委托）。
// 双导出：CommonJS 供 Node 测（hindsightviewtest.cjs）+ window.__ccHindsightView。
//
// 数据面（server 路由见 lib/control-server.cjs hindsight 段）：
//   GET  /api/hindsight/status|config|banks|banks/:id/pages|logs
//   POST /api/hindsight/server/start|stop（即时返回结果，无 jobId —— 与 muteVideo 同款即时面）
//
// 渲染策略：panel 内 4 个独立子容器（status/config/banks/logs），各自
// "HTML 串相同则不碰 DOM"——5s 轮询重渲染不会打断 <details> 展开态和滚动位置，
// 只有数据真变了才重建对应区块（skin-view 的 select 选择被轮询冲掉的教训同型）。
(function () {
  var REFRESH_MS = 5000; // control.js poll 2s 一次调 tick()，这里节流到 5s 实际刷新

  // ---- state ----
  var st = null;       // /api/hindsight/status
  var cfg = null;      // /api/hindsight/config
  var banks = null;    // /api/hindsight/banks -> {banks|error}
  var pages = {};      // bankId -> {pages|error}（按需 fetch）
  var expanded = {};   // bankId -> true（展开态跨重渲染保留）
  var busy = "";       // "" | "start" | "stop"
  var logs = null;     // {pluginLog, daemonLog}
  var logsOpen = false;
  var lastTick = 0;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }
  function $(id) { return (typeof document !== "undefined") ? document.getElementById(id) : null; }

  // HTML 串相同则不碰 DOM（保 <details> 展开态 / 滚动位置 / 按钮焦点）。
  function setHtml(id, html) {
    var el = $(id);
    if (el && el._hsLast !== html) { el._hsLast = html; el.innerHTML = html; }
  }
  function tabActive() {
    if (typeof document === "undefined") return false;
    var pane = document.querySelector('.tab-pane[data-pane="hindsight"]');
    return !!(pane && pane.classList.contains("active"));
  }

  // control.js poll 每 2s 调一次；tab 不可见时不刷新（dsh manager 同款省流策略）
  function tick() {
    if (!tabActive()) return;
    if (Date.now() - lastTick < REFRESH_MS) return;
    lastTick = Date.now();
    refresh();
  }

  function refresh() {
    fetch("/api/hindsight/status").then(function (r) { return r.json(); })
      .then(function (j) { st = j; render(); }).catch(function () {});
    fetch("/api/hindsight/config").then(function (r) { return r.json(); })
      .then(function (j) { cfg = j; render(); }).catch(function () {});
    fetch("/api/hindsight/banks").then(function (r) { return r.json(); })
      .then(function (j) { banks = j; render(); }).catch(function () {});
  }

  function render() {
    setHtml("hs-status", buildStatusHtml(st, busy));
    setHtml("hs-config", buildConfigHtml(cfg));
    setHtml("hs-banks", buildBanksHtml(banks, expanded, pages));
    setHtml("hs-logs", buildLogsHtml(logs, logsOpen));
  }

  // ---- 动作（即时面，无 jobId）----
  function doServerAction(which) {
    if (busy) return;
    busy = which;
    setMsg(which === "start" ? "启动中…（就绪靠健康轮询，稍等几秒）" : "停止中…（端口杀最多等 ~5s）");
    render();
    fetch("/api/hindsight/server/" + which, { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        setMsg(j.ok ? "已" + (which === "start" ? "提交启动" : "停止") + "：" + (j.method || "") : "失败：" + (j.detail || j.method || ""));
        busy = "";
        lastTick = 0; tick(); // 立即刷新
      })
      .catch(function (e) { setMsg("错误: " + e.message); busy = ""; render(); });
  }

  var msgTimer = null;
  function setMsg(text) {
    var el = $("hs-msg");
    if (!el) return;
    el.textContent = text;
    el.className = "toast-inline hs-msg";
    if (msgTimer) { clearTimeout(msgTimer); msgTimer = null; }
    msgTimer = setTimeout(function () { el.textContent = ""; msgTimer = null; }, 4000);
  }

  // ---- 事件委托（面板级单监听；closest 向上找，教训 25 同型）----
  var panel = $("hindsight-panel");
  if (panel) {
    panel.addEventListener("click", function (e) {
      var node = e.target;
      while (node && node !== panel) {
        var act = node.getAttribute && node.getAttribute("data-hs");
        var exp = node.getAttribute && node.getAttribute("data-hs-exp");
        if (act === "start" || act === "stop") { doServerAction(act); return; }
        if (exp) {
          var id = decodeURIComponent(exp);
          if (expanded[id]) { delete expanded[id]; render(); }
          else {
            expanded[id] = true;
            render();
            if (!pages[id]) {
              fetch("/api/hindsight/banks/" + encodeURIComponent(id) + "/pages")
                .then(function (r) { return r.json(); })
                .then(function (j) { pages[id] = j; render(); })
                .catch(function (err) { pages[id] = { error: String(err) }; render(); });
            }
          }
          return;
        }
        if (act === "logs") {
          logsOpen = true;
          loadLogs();
          return;
        }
        if (act === "logs-refresh") { loadLogs(); return; }
        node = node.parentNode;
      }
    });
  }

  function loadLogs() {
    logs = logs || { loading: true };
    render();
    fetch("/api/hindsight/logs?lines=200").then(function (r) { return r.json(); })
      .then(function (j) { logs = j; render(); }).catch(function (e) { logs = { error: String(e) }; render(); });
  }

  // =========================================================================
  // 纯渲染函数（dual export；Node 测 hindsightviewtest.cjs）
  // =========================================================================

  function groupLabel(g) {
    return ({ server: "服务器", daemon: "Daemon", bank: "记忆库解析", memory: "记忆行为", survey: "代码库调研", logging: "日志" })[g] || g;
  }
  function sourceLabel(s) {
    return ({ default: "默认值", env: "环境变量", file: "文件", "file:harness": "文件·harness" })[s] || s;
  }
  function sourceClass(s) {
    return ({ default: "hs-src-default", env: "hs-src-env", file: "hs-src-file", "file:harness": "hs-src-harness" })[s] || "hs-src-default";
  }
  function fmtWhen(iso) {
    if (!iso) return "—";
    try { var d = new Date(iso); return isNaN(d.getTime()) ? String(iso) : d.toLocaleString(); }
    catch (e) { return String(iso); }
  }
  function fmtVal(v) {
    if (v === undefined) return "—";
    if (typeof v === "object" && v !== null) {
      try { return esc(JSON.stringify(v)); } catch (e) { return esc(String(v)); }
    }
    return esc(v === "" ? '""' : v);
  }

  /** 状态区块：health 徽章 + 关键元信息 + 启停按钮。st=null -> 加载中。 */
  function buildStatusHtml(st, busy) {
    if (!st) return '<h3>记忆服务 (Hindsight)</h3><div class="empty-state">加载中…</div>';
    var h = '<div class="shelf-head"><h3>记忆服务 (Hindsight)</h3><div class="hs-actions">' +
      '<button class="primary" data-hs="start"' + (busy || st.running ? " disabled" : "") + '>启动服务</button>' +
      '<button class="danger" data-hs="stop"' + (busy || !st.running ? " disabled" : "") + '>停止服务</button>' +
      '</div></div>';
    if (busy) h += '<div class="hs-msg" id="hs-msg">' + (busy === "start" ? "启动中…" : "停止中…") + '</div>';
    else h += '<span class="hs-msg" id="hs-msg"></span>';
    h += '<div class="status-row"><div class="status-main">' +
      '<span class="status-label">状态</span><span class="status-value">' +
      (st.running
        ? '<span class="ok"><span class="dot"></span>运行中</span>'
        : '<span class="warn">已停止</span>') +
      '</span></div></div>';
    var version = st.version && st.version.api_version ? " · API v" + st.version.api_version : "";
    h += '<div class="hs-kv"><b>模式</b> ' + esc(st.serverMode) + version + ' · <b>地址</b> ' + esc(st.apiUrl) + '</div>';
    h += '<div class="hs-kv"><b>profile</b> ' + esc(st.profile) + (st.profileByPort ? "（按端口匹配）" : "（默认，未匹配到端口）") + '</div>';
    if (!st.embedAvailable) {
      h += '<div class="banner warn-banner">⚠ hindsight-embed 不在 PATH —— 启动需要它（uv tool install hindsight-embed）</div>';
    }
    if (!st.running) {
      h += '<div class="hs-kv">self-hosted 模式下插件不会自动拉起服务；记忆功能（🧠 横幅 / hooks）依赖此服务。</div>';
    }
    if (st.error) h += '<div class="hs-kv hs-err">探测: ' + esc(st.error) + '</div>';
    if (st.paths) {
      h += '<details class="hs-details"><summary>路径</summary><div class="hs-kv">数据库: ' + esc(st.paths.database) + '</div>' +
        '<div class="hs-kv">插件日志: ' + esc(st.paths.pluginLog) + '</div>' +
        '<div class="hs-kv">服务日志: ' + esc(st.paths.daemonLog) + '</div></details>';
    }
    return h;
  }

  /** 配置区块：分组表格（生效值 + 来源）+ envActive + 脱敏 raw JSON 折叠。 */
  function buildConfigHtml(cfg) {
    if (!cfg) return "";
    var h = '<div class="shelf-section-title">配置（' + esc(cfg.path) + (cfg.exists ? "" : " · 文件不存在") + '）</div>';
    if (cfg.error) h += '<div class="banner warn-banner">⚠ ' + esc(cfg.error) + '</div>';
    var byGroup = {};
    var order = [];
    for (var i = 0; i < cfg.items.length; i++) {
      var it = cfg.items[i];
      if (!byGroup[it.group]) { byGroup[it.group] = []; order.push(it.group); }
      byGroup[it.group].push(it);
    }
    for (var g = 0; g < order.length; g++) {
      var grp = order[g];
      h += '<details class="hs-details"><summary>' + esc(groupLabel(grp)) + '（' + byGroup[grp].length + ' 项）</summary>' +
        '<table class="hs-table"><tr><th>键</th><th>生效值</th><th>来源</th></tr>';
      for (var k = 0; k < byGroup[grp].length; k++) {
        var row = byGroup[grp][k];
        h += '<tr><td>' + esc(row.key) + '</td><td>' + fmtVal(row.value) + '</td>' +
          '<td><span class="hs-src ' + sourceClass(row.source) + '">' + esc(sourceLabel(row.source)) + '</span></td></tr>';
      }
      h += '</table></details>';
    }
    if (cfg.envActive && cfg.envActive.length) {
      h += '<div class="hs-kv"><b>生效环境变量</b> ' + cfg.envActive.map(function (e) { return esc(e.envVar); }).join(" · ") + '</div>';
    }
    if (cfg.bankSections && cfg.bankSections.length) {
      h += '<div class="hs-kv"><b>banks 小节</b> ' + cfg.bankSections.map(function (b) { return esc(b.id) + " (" + b.keys.length + ")"; }).join(" · ") + '</div>';
    }
    if (cfg.raw) {
      h += '<details class="hs-details"><summary>原始 JSON（敏感字段已脱敏）</summary><pre class="hs-pre">' +
        esc(JSON.stringify(cfg.raw, null, 2)) + '</pre></details>';
    }
    return h;
  }

  /** banks 排序（最后写入时间倒序，空值垫底）。 */
  function sortBanks(list) {
    return (list || []).slice().sort(function (a, b) {
      var ta = a.last_write_at ? Date.parse(a.last_write_at) : 0;
      var tb = b.last_write_at ? Date.parse(b.last_write_at) : 0;
      if (isNaN(ta)) ta = 0;
      if (isNaN(tb)) tb = 0;
      return tb - ta;
    });
  }

  /** 记忆库区块：bank 列表 + 展开知识页树。 */
  function buildBanksHtml(banks, expanded, pages) {
    if (!banks) return "";
    var h = '<div class="shelf-section-title">记忆库</div>';
    if (banks.error) return h + '<div class="empty-state">读取失败: ' + esc(banks.error) + '（服务没开？）</div>';
    var list = banks.banks || [];
    if (!list.length) return h + '<div class="empty-state">没有记忆库</div>';
    list = sortBanks(list);
    h += '<div class="hs-kv">共 ' + list.length + ' 个，按最后写入排序</div>';
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var isOpen = !!expanded[b.bank_id];
      h += '<div class="list-item hs-bank' + (isOpen ? " hs-bank-open" : "") + '">' +
        '<span class="hs-bank-toggle" data-hs-exp="' + encodeURIComponent(b.bank_id) + '">' +
        (isOpen ? "▾ " : "▸ ") + esc(b.bank_id) +
        ' <small>' + esc(b.fact_count == null ? "—" : b.fact_count) + ' 条事实 · 写入 ' + esc(fmtWhen(b.last_write_at)) + '</small></span>' +
        '</div>';
      if (isOpen) {
        var pg = pages[b.bank_id];
        if (!pg) h += '<div class="hs-tree-indent hs-kv">加载知识页…</div>';
        else if (pg.error) h += '<div class="hs-tree-indent hs-err">读取失败: ' + esc(pg.error) + '</div>';
        else if (!pg.pages || !pg.pages.length) h += '<div class="hs-tree-indent hs-kv">（无知识页）</div>';
        else h += buildTreeHtml(pg.pages, 0);
      }
    }
    return h;
  }

  /** 知识页树（递归）。node: {id, kind, name, description, children}。 */
  function buildTreeHtml(nodes, depth) {
    var h = "";
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var isFolder = n.kind === "folder" || (n.children && n.children.length);
      h += '<div class="hs-tree-node" style="padding-left:' + (depth * 14) + 'px">' +
        (isFolder ? '<span class="hs-tree-folder">📁 ' : "📄 ") + esc(n.name || n.id) + '</span></div>';
      if (n.children && n.children.length) h += buildTreeHtml(n.children, depth + 1);
    }
    return h;
  }

  /** 日志区块：默认收起，点击拉两段 tail。 */
  function buildLogsHtml(logs, open) {
    var h = '<div class="shelf-section-title">日志</div>';
    if (!open) {
      return h + '<button data-hs="logs">查看日志（末尾 200 行）</button>';
    }
    h += '<button data-hs="logs-refresh">刷新</button>';
    if (!logs || logs.loading) return h + '<div class="empty-state">加载中…</div>';
    if (logs.error) return h + '<div class="empty-state">读取失败: ' + esc(logs.error) + '</div>';
    h += logBlock("插件日志", logs.pluginLog) + logBlock("服务日志 (daemon)", logs.daemonLog);
    return h;
  }
  function logBlock(title, t) {
    if (!t) return "";
    var h = '<details class="hs-details" open><summary>' + esc(title) + ' — ' + esc(t.path) + '</summary>';
    if (!t.exists) h += '<div class="hs-kv">文件不存在</div>';
    else if (t.error) h += '<div class="hs-err">' + esc(t.error) + '</div>';
    else h += '<pre class="hs-pre hs-pre-log">' + esc(t.lines.join("\n")) + '</pre>';
    return h + "</details>";
  }

  // ---- dual export ----
  var api = {
    tick: tick, refresh: refresh,
    groupLabel: groupLabel, sourceLabel: sourceLabel, sourceClass: sourceClass,
    fmtWhen: fmtWhen, fmtVal: fmtVal, sortBanks: sortBanks,
    buildStatusHtml: buildStatusHtml, buildConfigHtml: buildConfigHtml,
    buildBanksHtml: buildBanksHtml, buildTreeHtml: buildTreeHtml, buildLogsHtml: buildLogsHtml,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.__ccHindsightView = api;
})();
