// Unpack Apple Live Photo (.livp) containers into the project's two wallpaper dirs.
//
// .livp is a zip holding two entries per file:
//   IMG_xxxx.JPG.jpeg  -> wallpapers/      (static photo, feeds resize.cjs -> wallpapers-thumb/)
//   IMG_xxxx.JPG.mov   -> wallpapers-video/ (live video, plays directly, .mov verified working)
//
// This script does NOT touch CDP / inject / ZCode. Pure file IO.
//
// Usage:
//   node scripts/unpack-livp.cjs "<dir-with-livp-files>"   [--apply]
//   node scripts/unpack-livp.cjs "G:\新建文件夹\一汁老板娘"  --apply
//
// Recursively finds every *.livp under <dir>, reads the zip in-memory (Node's
// zlib + manual central-directory parse — no external deps), and classifies each
// entry by extension:
//   .jpeg/.jpg -> wallpapers/<stem>.jpg      (normalized to .jpg, resize expects .jpg)
//   .mov       -> wallpapers-video/<stem>.mov
//   anything else -> skipped with a warning
//
// Name-collision safety: livp internal names are usually IMG_2571.JPG.jpeg etc.,
// which collide across many files. We prefix the output with the livp's own
// basename (timestamp-style names like "2026-03-02 190658") so the source
// identity is preserved and collisions across different livp files are gone.
// Within a single livp, jpeg vs mov have different exts so they never collide.
//
// DEFAULT = dry-run. Prints exactly what would be written, writes nothing.
// Pass --apply to actually write files. Re-running --apply is idempotent-ish:
// existing files with identical size are reported as "exists", not overwritten
// (so re-running won't churn the thumbs cache via mtime).
//
// Exit codes: 0 ok (or dry-run), 1 bad args / IO error, 2 no livp found.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const IMG_DIR = path.join(ROOT, "wallpapers");
const VID_DIR = path.join(ROOT, "wallpapers-video");

// ---- minimal zip reader (store + deflate), no deps -------------------------
// We only need: given a Buffer of a .zip, list [name, compressedBuf, method].
// livp files are small (~8MB) and few per archive, so full-buffer parse is fine.

function readZip(buf) {
  // find End Of Central Directory (PK\x05\x06)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip (EOCD not found)");
  const cdCount = buf.readUInt16LE(eocd + 10);
  let cdOff = buf.readUInt32LE(eocd + 16);

  const entries = [];
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(cdOff) !== 0x02014b50) throw new Error("bad central-dir signature");
    const method = buf.readUInt16LE(cdOff + 10);
    const compSize = buf.readUInt32LE(cdOff + 20);
    const nameLen = buf.readUInt16LE(cdOff + 28);
    const extraLen = buf.readUInt16LE(cdOff + 30);
    const commLen = buf.readUInt16LE(cdOff + 32);
    const lfhOff = buf.readUInt32LE(cdOff + 42);
    const name = buf.slice(cdOff + 46, cdOff + 46 + nameLen).toString("utf8");

    // local file header has its own name/extra lengths
    const lfhNameLen = buf.readUInt16LE(lfhOff + 26);
    const lfhExtraLen = buf.readUInt16LE(lfhOff + 28);
    const dataOff = lfhOff + 30 + lfhNameLen + lfhExtraLen;
    const comp = buf.slice(dataOff, dataOff + compSize);
    entries.push({ name, method, comp });
    cdOff += 46 + nameLen + extraLen + commLen;
  }
  return entries;
}

function inflate(entry) {
  if (entry.method === 0) return entry.comp; // stored
  if (entry.method === 8) return zlib.inflateRawSync(entry.comp); // deflate
  throw new Error("unsupported zip method " + entry.method + " for " + entry.name);
}

// ---- classification -------------------------------------------------------

function classify(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".jpeg" || ext === ".jpg") return "image";
  if (ext === ".mov") return "video";
  return null; // skip metadata.json etc.
}

// Build an output filename that won't collide across livp files.
// Use the livp basename (e.g. "2026-03-02 190658") + the entry's original stem.
// e.g. livp "2026-03-02 190658.livp" + entry "IMG_2571.JPG.jpeg"
//   -> "2026-03-02 190658__IMG_2571.jpg"
function outName(livpBase, entryName, targetExt) {
  const entryStem = path.basename(entryName).replace(/\.[^.]+$/, ""); // drop ext
  // sanitize: keep word chars, dots, spaces, dashes; replace rest with _
  const safe = (livpBase + "__" + entryStem).replace(/[^\w.\- ]+/g, "_");
  return safe + "." + targetExt;
}

