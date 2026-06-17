// CDP wallpaper injector for ZCode (Electron)
// Connects to a ZCode instance launched with --remote-debugging-port and either
// injects a <style> element (wallpaper) or removes it.
// Non-invasive: no app.asar edits, survives ZCode upgrades.
//
// Usage:
//   node inject.cjs              # inject wallpaper.css
//   node inject.cjs --remove     # remove the injected wallpaper
//   node inject.cjs --list       # just list page targets (debug)

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
    css = process.env.ZCODE_WP_CSS
      ? fs.readFileSync(process.env.ZCODE_WP_CSS, "utf8")
      : fs.readFileSync(path.join(__dirname, "wallpaper.css"), "utf8");
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
  let affected = 0;
  for (const t of targets) {
    try {
      const { ws, call } = await connect(t.webSocketDebuggerUrl);
      const res = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
      });
      const value = res.result && res.result.value;
      console.log(
        "[wallpaper] " +
          (MODE === "remove" ? "移除" : "注入") +
          " -> " +
          (t.title || "").slice(0, 30) +
          "  (" +
          value +
          ")"
      );
      if (value === "ok" || value === "removed") affected++;
      ws.close();
    } catch (e) {
      console.error(
        "[wallpaper] " + (t.title || "").slice(0, 30) + " 失败: " + e.message
      );
    }
  }
  console.log("[wallpaper] 完成，影响窗口 " + affected + "/" + targets.length + "。");
  process.exit(affected > 0 ? 0 : 1);
}

module.exports = { toFileUrl, listWallpapers, pickRandom };

if (require.main === module) {
  main().catch((e) => {
    console.error("[wallpaper] FAILED:", e.message);
    process.exit(1);
  });
}
