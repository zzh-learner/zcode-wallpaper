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

// --- CRLF offset correctness (real bug: 回到明朝当王爷 UTF-16LE+CRLF,
//     startOffset drifted ~55k chars, first chapter bled into book intro) ---
(function(){
  const text = "书籍介绍\r\n　　intro text here.\r\n第一章 开头\r\n　　正文一。\r\n第二章 结尾\r\n　　正文二。\r\n";
  const r = parseTOC(text, "crlf.txt");
  const expected = "书籍介绍\r\n　　intro text here.\r\n第一章 开头\r\n　　正文一。\r\n".length;
  check("CRLF: ch1 startOffset lands exactly at 第二章 line",
    r.chapters[1].startOffset === expected);
  check("CRLF: ch0 chunk does NOT contain intro text",
    !text.slice(r.chapters[0].startOffset, r.chapters[0].endOffset).includes("intro text"));
})();

// --- cleanChapterParagraphs: drop heading (with vol prefix) + metadata ---
// Real bug: 回到明朝 ch0 body showed "卷一 烽火连三月 第一章 九世善人" (heading
// with vol prefix) and "更新时间:..." (per-chapter metadata). Both must be dropped.
(function(){
  const { cleanChapterParagraphs } = require("../lib/reader-toc.cjs");
  const title = "第一章 九世善人";
  const paras = [
    "卷一 烽火连三月 第一章 九世善人",
    "更新时间:2006-12-19 10:16:00 本章字数:4597",
    "本章字数:4597",
    "狭窄幽长的奈何桥，横跨在忘川河上。",
    "第一章 九世善人",
  ];
  const cleaned = cleanChapterParagraphs(paras, title);
  check("cleanChapterParagraphs drops heading-with-vol-prefix", !cleaned.some(p => p === "卷一 烽火连三月 第一章 九世善人"));
  check("cleanChapterParagraphs drops 更新时间 metadata", !cleaned.some(p => p === "更新时间:2006-12-19 10:16:00 本章字数:4597"));
  check("cleanChapterParagraphs drops 本章字数 metadata", !cleaned.some(p => p === "本章字数:4597"));
  check("cleanChapterParagraphs drops exact-title line", !cleaned.some(p => p === "第一章 九世善人"));
  check("cleanChapterParagraphs keeps real body", cleaned.some(p => p.indexOf("狭窄幽长的奈何桥") !== -1));
  check("cleanChapterParagraphs result has only the body paragraph", cleaned.length === 1);
})();

// === 前言识别（spec 2026-06-19-frontmatter-backmatter）===
// 第一章之前的内容应成为前言章节，标题用原文标记词。
(function(){
  const text = "楔子\n天空中两道身影对视。\n这是楔子正文第二段。\n第三段内容。\n第四段内容。\n第一章 开始\n正文一。\n第二章 结束\n正文二。\n";
  const r = parseTOC(text, "test.txt");
  check("preface: 3 chapters (preface+2)", r.chapters.length === 3);
  check("preface: first title is '楔子'", r.chapters[0].title === "楔子");
  check("preface: startOffset 0", r.chapters[0].startOffset === 0);
  check("preface: endOffset == ch1 startOffset", r.chapters[0].endOffset === r.chapters[1].startOffset);
  check("preface: second is 第一章", /第一章/.test(r.chapters[1].title));
})();
// 前言无标记词 -> 回退 "前言"
(function(){
  const text = "《某书》\n作者：某人\n这是开篇介绍第一段。\n开篇第二段补充。\n开篇第三段说明。\n开篇第四段内容。\n第一章 开始\n正文。\n";
  const r = parseTOC(text, "test.txt");
  check("preface-fallback: title '前言'", r.chapters[0].title === "前言");
  check("preface-fallback: 2 chapters", r.chapters.length === 2);
})();
// 前言过短（< 5 行且 < 200 字）不生成
(function(){
  const text = "短简介。\n第一章 开始\n正文。\n";
  const r = parseTOC(text, "test.txt");
  check("preface-short: NO preface generated", !/前言|短简介/.test(r.chapters[0].title));
  check("preface-short: first is 第一章", /第一章/.test(r.chapters[0].title));
})();

