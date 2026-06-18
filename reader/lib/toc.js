// Browser-side TOC mirror of lib/reader-toc.cjs (server). Drag mode parses
// chapters from the full decoded text held in memory. SAME cases in tests.
// NOTE: returns {title,startOffset,endOffset}; in drag mode the full text is
// in memory so getChapter just slices text.slice(start,end).

const VOLUME_RE = /^第[一二三四五六七八九十百千零0-9]+卷(\s|\u3000)/;
const CHAPTER_RE = /^第[一二三四五六七八九十百千零0-9]+章(\s|\u3000)/;

function parseTOC(text) {
  const lines = text.split(/\r?\n/);
  const chapters = [], volumes = [];
  let offset = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (VOLUME_RE.test(line)) volumes.push({ title: line, startChapterIndex: chapters.length });
    else if (CHAPTER_RE.test(line)) chapters.push({ title: line, startOffset: offset });
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
  module.exports = { parseTOC, splitParagraphs, VOLUME_RE, CHAPTER_RE };
}
if (typeof window !== "undefined") {
  window.__readerToc = { parseTOC, splitParagraphs };
}
