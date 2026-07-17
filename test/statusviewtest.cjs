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

// === rotate row (spec §7.3) ===
const rotRunning = sv.renderStatus({
  zcode: { running: true }, wallpaper: { mode: "none" }, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  rotate: { running: true, mode: "image", intervalMs: 300000, lastFile: "Chapter4.jpg", nextSwitchAt: 1718900000000 },
  _meta: { probeErrors: [] },
});
check("render rotate running shows 轮播", rotRunning.indexOf("轮播") !== -1);
check("render rotate running shows interval 5min", rotRunning.indexOf("5min") !== -1);
check("render rotate running shows mode 图片", rotRunning.indexOf("图片") !== -1);
check("render rotate running shows lastFile", rotRunning.indexOf("Chapter4.jpg") !== -1);

const rotVideo = sv.renderStatus({
  zcode: null, wallpaper: null, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  rotate: { running: true, mode: "video", intervalMs: 600000, lastFile: "v.mp4", nextSwitchAt: 0 },
  _meta: { probeErrors: [] },
});
check("render rotate video mode shows 视频", rotVideo.indexOf("视频") !== -1);
check("render rotate video shows 10min", rotVideo.indexOf("10min") !== -1);

const rotOff = sv.renderStatus({
  zcode: null, wallpaper: null, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  rotate: { running: false },
  _meta: { probeErrors: [] },
});
check("render rotate off shows 未轮播", rotOff.indexOf("未轮播") !== -1);

const rotStale = sv.renderStatus({
  zcode: null, wallpaper: null, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  rotate: { running: false, stale: true },
  _meta: { probeErrors: [] },
});
check("render rotate stale shows 进程退出", rotStale.indexOf("进程退出") !== -1);

const rotNull = sv.renderStatus({
  zcode: null, wallpaper: null, transparent: null,
  reader: { running: true }, resources: { images: 0 },
  rotate: null,
  _meta: { probeErrors: [{ item: "rotate" }] },
});
check("render rotate null shows placeholder", rotNull.indexOf("—") !== -1);

// === video wallpaper audio state display (spec §4.6) ===
// video mode + unmuted -> shows 🔊 有声
var stV = {
  zcode: { running: true, debugPort: 9222, pageTargets: 1 },
  wallpaper: { mode: "video", videoMuted: false, injectedWindows: 1, totalWindows: 1 },
  transparent: { enabled: false }, reader: { running: true, port: 17890 },
  resources: { images: 0, thumbs: 0, videos: 1, novels: 0, deps: { sharp: true } },
  rotate: { running: false }, _meta: { probeErrors: [] },
};
var htmlV = sv.renderStatus(stV);
check("status-view: video unmuted shows 有声", htmlV.indexOf("有声") !== -1);
// video mode + muted -> shows 🔇 静音
var stM = JSON.parse(JSON.stringify(stV));
stM.wallpaper.videoMuted = true;
var htmlM = sv.renderStatus(stM);
check("status-view: video muted shows 静音", htmlM.indexOf("静音") !== -1);
check("status-view: video muted does NOT show 有声", htmlM.indexOf("有声") === -1);
// image mode -> no audio marker
var stI = JSON.parse(JSON.stringify(stV));
stI.wallpaper.mode = "image";
stI.wallpaper.videoMuted = null;
var htmlI = sv.renderStatus(stI);
check("status-view: image mode no audio marker", htmlI.indexOf("有声") === -1 && htmlI.indexOf("静音") === -1);

// === 结构断言（spec §6 行项风格，Task 4 新增） ===
check("结构: renderStatus 含 status-row", html1.indexOf("status-row") !== -1);
check("结构: renderStatus 含 status-label", html1.indexOf("status-label") !== -1);
check("结构: renderStatus 含 status-value", html1.indexOf("status-value") !== -1);
check("结构: renderStatus 含 status-main", html1.indexOf("status-main") !== -1);
// 端口未开时整行 warn-row 高亮（html2 是 zcode:null）
check("结构: 端口未开时含 warn-row", html2.indexOf("warn-row") !== -1);
// 依赖缺失时 err-row（构造一个缺依赖的 status）
var stDepsMissing = {
  zcode: { running: true, debugPort: 9222, pageTargets: 1 },
  wallpaper: { mode: "none" }, transparent: null,
  reader: { running: true }, resources: { images: 0, thumbs: 0, videos: 0, novels: 0, deps: { sharp: false } },
  rotate: null, _meta: { probeErrors: [] },
};
var htmlDeps = sv.renderStatus(stDepsMissing);
check("结构: 依赖缺失时含 err-row", htmlDeps.indexOf("err-row") !== -1);
check("结构: 依赖缺失时显示 ✗", htmlDeps.indexOf("✗") !== -1);
// 6 行（数 status-row 出现次数）
var rowCount = (html1.match(/status-row/g) || []).length;
check("结构: 共 6 个 status-row", rowCount === 6);
// rotate stale + transparent unknown 触发 warn-row（Task 4 review 补断言）
check("结构: rotate stale 含 warn-row", rotStale.indexOf("warn-row") !== -1);
var stUnknown = {
  zcode: { running: true }, wallpaper: { mode: "none" },
  transparent: { enabled: "unknown" },
  reader: { running: true }, resources: { images: 0 },
  _meta: { probeErrors: [] },
};
var htmlUnknown = sv.renderStatus(stUnknown);
check("结构: transparent unknown 含 warn-row", htmlUnknown.indexOf("warn-row") !== -1);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
