// Compatibility wrapper (spec §9, 审查 P2-reader迁移).
// Novel/HTTP logic migrated to control-server.cjs; this re-exports createServer
// so existing callers — test/readerservertest.cjs (require("../lib/reader-server.cjs")),
// bin/reader-server.bat, wallpaper.bat scene 11 — keep working unchanged.
// reader SPA still served at /reader/ by control-server (zero behavior change).
const path = require("path");
const child_process = require("child_process");
const control = require("./control-server.cjs");

// Standalone entry: behaves like the old reader-server (prints /reader/ URL +
// copies it to clipboard). bin/reader-server.bat calls `node lib/reader-server.cjs`.
if (require.main === module) {
  const root = path.join(__dirname, "..");
  control.createServer({ root }).then(({ port, host, library }) => {
    console.log("[reader] 服务已启动: http://" + host + ":" + port + "/reader");
    console.log("[reader] 共加载 " + library.size + " 本书");
    console.log("[reader] 关闭此窗口即停止服务。");
    try {
      child_process.execSync(
        'powershell -NoProfile -Command "Set-Clipboard -Value \\"http://' + host + ':' + port + '/reader\\""',
        { stdio: "ignore" });
      console.log("[reader] URL 已复制到剪贴板，去 ZCode 浏览器面板粘贴回车。");
    } catch (e) { console.log("[reader] (剪贴板写入失败，请手动复制上方 URL)"); }
  }).catch((e) => { console.error("[reader] 启动失败: " + e.message); process.exit(1); });
}

module.exports = {
  createServer: control.createServer,
  buildLibrary: control.buildLibrary,
  bookIdFor: control.bookIdFor,
};
