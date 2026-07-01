// epub loading glue: uses @likecoin/epub-ts to parse, lib/epub.cjs pure fns to shape.
// Real API verified by spike (spec §3.1):
//   - read XHTML/CSS via book.archive.zip (jszip), NOT archive.request (corrupts binary)
//   - book.resolve(href) returns "/OEBPS/..." — strip leading "/" for jszip
const fs = require("fs");
const { Book } = require("@likecoin/epub-ts/node");
const {
  buildSpineIndex, buildTocFromNav, sanitizeChapterXhtml, isAllowedAssetHref,
} = require("./epub.cjs");

// mime by extension (must stay in sync with control-server guessMime — spec §4.3, lesson 27)
function mimeFor(href) {
  const h = (href || "").toLowerCase();
  if (h.endsWith(".css")) return "text/css";
  if (h.endsWith(".png")) return "image/png";
  if (h.endsWith(".jpg") || h.endsWith(".jpeg")) return "image/jpeg";
  if (h.endsWith(".gif")) return "image/gif";
  if (h.endsWith(".svg")) return "image/svg+xml";
  if (h.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

// Resolve an OPF-relative href to a jszip path (strip leading slash from book.resolve output).
function zipPathFor(book, href) {
  let resolved;
  try { resolved = book.resolve(href); } catch (e) { resolved = href; }
  return String(resolved || href).replace(/^\//, "");
}

async function loadEpub(filePath) {
  const buf = fs.readFileSync(filePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const book = new Book(arrayBuffer);
  await book.opened;

  // spine items in reading order
  const spineItems = [];
  book.spine.each((section) => spineItems.push({ href: section.href }));
  const spine = buildSpineIndex(spineItems);

  // nav toc (NCX + nav auto-detected by the lib)
  const navToc = (book.navigation && book.navigation.toc) || [];
  const toc = buildTocFromNav(navToc, spine);

  // fill spine titles from toc (reverse lookup by spineIndex)
  for (const ch of toc.chapters) {
    if (spine[ch.spineIndex]) spine[ch.spineIndex].title = ch.title;
  }
  // any spine item still without a title: leave null (chapter endpoint will fallback)

  // resources: enumerate manifest, split css vs images, keyed by OPF-relative href
  const resources = { css: {}, images: {} };
  const manifestObj = (book.packaging && book.packaging.manifest) || {};
  const manifestItems = Array.isArray(manifestObj) ? manifestObj
    : (manifestObj.manifest && Array.isArray(manifestObj.manifest) ? manifestObj.manifest
    : Object.values(manifestObj));
  for (const item of manifestItems) {
    if (!item || !item.href) continue;
    const mt = (item["media-type"] || item.mediaType || "").toLowerCase();
    const h = item.href;
    if (mt === "text/css" || h.toLowerCase().endsWith(".css")) {
      resources.css[h] = zipPathFor(book, h);
    } else if (mt.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp)$/i.test(h)) {
      resources.images[h] = zipPathFor(book, h);
    }
  }

  return {
    format: "epub",
    toc,
    spine,
    resources,
    _book: book,             // retained for lazy chapter/asset reads
    _zip: book.archive.zip,  // jszip handle
  };
}

// Lazy-load + sanitize chapter n. Returns chapter response (format:epub) or null.
async function getEpubChapter(entry, n, bookId) {
  const chs = entry.toc.chapters;
  if (n < 0 || n >= chs.length) return null;
  const c = chs[n];
  const spineItem = entry.spine[c.spineIndex];
  if (!spineItem) return null;
  const zp = zipPathFor(entry._book, spineItem.href);
  const raw = await entry._zip.file(zp).async("string");
  const html = sanitizeChapterXhtml(raw, bookId);
  // cssHrefs: all registered css assets (books typically share one css)
  const cssHrefs = Object.keys(entry.resources.css).map(
    h => "/api/book/" + bookId + "/asset?href=" + encodeURIComponent(h)
  );
  return {
    format: "epub",
    index: n,
    title: c.title || spineItem.title || ("第" + (n + 1) + "节"),
    html,
    cssHrefs,
    prev: n > 0 ? n - 1 : null,
    next: n + 1 < chs.length ? n + 1 : null,
  };
}

// Read an asset by OPF-relative href, gated by the whitelist built at load time.
// Returns {data, mime} or null (href not whitelisted -> path traversal blocked).
async function readEpubAsset(entry, href) {
  const allowed = new Set([...Object.keys(entry.resources.css), ...Object.keys(entry.resources.images)]);
  if (!isAllowedAssetHref(href, allowed)) return null;
  const zp = entry.resources.css[href] || entry.resources.images[href];
  if (!zp) return null;
  const isText = mimeFor(href) === "text/css";
  const data = isText
    ? await entry._zip.file(zp).async("string")
    : await entry._zip.file(zp).async("arraybuffer");
  return { data, mime: mimeFor(href) };
}

module.exports = { loadEpub, getEpubChapter, readEpubAsset, mimeFor };
