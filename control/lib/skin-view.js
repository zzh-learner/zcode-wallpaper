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

  function $(id) { return document.getElementById(id); }

  function currentState() { return skin.loadSkins(); }

  function themeList(state) {
    return Object.keys(state.themes).map(function (id) { return state.themes[id]; });
  }

  function renderSkinPanel(statusSnapshot) {
    var panel = $("skin-panel");
    if (!panel) return;
    var state = currentState();
    var list = themeList(state);
    var activeId = state.activeId;
    var skinStatus = "";
    if (statusSnapshot && statusSnapshot.skin) {
      var sk = statusSnapshot.skin;
      if (sk.applied && sk.themeName) skinStatus = "当前: " + sk.themeName;
      else if (sk.applied) skinStatus = "当前: 已应用皮肤";
      else if (sk.applied === false) skinStatus = "当前: 无";
      else skinStatus = "当前: 未知（ZCode 未开）";
    }

    var opts = list.map(function (t) {
      var sel = t.id === activeId ? " selected" : "";
      var mark = t.isBuiltin ? " [预设]" : "";
      return '<option value="' + t.id + '"' + sel + ">" + esc(t.name) + mark + "</option>";
    }).join("");

    var html = '<div class="shelf-head"><h3>皮肤</h3>' +
      '<span class="muted" style="font-size:12px">' + skinStatus + '</span></div>';
    html += '<div class="skin-toolbar">' +
      '<select id="skin-select">' + opts + '</select> ' +
      '<button data-skin-act="apply">应用</button> ' +
      '<button data-skin-act="remove">移除</button> ' +
      '<button data-skin-act="new">新建</button> ' +
      '<button data-skin-act="dup">复制</button> ' +
      '<button data-skin-act="del">删除</button></div>';
    html += '<div id="skin-editor"></div>';
    html += '<span id="skin-msg" class="muted"></span>';
    panel.innerHTML = html;

    renderEditor(state);
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
      '<div class="skin-deco">' +
        '<label class="skin-row">品牌文字 <input type="text" data-field="brand" value="' + esc((editing.decorations && editing.decorations.brand) || "") + '" placeholder="留空=不显示"></label>' +
        '<label class="skin-checkbox"><input type="checkbox" data-field="sparkle"' + (editing.decorations && editing.decorations.sparkle ? " checked" : "") + '> 闪光粒子</label>' +
        '<label class="skin-row">Emoji角标 <input type="text" data-field="emojiBadge" value="' + esc((editing.decorations && editing.decorations.emojiBadge) || "") + '" placeholder="留空=不显示" maxlength="4"></label>' +
        '<label class="skin-row">角标位置 <select data-field="emojiPosition">' +
          skin.DECORATION_EMOJI_POSITIONS.map(function (p) {
            var sel = (editing.decorations && editing.decorations.emojiPosition === p) ? " selected" : "";
            return '<option value="' + p + '"' + sel + '>' + p + '</option>';
          }).join("") +
        '</select></label>' +
      '</div>';
    if (!locked) html += '<button data-skin-act="save">保存</button>';
    if (locked) html += '<div class="muted" style="font-size:11px;margin-top:4px">预设主题不可直接编辑。点上方「复制」生成可编辑副本。</div>';
    html += '</fieldset>';
    ed.innerHTML = html;
  }

  // sync color picker <-> text field
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
    editing.decorations.brand = ((ed.querySelector('[data-field="brand"]') || {}).value || "").trim() || null;
    editing.decorations.sparkle = !!(ed.querySelector('[data-field="sparkle"]') || {}).checked;
    editing.decorations.emojiBadge = ((ed.querySelector('[data-field="emojiBadge"]') || {}).value || "").trim() || null;
    editing.decorations.emojiPosition = (ed.querySelector('[data-field="emojiPosition"]') || {}).value || "top-left";
    // colors: prefer text field, fallback to color picker
    editing.colors = editing.colors || {};
    skin.COLOR_KEYS.forEach(function (k) {
      var txt = (ed.querySelector('[data-ck-text="' + k + '"]') || {}).value;
      var pick = (ed.querySelector('[data-ck="' + k + '"]') || {}).value;
      var val = (txt && txt.trim()) ? txt.trim() : (pick ? pick : "");
      editing.colors[k] = val || null;
    });
    return editing;
  }

  // ---- delegate toolbar + editor events on the panel ----
  var panel = $("skin-panel");
  if (panel && !panel.__skinBound) {
    panel.__skinBound = true;
    panel.addEventListener("change", function (e) {
      var t = e.target;
      // sync color text<->picker
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
    });
    panel.addEventListener("click", function (e) {
      var act = e.target.getAttribute && e.target.getAttribute("data-skin-act");
      if (!act) return;
      var state = currentState();
      var sel = $("skin-select");
      var id = sel ? sel.value : null;

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
        renderSkinPanel();
        var ns = $("skin-select"); if (ns) ns.value = blank.id;
        renderEditor(currentState());
        setMsg("已新建，编辑后点保存");
      } else if (act === "dup") {
        if (!id) { setMsg("先选一个主题"); return; }
        var dup = skin.duplicateTheme(state, id);
        if (!dup) { setMsg("复制失败"); return; }
        state.themes[dup.id] = dup;
        skin.saveSkins(state);
        renderSkinPanel();
        var ns2 = $("skin-select"); if (ns2) ns2.value = dup.id;
        renderEditor(currentState());
        setMsg("已复制为「" + dup.name + "」，可编辑");
      } else if (act === "del") {
        if (!id) { setMsg("先选一个主题"); return; }
        var tt = state.themes[id];
        if (tt && tt.isBuiltin) { setMsg("预设主题不可删除"); return; }
        if (!confirm("删除「" + (tt ? tt.name : id) + "」？")) return;
        delete state.themes[id];
        if (state.activeId === id) state.activeId = null;
        skin.saveSkins(state);
        renderSkinPanel();
        setMsg("已删除");
      } else if (act === "save") {
        var collected = collectEditor();
        if (!collected) return;
        var vv = skin.validateTheme(collected);
        if (!vv.ok) { setMsg("保存失败: " + vv.errors.join("; ")); return; }
        state.themes[collected.id] = collected;
        skin.saveSkins(state);
        setMsg("已保存「" + collected.name + "」");
        renderSkinPanel();
        var ns3 = $("skin-select"); if (ns3) ns3.value = collected.id;
        renderEditor(currentState());
      }
    });
    // re-render editor when dropdown selection changes
    panel.addEventListener("change", function (e) {
      if (e.target && e.target.id === "skin-select") renderEditor(currentState());
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
