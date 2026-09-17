# 控制中心「玻璃调节」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 ZCode 主页面四个区域(侧边栏/主对话区/输入框/顶栏)提供独立的不透明度+模糊度滑块,经 CDP 原地注入第二层玻璃样式,配置持久化、重启保持。

**Architecture:** 方案 A(spec §2)——独立第二层 `<style id="zcode-user-ui-tune">`,`lib/ui-tune.cjs` 写模块(对齐 video-mute 范式)原地更新;`/api/uitune` 即时路由;`inject.cjs` 注壁纸时读 `ui-tune.json` 附带重建,三条路径清理。不碰 `wallpaper.css`;全默认 = 移除层 = 现状。

**Tech Stack:** Node CJS + 原生 http server + 原生前端 SPA(无框架);CDP Runtime.evaluate;测试为仓库自有 check() 断言风格(无测试框架)。

**Spec:** `docs/superpowers/specs/2026-09-16-ui-glass-tune-design.md`(计划从 spec 论证,执行者两份都读)

## Global Constraints

- **git 约定(用户规则,最高优先)**:除非用户**当轮明确要求**,不做 `git add/commit/push`。各任务的 Commit 步骤执行时默认跳过,改为汇报改动清单;用户要求时再补。
- 分支:`feat/ui-glass-tune`(Task 1 创建;建分支属于常规 git 读写,允许直接执行)。
- `wallpaper.css` **一个字都不改**。
- 新 style id 字面量:`zcode-user-ui-tune`(与 `zcode-user-wallpaper`、`zcode-user-wallpaper-video` 并列,进三条清理路径)。
- 配置文件:项目根 `ui-tune.json`,`version` 恒为 `1`;`version !== 1` 或解析失败 → 默认全 0。
- 数值语义:`alpha` 0-100 整数(不透明度百分比)、`blur` 0-24 整数(px);clamp 后取整。
- CDP 工具页过滤:`applyTune` 用 `cdp.listTargets()`(内部已 filterTargets,排除 /control/、/reader/、/api/)——玻璃层绝不进工具页。
- 测试环境无 ZCode:所有 CDP 写路径必须优雅降级(200 + `applied:false`),不 500、不挂死(controlservertest 依赖这一点)。
- 给用户的真机/GUI 命令一律 **PowerShell 单行**(用户环境约定);GUI 人眼验证停下等用户回贴结果。
- 测试跑法:单跑某测试文件前若涉及 epub 才需要 `npm run pretest`;本功能不涉及 epub fixture。全量回归用 `npm test`(串行 30+ 文件)。
- 仓库的 bash 环境会吞 `$xxx` 变量:PowerShell 一律写 `.ps1` 用 `-File`,不内联 `-Command`(AGENTS.md 环境注意)。

---

### Task 1: 分支 + 真机 spike——钉死区域选择器与侧边栏硬画判定

**Files:**
- Modify: `scripts/inspect-regions.cjs`(brainstorm 时的 throwaway,补 ANCHORS 定向探测段)
- Modify: `docs/superpowers/specs/2026-09-16-ui-glass-tune-design.md`(附录:钉死的选择器 + sidebar 判定结论)

**Interfaces:**
- Consumes: 无(首个任务)。
- Produces: `REGIONS` 四个键的**最终选择器**(写进 Task 2 的常量);sidebar 硬画判定结论(决定 Task 2 是否加 JS inline 覆盖分支);backdrop-filter 可用性结论。spec 附录记录三者。

- [ ] **Step 0: 建分支**

```bash
git checkout -b feat/ui-glass-tune
```

- [ ] **Step 1: 注入壁纸(spike 需要"注入态")**

```bash
npm run inject
```

预期:输出「选中壁纸: …」「完成，影响窗口 ≥1」。若 wallpapers-thumb/ 为空(脚本 exit 0 提示缩图),停下问用户要一张测试图放入 `wallpapers/` 并跑 `npm run resize`,不要跳过注入态直接继续——sidebar 硬画判定必须在注入态做。**壁纸保持注入状态直到 Task 7 结束**(后续任务要靠它做真机验证),不要顺手 remove。

- [ ] **Step 2: 给 inspect-regions.cjs 追加 ANCHORS 定向探测段**

在 `scripts/inspect-regions.cjs` 的 `expr` 模板里,`walk(document.body, ...)` 调用之后、`return JSON.stringify(out);` 之前插入:

```js
  // 3) 定向锚点:四个区域候选选择器的 count/rect/computed bg。
  //    双层叠加检测:input 区的 dock wrapper 与 .bg-input 若嵌套,只取实际画背景层。
  var ANCHORS = ['aside[data-testid="sidebar"]',
    '[data-testid="conversation"]', '[data-testid="conversation-column"]',
    '[data-testid="conversation-bottom-dock-transition"]', '.bg-input',
    '[data-testid="workspace-header"]'];
  out.anchors = ANCHORS.map(function (sel) {
    var els = document.querySelectorAll(sel);
    var first = [];
    for (var i = 0; i < Math.min(els.length, 3); i++) {
      var cs = getComputedStyle(els[i]);
      var r = els[i].getBoundingClientRect();
      first.push({ rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        bg: cs.backgroundColor, tag: els[i].tagName, cls: String(els[i].className).slice(0, 60) });
    }
    return { sel: sel, count: els.length, first: first };
  });
```

main() 输出段(`console.log("=== solid/big skeleton ...")` 之后)追加:

```js
  if (data.anchors) {
    console.log("=== anchors ===");
    data.anchors.forEach((a) => console.log(JSON.stringify(a)));
  }
```

- [ ] **Step 3: 跑探测,按判定规则钉死选择器**

```bash
node scripts/inspect-regions.cjs
```

判定规则(逐条执行,结论写进 spec 附录):
1. **chat**:取 `conversation` 与 `conversation-column` 中 **x ≥ 310(不吞侧边栏)且宽度覆盖主内容列** 的那个;若两者嵌套且外层只是透明包装,取实际覆盖内容区的外层。
2. **input**:`.bg-input` 与 dock wrapper 若为**嵌套**关系 → 只保留实际画背景(computed bg 非透明或被 wallpaper.css 置 transparent 的那一层)的那个选择器;若 dock wrapper 无背景且只是动画壳 → REGIONS.input 只留 `.bg-input`。
3. **sidebar 硬画判定**:看 `aside[data-testid="sidebar"]` 自身及**其子树**(anchors 输出 + skeleton 段)注入态下是否仍有 computed bg 非透明的实色块。全部透明 → 不需要 JS inline 覆盖分支;仍有实色块 → Task 2 需加 inline 覆盖分支(代码在 Task 2 Step 5 条件块里,判定为"需要"才加)。
4. **topbar**:确认 `workspace-header` 存在且 rect 是顶部横条(y≈0, height<100)。
5. **backdrop-filter 冒烟**:临时手动验证 Chromium 146 支持(预期全支持,此步为教训 21 式确认而非假设):

