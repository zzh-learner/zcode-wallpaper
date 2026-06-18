// Browser-side TOC mirror of lib/reader-toc.cjs (server). Drag mode parses
// chapters from the full decoded text held in memory. SAME cases in tests.
// NOTE: returns {title,startOffset,endOffset}; in drag mode the full text is
// in memory so getChapter just slices text.slice(start,end).
//
// Keep in sync with lib/reader-toc.cjs — same robustness rules:
// - 第X章 anywhere on line (not just 行首) — supports "卷一 ... 第一章 ..." same-line
// - 第X卷 OR 卷X volume forms; dedupe by title; filter bare-number impurity
// - '两' numeral (两千 = 二千)

const CHAPANY_RE = /第[一二两三四五六七八九十百千零0-9]+章(\s|\u3000)/;
const VOLHEAD_RE = /^(?:第[一二两三四五六七八九十百千零0-9]+卷|卷[一二两三四五六七八九十百千零0-9]+)(\s|\u3000)/;

function parseTOC(text) {
  const lines = text.split(/\r?\n/);
  const chapters = [], volumes = [];
  let offset = 0;
  let lastVolTitle = null;
  for (const raw of lines) {
    const line = raw.trim();
    const chapIdx = line.search(CHAPANY_RE);
    const hasChap = chapIdx !== -1;
    const volMatch = line.match(VOLHEAD_RE);
    let volTitle = null;
    if (volMatch) {
      volTitle = hasChap ? line.slice(0, chapIdx).trim() : line;
      if (/\s\d{2,}\s/.test(volTitle)) volTitle = null;
    }
    if (volTitle && volTitle !== lastVolTitle) {
      volumes.push({ title: volTitle, startChapterIndex: chapters.length });
      lastVolTitle = volTitle;
    }
    if (hasChap) {
      chapters.push({ title: line.slice(chapIdx).trim(), startOffset: offset });
    }
    offset += raw.length + 1;
  }
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].endOffset = (i + 1 < chapters.length) ? chapters[i + 1].startOffset : text.length;
  }
  if (chapters.length === 0) chapters.push({ title: "全文", startOffset: 0, endOffset: text.length });
  return { volumes, chapters };
}

function splitParagraphs(chunk) {
  return chunk.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
}

// Expose: CommonJS (Node test) + browser global (reader.js/book.js use window.__readerToc).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseTOC, splitParagraphs, CHAPANY_RE, VOLHEAD_RE };
}
if (typeof window !== "undefined") {
  window.__readerToc = { parseTOC, splitParagraphs };
}
