// Test lib/ui-tune.cjs pure helpers (spec 2026-09-16-ui-glass-tune §7 第一层).
const ut = require("../lib/ui-tune.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

const TUNE_ID = "zcode-user-ui-tune"; // 字面量镜像,防常量漂移(对齐 videomutetest 钉法)

// === normalizeConfig ===
var def = ut.normalizeConfig(undefined);
check("normalize: undefined -> default", def.isDefault === true && def.config.version === 1);
check("normalize: default has 5 regions all-0",
  ["sidebar", "chat", "input", "topbar", "panel"].every(function (k) {
    return def.config.regions[k].alpha === 0 && def.config.regions[k].blur === 0;
  }));
check("normalize: null -> default", ut.normalizeConfig(null).isDefault === true);
check("normalize: 'not json object' string -> default", ut.normalizeConfig("x").isDefault === true);
check("normalize: version missing -> default", ut.normalizeConfig({ regions: {} }).isDefault === true);
check("normalize: version 2 -> default", ut.normalizeConfig({ version: 2, regions: {} }).isDefault === true);
var n1 = ut.normalizeConfig({ version: 1, regions: { sidebar: { alpha: 55, blur: 12 } } });
check("normalize: valid values pass through", n1.isDefault === false &&
  n1.config.regions.sidebar.alpha === 55 && n1.config.regions.sidebar.blur === 12);
check("normalize: unknown region dropped", n1.config.regions.bogus === undefined);
var n2 = ut.normalizeConfig({ version: 1, regions: {
  sidebar: { alpha: -5, blur: 99 }, chat: { alpha: 150, blur: 0 },
  input: { alpha: "40", blur: "8" }, topbar: { alpha: NaN, blur: undefined } } });
check("normalize: alpha -5 -> 0", n2.config.regions.sidebar.alpha === 0);
check("normalize: blur 99 -> 24 (clamp)", n2.config.regions.sidebar.blur === 24);
check("normalize: alpha 150 -> 100 (clamp)", n2.config.regions.chat.alpha === 100);
check("normalize: numeric string coerced", n2.config.regions.input.alpha === 40 && n2.config.regions.input.blur === 8);
check("normalize: NaN/undefined -> 0", n2.config.regions.topbar.alpha === 0 && n2.config.regions.topbar.blur === 0);
var n3 = ut.normalizeConfig({ version: 1, regions: { sidebar: { alpha: 55.9 } } });
check("normalize: 55.9 floors to 55", n3.config.regions.sidebar.alpha === 55);

// === buildTuneStyle ===
check("build: all-zero -> null", ut.buildTuneStyle(def.config) === null);
check("build: garbage input -> null", ut.buildTuneStyle(null) === null);
var css1 = ut.buildTuneStyle(n1.config);
check("build: non-null for sidebar 55/12", typeof css1 === "string" && css1.length > 0);
check("build: sidebar selector present", css1.indexOf('aside[data-testid="sidebar"]') !== -1);
check("build: dual theme dispatch", css1.indexOf(".theme-zai-dark ") !== -1 && css1.indexOf(".theme-zai-light ") !== -1);
check("build: alpha 55 -> 0.55 rgba", css1.indexOf("rgba(24,24,28,0.55)") !== -1 && css1.indexOf("rgba(248,248,248,0.55)") !== -1);
check("build: blur 12px", css1.indexOf("blur(12px)") !== -1);
check("build: -webkit prefix present", css1.indexOf("-webkit-backdrop-filter:blur(12px)") !== -1);
check("build: !important present", css1.indexOf("!important") !== -1);
// alpha=0 blur>0: 只有 backdrop-filter,无 background-color(α=0 底色是废规则)
var css2 = ut.buildTuneStyle({ version: 1, regions: { topbar: { alpha: 0, blur: 6 } } });
check("build: alpha0-blur6 has blur rule", css2.indexOf("blur(6px)") !== -1);
check("build: alpha0-blur6 has NO background-color", css2.indexOf("background-color") === -1);
// 混合:只有 sidebar 非 0 -> chat/input/topbar/panel 规则不出现
check("build: zero regions skipped", css1.indexOf("conversation") === -1 && css1.indexOf("bg-input") === -1 && css1.indexOf("workspace-header") === -1 && css1.indexOf('data-testid="browser"]') === -1);
// panel 区域(右侧面板):真机补测锚点(2026-09-17)
var cssPanel = ut.buildTuneStyle({ version: 1, regions: { panel: { alpha: 55, blur: 12 } } });
check("build: panel selector present", cssPanel.indexOf('data-testid="browser"]') !== -1);
check("build: panel tint + blur", cssPanel.indexOf("rgba(24,24,28,0.55)") !== -1 && cssPanel.indexOf("blur(12px)") !== -1);

// === buildTuneExpression ===
var e1 = ut.buildTuneExpression(TUNE_ID, "body{a:1}");
check("expr: IIFE wrapper", /^\(function\(\)\{.*\}\)\(\)$/.test(e1));
check("expr: references style id", e1.indexOf(TUNE_ID) !== -1);
check("expr: embeds css", e1.indexOf("body{a:1}") !== -1);
var e2 = ut.buildTuneExpression(TUNE_ID, null);
check("expr: null css = removal (no createElement)", e2.indexOf("createElement") === -1);
check("expr: null css still removes old", e2.indexOf(".remove()") !== -1);
// 执行验证(fake DOM,对齐 selftest/videomutetest 手法)
(function () {
  // 扩展:createElement 后由表达式 appendChild——用简化 fake:直接改表达式宿主
  var fakeDoc = {
    _els: {},
    getElementById: function (id) { return this._els[id] || null; },
    documentElement: { appendChild: function (el) { fakeDoc._els[el.id] = el; } },
    createElement: function (tag) {
      return { id: "", textContent: "", remove: function () { delete fakeDoc._els[this.id]; } };
    }
  };
  var fn = new Function("document", "return " + e1);
  var r = JSON.parse(fn(fakeDoc));
  check("exec create: ok + present", r.ok === true && r.present === true);
  check("exec create: textContent set", fakeDoc._els[TUNE_ID] && fakeDoc._els[TUNE_ID].textContent === "body{a:1}");
  var fn2 = new Function("document", "return " + ut.buildTuneExpression(TUNE_ID, "body{b:2}"));
  fn2(fakeDoc); // 重建(替换路径:先 remove 旧的再建)
  check("exec rebuild: still exactly one", Object.keys(fakeDoc._els).filter(function (k) { return k === TUNE_ID; }).length === 1);
  var fn3 = new Function("document", "return " + e2);
  var r3 = JSON.parse(fn3(fakeDoc));
  check("exec remove: gone", r3.ok === true && r3.present === false && !fakeDoc._els[TUNE_ID]);
})();

// === readConfigFile ===
var fs = require("fs"), os = require("os"), path = require("path");
var tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "uitune-"));
check("read: missing file -> default", ut.readConfigFile(path.join(tmpdir, "nope.json")).isDefault === true);
fs.writeFileSync(path.join(tmpdir, "bad.json"), "{corrupt");
check("read: corrupt json -> default", ut.readConfigFile(path.join(tmpdir, "bad.json")).isDefault === true);
fs.writeFileSync(path.join(tmpdir, "ok.json"), JSON.stringify({ version: 1, regions: { sidebar: { alpha: 55, blur: 12 } } }));
var rc = ut.readConfigFile(path.join(tmpdir, "ok.json"));
check("read: valid file round-trips", rc.isDefault === false && rc.config.regions.sidebar.alpha === 55);
fs.writeFileSync(path.join(tmpdir, "half.json"), '{"version":1,"regions":{"sid'); // 半写截断
check("read: half-written file -> default (atomic-write 兜底)", ut.readConfigFile(path.join(tmpdir, "half.json")).isDefault === true);

fs.rmSync(tmpdir, { recursive: true, force: true }); // 清理 mkdtempSync 的临时目录,不在 os.tmpdir() 留垃圾
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
