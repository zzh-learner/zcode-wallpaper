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

// --- heading NOT on its own line (body mentions "翻开第一章") -> not a chapter ---
(function(){
  const text = "他翻开第一章看了看。\n　　内容。\n";
  const r = parseTOC(text, "body.txt");
  // "他翻开第一章看了看。" does NOT match /^第X章(\s|\u3000)/ because no space after 章
  check("body mention not parsed as chapter", r.chapters.length === 1 && r.chapters[0].title === "全文");
})();

// --- heading requires space/fullwidth-space separator after the marker ---
(function(){
  const text = "第一章 山边小村\n　　正文。\n";  // space after 章
  const r = parseTOC(text, "sp.txt");
  check("heading with space accepted", r.chapters.length === 1 && r.chapters[0].title.indexOf("山边小村") !== -1);
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