```bash
node -e "const{WebSocket}=require('ws');const http=require('http');http.get({host:'127.0.0.1',port:9222,path:'/json'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const t=JSON.parse(d).find(t=>t.type==='page'&&/app\.asar/.test(t.url));const ws=new WebSocket(t.webSocketDebuggerUrl.replace('ws://localhost','ws://127.0.0.1:9222'));ws.on('open',()=>{ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'(function(){var s=document.createElement(\\'style\\');s.textContent=\\'aside[data-testid=\\\"sidebar\\\"]{backdrop-filter:blur(20px) !important;}\\';document.documentElement.appendChild(s);return getComputedStyle(document.querySelector(\\'aside[data-testid=\\\"sidebar\\\"]\\')).backdropFilter;})()',returnByValue:true}}));});ws.on('message',m=>{console.log('backdropFilter computed:',JSON.parse(m).result&&JSON.parse(m).result.result&&JSON.parse(m).result.result.value);ws.close();});});});"
```

预期输出 `blur(20px)`。然后跑 `node scripts/screenshot.cjs`(若该脚本需参数,读其头部用法)或直接人眼看 ZCode 窗口:侧边栏区域壁纸应该明显变糊。确认后清掉这条冒烟样式:

```bash
node -e "const{WebSocket}=require('ws');const http=require('http');http.get({host:'127.0.0.1',port:9222,path:'/json'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const t=JSON.parse(d).find(t=>t.type==='page'&&/app\.asar/.test(t.url));const ws=new WebSocket(t.webSocketDebuggerUrl.replace('ws://localhost','ws://127.0.0.1:9222'));ws.on('open',()=>{ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'document.querySelectorAll(\\'style\\')//清冒烟:最后插入的 style 移除',returnByValue:true}}));});ws.on('message',()=>ws.close());});});"
```

(上面这条清理命令若定位麻烦,直接重启注入即可清掉:`npm run inject` 会重建所有注入层;冒烟 style 不带 id,重启前它一直在——**可接受**,因为 Task 4 的注入路径清的是带 id 的层。更稳妥:冒烟 style 也带 id,把表达式里创建的 style 设 `s.id='smoke-blur'`,清理用 `document.getElementById('smoke-blur').remove()`。**采用带 id 版本**,把上面两段表达式里的创建语句改为 `...s.id='smoke-blur';s.textContent=...`,清理表达式改为 `(function(){var s=document.getElementById('smoke-blur');if(s)s.remove();return 'cleaned';})()`。)

- [ ] **Step 4: 把结论写进 spec 附录**

在 spec 末尾追加 `## 附录:实施 spike 结论(2026-09-16)`,内容:四个 region 的最终选择器表、sidebar 硬画判定(是否需要 inline 覆盖分支)、backdrop-filter 冒烟结果。此附录是 Task 2 REGIONS 常量的唯一依据。

- [ ] **Step 5: 汇报 spike 结论**(给用户的中间汇报,不等批准——选择器以探测事实为准)

---

### Task 2: `lib/ui-tune.cjs` 纯函数 + `test/uitunetest.cjs`(TDD)

**Files:**
- Create: `lib/ui-tune.cjs`
- Test: `test/uitunetest.cjs`

**Interfaces:**
- Consumes: Task 1 钉死的 REGIONS 选择器;`cdp.cjs` 的 `listTargets`/`connect`(仅 applyTune 用,Task 3 才加)。
- Produces(Task 3/4/5 依赖,签名逐字):
  - `TUNE_STYLE_ID = "zcode-user-ui-tune"`(常量)
  - `CONFIG_FILENAME = "ui-tune.json"`(常量)
  - `REGION_KEYS = ["sidebar","chat","input","topbar"]`
  - `defaultConfig()` → `{version:1, regions:{sidebar:{alpha:0,blur:0}, chat:{...}, input:{...}, topbar:{...}}}`
  - `normalizeConfig(raw)` → `{config, isDefault}`(raw 可为任意值,永不抛)
  - `buildTuneStyle(config)` → CSS 字符串或 `null`(全区域为 0)
  - `buildTuneExpression(styleId, cssOrNull)` → IIFE 字符串(cssOrNull 为 null/undefined 时 = 纯移除)
  - `readConfigFile(filePath)` → `{config, isDefault}`(文件缺失/坏 JSON → 默认)
  - `applyTune(config)` → `Promise<{affected, total}>`(Task 3 添加)

- [ ] **Step 1: 写失败测试 `test/uitunetest.cjs`**

```js
// Test lib/ui-tune.cjs pure helpers (spec 2026-09-16-ui-glass-tune §7 第一层).
const ut = require("../lib/ui-tune.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

const TUNE_ID = "zcode-user-ui-tune"; // 字面量镜像,防常量漂移(对齐 videomutetest 钉法)

// === normalizeConfig ===
var def = ut.normalizeConfig(undefined);
check("normalize: undefined -> default", def.isDefault === true && def.config.version === 1);
check("normalize: default has 4 regions all-0",
  ["sidebar", "chat", "input", "topbar"].every(function (k) {
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
// 混合:只有 sidebar 非 0 -> chat/input/topbar 规则不出现
check("build: zero regions skipped", css1.indexOf("conversation") === -1 && css1.indexOf("bg-input") === -1 && css1.indexOf("workspace-header") === -1);

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
  var els = {};
  var doc = { documentElement: {}, getElementById: function (id) { return els[id] || null; },
    createElement: function () { return { id: "", textContent: "", appended: false }; } };
  doc.createElement = function () {
    var el = { id: "", textContent: "" };
    el.remove = function () { delete els[el.id]; };
    return el;
  };
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

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node test/uitunetest.cjs
```

预期:FAIL `Cannot find module '../lib/ui-tune.cjs'`。

- [ ] **Step 3: 写 `lib/ui-tune.cjs`(纯函数部分 + readConfigFile)**

