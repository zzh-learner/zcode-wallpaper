// Hindsight 记忆服务管理（self-hosted 模式）— 纯逻辑 + 控制操作。
//
// 移植自 dsh-hindsight-manager 的 src/hindsight.ts（本机验证过的 daemon 时代实现），
// 按 hindsight 的新启动方式适配：
// - 旧（daemon 模式）：配置带 daemonProfile/daemonIdleTimeout，插件的 daemon-start.js
//   自动 profile create --merge + uvx daemon start 拉起服务。
// - 新（self-hosted 模式，本机 2026-09 起生效）：配置只有 serverMode:"self-hosted" +
//   apiUrl，插件【绝不】自动启停服务（dist/daemon-start.js 对非 daemon 模式直接 return）；
//   服务由用户自己跑（本机 = uv tool 持久安装的 hindsight-embed v0.9.x，profile
//   coding-agent，端口 9077）。控制中心补的正是这个"没人管服务"的空档。
//
// 关键适配点：
// - 启动：直接 spawn `hindsight-embed -p <profile> daemon start`（uv tool 在 PATH），
//   不再用 daemon-start.js（self-hosted 下它是 no-op）。
// - profile 解析：配置里不再有 daemonProfile —— 按 apiUrl 的端口扫
//   ~/.hindsight/profiles/*.env 里 HINDSIGHT_API_PORT 匹配；匹配不到回退 "coding-agent"
//   （本机实际 profile 名，metadata.json 的默认种子）。
// - 停止：Windows 先端口杀（netstat latin1 宽松解码 + taskkill /T /F）——hindsight-embed
//   CLI 的 daemon stop 在中文 Windows 会崩（严格 UTF-8 读 GBK 本地化的 netstat 输出，
//   reader 线程抛 UnicodeDecodeError）；CLI stop 保留为非 Windows 首选与兜底。
//
// 本模块是 hindsight 域的读写入口（HTTP 探测/查询 + CLI spawn），不动 CDP
// （对齐 video-mute.cjs 的"写模块独立"定位；cdp.cjs 保持只读不动）。
const { spawn } = require("child_process");
const { existsSync, readFileSync, readdirSync } = require("fs");
const { homedir, tmpdir } = require("os");
const { join } = require("path");

// ---------------------------------------------------------------------------
// 配置面（分层：默认值 ← 环境变量 ← 文件 ← 文件.harnesses.<harness>，后写者胜）
// 键表镜像 hindsight-coding-agents v0.4/0.5 的 loadConfig 面。
// ---------------------------------------------------------------------------

