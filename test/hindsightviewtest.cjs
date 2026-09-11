// Test control/lib/hindsight-view.js — pure render (state JSON -> HTML string).
// 对齐 statusviewtest.cjs 范式：只测纯函数，DOM 接线（fetch/事件）靠真机验。
const hv = require("../control/lib/hindsight-view.js");
let pass = 0, fail = 0;
function check(n, c) { console.log((c ? "PASS ✓ " : "FAIL ✗ ") + n); c ? pass++ : fail++; }

// ---- label 映射 ----
check("groupLabel server -> 服务器", hv.groupLabel("server") === "服务器");
check("groupLabel unknown passthrough", hv.groupLabel("weird") === "weird");
check("sourceLabel file:harness -> 文件·harness", hv.sourceLabel("file:harness") === "文件·harness");
check("sourceClass env highlighted", hv.sourceClass("env") === "hs-src-env");

// ---- fmtWhen / fmtVal ----
check("fmtWhen null -> —", hv.fmtWhen(null) === "—");
check("fmtWhen invalid passthrough", hv.fmtWhen("not-a-date-x") === "not-a-date-x");
check("fmtWhen iso parses", /^\d{4}/.test(hv.fmtWhen("2026-09-11T11:55:12Z")));
check("fmtVal undefined -> —", hv.fmtVal(undefined) === "—");
check("fmtVal object json-escaped", hv.fmtVal({ a: "<x>" }).indexOf("&lt;x&gt;") !== -1);
check("fmtVal empty string shown (escaped)", hv.fmtVal("") === "&quot;&quot;");

// ---- buildStatusHtml ----
var stHtml0 = hv.buildStatusHtml(null, "");
check("status null -> 加载中", stHtml0.indexOf("加载中") !== -1);
var stRun = hv.buildStatusHtml({
  running: true, serverMode: "self-hosted", apiUrl: "http://127.0.0.1:9077",
  profile: "coding-agent", profileByPort: true, embedAvailable: true,
  version: { api_version: "0.9.2" }, paths: { pluginLog: "p.log", daemonLog: "d.log", database: "db" },
}, "");
check("status running -> 运行中", stRun.indexOf("运行中") !== -1);
check("status shows self-hosted + url", stRun.indexOf("self-hosted") !== -1 && stRun.indexOf("127.0.0.1:9077") !== -1);
check("status shows API version", stRun.indexOf("0.9.2") !== -1);
check("status profile 按端口匹配", stRun.indexOf("按端口匹配") !== -1 && stRun.indexOf("coding-agent") !== -1);
check("status running -> start disabled stop enabled", /data-hs="start"[^>]*disabled/.test(stRun) && !/data-hs="stop"[^>]*disabled/.test(stRun));
check("status embedAvailable ok -> no warn banner", stRun.indexOf("不在 PATH") === -1);
check("status paths collapsed in details", stRun.indexOf("<summary>路径</summary>") !== -1);
var stDown = hv.buildStatusHtml({
  running: false, serverMode: "self-hosted", apiUrl: "http://127.0.0.1:9077",
  profile: "coding-agent", profileByPort: false, embedAvailable: false,
  error: "fetch failed", paths: { pluginLog: "p", daemonLog: "d", database: "db" },
}, "");
check("status down -> 已停止 + hint", stDown.indexOf("已停止") !== -1 && stDown.indexOf("不会自动拉起") !== -1);
check("status down -> stop disabled start enabled", /data-hs="stop"[^>]*disabled/.test(stDown) && !/data-hs="start"[^>]*disabled/.test(stDown));
check("status embedAvailable false -> warn banner", stDown.indexOf("不在 PATH") !== -1);
check("status down -> 默认 profile 标注", stDown.indexOf("（默认，未匹配到端口）") !== -1);
check("status probe error shown", stDown.indexOf("fetch failed") !== -1);
var stBusy = hv.buildStatusHtml({ running: false, serverMode: "x", apiUrl: "y", profile: "p", profileByPort: true, embedAvailable: true }, "start");
check("status busy -> 启动中 + both disabled", stBusy.indexOf("启动中") !== -1 && /data-hs="start"[^>]*disabled/.test(stBusy) && /data-hs="stop"[^>]*disabled/.test(stBusy));

// ---- buildConfigHtml ----
var cfgHtml = hv.buildConfigHtml({
  path: "C:/x/coding-agent.json", exists: true,
  raw: { serverMode: "self-hosted", llm: { apiKey: "configured (••••9999)" } },
  envActive: [{ key: "apiPort", envVar: "HINDSIGHT_API_PORT" }],
  bankSections: [{ id: "b1", keys: ["disabled"] }],
  harnessSections: ["claude-code"],
  items: [
    { key: "serverMode", group: "server", value: "self-hosted", source: "file" },
    { key: "autoSeed", group: "memory", value: true, source: "default" },
  ],
});
check("config shows path", cfgHtml.indexOf("coding-agent.json") !== -1);
check("config groups by label", cfgHtml.indexOf("服务器") !== -1 && cfgHtml.indexOf("记忆行为") !== -1);
check("config source labels", cfgHtml.indexOf("文件") !== -1 && cfgHtml.indexOf("默认值") !== -1);
check("config envActive listed", cfgHtml.indexOf("HINDSIGHT_API_PORT") !== -1);
check("config bankSections listed", cfgHtml.indexOf("b1") !== -1);
check("config raw in details + escaped", cfgHtml.indexOf("原始 JSON") !== -1);
var cfgEmpty = hv.buildConfigHtml(null);
check("config null -> empty string", cfgEmpty === "");
var cfgErr = hv.buildConfigHtml({ path: "x", exists: true, items: [], envActive: [], bankSections: [], harnessSections: [], raw: null, error: "invalid JSON: oops" });
check("config error banner", cfgErr.indexOf("invalid JSON") !== -1);

