// Self-test for inject.cjs buildExpression logic against a fake DOM.
// Run: node selftest.cjs
const fs = require("fs");
const path = require("path");
const inject = require("./inject.cjs");

const STYLE_ID = "zcode-user-wallpaper";
// buildExpression comes from inject.cjs itself, so tests exercise the real
// implementation instead of a manually-synced copy. (Previously a copy lived
// here and could silently drift from inject.cjs — see AGENTS.md.)
const { buildExpression } = require("./inject.cjs");

function makeFakeDom() {
  // A minimal registry so getElementById finds whatever was appended.
  const registry = {}; // id -> node (only "attached" ones)
  function makeNode() {
    return {
      id: null,
      textContent: null,
      remove() {
        if (this.id && registry[this.id] === this) delete registry[this.id];
      },
    };
  }
  return {
    document: {
      getElementById(id) {
        return registry[id] || null;
      },
      createElement(tag) {
        if (tag !== "style") throw new Error("unexpected tag " + tag);
        return makeNode();
      },
      documentElement: {
        appendChild(n) {
          // Appending sets its id into the registry, mirroring real DOM behavior
          // where a node becomes findable by id once in the document.
          if (n.id) registry[n.id] = n;
          return n;
        },
      },
    },
  };
}

let pass = 0,
  fail = 0;
function check(name, cond) {
  console.log((cond ? "PASS ✓ " : "FAIL ✗ ") + name);
  cond ? pass++ : fail++;
}

// --- Test 1: inject ---
{
  const css = fs.readFileSync(path.join(__dirname, "wallpaper.css"), "utf8");
  const { document } = makeFakeDom();
  const fn = new Function("document", "return " + buildExpression("inject", css));
  const result = fn(document);
  check("inject returns 'ok'", result === "ok");
  // verify a style with our id now exists in the fake dom
  const style = document.getElementById(STYLE_ID);
  check("inject: style present after inject", !!style);
  check("inject: css textContent set", style && style.textContent.length === css.length);
}

// --- Test 2: remove after inject ---
{
  const css = "body{color:red}";
  const { document } = makeFakeDom();
  const inj = new Function("document", "return " + buildExpression("inject", css));
  inj(document);
  const styleBefore = document.getElementById(STYLE_ID);
  check("remove-pre: style exists", !!styleBefore);
  const rem = new Function("document", "return " + buildExpression("remove", ""));
  const remResult = rem(document);
  check("remove returns 'removed'", remResult === "removed");
  check("remove: style gone after remove", !document.getElementById(STYLE_ID));
}

// --- Test 3: remove when nothing injected ---
{
  const { document } = makeFakeDom();
  const rem = new Function("document", "return " + buildExpression("remove", ""));
  const remResult = rem(document);
  check("remove-empty returns 'none'", remResult === "none");
}

// --- Test 4: re-inject replaces (no duplicate) ---
{
  const { document } = makeFakeDom();
  const inj = new Function("document", "return " + buildExpression("inject", "body{a:1}"));
  inj(document);
  inj(document); // second inject should remove the first, not duplicate
  // In this fake DOM, getElementById returns the single attached node;
  // the re-inject path removes existing then appends a new one.
  const styles = [document.getElementById(STYLE_ID)].filter(Boolean);
  check("re-inject: still exactly one style", styles.length === 1);
}

// --- Test 5: inject.cjs pure functions (toFileUrl / listWallpapers / pickRandom) ---
(function () {
  // toFileUrl
  check(
    "toFileUrl('C:\\\\a\\\\b') -> file:///C:/a/b",
    inject.toFileUrl("C:\\a\\b") === "file:///C:/a/b"
  );

  // listWallpapers: missing dir -> []
  check("listWallpapers on missing dir -> []", inject.listWallpapers("Z:\\no\\such\\dir").length === 0);

  // listWallpapers: real temp dir with mixed files
  var os = require("os");
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-wp-test-"));
  try {
    fs.writeFileSync(path.join(tmp, "a.jpg"), "x");
    fs.writeFileSync(path.join(tmp, "b.txt"), "x");
    fs.writeFileSync(path.join(tmp, "c.png"), "x");
    var imgs = inject.listWallpapers(tmp).sort();
    check("listWallpapers filters by extension", JSON.stringify(imgs) === JSON.stringify(["a.jpg", "c.png"]));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // pickRandom: empty -> null
  check("pickRandom([]) -> null", inject.pickRandom([]) === null);

  // pickRandom: result always in list
  var pool = ["x.jpg", "y.jpg", "z.jpg"];
  var ok = true;
  for (var i = 0; i < 20; i++) {
    if (pool.indexOf(inject.pickRandom(pool)) === -1) { ok = false; break; }
  }
  check("pickRandom returns an item from the list", ok);
})();

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail > 0 ? 1 : 0);
