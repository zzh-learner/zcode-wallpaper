// CDP wallpaper injector for ZCode (Electron)
// Connects to a ZCode instance launched with --remote-debugging-port and either
// injects a <style> element (wallpaper) or removes it.
// Non-invasive: no app.asar edits, survives ZCode upgrades.
//
// Usage (run from project root):
//   node lib/inject.cjs              # inject wallpaper.css
//   node lib/inject.cjs --remove     # remove the injected wallpaper
//   node lib/inject.cjs --list       # just list page targets (debug)

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.ZCODE_DEBUG_PORT || "9222", 10);
const HOST = process.env.ZCODE_DEBUG_HOST || "127.0.0.1";
const STYLE_ID = "zcode-user-wallpaper";
let _callId = 0;

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];

// Convert a Windows absolute path to a file:/// URL.
// "C:\\a\\b" -> "file:///C:/a/b"  (prefix + backslash -> slash)
function toFileUrl(p) {
  return "file:///" + String(p).replace(/\\/g, "/");
}

// List image filenames in dir (by extension). Returns [] if dir missing/empty.
function listWallpapers(dir) {
  try {
    var entries = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  return entries.filter(function (name) {
    var ext = path.extname(name).toLowerCase();
    return IMAGE_EXTS.indexOf(ext) !== -1;
  });
}

// Pick a random item. Returns null for empty list.
function pickRandom(items) {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

const MODE = process.argv.includes("--remove")
  ? "remove"
  : process.argv.includes("--list")
  ? "list"
  : "inject";

function httpGetJson(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: HOST, port: PORT, path: urlPath, headers: { Host: "localhost" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (!data) return reject(new Error("empty response"));
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("bad JSON: " + data.slice(0, 120)));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(4000, () => req.destroy(new Error("timeout")));
  });
}

async function listTargets() {
  const targets = await httpGetJson("/json");
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  return pages;
}

const { WebSocket } = require("ws");

// Chromium returns webSocketDebuggerUrl as ws://localhost/devtools/page/...,
// i.e. host "localhost" with NO explicit port (the port is implied to be the
// same one /json was served from). On some machines `localhost` does not
// resolve to 127.0.0.1 (IPv6-only, proxy hijack, hosts file), and a bare
// ws://host/path defaults to port 80. So rewrite both host and port.
function fixWsHost(wsUrl) {
  return wsUrl
    .replace(/^ws:\/\/localhost\//i, `ws://127.0.0.1:${PORT}/`)
    .replace(/^wss:\/\/localhost\//i, `wss://127.0.0.1:${PORT}/`)
    .replace(/^ws:\/\/localhost(?=[:/])/i, "ws://127.0.0.1")
    .replace(/^wss:\/\/localhost(?=[:/])/i, "wss://127.0.0.1");
}

function connect(wsUrl) {
  wsUrl = fixWsHost(wsUrl);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: no } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? no(new Error("CDP: " + JSON.stringify(msg.error))) : ok(msg.result);
      }
    });
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++_callId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }), (err) => err && reject(err));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error("CDP timeout: " + method));
          }
        }, 8000);
      });
    ws.on("open", () => resolve({ ws, call }));
    ws.on("error", reject);
  });
}

// Build the JS expression to run inside the page via Runtime.evaluate.
// Both modes are wrapped in an IIFE that returns a status string, so the value
// is deterministic for returnByValue.
function buildExpression(mode, css) {
  if (mode === "remove") {
    return (
      "(function(){var e=document.getElementById(" +
      JSON.stringify(STYLE_ID) +
      ");if(e){e.remove();return 'removed';}return 'none';})()"
    );
  }
  // inject
  return (
    "(function(){var id=" +
    JSON.stringify(STYLE_ID) +
    ";var existing=document.getElementById(id);if(existing)existing.remove();" +
    "var s=document.createElement('style');s.id=id;s.textContent=" +
    JSON.stringify(css) +
    ";document.documentElement.appendChild(s);return 'ok';})();"
  );
}