```js
// Per-region glass tuner for the ZCode main page (spec 2026-09-16-ui-glass-tune).
// WHY a separate module (not in cdp.cjs): cdp.cjs is READ-ONLY by design
// (AGENTS.md). This is a WRITE op (injects/updates/removes a second <style>
// layer). Mirrors lib/video-mute.cjs: standalone write module, reuses cdp.cjs
// neutral plumbing (connect/listTargets), never duplicates CDP glue (教训 1).
//
// Single source of truth for persisted state: <root>/ui-tune.json. The <style>
// element in the page is a projection of it — no server-memory mirror (防漂移).
// Default (all-zero) = layer removed = exactly today's full-transparent look.

const fs = require("fs");

const TUNE_STYLE_ID = "zcode-user-ui-tune";
const CONFIG_FILENAME = "ui-tune.json";

const REGION_KEYS = ["sidebar", "chat", "input", "topbar"];

// Region -> CSS selector list. ANCHORS from the real-machine spike (Task 1,
// recorded in the spec appendix); scripts/inspect-regions.cjs is the diagnostic
// tool when a ZCode update moves the DOM. Single authority — change selectors
// HERE only.
const REGIONS = {
  sidebar: ['aside[data-testid="sidebar"]'],
  // chat/input/topbar 选择器以 Task 1 spike 结论为准——执行时从 spec 附录抄入。
  // 以下是 brainstorm 探测的初版(spike 未推翻前有效):
  chat: ['[data-testid="conversation-column"]'],
  input: ['.bg-input'],
  topbar: ['[data-testid="workspace-header"]'],
};

// Glass tint per ZCode theme (dispatched off <html> class, same signal
// wallpaper.css uses). Dark = dark smoke, light = light frost.
const TINT_DARK = "24,24,28";
const TINT_LIGHT = "248,248,248";

function clampInt(v, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min; // NaN/undefined -> min (0)
  return Math.min(max, Math.max(min, n));
}

function defaultConfig() {
  const regions = {};
  for (const k of REGION_KEYS) regions[k] = { alpha: 0, blur: 0 };
  return { version: 1, regions: regions };
}

// Pure, total (never throws). Unknown shape -> default. version !== 1 -> default
// (spec §4: 未来格式变更时旧文件整体作废,不做迁移).
function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 1 || !raw.regions || typeof raw.regions !== "object") {
    return { config: defaultConfig(), isDefault: true };
  }
  const config = defaultConfig();
  for (const k of REGION_KEYS) {
    const r = raw.regions[k];
    if (!r || typeof r !== "object") continue;
    config.regions[k].alpha = clampInt(r.alpha, 0, 100);
    config.regions[k].blur = clampInt(r.blur, 0, 24);
  }
  let isDefault = true;
  for (const k of REGION_KEYS) {
    if (config.regions[k].alpha !== 0 || config.regions[k].blur !== 0) { isDefault = false; break; }
  }
  return { config: config, isDefault: isDefault };
}

// Pure: normalized config -> full CSS string, or null when every region is at
// zero (caller must then REMOVE the layer — null means "no layer").
function buildTuneStyle(config) {
  const n = normalizeConfig(config);
  let css = "";
  for (const key of REGION_KEYS) {
    const r = n.config.regions[key];
    const sels = REGIONS[key] || [];
    if (sels.length === 0) continue;
    if (r.alpha === 0 && r.blur === 0) continue; // zero region -> no rules
    const a = (r.alpha / 100).toFixed(2);
    [[".theme-zai-dark ", TINT_DARK], [".theme-zai-light ", TINT_LIGHT]].forEach(function (th) {
      css += sels.map(function (s) { return th[0] + s; }).join(",") + "{";
      if (r.alpha > 0) css += "background-color:rgba(" + th[1] + "," + a + ") !important;";
      if (r.blur > 0) css += "backdrop-filter:blur(" + r.blur + "px) !important;-webkit-backdrop-filter:blur(" + r.blur + "px) !important;";
      css += "}";
    });
  }
  return css.length > 0 ? css : null;
}

// Pure: build the Runtime.evaluate expression that creates/replaces (cssOrNull
// truthy) or removes (falsy) the layer. Returns JSON {ok, present} so the
// caller can count affected windows (mirrors buildMuteExpression's JSON shape).
function buildTuneExpression(styleId, cssOrNull) {
  return "(function(){var id=" + JSON.stringify(styleId) +
    ";var old=document.getElementById(id);if(old)old.remove();" +
    (cssOrNull
      ? "var s=document.createElement('style');s.id=id;s.textContent=" + JSON.stringify(cssOrNull) +
        ";document.documentElement.appendChild(s);"
      : "") +
    "return JSON.stringify({ok:true,present:!!document.getElementById(id)});})()";
}

// Shared reader for server (/api/uitune) and inject.cjs (re-apply on inject).
// Missing/corrupt/half-written file -> default (atomic write's .tmp+rename
// makes half-writes near-impossible; this is the second belt).
function readConfigFile(filePath) {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (e) { raw = null; }
  return normalizeConfig(raw);
}

module.exports = {
  TUNE_STYLE_ID, CONFIG_FILENAME, REGION_KEYS, REGIONS,
  defaultConfig, normalizeConfig, buildTuneStyle, buildTuneExpression, readConfigFile,
};
```

**执行注意**:REGIONS 常量里 `chat/input/topbar` 的选择器必须按 Task 1 spec 附录替换(若 spike 推翻了初版)。若 sidebar 判定"需要 inline 覆盖分支",在 buildTuneExpression 的创建分支里追加(仅此时加,否则 YAGNI):

```js
// inline 覆盖分支(仅当 Task 1 判定 sidebar 有 CSS 够不到的硬画块时加):
// CSS 变量/类盖不住的实色由 inline style 直接压——表达式创建 style 后追加:
// "document.querySelectorAll(" + JSON.stringify(sel) + ").forEach(function(el){" +
//   "el.style.setProperty('background-color','rgba(24,24,28," + a + ")','important');" +
//   "el.style.setProperty('backdrop-filter','blur(" + r.blur + "px)','important');});"
// (inline 不随主题切换,硬画块本身也不随主题走——可接受,spec §6 风险项结论记录)
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node test/uitunetest.cjs
```

预期:全部 PASS,`0 failed`。

- [ ] **Step 5: Commit(仅当用户当轮要求;否则跳过并汇报改动)**

```bash
git add lib/ui-tune.cjs test/uitunetest.cjs && git commit -m "feat(uitune): 玻璃调节纯函数层 normalize/build/read + 单测"
```

---

### Task 3: `applyTune` + server `/api/uitune` 路由 + server 测试 + .gitignore

**Files:**
- Modify: `lib/ui-tune.cjs`(追加 applyTune)
- Modify: `lib/control-server.cjs`(顶部 require 区 + createServer 内路由)
- Modify: `test/controlservertest.cjs`(追加断言)
- Modify: `.gitignore`(追加 `ui-tune.json`)

**Interfaces:**
- Consumes: Task 2 全部导出(`TUNE_STYLE_ID`/`CONFIG_FILENAME`/`normalizeConfig`/`buildTuneStyle`/`buildTuneExpression`/`readConfigFile`);`cdp.cjs` 的 `listTargets`(已过滤工具页)/`connect`。
- Produces:
  - `uiTune.applyTune(config)` → `Promise<{affected, total}>`(config 为已 normalize 的 config;CDP 不可达时 reject)
  - `createServer(opts)` 新增可选 **`opts.applyTune`**(函数,默认 `uiTune.applyTune`;测试注入 stub 保证机况无关——预检裁决:本机 9222 常开,硬调真实现会让测试副作用注入真实 ZCode 且 `applied:false` 断言必挂)
  - HTTP:`GET /api/uitune` → 200 `{config, isDefault}`;`POST /api/uitune` body `{version:1,regions:{...}}` → 200 `{saved:true, isDefault, applied:true, affected, total}` 或 `{saved:true, isDefault, applied:false, reason}`;坏 JSON → 400。

