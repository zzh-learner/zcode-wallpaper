// epub parsing pure functions (spec §3, §5). No CDP, no server, no side effects.
// Tested by test/epubtest.cjs.

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

module.exports = { scopeCss, isAllowedAssetHref };
