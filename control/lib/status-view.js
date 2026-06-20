// Status renderer — pure (status JSON -> HTML string). Dual export: CommonJS
// for Node tests + window.__ccStatusView for browser (spec §4 B2).
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
  });
}
function renderStatus(st) {
  var z = st.zcode, w = st.wallpaper, t = st.transparent, r = st.reader, res = st.resources;
  var zHtml = z
    ? '<span class="ok">● 运行中</span> 端口 ' + esc(z.debugPort) + ' | 窗口 ' + esc(z.pageTargets)
    : '<span class="warn">调试端口未开</span> — 请从 wallpaper.bat 场景 2 重启 ZCode';
  var wHtml;
  if (w && w.mode && w.mode !== "none") {
    wHtml = esc(w.mode === "video" ? "视频壁纸" : "图片壁纸") + ' | 注入 ' + esc(w.injectedWindows) + '/' + esc(w.totalWindows);
  } else {
    wHtml = '<span class="muted">未注入</span>';
  }
  var tHtml;
  if (!t) tHtml = '<span class="muted">—</span>';
  else if (t.enabled === true) tHtml = '透明 ' + esc(t.opacityPct) + '%';
  else if (t.enabled === "unknown") tHtml = '<span class="warn">未知（未通过控制中心设置）</span>';
  else tHtml = '<span class="muted">未启用</span>';
  var rHtml = r && r.running ? '运行中 :' + esc(r.port) : '<span class="muted">未运行</span>';
  var resHtml = res
    ? '图 ' + esc(res.images) + ' | 缩图 ' + esc(res.thumbs) + ' | 视频 ' + esc(res.videos) +
      ' | 小说 ' + esc(res.novels) + ' | 依赖 ' + (res.deps && res.deps.sharp ? '✓' : '✗')
    : '';
  var rot = st.rotate;
  var rotHtml;
  if (!rot) rotHtml = '<span class="muted">—</span>';
  else if (!rot.running) rotHtml = rot.stale ? '<span class="warn">轮播已停（进程退出）</span>' : '<span class="muted">未轮播</span>';
  else {
    var nextStr = rot.nextSwitchAt ? new Date(rot.nextSwitchAt).toLocaleTimeString() : '—';
    rotHtml = esc(rot.mode === 'video' ? '视频' : '图片') + ' 轮播 | 每 ' + esc(Math.round(rot.intervalMs / 60000)) + 'min | 下次 ' + esc(nextStr) + ' | 当前 ' + esc(rot.lastFile || '—');
  }
  return '<div class="st">' + zHtml + '</div>' +
    '<div class="st">' + wHtml + '</div>' +
    '<div class="st">' + tHtml + '</div>' +
    '<div class="st">' + rHtml + '</div>' +
    '<div class="st">' + resHtml + '</div>' +
    '<div class="st">' + rotHtml + '</div>';
}
if (typeof module !== "undefined" && module.exports) module.exports = { renderStatus: renderStatus };
if (typeof window !== "undefined") window.__ccStatusView = { renderStatus: renderStatus };
