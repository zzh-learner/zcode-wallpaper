// Test lib/hindsight.cjs pure helpers (self-hosted 模式适配层).
// 写面（startServer/stopServer 的 spawn/端口杀）只测纯分支：
// startServer 拒非法 profile 名 + parseNetstatPids 的 GBK 安全解析 ——
// 不真跑 stop（本机 9077 是真实服务，集成测试端口杀 = 杀掉用户的记忆库）。
const fs = require("fs"), os = require("os"), path = require("path");
const hindsight = require("../lib/hindsight.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// ---------------------------------------------------------------------------
// maskToken / maskDeep
// ---------------------------------------------------------------------------
check("maskToken keeps shape drops secret", hindsight.maskToken("abcd1234efgh5678").indexOf("abcd") === -1
  && /5678\)$/.test(hindsight.maskToken("abcd1234efgh5678")));
check("maskToken empty string stays empty", hindsight.maskToken("") === "");
check("maskToken non-string passthrough", hindsight.maskToken(42) === 42);
var masked = hindsight.maskDeep({ apiToken: "secret-token-xyz", llm: { apiKey: "key-abcdef99" }, name: "plain", list: [{ password: "pw1234" }] });
check("maskDeep masks top-level apiToken", typeof masked.apiToken === "string" && masked.apiToken.indexOf("configured") === 0);
check("maskDeep masks nested llm.apiKey", typeof masked.llm.apiKey === "string" && masked.llm.apiKey.indexOf("configured") === 0);
check("maskDeep masks inside arrays", masked.list[0].password.indexOf("configured") === 0);
check("maskDeep leaves plain values", masked.name === "plain");

// ---------------------------------------------------------------------------
// coerceEnv（hindsight readEnvConfig 语义）
// ---------------------------------------------------------------------------
check("coerceEnv bool true variants", hindsight.coerceEnv("retainSessions", " YES ") === true
  && hindsight.coerceEnv("retainSessions", "0") === false);
check("coerceEnv list splits+trims", JSON.stringify(hindsight.coerceEnv("retainTags", " a, b ,,")) === JSON.stringify(["a", "b"]));
check("coerceEnv number", hindsight.coerceEnv("apiPort", "9078") === 9078);
check("coerceEnv non-number key stays string", hindsight.coerceEnv("serverMode", "self-hosted") === "self-hosted");

// ---------------------------------------------------------------------------
// buildConfigReport 分层：默认值 < env < file < file:harness
// ---------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hs-"));
const cfgPath = path.join(tmp, "coding-agent.json");
fs.writeFileSync(cfgPath, JSON.stringify({
  serverMode: "self-hosted",
  apiUrl: "http://127.0.0.1:9077",
  apiToken: "file-token-9999",
  llm: { provider: "zai", apiKey: "llm-key-7777" },
  logLevel: "debug",
  banks: { "coding-agent::x": { disabled: true, gitIngest: "full" } },
  harnesses: { "claude-code": { retainSessions: false } },
}));

var env0 = {}; // 无环境变量覆盖
var rep = hindsight.buildConfigReport("claude-code", env0, cfgPath);
check("report exists true", rep.exists === true);
check("report file-level serverMode", rep.items.find(i => i.key === "serverMode").value === "self-hosted"
  && rep.items.find(i => i.key === "serverMode").source === "file");
check("report default source for untouched key", rep.items.find(i => i.key === "autoSeed").source === "default");
check("report harness layer wins", rep.items.find(i => i.key === "retainSessions").value === false
  && rep.items.find(i => i.key === "retainSessions").source === "file:harness");
check("report apiToken item masked", rep.items.find(i => i.key === "apiToken").value.indexOf("configured") === 0);
check("report raw llm.apiKey masked", rep.raw && rep.raw.llm.apiKey.indexOf("configured") === 0);
check("report harnessSections", JSON.stringify(rep.harnessSections) === JSON.stringify(["claude-code"]));
check("report bankSections keys", rep.bankSections.length === 1 && rep.bankSections[0].id === "coding-agent::x"
  && rep.bankSections[0].keys.length === 2);

// env 层：被 file 盖住时 source=file，envActive 仍列出
var rep2 = hindsight.buildConfigReport("claude-code", { HINDSIGHT_API_PORT: "9999", HINDSIGHT_LOG_LEVEL: "warn" }, cfgPath);
var portIt = rep2.items.find(i => i.key === "apiPort");
check("env overridden by file -> source file", portIt.source === "file" ? true : portIt.value === 9999);
check("envActive lists HINDSIGHT_API_PORT", rep2.envActive.some(e => e.envVar === "HINDSIGHT_API_PORT"));
// env 层生效：key 不在 file 里
var rep3 = hindsight.buildConfigReport("claude-code", { HINDSIGHT_AUTO_SEED: "false" }, cfgPath);
var seedIt = rep3.items.find(i => i.key === "autoSeed");
check("env wins when file silent", seedIt.source === "env" && seedIt.value === false);

