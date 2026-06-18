// Server-side TOC parsing: split decoded text into volumes + chapters by
// offset, and split a chapter chunk into paragraphs.
// Spec §5. Mirrored in browser by reader/lib/toc.js (drag mode); keep both
// in sync; same cases in test/readertoctest.cjs + test/readertocwebtest.cjs.
//
// ROBUSTNESS (learned from 回到明朝当王爷.txt, 2026-06):
// - Chapter marker "第X章" may appear ANYWHERE on the line, not just at the
//   start. Real format: "卷一 烽火连三月 第一章 九世善人" (volume + chapter
//   on the SAME line). Requiring 行首 would drop 95% of this book's chapters.
// - Volume marker may be "第X卷" OR "卷X" (without 第). Same book uses "卷一".
// - '两' is a Chinese numeral (两千=二千); without it 凡人修仙传 lost 447 chs.
// - When vol+chap are on the same line, extract the vol title from the part
//   BEFORE the chapter marker, dedupe by title, and filter out vol titles
//   that contain a bare number run (those are body references like
//   "第八卷 蜀中劫 443 缘份到了", not real volume headings).

// Chapter marker: 第X章 followed by space/fullwidth-space. Matched ANYWHERE
// on the line (line is trimmed first). The separator + "rest is the title"
// still prevents body mentions like "翻开第一章看了看" (no space after 章).
const CHAPANY_RE = /第[一二两三四五六七八九十百千零0-9]+章(\s|\u3000)/;
// Volume marker at line start: either "第X卷" or "卷X", then separator.
const VOLHEAD_RE = /^(?:第[一二两三四五六七八九十百千零0-9]+卷|卷[一二两三四五六七八九十百千零0-9]+)(\s|\u3000)/;

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