- [ ] **Step 1: 在 controlservertest.cjs 先写失败断言**

**(a)** 改测试文件顶部**既有的** createServer 调用(注入 applyTune stub——预检裁决:本机 9222 常开,硬调真实现会让测试副作用注入真实 ZCode 且 `applied:false` 断言必挂;stub 第一次调用 reject 验降级分支,第二次 resolve 验字段映射,机况无关)。把:

```js
  const srv = await createServer({ root, port, host: "127.0.0.1" });
```

改为:

```js
  // applyTune stub (预检裁决): 第一次 reject(降级分支), 第二次 resolve(字段映射)
  let applyCalls = 0;
  const srv = await createServer({ root, port, host: "127.0.0.1",
    applyTune: function () {
      applyCalls++;
      if (applyCalls === 1) return Promise.reject(new Error("no cdp in test"));
      return Promise.resolve({ affected: 2, total: 3 });
    } });
```

**(b)** 在 try 块末尾(`/api/action bad json -> 400` 断言之后、`finally` 之前——以文件实际结构为准,找同层级的最后一个 check 追加)插入:

```js
    // ---- /api/uitune (玻璃调节, spec 2026-09-16 §7 第二层) ----
    const tunePath = path.join(root, "ui-tune.json");
    const g0 = await httpReq("GET", base + "/api/uitune");
    check("uitune GET: 200 default", g0.status === 200);
    const g0j = JSON.parse(g0.body);
    check("uitune GET: no file -> isDefault true", g0j.isDefault === true && g0j.config.version === 1);
    check("uitune GET: all regions zero",
      ["sidebar", "chat", "input", "topbar"].every(function (k) {
        return g0j.config.regions[k].alpha === 0 && g0j.config.regions[k].blur === 0;
      }));
    const p1 = await httpReq("POST", base + "/api/uitune",
      JSON.stringify({ version: 1, regions: { sidebar: { alpha: 55, blur: 12 } } }));
    check("uitune POST: 200 saved", p1.status === 200);
    const p1j = JSON.parse(p1.body);
    check("uitune POST: saved true + isDefault false", p1j.saved === true && p1j.isDefault === false);
    check("uitune POST: applyTune reject -> applied:false + reason (降级分支)", p1j.applied === false && typeof p1j.reason === "string");
    check("uitune POST: file written to disk", fs.existsSync(tunePath));
    const onDisk = JSON.parse(fs.readFileSync(tunePath, "utf8"));
    check("uitune POST: disk content correct", onDisk.regions.sidebar.alpha === 55 && onDisk.regions.sidebar.blur === 12);
    const g1 = await httpReq("GET", base + "/api/uitune");
    check("uitune GET after POST: round-trip", JSON.parse(g1.body).config.regions.sidebar.alpha === 55);
    const p2 = await httpReq("POST", base + "/api/uitune",
      JSON.stringify({ version: 1, regions: { sidebar: { alpha: 999, blur: -3 } } }));
    const p2j = JSON.parse(p2.body);
    const onDisk2 = JSON.parse(fs.readFileSync(tunePath, "utf8"));
    check("uitune POST: clamp on write (999->100, -3->0)", p2.status === 200 &&
      onDisk2.regions.sidebar.alpha === 100 && onDisk2.regions.sidebar.blur === 0);
    check("uitune POST: applyTune resolve -> applied:true + affected/total 映射", p2j.applied === true && p2j.affected === 2 && p2j.total === 3);
    const p3 = await httpReq("POST", base + "/api/uitune", "not json{");
    check("uitune POST: bad json -> 400 (不触 applyTune)", p3.status === 400);
```

- [ ] **Step 2: 跑测试确认新断言失败**

```bash
node test/controlservertest.cjs
```

预期:uitune 各条 FAIL(GET 404)。

- [ ] **Step 3: 实现——ui-tune.cjs 追加 applyTune**

在 `lib/ui-tune.cjs` 的 `readConfigFile` 之后、`module.exports` 之前追加:

```js
// Effectful: push the layer to every (filtered) page target via CDP.
// listTargets() already excludes tool pages (/control/, /reader/, /api/) —
// the glass layer must never land in our own tool pages. css=null -> removal
// pass (used when config returns to default). Per-target failure is skipped,
// not fatal (mirrors video-mute.cjs setVideoMuted). Rejects only when the
// port itself is unreachable (caller turns that into applied:false).
async function applyTune(config) {
  const cdp = require("./cdp.cjs");
  const expression = buildTuneExpression(TUNE_STYLE_ID, buildTuneStyle(config));
  const targets = await cdp.listTargets();
  let affected = 0;
  for (const t of targets) {
    let ws;
    try {
      const connected = await cdp.connect(t.webSocketDebuggerUrl);
      ws = connected.ws;
      await connected.call("Runtime.evaluate", { expression: expression, returnByValue: true });
      affected++;
    } catch (e) {
      // per-target fail, continue (don't let one bad window abort the rest)
    } finally {
      if (ws) { try { ws.close(); } catch (e) {} }
    }
  }
  return { affected: affected, total: targets.length };
}
```

`module.exports` 追加 `applyTune`。

- [ ] **Step 4: 实现——control-server.cjs 路由**

顶部 require 区(`const hindsight = ...` 之后)加:

```js
const uiTune = require("./ui-tune.cjs");
```

`createServer` 内、`const rotateStatePath = ...` 行之后加:

```js
const tuneConfigPath = path.join(root, uiTune.CONFIG_FILENAME);
// Test seam (预检裁决): controlservertest injects a stub so tests never touch
// a live ZCode. Default = the real CDP apply.
const applyTuneFn = opts.applyTune || uiTune.applyTune;
```

`handle()` 里、`// action API` 注释块**之前**插入路由(放 /api/status 与 /api/action 之间):

