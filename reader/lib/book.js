// Data-access layer. Hides server-fetch vs drag-decode behind one Book API.
// Spec §4. reader.js only calls Book.open/getToc/getChapter/save/load —
// it never knows whether data came from /api or an in-memory ArrayBuffer.
//
// Drag-mode books hold the full decoded text in memory (getChapter slices).

(function (global) {
  function isHttpMode() { return global.location && global.location.protocol === "http:"; }

  // Open a book. server: bookId from /api/books. drag: pass {filename, arrayBuffer}.
  async function open(arg) {
    if (isHttpMode() && typeof arg === "string") {
      return openHttp(arg);
    }
    return openDrag(arg);
  }

  async function openHttp(bookId) {
    const tocRes = await fetch("/api/book/" + bookId + "/toc").then(r => r.json());
    return {
      id: bookId,
      _mode: "http",
      _toc: tocRes,
      getToc: async () => tocRes,
      getChapter: async (n) => {
        const r = await fetch("/api/book/" + bookId + "/chapter/" + n);
        if (!r.ok) return null;
        return r.json();
      },
      save: async (n, ratio) => global.__readerProgress.saveProgress(bookId, { chapterIndex: n, scrollRatio: ratio }),
      load: async () => global.__readerProgress.loadProgress(bookId),
    };
  }

  async function openDrag(arg) {
    // arg: {filename, arrayBuffer} from FileReader / drop
    const { decodeText } = global.__readerCodec;
    const { parseTOC, splitParagraphs } = global.__readerToc;
    const bytes = new Uint8Array(arg.arrayBuffer);
    const text = decodeText(bytes);
    const toc = parseTOC(text);
    const bookId = arg.bookId || ("drag-" + arg.filename);
    return {
      id: bookId,
      _mode: "drag",
      _text: text,
      _toc: toc,
      getToc: async () => toc,
      getChapter: async (n) => {
        if (n < 0 || n >= toc.chapters.length) return null;
        const c = toc.chapters[n];
        const chunk = text.slice(c.startOffset, c.endOffset);
        let paras = splitParagraphs(chunk);
        if (paras.length > 0 && paras[0] === c.title.trim()) paras.shift();
        return { index: n, title: c.title, paragraphs: paras,
          prev: n > 0 ? n - 1 : null, next: n + 1 < toc.chapters.length ? n + 1 : null };
      },
      save: async (n, ratio) => global.__readerProgress.saveProgress(bookId, { chapterIndex: n, scrollRatio: ratio }),
      load: async () => global.__readerProgress.loadProgress(bookId),
    };
  }

  global.__readerBook = { open, isHttpMode };
})(typeof window !== "undefined" ? window : globalThis);
