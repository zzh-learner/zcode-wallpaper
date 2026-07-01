// Generate test epub fixtures for epub support (spec §6.4).
// Run: node test/fixtures/make-epub.cjs
// Produces: normal.epub (2 chapters, CSS, image, NCX+nav, XSS probes).
// Fixtures are gitignored — regenerate when needed.
//
// LAYOUT (subdirectory-based, mirrors real-world epubs):
//   XHTML in OEBPS/Text/, images in OEBPS/Images/, CSS in OEBPS/Styles/, OPF at OEBPS/.
// This forces XHTML src/href to carry "../" (relative to the XHTML's own directory),
// which is the case that breaks if the asset whitelist keys on manifest hrefs instead
// of absolute zip paths. A flat fixture masks that bug.
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");

function makeNormalEpub() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml",
`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  zip.file("OEBPS/Images/red.png", PNG);
  zip.file("OEBPS/Styles/main.css",
`body { font-family: serif; }
p.chapter-text { text-indent: 2em; color: #333; }
@import url("should-be-stripped.css");`);
  zip.file("OEBPS/Text/chap1.xhtml",
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title>
<link rel="stylesheet" type="text/css" href="../Styles/main.css"/></head>
<body>
<h1>第一章 开始</h1>
<p class="chapter-text">这是第一段正文。</p>
<p class="chapter-text">这是第二段正文。</p>
<p><img src="../Images/red.png" alt="红点"/></p>
<script>alert('xss-script')</script>
<img src="x" onerror="alert('xss-onerror')"/>
<a href="javascript:alert('xss-js')">evil link</a>
</body></html>`);
  zip.file("OEBPS/Text/chap2.xhtml",
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 2</title></head>
<body><h1>第二章 继续</h1><p>第二章内容。</p></body>
</html>`);
  zip.file("OEBPS/content.opf",
`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Spike Test Book</dc:title><dc:creator>Tester</dc:creator>
<dc:language>zh</dc:language><dc:identifier id="bookid">spike-001</dc:identifier>
</metadata>
<manifest>
<item id="chap1" href="Text/chap1.xhtml" media-type="application/xhtml+xml"/>
<item id="chap2" href="Text/chap2.xhtml" media-type="application/xhtml+xml"/>
<item id="css" href="Styles/main.css" media-type="text/css"/>
<item id="img" href="Images/red.png" media-type="image/png"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
</manifest>
<spine toc="ncx"><itemref idref="chap1"/><itemref idref="chap2"/></spine>
</package>`);
  zip.file("OEBPS/toc.ncx",
`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="spike-001"/></head>
<docTitle><text>Spike Test Book</text></docTitle>
<navMap>
<navPoint id="c1" playOrder="1"><navLabel><text>第一章 开始</text></navLabel><content src="Text/chap1.xhtml"/></navPoint>
<navPoint id="c2" playOrder="2"><navLabel><text>第二章 继续</text></navLabel><content src="Text/chap2.xhtml"/></navPoint>
</navMap></ncx>`);
  zip.file("OEBPS/nav.xhtml",
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="Text/chap1.xhtml">第一章 开始</a></li>
<li><a href="Text/chap2.xhtml">第二章 继续</a></li>
</ol></nav></body></html>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

(async () => {
  const buf = await makeNormalEpub();
  const out = path.join(__dirname, "normal.epub");
  fs.writeFileSync(out, buf);
  console.log("WROTE", out, buf.length, "bytes");
})();