```js
      // ---- 玻璃调节 (ui-tune, spec 2026-09-16 §5) ----
      // GET: read config (missing/corrupt -> default). POST: normalize + atomic
      // write (.tmp+rename) + applyTune. Instant path, mirrors muteVideo: no
      // jobId, no global lock; CDP down -> saved:true + applied:false, never 500.
      if (p === "/api/uitune" && method === "GET") {
        return sendJson(res, 200, uiTune.readConfigFile(tuneConfigPath));
      }
      if (p === "/api/uitune" && method === "POST") {
        let tuneBody = "";
        req.on("data", (c) => (tuneBody += c));
        req.on("end", () => {
          let tuneReq;
          try { tuneReq = JSON.parse(tuneBody); } catch (e) { return sendJson(res, 400, { error: "bad json" }); }
          const n = uiTune.normalizeConfig(tuneReq);
          try {
            const tmp = tuneConfigPath + ".tmp";
            fs.writeFileSync(tmp, JSON.stringify(n.config, null, 2));
            fs.renameSync(tmp, tuneConfigPath);
          } catch (e) {
            return sendJson(res, 500, { error: "write failed: " + e.message });
          }
          // req.on("end") callback is NOT async -> .then/.catch, not await
          // (same blast-radius rule as the muteVideo branch above).
          applyTuneFn(n.config).then(function (r) {
            return sendJson(res, 200, { saved: true, isDefault: n.isDefault, applied: true, affected: r.affected, total: r.total });
          }).catch(function (e) {
            return sendJson(res, 200, { saved: true, isDefault: n.isDefault, applied: false, reason: e.message });
          });
        });
        return;
      }
```

- [ ] **Step 5: `.gitignore` 追加一行**

```
ui-tune.json
```

验证:`git check-ignore ui-tune.json` 输出该路径即生效。

- [ ] **Step 6: 跑测试确认通过**

```bash
node test/controlservertest.cjs && node test/uitunetest.cjs
```

预期:两个文件全 PASS(uitunetest 不受 applyTune 追加影响)。

- [ ] **Step 7: Commit(仅当用户当轮要求;否则跳过并汇报)**

```bash
git add lib/ui-tune.cjs lib/control-server.cjs test/controlservertest.cjs .gitignore && git commit -m "feat(uitune): applyTune CDP 写 + /api/uitune GET/POST + server 测试"
```

---

### Task 4: inject.cjs 三路径集成(清理 + 附带重建)+ 回归断言

**Files:**
- Modify: `lib/inject.cjs`(require、buildExpression/buildVideoExpression 第三参、verifyExpression remove 分支、main 传参)
- Modify: `test/selftest.cjs`(Test 4f/4g/4h)
- Modify: `test/cdp-mock-test.cjs`(tune id 出现在表达式断言)

**Interfaces:**
- Consumes: Task 2 的 `TUNE_STYLE_ID`/`CONFIG_FILENAME`/`buildTuneStyle`/`readConfigFile`。
- Produces: `buildExpression(mode, css, tuneCss?)` / `buildVideoExpression(css, videoUrl, tuneCss?)`——第三参可选(默认 null = 仅清理不重建),**向后兼容既有两参调用**(selftest 既有用例不改)。不变量:三种 MODE 的表达式都管理 tune 元素——remove/inject 清掉;inject/video 且 tuneCss 非空时清掉旧的再建新的("三个清理点一个目标")。

- [ ] **Step 1: 先写失败测试(selftest 追加,放在 Test 4e 之后)**

`test/selftest.cjs` 顶部 require 行的解构里追加 `TUNE_ID_SOURCE` 不需要——直接用字面量(镜像 VIDEO_EL_ID 钉法),在 Test 4e 块后插入:

```js
// --- Test 4f/4g/4h: 玻璃调节层 (zcode-user-ui-tune) 三路径管理 ---
// 不变量(spec 2026-09-16 §3):任何注入/移除路径都必须管理 tune 层——
// remove 清掉;inject/video 清掉旧的,配置非默认时再建新的。
const TUNE_ID = "zcode-user-ui-tune";

// 4f: --remove 清掉 tune 层
{
  const { document } = makeFakeDom();
  const tuneFn = new Function("document", "return " + buildTuneExprForTest(TUNE_ID, "body{g:1}"));
  tuneFn(document);
  check("tune-remove pre: tune el exists", !!document.getElementById(TUNE_ID));
  const rem = new Function("document", "return " + buildExpression("remove", "", null));
  rem(document);
  check("remove: tune layer gone", !document.getElementById(TUNE_ID));
  check("remove: style+video also gone", !document.getElementById(STYLE_ID) && !document.getElementById(VIDEO_EL_ID));
}

// 4g: inject 不带 tuneCss -> 清掉残留 tune 层,不重建(配置为默认)
{
  const { document } = makeFakeDom();
  const tuneFn = new Function("document", "return " + buildTuneExprForTest(TUNE_ID, "body{old:1}"));
  tuneFn(document);
  const imgFn = new Function("document", "return " + buildExpression("inject", "body{bg:url(x.jpg)}", null));
  imgFn(document);
  check("inject-no-tune: stale tune layer cleared", !document.getElementById(TUNE_ID));
  check("inject-no-tune: wallpaper style present", !!document.getElementById(STYLE_ID));
}

// 4h: inject 带 tuneCss -> 清旧建新
{
  const { document } = makeFakeDom();
  const tuneFn = new Function("document", "return " + buildTuneExprForTest(TUNE_ID, "body{old:1}"));
  tuneFn(document);
  const imgFn = new Function("document", "return " + buildExpression("inject", "body{bg:url(x.jpg)}", "aside[data-testid=x]{background:rgba(0,0,0,.5)}"));
  imgFn(document);
  const tuneEl = document.getElementById(TUNE_ID);
  check("inject-with-tune: tune layer rebuilt", !!tuneEl);
  check("inject-with-tune: new css applied", tuneEl && tuneEl.textContent === "aside[data-testid=x]{background:rgba(0,0,0,.5)}");
}

// 4i: video 注入带 tuneCss -> 同样重建
{
  const { document } = makeFakeDom();
  const vidFn = new Function("document", "return " + buildVideoExpression("body{a:1}", "file:///x/v.mp4", "aside[data-testid=x]{g:1}"));
  vidFn(document);
  check("video-with-tune: tune layer present", !!document.getElementById(TUNE_ID));
}
```

同文件里加一个本地帮助函数(放 makeFakeDom 定义附近;它就是 ui-tune 的表达式构造的自包含复制,避免 selftest 依赖 ui-tune 模块——钉的是 **inject.cjs 表达式对 tune id 的管理**,不是 ui-tune 本身):

```js
function buildTuneExprForTest(styleId, css) {
  return "(function(){var id=" + JSON.stringify(styleId) +
    ";var old=document.getElementById(id);if(old)old.remove();" +
    (css ? "var s=document.createElement('style');s.id=id;s.textContent=" + JSON.stringify(css) +
      ";document.documentElement.appendChild(s);" : "") +
    "return JSON.stringify({ok:true});})()";
}
```

- [ ] **Step 2: 跑 selftest 确认 4f-4i 失败**

```bash
node test/selftest.cjs
```

预期:4f/4g/4h FAIL(remove/inject 表达式还没管 tune 层)。4i 也会 FAIL。

