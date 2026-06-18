// Window-selection logic for transparent mode, as a PURE JS function.
//
// transparent.ps1 does the real Win32 work (EnumWindows etc.) and produces
// a list of candidate windows, but the SELECTION RULE — "which candidate is
// the main window?" — is duplicated here in JS so it can be unit-tested.
// The PS side MUST keep its rule identical to this one (see spec §5.3/§8.1).
//
// Rule (spec §5.3):
//   1. Filter to windows whose pid is in the target process's pid set.
//   2. Filter to visible AND toplevel (owner==0) windows.
//   3. Sort candidates by window area (width*height) descending.
//   4. If exactly 0 candidates -> return null (caller: error "no window").
//   5. If exactly 1 candidate -> return it (auto-pick).
//   6. If >1 candidates -> return {ambiguous: true, candidates}: caller
//      (PS side) will list them and read-host. We deliberately DON'T
//      auto-pick the largest when ambiguous, because DevTools maximized
//      could outrank the main window — user confirmation is safer.

/**
 * @param {Set<number>|number[]} pids - target process pids
 * @param {Array<{hwnd:number, pid:number, className:string, title:string,
 *               width:number, height:number, visible:boolean, toplevel:boolean}>} windows
 * @returns {{hwnd:number, ...}|null|{ambiguous:true, candidates:Array}}
 */
function selectMainWindow(pids, windows) {
  const pidSet = pids instanceof Set ? pids : new Set(pids);
  const candidates = windows.filter(
    (w) =>
      pidSet.has(w.pid) &&
      w.visible &&
      w.toplevel &&
      w.width > 0 &&
      w.height > 0
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Ambiguous: sort by area desc so caller can show the most-likely-first.
  const sorted = candidates
    .slice()
    .sort((a, b) => b.width * b.height - a.width * a.height);
  return { ambiguous: true, candidates: sorted };
}

module.exports = { selectMainWindow };