async function main() {
  let css = "";
  if (MODE === "inject") {
    if (process.env.ZCODE_WP_CSS) {
      // 旁路：直接用指定 CSS 文件，跳过随机选图
      css = fs.readFileSync(process.env.ZCODE_WP_CSS, "utf8");
    } else {
      var wallpapersDir = path.join(__dirname, "..", "wallpapers-thumb");
      var images = listWallpapers(wallpapersDir);
      if (images.length === 0) {
        console.log("[wallpaper] wallpapers-thumb/ 为空，不注入壁纸（ZCode 保持默认外观）。");
        console.log("[wallpaper] 双击 resize.bat 生成缩图后再启动。");
        console.log("[wallpaper] （把原图放进 wallpapers/，resize 会自动缩到 wallpapers-thumb/）");
        process.exit(0);
      }
      var chosen = pickRandom(images);
      var fileUrl = toFileUrl(path.join(wallpapersDir, chosen));
      css = fs.readFileSync(path.join(__dirname, "wallpaper.css"), "utf8");
      css =
        css +
        "\n/* 本次启动随机选中的壁纸 */\n" +
        'body { background-image: url("' +
        fileUrl +
        '") !important; }\n';
      console.log("[wallpaper] 选中壁纸: " + chosen + " （共 " + images.length + " 张可选）");
    }
  }

  let targets;
  try {
    targets = await listTargets();
  } catch (e) {
    console.error("[wallpaper] 无法连接 ZCode 调试端口 " + PORT + ": " + e.message);
    console.error(
      "[wallpaper] 请确认 ZCode 是用 start-zcode.bat 启动的（带 --remote-debugging-port）。"
    );
    process.exit(1);
  }

  if (MODE === "list") {
    console.log("[wallpaper] 发现 " + targets.length + " 个页面目标：");
    targets.forEach((t, i) =>
      console.log("  [" + i + "] " + (t.title || "(no title)") + "  " + (t.url || "").slice(0, 60))
    );
    process.exit(0);
  }

  const expression = buildExpression(MODE, css);

  // Verify the injected change actually took effect in the page.
  // For inject: the <style> element is in the DOM AND body got a background
  // image (not "none"). For remove: the <style> is gone.
  // "evaluate returned 'ok'" alone is NOT enough -- during cold start the
  // page may not be fully ready, or a navigation may reset the context, so
  // we verify the real computed state and retry if it didn't stick.
  function verifyExpression(mode) {
    if (mode === "remove") {
      return "(document.getElementById(" + JSON.stringify(STYLE_ID) + ") ? 'present' : 'gone')";
    }
    return (
      "(function(){var s=document.getElementById(" +
      JSON.stringify(STYLE_ID) +
      ");var bg=getComputedStyle(document.body).backgroundImage;" +
      "return (!s||bg==='none') ? 'noeffect' : 'effect';})()"
    );
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MAX_ATTEMPTS = 6;
  const ATTEMPT_DELAY_MS = 800;

  // Inject+verify one target. Returns true if it took effect.
  async function injectOne(target) {
    let ws;
    try {
      ({ ws, call } = await connect(target.webSocketDebuggerUrl));
      await call("Runtime.evaluate", { expression, returnByValue: true });
      const vres = await call("Runtime.evaluate", {
        expression: verifyExpression(MODE),
        returnByValue: true,
      });
      const v = vres.result && vres.result.value;
      ws.close();
      ws = null;
      return v === (MODE === "remove" ? "gone" : "effect");
    } catch (e) {
      if (ws) { try { ws.close(); } catch (_) {} }
      return false;
    }
  }

  // Retry loop. Re-list targets on EVERY attempt: during cold start the page
  // target's webSocketDebuggerUrl can change across navigations (about:blank ->
  // index.html), so a target captured once may go stale. Track which target
  // ids we've already satisfied so we don't re-inject a stable page.
  let affected = 0;
  const satisfied = new Set();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let live;
    try {
      live = await listTargets();
    } catch (e) {
      // Port not ready yet on this attempt; wait & retry.
      if (attempt < MAX_ATTEMPTS) await sleep(ATTEMPT_DELAY_MS);
      else {
        console.error("[wallpaper] 无法连接调试端口: " + e.message);
      }
      continue;
    }
    for (const t of live) {
      if (satisfied.has(t.id || t.webSocketDebuggerUrl)) continue;
      const ok = await injectOne(t);
      if (ok) {
        satisfied.add(t.id || t.webSocketDebuggerUrl);
        console.log(
          "[wallpaper] " +
            (MODE === "remove" ? "移除" : "注入") +
            " -> " +
            (t.title || "").slice(0, 30) +
            "  (第 " + attempt + " 次生效)"
        );
      }
    }
    if (attempt < MAX_ATTEMPTS) await sleep(ATTEMPT_DELAY_MS);
  }
  affected = satisfied.size;
  console.log("[wallpaper] 完成，影响窗口 " + affected + "。");
  process.exit(affected > 0 ? 0 : 1);
}

module.exports = { toFileUrl, listWallpapers, pickRandom, buildExpression };

if (require.main === module) {
  main().catch((e) => {
    console.error("[wallpaper] FAILED:", e.message);
    process.exit(1);
  });
}