- [ ] **Step 3: 实现 inject.cjs**

(a) 顶部 require 区(`const cdp = require("./cdp.cjs");` 之后)加:

```js
const uiTune = require("./ui-tune.cjs");
```

(b) `buildExpression` 换成(第三参可选,向后兼容):

```js
function buildExpression(mode, css, tuneCss) {
  if (mode === "remove") {
    // Remove style + video + glass-tune layer. A single --remove cleans up
    // whichever were applied (三个清理点一个目标: tune 层是第三条腿).
    return (
      "(function(){var s=document.getElementById(" +
      JSON.stringify(STYLE_ID) +
      ");var v=document.getElementById(" +
      JSON.stringify(VIDEO_EL_ID) +
      ");var t=document.getElementById(" +
      JSON.stringify(uiTune.TUNE_STYLE_ID) +
      ");var did=false;if(s){s.remove();did=true;}if(v){v.remove();did=true;}if(t){t.remove();did=true;}" +
      "return did?'removed':'none';})()"
    );
  }
  // inject (image mode): refresh <style>, remove lingering <video>, and manage
  // the glass-tune layer: clear any old one, re-create only when tuneCss is
  // non-null (config non-default). Same cleanup discipline as the video el.
  return (
    "(function(){var id=" +
    JSON.stringify(STYLE_ID) +
    ";var existing=document.getElementById(id);if(existing)existing.remove();" +
    "var oldV=document.getElementById(" +
    JSON.stringify(VIDEO_EL_ID) +
    ");if(oldV){oldV.remove();}" +
    tuneStep(tuneCss) +
    "var s=document.createElement('style');s.id=id;s.textContent=" +
    JSON.stringify(css) +
    ";document.documentElement.appendChild(s);return 'ok';})();"
  );
}
```

(c) `buildVideoExpression` 签名加第三参,并在 style 重建段之后插入 `tuneStep(tuneCss)`(放在 `// 2) Refresh the <video>` 注释之前):

```js
function buildVideoExpression(css, videoUrl, tuneCss) {
  return (
    "(function(){" +
    "var sid=" +
    JSON.stringify(STYLE_ID) +
    ";var oldS=document.getElementById(sid);if(oldS){oldS.remove();}" +
    "var s=document.createElement('style');s.id=sid;s.textContent=" +
    JSON.stringify(css) +
    ";document.documentElement.appendChild(s);" +
    tuneStep(tuneCss) +
    // ……以下 video 部分逐字保留原实现……
```

(d) 新帮助函数(buildExpression 之前):

```js
// Glass-tune layer sub-step shared by inject/video paths: clear old layer,
// re-create only when tuneCss is non-null. remove path has its own inline
// removal (it must count toward `did`). Keeps "三个清理点一个目标" in ONE
// helper — 2/3 路径管理就是能各自再坏一次 (AGENTS.md 教训 1).
function tuneStep(tuneCss) {
  const T = JSON.stringify(uiTune.TUNE_STYLE_ID);
  return (
    "var ot=document.getElementById(" + T + ");if(ot){ot.remove();}" +
    (tuneCss
      ? "var tu=document.createElement('style');tu.id=" + T + ";tu.textContent=" +
        JSON.stringify(tuneCss) + ";document.documentElement.appendChild(tu);"
      : "")
  );
}
```

(e) `verifyExpression` 的 remove 分支加第三个存在性检查(tune 层残留 = 没清干净):

```js
    if (mode === "remove") {
      return (
        "(document.getElementById(" +
        JSON.stringify(STYLE_ID) +
        ")||document.getElementById(" +
        JSON.stringify(VIDEO_EL_ID) +
        ")||document.getElementById(" +
        JSON.stringify(uiTune.TUNE_STYLE_ID) +
        "))?'present':'gone'"
      );
    }
```

(f) `main()` 里,`const expression = ...` 行改为:

```js
  // Glass-tune CSS: inject/video rebuild the layer from ui-tune.json (survives
  // restart); remove always passes null (pure cleanup). buildTuneStyle returns
  // null for default config -> tuneStep clears without rebuilding.
  let tuneCss = null;
  if (MODE === "inject" || MODE === "video") {
    tuneCss = uiTune.buildTuneStyle(
      uiTune.readConfigFile(path.join(__dirname, "..", uiTune.CONFIG_FILENAME)).config
    );
  }
  const expression =
    MODE === "video"
      ? buildVideoExpression(css, videoChosenUrl, tuneCss)
      : buildExpression(MODE, css, tuneCss);
```

- [ ] **Step 4: cdp-mock-test 追加端到端断言**

在 `test/cdp-mock-test.cjs` 第 5 步(video->image 断言)之后追加:

```js
  // 6. Glass-tune layer: inject expressions must MANAGE the tune el
  //    (clear-then-maybe-recreate). Mock captures only the main expression;
  //    assert it references the tune id (cleanup discipline, spec 2026-09-16).
  check(
    "image inject expression references glass-tune id",
    lastExpression.indexOf("zcode-user-ui-tune") !== -1
  );
```

- [ ] **Step 5: 跑全部相关测试**

```bash
node test/selftest.cjs && node test/cdp-mock-test.cjs && node test/cdp-retry-test.cjs && node test/cdptest.cjs
```

预期:全 PASS(既有用例不受第三可选参影响——两参调用 tuneCss=undefined,`tuneStep(undefined)` = 纯清理子步,正好符合 4g 预期)。

- [ ] **Step 6: 真机快速验证注入链**

```bash
npm run inject
```

预期:输出「完成，影响窗口 ≥1」。然后 CDP 探测 tune 层状态(配置文件尚不存在 → 默认 → **tune 层应不存在**):

```bash
node -e "const{WebSocket}=require('ws');const http=require('http');http.get({host:'127.0.0.1',port:9222,path:'/json'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const t=JSON.parse(d).find(t=>t.type==='page'&&/app\.asar/.test(t.url));const ws=new WebSocket(t.webSocketDebuggerUrl.replace('ws://localhost','ws://127.0.0.1:9222'));ws.on('open',()=>{ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'JSON.stringify({tune:!!document.getElementById(\\'zcode-user-ui-tune\\'),wp:!!document.getElementById(\\'zcode-user-wallpaper\\')})',returnByValue:true}}));});ws.on('message',m=>{const v=JSON.parse(m).result.result.value;console.log('page state:',v);const o=JSON.parse(v);if(o.wp===true&&o.tune===false){console.log('OK: wallpaper present, tune layer absent (default config)');}else{console.log('UNEXPECTED');}ws.close();});});});"
```

预期:`OK: wallpaper present, tune layer absent (default config)`。

- [ ] **Step 7: Commit(仅当用户当轮要求;否则跳过并汇报)**

