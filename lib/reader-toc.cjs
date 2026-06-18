// Server-side TOC parsing: split decoded text into volumes + chapters by
// offset, and split a chapter chunk into paragraphs.
// Spec §5. Mirrored in browser by reader/lib/toc.js (drag mode); keep both
// in sync; same cases in test/readertoctest.cjs + test/readertocwebtest.cjs.

// Volume/chapter markers: 第X卷 / 第X章 with Chinese or arabic numerals,
// followed by a space or fullwidth space (\u3000) then the title. Requiring
// the separator + "title on its own line" prevents body mentions like
// "翻开第一章" from being misparsed (spec §5 容错).
const VOLUME_RE = /^第[一二三四五六七八九十百千零0-9]+卷(\s|\u3000)/;
const CHAPTER_RE = /^第[一二三四五六七八九十百千零0-9]+章(\s|\u3000)/;

function parseTOC(text, filename) {
  const lines = text.split(/\r?\n/);
  const chapters = []; // {title, startOffset, endOffset?}
  const volumes = [];  // {title, startChapterIndex}
  let offset = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (VOLUME_RE.test(line)) {
      volumes.push({ title: line, startChapterIndex: chapters.length });
    } else if (CHAPTER_RE.test(line)) {
      chapters.push({ title: line, startOffset: offset });
    }
    offset += raw.length + 1; // +1 for the newline char we split on
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

module.exports = { parseTOC, splitParagraphs, VOLUME_RE, CHAPTER_RE };