// ---- main ----------------------------------------------------------------

function findLivps(root) {
  const out = [];
  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && path.extname(e.name).toLowerCase() === ".livp") out.push(full);
    }
  }
  walk(root);
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.indexOf("--apply") !== -1;
  const srcArg = argv.filter((a) => !a.startsWith("-"))[0];
  if (!srcArg) {
    console.error("Usage: node scripts/unpack-livp.cjs \"<dir>\" [--apply]");
    console.error("  Without --apply it only prints what it would do (dry-run).");
    process.exit(1);
  }
  if (!fs.existsSync(srcArg) || !fs.statSync(srcArg).isDirectory()) {
    console.error("[livp] not a directory: " + srcArg);
    process.exit(1);
  }

  if (apply) {
    fs.mkdirSync(IMG_DIR, { recursive: true });
    fs.mkdirSync(VID_DIR, { recursive: true });
  }

  const livps = findLivps(srcArg);
  if (livps.length === 0) {
    console.error("[livp] no .livp files under " + srcArg);
    process.exit(2);
  }
  console.log(
    "[livp] found " +
      livps.length +
      " .livp files   mode=" +
      (apply ? "APPLY (write)" : "DRY-RUN (no writes)")
  );

  let imgWritten = 0,
    vidWritten = 0,
    imgExists = 0,
    vidExists = 0,
    skipped = 0,
    failed = 0;

  for (const livpPath of livps) {
    const livpBase = path.basename(livpPath, ".livp");
    let entries;
    try {
      entries = readZip(fs.readFileSync(livpPath));
    } catch (e) {
      console.error("  [fail] " + livpPath + "  (" + e.message + ")");
      failed++;
      continue;
    }
    let didAny = false;
    for (const entry of entries) {
      const kind = classify(entry.name);
      if (!kind) {
        skipped++;
        continue;
      }
      let data;
      try {
        data = inflate(entry);
      } catch (e) {
        console.error("  [fail] inflate " + entry.name + " in " + livpBase + ": " + e.message);
        failed++;
        continue;
      }
      const targetExt = kind === "image" ? "jpg" : "mov";
      const destDir = kind === "image" ? IMG_DIR : VID_DIR;
      const dest = path.join(destDir, outName(livpBase, entry.name, targetExt));

      if (!apply) {
        console.log(
          "  [would-write] " +
            kind.padEnd(5) +
            " " +
            path.relative(ROOT, dest) +
            "   (" +
            Math.round(data.length / 1024) +
            " KB)"
        );
        if (kind === "image") imgWritten++;
        else vidWritten++;
        didAny = true;
        continue;
      }

      // apply mode: skip if same-size file already there (idempotent re-run)
      try {
        const st = fs.statSync(dest);
        if (st.size === data.length) {
          if (kind === "image") imgExists++;
          else vidExists++;
          didAny = true;
          continue;
        }
      } catch (e) {
        /* not present, will write */
      }
      try {
        fs.writeFileSync(dest, data);
        console.log(
          "  [write] " +
            kind.padEnd(5) +
            " " +
            path.relative(ROOT, dest) +
            "   (" +
            Math.round(data.length / 1024) +
            " KB)"
        );
        if (kind === "image") imgWritten++;
        else vidWritten++;
        didAny = true;
      } catch (e) {
        console.error("  [fail] write " + dest + ": " + e.message);
        failed++;
      }
    }
    if (!didAny && entries.length > 0) {
      console.warn("  [warn] " + livpBase + ": no usable image/video entries (skipped " + entries.length + ")");
    }
  }

  const newImgs = apply ? imgWritten : imgWritten;
  console.log("[livp] ========================================");
  console.log(
    "[livp]  " +
      (apply ? "done" : "dry-run plan") +
      ": images=" +
      newImgs +
      (apply && imgExists ? " (+" + imgExists + " already present)" : "") +
      "  videos=" +
      vidWritten +
      (apply && vidExists ? " (+" + vidExists + " already present)" : "") +
      "  skipped=" +
      skipped +
      "  failed=" +
      failed
  );
  if (!apply) {
    console.log("[livp]  dry-run only. Re-run with --apply to actually write files.");
    console.log("[livp]  then run: node lib/resize.cjs   (to (re)generate wallpapers-thumb/ for new images)");
  } else {
    console.log("[livp]  NEW images written -> run: node lib/resize.cjs");
  }
  console.log("[livp] ========================================");
  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error("[livp] FAILED:", e.message);
    process.exit(1);
  }
}
