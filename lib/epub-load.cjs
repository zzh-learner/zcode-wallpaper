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

// Sanitize raw epub CSS before serving (spec §4.3 — CSS injection defense).
// The reader parses served CSS in its webview; an untrusted epub's stylesheet
// could otherwise @import attacker-controlled URLs (SSRF + data exfil), run JS
// via IE's expression(), or fetch external resources via url(). All three are
// stripped here so the /api/book/:id/asset endpoint never serves them raw.
//
// KNOWN CAVEAT: url()-based backgrounds/images are removed (text styling
// survives). Acceptable because the served CSS is the RAW epub CSS — rewriteRef
// only rewrites XHTML img/a, not CSS url() — so those relative refs wouldn't
// resolve in the reader context anyway. Only already-rewritten local refs
// (url(/api/book/.../asset)) are preserved.
function sanitizeCss(cssText) {
  if (typeof cssText !== "string" || cssText.length === 0) return cssText || "";
  let s = cssText;
  // 1) @import rules — strip the ENTIRE at-rule up to and including the
  //    terminating ;. Handles @import url(...);, @import "...";, @import '...';
  //    and @import url(...) media-query;  (trailing media list absorbed by [^;]*).
  //    MUST run before the url() pass, else @import url(...) becomes a bare @import.
  s = s.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')\s*[^;]*;?/gi, "");
  // 2) expression(...) — IE JS-injection. Use balanced-paren removal so a
  //    payload like expression(if(1){x()}) is fully removed (a plain [^)]*
  //    regex would leave a dangling tail on nested parens).
  s = stripBalancedCall(s, "expression");
  // 3) url(...) referencing anything other than an already-rewritten local
  //    /api/ ref. Relative epub paths + absolute http(s)/data/javascript: are
  //    all stripped (can't resolve safely / could exfil). /api/... is kept.
  s = s.replace(/url\s*\(\s*(?!["']?\/api\/)[^)]*\)/gi, "");
  return s;
}

// Remove every `name(...)` occurrence, balancing nested parens. Dropped text is
// `name` through the matching close paren; an unbalanced tail runs to EOF.
function stripBalancedCall(text, name) {
  const head = new RegExp(name + "\\s*\\(", "gi");
  let out = "";
  let last = 0;
  let m;
  while ((m = head.exec(text)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < text.length && depth > 0) {
      const c = text.charCodeAt(i);
      if (c === 40) depth++;        // (
      else if (c === 41) depth--;   // )
      i++;
    }
    out += text.slice(last, m.index);  // keep text before `name(`
    last = i;                           // resume after matching close paren (or EOF)
    head.lastIndex = last;
  }
  return out + text.slice(last);
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

  // resources: enumerate manifest, split css vs images.
  // Key AND value both use the ABSOLUTE zip path (zipPathFor). This is the single
  // source of truth: XHTML src/href are rewritten (in sanitizeChapterXhtml) to their
  // resolved absolute zip path, which then matches this whitelist key directly.
  // (Using manifest-href keys breaks when XHTML and assets live in different
  // subdirectories — src carries "../" relative to the XHTML, not to the OPF.)
  const resources = { css: {}, images: {} };
  const manifestObj = (book.packaging && book.packaging.manifest) || {};
  const manifestItems = Array.isArray(manifestObj) ? manifestObj
    : (manifestObj.manifest && Array.isArray(manifestObj.manifest) ? manifestObj.manifest
    : Object.values(manifestObj));
  for (const item of manifestItems) {
    if (!item || !item.href) continue;
    const mt = (item["media-type"] || item.mediaType || "").toLowerCase();
    const zp = zipPathFor(book, item.href);
    if (mt === "text/css" || item.href.toLowerCase().endsWith(".css")) {
      resources.css[zp] = zp;
    } else if (mt.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp)$/i.test(item.href)) {
      resources.images[zp] = zp;
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
  // Pass zp (chapter's absolute zip path) as the base for resolving relative src/href.
  const html = sanitizeChapterXhtml(raw, bookId, zp);
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
    ? sanitizeCss(await entry._zip.file(zp).async("string"))  // spec §4.3: strip @import/expression/url
    : await entry._zip.file(zp).async("arraybuffer");
  return { data, mime: mimeFor(href) };
}

module.exports = { loadEpub, getEpubChapter, readEpubAsset, mimeFor, sanitizeCss };