const CONFIG_KEYS = [
  { key: "serverMode", group: "server", envVar: "HINDSIGHT_SERVER_MODE" },
  { key: "apiUrl", group: "server", envVar: "HINDSIGHT_API_URL" },
  { key: "apiToken", group: "server", envVar: "HINDSIGHT_API_TOKEN" },
  { key: "apiPort", group: "server", envVar: "HINDSIGHT_API_PORT" },
  { key: "daemonProfile", group: "daemon", envVar: "HINDSIGHT_DAEMON_PROFILE" },
  { key: "daemonIdleTimeout", group: "daemon", envVar: "HINDSIGHT_DAEMON_IDLE_TIMEOUT" },
  { key: "embedVersion", group: "daemon", envVar: "HINDSIGHT_EMBED_VERSION" },
  { key: "embedPackagePath", group: "daemon", envVar: "HINDSIGHT_EMBED_PACKAGE_PATH" },
  { key: "bankId", group: "bank", envVar: "HINDSIGHT_BANK_ID" },
  { key: "dynamicBankId", group: "bank", envVar: "HINDSIGHT_DYNAMIC_BANK_ID" },
  { key: "bankIdTemplate", group: "bank", envVar: "HINDSIGHT_BANK_ID_TEMPLATE" },
  { key: "mapPathToBank", group: "bank" },
  { key: "resolveWorktrees", group: "bank", envVar: "HINDSIGHT_RESOLVE_WORKTREES" },
  { key: "optInOnly", group: "bank", envVar: "HINDSIGHT_OPT_IN_ONLY" },
  { key: "optInPaths", group: "bank", envVar: "HINDSIGHT_OPT_IN_PATHS" },
  { key: "banks", group: "bank" },
  { key: "harness", group: "server", envVar: "HINDSIGHT_HARNESS" },
  { key: "disabled", group: "server", envVar: "HINDSIGHT_DISABLED" },
  { key: "retainSessions", group: "memory", envVar: "HINDSIGHT_RETAIN_SESSIONS" },
  { key: "maxParallelRetains", group: "memory", envVar: "HINDSIGHT_MAX_PARALLEL_RETAINS" },
  { key: "retainTags", group: "memory", envVar: "HINDSIGHT_RETAIN_TAGS" },
  { key: "retainMetadata", group: "memory" },
  { key: "observationScopes", group: "memory", envVar: "HINDSIGHT_OBSERVATION_SCOPES" },
  { key: "autoReflect", group: "memory", envVar: "HINDSIGHT_AUTO_REFLECT" },
  { key: "reflectTimeoutMs", group: "memory", envVar: "HINDSIGHT_REFLECT_TIMEOUT_MS" },
  { key: "reflectToolTimeoutMs", group: "memory", envVar: "HINDSIGHT_REFLECT_TOOL_TIMEOUT_MS" },
  { key: "reflectBudget", group: "memory", envVar: "HINDSIGHT_REFLECT_BUDGET" },
  { key: "pageRefreshEveryTurns", group: "memory", envVar: "HINDSIGHT_PAGE_REFRESH_EVERY_TURNS" },
  { key: "pageTriggerType", group: "memory", envVar: "HINDSIGHT_PAGE_TRIGGER_TYPE" },
  { key: "pageTriggerCron", group: "memory", envVar: "HINDSIGHT_PAGE_TRIGGER_CRON" },
  { key: "autoSeed", group: "memory", envVar: "HINDSIGHT_AUTO_SEED" },
  { key: "seedLimit", group: "memory", envVar: "HINDSIGHT_SEED_LIMIT" },
  { key: "gitIngest", group: "memory", envVar: "HINDSIGHT_GIT_INGEST" },
  { key: "codebaseSurvey", group: "survey", envVar: "HINDSIGHT_CODEBASE_SURVEY" },
  { key: "surveyModel", group: "survey", envVar: "HINDSIGHT_SURVEY_MODEL" },
  { key: "surveyBudgetUsd", group: "survey", envVar: "HINDSIGHT_SURVEY_BUDGET_USD" },
  { key: "surveyRefreshCommits", group: "survey", envVar: "HINDSIGHT_SURVEY_REFRESH_COMMITS" },
  { key: "logLevel", group: "logging", envVar: "HINDSIGHT_LOG_LEVEL" },
];

const CONFIG_DEFAULTS = {
  serverMode: "cloud",
  apiUrl: "https://api.hindsight.vectorize.io",
  apiPort: 9077,
  daemonProfile: "coding-agent",
  harness: "opencode",
  disabled: false,
  retainSessions: true,
  maxParallelRetains: 10,
  reflectTimeoutMs: 120000,
  reflectToolTimeoutMs: 330000,
  reflectBudget: "high",
  autoReflect: true,
  pageRefreshEveryTurns: 10,
  pageTriggerType: "auto-refresh",
  autoSeed: true,
  seedLimit: 300,
  codebaseSurvey: true,
  surveyModel: "haiku",
  surveyBudgetUsd: 2,
  surveyRefreshCommits: 20,
  gitIngest: "message",
  logLevel: "info",
  optInOnly: false,
  dynamicBankId: true,
  resolveWorktrees: true,
};

function configPath(env) {
  return (env && env.HINDSIGHT_CONFIG) || join(homedir(), ".hindsight", "coding-agent.json");
}

/** 脱敏：保形不保密（"configured (••••xxxx)"）。 */
function maskToken(value) {
  if (typeof value !== "string" || value === "") return value;
  return "configured (\u2022\u2022\u2022\u2022" + value.slice(-4) + ")";
}

/** 深拷贝并把所有 token/key/secret/password 字样的字符串值脱敏。 */
function maskDeep(node) {
  if (Array.isArray(node)) return node.map(maskDeep);
  if (node !== null && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = /token|key|secret|password|apikey/i.test(k) && typeof v === "string" && v !== ""
        ? maskToken(v)
        : maskDeep(v);
    }
    return out;
  }
  return node;
}

