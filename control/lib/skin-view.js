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
      '<button class="primary" data-skin-act="apply">应用</button> ' +
      '<button class="danger" data-skin-act="remove">移除</button> ' +
      '<button data-skin-act="new">新建</button> ' +
      '<button data-skin-act="dup">复制</button> ' +
      '<button class="danger" data-skin-act="del">删除</button></div>';
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

    var badge = locked ? ' <span class="readonly-badge">预设只读</span>' : '';
    var html = '<fieldset class="skin-edit-fs"' + (locked ? ' disabled title="预设主题只读，点「复制」后编辑副本"' : '') + '>' +
      '<legend>编辑: ' + esc(t.name) + badge + '</legend>' +
      '<details open><summary>基本信息</summary>' +
        '<label class="skin-row">名称 <input type="text" data-field="name" value="' + esc(editing.name) + '"></label>' +
        '<label class="skin-row">字体 <input type="text" data-field="font" value="' + esc(editing.font || "") + '" placeholder="留空=不覆盖"></label>' +
        '<label class="skin-row">圆角(px) <input type="number" data-field="radius" value="' + (editing.radius != null ? editing.radius : "") + '" placeholder="留空=不覆盖" min="0"></label>' +
      '</details>' +
      '<details><summary>角标与闪光</summary>' +
        '<div class="skin-deco">' +
          '<label class="skin-checkbox"><input type="checkbox" data-field="sparkle"' + (editing.decorations && editing.decorations.sparkle ? " checked" : "") + '> 闪光粒子</label>' +
          '<label class="skin-row skin-opacity-row">闪光数量 <input type="range" data-field="sparkleCount" min="0" max="50" value="' + ((editing.decorations && editing.decorations.sparkleCount != null) ? editing.decorations.sparkleCount : 12) + '"><span data-sparkle-count-val>' + ((editing.decorations && editing.decorations.sparkleCount != null) ? editing.decorations.sparkleCount : 12) + '</span></label>' +
          '<div class="skin-emoji-list-head">Emoji 角标（可多个，显示在不同位置）</div>' +
          '<div id="skin-emoji-rows">' + renderEmojiRows(editing) + '</div>' +
          '<button type="button" data-skin-act="addEmojiRow" class="skin-emoji-add">+ 添加角标</button>' +
        '</div>' +
      '</details>' +
      renderOverlaySection(editing);
    if (!locked) html += '<button class="primary" data-skin-act="save">保存</button>';
    if (locked) html += '<div class="muted skin-readonly-hint">预设主题不可直接编辑。点上方「复制」生成可编辑副本。</div>';
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

  // Render the frosted-glass overlay section (spec §5.2): enable toggle +
  // per-region (面板/输入框/侧栏) opacity + blur sliders. NO color pickers —
  // 底色 follows ZCode theme via color-mix + native vars.
  function renderOverlaySection(theme) {
    var ov = theme.overlay || {};
    function rangeRow(kind, region, label, max) {
      var key = region + (kind === "op" ? "Opacity" : "Blur");
      var def = skin.OVERLAY_DEFAULTS[key];
      var v = (ov[key] != null) ? ov[key] : def;
      var unit = kind === "op" ? "%" : "px";
      var dataAttr = kind === "op" ? "data-ov-op" : "data-ov-blur";
      var valAttr = kind === "op" ? "data-ov-op-val" : "data-ov-blur-val";
      return '<label class="skin-row skin-opacity-row">' + label + " " + (kind === "op" ? "透明度" : "模糊度") + " " +
        '<input type="range" ' + dataAttr + '="' + key + '" min="0" max="' + max + '" value="' + v + '">' +
        "<span " + valAttr + '="' + key + '">' + v + unit + "</span></label>";
    }
    function regionBlock(region, label) {
      return '<div class="skin-region">' +
        rangeRow("op", region, label, 100) +
        rangeRow("blur", region, label, 30) +
        "</div>";
    }
    return '<details class="skin-overlay-section"' + (ov.enabled ? " open" : "") + ">" +
      '<summary>磨砂玻璃（面板半透明+模糊，让壁纸透出）' + (ov.enabled ? " ✅已启用" : "") + "</summary>" +
      '<label class="skin-checkbox"><input type="checkbox" data-ov-field="enabled"' + (ov.enabled ? " checked" : "") + "> 启用磨砂玻璃</label>" +
      regionBlock("panel", "面板") +
      regionBlock("input", "输入框") +
      regionBlock("sidebar", "侧栏") +
      '<div class="muted" style="font-size:11px">启用后，面板/输入框/侧栏呈半透明磨砂玻璃，壁纸从后面透出且被模糊。底色自动跟随 ZCode 主题色。</div>' +
      "</details>";
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
    var scEl = ed.querySelector('[data-field="sparkleCount"]');
    if (scEl) {
      var sc = Number(scEl.value);
      editing.decorations.sparkleCount = isFinite(sc) ? Math.max(0, Math.min(50, Math.round(sc))) : 12;
    }
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
    // overlay: collect enable + 3 opacities + 3 blurs (no colors — frosted glass)
    var ovEnabled = !!(ed.querySelector('[data-ov-field="enabled"]') || {}).checked;
    function ovNum(selectorKey, attr, defKey) {
      var el = ed.querySelector("[" + attr + '="' + selectorKey + '"]');
      if (!el) return skin.OVERLAY_DEFAULTS[defKey];
      var n = Number(el.value);
      return isFinite(n) ? n : skin.OVERLAY_DEFAULTS[defKey];
    }
    editing.overlay = {
      enabled: ovEnabled,
      panelOpacity: ovNum("panelOpacity", "data-ov-op", "panelOpacity"),
      panelBlur: ovNum("panelBlur", "data-ov-blur", "panelBlur"),
      inputOpacity: ovNum("inputOpacity", "data-ov-op", "inputOpacity"),
      inputBlur: ovNum("inputBlur", "data-ov-blur", "inputBlur"),
      sidebarOpacity: ovNum("sidebarOpacity", "data-ov-op", "sidebarOpacity"),
      sidebarBlur: ovNum("sidebarBlur", "data-ov-blur", "sidebarBlur")
    };
    return editing;
  }

  // ---- delegate toolbar + editor events on the panel ----
  var panel = $("skin-panel");
  if (panel && !panel.__skinBound) {
    panel.__skinBound = true;
    panel.addEventListener("change", function (e) {
      var t = e.target;
      // overlay opacity slider: live-update the % label
      var ovop = t.getAttribute && t.getAttribute("data-ov-op");
      if (ovop) {
        var lbl = panel.querySelector('[data-ov-op-val="' + ovop + '"]');
        if (lbl) lbl.textContent = t.value + "%";
      }
      // overlay blur slider: live-update the value label (px)
      var ovbl = t.getAttribute && t.getAttribute("data-ov-blur");
      if (ovbl) {
        var blbl = panel.querySelector('[data-ov-blur-val="' + ovbl + '"]');
        if (blbl) blbl.textContent = t.value + "px";
      }
      // sparkle count slider: live-update the count label
      if (t.getAttribute && t.getAttribute("data-field") === "sparkleCount") {
        var scLbl = panel.querySelector("[data-sparkle-count-val]");
        if (scLbl) scLbl.textContent = t.value;
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

    // ---- LIVE PREVIEW ----
    // While the user drags an overlay slider (opacity or blur) or edits a
    // basic field, immediately apply the in-progress theme to ZCode so they
    // see the effect without clicking save+apply. Debounced 250ms so a drag
    // doesn't flood the server with requests.
    // Triggers: data-ov-op (overlay opacity), data-ov-blur (overlay blur),
    // data-field (font/radius/sparkle/emojiPosition). Uses `input` event
    // (fires continuously during slider drag) for range inputs.
    panel.addEventListener("input", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var interesting = t.getAttribute("data-ov-op") || t.getAttribute("data-ov-blur") ||
        t.getAttribute("data-field");
      if (!interesting) return;
      scheduleLivePreview();
    });
    // also live-preview on overlay enable toggle + emoji position change
    panel.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.getAttribute("data-ov-field") === "enabled" ||
          t.getAttribute("data-emoji-field") === "position") {
        scheduleLivePreview();
      }
    });
  }

  // Debounced live preview. Collects current editor state into `editing`,
  // then POSTs applySkin with that theme. Errors are non-fatal (e.g. no ZCode).
  var livePreviewTimer = null;
  function scheduleLivePreview() {
    if (livePreviewTimer) clearTimeout(livePreviewTimer);
    livePreviewTimer = setTimeout(function () {
      livePreviewTimer = null;
      var collected = collectEditor();
      if (!collected) return;
      // skip if invalid (avoid spamming applySkin with broken themes)
      var v = skin.validateTheme(collected);
      if (!v.ok) return;
      dispatchSkinAction("applySkin", { theme: collected }).catch(function () {});
    }, 250);
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
