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

// --- glued-heading guard: SAME cases as readertoctest.cjs (教训 17, keep in
//     sync) — marker pasted at the END of a body paragraph is NOT a heading.
(function(){
  const gluedLine = "跪在金蛇郎君坟前，看着墓碑上的落款“袁承志夏青青谨立”，仿佛回到当年时光。第九十八章以目为剑";
  const text = "第一章 起点\n　　正文一。\n" + gluedLine + "\n　　正文二。\n第九十九章 后续\n　　正文三。\n";
  const r = parseTOC(text);
  check("glued heading (body punct before mid-line marker) NOT a chapter", r.chapters.length === 2);
  check("glued line does not shred 第98章 into a duplicate entry",
    !r.chapters.some(c => c.title.indexOf("以目为剑") !== -1));
  check("real heading after the glued line still matched",
    r.chapters[1].title.indexOf("第九十九章") !== -1);

  const t2 = "第一章 a\n　　x。\n    第九章 b\n　　y。\n";
  check("indented line-start heading still matched", parseTOC(t2).chapters.length === 2);

  const t3 = "正文 第一章 陨落的天才\n　　x。\n外传 第一章 番外篇\n　　y。\n";
  check("legit prefixes 正文/外传 survive the guard", parseTOC(t3).chapters.length === 2);

  const t4 = "第一卷 战火，燃烧 第三章 c\n　　x。\n";
  const r4 = parseTOC(t4);
  check("glued line with vol head creates no volume, no chapter",
    r4.volumes.length === 0 && r4.chapters.length === 1 && r4.chapters[0].title === "全文");
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

// --- author NOTE starting with a vol marker is NOT a volume: SAME cases as
//     readertoctest.cjs (教训 17, keep in sync).
(function(){
  const note = "    第三卷金蛇风云到此结束，下一章开始新的一卷";
  const text = "第一章 a\n　　x\n" + note + "\n第二章 b\n　　y\n";
  const r = parseTOC(text);
  check("author note with vol head + punctuation is NOT a volume", r.volumes.length === 0);
  check("chapters around the note survive", r.chapters.some(c => c.title.indexOf("第一章") !== -1) &&
    r.chapters.some(c => c.title.indexOf("第二章") !== -1));

  const t2 = "第一卷 初踏修仙路\n第一章 a\n　　x\n";
  check("real vol title still recognized", parseTOC(t2).volumes.length === 1);
})();

// --- special headings WITHOUT 第X章 (borrowed from kookit/koodo-reader):
//     SAME cases as readertoctest.cjs (教训 17, keep in sync).
(function(){
  const text = "第一章 a\n　　x。\n尾声\n　　尾声内容。\n番外 一 石头记\n　　番外内容。\n楔子\n　　不，楔子在书首，这里只是验证词表。\n";
  const r = parseTOC(text);
  check("special heads recognized as chapters (尾声/番外一/楔子)",
    r.chapters.some(c => c.title === "尾声") &&
    r.chapters.some(c => c.title === "番外 一 石头记") &&
    r.chapters.some(c => c.title === "楔子"));

  const t2 = "第一章 a\n　　x。\n番外篇将在下周更新。\n　　y。\n前言不搭后语的一句话。\n　　z。\n";
  check("prose continuation after head word NOT a heading",
    parseTOC(t2).chapters.length === 1);

  const longLine = "他翻开那本泛黄的旧书，忽然想起了很多年前的一个傍晚，那时候的阳光正好。第九十八章莫名章";
  check("40+ char line with marker NOT a heading",
    parseTOC("第一章 a\n　　x。\n" + longLine + "\n　　y。\n").chapters.length === 1);
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
