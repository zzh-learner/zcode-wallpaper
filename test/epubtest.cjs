// Test for lib/epub.cjs — epub parsing pure functions (spec §3, §5).
// Run: node test/epubtest.cjs
const lib = require("../lib/epub.cjs");

let pass = 0, fail = 0;
function check(name, cond) { console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name); cond ? pass++ : fail++; }

// --- scopeCss: prefix every selector with #scopeId ---
(function(){
  const { scopeCss } = lib;
  // simple tag selector
  check("tag selector scoped",
    scopeCss("p { color: red; }", "epub-content").includes("#epub-content p"));
  // body/global selector
  check("body scoped",
    scopeCss("body { font-family: serif; }", "epub-content").includes("#epub-content body"));
  // class selector
  check("class scoped",
    scopeCss(".chapter-text { text-indent: 2em; }", "epub-content").includes("#epub-content .chapter-text"));
  // descendant selector — only outermost gets prefix
  check("descendant scoped (prefix outermost)",
    /#epub-content\s+ul\s+li/.test(scopeCss("ul li { margin: 0; }", "epub-content")));
  // comma-separated selectors — both get prefix
  const comma = scopeCss("h1, h2 { color: black; }", "epub-content");
  check("comma list both scoped", comma.includes("#epub-content h1") && comma.includes("#epub-content h2"));
  // @media preserved, inner selectors scoped
  const media = scopeCss("@media (max-width: 600px) { p { font-size: 14px; } }", "epub-content");
  check("@media block kept", media.includes("@media"));
  check("@media inner scoped", media.includes("#epub-content p"));
  // declarations untouched
  const decl = scopeCss("p { color: red; background: url(x); }", "epub-content");
  check("declaration block untouched", decl.includes("color: red") && decl.includes("url(x)"));
})();

// --- scopeCss edge cases ---
(function(){
  const { scopeCss } = lib;
  // id selector
  check("id selector scoped",
    scopeCss("#cover { display: none; }", "epub-content").includes("#epub-content #cover"));
  // empty input
  check("empty css returns empty", scopeCss("", "epub-content") === "");
  // css with no selectors (only comment)
  check("comment-only preserved",
    scopeCss("/* hi */", "epub-content").includes("hi") || scopeCss("/* hi */", "epub-content") === "");
})();

// --- isAllowedAssetHref: path-traversal defense (spec §4.3) ---
(function(){
  const { isAllowedAssetHref } = lib;
  const allowed = new Set(["images/red.png", "styles/main.css", "OEBPS/chap1.xhtml"]);
  // whitelist member
  check("exact whitelist member allowed", isAllowedAssetHref("images/red.png", allowed) === true);
  check("another whitelist member", isAllowedAssetHref("styles/main.css", allowed) === true);
  // not in whitelist
  check("unknown href rejected", isAllowedAssetHref("images/secret.png", allowed) === false);
  // path traversal attempts
  check("../../etc/passwd rejected", isAllowedAssetHref("../../etc/passwd", allowed) === false);
  check("..\\..\\windows rejected", isAllowedAssetHref("..\\..\\win.ini", allowed) === false);
  // URL-encoded traversal
  check("encoded ..%2f rejected", isAllowedAssetHref("images%2F..%2F..%2Fetc%2Fpasswd", allowed) === false);
  // empty/null
  check("empty href rejected", isAllowedAssetHref("", allowed) === false);
  check("null href rejected", isAllowedAssetHref(null, allowed) === false);
  // absolute path (not in whitelist as-is)
  check("/etc/passwd rejected", isAllowedAssetHref("/etc/passwd", allowed) === false);
  // case-sensitive (don't normalize — strict equality)
  check("case-sensitive: IMAGES/RED.PNG != images/red.png",
    isAllowedAssetHref("IMAGES/RED.PNG", allowed) === false);
  // empty whitelist rejects everything
  check("empty whitelist rejects all", isAllowedAssetHref("images/red.png", new Set()) === false);
})();

// --- buildSpineIndex: spine items -> indexed list ---
(function(){
  const { buildSpineIndex } = lib;
  const spine = buildSpineIndex([{href:"chap1.xhtml"}, {href:"chap2.xhtml"}]);
  check("spine length 2", spine.length === 2);
  check("spine[0].href", spine[0].href === "chap1.xhtml");
  check("spine[1].href", spine[1].href === "chap2.xhtml");
  check("spine title null pending fill", spine[0].title === null);
  // empty spine
  check("empty spine -> empty array", buildSpineIndex([]).length === 0);
})();

// --- buildTocFromNav: map nav toc onto spine indices, shape aligned with txt ---
(function(){
  const { buildSpineIndex, buildTocFromNav } = lib;
  const spine = buildSpineIndex([{href:"chap1.xhtml"}, {href:"chap2.xhtml"}, {href:"chap3.xhtml"}]);
  const nav = [
    { label: "第一章 开始", href: "chap1.xhtml", subitems: [] },
    { label: "第二章 继续", href: "chap2.xhtml", subitems: [] },
    { label: "第三章 结束", href: "chap3.xhtml", subitems: [] },
  ];
  const toc = buildTocFromNav(nav, spine);
  // shape aligned with txt toc: { chapters, volumes }
  check("toc has chapters array", Array.isArray(toc.chapters));
  check("toc has volumes array", Array.isArray(toc.volumes));
  check("3 chapters", toc.chapters.length === 3);
  check("chapter title from nav", toc.chapters[0].title === "第一章 开始");
  check("chapter spineIndex 0", toc.chapters[0].spineIndex === 0);
  check("chapter spineIndex 2", toc.chapters[2].spineIndex === 2);
  // no volumes when nav is flat
  check("flat nav -> no volumes", toc.volumes.length === 0);
})();

// --- buildTocFromNav: nested nav -> volumes + chapters (two-level) ---
(function(){
  const { buildSpineIndex, buildTocFromNav } = lib;
  const spine = buildSpineIndex([
    {href:"c1.xhtml"},{href:"c2.xhtml"},{href:"c3.xhtml"},{href:"c4.xhtml"}
  ]);
  const nav = [
    { label: "卷一", href: "c1.xhtml", subitems: [
      { label: "第一章", href: "c1.xhtml", subitems: [] },
      { label: "第二章", href: "c2.xhtml", subitems: [] },
    ]},
    { label: "卷二", href: "c3.xhtml", subitems: [
      { label: "第三章", href: "c3.xhtml", subitems: [] },
      { label: "第四章", href: "c4.xhtml", subitems: [] },
    ]},
  ];
  const toc = buildTocFromNav(nav, spine);
  check("nested: 4 chapters", toc.chapters.length === 4);
  check("nested: 2 volumes", toc.volumes.length === 2);
  check("nested: volume 1 starts at chapter 0", toc.volumes[0].startChapterIndex === 0);
  check("nested: volume 2 starts at chapter 2", toc.volumes[1].startChapterIndex === 2);
  check("nested: volume title kept", toc.volumes[0].title === "卷一");
})();

// --- buildTocFromNav: nav href with fragment (#id) still matches spine ---
(function(){
  const { buildSpineIndex, buildTocFromNav } = lib;
  const spine = buildSpineIndex([{href:"chap1.xhtml"}]);
  const nav = [{ label: "Ch1", href: "chap1.xhtml#section1", subitems: [] }];
  const toc = buildTocFromNav(nav, spine);
  check("href with fragment matches spine", toc.chapters.length === 1 && toc.chapters[0].spineIndex === 0);
})();

if (fail > 0) { console.error("\n" + fail + " FAILED"); process.exit(1); }
console.log("\n" + pass + " passed, " + fail + " failed");
