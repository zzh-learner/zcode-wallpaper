// epub parsing pure functions (spec §3, §5). No CDP, no server, no side effects.
// Tested by test/epubtest.cjs.
const sanitizeHtml = require("sanitize-html");

// Scope every CSS selector under #<scopeId> so epub CSS can't leak to reader UI.
// Approach: split into rule blocks, prefix each selector in the selector list.
// Handles @media/@supports by recursing into the block body.
function scopeCss(cssText, scopeId) {
  if (!cssText || !cssText.trim()) return "";
  const prefix = "#" + scopeId;
  return scopeChunk(cssText, prefix);
}

function scopeChunk(text, prefix) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    // skip whitespace, copy verbatim
    const wsMatch = text.slice(i).match(/^\s+/);
    if (wsMatch) { out += wsMatch[0]; i += wsMatch[0].length; }
    if (i >= text.length) break;

    // comment?
    if (text[i] === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }

    // at-rule with block (@media / @supports / @document): scope inside the block
    const atBlock = text.slice(i).match(/^@(?:media|supports|document)\s+([^{]*)\{/);
    if (atBlock) {
      const prelude = atBlock[0];
      out += prelude;
      i += prelude.length;
      // find matching closing brace (no nesting assumption for simplicity; epub CSS rarely nests at-rules)
      const close = text.indexOf("}", i);
      const innerEnd = close === -1 ? text.length : close;
      out += scopeChunk(text.slice(i, innerEnd), prefix);
      if (close !== -1) { out += "}"; i = innerEnd + 1; }
      else { i = text.length; }
      continue;
    }

    // other at-rule without block (@import / @charset / @font-face with single block)
    // @font-face has a block but its "selector" isn't a selector — keep verbatim
    const fontFace = text.slice(i).match(/^@font-face\s*\{/);
    if (fontFace) {
      const close = text.indexOf("}", i);
      const stop = close === -1 ? text.length : close + 1;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    // @import / @charset — line/rule ending at ; — keep verbatim (CSS sanitize strips @import separately)
    const atLine = text.slice(i).match(/^@[a-zA-Z-]+\s+[^;{}]*;/);
    if (atLine) {
      out += atLine[0];
      i += atLine[0].length;
      continue;
    }

    // normal rule: selector list { declarations }
    const brace = text.indexOf("{", i);
    if (brace === -1) { out += text.slice(i); break; }
    const selectorList = text.slice(i, brace);
    const close = text.indexOf("}", brace);
    const declEnd = close === -1 ? text.length : close;
    const declBlock = text.slice(brace, declEnd + (close === -1 ? 0 : 1));
    const scoped = selectorList.split(",").map(s => prefix + " " + s.trim()).join(", ");
    out += scoped + " " + declBlock;
    i = declEnd + (close === -1 ? 0 : 1);
  }
  return out;
}

// Path-traversal defense (spec §4.3): a requested asset href is allowed ONLY if it
// is an exact member of the whitelist set built at load time. No normalization,
// no decoding, no path math — strict set membership only. This rejects
// "../../etc/passwd", "..%2f..%2f" (encoded traversal), and anything not registered.
function isAllowedAssetHref(href, allowedSet) {
  if (!href || typeof href !== "string") return false;
  if (!allowedSet || typeof allowedSet.has !== "function") return false;
  return allowedSet.has(href);
}

// Strip any #fragment from an href for spine matching.
function stripFragment(href) {
  const i = (href || "").indexOf("#");
  return i === -1 ? (href || "") : href.slice(0, i);
}
// basename: last path segment (chap1.xhtml from OEBPS/chap1.xhtml or chap1.xhtml)
function basename(p) {
  if (!p) return "";
  const norm = p.replace(/\\/g, "/").replace(/^\//, "");
  const i = norm.lastIndexOf("/");
  return i === -1 ? norm : norm.slice(i + 1);
}

// spine items -> indexed list (titles filled later by load layer).
function buildSpineIndex(spineItems) {
  return (spineItems || []).map(s => ({ href: s.href, title: null }));
}

// Map a nav href to a spine index by basename match (strip fragments, match leaf name).
function matchSpineIndex(navHref, spine) {
  const target = basename(stripFragment(navHref));
  for (let i = 0; i < spine.length; i++) {
    if (basename(spine[i].href) === target) return i;
  }
  return -1;
}

// Build {chapters, volumes} from epubjs nav shape {label, href, subitems}.
// Two-level: top-level entries with subitems become volumes; their subitems + flat
// top-level entries become chapters. Shape aligns with txt toc (reader.js:86-93).
function buildTocFromNav(navToc, spine) {
  const chapters = [];
  const volumes = [];
  function pushLeaf(label, href) {
    const idx = matchSpineIndex(href, spine);
    if (idx >= 0) chapters.push({ title: label, spineIndex: idx });
  }
  for (const item of (navToc || [])) {
    if (item.subitems && item.subitems.length > 0) {
      // nested: this is a volume
      const volStart = chapters.length;
      volumes.push({ title: item.label, startChapterIndex: volStart });
      for (const sub of item.subitems) {
        pushLeaf(sub.label, sub.href);
      }
    } else {
      pushLeaf(item.label, item.href);
    }
  }
  // dedupe chapters by spineIndex (nav sometimes repeats), keep first
  const seen = new Set();
  const dedup = [];
  for (const c of chapters) {
    if (!seen.has(c.spineIndex)) { seen.add(c.spineIndex); dedup.push(c); }
  }
  return { chapters: dedup, volumes };
}

// Whitelist for epub XHTML (spec §4.2). Keeps semantic content tags, drops
// script/iframe/style-attr/event-handlers and javascript: schemes.
const XHTML_ALLOWED_TAGS = [
  "p","h1","h2","h3","h4","h5","h6","span","em","i","b","strong","u","s","strike",
  "a","img","ul","ol","li","table","tr","td","th","thead","tbody","tfoot","caption",
  "br","hr","blockquote","q","cite","sub","sup","small","ruby","rt","rp","div",
  "pre","code","dl","dt","dd","figure","figcaption","abbr","kbd","var","samp",
];
const XHTML_ALLOWED_ATTRIBUTES = {
  a: ["href", "title", "name"],
  img: ["src", "alt", "title", "width", "height"],
  "*": ["class", "id", "colspan", "rowspan", "lang", "dir"],
};

// Rewrite a single src/href value: relative -> /api/book/:id/asset?href=encoded.
// Absolute http(s) URLs are left alone (external resources).
function rewriteRef(value, bookId) {
  if (!value || typeof value !== "string") return value;
  if (/^https?:/i.test(value)) return value;        // external, untouched
  if (value.startsWith("/api/")) return value;       // already rewritten
  if (value.startsWith("data:") || value.startsWith("#")) return value; // inline/same-page
  return "/api/book/" + bookId + "/asset?href=" + encodeURIComponent(value);
}

// Sanitize + rewrite in one sanitize-html pass (spec §4.4).
function sanitizeChapterXhtml(rawXhtml, bookId) {
  const opts = {
    allowedTags: XHTML_ALLOWED_TAGS,
    allowedAttributes: XHTML_ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https"],     // blocks javascript:, data: in href/src
    allowedSchemesByTag: { img: ["http", "https"] }, // no data: images either (YAGNI)
    transformTags: {
      img: (tag, attribs) => {
        if (attribs.src) attribs.src = rewriteRef(attribs.src, bookId);
        return { tagName: tag, attribs };
      },
      a: (tag, attribs) => {
        if (attribs.href) attribs.href = rewriteRef(attribs.href, bookId);
        return { tagName: tag, attribs };
      },
    },
    // <link> and <style> are both absent from allowedTags, so sanitize-html drops
    // them at the tag-whitelist stage. This filter only needs to handle <style>.
    exclusiveFilter: (frame) => frame.tag === "style",
  };
  return sanitizeHtml(rawXhtml, opts);
}

module.exports = { scopeCss, isAllowedAssetHref, buildSpineIndex, buildTocFromNav, sanitizeChapterXhtml };
