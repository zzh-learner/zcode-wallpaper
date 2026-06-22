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

// Read-only CDP glue (httpGetJson/listTargets/connect/PORT/HOST) now lives in
// cdp.cjs and is shared with status.cjs (审查 P1-1: eliminate two copies of
// the CDP glue). Action logic stays here.
const cdp = require("./cdp.cjs");
const { listTargets, connect, httpGetJson, PORT, HOST } = cdp;

const STYLE_ID = "zcode-user-wallpaper";
// Video mode injects a real <video> element (CSS background-image can't play
// video). This id is separate from STYLE_ID so --remove can clean both up.
const VIDEO_EL_ID = "zcode-user-wallpaper-video";

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

// httpGetJson / listTargets / connect / fixWsHost now come from ./cdp.cjs
// (see require at top). They were migrated verbatim — see cdp.cjs.

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
  // inject (image mode): refresh the <style> AND remove any lingering <video>
  // from a prior video-mode injection. Without the video cleanup, switching
  // video -> image leaves the old <video> playing (with sound) behind the new
  // image wallpaper -- the user hears audio but sees a static image. This
  // mirrors how --remove and video-mode both clean up both elements (AGENTS.md
  // 教训 1: 同型清理逻辑不应只有部分路径有 -- 2/3 路径有就是能各自再坏一次).
  return (
    "(function(){var id=" +
    JSON.stringify(STYLE_ID) +
    ";var existing=document.getElementById(id);if(existing)existing.remove();" +
    "var oldV=document.getElementById(" +
    JSON.stringify(VIDEO_EL_ID) +
    ");if(oldV){oldV.remove();}" +
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
//
// Audio policy (2026-06): default unmuted + play().catch fallback to muted.
// Requires launch-zcode.bat's --autoplay-policy=no-user-gesture-required flag
// for the unmuted path to actually play; without it the catch path re-mutes.
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
    "v.setAttribute('loop','');" +
    "v.setAttribute('playsinline','');" +
    // Default unmuted: try play(). On success (flag effective) audio plays.
    // On reject (no user gesture, flag not effective) auto-degrade to muted +
    // replay so at least the picture shows. AGENTS.md 教训 13/21: cross-process
    // glue (flag↔Electron↔play() Promise) — unit tests can't cover, 真机验.
    "try{var p=v.play();" +
    "if(p&&p.catch){p.catch(function(){v.muted=true;try{v.play().catch(function(){});}catch(_){}});}}" +
    "catch(e){v.muted=true;try{v.play().catch(function(){});}catch(_){}}" +
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
