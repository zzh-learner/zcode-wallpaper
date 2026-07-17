// Skin panel renderer + event wiring (spec §5.3). Mirrors status-view.js /
// bookmark.js shape: render from localStorage each poll, delegate events on
// the container. Editor form fields are bound to the currently-selected theme.
//
// Actions dispatched via the shared dispatchAction() in control.js:
//   applySkin   -> POST {action, theme} (full theme object in body)
//   removeSkin  -> POST {action}
// localStorage mutations (new/duplicate/delete/save) happen locally then
// re-render; only apply/remove hit the server.

(function () {
  var skin = window.__ccSkin;
  if (!skin) return;

  // current editor working copy (the theme being edited). null = none selected.
  var editing = null;
  // Remember the user's dropdown selection across polls. Without this, every
  // poll (2s) rebuilds the <select> and resets it to activeId, so the user can't
  // pick another theme — the dropdown "auto-refreshes" away their choice (real-
  // machine caught bug, 2026-07-17). Defaults to activeId on first paint.
  var selectedId = null;
  var structureBuilt = false;

  function $(id) { return document.getElementById(id); }

  function currentState() { return skin.loadSkins(); }

  function themeList(state) {
    return Object.keys(state.themes).map(function (id) { return state.themes[id]; });
  }

  // Build the panel structure (toolbar + editor container + msg). Called once
  // on first render, or when the theme list identity changes (new/deleted theme).
  // NOT called every poll — that would wipe the user's dropdown choice + editor
  // input focus. Returns the html string.
  function buildStructure(state, list, skinStatus) {
    var activeId = state.activeId;
    // selectedId follows activeId until the user picks something else; if the
    // remembered selection no longer exists (theme deleted), fall back to activeId.
    var chosenId = selectedId && state.themes[selectedId] ? selectedId : activeId;
    if (!chosenId && list.length) chosenId = list[0].id;
    selectedId = chosenId;
    var opts = list.map(function (t) {
      var sel = t.id === chosenId ? " selected" : "";
      var mark = t.isBuiltin ? " [预设]" : "";
      return '<option value="' + t.id + '"' + sel + ">" + esc(t.name) + mark + "</option>";
    }).join("");
    var html = '<div class="shelf-head"><h3>皮肤</h3>' +
      '<span class="muted skin-status-text" style="font-size:12px">' + skinStatus + '</span></div>';
    html += '<div class="skin-toolbar">' +
      '<select id="skin-select">' + opts + '</select> ' +
      '<button data-skin-act="apply">应用</button> ' +
      '<button data-skin-act="remove">移除</button> ' +
      '<button data-skin-act="new">新建</button> ' +
      '<button data-skin-act="dup">复制</button> ' +
      '<button data-skin-act="del">删除</button></div>';
    html += '<div id="skin-editor"></div>';
    html += '<span id="skin-msg" class="muted"></span>';
    return html;
  }

  // Signature of the theme list — used to detect "list changed, must rebuild".
  // Compares id+name pairs in order. Cheap + stable across polls when nothing
  // changed, so the dropdown survives the 2s poll.
  function listSignature(list) {
    return list.map(function (t) { return t.id + ":" + t.name; }).join("|");
  }

  // Force the next renderSkinPanel() to rebuild structure. Call after a theme
  // list mutation (new/dup/del) so the dropdown reflects the change immediately.
  // Pair with setting `selectedId` to control which option gets selected.
  function forceStructureRebuild() { structureBuilt = false; lastSignature = null; }

  var lastSignature = null;

  function renderSkinPanel(statusSnapshot) {
    var panel = $("skin-panel");
    if (!panel) return;
    var state = currentState();
    var list = themeList(state);
    var skinStatus = "";
    if (statusSnapshot && statusSnapshot.skin) {
      var sk = statusSnapshot.skin;
      if (sk.applied && sk.themeName) skinStatus = "当前: " + sk.themeName;
      else if (sk.applied) skinStatus = "当前: 已应用皮肤";
      else if (sk.applied === false) skinStatus = "当前: 无";
      else skinStatus = "当前: 未知（ZCode 未开）";
    }

    var sig = listSignature(list);
    // Rebuild structure ONLY when: first paint, or theme list changed (new/
    // deleted/renamed theme). Otherwise just refresh the status text line —
    // this preserves the user's dropdown selection + editor input/focus.
    if (!structureBuilt || sig !== lastSignature) {
      panel.innerHTML = buildStructure(state, list, skinStatus);
      structureBuilt = true;
      lastSignature = sig;
      renderEditor(state);
    } else {
      // Light refresh: update only the status text. Don't touch the select
      // (would reset the user's choice) or the editor (would lose input focus).
      var stEl = panel.querySelector(".skin-status-text");
      if (stEl) stEl.textContent = skinStatus;
      // If activeId changed (user applied a different theme elsewhere), reflect
      // it in the editor without resetting the dropdown.
    }
  }

  function renderEditor(state) {
    var ed = $("skin-editor");
    if (!ed) return;
    var sel = $("skin-select");
    var id = sel ? sel.value : null;
    var t = id && state.themes ? state.themes[id] : null;
    if (!t) { ed.innerHTML = '<div class="muted" style="margin-top:6px">选择或新建一个主题来编辑</div>'; editing = null; return; }

    // clone into editing working copy
    editing = JSON.parse(JSON.stringify(t));
    var locked = !!t.isBuiltin;

    var c = editing.colors || {};
    function colorRow(key, label) {
      var v = c[key] || "";
      return '<label class="skin-color">' + label +
        '<input type="color" data-ck="' + key + '" value="' + normalizeColor(v) + '">' +
        '<input type="text" data-ck-text="' + key + '" value="' + esc(v) + '" placeholder="留空=不覆盖" maxlength="9"></label>';
    }

    var html = '<fieldset class="skin-edit-fs"' + (locked ? ' disabled title="预设主题只读，点「复制」后编辑副本"' : '') + '>' +
      '<legend>编辑: ' + esc(t.name) + (locked ? ' [预设只读]' : '') + '</legend>' +
      '<label class="skin-row">名称 <input type="text" data-field="name" value="' + esc(editing.name) + '"></label>' +
      '<div class="skin-colors">' +
        colorRow("background", "背景") + colorRow("panel", "面板") +
        colorRow("accent", "主色") + colorRow("accentAlt", "次色") +
        colorRow("text", "文字") + colorRow("muted", "弱文字") +
        colorRow("sidebarBg", "侧栏") + colorRow("inputBg", "输入框") +
        colorRow("inputBorder", "输入框边框") +
      '</div>' +
      '<label class="skin-row">字体 <input type="text" data-field="font" value="' + esc(editing.font || "") + '" placeholder="留空=不覆盖"></label>' +
      '<label class="skin-row">圆角(px) <input type="number" data-field="radius" value="' + (editing.radius != null ? editing.radius : "") + '" placeholder="留空=不覆盖" min="0"></label>' +
      renderOverlaySection(editing) +
      '<div class="skin-deco">' +
        '<label class="skin-checkbox"><input type="checkbox" data-field="sparkle"' + (editing.decorations && editing.decorations.sparkle ? " checked" : "") + '> 闪光粒子</label>' +
        '<div class="skin-emoji-list-head">Emoji 角标（可多个，显示在不同位置）</div>' +
        '<div id="skin-emoji-rows">' + renderEmojiRows(editing) + '</div>' +
        '<button type="button" data-skin-act="addEmojiRow" class="skin-emoji-add">+ 添加角标</button>' +
      '</div>';
    if (!locked) html += '<button data-skin-act="save">保存</button>';
    if (locked) html += '<div class="muted" style="font-size:11px;margin-top:4px">预设主题不可直接编辑。点上方「复制」生成可编辑副本。</div>';
    html += '</fieldset>';
    ed.innerHTML = html;
  }

  // Render the emoji badge rows (one per badge). Each row: emoji text input +
  // position dropdown + remove button. Reads from editing.decorations.emojiBadges
  // (normalized array). Empty list shows a hint.
  function renderEmojiRows(theme) {
    var badges = (theme.decorations && Array.isArray(theme.decorations.emojiBadges))
      ? theme.decorations.emojiBadges : [];
    if (!badges.length) {
      return '<div class="muted skin-emoji-empty" style="font-size:11px">无角标，点下方添加</div>';
    }
    return badges.map(function (b, idx) {
      var opts = skin.DECORATION_EMOJI_POSITIONS.map(function (p) {
        var s = (b.position === p) ? " selected" : "";
        return '<option value="' + p + '"' + s + '>' + p + '</option>';
      }).join("");
      return '<div class="skin-emoji-row">' +
        '<input type="text" data-emoji-idx="' + idx + '" data-emoji-field="emoji" value="' + esc(b.emoji || "") + '" maxlength="4" placeholder="♡" style="width:40px">' +
        '<select data-emoji-idx="' + idx + '" data-emoji-field="position">' + opts + '</select>' +
        '<button type="button" data-skin-act="delEmojiRow" data-emoji-row="' + idx + '" title="删除该角标">✕</button>' +
        '</div>';
    }).join("");
  }

  // Render the overlay (wallpaper-coexistence) section: enable toggle + 3
  // background colors (panel/input/sidebar) each with an opacity slider.
  // When enabled, those 3 backgrounds render as rgba(hex, opacity) so wallpaper
  // shows through semi-transparent UI panels (spec §overlay).
  function renderOverlaySection(theme) {
    var ov = theme.overlay || {};
    function colorRow(key, label) {
      var v = ov[key] || "";
      return '<label class="skin-color">' + label +
        '<input type="color" data-ov-ck="' + key + '" value="' + normalizeColor(v) + '">' +
        '<input type="text" data-ov-ck-text="' + key + '" value="' + esc(v) + '" placeholder="留空=默认" maxlength="9"></label>';
    }
    function opacityRow(key, label) {
      var v = (ov[key] != null) ? ov[key] : 100;
      return '<label class="skin-row skin-opacity-row">' + label + ' 透明度 ' +
        '<input type="range" data-ov-op="' + key + '" min="0" max="100" value="' + v + '">' +
        '<span data-ov-op-val="' + key + '">' + v + '%</span></label>';
    }
    return '<details class="skin-overlay-section"' + (ov.enabled ? ' open' : '') + '>' +
      '<summary>壁纸叠加（面板半透明，让壁纸透出）' + (ov.enabled ? ' ✅已启用' : '') + '</summary>' +
      '<label class="skin-checkbox"><input type="checkbox" data-ov-field="enabled"' + (ov.enabled ? ' checked' : '') + '> 启用壁纸叠加</label>' +
      '<div class="skin-colors">' +
        colorRow("panelBg", "面板色") + colorRow("inputBg", "输入框色") + colorRow("sidebarBg", "侧栏色") +
      '</div>' +
      opacityRow("panelOpacity", "面板") +
      opacityRow("inputOpacity", "输入框") +
      opacityRow("sidebarOpacity", "侧栏") +
      '<div class="muted" style="font-size:11px">启用后，壁纸作 body 背景，面板/输入框/侧栏用上面的半透明色叠加。需先注入壁纸。</div>' +
      '</details>';
  }

  function normalizeColor(v) {
    // <input type=color> needs #rrggbb; if empty/invalid, default to #ffffff
    if (!v) return "#ffffff";
    if (/^#([0-9a-fA-F]{6})$/.test(v)) return v;
    if (/^#([0-9a-fA-F]{3})$/.test(v)) {
      return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    }
    return "#ffffff";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function setMsg(text) { var el = $("skin-msg"); if (el) el.textContent = text; }

  // ---- collect editor form into editing working copy ----
  function collectEditor() {
    if (!editing) return null;
    var ed = $("skin-editor");
    if (!ed) return null;
    editing.name = (ed.querySelector('[data-field="name"]') || {}).value || "未命名";
    editing.font = ((ed.querySelector('[data-field="font"]') || {}).value || "").trim() || null;
    var rad = (ed.querySelector('[data-field="radius"]') || {}).value;
    editing.radius = (rad === "" || rad == null) ? null : Number(rad);
    editing.decorations = editing.decorations || {};
    editing.decorations.sparkle = !!(ed.querySelector('[data-field="sparkle"]') || {}).checked;
    // emojiBadges: collect each row (emoji + position). Rows are identified by
    // data-emoji-idx; read in DOM order so the array matches what the user sees.
    var rows = ed.querySelectorAll('[data-emoji-field="emoji"]');
    var badges = [];
    for (var ri = 0; ri < rows.length; ri++) {
      var rowIdx = rows[ri].getAttribute("data-emoji-idx");
      var emojiEl = ed.querySelector('[data-emoji-idx="' + rowIdx + '"][data-emoji-field="emoji"]');
      var posEl = ed.querySelector('[data-emoji-idx="' + rowIdx + '"][data-emoji-field="position"]');
      if (!emojiEl || !posEl) continue;
      var em = (emojiEl.value || "").trim();
      if (!em) continue; // skip empty rows
      var pos = posEl.value || "top-left";
      badges.push({ emoji: em, position: pos });
    }
    editing.decorations.emojiBadges = badges;
    // colors: prefer text field, fallback to color picker
    editing.colors = editing.colors || {};
    skin.COLOR_KEYS.forEach(function (k) {
      var txt = (ed.querySelector('[data-ck-text="' + k + '"]') || {}).value;
      var pick = (ed.querySelector('[data-ck="' + k + '"]') || {}).value;
      var val = (txt && txt.trim()) ? txt.trim() : (pick ? pick : "");
      editing.colors[k] = val || null;
    });
    // overlay (wallpaper coexistence): collect enable + 3 bg colors + 3 opacities
    var ovEnabled = !!(ed.querySelector('[data-ov-field="enabled"]') || {}).checked;
    function ovColor(k) {
      var txt = (ed.querySelector('[data-ov-ck-text="' + k + '"]') || {}).value;
      var pick = (ed.querySelector('[data-ov-ck="' + k + '"]') || {}).value;
      var val = (txt && txt.trim()) ? txt.trim() : (pick ? pick : "");
      return val || null;
    }
    function ovOp(k) {
      var el = ed.querySelector('[data-ov-op="' + k + '"]');
      return el ? Number(el.value) : 100;
    }
    editing.overlay = {
      enabled: ovEnabled,
      panelBg: ovColor("panelBg"), panelOpacity: ovOp("panelOpacity"),
      inputBg: ovColor("inputBg"), inputOpacity: ovOp("inputOpacity"),
      sidebarBg: ovColor("sidebarBg"), sidebarOpacity: ovOp("sidebarOpacity")
    };
    return editing;
  }

  // ---- delegate toolbar + editor events on the panel ----
  var panel = $("skin-panel");
  if (panel && !panel.__skinBound) {
    panel.__skinBound = true;
    panel.addEventListener("change", function (e) {
      var t = e.target;
      // sync color text<->picker (main colors)
      var ck = t.getAttribute && t.getAttribute("data-ck");
      var ckt = t.getAttribute && t.getAttribute("data-ck-text");
      if (ck) {
        var txt = panel.querySelector('[data-ck-text="' + ck + '"]');
        if (txt && txt.value !== t.value) txt.value = t.value;
      }
      if (ckt) {
        var pick = panel.querySelector('[data-ck="' + ckt + '"]');
        if (pick && normalizeColor(t.value) !== pick.value && skin.isValidHex(t.value)) pick.value = normalizeColor(t.value);
      }
      // sync overlay color text<->picker
      var ovck = t.getAttribute && t.getAttribute("data-ov-ck");
      var ovckt = t.getAttribute && t.getAttribute("data-ov-ck-text");
      if (ovck) {
        var otxt = panel.querySelector('[data-ov-ck-text="' + ovck + '"]');
        if (otxt && otxt.value !== t.value) otxt.value = t.value;
      }
      if (ovckt) {
        var opick = panel.querySelector('[data-ov-ck="' + ovckt + '"]');
        if (opick && normalizeColor(t.value) !== opick.value && skin.isValidHex(t.value)) opick.value = normalizeColor(t.value);
      }
      // overlay opacity slider: live-update the % label
      var ovop = t.getAttribute && t.getAttribute("data-ov-op");
      if (ovop) {
        var lbl = panel.querySelector('[data-ov-op-val="' + ovop + '"]');
        if (lbl) lbl.textContent = t.value + "%";
      }
    });
    panel.addEventListener("click", function (e) {
      var act = e.target.getAttribute && e.target.getAttribute("data-skin-act");
      if (!act) return;
      var state = currentState();
      var sel = $("skin-select");
      var id = sel ? sel.value : null;

      // emoji row add/del: editor-local mutations. Collect current editor state
      // into `editing`, mutate the badges array, re-render only the emoji rows
      // (NOT the whole editor — preserves other field focus/values).
      if (act === "addEmojiRow") {
        collectEditor();
        editing.decorations = editing.decorations || {};
        editing.decorations.emojiBadges = editing.decorations.emojiBadges || [];
        editing.decorations.emojiBadges.push({ emoji: "", position: "top-left" });
        var rowsEl = $("skin-emoji-rows");
        if (rowsEl) rowsEl.innerHTML = renderEmojiRows(editing);
        return;
      }
      if (act === "delEmojiRow") {
        collectEditor();
        var rowIdx = parseInt(e.target.getAttribute("data-emoji-row"), 10);
        if (isFinite(rowIdx) && editing.decorations && editing.decorations.emojiBadges) {
          editing.decorations.emojiBadges.splice(rowIdx, 1);
        }
        var rowsEl2 = $("skin-emoji-rows");
        if (rowsEl2) rowsEl2.innerHTML = renderEmojiRows(editing);
        return;
      }

      if (act === "apply") {
        var toApply = id && state.themes[id];
        if (!toApply) { setMsg("先选一个主题"); return; }
        // validate before applying
        var v = skin.validateTheme(toApply);
        if (!v.ok) { setMsg("主题无效: " + v.errors.join("; ")); return; }
        // mark active locally + send to server (full theme in body)
        state.activeId = id;
        skin.saveSkins(state);
        setMsg("应用中...");
        dispatchSkinAction("applySkin", { theme: toApply }).then(function (res) {
          setMsg(res.json.accepted ? "已提交应用" : ("拒绝: " + (res.json.error || "")));
          setTimeout(function () { if (window.__ccPoll) window.__ccPoll(); }, 600);
        }).catch(function (err) { setMsg("错误: " + err.message); });
      } else if (act === "remove") {
        setMsg("移除中...");
        dispatchSkinAction("removeSkin", {}).then(function (res) {
          state.activeId = null;
          skin.saveSkins(state);
          setMsg(res.json.accepted ? "已移除皮肤" : ("拒绝: " + (res.json.error || "")));
          setTimeout(function () { if (window.__ccPoll) window.__ccPoll(); }, 600);
        }).catch(function (err) { setMsg("错误: " + err.message); });
      } else if (act === "new") {
        var blank = skin.makeSkinTheme({ name: "我的新皮肤" });
        state.themes[blank.id] = blank;
        skin.saveSkins(state);
        selectedId = blank.id;            // select the new theme
        forceStructureRebuild();          // list changed -> rebuild dropdown
        renderSkinPanel();
        renderEditor(currentState());
        setMsg("已新建，编辑后点保存");
      } else if (act === "dup") {
        if (!id) { setMsg("先选一个主题"); return; }
        var dup = skin.duplicateTheme(state, id);
        if (!dup) { setMsg("复制失败"); return; }
        state.themes[dup.id] = dup;
        skin.saveSkins(state);
        selectedId = dup.id;
        forceStructureRebuild();
        renderSkinPanel();
        renderEditor(currentState());
        setMsg("已复制为「" + dup.name + "」，可编辑");
      } else if (act === "del") {
        if (!id) { setMsg("先选一个主题"); return; }
        var tt = state.themes[id];
        if (tt && tt.isBuiltin) { setMsg("预设主题不可删除"); return; }
        if (!confirm("删除「" + (tt ? tt.name : id) + "」？")) return;
        delete state.themes[id];
        if (state.activeId === id) state.activeId = null;
        if (selectedId === id) selectedId = null;  // deleted selection gone
        skin.saveSkins(state);
        forceStructureRebuild();
        renderSkinPanel();
        renderEditor(currentState());
        setMsg("已删除");
      } else if (act === "save") {
        var collected = collectEditor();
        if (!collected) return;
        var vv = skin.validateTheme(collected);
        if (!vv.ok) { setMsg("保存失败: " + vv.errors.join("; ")); return; }
        state.themes[collected.id] = collected;
        skin.saveSkins(state);
        selectedId = collected.id;
        // name may have changed -> signature changes -> rebuild to refresh label
        forceStructureRebuild();
        setMsg("已保存「" + collected.name + "」");
        renderSkinPanel();
        renderEditor(currentState());
      }
    });
    // re-render editor when dropdown selection changes.
    // CRITICAL: remember the user's choice in `selectedId` so the next 2s poll
    // doesn't reset the dropdown (the "auto-refresh can't pick another" bug).
    panel.addEventListener("change", function (e) {
      if (e.target && e.target.id === "skin-select") {
        selectedId = e.target.value;
        renderEditor(currentState());
      }
    });
  }

  // helper: reuse control.js dispatchAction via fetch directly (avoids coupling)
  function dispatchSkinAction(action, params) {
    var body = JSON.stringify(Object.assign({ action: action }, params || {}));
    return fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: body })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); });
  }

  // expose for control.js poll loop to call with status snapshot
  window.__ccSkinView = { renderSkinPanel: renderSkinPanel };
})();