```bash
git add lib/inject.cjs test/selftest.cjs test/cdp-mock-test.cjs && git commit -m "feat(uitune): inject.cjs 三路径管理玻璃层 + selftest/mock 回归"
```

---

### Task 5: 控制中心 UI(HTML/CSS/JS 接线)

**Files:**
- Modify: `control/index.html`(壁纸 tab 加「玻璃调节」组)
- Modify: `control/control.js`(渲染/回填/防抖保存/重置/poll 提示)
- Modify: `control/control.css`(.glass-row 布局)

**Interfaces:**
- Consumes: Task 3 的 HTTP 契约(GET/POST `/api/uitune`);Task 1 的四区域中文名固定为:侧边栏/主对话区/输入框/顶栏。
- Produces: 用户可见的滑块面板。无新导出(control.js 是 IIFE,内部函数不外露——对齐 rotate 控件的内联写法)。

- [ ] **Step 1: index.html 加组**

在「壁纸轮播」`</div>`(action-group 结束)与「维护」action-group 之间插入:

```html
      <div class="action-group">
        <div class="group-title">玻璃调节</div>
        <div id="glass-nowp-hint" class="banner warn-banner" style="display:none">尚未注入壁纸 — 玻璃效果需壁纸在底层才可见（配置仍会保存）</div>
        <div id="glass-rows"></div>
        <div class="inline-row"><button id="glass-reset">全部重置</button><span id="glass-msg" class="toast-inline"></span></div>
      </div>
```

- [ ] **Step 2: control.css 加样式**

在 `.inline-row { ... }` 规则之后追加:

```css
/* 玻璃调节行 (spec 2026-09-16 §3): 区域名 + 两个滑杆 + 数值 */
.glass-row { display: flex; align-items: center; gap: var(--space-2); margin: 6px 0; font-size: var(--fs-sm); }
.glass-name { width: 64px; flex: none; color: var(--text-secondary); }
.glass-row label { display: inline-flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
.glass-row input[type="range"] { width: 88px; }
.glass-val { width: 26px; flex: none; text-align: right; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
```

- [ ] **Step 3: control.js 接线**

(a) 在 `// ---- bookmark panel ----` 注释之前插入整段:

```js
  // ---- 玻璃调节 (ui-tune, spec 2026-09-16) ----
  // 滑块 input -> 300ms 防抖 -> POST /api/uitune(整份配置,最后一次为准)。
  // 回填只在启动时做一次:poll 每 2s 跑,不能覆盖用户正在拖的滑块。
  var GLASS_REGIONS = [
    { key: "sidebar", name: "侧边栏" },
    { key: "chat", name: "主对话区" },
    { key: "input", name: "输入框" },
    { key: "topbar", name: "顶栏" }
  ];
  function renderGlassRows() {
    var host = document.getElementById("glass-rows");
    if (!host) return;
    var html = "";
    GLASS_REGIONS.forEach(function (r) {
      html += '<div class="glass-row" data-region="' + r.key + '">' +
        '<span class="glass-name">' + r.name + '</span>' +
        '<label>不透明 <input type="range" min="0" max="100" value="0" data-glass="alpha"><span class="glass-val">0</span></label>' +
        '<label>模糊 <input type="range" min="0" max="24" value="0" data-glass="blur"><span class="glass-val">0</span></label>' +
        '</div>';
    });
    host.innerHTML = html;
  }
  function glassRowEl(key) {
    return document.querySelector('.glass-row[data-region="' + key + '"]');
  }
  function setGlassInput(row, prop, v) {
    var inp = row.querySelector('input[data-glass="' + prop + '"]');
    if (!inp) return;
    inp.value = v;
    if (inp.nextElementSibling) inp.nextElementSibling.textContent = String(v);
  }
  function fillGlassRows(config) {
    GLASS_REGIONS.forEach(function (r) {
      var row = glassRowEl(r.key);
      if (!row) return;
      var reg = (config && config.regions && config.regions[r.key]) || { alpha: 0, blur: 0 };
      setGlassInput(row, "alpha", reg.alpha || 0);
      setGlassInput(row, "blur", reg.blur || 0);
    });
  }
  function collectGlassConfig() {
    var regions = {};
    GLASS_REGIONS.forEach(function (r) {
      var row = glassRowEl(r.key);
      var a = row ? row.querySelector('input[data-glass="alpha"]') : null;
      var b = row ? row.querySelector('input[data-glass="blur"]') : null;
      regions[r.key] = { alpha: a ? (parseInt(a.value, 10) || 0) : 0, blur: b ? (parseInt(b.value, 10) || 0) : 0 };
    });
    return { version: 1, regions: regions };
  }
  function setGlassMsg(text, isErr) {
    var el = document.getElementById("glass-msg");
    if (!el) return;
    el.textContent = text;
    el.className = "toast-inline" + (isErr ? " err" : " ok");
    setTimeout(function () { el.textContent = ""; el.className = "toast-inline"; }, 2500);
  }
  function saveGlassConfig() {
    fetch("/api/uitune", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectGlassConfig()) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.applied) setGlassMsg("已应用（" + j.affected + "/" + j.total + " 窗口）", false);
        else setGlassMsg("已保存，未连接 ZCode — 下次注入壁纸时生效", true);
      })
      .catch(function () { /* server down; next input retries */ });
  }
  var glassSaveTimer = null;
  var glassRowsEl = document.getElementById("glass-rows");
  if (glassRowsEl) glassRowsEl.addEventListener("input", function (e) {
    var inp = e.target;
    if (!inp.getAttribute || !inp.getAttribute("data-glass")) return;
    if (inp.nextElementSibling) inp.nextElementSibling.textContent = inp.value;
    if (glassSaveTimer) clearTimeout(glassSaveTimer);
    glassSaveTimer = setTimeout(saveGlassConfig, 300);
  });
  var glassResetBtn = document.getElementById("glass-reset");
  if (glassResetBtn) glassResetBtn.addEventListener("click", function () {
    GLASS_REGIONS.forEach(function (r) {
      var row = glassRowEl(r.key);
      if (!row) return;
      setGlassInput(row, "alpha", 0);
      setGlassInput(row, "blur", 0);
    });
    saveGlassConfig();
  });
  renderGlassRows();
  fetch("/api/uitune").then(function (r) { return r.json(); })
    .then(function (cfg) { fillGlassRows(cfg.config); }).catch(function () {});
```

(b) `poll()` 内,`var hasWallpaper = ...;` 行之后追加:

```js
      // 玻璃调节提示:壁纸没注时玻璃效果不可见(配置照存)
      var glassHint = document.getElementById("glass-nowp-hint");
      if (glassHint) glassHint.style.display = hasWallpaper ? "none" : "block";
```

- [ ] **Step 4: 真浏览器烟测(自动化,不需要人眼)**