/** hindsight 自己的解析器行为：ENOENT -> {}，非法 JSON -> {}（+error 字段）。 */
function readRawConfig(path) {
  try {
    return { raw: JSON.parse(readFileSync(path, "utf8")) };
  } catch (e) {
    if (e.code === "ENOENT") return { raw: {} };
    return { raw: {}, error: "invalid JSON: " + e.message };
  }
}

/** 环境变量字符串按 hindsight 的 readEnvConfig 语义强转（bool/list/number）。 */
function coerceEnv(key, raw) {
  const BOOLS = new Set(["dynamicBankId", "resolveWorktrees", "optInOnly", "disabled", "retainSessions", "autoReflect", "autoSeed", "codebaseSurvey"]);
  const LISTS = new Set(["retainTags", "optInPaths"]);
  const NUMBERS = new Set(["apiPort", "daemonIdleTimeout", "maxParallelRetains", "reflectTimeoutMs", "reflectToolTimeoutMs", "pageRefreshEveryTurns", "seedLimit", "surveyBudgetUsd", "surveyRefreshCommits"]);
  const v = raw.trim();
  if (BOOLS.has(key)) return ["1", "true", "yes", "on"].includes(v.toLowerCase());
  if (LISTS.has(key)) return v.split(",").map(s => s.trim()).filter(Boolean);
  if (NUMBERS.has(key)) { const n = Number(v); return Number.isNaN(n) ? v : n; }
  return v;
}

/**
 * 全配置面的生效值报告。分层镜像 loadConfig：env ← file ← file.harnesses.<harness>。
 * 弱层设过值仍标注来源（值被强层覆盖时 source 显示强层）。
 */
function buildConfigReport(harness, env, pathOverride) {
  env = env || process.env;
  const path = pathOverride || configPath(env);
  const { raw, error } = readRawConfig(path);
  const fileHarness = (raw.harnesses) || {};
  const layerHarness = fileHarness[harness] || {};

  const items = CONFIG_KEYS.map(({ key, group, envVar }) => {
    const inHarness = key in layerHarness;
    const inFile = key in raw;
    const envVal = envVar !== undefined ? env[envVar] : undefined;
    const inEnv = envVal !== undefined && envVal !== "";
    let source = "default";
    let value = CONFIG_DEFAULTS[key];
    if (inEnv && envVal !== undefined) { source = "env"; value = coerceEnv(key, envVal); }
    if (inFile) { source = "file"; value = raw[key]; }
    if (inHarness) { source = "file:harness"; value = layerHarness[key]; }
    return { key, group, value: key === "apiToken" ? maskToken(value) : maskDeep(value), source, envVar };
  });

  const envActive = CONFIG_KEYS
    .filter(k => { const v = k.envVar !== undefined ? env[k.envVar] : undefined; return v !== undefined && v !== ""; })
    .map(k => ({ key: k.key, envVar: k.envVar }));

  const bankSections = Object.entries((raw.banks) || {})
    .map(([id, section]) => ({ id, keys: Object.keys(section) }));

  return {
    path,
    exists: existsSync(path),
    raw: Object.keys(raw).length ? maskDeep(raw) : null,
    items,
    envActive,
    error,
    bankSections,
    harnessSections: Object.keys(fileHarness),
  };
}

// ---------------------------------------------------------------------------
// 运行视图（self-hosted/daemon 的 URL 解析）+ profile 解析
// ---------------------------------------------------------------------------

/**
 * 配置里服务相关的切片。daemon 模式钉死 127.0.0.1:port；
 * self-hosted/cloud 用配置的 apiUrl（self-hosted 必须显式给，cloud 用默认云地址）。
 */
function runtimeView(report) {
  const get = (key) => { const it = report.items.find(i => i.key === key); return it ? it.value : undefined; };
  const serverMode = typeof get("serverMode") === "string" ? get("serverMode") : "cloud";
  const apiPort = typeof get("apiPort") === "number" ? get("apiPort") : 9077;
  const apiUrl = serverMode === "daemon"
    ? "http://127.0.0.1:" + apiPort
    : (typeof get("apiUrl") === "string" ? get("apiUrl") : "https://api.hindsight.vectorize.io");
  return {
    serverMode,
    apiUrl,
    apiPort,
    daemonProfile: typeof get("daemonProfile") === "string" ? get("daemonProfile") : "coding-agent",
    embedVersion: typeof get("embedVersion") === "string" ? get("embedVersion") : undefined,
    embedPackagePath: typeof get("embedPackagePath") === "string" ? get("embedPackagePath") : undefined,
  };
}