// 文件缺失 / 非法 JSON
var repMiss = hindsight.buildConfigReport("claude-code", env0, path.join(tmp, "nope.json"));
check("missing file -> exists false raw null", repMiss.exists === false && repMiss.raw === null && !repMiss.error);
fs.writeFileSync(path.join(tmp, "bad.json"), "{not json");
var repBad = hindsight.buildConfigReport("claude-code", env0, path.join(tmp, "bad.json"));
check("invalid json -> error field", !!repBad.error);

// ---------------------------------------------------------------------------
// runtimeView / portFromUrl（self-hosted 语义）
// ---------------------------------------------------------------------------
var view = hindsight.runtimeView(rep);
check("runtimeView self-hosted uses apiUrl", view.serverMode === "self-hosted" && view.apiUrl === "http://127.0.0.1:9077");
var daemonRep = hindsight.buildConfigReport("claude-code", env0, path.join(tmp, "daemon.json"));
fs.writeFileSync(path.join(tmp, "daemon.json"), JSON.stringify({ serverMode: "daemon", apiPort: 9078 }));
daemonRep = hindsight.buildConfigReport("claude-code", env0, path.join(tmp, "daemon.json"));
var dview = hindsight.runtimeView(daemonRep);
check("runtimeView daemon pins 127.0.0.1:port", dview.apiUrl === "http://127.0.0.1:9078");
check("portFromUrl extracts port", hindsight.portFromUrl("http://127.0.0.1:9077") === 9077);
check("portFromUrl no port -> null", hindsight.portFromUrl("https://api.example.com") === null);
check("portFromUrl invalid -> null", hindsight.portFromUrl("not a url") === null);

// ---------------------------------------------------------------------------
// resolveProfileForPort（self-hosted 核心适配：端口反查 profile）
// ---------------------------------------------------------------------------
const profilesDir = path.join(tmp, "profiles");
fs.mkdirSync(profilesDir, { recursive: true });
fs.writeFileSync(path.join(profilesDir, "coding-agent.env"), "HINDSIGHT_API_PORT=9077\nHINDSIGHT_EMBED_DAEMON_IDLE_TIMEOUT=604800\n");
fs.writeFileSync(path.join(profilesDir, "other.env"), "HINDSIGHT_API_PORT=8888\n");
check("resolveProfile matches port 9077", hindsight.resolveProfileForPort(9077, profilesDir).profile === "coding-agent"
  && hindsight.resolveProfileForPort(9077, profilesDir).byPort === true);
check("resolveProfile matches port 8888", hindsight.resolveProfileForPort(8888, profilesDir).profile === "other");
check("resolveProfile no match -> fallback", hindsight.resolveProfileForPort(7777, profilesDir).profile === "coding-agent"
  && hindsight.resolveProfileForPort(7777, profilesDir).byPort === false);
check("resolveProfile missing dir -> fallback", hindsight.resolveProfileForPort(9077, path.join(tmp, "nope")).byPort === false);
check("resolveProfile null port -> fallback", hindsight.resolveProfileForPort(null, profilesDir).byPort === false);
// 容错：带引号/空格/小写的变体行
fs.writeFileSync(path.join(profilesDir, "quoted.env"), 'HINDSIGHT_API_PORT = "9079"\n');
check("resolveProfile tolerant of quoted value", hindsight.resolveProfileForPort(9079, profilesDir).profile === "quoted");

// ---------------------------------------------------------------------------
// resolveRuntime（聚合胶水）
// ---------------------------------------------------------------------------
var rt = hindsight.resolveRuntime("claude-code", env0, cfgPath, profilesDir);
check("resolveRuntime derives profile by port", rt.profile === "coding-agent" && rt.byPort === true);
check("resolveRuntime sets view.resolvedProfile", rt.view.resolvedProfile === "coding-agent");
check("resolveRuntime paths use profile", rt.paths.daemonLog.indexOf(path.join("profiles", "coding-agent.log")) !== -1
  && rt.paths.database.indexOf("hindsight-embed-coding-agent") !== -1);
check("resolveRuntime pluginLog under tmp", rt.paths.pluginLog.indexOf("hindsight-coding-agent") !== -1);

