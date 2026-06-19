// Server-side TOC parsing: split decoded text into volumes + chapters by
// offset, and split a chapter chunk into paragraphs.
// Spec §5. Mirrored in browser by reader/lib/toc.js (drag mode); keep both
// in sync; same cases in test/readertoctest.cjs + test/readertocwebtest.cjs.
//
// ROBUSTNESS (learned from 回到明朝当王爷.txt + batch test of 86 novels, 2026-06):
// - Chapter marker "第X章" may appear ANYWHERE on the line, not just at the
//   start. Real format: "卷一 烽火连三月 第一章 九世善人" (volume + chapter
//   on the SAME line). Requiring 行首 would drop 95% of this book's chapters.
// - Chapter UNIT is not always 章 — also 节 (天擎: "第一集 第一节") and 回.
//   Treat 章/节/回 as equivalent leaf markers.
// - Separator after the marker may be ABSENT: "第一集第一章登山拜师"
//   (惟我独仙) / "江湖篇第一章森严" (横刀立马). Make the trailing separator
//   optional. Body mentions like "翻开第一章看了看" are still excluded because
//   they're not standalone heading lines (see isHeadingLine guard below).
// - Volume marker may be "第X卷" OR "卷X" (without 第). Same book uses "卷一".
// - Volume unit varies: 卷/集/部/篇 all used as the higher grouping. Accept all.
// - '两' is a Chinese numeral (两千=二千); without it 凡人修仙传 lost 447 chs.
// - When vol+chap are on the same line, extract the vol title from the part
//   BEFORE the chapter marker, dedupe by title, and filter out vol titles
//   that contain a bare number run (those are body references like
//   "第八卷 蜀中劫 443 缘份到了", not real volume headings).

const NUM = "[一二两三四五六七八九十百千零0-9]+";
// Chapter marker: 第X(章|节|回), separator OPTIONAL. Matched anywhere on the
// (trimmed) line. Optional separator means body "翻开第一章看了看" can match —
// we guard against that via the standalone-line heuristic in parseTOC.
const CHAPANY_RE = new RegExp("第" + NUM + "(?:章|节|回)(?:\\s|\\u3000)?");
// Volume marker at line start: (第X | X-)(卷|集|部|篇), separator optional.
const VOLHEAD_RE = new RegExp(
  "^(?:第" + NUM + "(?:卷|集|部|篇)|(?:卷|集|部|篇)" + NUM + ")(?:\\s|\\u3000)?"
);

// === 前言/后记识别（spec: 2026-06-19-frontmatter-backmatter-design.md）===
// 前言标题词：在 beforeText（第一章之前的内容）里按优先级 includes 找，
// 第一个命中的作标题。"序"单字需独立成行/行首（防"程序/序号"误匹）。
const PREFACE_TITLES = [
  { word: "楔子", title: "楔子" },
  { word: "序章", title: "序章" },
  { word: "序言", title: "序言" },
  { word: "引子", title: "引子" },
  { word: "引言", title: "引言" },
  { word: "书籍介绍", title: "书籍介绍" },
  { word: "内容简介", title: "内容简介" },
  { word: "作品相关", title: "作品相关" },
  { word: "写在前面", title: "写在前面" },
  { word: "简介", title: "简介" },
];
// 返回匹配到的前言标题词，或 null（调用方回退 "前言"）。
function hasPrefaceTitleWord(beforeText) {
  for (const { word, title } of PREFACE_TITLES) {
    if (beforeText.includes(word)) return title;
  }
  // "序" 单字：独立行 ^序\s*$ 或 行首 ^序[：: ]（中文行首词，防"程序/序号"）
  if (/(?:^|\n)\s*序\s*([：:]\s*|\s|$)/.test(beforeText)) return "序";
  return null;
}

