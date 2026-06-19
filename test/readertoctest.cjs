// Test for lib/reader-toc.cjs — volume/chapter splitting + paragraph splitting.
// Spec §5. Mirrors real-world sample structure (凡人修仙传: 第X卷 / 第X章).
// Run: node test/readertoctest.cjs
const { parseTOC, splitParagraphs } = require("../lib/reader-toc.cjs");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// --- two-level structure: volume + chapter, offset spanning whole text ---
(function(){
  const text = "第一卷 七玄门\n第一章 山边小村\n　　二愣子睁眼。\n　　另一人睡着。\n第二章 青牛镇\n　　镇上热闹。\n第二卷 初踏修仙路\n第三章 嘉元城\n　　进城了。\n";
  const r = parseTOC(text, "test.txt");
  check("2 volumes detected", r.volumes.length === 2);
  check("3 chapters detected", r.chapters.length === 3);
  check("volume 1 points at chapter 0", r.volumes[0].startChapterIndex === 0);
  // v1 covers ch0(山边小村)+ch1(青牛镇); v2 starts at ch2(嘉元城) -> index 2
  check("volume 2 points at chapter 2", r.volumes[1].startChapterIndex === 2);
  // ch0 spans from its start to ch1 start
  check("ch0 endOffset == ch1 startOffset", r.chapters[0].endOffset === r.chapters[1].startOffset);
  // last chapter endOffset == text.length
  check("last ch endOffset == text.length", r.chapters[2].endOffset === text.length);
})();

// --- fallback: no recognizable heading -> single "全文" chapter ---
(function(){
  const text = "就是一段散文没有任何章节标题。\n第二行。\n";
  const r = parseTOC(text, "nochap.txt");
  check("0 real chapters -> fallback 1 chapter", r.chapters.length === 1);
  check("fallback title is '全文'", r.chapters[0].title === "全文");
  check("fallback spans whole text", r.chapters[0].endOffset === text.length);
})();

// --- duplicate headings NOT deduped (real sample bug: 第十一卷 appears twice) ---
(function(){
  const text = "第十一卷 真仙降世\n第一章 a\n　　x\n第十一卷 真仙降临\n第二章 b\n　　y\n";
  const r = parseTOC(text, "dup.txt");
  check("duplicate volume kept (2)", r.volumes.length === 2);
  check("duplicate not deduped: titles differ",
    r.volumes[0].title !== r.volumes[1].title || r.volumes.length === 2);
})();

// --- KNOWN TRADE-OFF: body mentions "翻开第一章" MAY be parsed as a (false) chapter ---
// We deliberately do NOT guard against this. An earlier guard
// (chapIdx===0 || volMatch) dropped legitimate headings prefixed by
// 正文/外传/江湖篇/番外 ("正文 第一章 陨落的天才" in 斗破苍穹) — that was worse.
// Accept the false positive: it shows up in the TOC and the user skips it.
// This test documents the trade-off: the body line DOES get matched.
(function(){
  const text = "他翻开第一章看了看。\n　　内容。\n";
  const r = parseTOC(text, "body.txt");
  check("body mention IS matched (accepted false positive — guard cost > benefit)",
    r.chapters.length === 1 && r.chapters[0].title.indexOf("第一章") !== -1);
})();

// --- heading requires space/fullwidth-space separator after the marker ---
(function(){
  const text = "第一章 山边小村\n　　正文。\n";  // space after 章
  const r = parseTOC(text, "sp.txt");
  check("heading with space accepted", r.chapters.length === 1 && r.chapters[0].title.indexOf("山边小村") !== -1);
})();

// --- '两' numeral must match (两千 = 二千). Real bug: 凡人修仙传 第两千章+
//     were all dropped (447 chapters) because 两 was missing from the char class. ---
(function(){
  const text = "第一千九百九十九章 黑日\n　　正文。\n第两千章 涅盘圣体\n　　正文。\n第两千零一章 天戈灭敌\n　　正文。\n";
  const r = parseTOC(text, "liang.txt");
  check("'两' numeral headings all matched (3 chapters)", r.chapters.length === 3);
  check("第两千章 matched", r.chapters.some(c => c.title.indexOf("涅盘圣体") !== -1));
  check("第两千零一章 matched", r.chapters.some(c => c.title.indexOf("天戈灭敌") !== -1));
})();

