// Status renderer — pure (status JSON -> HTML string). Dual export: CommonJS
// for Node tests + window.__ccStatusView for browser (spec §4 B2).
// 行项风格（spec §6）：左标题右状态 + 次要信息行 + 异常行高亮。
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
  });
}
// 渲染单行：label(主文字) + valueHtml(状态，含 .ok/.warn/.err/.muted) + subHtml(次要信息)
// rowClass 可选：异常行加 warn-row/err-row 弱底高亮。
function row(label, valueHtml, subHtml, rowClass) {
  return '<div class="status-row' + (rowClass ? " " + rowClass : "") + '">' +
    '<div class="status-main">' +
      '<span class="status-label">' + label + '</span>' +
      '<span class="status-value">' + valueHtml + '</span>' +
    '</div>' +
    (subHtml ? '<div class="status-sub">' + subHtml + '</div>' : '') +
  '</div>';
}
function renderStatus(st) {
  var z = st.zcode, w = st.wallpaper, t = st.transparent, r = st.reader, res = st.resources;
  // ZCode 行
  var zVal, zSub, zRow;
  if (z) {
    zVal = '<span class="ok"><span class="dot"></span>运行中</span>';
    zSub = '端口 ' + esc(z.debugPort) + ' · 窗口 ' + esc(z.pageTargets);
  } else {
    zVal = '<span class="warn">调试端口未开</span>';
    zSub = '请从 wallpaper.bat 场景 2 重启 ZCode';
    zRow = "warn-row";
  }
  // 壁纸行
  var wVal, wSub;
  if (w && w.mode && w.mode !== "none") {
    wVal = esc(w.mode === "video" ? "视频壁纸" : "图片壁纸");
    wSub = '注入 ' + esc(w.injectedWindows) + '/' + esc(w.totalWindows);
    if (w.mode === "video") {
      wSub += ' · ' + (w.videoMuted ? '🔇 静音' : '🔊 有声');
    }
  } else {
    wVal = '<span class="muted">未注入</span>';
    wSub = '';
  }
  // 透明行
  var tVal, tRow;
  if (!t) { tVal = '<span class="muted">—</span>'; }
  else if (t.enabled === true) { tVal = '透明 ' + esc(t.opacityPct) + '%'; }
  else if (t.enabled === "unknown") { tVal = '<span class="warn">未知</span>'; tRow = "warn-row"; }
  else { tVal = '<span class="muted">未启用</span>'; }
  // 阅读器行
  var rVal = (r && r.running) ? '运行中 :' + esc(r.port) : '<span class="muted">未运行</span>';
  // 资源行
  var resVal, resSub, resRow;
  if (res) {
    resVal = '图 ' + esc(res.images) + ' · 缩图 ' + esc(res.thumbs) + ' · 视频 ' + esc(res.videos) + ' · 小说 ' + esc(res.novels);
    var depsOk = res.deps && res.deps.sharp;
    resSub = '依赖 ' + (depsOk ? '✓' : '✗');
    if (!depsOk) resRow = "err-row";
  } else {
    resVal = '<span class="muted">—</span>';
  }
  // 轮播行
  var rot = st.rotate;
  var rotVal, rotSub, rotRow;
  if (!rot) { rotVal = '<span class="muted">—</span>'; }
  else if (!rot.running) {
    if (rot.stale) { rotVal = '<span class="warn">轮播已停（进程退出）</span>'; rotRow = "warn-row"; }
    else { rotVal = '<span class="muted">未轮播</span>'; }
  } else {
    rotVal = esc(rot.mode === 'video' ? '视频' : '图片') + ' 轮播';
    var nextStr = rot.nextSwitchAt ? new Date(rot.nextSwitchAt).toLocaleTimeString() : '—';
    rotSub = '每 ' + esc(Math.round(rot.intervalMs / 60000)) + 'min · 下次 ' + esc(nextStr) + ' · 当前 ' + esc(rot.lastFile || '—');
  }
  return row("ZCode", zVal, zSub, zRow) +
    row("壁纸", wVal, wSub) +
    row("透明度", tVal, null, tRow) +
    row("阅读器", rVal) +
    row("资源", resVal, resSub, resRow) +
    row("轮播", rotVal, rotSub, rotRow);
}
if (typeof module !== "undefined" && module.exports) module.exports = { renderStatus: renderStatus };
if (typeof window !== "undefined") window.__ccStatusView = { renderStatus: renderStatus };