// 后记标记词守卫：标记词所在行 trim 后整行等于标记词，或以标记词开头且后跟
// 标点/换行。挡掉正文里"全文完成XX任务"这类非独立行的误匹（教训20：守卫权衡）。
function lineMatchesGuard(line, word) {
  const t = line.trim();
  if (t === word) return true;
  if (t.startsWith(word)) {
    const rest = t.slice(word.length);
    return /^[。！？!?)）\s]/.test(rest);
  }
  return false;
}
// 后记候选：标记词 -> 标题。按数组顺序，第一个在 lastBody 里有守卫匹配的就用。
const AFTERWORD_CANDIDATES = [
  { word: "尾声", title: "尾声" },
  { word: "番外", title: "番外" },
  { word: "后记", title: "后记" },
  { word: "完本感言", title: "后记" },
  { word: "完结感言", title: "后记" },
  { word: "感言", title: "后记" },
  { word: "（全文完）", title: "后记" },
  { word: "(全文完)", title: "后记" },
  { word: "（全书完）", title: "后记" },
  { word: "(全书完)", title: "后记" },
  { word: "（全文终）", title: "后记" },
  { word: "(全文终)", title: "后记" },
  { word: "全书终", title: "后记" },
  { word: "全文完", title: "后记" },
  { word: "全文终", title: "后记" },
  { word: "全书完", title: "后记" },
];
// 在 lastBody（最后一章从其 startOffset 起的文本）里按行扫，找第一个满足守卫的
// 后记标记词。返回 {title, offset}（offset = 标记词在 lastBody 里的 char 偏移）
// 或 null（边界情况A：无标记词，调用方不切分）。
function findAfterword(lastBody) {
  let lineStart = 0;
  const lines = lastBody.split(/(?<=\r?\n)/); // keep newline, 同 parseTOC 的真实偏移算法
  for (const raw of lines) {
    const line = raw.trim();
    for (const { word, title } of AFTERWORD_CANDIDATES) {
      if (lineMatchesGuard(line, word)) {
        // 标记词在 raw 行里的真实位置（跳过行首空白）
        const trimPrefix = raw.length - raw.replace(/^\s+/, "").length;
        const wordIdxInRaw = raw.indexOf(word, trimPrefix);
        if (wordIdxInRaw >= 0) {
          return { title, offset: lineStart + wordIdxInRaw };
        }
      }
    }
    lineStart += raw.length;
  }
  return null;
}

