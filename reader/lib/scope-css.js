// Browser-side CSS scoper — mirrors lib/epub.cjs scopeCss (lesson 17: shared logic,
// two runtimes). Dual export: CommonJS for Node test, window.__readerScopeCss for browser.
// KEEP IN SYNC with lib/epub.cjs's scopeCss/scopeChunk. test/scope-csstest.cjs asserts
// both implementations produce byte-identical output for a battery of inputs; change one,
// the other's test goes red.
function scopeCss(cssText, scopeId) {
  if (!cssText || !cssText.trim()) return "";
  return scopeChunk(cssText, "#" + scopeId);
}
function scopeChunk(text, prefix) {
  let out = "", i = 0;
  while (i < text.length) {
    const ws = text.slice(i).match(/^\s+/);
    if (ws) { out += ws[0]; i += ws[0].length; }
    if (i >= text.length) break;
    if (text[i] === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2); const s = e === -1 ? text.length : e + 2;
      out += text.slice(i, s); i = s; continue;
    }
    const atBlock = text.slice(i).match(/^@(?:media|supports|document)\s+([^{]*)\{/);
    if (atBlock) {
      out += atBlock[0]; i += atBlock[0].length;
      const c = text.indexOf("}", i); const ie = c === -1 ? text.length : c;
      out += scopeChunk(text.slice(i, ie), prefix);
      if (c !== -1) { out += "}"; i = ie + 1; } else { i = text.length; }
      continue;
    }
    const ff = text.slice(i).match(/^@font-face\s*\{/);
    if (ff) {
      const c = text.indexOf("}", i); const s = c === -1 ? text.length : c + 1;
      out += text.slice(i, s); i = s; continue;
    }
    const atLine = text.slice(i).match(/^@[a-zA-Z-]+\s+[^;{}]*;/);
    if (atLine) { out += atLine[0]; i += atLine[0].length; continue; }
    const brace = text.indexOf("{", i);
    if (brace === -1) { out += text.slice(i); break; }
    const sel = text.slice(i, brace);
    const c = text.indexOf("}", brace); const de = c === -1 ? text.length : c;
    const db = text.slice(brace, de + (c === -1 ? 0 : 1));
    out += sel.split(",").map(s => prefix + " " + s.trim()).join(", ") + " " + db;
    i = de + (c === -1 ? 0 : 1);
  }
  return out;
}

// Dual export: CommonJS (Node test) + browser global (reader.js fetch+scopeCss).
if (typeof module !== "undefined" && module.exports) module.exports = { scopeCss };
if (typeof window !== "undefined") window.__readerScopeCss = { scopeCss };