确认 control-server 在跑(用户日常 `start.vbs` 常驻;若 17890 不通,后台起一个:`npm run control` 需要 ZCode 无关——它只依赖 node)。然后:

```bash
curl -s http://127.0.0.1:17890/control/ | grep -c "glass-rows"
```

预期输出 ≥1(新组已上线)。**注意**:server 是常驻旧进程的话,新路由 `/api/uitune` 会 404——这是 memory 里已知的"旧 control-server 进程需重启才有新路由"现象。若 404,杀旧起新(PowerShell,交给用户或经用户同意后执行):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'control-server' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

然后 `start.vbs` 重启(它自带 Step 0 清旧 + 后台起新)。

- [ ] **Step 5: Commit(仅当用户当轮要求;否则跳过并汇报)**

```bash
git add control/index.html control/control.js control/control.css && git commit -m "feat(uitune): 控制中心玻璃调节滑块面板 + 防抖保存 + 无壁纸提示"
```

---

### Task 6: 注册测试 + 全量回归

**Files:**
- Modify: `package.json`(test 脚本追加 uitunetest)

**Interfaces:**
- Consumes: 前五个任务的全部产物。
- Produces: `npm test` 覆盖 uitunetest。

- [ ] **Step 1: package.json test 脚本追加**

在 `"test": "..."` 串的 `node test/videomutetest.cjs` 之后插入 `&& node test/uitunetest.cjs`(紧跟 videomutetest,同为纯函数层测试,逻辑顺序合理)。

- [ ] **Step 2: 全量回归**

```bash
npm test
```

预期:31 个测试文件全绿(30 + uitunetest)。任何红 → 先修再进 Task 7。

- [ ] **Step 3: Commit(仅当用户当轮要求;否则跳过并汇报)**

```bash
git add package.json && git commit -m "test: npm test 注册 uitunetest"
```

---

### Task 7: 端到端自动化验证 + 移交真机清单

**Files:**
- 无新文件(验证任务)。

**Interfaces:**
- Consumes: 全链路(server 路由、ui-tune 表达式、inject 集成)。
- Produces: E2E 结论 + 给用户的 11 条真机清单。

- [ ] **Step 1: E2E——临时 server + POST + CDP 探测玻璃层落页**

前置:ZCode 在跑且壁纸已注入(Task 1 起保持)。起临时 server(端口随机,避免和用户 17890 冲突):

```bash
node -e "const s=require('./lib/control-server.cjs');s.createServer({root:process.cwd(),port:0,host:'127.0.0.1'}).then(x=>{console.log('E2E_SERVER_PORT='+x.port);setTimeout(()=>process.exit(0),15000);});"
```

拿到端口后(若上面一条命令的输出方式不便捕获,改为写临时脚本 `scripts/e2e-uitune.cjs`:createServer({root, port:0}) → fetch POST /api/uitune {version:1,regions:{sidebar:{alpha:55,blur:12}}} → 断言 applied:true → CDP 探测主页 `document.getElementById('zcode-user-ui-tune')` 存在且 textContent 含 `rgba(24,24,28,0.55)` 与 `blur(12px)` → 再 POST 全 0 → 断言 style 元素消失 → server.close() 退出,exit code 0/1)并运行:

```bash
node scripts/e2e-uitune.cjs
```

预期:全 OK,exit 0。这一步验证「滑块后端等价物 → CDP → 页面 style」全链路,不依赖 GUI。

- [ ] **Step 2: E2E——重启保持**

```bash
npm run inject
```

预期输出含「选中壁纸」;随后用 Task 4 Step 6 的探测命令确认 tune 层存在且内容含 sidebar 的 rgba(配置文件此刻应是 Task 7 Step 1 留下的或手动造的;若 Step 1 结束时清成了全 0,先手工写一个非默认 `ui-tune.json` 再 inject):

```bash
node -e "require('fs').writeFileSync('ui-tune.json',JSON.stringify({version:1,regions:{sidebar:{alpha:55,blur:12},chat:{alpha:0,blur:0},input:{alpha:40,blur:8},topbar:{alpha:0,blur:0}},void 0))" && npm run inject
```

探测命令同 Task 4 Step 6,预期 `tune:true`。

- [ ] **Step 3: E2E——remove 全清**

```bash
npm run remove
```

再用 Task 4 Step 6 探测,预期 `wp:false, tune:false`(两个 id 都没了——三路径清理的最终验证)。验完重新注入恢复现场:

```bash
npm run inject
```

- [ ] **Step 4: 移交真机清单(spec §7 第四层 11 条,GUI 人眼,交给用户)**

给用户的话术模板(附 PowerShell/操作,不假设已跑):在 ZCode 浏览器面板打开控制中心 → 壁纸 tab,逐条验证并回报。清单照抄 spec §7 第四层 1-11 条。**停下等用户回贴结果,不要代替人眼。**

- [ ] **Step 5: 收尾汇报**

汇总:改动文件清单、测试结果(npm test 输出尾部)、E2E 结论、待用户验证项。提醒:`scripts/inspect-regions.cjs` 已转正为诊断工具;`ui-tune.json` 在 .gitignore。

---

## Self-Review 结论(计划自审,已修)

1. **Spec 覆盖**:§3 文件清单 9 项 → Task 2/3/4/5/6 逐一对应(含 .gitignore Task 3 Step 5、package.json Task 6);§4 数据结构/纯函数规则 → Task 2 测试逐条钉;§5 生效链路 → Task 3(POST 链)+ Task 4(重启链)+ Task 5(滑块链);§6 边界表 → CDP 不可达(Task 3 断言 applied:false)、坏配置(Task 2 readConfigFile 测试)、三路径清理(Task 4 4f-4i + mock 第 6 步)、侧边栏硬画(Task 1 Step 3 判定 + Task 2 条件分支)、backdrop-filter 性能(Task 1 冒烟 + spec 清单第 5 条人眼);§7 四层测试 → Task 2/3/4/7;§8 顺序 → 任务编号即顺序。无缺口。
2. **占位符扫描**:REGIONS 的 chat/input/topbar 选择器标注"以 Task 1 spike 结论为准"——这是刻意的真机事实依赖(spec §4 区域锚点表同款),不是 TBD;Task 1 产出附录、Task 2 有抄入动作。无 "TBD/TODO/类似 Task N"。
3. **类型一致性**:`normalizeConfig → {config, isDefault}` 在 Task 2 定义、Task 3(server)`n.config`/`n.isDefault`、Task 4 `readConfigFile(...).config`、Task 5 `cfg.config` 一致;`applyTune(config) → {affected,total}` 与 server 响应字段 `affected/total` 一致;`buildTuneExpression(styleId, cssOrNull)` 与 selftest 帮助函数形状一致;HTTP 响应字段(saved/isDefault/applied/affected/total/reason)在 Task 3 实现与测试、Task 5 前端消费三处一致。
