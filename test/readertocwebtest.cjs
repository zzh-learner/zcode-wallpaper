// Test for reader/lib/toc.js — browser-side TOC mirror of lib/reader-toc.cjs.
// Drag mode parses chapters client-side. SAME core cases as readertoctest.cjs.
// Run: node test/readertocwebtest.cjs
const { parseTOC, splitParagraphs } = require("../reader/lib/toc.js");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

(function(){
  const text = "第一卷 七玄门\n第一章 山边小村\n　　二愣子睁眼。\n第二章 青牛镇\n　　镇上。\n第二卷 初踏\n第三章 嘉元城\n　　进城。\n";
  const r = parseTOC(text);
  check("2 volumes", r.volumes.length === 2);
  check("3 chapters", r.chapters.length === 3);
  // v1 covers ch0+ch1; v2 starts at ch2 -> index 2
  check("v1->ch0, v2->ch2", r.volumes[0].startChapterIndex === 0 && r.volumes[1].startChapterIndex === 2);
  check("last ch endOffset == text.length", r.chapters[2].endOffset === text.length);
})();

(function(){
  const r = parseTOC("无章节散文。\n第二行。\n");
  check("fallback 全文", r.chapters.length === 1 && r.chapters[0].title === "全文");
})();

// splitParagraphs: pure trim+filter (heading-strip is NOT its job — server/reader
// chapter handler strips the title line separately, same as lib/reader-toc.cjs)
(function(){
  const ps = splitParagraphs("第一卷\n　　段一。\n\n　　段二。\n");
  check("splitParagraphs trims + drops empty -> 3 non-empty lines",
    ps.length === 3 && ps[1].indexOf("段一") !== -1 && ps[2].indexOf("段二") !== -1);
})();

// '两' numeral must match (两千 = 二千). Mirror of readertoctest.cjs case.
(function(){
  const text = "第一千九百九十九章 黑日\n　　x\n第两千章 涅盘圣体\n　　x\n第两千零一章 天戈灭敌\n　　x\n";
  const r = parseTOC(text);
  check("'两' numeral headings matched (3)", r.chapters.length === 3);
  check("第两千章 matched", r.chapters.some(c => c.title.indexOf("涅盘圣体") !== -1));
})();

// volume + chapter on SAME line (回到明朝当王爷 format). Mirror of server case.
(function(){
  const text =
    "卷一 烽火连三月 第一章 九世善人\n　　x\n" +
    "卷一 烽火连三月 第二章 偷渡时空\n　　x\n" +
    "卷二 闭着眼 第一章 入京\n　　x\n";
  const r = parseTOC(text);
  check("same-line chapters matched (3)", r.chapters.length === 3);
  check("chapter title drops vol prefix", r.chapters[0].title === "第一章 九世善人");
  check("volumes deduped (2)", r.volumes.length === 2);
})();

// 节 unit + optional separator (天擎/纨绔才子 format). Mirror of server.
(function(){
  const text = "第一集   奔向黎明 第一节  来自麻省理工\n　　x\n第二节 佛曰\n　　x\n";
  const r = parseTOC(text);
  check("节 unit matched (2)", r.chapters.length === 2);
  check("optional separator: 第一集第一章 no-space style",
    parseTOC("第一集第一章登山拜师\n　　x\n第一集第二章下山\n　　x\n").chapters.length === 2);
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
