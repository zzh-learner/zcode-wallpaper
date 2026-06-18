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
// Video mode injects a real <video> element (CSS background-image can't play
// video). This id is separate from STYLE_ID so --remove can clean both up.
const VIDEO_EL_ID = "zcode-user-wallpaper-video";
let _callId = 0;

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];
const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".ogg", ".ogv"];

// Convert a Windows absolute path to a file:/// URL.
// "C:\\a\\b" -> "file:///C:/a/b"  (prefix + backslash -> slash)
function toFileUrl(p) {
  return "file:///" + String(p).replace(/\\/g, "/");
}

// Encode a file URL for safe use in src attributes. Chinese/space chars in
// the path would break the <video src=...> attribute on some Chromium builds;
// percent-encoding fixes that while leaving file:/// intact.
// Input is expected to already be a file:/// URL (from toFileUrl).
function encodeFileUrl(fileUrl) {
  // Encode the path portion only; keep file:/// and any query/hash as-is.
  const m = /^(file:\/\/\/)(.*)$/.exec(fileUrl);
  if (!m) return encodeURI(fileUrl);
  return m[1] + encodeURI(m[2]);
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

// List video filenames in dir (by extension). Returns [] if dir missing/empty.
function listVideos(dir) {
  try {
    var entries = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  return entries.filter(function (name) {
    var ext = path.extname(name).toLowerCase();
    return VIDEO_EXTS.indexOf(ext) !== -1;
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
  : process.argv.includes("--video")
  ? "video"
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
// All modes are wrapped in an IIFE that returns a status string, so the value
// is deterministic for returnByValue.
function buildExpression(mode, css) {
  if (mode === "remove") {
    // Remove BOTH the injected <style> (image mode) and the <video> element
    // (video mode). A single --remove cleans up whichever was applied, so the
    // user doesn't need to remember which mode they used.
    return (
      "(function(){var s=document.getElementById(" +
      JSON.stringify(STYLE_ID) +
      ");var v=document.getElementById(" +
      JSON.stringify(VIDEO_EL_ID) +
      ");var did=false;if(s){s.remove();did=true;}if(v){v.remove();did=true;}" +
      "return did?'removed':'none';})()"
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

// Build the video-mode expression: inject the CSS layer (transparent UI so the
// video shows through) AND a real <video> element behind everything. CSS
// background-image cannot play video, so this is a separate DOM-injection path.
// `css` should be wallpaper.css + wallpaper-video.css concatenated.
// `videoUrl` is an already-encoded file:/// URL.
// Returns an IIFE that returns 'ok' (deterministic for returnByValue).
function buildVideoExpression(css, videoUrl) {
  return (
    "(function(){" +
    // 1) Refresh the <style> layer (removes any prior style first, like inject).
    "var sid=" +
    JSON.stringify(STYLE_ID) +
    ";var oldS=document.getElementById(sid);if(oldS){oldS.remove();}" +
    "var s=document.createElement('style');s.id=sid;s.textContent=" +
    JSON.stringify(css) +
    ";document.documentElement.appendChild(s);" +
    // 2) Refresh the <video> element (remove old, create new with the chosen src).
    "var vid=" +
    JSON.stringify(VIDEO_EL_ID) +
    ";var oldV=document.getElementById(vid);if(oldV){oldV.remove();}" +
    "var v=document.createElement('video');v.id=vid;" +
    "v.setAttribute('src'," +
    JSON.stringify(videoUrl) +
    ");v.setAttribute('autoplay','');" +
    "v.setAttribute('muted','');" +
    "v.setAttribute('loop','');" +
    "v.setAttribute('playsinline','');" +
    "v.muted=true;" +
    // muted+autoplay is reliable in Chromium/Electron, but call play() too as a
    // belt-and-suspenders (some builds need the explicit call after setAttribute).
    "try{var p=v.play();if(p&&p.catch){p.catch(function(){});}}catch(e){}" +
    "document.body.appendChild(v);" +
    "return 'ok';" +
    "})();"
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

  // Video mode: pick a video file and build the expression (CSS layer + <video>).
  // Sets the module-level `expression` differently from inject mode, so we keep
  // a separate branch rather than reusing the inject block.
  let videoChosenUrl = ""; // only meaningful in video mode
  if (MODE === "video") {
    // Resolve which video to play. Precedence mirrors ZCODE_WP_CSS:
    //   ZCODE_WP_VIDEO     -> a single specific file (bypass random pick)
    //   ZCODE_WP_VIDEO_DIR -> a directory to randomly pick from
    //   default            -> <root>/wallpapers-video/
    let videoPath = "";
    if (process.env.ZCODE_WP_VIDEO) {
      videoPath = process.env.ZCODE_WP_VIDEO;
      console.log("[wallpaper] 使用 ZCODE_WP_VIDEO 指定的视频: " + videoPath);
    } else {
      var videosDir =
        process.env.ZCODE_WP_VIDEO_DIR || path.join(__dirname, "..", "wallpapers-video");
      var videos = listVideos(videosDir);
      if (videos.length === 0) {
        console.log("[wallpaper] wallpapers-video/ 为空，不注入视频壁纸（ZCode 保持默认外观）。");
        console.log("[wallpaper] 把 .mp4/.webm/.mov 放进 wallpapers-video/ 后重跑。");
        console.log(
          "[wallpaper] （或设 ZCODE_WP_VIDEO 指定单个文件 / ZCODE_WP_VIDEO_DIR 指定目录）"
        );
        process.exit(0);
      }
      var chosenVideo = pickRandom(videos);
      videoPath = path.join(videosDir, chosenVideo);
      console.log("[wallpaper] 选中视频: " + chosenVideo + " （共 " + videos.length + " 个可选）");
    }
    // Percent-encode for <video src=...>. Chinese/space paths break the attribute
    // on some Chromium builds; encodeURI handles the path while leaving file:/// intact.
    videoChosenUrl = encodeFileUrl(toFileUrl(videoPath));
    // CSS = the transparent-UI layer (wallpaper.css) + the video layer (wallpaper-video.css).
    css =
      fs.readFileSync(path.join(__dirname, "wallpaper.css"), "utf8") +
      "\n" +
      fs.readFileSync(path.join(__dirname, "wallpaper-video.css"), "utf8");
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

  // Build the inject expression. Image mode and remove use buildExpression;
  // video mode has its own builder (it injects a <video> element, not just CSS).
  const expression =
    MODE === "video" ? buildVideoExpression(css, videoChosenUrl) : buildExpression(MODE, css);

  // Verify the injected change actually took effect in the page.
  // For inject: the <style> element is in the DOM AND body got a background
  // image (not "none"). For video: the <video> element exists and has a src.
  // For remove: both the <style> and <video> are gone.
  // "evaluate returned 'ok'" alone is NOT enough -- during cold start the
  // page may not be fully ready, or a navigation may reset the context, so
  // we verify the real computed state and retry if it didn't stick.
  function verifyExpression(mode) {
    if (mode === "remove") {
      // 'present' if EITHER the style or the video element is still around --
      // a clean --remove must clear both (image mode leaves a style, video
      // mode leaves a video).
      return (
        "(document.getElementById(" +
        JSON.stringify(STYLE_ID) +
        ")||document.getElementById(" +
        JSON.stringify(VIDEO_EL_ID) +
        "))?'present':'gone'"
      );
    }
    if (mode === "video") {
      return (
        "(function(){var v=document.getElementById(" +
        JSON.stringify(VIDEO_EL_ID) +
        ");return (!v||!v.getAttribute('src')) ? 'noeffect' : 'effect';})()"
      );
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

module.exports = {
  toFileUrl,
  encodeFileUrl,
  listWallpapers,
  listVideos,
  pickRandom,
  buildExpression,
  buildVideoExpression,
  STYLE_ID,
  VIDEO_EL_ID,
  VIDEO_EXTS,
};

if (require.main === module) {
  main().catch((e) => {
    console.error("[wallpaper] FAILED:", e.message);
    process.exit(1);
  });
}
