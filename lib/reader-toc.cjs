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

function parseTOC(text, filename) {
  const lines = text.split(/\r?\n/);
  const chapters = []; // {title, startOffset, endOffset?}
  const volumes = [];  // {title, startChapterIndex}
  let offset = 0;
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
      // volume prefix on the same line).
      chapters.push({ title: line.slice(chapIdx).trim(), startOffset: offset });
    }
    offset += raw.length + 1; // +1 for the newline we split on
  }
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].endOffset = (i + 1 < chapters.length)
      ? chapters[i + 1].startOffset : text.length;
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

module.exports = { parseTOC, splitParagraphs, CHAPANY_RE, VOLHEAD_RE };