/** 从 apiUrl 提取端口；解析失败返回 null。 */
function portFromUrl(url) {
  try { return new URL(url).port ? parseInt(new URL(url).port, 10) : null; }
  catch (e) { return null; }
}

/**
 * self-hosted 适配的核心：配置不再带 daemonProfile，按端口反查。
 * 扫 profiles/*.env 找 HINDSIGHT_API_PORT=<port> 的 profile；找不到回退
 * daemonProfile（默认 "coding-agent"，本机实际种子名）。
 * 返回 { profile, byPort }（byPort=false 表示是回退，前端可提示"猜测"）。
 */
function resolveProfileForPort(port, profilesDir) {
  if (!port || typeof port !== "number") {
    return { profile: "coding-agent", byPort: false };
  }
  let names = [];
  try {
    names = readdirSync(profilesDir).filter(n => /\.env$/.test(n));
  } catch (e) { /* 目录缺失 -> 回退 */ }
  for (const name of names) {
    try {
      const text = readFileSync(join(profilesDir, name), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = /^HINDSIGHT_API_PORT\s*=\s*"?(\d+)"?\s*$/.exec(line.trim());
        if (m && parseInt(m[1], 10) === port) {
          return { profile: name.replace(/\.env$/, ""), byPort: true };
        }
      }
    } catch (e) { /* 单个 env 读失败 -> 继续扫 */ }
  }
  return { profile: "coding-agent", byPort: false };
}

/** 默认 profiles 目录（~/.hindsight/profiles）。 */
function defaultProfilesDir() {
  return join(homedir(), ".hindsight", "profiles");
}

/**
 * 聚合解析入口（control-server 每个 hindsight 路由共用，不重复胶水）：
 * 配置报告 → 运行视图 → 端口反查 profile → 路径。
 * 返回 { report, view, profile, byPort, paths }；report/view 纯派生，绝不过网络。
 */
function resolveRuntime(harness, env, configPathOverride, profilesDirOverride) {
  const report = buildConfigReport(harness, env, configPathOverride);
  const view = runtimeView(report);
  const port = portFromUrl(view.apiUrl) || (view.serverMode === "daemon" ? view.apiPort : null);
  const { profile, byPort } = resolveProfileForPort(port, profilesDirOverride || defaultProfilesDir());
  view.resolvedProfile = profile;
  return { report, view, profile, byPort, paths: daemonPaths(view) };
}

// ---------------------------------------------------------------------------
// 健康探测
// ---------------------------------------------------------------------------

/** 探 /health + /version（best-effort）；绝不 throw。 */
async function checkHealth(baseUrl) {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(baseUrl + "/health", { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { running: false, checkedAt, error: "health -> HTTP " + res.status };
    const health = await res.json().catch(() => undefined);
    let version;
    try {
      const vres = await fetch(baseUrl + "/version", { signal: AbortSignal.timeout(2000) });
      if (vres.ok) version = await vres.json();
    } catch (e) { /* version 是锦上添花 */ }
    return { running: true, health, version, checkedAt };
  } catch (e) {
    return { running: false, checkedAt, error: e.message };
  }
}

/** 服务生态的路径（展示 + 日志 tail 用）。 */
function daemonPaths(view) {
  const profile = view.resolvedProfile || view.daemonProfile;
  return {
    daemonLog: join(homedir(), ".hindsight", "profiles", profile + ".log"),
    pluginLog: process.env.HINDSIGHT_LOG_FILE || join(tmpdir(), "hindsight-coding-agent", "plugin.log"),
    database: join(homedir(), ".pg0", "instances", "hindsight-embed-" + profile),
  };
}

// ---------------------------------------------------------------------------
// 启动 / 停止
// ---------------------------------------------------------------------------

/** profile 名进 spawn 参数前的白名单校验（防路径注入）。 */
function isValidProfileName(name) {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name);
}