// ---------------------------------------------------------------------------
// isValidProfileName（spawn 参数白名单）
// ---------------------------------------------------------------------------
check("valid profile names", hindsight.isValidProfileName("coding-agent") && hindsight.isValidProfileName("a") && hindsight.isValidProfileName("My_Profile2"));
check("invalid: path traversal", !hindsight.isValidProfileName("../x"));
check("invalid: spaces/cmd chars", !hindsight.isValidProfileName("a b") && !hindsight.isValidProfileName("a&b") && !hindsight.isValidProfileName("a;b"));
check("invalid: empty/non-string/null", !hindsight.isValidProfileName("") && !hindsight.isValidProfileName(null) && !hindsight.isValidProfileName(42));

// startServer 拒非法 profile（不 spawn —— 唯一安全的写面分支）
var refused = hindsight.startServer({ apiUrl: "http://127.0.0.1:9077", apiPort: 9077 }, "../evil");
check("startServer refuses invalid profile", refused.ok === false && refused.method === "refused");

// ---------------------------------------------------------------------------
// parseNetstatPids（GBK 安全：端口/PID 列是 ASCII，本地化列可以是任意字节）
// ---------------------------------------------------------------------------
var asciiNetstat = [
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    127.0.0.1:9077         0.0.0.0:0              LISTENING       18056",
  "  TCP    127.0.0.1:9077         127.0.0.1:56065        ESTABLISHED     18056",
  "  TCP    127.0.0.1:19077        0.0.0.0:0              LISTENING       999",
].join("\r\n");
check("parseNetstat finds LISTENING pid", JSON.stringify(hindsight.parseNetstatPids(asciiNetstat, 9077)) === JSON.stringify(["18056"]));
check("parseNetstat skips ESTABLISHED", hindsight.parseNetstatPids(asciiNetstat, 9077).indexOf("18056") === 0 && hindsight.parseNetstatPids(asciiNetstat, 9077).length === 1);
check("parseNetstat no substring false-match (19077 != 9077)", hindsight.parseNetstatPids(asciiNetstat, 9077).indexOf("999") === -1);
// GBK 本地化文本按 latin1 解出来的脏字符串（模拟中文 Windows netstat 输出）
var gbkLatin1 = "  TCP    127.0.0.1:9077         0.0.0.0:0              LISTENING       31337  \xD6\xD0\xB9\xFA";
check("parseNetstat survives GBK-as-latin1 columns", JSON.stringify(hindsight.parseNetstatPids(gbkLatin1, 9077)) === JSON.stringify(["31337"]));
check("parseNetstat empty -> []", hindsight.parseNetstatPids("", 9077).length === 0);
// IPv6 [::1]:9077 形态（Windows netstat 用 [::]:9077）
var v6 = "  TCP    [::]:9077              [::]:0                 LISTENING       42424";
check("parseNetstat matches ipv6 bracket form", JSON.stringify(hindsight.parseNetstatPids(v6, 9077)) === JSON.stringify(["42424"]));

// ---------------------------------------------------------------------------
// embedCommand
// ---------------------------------------------------------------------------
check("embedCommand default uvx latest", (function () { var c = hindsight.embedCommand({}); return c.cmd === "uvx" && c.base[0] === "hindsight-embed@latest"; })());
check("embedCommand pinned version", hindsight.embedCommand({ embedVersion: "0.9.2" }).base[0] === "hindsight-embed@0.9.2");
check("embedCommand package path -> uv run", (function () { var c = hindsight.embedCommand({ embedPackagePath: "G:/src/hs" }); return c.cmd === "uv" && c.base.indexOf("hindsight-embed") !== -1; })());

// ---------------------------------------------------------------------------
// tailFile
// ---------------------------------------------------------------------------
const logPath = path.join(tmp, "log.txt");
fs.writeFileSync(logPath, Array.from({ length: 300 }, (_, i) => "line" + i).join("\n"));
var tail = hindsight.tailFile(logPath, 10);
check("tailFile last 10 lines", tail.lines.length === 10 && tail.lines[9] === "line299" && tail.lines[0] === "line290");
var tailMiss = hindsight.tailFile(path.join(tmp, "nope.log"), 10);
check("tailFile missing -> exists false no throw", tailMiss.exists === false && tailMiss.lines.length === 0);
check("tailFile default 200", hindsight.tailFile(logPath).lines.length === 200);

// ---------------------------------------------------------------------------
// checkHealth / listBanks / bankPages 不可达 -> 优雅降级（不 throw）
// ---------------------------------------------------------------------------
(async () => {
  const down = await hindsight.checkHealth("http://127.0.0.1:1");
  check("checkHealth unreachable -> running false", down.running === false && typeof down.error === "string");
  const banks = await hindsight.listBanks("http://127.0.0.1:1");
  check("listBanks unreachable -> error field no throw", typeof banks.error === "string" && !banks.banks);
  const pages = await hindsight.bankPages("http://127.0.0.1:1", "x::y");
  check("bankPages unreachable -> error field no throw", typeof pages.error === "string" && !pages.pages);

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
})();