function parseTOC(text, filename) {
  // Match line endings WITHOUT consuming (lookahead), so we know each line's
  // exact byte span in `text` and can compute true offsets. Critical: CRLF
  // files (回到明朝当王爷) used to under-count by 1/line with `+1`, drifting
  // startOffset ~55k chars off -> first chapter bled into the book intro.
  const lines = text.split(/(?<=\r?\n)/); // keep the newline with each line
  const chapters = []; // {title, startOffset, endOffset?}
  const volumes = [];  // {title, startChapterIndex}
  let offset = 0;       // true char offset into text, advances by each line's real length
  let lastVolTitle = null;
  for (const raw of lines) {
    const line = raw.trim();
    const chapIdx = line.search(CHAPANY_RE);
    const hasChap = chapIdx !== -1;
    const volMatch = line.match(VOLHEAD_RE);

    // NOTE: no standalone-line guard. We tried requiring chapIdx===0 || volMatch,
    // but that dropped legitimate headings prefixed by 正文/外传/江湖篇/番外 etc.
    // ("正文 第一章 陨落的天才" in 斗破苍穹). The cost of no guard is occasional
    // body-mention false positives ("他翻开第一章看了看"); the cost of the guard
    // was worse — dropping entire books' worth of real headings. Accept the
    // false positives; they're visible in the TOC and the user can skip them.

    // Resolve a volume title for THIS line, if any.
    let volTitle = null;
    if (volMatch) {
      // If chapter marker is on the same line, vol title = text before it.
      // Else vol title = whole line.
      volTitle = hasChap ? line.slice(0, chapIdx).trim() : line;
      // Filter impurity: a real vol title is a name, not "第八卷 蜀中劫 443 缘份"
      // (body reference with a bare number run). Drop if it has a 2+ digit run
      // surrounded by spaces.
      if (/\s\d{2,}\s/.test(volTitle)) volTitle = null;
    }
    if (volTitle && volTitle !== lastVolTitle) {
      volumes.push({ title: volTitle, startChapterIndex: chapters.length });
      lastVolTitle = volTitle;
    }

    if (hasChap) {
      // Chapter title = from the 第X章 marker to end of line (drops any
      // volume prefix on the same line). startOffset = TRUE char offset of
      // this line in `text` (computed from raw.length, which includes \r\n).
      chapters.push({ title: line.slice(chapIdx).trim(), startOffset: offset });
    }
    offset += raw.length; // raw includes its own \r\n, so offset stays true
  }
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].endOffset = (i + 1 < chapters.length)
      ? chapters[i + 1].startOffset : text.length;
  }

  // === 前言识别（spec §1）：第一章之前的内容作前言章节 ===
  // 仅在识别出真章节时处理（fallback 全文章节 title==="全文" 不算）。
  if (chapters.length > 0 && chapters[0].title !== "全文") {
    const firstCh = chapters[0];
    const beforeText = text.slice(0, firstCh.startOffset);
    const nonEmptyLines = beforeText.split(/\r?\n/).filter(s => s.trim().length > 0).length;
    // 过短（< 5 行 且 < 200 字）不生成前言（盘龙/天擎 0 行 -> 不生成）
    if (nonEmptyLines >= 5 || beforeText.length >= 200) {
      const titleWord = hasPrefaceTitleWord(beforeText);
      chapters.unshift({
        title: titleWord || "前言",
        startOffset: 0,
        endOffset: firstCh.startOffset
      });
    }
  }

  // === 后记识别（spec §2）：最后一章正文里的标记词切出独立后记章节 ===
  // 边界情况A（回到明朝型）：findAfterword 返回 null -> 不切分，保持现状。
  // 注意：前言 unshift 在头部，后记在尾部，两者互不干扰。
  if (chapters.length > 0 && chapters[chapters.length - 1].title !== "全文") {
    const lastCh = chapters[chapters.length - 1];
    const lastBody = text.slice(lastCh.startOffset);
    const aw = findAfterword(lastBody);
    if (aw) {
      // 末章截断到标记词前，新增后记章节到尾部
      lastCh.endOffset = lastCh.startOffset + aw.offset;
      chapters.push({
        title: aw.title,
        startOffset: lastCh.startOffset + aw.offset,
        endOffset: text.length
      });
    }
  }

  // Fallback: no recognizable chapter -> whole text is one "全文" chapter
  if (chapters.length === 0) {
    chapters.push({ title: "全文", startOffset: 0, endOffset: text.length });
  }
  return { volumes, chapters };
}

// Split a chapter chunk (text between two offsets) into display paragraphs.
// Trim line-leading whitespace (fullwidth/halfwidth spaces); CSS text-indent
// re-adds indentation so it scales with font-size (spec §5).
function splitParagraphs(chunk) {
  return chunk.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
}

// Clean raw paragraphs from a chapter chunk: drop the heading line (which may
// carry a volume prefix like "卷一 ... 第一章 九世善人" while title is just
// "第一章 九世善人"), and drop web-novel metadata lines ("更新时间:...",
// "本章字数:...", "（求票）" style). Mirrors real samples (回到明朝当王爷
// has both per-chapter metadata AND volume-prefixed heading lines).
// Pure function — same logic in reader/lib/toc.js (drag mode).
var META_RE = /^(更新时间|本章字数|字数|发布时间|本章共|首发|更多精彩|请记住|无弹窗|免费阅读)/;
function cleanChapterParagraphs(paras, title) {
  var out = [];
  var titleTrim = (title || "").trim();
  for (var i = 0; i < paras.length; i++) {
    var p = paras[i];
    // drop heading line: ends with the chapter title (covers "卷一 ... 第一章 九世善人"
    // where title is "第一章 九世善人"), or exactly equals it
    if (titleTrim && p.length >= titleTrim.length &&
        p.slice(p.length - titleTrim.length) === titleTrim) continue;
    if (p === titleTrim) continue;
    // drop metadata lines
    if (META_RE.test(p)) continue;
    out.push(p);
  }
  return out;
}

module.exports = { parseTOC, splitParagraphs, cleanChapterParagraphs, CHAPANY_RE, VOLHEAD_RE, META_RE };