// ---- sortBanks ----
var sorted = hv.sortBanks([
  { bank_id: "old", last_write_at: "2026-08-01T00:00:00Z" },
  { bank_id: "new", last_write_at: "2026-09-11T00:00:00Z" },
  { bank_id: "never" },
]);
check("sortBanks newest first", sorted[0].bank_id === "new" && sorted[1].bank_id === "old" && sorted[2].bank_id === "never");

// ---- buildBanksHtml ----
check("banks null -> empty", hv.buildBanksHtml(null, {}, {}) === "");
var banksErr = hv.buildBanksHtml({ error: "HTTP 500" }, {}, {});
check("banks error -> 读取失败", banksErr.indexOf("读取失败") !== -1 && banksErr.indexOf("HTTP 500") !== -1);
var banksEmpty = hv.buildBanksHtml({ banks: [] }, {}, {});
check("banks empty -> 没有记忆库", banksEmpty.indexOf("没有记忆库") !== -1);
var banksHtml = hv.buildBanksHtml({ banks: [
  { bank_id: "coding-agent::x", fact_count: 42, last_write_at: "2026-09-11T11:55:12Z" },
] }, {}, {});
check("banks shows id + fact count", banksHtml.indexOf("coding-agent::x") !== -1 && banksHtml.indexOf("42") !== -1);
check("banks collapsed marker ▸", banksHtml.indexOf("▸") !== -1);
var banksOpen = hv.buildBanksHtml({ banks: [
  { bank_id: "coding-agent::x", fact_count: 42, last_write_at: "2026-09-11T11:55:12Z" },
] }, { "coding-agent::x": true }, {});
check("banks expanded -> 加载知识页 placeholder", banksOpen.indexOf("加载知识页") !== -1 && banksOpen.indexOf("▾") !== -1);
var banksTree = hv.buildBanksHtml({ banks: [
  { bank_id: "coding-agent::x", fact_count: 1, last_write_at: null },
] }, { "coding-agent::x": true }, { "coding-agent::x": { pages: [
  { id: "kp1", kind: "page", name: "Component map" },
] } });
check("banks tree rendered", banksTree.indexOf("Component map") !== -1);
var banksTreeErr = hv.buildBanksHtml({ banks: [
  { bank_id: "b", fact_count: 0, last_write_at: null },
] }, { "b": true }, { "b": { error: "HTTP 404" } });
check("banks tree error shown", banksTreeErr.indexOf("HTTP 404") !== -1);

// ---- buildTreeHtml ----
var tree = hv.buildTreeHtml([
  { id: "r1", kind: "folder", name: "F1", children: [
    { id: "r2", kind: "page", name: "Child Page" },
    { id: "r3", kind: "folder", name: "F2", children: [{ id: "r4", kind: "page", name: "Deep" }] },
  ] },
], 0);
check("tree folder marker", tree.indexOf("📁") !== -1 && tree.indexOf("F1") !== -1);
check("tree page marker", tree.indexOf("📄") !== -1 && tree.indexOf("Child Page") !== -1);
check("tree nested indent deep", /padding-left:28px/.test(tree) && tree.indexOf("Deep") !== -1);
check("tree escapes html", hv.buildTreeHtml([{ id: "x", kind: "page", name: "<script>" }], 0).indexOf("&lt;script&gt;") !== -1);

// ---- buildLogsHtml ----
var logsClosed = hv.buildLogsHtml(null, false);
check("logs closed -> 查看日志 button", logsClosed.indexOf("查看日志") !== -1);
var logsLoading = hv.buildLogsHtml({ loading: true }, true);
check("logs open loading", logsLoading.indexOf("加载中") !== -1);
var logsHtml = hv.buildLogsHtml({
  pluginLog: { path: "C:/t/plugin.log", exists: true, lines: ["a", "b"] },
  daemonLog: { path: "C:/h/profiles/x.log", exists: false, lines: [] },
}, true);
check("logs shows both blocks + paths", logsHtml.indexOf("插件日志") !== -1 && logsHtml.indexOf("服务日志") !== -1 && logsHtml.indexOf("plugin.log") !== -1);
check("logs lines in pre", logsHtml.indexOf("<pre") !== -1 && logsHtml.indexOf("a") !== -1);
check("logs missing file -> 文件不存在", logsHtml.indexOf("文件不存在") !== -1);
check("logs error state", hv.buildLogsHtml({ error: "boom" }, true).indexOf("boom") !== -1);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