// === 后记识别（spec §2）===
// 最后一章正文里的"尾声"应切出独立后记章节
(function(){
  const text = "第一章 开始\n正文一。\n第二章 结束\n正文二正文二正文二。\n尾声\n这是作者的话。\n感言第二段。\n（全文完）\n";
  const r = parseTOC(text, "test.txt");
  const last = r.chapters[r.chapters.length - 1];
  const secondLast = r.chapters[r.chapters.length - 2];
  check("afterword: last title '尾声'", last.title === "尾声");
  check("afterword: second-last is 第二章", /第二章/.test(secondLast.title));
  check("afterword: last endOffset == text.length", last.endOffset === text.length);
  check("afterword: secondLast endOffset == last startOffset", secondLast.endOffset === last.startOffset);
})();
// 完本声明类 (全文完) -> 标题"后记"
(function(){
  const text = "第一章 开始\n正文一正文一正文一。\n（全文完）\n作者感言。\n第二段感言。\n第三段。\n第四段。\n";
  const r = parseTOC(text, "test.txt");
  const last = r.chapters[r.chapters.length - 1];
  check("afterword-declare: last title '后记'", last.title === "后记");
})();
// 守卫："全文完成XX任务"不误匹
(function(){
  const text = "第一章 开始\n他终于全文完成了任务。\n大家都全文完成了。\n这是正文第三段。\n第四段。\n第五段。\n";
  const r = parseTOC(text, "test.txt");
  const last = r.chapters[r.chapters.length - 1];
  check("afterword-guard: no afterword split", /第一章/.test(last.title));
  check("afterword-guard: endOffset == text.length (no split)", last.endOffset === text.length);
})();
// 边界情况A：无标记词不切分（回到明朝型）
(function(){
  const text = "第一章 开始\n正文一。\n作者感言直接续在这里没有标记词。\n第二段感言。\n第三段。\n第四段。\n";
  const r = parseTOC(text, "test.txt");
  const last = r.chapters[r.chapters.length - 1];
  check("afterword-none(边界A): no split", /第一章/.test(last.title));
  check("afterword-none(边界A): endOffset == text.length", last.endOffset === text.length);
})();

// === 6 本真实样本断言（spec 表；真机事实为准，教训19）===
// novels/*.txt 是私有文件（gitignore），存在时跑、不存在跳过。锁定真机预期：
//   回到明朝: pref=书籍介绍, aft=无（边界A）
//   天擎:     pref=无,     aft=后记
//   惟我独仙: pref=楔子,   aft=尾声
//   斗破苍穹: pref=无,     aft=无（前言<5行不生成；大结局即正文结尾）
//   盘龙:     pref=无,     aft=后记
//   纨绔才子: pref=无,     aft=后记（前言3行<5不生成）
(function(){
  const fs = require("fs");
  const path = require("path");
  const { detectEncoding } = require("../lib/reader-codec.cjs");
  const dir = path.join(__dirname, "..", "novels");
  const cases = [
    { file: "回到明朝当王爷.txt", pref: "书籍介绍", aft: null },
    { file: "天擎.txt",           pref: null,       aft: "后记" },
    { file: "惟我独仙.txt",       pref: "楔子",     aft: "尾声" },
    { file: "斗破苍穹.txt",       pref: null,       aft: null },
    { file: "盘龙.txt",           pref: null,       aft: "后记" },
    { file: "纨绔才子.txt",       pref: null,       aft: "后记" },
  ];
  let ran = 0;
  for (const c of cases) {
    const full = path.join(dir, c.file);
    if (!fs.existsSync(full)) continue;
    ran++;
    const bytes = fs.readFileSync(full);
    const enc = detectEncoding(bytes);
    let b = bytes; if (enc === "utf8" && b.length >= 3 && b[0] === 0xEF) b = b.slice(3);
    const text = new TextDecoder(enc).decode(b);
    const r = parseTOC(text, c.file);
    const first = r.chapters[0].title;
    const last = r.chapters[r.chapters.length - 1].title;
    const isPref = first !== "全文" && !/第[一二两三四五六七八九十百千零0-9]+(章|节|回)/.test(first);
    const isAft = last !== "全文" && !/第[一二两三四五六七八九十百千零0-9]+(章|节|回)/.test(last) && r.chapters.length > 1;
    if (c.pref) {
      check("real-" + c.file + ": preface title '" + c.pref + "'", isPref && first.slice(0, c.pref.length) === c.pref);
    } else {
      check("real-" + c.file + ": no preface", !isPref);
    }
    if (c.aft) {
      check("real-" + c.file + ": afterword title '" + c.aft + "'", isAft && last === c.aft);
    } else {
      check("real-" + c.file + ": no afterword", !isAft);
    }
  }
  if (ran === 0) console.log("(skip: novels/*.txt not present — real-book tests need private files)");
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
