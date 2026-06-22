// Test lib/video-mute.cjs pure helpers (spec §4.4).
const vm = require("../lib/video-mute.cjs");
let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// === buildMuteExpression(videoElId, muted) ===
const VID_ID = "zcode-user-wallpaper-video";

// mute = true
var exprMute = vm.buildMuteExpression(VID_ID, true);
check("mute expr: IIFE wrapper", /^\(function\(\)\{.*\}\)\(\)$/.test(exprMute));
check("mute expr: references video el id", exprMute.indexOf(VID_ID) !== -1);
check("mute expr: sets v.muted=true", exprMute.indexOf("v.muted=true") !== -1);
check("mute expr: NO v.muted=false", exprMute.indexOf("v.muted=false") === -1);
check("mute expr: returns JSON with found flag", exprMute.indexOf("found:") !== -1);
check("mute expr: returns muted in JSON", exprMute.indexOf("muted:v.muted") !== -1);

// mute = false
var exprUnmute = vm.buildMuteExpression(VID_ID, false);
check("unmute expr: sets v.muted=false", exprUnmute.indexOf("v.muted=false") !== -1);
check("unmute expr: NO v.muted=true", exprUnmute.indexOf("v.muted=true") === -1);

// falsy truthy 转换（muted ? "true" : "false"）
check("buildMuteExpression: 0 -> false", vm.buildMuteExpression(VID_ID, 0).indexOf("v.muted=false") !== -1);
check("buildMuteExpression: 1 -> true", vm.buildMuteExpression(VID_ID, 1).indexOf("v.muted=true") !== -1);
check("buildMuteExpression: '' -> false", vm.buildMuteExpression(VID_ID, "").indexOf("v.muted=false") !== -1);

// VIDEO_EL_ID 常量镜像 inject.cjs（防漂移，单测钉死字面量）
check("VIDEO_EL_ID mirrors inject.cjs canonical", vm.VIDEO_EL_ID === "zcode-user-wallpaper-video");

// === 执行表达式 against fake DOM（验 found:true 路径）===
function makeFakeDom(hasVideo, initialMuted) {
  var video = hasVideo ? { id: VID_ID, muted: initialMuted } : null;
  return {
    document: {
      getElementById: function (id) { return id === VID_ID ? video : null; }
    }
  };
}
// mute a currently-unmuted video
(function () {
  var dom = makeFakeDom(true, false);
  var fn = new Function("document", "return " + vm.buildMuteExpression(VID_ID, true));
  var r = JSON.parse(fn(dom.document));
  check("exec mute: found true when video exists", r.found === true);
  check("exec mute: video.muted flipped to true", dom.document.getElementById(VID_ID).muted === true);
  check("exec mute: returned muted:true", r.muted === true);
})();
// unmute a currently-muted video
(function () {
  var dom = makeFakeDom(true, true);
  var fn = new Function("document", "return " + vm.buildMuteExpression(VID_ID, false));
  var r = JSON.parse(fn(dom.document));
  check("exec unmute: video.muted flipped to false", dom.document.getElementById(VID_ID).muted === false);
  check("exec unmute: returned muted:false", r.muted === false);
})();
// no video element -> found:false
(function () {
  var dom = makeFakeDom(false, null);
  var fn = new Function("document", "return " + vm.buildMuteExpression(VID_ID, true));
  var r = JSON.parse(fn(dom.document));
  check("exec mute: found false when no video", r.found === false);
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