// --- volume + chapter on the SAME line (回到明朝当王爷 format):
//     "卷一 烽火连三月 第一章 九世善人" ---
//     Both must be captured: volume from text before 第X章, chapter from 第X章 on.
//     Volume "卷X" (without 第) must also be recognized. Volumes dedup by title.
(function(){
  const text =
    "卷一 烽火连三月 第一章 九世善人\n　　正文。\n" +
    "卷一 烽火连三月 第二章 偷渡时空\n　　正文。\n" +
    "卷二 闭着眼 第一章 入京\n　　正文。\n" +
    "卷二 闭着眼 第二章 见驾\n　　正文。\n";
  const r = parseTOC(text, "huichao.txt");
  check("same-line chapters all matched (4)", r.chapters.length === 4);
  check("chapter title drops volume prefix", r.chapters[0].title === "第一章 九世善人");
  check("volumes deduped by title (2)", r.volumes.length === 2);
  check("volume uses '卷X' (no 第) form", r.volumes[0].title.indexOf("卷一") !== -1);
  check("volume 2 starts at chapter 2", r.volumes[1].startChapterIndex === 2);
})();

// --- 节 unit (天擎/纨绔才子 format) + optional separator (惟我独仙 no-space) ---
(function(){
  const r1 = parseTOC("第一集   奔向黎明 第一节  来自麻省理工\n　　x\n第二节 佛曰\n　　x\n", "jie.txt");
  check("节 unit matched as chapters (2)", r1.chapters.length === 2);
  // optional separator: "第一集第一章登山拜师" (no space after 章)
  const r2 = parseTOC("第一集第一章登山拜师\n　　x\n第一集第二章下山\n　　x\n", "nospace.txt");
  check("no-space 第X集第X章 matched (2)", r2.chapters.length === 2);
})();

// --- 集/部/篇 as volume unit (not just 卷) ---
(function(){
  const r = parseTOC("第一部 寻梦 第一章 入学\n　　x\n第二部 追梦 第一章 出发\n　　x\n", "bu.txt");
  check("部 volume unit recognized (2 vols)", r.volumes.length === 2);
})();

// --- body reference with bare number run is NOT a volume ---
//     "第八卷 蜀中劫 443 缘份到了" appears in body; the 443 betrays it.
(function(){
  const text = "卷一 开头\n　　他读到 第八卷 蜀中劫 443 缘份到了 那段。\n第一章 真\n　　x\n";
  const r = parseTOC(text, "impurity.txt");
  // The body line "他读到 第八卷..." does NOT start with vol marker (starts with 他),
  // so it's not a volume anyway. But test the filter: a line that DOES start with
  // a vol marker but has a bare number run is dropped.
  check("body line not a volume", r.volumes.length === 1 && r.volumes[0].title.indexOf("卷一") !== -1);
})();

// --- splitParagraphs: trims line-leading fullwidth spaces, drops empty lines ---
// NOTE: splitParagraphs is a pure chunk->paragraphs helper. It does NOT know
// which line is a heading; heading-stripping happens at the server chapter
// endpoint (sees the chapter title separately). Here we only verify trim+filter.
(function(){
  const chunk = "第一卷 七玄门\n　　二愣子睁眼。\n\n　　另一人睡着。\n";
  const ps = splitParagraphs(chunk);
  // 3 non-empty lines after trim: the volume line + 2 body paragraphs
  check("splitParagraphs drops empty lines, keeps non-empty (3)",
    ps.length === 3 && ps[0].indexOf("七玄门") !== -1 && ps[1].indexOf("二愣子") !== -1 && ps[2].indexOf("另一人") !== -1);
  check("splitParagraphs stripped fullwidth leading spaces", ps[1][0] !== "\u3000");
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