/** 跑命令收集输出，超时杀掉；resolve {code, output}，绝不 reject。 */
function run(cmd, args, timeoutMs) {
  return new Promise((resolveRun) => {
    let output = "";
    let settled = false;
    const child = spawn(cmd, args, { stdio: "pipe", windowsHide: true });
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({ code, output: output.trim() });
    };
    const timer = setTimeout(() => { try { child.kill(); } catch (e) {} finish(-1); }, timeoutMs);
    child.stdout && child.stdout.on("data", d => { output += d.toString(); });
    child.stderr && child.stderr.on("data", d => { output += d.toString(); });
    child.on("exit", code => finish(code));
    child.on("error", err => { output += String(err); finish(-2); });
  });
}

/** detached spawn 后即忘 —— CLI/服务自己管生命周期。 */
function runDetached(cmd, args) {
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 纯函数：从 netstat -ano -p tcp 输出里解析监听 port 的 PID 集合。
 * 调用方负责用 latin1 宽松解码（中文 Windows 的 GBK 本地化文本会弄坏严格 UTF-8
 * 解码——这正是 hindsight-embed CLI stop 崩溃的根因）；端口/PID 列是纯 ASCII，
 * latin1 解码后正则照常命中。抽成纯函数是为了能用手写 GBK 字节样本单测。
 */
function parseNetstatPids(text, port) {
  const pids = new Set();
  const re = new RegExp("[:.]" + port + "\\s+\\S+\\s+LISTENING\\s+(\\d+)", "g");
  for (const m of text.matchAll(re)) pids.add(m[1]);
  return [...pids];
}

/** 端口杀：Windows 走 netstat+taskkill（latin1），非 Windows 走 lsof+kill。 */
async function killPortProcess(port) {
  const collect = (child) => new Promise((resolve) => {
    const chunks = [];
    child.stdout && child.stdout.on("data", d => chunks.push(d));
    child.stderr && child.stderr.on("data", d => chunks.push(d));
    child.on("error", () => resolve(Buffer.concat(chunks)));
    child.on("exit", () => resolve(Buffer.concat(chunks)));
  });

  if (process.platform === "win32") {
    const netstat = spawn("netstat", ["-ano", "-p", "tcp"], { stdio: "pipe", windowsHide: true });
    const text = (await collect(netstat)).toString("latin1");
    const pids = parseNetstatPids(text, port);
    const output = [];
    for (const pid of pids) {
      const kill = spawn("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "pipe", windowsHide: true });
      const res = (await collect(kill)).toString("latin1");
      output.push("taskkill /PID " + pid + ": " + (res.trim().split(/\r?\n/)[0] || ""));
    }
    return { killed: pids.join(","), output: output.join(" | ") };
  }
  const lsof = spawn("lsof", ["-ti", "tcp:" + port], { stdio: "pipe" });
  const text = (await collect(lsof)).toString("utf8");
  const pids = text.split(/\s+/).filter(p => /^\d+$/.test(p));
  const output = [];
  for (const pid of pids) {
    const kill = spawn("kill", [pid], { stdio: "pipe" });
    await collect(kill);
    output.push("kill " + pid);
  }
  return { killed: pids.join(","), output: output.join(" | ") };
}

/** 供 spawn 用的 embed 命令（embedPackagePath 优先，否则 uvx 拉版本）。 */
function embedCommand(view) {
  if (view.embedPackagePath) return { cmd: "uv", base: ["run", "--directory", view.embedPackagePath, "hindsight-embed"] };
  const version = view.embedVersion && view.embedVersion.length > 0 ? view.embedVersion : "latest";
  return { cmd: "uvx", base: ["hindsight-embed@" + version] };
}

/**
 * 启动服务（self-hosted 语义）：detached spawn `hindsight-embed -p <profile>
 * daemon start`，即忘。就绪靠 /health 轮询（前端 poll），不靠本调用的返回。
 * profile 必须过白名单校验（它来自文件名扫描，进 spawn 参数前收口）。
 */
function startServer(view, profile) {
  if (!isValidProfileName(profile)) {
    return { action: "start", ok: false, method: "refused", detail: "invalid profile name: " + JSON.stringify(profile) };
  }
  const ok = runDetached("hindsight-embed", ["-p", profile, "daemon", "start"]);
  return {
    action: "start", ok,
    method: "hindsight-embed -p " + profile + " daemon start",
    detail: ok ? "started asynchronously; readiness via /health polling" : "spawn failed (is hindsight-embed on PATH? uv tool install hindsight-embed)",
  };
}

/**
 * 停止服务。Windows：端口杀优先（CLI stop 在中文 Windows 崩，见 killPortProcess）；
 * CLI stop 是非 Windows 首选与两平台的兜底。返回时重探过健康。
 */
async function stopServer(view, profile) {
  const steps = [];
  let output = "";
  let after = await checkHealth(view.apiUrl);

  if (process.platform === "win32" && after.running) {
    const kill = await killPortProcess(view.apiPort);
    steps.push("port-kill :" + view.apiPort + " (pid " + (kill.killed || "none") + ")");
    output += kill.output;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      after = await checkHealth(view.apiUrl);
      if (!after.running) break;
    }
  }

  if (after.running) {
    const { cmd, base } = embedCommand(view);
    const p = isValidProfileName(profile) ? profile : view.daemonProfile;
    const args = [...base, "-p", p, "daemon", "stop"];
    const res = await run(cmd, args, 20000);
    steps.push(cmd + " " + args.join(" ") + " -> exit " + String(res.code));
    output += (output === "" ? "" : " | ") + res.output.slice(-2000);
    after = await checkHealth(view.apiUrl);
  }

  return {
    action: "stop",
    ok: !after.running,
    method: steps.join(" -> ") || "nothing to do (already stopped)",
    output: output.slice(-2000),
    detail: after.running ? "server still responding after both stop paths" : undefined,
  };
}

let _embedCache = { at: 0, val: null };
/** hindsight-embed 是否在 PATH（uv tool install 装的）。60s 缓存 —— status 轮询
 * 每 2-5s 一次，别每次都 spawn where（Windows 进程 spawn ~50ms）。 */
async function hasHindsightEmbed() {
  if (Date.now() - _embedCache.at < 60000 && _embedCache.val !== null) return _embedCache.val;
  const probe = process.platform === "win32" ? "where" : "which";
  const { code } = await run(probe, ["hindsight-embed"], 5000);
  _embedCache = { at: Date.now(), val: code === 0 };
  return code === 0;
}

// ---------------------------------------------------------------------------
// Bank API（只读查询）
// ---------------------------------------------------------------------------

/** GET /v1/default/banks — 绝不 throw（返回 error 字段）。 */
async function listBanks(baseUrl) {
  try {
    const res = await fetch(baseUrl + "/v1/default/banks", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { error: "HTTP " + res.status };
    const j = await res.json();
    return { banks: j.banks || [] };
  } catch (e) {
    return { error: e.message };
  }
}

/** GET 某 bank 的知识页树（pages + folders）。 */
async function bankPages(baseUrl, bankId) {
  try {
    const url = baseUrl + "/v1/default/banks/" + encodeURIComponent(bankId) + "/knowledge-base/tree";
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { error: "HTTP " + res.status };
    const j = await res.json();
    return { pages: j.roots || [] };
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// 日志 tail
// ---------------------------------------------------------------------------

/** 文本文件末尾 maxLines 行；绝不 throw。 */
function tailFile(path, maxLines) {
  maxLines = maxLines || 200;
  try {
    const text = readFileSync(path, "utf8");
    const lines = text.split(/\r?\n/).filter(l => l !== "");
    return { path, exists: true, lines: lines.slice(-maxLines) };
  } catch (e) {
    if (e.code === "ENOENT") return { path, exists: false, lines: [], error: "file not found" };
    return { path, exists: true, lines: [], error: e.message };
  }
}

module.exports = {
  CONFIG_KEYS, CONFIG_DEFAULTS,
  configPath, maskToken, maskDeep, readRawConfig, coerceEnv, buildConfigReport,
  runtimeView, portFromUrl, resolveProfileForPort, defaultProfilesDir, resolveRuntime,
  checkHealth, daemonPaths,
  isValidProfileName, parseNetstatPids, killPortProcess, embedCommand, startServer, stopServer, hasHindsightEmbed,
  listBanks, bankPages, tailFile,
};
