// Menu renderer for wallpaper.bat launcher.
// WHY a separate .cjs: AGENTS.md requires .bat files to stay ASCII-only;
// Chinese text printed from .bat echo would garble under OEM codepage.
// So wallpaper.bat calls `node lib/menu.cjs` to print the Chinese menu.
//
// renderMenu() returns the menu string (unit-tested by test/menutest.cjs).
// Running this file directly (`node lib/menu.cjs`) just prints it.

const SCENARIOS = [
  {
    key: "1",
    title: "新机器初始化",
    desc: "第一次用必跑。装依赖 + 缩图 + 启动带壁纸的 ZCode",
    calls: "setup → resize → start-zcode",
  },
  {
    key: "2",
    title: "日常启动带壁纸",
    desc: "ZCode 没开时，一键启动并注入壁纸",
    calls: "start-zcode",
  },
  {
    key: "3",
    title: "换壁纸图后重注入",
    desc: "放了新图到 wallpapers/，缩图后重新注入",
    calls: "resize → inject-only",
  },
  {
    key: "4",
    title: "只重新注入 CSS",
    desc: "ZCode 已经开着，改完 wallpaper.css 想立刻看效果",
    calls: "inject-only",
  },
  {
    key: "5",
    title: "移除壁纸",
    desc: "撤掉已注入的壁纸，恢复 ZCode 原样",
    calls: "remove-wallpaper",
  },
  {
    key: "6",
    title: "重装依赖",
    desc: "sharp/ws 坏了想重装",
    calls: "setup",
  },
  {
    key: "7",
    title: "启动带视频壁纸",
    desc: "ZCode 没开时，一键启动并注入视频壁纸（mp4）",
    calls: "start-zcode(video)",
  },
  {
    key: "8",
    title: "注入视频壁纸",
    desc: "ZCode 已经开着，把视频（mp4）注入成动态壁纸",
    calls: "inject-only(video)",
  },
  {
    key: "9",
    title: "启动带透明窗口",
    desc: "ZCode 没开时，一键启动并设窗口透明（能看桌面，Ctrl+Alt+↑/↓ 调）",
    calls: "start-transparent",
  },
  {
    key: "10",
    title: "对已开窗口设透明",
    desc: "ZCode 已经开着，把它的窗口设成半透明（看得到桌面）",
    calls: "transparent",
  },
];

function pad(str, len) {
  // pad to width (ASCII/Chinese-mixed: count code units, good enough for our fixed titles)
  while (str.length < len) str += " ";
  return str;
}

function renderMenu() {
  const lines = [];
  lines.push("================  ZCode 壁纸工具箱  ================");
  lines.push("");
  for (const s of SCENARIOS) {
    // "  1  新机器初始化        描述..."
    lines.push("  " + s.key + "  " + pad(s.title, 14) + s.desc);
    lines.push("                         (" + s.calls + ")");
    lines.push("");
  }
  lines.push("  0  退出");
  lines.push("");
  lines.push("======================================================");
  lines.push("请输入选项编号:");
  return lines.join("\n");
}

module.exports = { renderMenu, SCENARIOS };

if (require.main === module) {
  process.stdout.write(renderMenu() + "\n");
}
