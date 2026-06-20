// Test control/lib/status-view.js — pure render (status JSON -> HTML string).
const sv = require("../control/lib/status-view.js");
let pass = 0, fail = 0;
function check(n, c) { console.log((c ? "PASS ✓ " : "FAIL ✗ ") + n); c ? pass++ : fail++; }

const html1 = sv.renderStatus({
  zcode: { running: true, debugPort: 9222, pageTargets: 2 },
  wallpaper: { mode: "video", injectedWindows: 2, totalWindows: 2 },
  transparent: null,
  reader: { running: true, port: 17890 },
  resources: { images: 5 },
  _meta: { probeErrors: [] },
});
check("renderStatus returns string", typeof html1 === "string");
check("render shows ZCode running", html1.indexOf("运行") !== -1 || html1.indexOf("running") !== -1);
check("render shows video mode (视频壁纸)", html1.indexOf("视频壁纸") !== -1);
check("render shows transparent placeholder (null)", html1.indexOf("—") !== -1 || html1.indexOf("未知") !== -1 || html1.indexOf("unknown") !== -1);
check("render shows images 5", html1.indexOf("5") !== -1);

const html2 = sv.renderStatus({
  zcode: null, wallpaper: null, transparent: null,
  reader: { running: true, port: 17890 }, resources: { images: 5 },
  _meta: { probeErrors: [{ item: "zcode" }] },
});
check("render zcode null shows debug-port hint", html2.indexOf("调试端口") !== -1 || html2.toLowerCase().indexOf("debug") !== -1);

const html3 = sv.renderStatus({
  zcode: { running: true }, wallpaper: { mode: "none" },
  transparent: { enabled: true, opacityPct: 78 },
  reader: { running: true }, resources: { images: 0 },
  _meta: { probeErrors: [] },
});
check("render transparent enabled shows 78%", html3.indexOf("78") !== -1);
check("render wallpaper none shows 未注入", html3.indexOf("未注入") !== -1);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
