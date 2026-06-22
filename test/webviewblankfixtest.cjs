// Test lib/webview-blankfix.cjs pure helpers (spec §3/§5/§8).
const bf = require("../lib/webview-blankfix.cjs");
const cdp = require("../lib/cdp.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// === filterWebviewTargets (spec §5) ===
function mkWv(url, id) { return { type: "webview", id: id || "wv1", url: url, webSocketDebuggerUrl: "ws://x/" + (id || "wv1") }; }
function mkPage(url, id) { return { type: "page", id: id || "p1", url: url, webSocketDebuggerUrl: "ws://x/" + (id || "p1") }; }

// 排除非 webview 类型
check("reject page type", bf.filterWebviewTargets([mkPage("https://x.com/")]).length === 0);
check("reject iframe type", bf.filterWebviewTargets([{ type: "iframe", url: "https://x.com/", webSocketDebuggerUrl: "ws://x" }]).length === 0);
check("reject worker type", bf.filterWebviewTargets([{ type: "worker", url: "", webSocketDebuggerUrl: "ws://x" }]).length === 0);

// 排除无 wsUrl
check("reject no wsUrl", bf.filterWebviewTargets([{ type: "webview", url: "https://x.com/" }]).length === 0);

// 排除 devtools://
check("reject devtools url", bf.filterWebviewTargets([mkWv("devtools://devtools/bundled/shell.html")]).length === 0);

// 排除工具页 (localhost/127.0.0.1 任意端口 + 工具路径)
check("reject /control/ on localhost", bf.filterWebviewTargets([mkWv("http://localhost:17890/control/")]).length === 0);
check("reject /control/ on 127.0.0.1", bf.filterWebviewTargets([mkWv("http://127.0.0.1:17890/control/")]).length === 0);
check("reject /reader/ on localhost", bf.filterWebviewTargets([mkWv("http://localhost:17890/reader/")]).length === 0);
check("reject /api/ on localhost", bf.filterWebviewTargets([mkWv("http://localhost:17890/api/books")]).length === 0);
check("reject /control/index.html", bf.filterWebviewTargets([mkWv("http://127.0.0.1:17890/control/index.html")]).length === 0);
check("reject different port still tool page", bf.filterWebviewTargets([mkWv("http://127.0.0.1:17891/control/")]).length === 0);

// 保留外部站
check("keep external https", bf.filterWebviewTargets([mkWv("https://open.bigmodel.cn/")]).length === 1);
check("keep external http", bf.filterWebviewTargets([mkWv("http://example.com/path?q=1")]).length === 1);

// 边界：url 为空但有 wsUrl（刚创建还没导航的 webview）
check("keep webview with empty url", bf.filterWebviewTargets([{ type: "webview", id: "wv1", url: "", webSocketDebuggerUrl: "ws://x/wv1" }]).length === 1);

// 不误杀 localhost 非工具路径（如用户本地其他服务）
check("keep localhost non-tool path", bf.filterWebviewTargets([mkWv("http://localhost:3000/app")]).length === 1);

// 混合场景
var mixed = [
  mkPage("https://a.com/"),                                  // page → reject
  mkWv("https://open.bigmodel.cn/"),                         // external → keep
  mkWv("http://127.0.0.1:17890/control/"),                   // tool → reject
  mkWv("devtools://x"),                                      // devtools → reject
  { type: "webview", id: "w", url: "", webSocketDebuggerUrl: "ws://x/w" } // empty url → keep
];
check("mixed: keep 2 of 5", bf.filterWebviewTargets(mixed).length === 2);

// === 镜像一致性断言 (教训 17): cdp.filterTargets 和 filterWebviewTargets
// 排除的工具页/devtools 集合完全相同，只是类型维度不同 ===
var mirrorTargets = [
  { type: "page", id: "p1", url: "https://a.com/", webSocketDebuggerUrl: "ws://x/p1" },
  { type: "webview", id: "w1", url: "https://a.com/", webSocketDebuggerUrl: "ws://x/w1" },
  { type: "page", id: "p2", url: "http://127.0.0.1:17890/control/", webSocketDebuggerUrl: "ws://x/p2" },
  { type: "webview", id: "w2", url: "http://127.0.0.1:17890/control/", webSocketDebuggerUrl: "ws://x/w2" },
  { type: "page", id: "p3", url: "devtools://x", webSocketDebuggerUrl: "ws://x/p3" },
  { type: "webview", id: "w3", url: "devtools://x", webSocketDebuggerUrl: "ws://x/w3" }
];
var pageKept = cdp.filterTargets(mirrorTargets).map(function (t) { return t.url; }).sort();
var wvKept = bf.filterWebviewTargets(mirrorTargets).map(function (t) { return t.url; }).sort();
check("mirror: page and webview keep same URL set", JSON.stringify(pageKept) === JSON.stringify(wvKept));
check("mirror: both keep https://a.com/", pageKept.length === 1 && pageKept[0] === "https://a.com/");

// === WEBVIEW_BLANKFIX_SOURCE 关键字断言 (spec §8) ===
var src = bf.WEBVIEW_BLANKFIX_SOURCE;
check("SOURCE: contains __zzBlankFix (idempotency guard)", src.indexOf("__zzBlankFix") !== -1);
check("SOURCE: contains removeAttribute('target')", src.indexOf("removeAttribute('target')") !== -1);
check("SOURCE: contains MutationObserver", src.indexOf("MutationObserver") !== -1);
check("SOURCE: contains addEventListener('click'", src.indexOf("addEventListener('click'") !== -1);
check("SOURCE: contains childList:true,subtree:true", src.indexOf("childList:true,subtree:true") !== -1);
check("SOURCE: is IIFE", /^\(function\(\)\{[\s\S]*\}\)\(\);?\s*$/.test(src.trim()));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
