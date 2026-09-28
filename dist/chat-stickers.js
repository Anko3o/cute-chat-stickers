/*! chat-stickers — long-press where you want it to stick. Built from packages/ by build.sh. CC BY-NC-SA 4.0. */

/* ---- packages/core/press.js ---- */
/*! chat-stickers · press.js — one long-press, three landing spots.
 *
 * Long-press lands on…   → fires
 *   an image             → onMedia(el, event)
 *   a message bubble     → onBubble(el, event)
 *   empty chat area      → onBackground(event)
 *
 * Design notes (learned the hard way on real phones):
 *  - Uses touch events, not pointer events. iOS sends `pointercancel` the moment it
 *    recognises its own long-press, which kills a pointer-based timer.
 *  - Every touchstart/touchmove listener is passive and never calls preventDefault —
 *    calling it on the down event cancels native scrolling on WebKit.
 *  - Moving more than `moveTolerance` px, or the list scrolling, cancels the press.
 *  - After a long-press fires, iOS sends a synthetic click on finger-up; that click is
 *    swallowed so the sheet that just opened does not close itself.
 *  - Desktop: hold the left mouse button, or right-click.
 * Zero dependencies. CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  var DEFAULTS = {
    container: null,                 // element or selector: the scrolling message list
    bubble: ".bubble",               // what counts as a text bubble
    media: "img, video, .media",     // what counts as an image (checked before bubble)
    ignore: "a, button, input, textarea, select, label, [data-no-press]",
    row: null,                       // optional selector for message rows; their empty margins count as background
    longPressMs: 500,
    moveTolerance: 8,
    onBackground: null,
    onBubble: null,
    onMedia: null,                   // falls back to onBubble(el.closest(bubble) || el) when not given
  };

  function $(x) { return typeof x === "string" ? document.querySelector(x) : x; }

  function attach(options) {
    var o = Object.assign({}, DEFAULTS, options || {});
    var box = $(o.container);
    if (!box) throw new Error("ChatPress: container not found");
    box.classList.add("cs-press-area");

    function inside(el) { return el && box.contains(el) ? el : null; }

    /* Where did the finger land? → { kind: "media" | "bubble" | "bg" | "", el } */
    function classify(t) {
      if (!t || !t.closest) return { kind: "" };
      var ign = inside(t.closest(o.ignore));
      var media = o.media ? inside(t.closest(o.media)) : null;
      if (media && !ign) return { kind: "media", el: media };
      var bubble = o.bubble ? inside(t.closest(o.bubble)) : null;
      if (bubble) return ign ? { kind: "" } : { kind: "bubble", el: bubble };
      if (ign) return { kind: "" };
      if (t === box || t.parentElement === box || (o.row && t.matches(o.row) && inside(t))) return { kind: "bg", el: box };
      return { kind: "" };
    }

    function fire(hit, ev) {
      firedAt = Date.now();
      try { var s = window.getSelection && window.getSelection(); if (s && s.rangeCount) s.removeAllRanges(); } catch (_) {}
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) {}
      if (hit.kind === "bg" && o.onBackground) o.onBackground(ev);
      else if (hit.kind === "bubble" && o.onBubble) o.onBubble(hit.el, ev);
      else if (hit.kind === "media") {
        if (o.onMedia) o.onMedia(hit.el, ev);
        else if (o.onBubble) o.onBubble(hit.el.closest(o.bubble) || hit.el, ev);
      }
    }

    var timer = null, sx = 0, sy = 0, pending = null, firedAt = 0;
    function cancel() { if (timer) { clearTimeout(timer); timer = null; } pending = null; }
    function start(hit, x, y, ev) {
      cancel();
      if (!hit.kind) return;
      pending = hit; sx = x; sy = y;
      timer = setTimeout(function () { timer = null; var h = pending; pending = null; if (h) fire(h, ev); }, o.longPressMs);
    }
    function moved(x, y) { return Math.abs(x - sx) > o.moveTolerance || Math.abs(y - sy) > o.moveTolerance; }

    function onTouchStart(e) {
      if (e.touches.length !== 1) return cancel();          // pinch-zoom is not a press
      var t = e.touches[0];
      start(classify(e.target), t.clientX, t.clientY, e);
    }
    function onTouchMove(e) {
      if (!timer || !e.touches.length) return;
      var t = e.touches[0];
      if (moved(t.clientX, t.clientY)) cancel();
    }
    function onTouchEnd(e) {
      cancel();
      if (Date.now() - firedAt < 700 && e.cancelable && e.type === "touchend") e.preventDefault();
    }
    function onPointerDown(e) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      start(classify(e.target), e.clientX, e.clientY, e);
    }
    function onPointerMove(e) { if (e.pointerType === "mouse" && timer && moved(e.clientX, e.clientY)) cancel(); }
    function onPointerEnd(e) { if (e.pointerType === "mouse") cancel(); }
    function onContextMenu(e) {
      var hit = classify(e.target);
      if (!hit.kind) return;
      e.preventDefault();
      cancel();
      if (Date.now() - firedAt < 800) return;               // Android fires this right after our own timer
      fire(hit, e);
    }
    function swallowClick(e) {                               // the synthetic click iOS sends on finger-up
      if (Date.now() - firedAt < 450) { e.stopPropagation(); e.preventDefault(); }
    }

    var L = [
      [box, "touchstart", onTouchStart, { passive: true }],
      [box, "touchmove", onTouchMove, { passive: true }],
      [box, "touchend", onTouchEnd, { passive: false }],     // only preventDefaults right after a press fired
      [box, "touchcancel", cancel, { passive: true }],
      [box, "scroll", cancel, { passive: true }],
      [box, "pointerdown", onPointerDown],
      [box, "pointermove", onPointerMove],
      [box, "pointerup", onPointerEnd],
      [box, "pointerleave", onPointerEnd],
      [box, "pointercancel", onPointerEnd],
      [box, "contextmenu", onContextMenu],
      [document, "click", swallowClick, true],
    ];
    L.forEach(function (l) { l[0].addEventListener(l[1], l[2], l[3]); });

    return {
      classify: classify,
      cancel: cancel,
      detach: function () { cancel(); L.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); }); box.classList.remove("cs-press-area"); },
    };
  }

  global.ChatPress = { attach: attach, defaults: DEFAULTS };
})(typeof window !== "undefined" ? window : this);

/* ---- packages/core/drawer.js ---- */
/*! chat-stickers · drawer.js — the little drawer both the sticker shelf and the kaomoji box are built on.
 *
 * Top bar = search + add (+) + more (…). The grid only picks. Add / edit / delete all live in the top bar:
 * "…" → "Organize" (or long-press / right-click a cell) selects a cell, and the top bar turns into
 * "Edit · Delete". No per-cell buttons, no emoji icons — every icon is a 1.8-stroke line SVG.
 *
 *   ChatDrawer.create({ button, anchor, title, store: { list, add, edit, remove }, cell, onPick, fields })
 *
 * Groups are the only way to sort things (no separate tags). If the store has `groups` ({list, add, rename, remove, reorder}),
 * items carry `groups: [id, …]` and can be in several; the grid is split by group in the user's order and an item shows
 * up once in every group it's in ("Ungrouped" last); forms get package-drawn group pills — tap one to put the item in or
 * take it out, "+ New group" turns into an inline input — and "…" gets "Manage groups" (new · rename · delete · move up / down).
 *
 * Needs core/press.js for long-press on cells (right-click works without it). Zero dependencies. CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  var I = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>"; };
  var ICON = {
    search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    more: I('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),   // lucide more-horizontal
    x: I('<path d="M18 6 6 18M6 6l12 12"/>'),
    back: I('<path d="m15 18-6-6 6-6"/>'),
    tag: I('<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>'),   // lucide tag
    up: I('<path d="m18 15-6-6-6 6"/>'),
    down: I('<path d="m6 9 6 6 6-6"/>'),
    check: I('<path d="M20 6 9 17l-5-5"/>'),
    trash: I('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  };

  var L10N = {
    zh: { search: "搜索", add: "添加", more: "更多", organize: "整理（选一格修改或删除）", edit: "修改", del: "删除", cancel: "取消", save: "保存",
      back: "返回", loading: "在翻抽屉…", failed: "没读到，等会儿再试", empty: "还空着——点右上角的 ＋ 加第一个", noHit: "没搜到",
      pickOne: "点一格来修改或删除", confirmDel: function (n) { return "删掉「" + n + "」？"; },
      group: "分组", ungrouped: "未分组", newGroup: "新分组", groupPh: "分组名", manageGroups: "管理分组", addGroup: "添加",
      groupHint: "点一下进组，再点一下出组；可以进好几个", noGroups: "还没有分组——在下面起一个名字", up: "上移", down: "下移", rename: "点名字改名",
      confirmDelGroup: function (n, c) { return "删掉分组「" + n + "」？" + (c ? "里面的 " + c + " 个只是离开这一组，不会被删。" : ""); } },
    en: { search: "Search", add: "Add", more: "More", organize: "Organize (pick one to edit or delete)", edit: "Edit", del: "Delete", cancel: "Cancel", save: "Save",
      back: "Back", loading: "Loading…", failed: "Couldn't load, try again later", empty: "Empty — tap + at the top to add the first one", noHit: "No match",
      pickOne: "Tap one to edit or delete", confirmDel: function (n) { return "Delete \"" + n + "\"?"; },
      group: "Groups", ungrouped: "Ungrouped", newGroup: "New group", groupPh: "Group name", manageGroups: "Manage groups", addGroup: "Add",
      groupHint: "Tap to put it in, tap again to take it out; it can be in several", noGroups: "No groups yet — name one below", up: "Move up", down: "Move down", rename: "Tap the name to rename",
      confirmDelGroup: function (n, c) { return "Delete the group \"" + n + "\"?" + (c ? " Its " + c + " item(s) just leave this group; nothing is deleted." : ""); } },
  };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function $(x) { return typeof x === "string" ? document.querySelector(x) : x; }
  function lang(o) { return o.lang || (/^zh/i.test(navigator.language || "") ? "zh" : "en"); }

  var all = [];   // every drawer, so opening one closes the others

  function create(options) {
    var o = Object.assign({
      kind: "items", button: null, anchor: null, title: "", store: null,
      cell: function (it) { return esc(it.name || it.text); }, cellTitle: null, groupOf: null, nameOf: null,
      searchText: null, onPick: null, fields: { add: [], edit: [] }, menu: [], lang: null, labels: null,
      onSubmitError: null,   // (err, drawer) => true if handled (e.g. a duplicate: jump to the existing one)
      embed: null,           // element: live inside a host (ChatStickers.panel tabs) instead of floating on its own
      host: null,            // { show(kind), hide() } — the host that owns open / close when embedded
    }, options || {});
    var embed = $(o.embed);
    var L = Object.assign({}, L10N[lang(o)] || L10N.en, o.labels || {});
    var btn = embed ? null : $(o.button), anchor = $(o.anchor) || (btn && (btn.closest("form") || btn.parentElement));
    var items = null, loading = false, selecting = false, selected = null, q = "", mode = "grid", press = null;
    var G = o.store && o.store.groups ? o.store.groups : null, groups = [];
    function nameOf(it) { return o.nameOf ? o.nameOf(it) : (it.name || it.text || ""); }
    function groupById(id) { return id == null || id === "" ? null : groups.find(function (g) { return String(g.id) === String(id); }) || null; }
    /* the groups an item is in, in the user's order (an older server's single `group` still counts) */
    function groupsOf(it) {
      var ids = (Array.isArray(it.groups) ? it.groups : (it.group != null && it.group !== "" ? [it.group] : [])).map(String);
      return groups.filter(function (g) { return ids.indexOf(String(g.id)) >= 0; });
    }
    function groupName(it) {
      if (!G) return o.groupOf ? (o.groupOf(it) || "") : "";
      return groupsOf(it).map(function (g) { return g.name; }).join(" · ");
    }

    var root = document.createElement("div");
    root.className = "cd-drawer cd-" + o.kind + (embed ? " cd-embedded" : "");
    root.hidden = !embed;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", o.title);
    root.innerHTML =
      '<div class="cd-bar">' +
        '<label class="cd-search">' + ICON.search + '<input type="search" enterkeyhint="search" placeholder="' + esc(L.search) + '" aria-label="' + esc(L.search) + '"></label>' +
        '<button type="button" class="cd-ib" data-cd="add" aria-label="' + esc(L.add) + '" title="' + esc(L.add) + '">' + ICON.plus + "</button>" +
        '<button type="button" class="cd-ib" data-cd="more" aria-label="' + esc(L.more) + '" title="' + esc(L.more) + '" aria-haspopup="menu">' + ICON.more + "</button>" +
      "</div>" +
      '<div class="cd-selbar" hidden>' +
        '<span class="cd-sel-t"></span>' +
        '<button type="button" class="cd-tb" data-cd="edit">' + ICON.tag + "<span>" + esc(L.edit) + "</span></button>" +
        '<button type="button" class="cd-tb cd-danger" data-cd="del">' + ICON.trash + "<span>" + esc(L.del) + "</span></button>" +
        '<button type="button" class="cd-ib" data-cd="unsel" aria-label="' + esc(L.cancel) + '">' + ICON.x + "</button>" +
      "</div>" +
      '<div class="cd-viewbar" hidden><button type="button" class="cd-ib" data-cd="back" aria-label="' + esc(L.back) + '">' + ICON.back + '</button><span class="cd-view-t"></span></div>' +
      '<div class="cd-menu" role="menu" hidden></div>' +
      '<div class="cd-body"><div class="cd-grid" role="listbox" aria-label="' + esc(o.title) + '"></div><div class="cd-view" hidden></div></div>';
    (embed || document.body).appendChild(root);
    var grid = root.querySelector(".cd-grid"), view = root.querySelector(".cd-view"), menu = root.querySelector(".cd-menu");
    var input = root.querySelector(".cd-search input");

    function place() {
      if (!anchor || embed) return;
      var r = anchor.getBoundingClientRect(), vw = window.innerWidth;
      var w = Math.min(520, vw - 20, Math.max(300, r.width));
      var left = Math.max(10, Math.min(vw - w - 10, r.left));
      root.style.left = left + "px";
      root.style.width = w + "px";
      root.style.bottom = Math.max(10, window.innerHeight - r.top + 8) + "px";
    }

    function matches(it) {
      if (!q) return true;
      var hay = o.searchText ? o.searchText(it) : [it.name, it.desc, it.text, groupName(it)].concat(it.aliases || []).join(" ");
      return String(hay).toLowerCase().indexOf(q.toLowerCase()) >= 0;
    }

    function paint() {
      if (mode !== "grid") return;
      if (loading && !items) { grid.innerHTML = '<p class="cd-note">' + esc(L.loading) + "</p>"; return; }
      if (!items) { grid.innerHTML = '<p class="cd-note">' + esc(L.failed) + "</p>"; return; }
      var list = items.filter(matches);
      if (!items.length) { grid.innerHTML = '<p class="cd-note">' + esc(L.empty) + "</p>"; return; }
      if (!list.length) { grid.innerHTML = '<p class="cd-note">' + esc(L.noHit) + "</p>"; return; }
      var html = [], lastGroup = null, heads = G ? groups.length > 0 : !!o.groupOf;
      function cellHtml(it) {
        var on = selected && selected.id === it.id;
        return '<button type="button" class="cd-cell' + (on ? " on" : "") + '" data-id="' + esc(it.id) + '" title="' + esc(o.cellTitle ? o.cellTitle(it) : nameOf(it)) + '">' + o.cell(it) + "</button>";
      }
      if (G && heads) {                                // the user's group order, "Ungrouped" last; an item shows up in every group it's in
        var mine = list.map(function (it) { return groupsOf(it).map(function (g) { return String(g.id); }); });
        groups.forEach(function (g) {
          var cells = list.filter(function (it, i) { return mine[i].indexOf(String(g.id)) >= 0; });
          if (cells.length) html.push('<h3 class="cd-group">' + esc(g.name) + "</h3>" + cells.map(cellHtml).join(""));
        });
        var loose = list.filter(function (it, i) { return !mine[i].length; });
        if (loose.length) html.push('<h3 class="cd-group">' + esc(L.ungrouped) + "</h3>" + loose.map(cellHtml).join(""));
      } else list.forEach(function (it) {
        var g = heads ? (groupName(it) || L.ungrouped) : null;
        if (g !== null && g !== lastGroup) { html.push('<h3 class="cd-group">' + esc(g) + "</h3>"); lastGroup = g; }
        html.push(cellHtml(it));
      });
      grid.innerHTML = html.join("");
      grid.classList.toggle("selecting", selecting);
    }

    function paintBars() {
      root.querySelector(".cd-bar").hidden = mode !== "grid" || selecting;
      root.querySelector(".cd-selbar").hidden = mode !== "grid" || !selecting;
      root.querySelector(".cd-viewbar").hidden = mode === "grid";
      root.querySelector(".cd-sel-t").textContent = selected ? nameOf(selected) : L.pickOne;
      root.querySelectorAll('[data-cd="edit"], [data-cd="del"]').forEach(function (b) { b.disabled = !selected; });
    }

    function reload() {
      if (!o.store) return Promise.resolve();
      loading = true; paint();
      return Promise.all([o.store.list(""), G ? Promise.resolve(G.list()).catch(function () { return []; }) : null])
        .then(function (r) { items = r[0] || []; if (G) groups = (r[1] || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }); })
        .catch(function () { items = null; })
        .then(function () { loading = false; paint(); });
    }

    function select(it) { selecting = true; selected = it || null; paintBars(); paint(); }
    function unselect() { selecting = false; selected = null; paintBars(); paint(); }

    function showView(title, node, opt) {           // opt.focus === false: don't pop the phone keyboard
      mode = "view";
      closeMenu();
      root.querySelector(".cd-view-t").textContent = title || "";
      view.innerHTML = "";
      view.appendChild(node);
      grid.hidden = true; view.hidden = false;
      paintBars();
      var f = opt && opt.focus === false ? null : view.querySelector("input[type=text], input[type=url], textarea");
      if (f) setTimeout(function () { f.focus(); }, 30);
    }
    function back() { mode = "grid"; view.hidden = true; grid.hidden = false; view.innerHTML = ""; paintBars(); paint(); }

    /* A tiny form from field specs: {key, label, type: text|textarea|groups|file, placeholder, required, max}.
       groups = package-drawn pills, several can be on (see pills(); "group" is the same field under its old name).
       Submitting sends an array of group ids under that key. The Save row sticks to the bottom. */
    function form(fields, initial, submitLabel, onSubmit) {
      var f = document.createElement("form");
      f.className = "cd-form";
      f.innerHTML = fields.map(function (fd) {
        var v = initial ? initial[fd.key] : "";
        var ph = ' placeholder="' + esc(fd.placeholder || "") + '"', req = fd.required ? " required" : "", mx = fd.max ? ' maxlength="' + fd.max + '"' : "";
        var ctl;
        if (fd.type === "file") ctl = '<input type="file" name="' + fd.key + '" accept="' + esc(fd.accept || "image/png,image/jpeg,image/gif,image/webp") + '"' + req + '><img class="cd-preview" alt="" hidden>';
        else if (fd.type === "textarea") ctl = '<textarea name="' + fd.key + '" rows="2"' + ph + req + mx + ">" + esc(v) + "</textarea>";
        else if (fd.type === "groups" || fd.type === "group") return G ? '<div class="cd-field"><span>' + esc(fd.label || L.group) + '</span><div data-pills="' + fd.key + '"></div></div>' : "";
        else ctl = '<input type="text" name="' + fd.key + '" value="' + esc(v) + '"' + ph + req + mx + ">";
        return '<label class="cd-field"><span>' + esc(fd.label) + "</span>" + ctl + "</label>";
      }).join("") +
        '<p class="cd-err" hidden></p>' +
        '<div class="cd-row"><button type="submit" class="cd-btn cd-primary">' + esc(submitLabel) + '</button><button type="button" class="cd-btn" data-cd="back">' + esc(L.cancel) + "</button></div>";
      var pickers = {};
      f.querySelectorAll("[data-pills]").forEach(function (slot) {
        var p = pills(initial ? groupsOf(initial).map(function (g) { return g.id; }) : (o.defaultGroup != null ? o.defaultGroup : []));
        slot.replaceWith(p.el); pickers[slot.dataset.pills] = p;
      });
      var fileData = "";
      var file = f.querySelector("input[type=file]");
      if (file) file.addEventListener("change", function () {
        var fl = file.files && file.files[0];
        if (!fl) return;
        var rd = new FileReader();
        rd.onload = function () {
          fileData = String(rd.result || "");
          var pv = f.querySelector(".cd-preview"); pv.src = fileData; pv.hidden = false;
          var nameIn = f.querySelector('input[name="name"]');
          if (nameIn && !nameIn.value) nameIn.value = fl.name.replace(/\.[^.]+$/, "").slice(0, 40);
        };
        rd.readAsDataURL(fl);
      });
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var out = {};
        fields.forEach(function (fd) {
          if (fd.type === "file") out[fd.key] = fileData;
          else if (fd.type === "groups" || fd.type === "group") { if (pickers[fd.key]) out[fd.key] = pickers[fd.key].value(); }
          else out[fd.key] = f.elements[fd.key].value.trim();
        });
        var sb = f.querySelector(".cd-primary"); sb.disabled = true;
        var keys = Object.keys(pickers);
        Promise.all(keys.map(function (k) { return ensureGroups(out[k]); }))
          .then(function (ids) { keys.forEach(function (k, i) { out[k] = ids[i]; }); return onSubmit(out); })
          .then(function () { back(); unselect(); return reload(); })
          .catch(function (err) {
            if (o.onSubmitError && o.onSubmitError(err, api)) return;
            var p = f.querySelector(".cd-err"); p.textContent = String((err && err.message) || err); p.hidden = false;
          })
          .then(function () { sb.disabled = false; });
      });
      return f;
    }

    /* Group pills drawn by the package: every group in order, then "+ New group" (turns into an inline input).
       Several can be on — tap one to put the item in, tap again to take it out; none on = ungrouped.
       A new name typed in the input comes on right away and is only created on save (ensureGroups()).
       initial: an array of group ids (or one id, or {id} / {name} values from another picker).
       value() → [{id} | {name}, …], including a name still sitting in the input. */
    function pills(initial, onChange) {
      var el = document.createElement("div");
      el.className = "cd-pills"; el.setAttribute("role", "group"); el.setAttribute("aria-label", L.group); el.title = L.groupHint;
      var cur = [], fresh = [], inp = null;
      function norm(v) {
        if (v == null || v === "") return null;
        if (typeof v === "object") return v.id != null ? (groupById(v.id) ? { id: groupById(v.id).id } : null) : (v.name ? { name: String(v.name) } : null);
        return groupById(v) ? { id: groupById(v).id } : null;
      }
      function same(a, b) { return a.id != null ? String(a.id) === String(b.id) : (b.id == null && a.name === b.name); }
      function has(v) { return cur.some(function (x) { return same(x, v); }); }
      function put(v) { if (v && !has(v)) cur.push(v); if (v && v.name != null && fresh.indexOf(v.name) < 0) fresh.push(v.name); }
      (Array.isArray(initial) ? initial : [initial]).forEach(function (v) { put(norm(v)); });
      function pill(v, label) {
        var on = has(v);
        return '<button type="button" class="cd-pill' + (on ? " on" : "") + '" aria-pressed="' + (on ? "true" : "false") + '" data-v="' + esc(JSON.stringify(v)) + '">' + esc(label) + "</button>";
      }
      function draw() {
        inp = null;
        el.innerHTML = groups.map(function (g) { return pill({ id: g.id }, g.name); }).join("") +
          fresh.map(function (n) { return pill({ name: n }, n); }).join("") +
          '<button type="button" class="cd-pill cd-pill-new" data-new="1">' + ICON.plus + "<span>" + esc(L.newGroup) + "</span></button>";
      }
      function changed() { draw(); if (onChange) onChange(cur.slice()); }
      function take(n) {                               // a typed name: an existing group comes on, a new one is kept for save
        n = String(n || "").split(/\s+/).join(" ").trim().slice(0, 20);
        if (!n) return false;
        var g = groups.find(function (x) { return x.name === n; });
        put(g ? { id: g.id } : { name: n });
        return true;
      }
      function edit() {
        var nb = el.querySelector(".cd-pill-new");
        var box = document.createElement("span");
        box.className = "cd-pill-edit";
        box.innerHTML = '<input type="text" maxlength="20" enterkeyhint="done" placeholder="' + esc(L.groupPh) + '" aria-label="' + esc(L.newGroup) + '"><button type="button" aria-label="' + esc(L.save) + '">' + ICON.check + "</button>";
        nb.replaceWith(box);
        var me = box.querySelector("input");
        inp = me;
        function commit() { if (inp !== me) return; take(me.value); changed(); }
        me.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); draw(); }
        });
        me.addEventListener("blur", function () { setTimeout(function () { if (inp === me && document.activeElement !== me) commit(); }, 120); });
        box.querySelector("button").addEventListener("click", commit);
        me.focus();                                    // in the tap itself, or iOS won't raise the keyboard
      }
      el.addEventListener("click", function (e) {
        if (e.target.closest(".cd-pill-new")) return edit();
        var b = e.target.closest(".cd-pill[data-v]");
        if (!b) return;
        if (inp && inp.value.trim()) take(inp.value);  // tapped a pill mid-typing: keep what was typed
        var v = JSON.parse(b.dataset.v);
        if (has(v)) cur = cur.filter(function (x) { return !same(x, v); }); else cur.push(v);
        changed();
      });
      draw();
      return {
        el: el,
        value: function () { if (inp && inp.value.trim()) { take(inp.value); inp.value = ""; } return cur.slice(); },
        set: function (l) { cur = []; (Array.isArray(l) ? l : [l]).forEach(function (v) { put(norm(v)); }); changed(); },
      };
    }

    /* null | {id} | {name} | id | name → a group id (creating the group if it's new), or null. */
    function ensureGroup(v) {
      if (v == null || v === "" || !G) return Promise.resolve(G ? null : v);
      if (typeof v !== "object") v = groupById(v) ? { id: v } : { name: String(v) };
      if (v.id != null) return Promise.resolve(v.id);
      var hit = groups.find(function (g) { return g.name === v.name; });
      if (hit) return Promise.resolve(hit.id);
      return Promise.resolve(G.add(v.name)).then(function (g) {
        g = (g && g.group) || g; groups.push(g); return g.id;
      }, function (err) {
        var d = err && err.data && err.data.duplicate;
        if (d) { groups.push(d); return d.id; }
        throw err;
      });
    }
    /* a pills() value (or one of anything ensureGroup takes) → [group id, …], new groups created one after another */
    function ensureGroups(l) {
      l = Array.isArray(l) ? l : (l == null || l === "" ? [] : [l]);
      var out = [];
      return l.reduce(function (p, v) {
        return p.then(function () { return ensureGroup(v); }).then(function (id) { if (id != null && out.indexOf(id) < 0) out.push(id); });
      }, Promise.resolve()).then(function () { return out; });
    }

    function refreshGroups() {
      return Promise.resolve(G.list()).then(function (l) { groups = (l || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }); });
    }

    /* "…" → Manage groups: rename (tap the name), move up / down, delete (members become ungrouped), add. */
    function groupsView() {
      var node = document.createElement("div");
      node.className = "cd-groups";
      function fail(err) { var p = node.querySelector(".cd-err"); if (p) { p.textContent = String((err && err.message) || err); p.hidden = false; } }
      function after(p) { return Promise.resolve(p).then(function () { return Promise.all([refreshGroups(), reload()]); }).then(draw, fail); }
      function draw() {
        node.innerHTML = (groups.length ? groups.map(function (g, i) {
          return '<div class="cd-grow" data-gid="' + esc(g.id) + '">' +
            '<span class="cd-grow-n" role="button" tabindex="0" title="' + esc(L.rename) + '">' + esc(g.name) + "</span>" +
            '<span class="cd-grow-c">' + esc(g.count != null ? g.count : "") + "</span>" +
            '<button type="button" class="cd-ib" data-g="up" aria-label="' + esc(L.up) + '"' + (i === 0 ? " disabled" : "") + ">" + ICON.up + "</button>" +
            '<button type="button" class="cd-ib" data-g="down" aria-label="' + esc(L.down) + '"' + (i === groups.length - 1 ? " disabled" : "") + ">" + ICON.down + "</button>" +
            '<button type="button" class="cd-ib cd-danger" data-g="del" aria-label="' + esc(L.del) + '">' + ICON.trash + "</button></div>";
        }).join("") : '<p class="cd-note">' + esc(L.noGroups) + "</p>") +
          '<form class="cd-gadd"><input type="text" maxlength="20" placeholder="' + esc(L.groupPh) + '" aria-label="' + esc(L.newGroup) + '"><button type="submit" class="cd-btn cd-small cd-primary">' + esc(L.addGroup) + "</button></form>" +
          '<p class="cd-err" hidden></p>';
      }
      function rename(span) {
        var row = span.closest(".cd-grow"), g = groupById(row.dataset.gid), inp = document.createElement("input");
        inp.type = "text"; inp.maxLength = 20; inp.value = g.name;
        span.replaceWith(inp); inp.focus(); inp.select();
        var done = false;
        function commit() {
          if (done) return; done = true;
          var n = inp.value.split(/\s+/).join(" ").trim();
          if (!n || n === g.name) return draw();
          after(G.rename(g.id, n));
        }
        inp.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done = true; draw(); }
        });
        inp.addEventListener("blur", commit);
      }
      node.addEventListener("click", function (e) {
        var n = e.target.closest(".cd-grow-n");
        if (n) return rename(n);
        var b = e.target.closest("[data-g]");
        if (!b) return;
        var row = b.closest(".cd-grow"), g = groupById(row.dataset.gid), i = groups.indexOf(g);
        if (b.dataset.g === "del") {
          if (confirm(L.confirmDelGroup(g.name, g.count || 0))) after(G.remove(g.id));
          return;
        }
        var ids = groups.map(function (x) { return x.id; }), j = i + (b.dataset.g === "up" ? -1 : 1);
        if (j < 0 || j >= ids.length) return;
        ids.splice(j, 0, ids.splice(i, 1)[0]);
        after(G.reorder(ids));
      });
      node.addEventListener("keydown", function (e) { var n = e.target.closest && e.target.closest(".cd-grow-n"); if (n && e.key === "Enter") { e.preventDefault(); rename(n); } });
      node.addEventListener("submit", function (e) {
        e.preventDefault();
        var inp = node.querySelector(".cd-gadd input"), n = inp.value.split(/\s+/).join(" ").trim();
        if (n) after(G.add(n));
      });
      refreshGroups().then(draw, function () { draw(); });
      draw();
      showView(L.manageGroups, node);
    }

    /* Highlight one cell and scroll to it, with a short note on top (used for "already have it"). */
    var noteTimer = 0;
    function flash(id, message) {
      if (mode !== "grid") back();
      if (selecting) unselect();
      if (q) { q = ""; input.value = ""; }
      paint();
      var cell = grid.querySelector('.cd-cell[data-id="' + String(id).replace(/"/g, "") + '"]');
      var note = root.querySelector(".cd-toast");
      if (!note) { note = document.createElement("div"); note.className = "cd-toast"; note.setAttribute("role", "status"); root.appendChild(note); }
      if (message) { note.textContent = message; note.hidden = false; clearTimeout(noteTimer); noteTimer = setTimeout(function () { note.hidden = true; }, 2800); }
      if (!cell) return;
      cell.classList.remove("cd-flash"); void cell.offsetWidth; cell.classList.add("cd-flash");
      cell.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(function () { cell.classList.remove("cd-flash"); }, 2600);
    }

    function openAdd() { showView(L.add, form(o.fields.add, null, L.save, function (v) { return o.store.add(v); })); }
    function openEdit() {
      if (!selected) return;
      var it = selected;
      // editing is mostly tagging one item after another: don't focus the name (it pops the keyboard on phones)
      showView(L.edit + " · " + nameOf(it), form(o.fields.edit, it, L.save, function (v) { return o.store.edit(it, v); }), { focus: false });
    }
    function doDelete() {
      if (!selected || !confirm(L.confirmDel(nameOf(selected)))) return;
      Promise.resolve(o.store.remove(selected)).then(function () { unselect(); return reload(); })
        .catch(function (err) { alert(String((err && err.message) || err)); });
    }

    function openMenu() {
      var entries = [{ id: "organize", label: L.organize }].concat(G ? [{ id: "groups", label: L.manageGroups }] : [], o.menu || []);
      menu.innerHTML = entries.map(function (m) { return '<button type="button" role="menuitem" class="cd-mi" data-mi="' + esc(m.id) + '">' + esc(m.label) + "</button>"; }).join("");
      menu.hidden = false;
    }
    function closeMenu() { menu.hidden = true; }

    root.addEventListener("click", function (e) {
      var mi = e.target.closest(".cd-mi");
      if (mi) {
        closeMenu();
        if (mi.dataset.mi === "organize") return select(null);
        if (mi.dataset.mi === "groups") return groupsView();
        var ext = (o.menu || []).find(function (m) { return m.id === mi.dataset.mi; });
        if (ext && ext.onClick) ext.onClick(api);
        return;
      }
      if (!e.target.closest(".cd-menu") && !e.target.closest('[data-cd="more"]')) closeMenu();
      var c = e.target.closest("[data-cd]");
      if (c) {
        var a = c.dataset.cd;
        if (a === "add") openAdd();
        else if (a === "more") { if (menu.hidden) openMenu(); else closeMenu(); }
        else if (a === "edit") openEdit();
        else if (a === "del") doDelete();
        else if (a === "unsel") unselect();
        else if (a === "back") back();
        return;
      }
      var cell = e.target.closest(".cd-cell");
      if (!cell || !items) return;
      var it = items.find(function (x) { return String(x.id) === cell.dataset.id; });
      if (!it) return;
      if (selecting) { selected = it; paintBars(); paint(); return; }
      if (o.onPick) o.onPick(it, api);
    });
    grid.addEventListener("contextmenu", function (e) {
      var cell = e.target.closest(".cd-cell");
      if (!cell || !items) return;
      e.preventDefault();
      select(items.find(function (x) { return String(x.id) === cell.dataset.id; }));
    });
    if (global.ChatPress) {
      press = global.ChatPress.attach({ container: grid, bubble: ".cd-cell", media: null, ignore: "a, input, textarea",
        onBubble: function (cell) { var it = items && items.find(function (x) { return String(x.id) === cell.dataset.id; }); if (it) select(it); } });
    }
    input.addEventListener("input", function () { q = input.value.trim(); paint(); });

    /* back to the plain grid: no menu, no form, nothing selected */
    function reset() { closeMenu(); if (mode !== "grid") back(); if (selecting) unselect(); }

    function open() {
      if (embed) { if (o.host) o.host.show(o.kind); if (items === null && !loading) reload(); return; }
      all.forEach(function (d) { if (d !== api) d.close(); });
      place();
      root.hidden = false;
      requestAnimationFrame(function () { root.classList.add("open"); });
      if (btn) btn.setAttribute("aria-expanded", "true");
      if (items === null && !loading) reload();
    }
    function close() {
      if (embed) { reset(); if (o.host) o.host.hide(); return; }
      if (root.hidden) return;
      root.classList.remove("open");
      root.hidden = true;
      closeMenu();
      if (mode !== "grid") back();
      if (selecting) unselect();
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
    function toggle() { if (root.hidden) open(); else close(); }

    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); toggle(); });
    }
    if (!embed) document.addEventListener("pointerdown", function (e) {
      if (root.hidden || root.contains(e.target) || (btn && btn.contains(e.target))) return;
      close();
    });
    if (!embed) {
      window.addEventListener("keydown", function (e) { if (e.key === "Escape" && !root.hidden) close(); });
      window.addEventListener("resize", function () { if (!root.hidden) place(); });
    }

    var api = {
      root: root, open: open, close: close, toggle: toggle, reload: reload, paint: paint, reset: reset,
      loaded: function () { return items !== null || loading; },
      showView: showView, back: back, form: form, select: select, unselect: unselect, flash: flash,
      items: function () { return items || []; }, labels: L, esc: esc, icons: ICON,
      groups: function () { return groups.slice(); }, groupName: groupName, pills: pills, ensureGroup: ensureGroup, ensureGroups: ensureGroups, groupsOf: groupsOf, refreshGroups: refreshGroups,
    };
    if (!embed) all.push(api);
    paintBars();
    return api;
  }

  /* Insert text at the caret of an <input>/<textarea> without sending it. */
  function insertAtCaret(input, text) {
    if (!input) return;
    var v = input.value, a = input.selectionStart == null ? v.length : input.selectionStart, b = input.selectionEnd == null ? v.length : input.selectionEnd;
    input.value = v.slice(0, a) + text + v.slice(b);
    input.selectionStart = input.selectionEnd = a + text.length;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    try { input.focus(); } catch (_) {}
  }

  /* Groups kept next to the items: [{id, name, order}]; an item holds `groups: [id, …]` and can be in several.
     Older saves are folded in (same as sticker.py's migrate_groups): a single `group` (id or name) and any `tags`
     become groups — a name with no group yet gets one, after the existing ones — and `group` / `tags` are dropped. */
  function migrateGroups(m) {
    m.groups = (m.groups || []).filter(function (g) { return g && g.id != null && g.name; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var next = m.groups.reduce(function (x, g) { return Math.max(x, (+g.id || 0) + 1); }, m.nextGroup || 1);
    (m.items || []).forEach(function (it) {
      var raw = (Array.isArray(it.groups) ? it.groups.slice() : []).concat([it.group], Array.isArray(it.tags) ? it.tags : String(it.tags || "").split(/[,，]/));
      var ids = [];
      raw.forEach(function (v) {
        if (v == null || v === "" || v === 0 || v === false || typeof v === "object") return;
        var g;
        if (typeof v === "number") g = m.groups.find(function (x) { return x.id === v; });
        else {
          var name = String(v).split(/\s+/).join(" ").trim().slice(0, 20);
          if (!name) return;
          g = m.groups.find(function (x) { return x.name === name; });
          if (!g) { g = { id: next++, name: name, order: m.groups.length + 1 }; m.groups.push(g); }
        }
        if (g && ids.indexOf(g.id) < 0) ids.push(g.id);
      });
      it.groups = ids; delete it.group; delete it.tags;
    });
    m.groups.forEach(function (g, i) { g.order = i + 1; });
    m.nextGroup = next;
    return m;
  }
  function inGroup(it, id) { return (it.groups || []).some(function (x) { return String(x) === String(id); }); }

  /* Store backed by localStorage, seeded from a JSON file — for demos and single-device use. Has groups. */
  function localStore(key, seedUrl, pickList, makeItem) {
    var mem = null;
    function load() {
      if (mem) return Promise.resolve(mem);
      try { var s = JSON.parse(localStorage.getItem(key) || "null"); if (s) { mem = migrateGroups(s); return Promise.resolve(mem); } } catch (_) {}
      return (seedUrl ? fetch(seedUrl).then(function (r) { return r.json(); }).catch(function () { return {}; }) : Promise.resolve({}))
        .then(function (d) {
          var list = pickList(d) || [];
          mem = migrateGroups({ items: list, next: list.reduce(function (m, x) { return Math.max(m, (+x.id || 0) + 1); }, 1),
            groups: (d.groups || []).map(function (g) { return { id: g.id, name: g.name, order: g.order }; }), nextGroup: d.next_group_id || 1 });
          persist(); return mem;
        });
    }
    function persist() { try { localStorage.setItem(key, JSON.stringify(mem)); } catch (_) {} }
    function dupeGroup(m, name, but) {
      var hit = m.groups.find(function (g) { return g !== but && g.name === name; });
      if (!hit) return null;
      var e = new Error("group \"" + name + "\" already exists"); e.data = { duplicate: hit }; return e;
    }
    function cleanName(n) { n = String(n || "").split(/\s+/).join(" ").trim(); if (!n || n.length > 20) throw new Error("group name: 1-20 chars"); return n; }
    var groups = {
      list: function () {
        return load().then(function (m) {
          return m.groups.map(function (g) { return Object.assign({}, g, { count: m.items.filter(function (it) { return inGroup(it, g.id); }).length }); });
        });
      },
      add: function (name) {
        return load().then(function (m) {
          name = cleanName(name); var e = dupeGroup(m, name); if (e) throw e;
          var g = { id: m.nextGroup++, name: name, order: m.groups.length + 1 }; m.groups.push(g); persist(); return g;
        });
      },
      rename: function (id, name) {
        return load().then(function (m) {
          var g = m.groups.find(function (x) { return String(x.id) === String(id); }); if (!g) throw new Error("no such group");
          name = cleanName(name); var e = dupeGroup(m, name, g); if (e) throw e;
          g.name = name; persist(); return g;
        });
      },
      remove: function (id) {                          // it comes off its members
        return load().then(function (m) {
          m.groups = m.groups.filter(function (x) { return String(x.id) !== String(id); });
          m.groups.forEach(function (g, i) { g.order = i + 1; });
          m.items.forEach(function (it) { it.groups = (it.groups || []).filter(function (x) { return String(x) !== String(id); }); });
          persist();
        });
      },
      reorder: function (ids) {
        return load().then(function (m) {
          var pos = {}; (ids || []).forEach(function (id, i) { pos[id] = i; });
          m.groups.sort(function (a, b) { return (pos[a.id] != null ? pos[a.id] : 1e9 + a.order) - (pos[b.id] != null ? pos[b.id] : 1e9 + b.order); });
          m.groups.forEach(function (g, i) { g.order = i + 1; });
          persist(); return m.groups;
        });
      },
    };
    return {
      list: function () { return load().then(function (m) { return m.items.slice(); }); },
      add: function (v) { return load().then(function (m) { var it = makeItem(v, m.next++); m.items.push(it); persist(); return it; }); },
      edit: function (it, v) { return load().then(function (m) { var x = m.items.find(function (y) { return y.id === it.id; }); if (x) Object.assign(x, v); persist(); return x; }); },
      remove: function (it) { return load().then(function (m) { m.items = m.items.filter(function (y) { return y.id !== it.id; }); persist(); }); },
      groups: groups,
      _all: function () { return load(); }, _persist: persist,
    };
  }

  /* The same group calls against the reference server: {base}/groups. */
  function httpGroups(call, base) {
    return {
      list: function () { return call("GET", base + "/groups").then(function (d) { return d.groups || []; }); },
      add: function (name) { return call("POST", base + "/groups", { name: name }).then(function (d) { return d.group; }); },
      rename: function (id, name) { return call("PUT", base + "/groups/" + encodeURIComponent(id), { name: name }).then(function (d) { return d.group; }); },
      remove: function (id) { return call("DELETE", base + "/groups/" + encodeURIComponent(id)); },
      reorder: function (ids) { return call("PUT", base + "/groups", { order: ids }).then(function (d) { return d.groups; }); },
    };
  }

  /* JSON over fetch, with optional headers (object or function). */
  function http(headers) {
    return function (method, url, body) {
      var h = typeof headers === "function" ? headers() : (headers || {});
      var init = { method: method, headers: Object.assign({}, h, body ? { "Content-Type": "application/json" } : {}) };
      if (body) init.body = JSON.stringify(body);
      return fetch(url, init).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok || d.ok === false) {
            var e = new Error(d.error || (typeof d.detail === "string" ? d.detail : "") || ("HTTP " + r.status));
            e.status = r.status; e.data = d;
            throw e;
          }
          return d;
        });
      });
    };
  }

  /* Float `el` just above `anchor` (the composer), phone- and desktop-friendly. */
  function placeAbove(el, anchor) {
    if (!anchor) return;
    var r = anchor.getBoundingClientRect(), vw = window.innerWidth;
    var w = Math.min(520, vw - 20, Math.max(300, r.width));
    el.style.left = Math.max(10, Math.min(vw - w - 10, r.left)) + "px";
    el.style.width = w + "px";
    el.style.bottom = Math.max(10, window.innerHeight - r.top + 8) + "px";
  }

  global.ChatDrawer = { create: create, placeAbove: placeAbove, all: all, insertAtCaret: insertAtCaret, localStore: localStore, http: http, httpGroups: httpGroups, icons: ICON, esc: esc };
})(typeof window !== "undefined" ? window : this);

/* ---- packages/emoji-bg/emoji-bg.js ---- */
/*! chat-stickers · emoji-bg.js — each person picks one emoji; both get scattered across the same chat background.
 *
 *   EmojiBg.init({ me: { id: "a", name: "A", emoji: "🐰" }, others: [{ id: "b", name: "B", emoji: "🦊" }],
 *                  endpoint: "/chat-bg", events: "/events", container: "#messages" })
 *
 * - The layer is `position:fixed`, `pointer-events:none`, and is only re-scattered when an emoji or the
 *   viewport grid changes — scrolling never repaints it.
 * - Layout is deterministic (seeded by the emoji pair + grid size + `seed`), so two same-sized screens match.
 * - The page background is tinted a little towards the emojis' average colour (`mix`), less when the colour is grey.
 * - State is shared through a tiny adapter: GET/PUT `endpoint` + an SSE stream by default (see server/PROTOCOL.md),
 *   localStorage when there is no endpoint, or bring your own `adapter: { load, save, subscribe }`.
 * Zero dependencies. CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  var EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

  var L10N = {
    zh: {
      title: "聊天背景", close: "不改了", ok: "就这样贴", remove: "移除", me: "我", you: "你",
      picked: function (n, e) { return n + "已选择" + e; }, none: function (n) { return n + "还没贴"; },
      set: function (n, e) { return n + "给背景贴了一个 " + e; }, unset: function (n, e) { return n + "揭下了背景上的" + e; },
      addYours: "贴一个", failed: "没贴上，再试一次", recentEmpty: "贴过的会排在这里", tabs: "emoji 分类",
      cats: { recent: "最近使用", face: "表情", animal: "动物与自然", food: "食物", activity: "活动", travel: "旅行", object: "物品", symbol: "符号" },
    },
    en: {
      title: "Chat background", close: "Cancel", ok: "Done", remove: "Remove", me: "Me", you: "You",
      picked: function (n, e) { return n + " picked " + e; }, none: function (n) { return n + ": none yet"; },
      set: function (n, e) { return n + " added " + e + " to the background"; }, unset: function (n, e) { return n + " removed " + e + " from the background"; },
      addYours: "Add yours", failed: "Couldn't save, try again", recentEmpty: "Emoji you use show up here", tabs: "Emoji categories",
      cats: { recent: "Recent", face: "Smileys", animal: "Animals & Nature", food: "Food", activity: "Activities", travel: "Travel", object: "Objects", symbol: "Symbols" },
    },
  };

  var CATS = [
    { id: "recent", icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>' },
    { id: "face", icon: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.2a4.2 4.2 0 0 0 7 0"/><path d="M9.3 9.6h.01M14.7 9.6h.01"/>',
      list: "😀 😃 😄 😁 😆 🥹 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🫣 🤗 🫡 🤔 🫢 🤭 🤫 🫠 😶 🫥 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 👽 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🫶 👐 🙌 👏 🤝 👍 👎 👊 ✌️ 🤞 🫰 🤟 👌 🤌 👈 👉 🙏 💅 💪 👀 👄 👶 👧 👸 🧚 🧜‍♀️ 🧸" },
    { id: "animal", icon: '<ellipse cx="12" cy="15.5" rx="4.2" ry="3.4"/><circle cx="6.2" cy="10.4" r="1.7"/><circle cx="9.6" cy="6.8" r="1.7"/><circle cx="14.4" cy="6.8" r="1.7"/><circle cx="17.8" cy="10.4" r="1.7"/>',
      list: "🐰 🐇 🦊 🐱 🐈 🐶 🐕 🐭 🐹 🐻 🐻‍❄️ 🐼 🐨 🐯 🦁 🐮 🐄 🐷 🐖 🐽 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦢 🦉 🦩 🦚 🦜 🦇 🐺 🐗 🐴 🦄 🦓 🦌 🦙 🦘 🦥 🦦 🦨 🦡 🐿️ 🦔 🐝 🪲 🐞 🦋 🐌 🐛 🐢 🐍 🦎 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦭 🦈 🐊 🐘 🦒 🦛 🐪 🐾 🌸 🌷 🌹 🥀 🌺 🌻 🌼 💐 🪷 🪻 🌱 🌿 ☘️ 🍀 🍃 🍂 🍁 🍄 🌵 🌴 🌳 🌲 🪴 🌾 🌙 🌛 🌝 🌚 ⭐ 🌟 ✨ ⚡ ☄️ 🔥 🌈 ☀️ 🌤️ ⛅ ☁️ 🌧️ ⛈️ ❄️ ☃️ ⛄ 🌊 💧 🫧 🌍 🪐" },
    { id: "food", icon: '<path d="M12 8.2c-1.6-1.3-5.2-1.1-6 2.4-.8 3.5 1.8 8.4 4 8.4.8 0 1.2-.4 2-.4s1.2.4 2 .4c2.2 0 4.8-4.9 4-8.4-.8-3.5-4.4-3.7-6-2.4Z"/><path d="M12 8.2c0-2 .8-3.4 2.4-4.2"/>',
      list: "🍓 🍒 🍑 🍎 🍏 🍐 🍊 🍋 🍌 🍉 🍇 🫐 🍈 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥕 🌽 🌶️ 🥒 🥬 🥦 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 🫖 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🍸 🍹 🧉 🧊" },
    { id: "activity", icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2l3.2 2.3-1.2 3.8h-4l-1.2-3.8Z"/><path d="M12 3.5v3.7M15.2 9.5l4.6-1.3M14 13.3l2.6 4.4M10 13.3l-2.6 4.4M8.8 9.5 4.2 8.2"/>',
      list: "⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🏓 🏸 🏒 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 🏂 🏋️ 🤸 ⛹️ 🤺 🏇 🧘 🏄 🏊 🚴 🧗 🏆 🥇 🥈 🥉 🏅 🎖️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🪗 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🕹️ 🎰 🧩" },
    { id: "travel", icon: '<path d="M4.5 15.5v-3.2l2-4.3a1.6 1.6 0 0 1 1.5-1h8a1.6 1.6 0 0 1 1.5 1l2 4.3v3.2Z"/><path d="M4.5 12.3h15"/><circle cx="8" cy="15.8" r="1.6"/><circle cx="16" cy="15.8" r="1.6"/>',
      list: "🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🛵 🏍️ 🛺 🚲 🛴 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🛖 🏠 🏡 🏘️ 🏗️ 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🛕 🕍 ⛩️ 🗾 🎑 🏞️ 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙️ 🌃 🌌 🌉 🌁" },
    { id: "object", icon: '<path d="M9 17.5h6M9.8 20h4.4"/><path d="M12 3.8a5.6 5.6 0 0 0-3.4 10c.5.4.8 1 .8 1.7v.5h5.2v-.5c0-.7.3-1.3.8-1.7a5.6 5.6 0 0 0-3.4-10Z"/>',
      list: "💡 🔦 🕯️ 🪔 🧸 🪆 🎀 🎁 🎈 🎏 🎐 🧧 ✉️ 💌 📮 📦 📜 📃 📄 📑 📊 📈 📉 🗒️ 🗓️ 📆 📅 📇 🗃️ 🗳️ 🗄️ 📋 📁 📂 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇️ 📐 📏 🧮 📌 📍 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓 🔑 🗝️ 🔨 🪄 ⚙️ 🧲 🧪 🔭 🔬 💊 🩹 🧴 🧼 🪥 🧽 🪞 🛁 🛏️ 🛋️ 🪑 🚪 🪟 🧺 🧻 🪣 🧹 🧯 🛒 👑 💍 💎 👒 🎩 👓 🕶️ 👗 👘 👙 👚 👛 👜 👝 🎒 👠 👡 👢 🧦 🧤 🧣 💄 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💽 💾 💿 📀 🎥 📷 📸 📹 📼 🔮 🧿 🪬 📿 🕰️ ⏰ ⏳ 🔔 🎵 🎶 📣 📢 🔇" },
    { id: "symbol", icon: '<path d="M12 19.2S4.5 14.8 4.5 9.6A3.9 3.9 0 0 1 12 7.8a3.9 3.9 0 0 1 7.5 1.8c0 5.2-7.5 9.6-7.5 9.6Z"/>',
      list: "❤️ 🩷 🧡 💛 💚 💙 🩵 💜 🤎 🖤 🩶 🤍 ❤️‍🔥 ❤️‍🩹 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ☯️ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ ⚛️ 🉑 🈶 🈚 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨️ ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🔱 ⚜️ 🔰 ♻️ ✅ ❇️ ✳️ ❎ 🌐 💠 🌀 💤 🆗 🆙 🆒 🆕 🆓 ➕ ➖ ➗ ✖️ ♾️ 〰️ ➰ ➿ ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🟫 💬 💭 🗯️ ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄" },
  ];

  var DEFAULTS = {
    me: { id: "me", name: "", emoji: "🐰" },
    others: [{ id: "other", name: "", emoji: "🦊" }],
    endpoint: null,          // GET → state, PUT {emoji} → {state}
    headers: null,           // object, or function returning one (add your auth header here)
    events: null,            // SSE url; messages shaped {type: eventName, state, by}
    eventName: "chat_bg",
    adapter: null,           // { load(): Promise<state>, save(emoji): Promise<state>, subscribe(cb) }
    container: null,         // message list; with press.js loaded, long-pressing its empty area opens the picker
    longPress: true,
    longPressMs: 500,
    insertBefore: null,      // element/selector the layer is inserted before (default: first child of <body>)
    cellSize: 0,             // px per grid cell; 0 = 124 on phones, 170 on wide screens
    densityPerScreen: 0,     // or: roughly how many emoji per screen (overrides cellSize)
    mix: { day: 0.12, night: 0.06 },   // how far the background moves towards the emoji colour
    seed: "",
    isNight: null,           // () => boolean; default: <html data-cs-theme>, else prefers-color-scheme
    enabled: null,           // () => boolean; e.g. only in some rooms. Call EmojiBg.refresh() when it changes.
    lang: null,              // "zh" | "en" (default from navigator.language)
    labels: null,            // override any L10N key
    recentKey: "emoji_bg_recent_v1",
    onChange: null,          // (state, by) => void
    toast: null,             // (text) => void, for save errors
  };

  /* ── helpers ── */
  function hash(str) {                                      // FNV-1a
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {                                      // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function $(x) { return typeof x === "string" ? document.querySelector(x) : x; }
  function svg(inner) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>"; }

  /* ── scatter: one emoji per grid cell at most ── */
  var SIZES = [0.20, 0.28, 0.38, 0.52], SIZE_W = [0.30, 0.30, 0.25, 0.15];
  function cellFor(w, h, o) {
    if (o.densityPerScreen > 0) return Math.max(40, Math.min(400, Math.sqrt((w * h * 0.86) / o.densityPerScreen)));
    return o.cellSize || (w < 600 ? 124 : 170);
  }
  function scatter(box, w, h, list, cell, seed) {
    box.textContent = "";
    if (!list.length || w < 10 || h < 10) return 0;
    var cols = Math.max(3, Math.round(w / cell));
    var cw = w / cols, ch = cw * 1.02, rows = Math.ceil(h / ch) + 1;
    var rand = rng(hash(list.join("|") + ":" + cols + ":" + (seed || "")));
    var frag = document.createDocumentFragment(), n = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (rand() < 0.14) continue;                          // leave some air
        var pick = list.length === 1 ? 0 : (r + c) % list.length;
        if (list.length > 1 && rand() < 0.22) pick = (pick + 1) % list.length;
        var u = rand(), tier = 0, acc = 0;
        for (var i = 0; i < SIZE_W.length; i++) { acc += SIZE_W[i]; if (u <= acc) { tier = i; break; } }
        var size = Math.round(cw * SIZES[tier] * (0.9 + rand() * 0.2));
        var pad = size * 0.6;
        var x = c * cw + pad + rand() * Math.max(1, cw - pad * 2);
        var y = r * ch - ch * 0.35 + pad + rand() * Math.max(1, ch - pad * 2);
        var rot = Math.round((rand() - 0.5) * 28);
        var alpha = (0.72 + rand() * 0.28).toFixed(2);
        var s = document.createElement("span");
        s.className = "ebg-e";
        s.textContent = list[pick];
        s.style.cssText = "left:" + x.toFixed(1) + "px;top:" + y.toFixed(1) + "px;font-size:" + size + "px;transform:translate(-50%,-50%) rotate(" + rot + "deg);opacity:" + alpha;
        frag.appendChild(s);
        n++;
      }
    }
    box.appendChild(frag);
    return n;
  }

  /* ── average emoji colour → background tint ── */
  var colorCache = new Map();
  function emojiColor(e) {
    if (colorCache.has(e)) return colorCache.get(e);
    var out = null;
    try {
      var S = 40, cv = document.createElement("canvas");
      cv.width = S; cv.height = S;
      var cx = cv.getContext("2d", { willReadFrequently: true });
      cx.textAlign = "center"; cx.textBaseline = "middle";
      cx.font = "32px " + EMOJI_FONT;
      cx.fillText(e, S / 2, S / 2 + 2);
      var d = cx.getImageData(0, 0, S, S).data, r = 0, g = 0, b = 0, wsum = 0;
      for (var i = 0; i < d.length; i += 4) {
        var a = d[i + 3];
        if (a < 48) continue;
        r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; wsum += a;
      }
      if (wsum > 0) out = { r: r / wsum, g: g / wsum, b: b / wsum };
    } catch (_) {}
    colorCache.set(e, out);
    return out;
  }
  function tintFor(list, night, mix) {
    var cols = list.map(emojiColor).filter(Boolean);
    if (!cols.length) return "transparent";
    var c = cols.reduce(function (a, x) { return { r: a.r + x.r / cols.length, g: a.g + x.g / cols.length, b: a.b + x.b / cols.length }; }, { r: 0, g: 0, b: 0 });
    var mx = Math.max(c.r, c.g, c.b) / 255, mn = Math.min(c.r, c.g, c.b) / 255;
    var L = (mx + mn) / 2, sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * L - 1));
    var k = Math.max(0.25, Math.min(1, (sat - 0.08) / 0.30)); // greyish colours tint less
    if (L > 0.86 || L < 0.18) k *= 0.6;
    var a = (night ? mix.night : mix.day) * k;
    return "rgba(" + Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b) + "," + a.toFixed(3) + ")";
  }

  /* ── adapters ── */
  function httpAdapter(o) {
    function hdr(extra) { var h = typeof o.headers === "function" ? o.headers() : (o.headers || {}); return Object.assign({}, h, extra || {}); }
    return {
      load: function () {
        return fetch(o.endpoint, { headers: hdr(), cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
      },
      save: function (emoji) {
        return fetch(o.endpoint, { method: "PUT", headers: hdr({ "Content-Type": "application/json" }), body: JSON.stringify({ emoji: emoji }) })
          .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then(function (d) { return d && d.state ? d.state : null; });
      },
      subscribe: function (cb) {
        if (!o.events || typeof EventSource === "undefined") return;
        var es = new EventSource(o.events);
        es.onmessage = function (ev) {
          try { var d = JSON.parse(ev.data); if (d && d.type === o.eventName && d.state) cb(d.state, d.by); } catch (_) {}
        };
      },
    };
  }
  function localAdapter(o, meId) {
    var KEY = "emoji_bg_state_v1";
    function read() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (_) { return {}; } }
    return {
      load: function () { return Promise.resolve(read()); },
      save: function (emoji) {
        var s = read(); s[meId] = { emoji: emoji, updated_at: new Date().toISOString() };
        try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {}
        return Promise.resolve(s);
      },
      subscribe: function (cb) { window.addEventListener("storage", function (e) { if (e.key === KEY) cb(read()); }); },
    };
  }

  /* ── the widget ── */
  var o = null, L = null, people = [], state = {}, layer = null, sheet = null, press = null;
  var draft = "", openedAt = 0, saving = false, paintedKey = "", adapter = null;

  function isNight() {
    if (o.isNight) return !!o.isNight();
    var t = document.documentElement.dataset.csTheme;                    // same switch as core/theme.css
    if (t === "dark" || t === "light") return t === "dark";
    return !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function isEnabled() { return o.enabled ? !!o.enabled() : true; }
  function listOf(s) { return people.map(function (p) { return s[p.id] && s[p.id].emoji; }).filter(Boolean); }
  function nameOf(id) { var p = people.find(function (x) { return x.id === id; }); return (p && p.name) || id; }
  function toast(t) { if (o && o.toast) o.toast(t); }

  function paint(force) {
    if (!layer) return;
    var list = listOf(state);
    var w = window.innerWidth, h = Math.max(window.innerHeight, document.documentElement.clientHeight || 0);
    var cell = cellFor(w, h, o);
    var key = list.join("|") + "@" + Math.round(w / cell) + "x" + Math.ceil(h / 40);
    document.documentElement.style.setProperty("--ebg-tint", tintFor(list, isNight(), o.mix));
    document.documentElement.dataset.emojiBg = isEnabled() && list.length ? "on" : "off";
    document.documentElement.dataset.emojiBgNight = isNight() ? "1" : "0";
    if (!force && key === paintedKey) return;
    paintedKey = key;
    scatter(layer, w, h, list, cell, o.seed);
  }

  function apply(next, by) {
    if (!next || typeof next !== "object") return;
    var changed = false;
    people.forEach(function (p) {
      var v = next[p.id];
      if (v && typeof v.emoji === "string" && (!state[p.id] || state[p.id].emoji !== v.emoji)) {
        state[p.id] = { emoji: v.emoji, updated_at: v.updated_at || "" };
        changed = true;
      }
    });
    paint();
    if (sheet && !sheet.hidden) paintSheet();
    if (changed && o.onChange) o.onChange(getState(), by);
  }
  function getState() { return JSON.parse(JSON.stringify(state)); }
  function reload() { return adapter.load().then(function (s) { apply(s); }).catch(function () {}); }

  /* recent picks (this device only) */
  function recent() { try { var v = JSON.parse(localStorage.getItem(o.recentKey) || "[]"); return Array.isArray(v) ? v.slice(0, 16) : []; } catch (_) { return []; } }
  function pushRecent(e) {
    if (!e) return;
    try { localStorage.setItem(o.recentKey, JSON.stringify([e].concat(recent().filter(function (x) { return x !== e; })).slice(0, 16))); } catch (_) {}
  }

  /* ── picker sheet ── */
  function ensureSheet() {
    if (sheet) return sheet;
    sheet = document.createElement("div");
    sheet.className = "ebg-sheet";
    sheet.hidden = true;
    var others = people.filter(function (p) { return p.id !== o.me.id; });
    sheet.innerHTML =
      '<div class="ebg-scrim" data-ebg="close"></div>' +
      '<section class="ebg-panel" role="dialog" aria-modal="true" aria-labelledby="ebgTitle">' +
        '<header class="ebg-head">' +
          '<button type="button" class="ebg-icon" data-ebg="close" aria-label="' + esc(L.close) + '">' + svg('<path d="m7 7 10 10M17 7 7 17"/>') + "</button>" +
          '<h2 class="ebg-title" id="ebgTitle">' + esc(L.title) + "</h2>" +
          '<button type="button" class="ebg-icon ebg-ok" data-ebg="ok" aria-label="' + esc(L.ok) + '">' + svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>') + "</button>" +
        "</header>" +
        '<div class="ebg-preview"><div class="ebg-preview-field" aria-hidden="true"></div>' +
          '<div class="ebg-pills">' +
            '<span class="ebg-others">' + others.map(function (p) { return '<span class="ebg-pill ebg-pill-other" data-who="' + esc(p.id) + '"></span>'; }).join("") + "</span>" +
            '<span class="ebg-pill ebg-pill-mine"><span class="ebg-pill-t"></span><button type="button" class="ebg-remove" data-ebg="remove">' + esc(L.remove) + "</button></span>" +
          "</div>" +
        "</div>" +
        '<nav class="ebg-tabs" role="tablist" aria-label="' + esc(L.tabs) + '">' +
          CATS.map(function (c, i) { var n = L.cats[c.id]; return '<button type="button" class="ebg-tab' + (i === 0 ? " on" : "") + '" role="tab" data-cat="' + c.id + '" aria-label="' + esc(n) + '" title="' + esc(n) + '">' + svg(c.icon) + "</button>"; }).join("") +
        "</nav>" +
        '<div class="ebg-grid-wrap"></div>' +
      "</section>";
    document.body.appendChild(sheet);
    sheet.addEventListener("click", onSheetClick);
    sheet.querySelector(".ebg-grid-wrap").addEventListener("scroll", syncTabs, { passive: true });
    return sheet;
  }
  function paintGrid() {
    var rec = recent();
    sheet.querySelector(".ebg-grid-wrap").innerHTML = CATS.map(function (c) {
      var list = c.id === "recent" ? rec : c.list.split(/\s+/).filter(Boolean);
      var body = list.length
        ? '<div class="ebg-grid">' + list.map(function (e) { return '<button type="button" class="ebg-cell" data-emoji="' + esc(e) + '" aria-label="' + esc(e) + '">' + esc(e) + "</button>"; }).join("") + "</div>"
        : '<p class="ebg-empty">' + esc(L.recentEmpty) + "</p>";
      return '<section class="ebg-sec" data-sec="' + c.id + '"><h3 class="ebg-sec-t">' + esc(L.cats[c.id]) + "</h3>" + body + "</section>";
    }).join("");
  }
  function paintSheet() {
    if (!sheet) return;
    var preview = {};
    people.forEach(function (p) { preview[p.id] = p.id === o.me.id ? { emoji: draft } : state[p.id]; });
    var list = listOf(preview);
    var field = sheet.querySelector(".ebg-preview-field");
    sheet.querySelector(".ebg-preview").style.setProperty("--ebg-tint", tintFor(list, isNight(), o.mix));
    var r = field.getBoundingClientRect();
    scatter(field, r.width || 320, r.height || 200, list, 92, o.seed);
    sheet.querySelectorAll(".ebg-pill-other").forEach(function (el) {
      var id = el.dataset.who, e = state[id] && state[id].emoji;
      el.textContent = e ? L.picked(nameOf(id), e) : L.none(nameOf(id));
    });
    sheet.querySelector(".ebg-pill-mine .ebg-pill-t").textContent = draft ? L.picked(L.me, draft) : L.none(L.me);
    sheet.querySelector(".ebg-remove").hidden = !draft;
    sheet.querySelector(".ebg-ok").disabled = draft === ((state[o.me.id] && state[o.me.id].emoji) || "");
    sheet.querySelectorAll(".ebg-cell").forEach(function (b) { b.classList.toggle("on", !!draft && b.dataset.emoji === draft); });
  }
  function syncTabs() {
    var wrap = sheet.querySelector(".ebg-grid-wrap");
    var top = wrap.getBoundingClientRect().top + 8, cur = CATS[0].id;
    sheet.querySelectorAll(".ebg-sec").forEach(function (s) { if (s.getBoundingClientRect().top <= top) cur = s.dataset.sec; });
    sheet.querySelectorAll(".ebg-tab").forEach(function (t) { t.classList.toggle("on", t.dataset.cat === cur); });
  }
  function onSheetClick(e) {
    var t = e.target.closest("[data-ebg], .ebg-tab, .ebg-cell");
    if (!t || Date.now() - openedAt < 450) return;          // the click that iOS sends when the long-press finger lifts
    if (t.classList.contains("ebg-cell")) { draft = t.dataset.emoji; paintSheet(); return; }
    if (t.classList.contains("ebg-tab")) {
      var sec = sheet.querySelector('.ebg-sec[data-sec="' + t.dataset.cat + '"]');
      var wrap = sheet.querySelector(".ebg-grid-wrap");
      if (sec) wrap.scrollTo({ top: sec.offsetTop - wrap.offsetTop, behavior: "smooth" });
      sheet.querySelectorAll(".ebg-tab").forEach(function (x) { x.classList.toggle("on", x === t); });
      return;
    }
    var act = t.dataset.ebg;
    if (act === "close") close();
    else if (act === "remove") { draft = ""; paintSheet(); }
    else if (act === "ok") save(draft);
  }
  function save(emoji) {
    if (saving || emoji === ((state[o.me.id] && state[o.me.id].emoji) || "")) return Promise.resolve();
    saving = true;
    return adapter.save(emoji)
      .then(function (s) {
        var next = s || {}; if (!s) { next[o.me.id] = { emoji: emoji }; }
        apply(next, o.me.id); pushRecent(emoji); close();
      })
      .catch(function () { toast(L.failed); })
      .then(function () { saving = false; });
  }
  function open() {
    if (!isEnabled()) return;
    ensureSheet();
    if (!sheet.hidden) return;
    try { var ae = document.activeElement; if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT")) ae.blur(); } catch (_) {}
    draft = (state[o.me.id] && state[o.me.id].emoji) || "";
    openedAt = Date.now();
    paintGrid();
    sheet.hidden = false;
    requestAnimationFrame(function () {
      sheet.classList.add("open");
      paintSheet();
      sheet.querySelector(".ebg-grid-wrap").scrollTop = 0;
      syncTabs();
    });
    reload();
  }
  function close() {
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove("open");
    setTimeout(function () { if (!sheet.classList.contains("open")) sheet.hidden = true; }, 260);
  }

  /* A system line for the chat stream: "B added 🦊 to the background  [Add yours]" */
  function notice(ev) {
    ev = ev || {};
    var mine = ev.who === o.me.id, who = mine ? L.you : nameOf(ev.who);
    var shown = ev.emoji || ev.prev || "";
    var eHtml = '<span class="ebg-notice-e">' + esc(shown) + "</span>";
    var d = document.createElement("div");
    d.className = "ebg-notice";
    d.innerHTML = '<span class="ebg-chip">' + (ev.emoji ? L.set(esc(who), eHtml) : L.unset(esc(who), eHtml)) +
      (mine ? "" : '<button type="button" class="ebg-notice-go">' + esc(L.addYours) + "</button>") + "</span>";
    var go = d.querySelector(".ebg-notice-go");
    if (go) go.addEventListener("click", function (e) { e.stopPropagation(); open(); });
    return d;
  }

  function init(options) {
    o = Object.assign({}, DEFAULTS, options || {});
    o.mix = Object.assign({}, DEFAULTS.mix, o.mix || {});
    var lang = o.lang || (/^zh/i.test(navigator.language || "") ? "zh" : "en");
    L = Object.assign({}, L10N[lang] || L10N.en, o.labels || {});
    L.cats = Object.assign({}, (L10N[lang] || L10N.en).cats, (o.labels && o.labels.cats) || {});
    people = [o.me].concat(o.others || []).slice().sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : 1; }); // same order on every device
    state = {};
    people.forEach(function (p) { state[p.id] = { emoji: p.emoji || "", updated_at: "" }; });
    adapter = o.adapter || (o.endpoint ? httpAdapter(o) : localAdapter(o, o.me.id));

    if (!layer) {
      layer = document.createElement("div");
      layer.className = "ebg-layer";
      layer.setAttribute("aria-hidden", "true");
      var before = $(o.insertBefore);
      if (before && before.parentNode) before.parentNode.insertBefore(layer, before);
      else document.body.insertBefore(layer, document.body.firstChild);
      var rz = 0;
      window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { paint(); }, 160); }, { passive: true });
      if (window.matchMedia) { try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { paint(true); }); } catch (_) {} }
      new MutationObserver(function () { paint(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-cs-theme"] });
      window.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
      document.addEventListener("visibilitychange", function () { if (!document.hidden) reload(); });
    }
    if (o.container && o.longPress && global.ChatPress && !press) {
      press = global.ChatPress.attach({ container: o.container, longPressMs: o.longPressMs, onBackground: open });
    }
    if (adapter.subscribe) adapter.subscribe(function (s, by) { apply(s, by); });
    paint(true);
    reload();
    return api;
  }

  var api = {
    init: init, open: open, close: close, apply: apply, reload: reload, notice: notice,
    state: getState,
    refresh: function () { paint(true); },
    setMix: function (day, night) { if (day != null) o.mix.day = +day; if (night != null) o.mix.night = +night; paint(true); if (sheet && !sheet.hidden) paintSheet(); },
    tintFor: function (list, night) { return tintFor(list, night, o ? o.mix : DEFAULTS.mix); },
    scatter: scatter,
  };
  global.EmojiBg = api;
})(typeof window !== "undefined" ? window : this);

/* ---- packages/reactions/reactions.js ---- */
/*! chat-stickers · reactions.js — long-press a bubble, pick from a 2 × 4 grid, the emoji sticks to the bubble's corner.
 *
 *   Reactions.init({ container: "#messages", getId: (el) => el.closest("[data-id]").dataset.id,
 *                    onReact: (id, value) => sendToServer(id, value) })
 *
 * No text labels in the grid (aria-label only). The 8th cell opens "more": by default the sticker panel
 * (if stickers/panel.js is loaded), so a bubble can get a sticker too. Values are plain strings:
 * an emoji, or a sticker tag like [[sticker:name]].
 * Zero dependencies. CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  var ICON = {
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  };
  var NAMES = {
    zh: { "❤️": "喜欢", "🥺": "呜", "😂": "笑死", "🫣": "害羞", "😡": "生气", "🐰": "兔兔", "🫶": "贴贴", more: "更多", grid: "贴表情" },
    en: { "❤️": "Love", "🥺": "Aww", "😂": "LOL", "🫣": "Shy", "😡": "Angry", "🐰": "Bunny", "🫶": "Hug", more: "More", grid: "React" },
  };

  var DEFAULTS = {
    container: null,          // with press.js loaded: long-press bubbles/images inside it to open the grid
    bubble: ".bubble",
    media: "img, video, .media",
    longPressMs: 450,
    emojis: ["❤️", "🥺", "😂", "🫣", "😡", "🐰", "🫶"],
    more: true,               // 8th cell
    getId: function (el) { var r = el.closest("[data-id]"); return r ? r.dataset.id : null; },
    canReact: null,           // (el, id) => boolean
    mine: null,               // (id) => array of values I already put on this message (highlighted)
    onReact: null,            // (id, value, el) => void   value "" = take mine off (tap a highlighted cell)
    onMore: null,             // (id, el, done(value)) => void; default opens StickerPanel.pick() when present
    actions: [],              // optional rows under the grid: [{ id, label, icon: "<svg…>", onClick(id, el) }]
    lang: null,
    labels: null,
    lift: true,               // float a copy of the pressed bubble above the scrim
  };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var o = DEFAULTS, N = NAMES.en, root = null, card = null, clone = null, cur = null, openedAt = 0, press = null;

  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "rx-layer";
    root.hidden = true;
    root.innerHTML = '<div class="rx-scrim"></div><div class="rx-card" role="dialog" aria-label="' + esc(N.grid) + '"><div class="rx-grid" role="group"></div><div class="rx-actions"></div></div>';
    document.body.appendChild(root);
    card = root.querySelector(".rx-card");
    root.querySelector(".rx-scrim").addEventListener("click", function () { if (Date.now() - openedAt > 450) close(); });
    card.addEventListener("click", onClick);
    window.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    window.addEventListener("resize", close);
    if (o.container) {
      var box = typeof o.container === "string" ? document.querySelector(o.container) : o.container;
      if (box) box.addEventListener("scroll", close, { passive: true });
    }
  }

  function paintGrid() {
    var mine = (cur && o.mine) ? (o.mine(cur.id) || []) : [];
    var cells = o.emojis.slice(0, o.more ? 7 : 8).map(function (e) {
      var isSticker = global.StickerRender && global.StickerRender.parse(e);
      var face = isSticker ? '<img src="' + esc(global.StickerRender.src(isSticker)) + '" alt="">' : esc(e);
      return '<button type="button" class="rx-cell' + (mine.indexOf(e) >= 0 ? " on" : "") + '" data-v="' + esc(e) + '" aria-label="' + esc(N[e] || e) + '"><span class="rx-glyph">' + face + "</span></button>";
    });
    if (o.more) cells.push('<button type="button" class="rx-cell rx-more" data-act="more" aria-label="' + esc(N.more) + '">' + ICON.more + "</button>");
    card.querySelector(".rx-grid").innerHTML = cells.join("");
    card.querySelector(".rx-actions").innerHTML = (o.actions || []).map(function (a) {
      return '<button type="button" class="rx-act" data-action="' + esc(a.id) + '">' + (a.icon || "") + "<span>" + esc(a.label) + "</span></button>";
    }).join("");
    card.querySelector(".rx-actions").hidden = !(o.actions && o.actions.length);
  }

  function open(el) {
    if (!el) return;
    var id = o.getId(el);
    if (id == null || (o.canReact && !o.canReact(el, id))) return;
    build();
    if (!root.hidden) close(true);
    cur = { id: id, el: el };
    openedAt = Date.now();
    try { var ae = document.activeElement; if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT")) ae.blur(); } catch (_) {}
    paintGrid();
    var r = el.getBoundingClientRect();
    if (o.lift) {
      clone = el.cloneNode(true);
      clone.classList.add("rx-clone");
      clone.removeAttribute("id");
      clone.style.cssText += ";left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px";
      root.insertBefore(clone, card);
    }
    root.hidden = false;
    card.style.visibility = "hidden";
    requestAnimationFrame(function () {
      var ch = card.offsetHeight, cw = card.offsetWidth, gap = 10, vw = window.innerWidth, vh = window.innerHeight;
      var top = r.bottom + gap;
      if (top + ch + 12 > vh) top = Math.max(12, r.top - gap - ch);
      var rightSide = r.left + r.width / 2 > vw / 2;
      var left = rightSide ? r.right - cw : r.left;
      left = Math.max(12, Math.min(vw - cw - 12, left));
      card.style.left = left + "px";
      card.style.top = top + "px";
      card.style.transformOrigin = (rightSide ? "100% " : "0% ") + (top > r.top ? "0%" : "100%");
      card.style.visibility = "";
      root.classList.add("open");
    });
  }

  function close(now) {
    if (!root || root.hidden) return;
    root.classList.remove("open");
    var done = function () { if (root.classList.contains("open")) return; root.hidden = true; if (clone) { clone.remove(); clone = null; } };
    if (now === true) done(); else setTimeout(done, 180);
  }

  function react(value) {
    if (!cur) return;
    var mine = o.mine ? (o.mine(cur.id) || []) : [];
    var v = mine.indexOf(value) >= 0 ? "" : value;             // tapping the one I already put there takes it off
    if (o.onReact) o.onReact(cur.id, v, cur.el);
    close();
  }

  function onClick(e) {
    if (Date.now() - openedAt < 450) return;
    var a = e.target.closest(".rx-act");
    if (a && cur) {
      var def = (o.actions || []).find(function (x) { return x.id === a.dataset.action; });
      var c = cur; close();
      if (def && def.onClick) def.onClick(c.id, c.el);
      return;
    }
    var b = e.target.closest(".rx-cell");
    if (!b || !cur) return;
    if (b.dataset.act === "more") {
      var c2 = cur;
      var done = function (value) { if (value == null) return; cur = c2; react(value); };
      close();
      if (o.onMore) o.onMore(c2.id, c2.el, done);
      else if (global.StickerPanel && global.StickerPanel.pick) global.StickerPanel.pick(done);
      return;
    }
    react(b.dataset.v);
  }

  /* Draw the chips on a bubble's corner. values: array of emoji / sticker tags. */
  function paint(bubble, values) {
    if (!bubble) return;
    var old = bubble.querySelector(":scope > .rx-chips");
    if (old) old.remove();
    values = (values || []).filter(Boolean);
    bubble.classList.toggle("rx-has", values.length > 0);
    bubble.classList.remove("rx-has-sticker");
    if (!values.length) return;
    var wrap = document.createElement("div");
    wrap.className = "rx-chips";
    wrap.innerHTML = values.map(function (v) {
      var st = global.StickerRender && global.StickerRender.parse(v);
      if (st) { bubble.classList.add("rx-has-sticker"); return '<span class="rx-chip rx-chip-sticker"><img src="' + esc(global.StickerRender.src(st)) + '" alt="' + esc(st) + '" loading="lazy"></span>'; }
      return '<span class="rx-chip">' + esc(v) + "</span>";
    }).join("");
    bubble.appendChild(wrap);
  }

  function init(options) {
    o = Object.assign({}, DEFAULTS, options || {});
    var lang = o.lang || (/^zh/i.test(navigator.language || "") ? "zh" : "en");
    N = Object.assign({}, NAMES[lang] || NAMES.en, o.labels || {});
    build();
    if (o.container && global.ChatPress && !press && options.longPress !== false) {
      press = global.ChatPress.attach({ container: o.container, bubble: o.bubble, media: o.media, longPressMs: o.longPressMs, onBubble: open });
    }
    return api;
  }

  var api = { init: init, open: open, close: close, paint: paint };
  global.Reactions = api;
})(typeof window !== "undefined" ? window : this);

/* ---- packages/stickers/render.js ---- */
/*! chat-stickers · render.js — turn [[sticker:name]] (also [[表情:name]], [[sticker:12]]) in chat text into <img>.
 *
 *   StickerRender.config({ src: (name) => "/sticker/" + encodeURIComponent(name) });
 *   StickerRender.into(bubbleEl, messageText);     // escapes the text, swaps sticker tags for images,
 *                                                  // adds .st-only when the message is just one sticker
 * Zero dependencies. CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  var TAG = /\[\[(?:sticker|表情)[:：]\s*([^\[\]\n<>"'&]+?)\s*\]\]/g;
  var cfg = {
    src: function (name) { return "/sticker/" + encodeURIComponent(name); },
    tag: function (name) { return "[[sticker:" + name + "]]"; },
  };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* The sticker name if `value` is exactly one sticker tag, else null. */
  function parse(value) {
    var m = /^\s*\[\[(?:sticker|表情)[:：]\s*([^\[\]\n<>"'&]+?)\s*\]\]\s*$/.exec(String(value == null ? "" : value));
    return m ? m[1] : null;
  }

  /* Escaped HTML for a whole message, stickers swapped in. */
  function html(text) {
    var out = "", last = 0, s = String(text == null ? "" : text), m;
    TAG.lastIndex = 0;
    while ((m = TAG.exec(s))) {
      out += esc(s.slice(last, m.index)) + '<img class="st-inline" src="' + esc(cfg.src(m[1])) + '" alt="' + esc(m[1]) + '" loading="lazy" draggable="false">';
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }

  function into(el, text) {
    el.innerHTML = html(text);
    el.classList.toggle("st-only", parse(text) !== null);
    return el;
  }

  global.StickerRender = {
    config: function (c) { Object.assign(cfg, c || {}); return this; },
    parse: parse, html: html, into: into,
    src: function (name) { return cfg.src(name); },
    tag: function (name) { return cfg.tag(name); },
    TAG: TAG,
  };
})(typeof window !== "undefined" ? window : this);

/* ---- packages/stickers/panel.js ---- */
/*! chat-stickers · panel.js — the sticker drawer. Tap = send (or insert at the caret if you're mid-sentence);
 * add / edit / delete from the top bar; groups from "…" → "Manage groups". Built on core/drawer.js.
 *
 *   StickerPanel.init({ button: "#stickerBtn", input: "#input", send: (text) => mySend(text), api: "" })
 *
 * With `api`, it talks to packages/stickers/serve.py (or server/fastapi_example.py):
 *   GET {api}/stickers · POST {api}/stickers · PUT/DELETE {api}/stickers/<id> · GET {api}/sticker/<name> ·
 *   {api}/stickers/groups (list · add · rename · delete · reorder)
 * Without it, pass `store` (see StickerPanel.localStore) or `listUrl` for a read-only index.json.
 * Adding = upload a picture from this device + name / one-line description / groups (it can be in several).
 * Zero dependencies besides core/drawer.js. CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  var L10N = {
    zh: { title: "表情包", name: "名字", namePh: "比如：兔子晕倒", desc: "一句描述", descPh: "不看图也能认出它", image: "图片", group: "分组" },
    en: { title: "Stickers", name: "Name", namePh: "e.g. dizzy-bunny", desc: "Description", descPh: "so it can be found without seeing it", image: "Image", group: "Groups" },
  };

  var drawer = null, o = null, pickCb = null;

  function httpStore(api, headers) {
    var call = global.ChatDrawer.http(headers);
    return {
      list: function (q) { return call("GET", api + "/stickers" + (q ? "?q=" + encodeURIComponent(q) : "")).then(function (d) { return d.stickers || []; }); },
      add: function (v) { return call("POST", api + "/stickers", v); },
      edit: function (it, v) { return call("PUT", api + "/stickers/" + encodeURIComponent(it.id), { name: v.name, desc: v.desc, groups: v.groups }); },
      remove: function (it) { return call("DELETE", api + "/stickers/" + encodeURIComponent(it.id)); },
      groups: global.ChatDrawer.httpGroups(call, api + "/stickers"),
    };
  }

  /* Browser-only store seeded from an index.json; new pictures are kept as data URLs in localStorage. */
  function localStore(indexUrl, imageBase) {
    var s = global.ChatDrawer.localStore("sticker_shelf_v1", indexUrl,
      function (d) { return (d.stickers || []).map(function (x) { return Object.assign({ aliases: [] }, x, { src: imageBase + encodeURIComponent(x.file) }); }); },
      function (v, id) { return { id: id, name: v.name, desc: v.desc || "", aliases: [], groups: v.groups || [], src: v.data }; });
    var edit = s.edit;
    s.edit = function (it, v) {                       // renaming keeps the old name as an alias, like the server does
      var patch = { desc: v.desc };
      if ("groups" in v) patch.groups = v.groups;
      if (v.name && v.name !== it.name) { patch.name = v.name; patch.aliases = (it.aliases || []).concat(it.name).filter(function (a) { return a !== v.name; }); }
      return edit(it, patch);
    };
    s.add = (function (add) { return function (v) { if (!v.data) return Promise.reject(new Error("pick an image first")); return add(v); }; })(s.add);
    s.resolve = function (name) {                     // for StickerRender.config({ src })
      var m = null;
      try { m = JSON.parse(localStorage.getItem("sticker_shelf_v1") || "null"); } catch (_) {}
      var list = (m && m.items) || cache;
      var hit = list.find(function (x) { return x.name === name || String(x.id) === String(name) || (x.aliases || []).indexOf(name) >= 0; });
      return hit ? hit.src : "";
    };
    var cache = [];
    s._all().then(function (m) { cache = m.items; });
    return s;
  }

  function srcOf(it) {
    if (it.src) return it.src;
    return global.StickerRender ? global.StickerRender.src(it.name) : (o.api || "") + "/sticker/" + encodeURIComponent(it.name);
  }

  function tagOf(it) { return global.StickerRender ? global.StickerRender.tag(it.name) : "[[sticker:" + it.name + "]]"; }

  function onPick(it) {
    var tag = tagOf(it);
    if (pickCb) { var cb = pickCb; pickCb = null; drawer.close(); cb(tag, it); return; }
    var input = typeof o.input === "string" ? document.querySelector(o.input) : o.input;
    drawer.close();
    if (input && input.value.trim()) { global.ChatDrawer.insertAtCaret(input, tag); return; }   // mid-sentence: don't send, insert
    if (o.send) o.send(tag, it);
    else if (input) global.ChatDrawer.insertAtCaret(input, tag);
  }

  function init(options) {
    o = Object.assign({ button: null, anchor: null, input: null, send: null, api: null, headers: null, store: null, listUrl: null, lang: null, labels: null }, options || {});
    var lang = o.lang || (/^zh/i.test(navigator.language || "") ? "zh" : "en");
    var T = Object.assign({}, L10N[lang] || L10N.en, o.labels || {});
    var store = o.store || (o.api != null ? httpStore(o.api, o.headers) : null);
    if (!store && o.listUrl) store = { list: function () { return fetch(o.listUrl).then(function (r) { return r.json(); }).then(function (d) { return d.stickers || []; }); } };
    var itemFields = [                                // three things only: name, one line, groups
      { key: "name", label: T.name, placeholder: T.namePh, required: true, max: 40 },
      { key: "desc", label: T.desc, placeholder: T.descPh, max: 120 },
      { key: "groups", label: T.group, type: "groups" },
    ];
    var esc = global.ChatDrawer.esc;
    drawer = global.ChatDrawer.create({
      kind: "stickers", button: o.button, anchor: o.anchor, embed: o.embed, host: o.host, title: T.title, store: store, lang: lang, labels: o.drawerLabels,
      cell: function (it) { return '<img src="' + esc(srcOf(it)) + '" alt="' + esc(it.name) + '" loading="lazy" draggable="false">'; },
      cellTitle: function (it) {
        var g = drawer ? drawer.groupName(it) : "";
        return (it.id ? "#" + it.id + " · " : "") + (it.desc || it.name) + (g ? " · " + g : "");
      },
      fields: { add: [{ key: "data", label: T.image, type: "file", required: true }].concat(itemFields), edit: itemFields },
      onPick: onPick,
    });
    var btn = typeof o.button === "string" ? document.querySelector(o.button) : o.button;
    if (btn) btn.addEventListener("click", function () { pickCb = null; }, true);   // opened by hand = normal mode
    return api;
  }

  var api = {
    init: init,
    open: function () { drawer && drawer.open(); },
    close: function () { drawer && drawer.close(); },
    reload: function () { return drawer && drawer.reload(); },
    /* Open the drawer to pick one sticker for something else (e.g. a reaction); cb(tag, item). */
    pick: function (cb) { if (!drawer) return; pickCb = cb; drawer.open(); },
    cancelPick: function () { pickCb = null; },
    localStore: localStore,
    drawer: function () { return drawer; },
  };
  global.StickerPanel = api;
})(typeof window !== "undefined" ? window : this);

/* ---- packages/kaomoji/kaomoji.js ---- */
/*! chat-stickers · kaomoji.js — the kaomoji drawer, a separate little drawer next to the sticker one.
 * Tap = insert at the caret (never sends). Add / edit / delete from the top bar, same as stickers.
 * "…" → "Import from a web page": paste any kaomoji page, tick the ones you want, file them under groups.
 * Running it again on the same page (Sync) only offers what's new and never touches the ones you edited.
 * Groups are managed from "…" → "Manage groups"; an item stores `groups: [id, …]` and can be in several.
 *
 *   KaomojiBox.init({ button: "#kaomojiBtn", input: "#input", api: "" })
 *
 * With `api`: GET/POST {api}/kaomoji · PUT/DELETE {api}/kaomoji/<id> · {api}/kaomoji/groups · POST {api}/kaomoji/import/preview ·
 *             POST {api}/kaomoji/import · GET/DELETE {api}/kaomoji/sources
 * Without it: KaomojiBox.localStore(seedUrl) keeps everything in this browser (imports then need same-origin or CORS pages).
 * Built on core/drawer.js. CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  var L10N = {
    zh: { title: "颜文字", text: "颜文字", textPh: "૮₍ ｡• ̫ •｡ ₎ა", group: "分组",
      importWeb: "从网页导入", sources: "导入来源（同步 · 删除）", url: "网页地址", urlPh: "https://… 任意颜文字网页", fetch: "抓取",
      fetching: "在抓…", found: function (n, m) { return "新的 " + n + " 条（页面上一共认出 " + m + " 条，已有的灰掉了）"; }, nothingNew: "没有新的了",
      all: "全选", none: "全不选", keep: "存进来", sync: "同步", del: "删除", noSources: "还没从网页导入过",
      lastFetched: "上次", confirmDelSource: "删掉这个来源？已经存进来的颜文字不动。",
      had: "已有", dupe: "添加失败···ᴛ ω ᴛ已经有类似的啦" },
    en: { title: "Kaomoji", text: "Kaomoji", textPh: "૮₍ ｡• ̫ •｡ ₎ა", group: "Groups",
      importWeb: "Import from a web page", sources: "Import sources (sync · delete)", url: "Page URL", urlPh: "https://… any kaomoji page", fetch: "Fetch",
      fetching: "Fetching…", found: function (n, m) { return n + " new (" + m + " recognised on the page; ones you have are greyed out)"; }, nothingNew: "Nothing new",
      all: "All", none: "None", keep: "Keep these", sync: "Sync", del: "Delete", noSources: "Nothing imported yet",
      lastFetched: "last", confirmDelSource: "Delete this source? Kaomoji you already kept stay.",
      had: "have it", dupe: "Couldn't add···ᴛ ω ᴛ there's a similar one already" },
  };

  /* ── dedup key (same as sticker.py's kaomoji_key): NFKC → drop whitespace, zero-width chars and
        variation selectors → full-width punctuation to half-width. Exact match only, no fuzzy similarity. ── */
  function keyOf(t) {
    return String(t == null ? "" : t).normalize("NFKC")
      .replace(/[\s\x1c-\x1f\x85​-‍﻿︎️]/g, "")
      .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  }

  /* ── the generic rule (same as sticker.py's looks_like_kaomoji) ── */
  var CJK = /[㐀-䶿一-鿿가-힯]/;
  var WORD = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-׿؀-ۿऀ-ॿ฀-๿Ḁ-ỿ぀-ヿＡ-Ｚａ-ｚｦ-ﾟ]/;
  var PROSE = "…—–“”‘’«»„";
  function looksLikeKaomoji(t) {
    t = t.trim();
    var chars = Array.from(t);
    if (chars.length < 2 || chars.length > 40 || t.indexOf("://") >= 0 || (t.indexOf("@") >= 0 && t.indexOf(".") >= 0)) return false;
    var wide = chars.filter(function (c) { return c.codePointAt(0) > 127; });
    if (!wide.length || wide.every(function (c) { return PROSE.indexOf(c) >= 0; }) || new Set(t.replace(/ /g, "")).size < 2) return false;
    var sym = 0, run = 0, cjk = 0;
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i], isCjk = CJK.test(c);
      if (isCjk) cjk++;
      if (/\p{L}/u.test(c) && WORD.test(c)) { if (++run >= 4) return false; } else run = 0;
      if (/[\p{P}\p{S}\p{M}]/u.test(c) || (c.codePointAt(0) > 127 && !isCjk && !/\p{Z}/u.test(c))) sym++;
    }
    return sym >= 2 && cjk < 3 && !/\d{3,}/.test(t);
  }
  function extract(html, limit) {
    limit = limit || 2000;
    var doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, noscript, svg, template").forEach(function (n) { n.remove(); });
    var blocks = [];
    doc.querySelectorAll("[data-kaomoji]").forEach(function (n) { blocks.push(n.getAttribute("data-kaomoji") || n.textContent); });
    doc.querySelectorAll("li, td, th, code, button, dd, dt, option").forEach(function (n) { blocks.push(n.textContent); });
    doc.querySelectorAll("p, div, span, pre, h1, h2, h3, h4, a").forEach(function (n) { if (!n.children.length) blocks.push(n.textContent); });
    var out = [], seen = new Set();
    for (var b = 0; b < blocks.length && out.length < limit; b++) {
      String(blocks[b] || "").split(/\n|\t| {2,}|　{2,}/).forEach(function (p) {
        p = p.split(/\s+/).join(" ").trim();
        if (p && !seen.has(p) && looksLikeKaomoji(p) && out.length < limit) { seen.add(p); out.push(p); }
      });
    }
    return out;
  }

  function dupe(err) {                               // 409 from the server → err.duplicate = the one already there
    if (err && err.data && err.data.duplicate) err.duplicate = err.data.duplicate;
    throw err;
  }

  function httpStore(api, headers) {
    var call = global.ChatDrawer.http(headers);
    return {
      list: function () { return call("GET", api + "/kaomoji").then(function (d) { return d.kaomoji || []; }); },
      add: function (v) { return call("POST", api + "/kaomoji", { text: v.text, groups: v.groups }).catch(dupe); },
      edit: function (it, v) { return call("PUT", api + "/kaomoji/" + it.id, { text: v.text, groups: v.groups }).catch(dupe); },
      remove: function (it) { return call("DELETE", api + "/kaomoji/" + it.id); },
      groups: global.ChatDrawer.httpGroups(call, api + "/kaomoji"),
      preview: function (url) { return call("POST", api + "/kaomoji/import/preview", { url: url }); },
      commit: function (p) { return call("POST", api + "/kaomoji/import", p); },
      sources: function () { return call("GET", api + "/kaomoji/sources").then(function (d) { return d.sources || []; }); },
      removeSource: function (url) { return call("DELETE", api + "/kaomoji/sources?url=" + encodeURIComponent(url)); },
    };
  }

  function localStore(seedUrl) {
    var SRC = "kaomoji_sources_v1";
    var s = global.ChatDrawer.localStore("kaomoji_box_v1", seedUrl,
      function (d) { return (d.kaomoji || []).map(function (k) { return Object.assign({}, k, { key: keyOf(k.text) }); }); },
      function (v, id) { return { id: id, text: v.text, key: keyOf(v.text), groups: v.groups || [] }; });
    function srcs() { try { return JSON.parse(localStorage.getItem(SRC) || "[]"); } catch (_) { return []; } }
    function saveSrcs(l) { try { localStorage.setItem(SRC, JSON.stringify(l)); } catch (_) {} }
    function clash(m, text, but) {
      var k = keyOf(text), hit = m.items.find(function (x) { return x !== but && (x.key || keyOf(x.text)) === k; });
      if (!hit) return null;
      var e = new Error("duplicate"); e.duplicate = hit; return e;
    }
    var add = s.add, edit = s.edit;
    s.add = function (v) { return s._all().then(function (m) { var e = clash(m, v.text); if (e) throw e; return add(v); }); };
    s.edit = function (it, v) {
      return s._all().then(function (m) {
        var self = m.items.find(function (x) { return x.id === it.id; });
        var e = clash(m, v.text, self); if (e) throw e;
        var patch = { text: v.text, key: keyOf(v.text) };
        if ("groups" in v) patch.groups = v.groups;
        return edit(it, patch);
      });
    };
    s.preview = function (url) {
      return fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .catch(function (e) { throw new Error("This page can't be read from the browser (" + (e.message || e) + "). Connect the reference server to import it."); })
        .then(function (html) {
          return s._all().then(function (m) {
            var have = new Map(m.items.map(function (k) { return [k.key || keyOf(k.text), k]; }));
            var src = srcs().find(function (x) { return x.url === url; });
            var seen = new Set((src ? src.seen : []).map(keyOf));
            var found = extract(html), keys = new Set(), out = [];
            found.forEach(function (t) {
              var k = keyOf(t);
              if (keys.has(k) || seen.has(k)) return;          // same key twice in one batch: keep the first
              keys.add(k);
              var c = { text: t, key: k, exists: have.has(k) };
              if (c.exists) c.existing_id = have.get(k).id;
              out.push(c);
            });
            return { url: url, fetched_at: new Date().toISOString(), found: found.length,
              new: out.filter(function (c) { return !c.exists; }).length, candidates: out };
          });
        });
    };
    s.commit = function (p) {
      return s._all().then(function (m) {
        var have = new Set(m.items.map(function (k) { return k.key || keyOf(k.text); }));
        (p.items || []).forEach(function (it) {
          var k = keyOf(it.text);
          if (have.has(k)) return;
          m.items.push({ id: m.next++, text: it.text, key: k, groups: it.groups || [], source: { url: p.url, fetched_at: p.fetched_at } });
          have.add(k);
        });
        s._persist();
        var l = srcs(), src = l.find(function (x) { return x.url === p.url; });
        if (!src) { src = { url: p.url, added_at: p.fetched_at, seen: [] }; l.push(src); }
        src.last_fetched_at = p.fetched_at;
        src.seen = Array.from(new Set(src.seen.map(keyOf).concat((p.offered || []).map(keyOf))));
        saveSrcs(l);
      });
    };
    s.sources = function () { return Promise.resolve(srcs()); };
    s.removeSource = function (url) { saveSrcs(srcs().filter(function (x) { return x.url !== url; })); return Promise.resolve(); };
    return s;
  }

  var drawer = null, o = null, T = null, store = null;

  function el(html) { var d = document.createElement("div"); d.innerHTML = html; return d; }

  /* Step 1: URL. Step 2: tick candidates, pick groups (any number), keep. */
  function importView(prefill) {
    var esc = global.ChatDrawer.esc;
    var node = el('<form class="cd-form kb-import"><label class="cd-field"><span>' + esc(T.url) + '</span><input type="url" name="url" required placeholder="' + esc(T.urlPh) + '" value="' + esc(prefill || "") + '"></label>' +
      '<p class="cd-err" hidden></p><div class="cd-row"><button type="submit" class="cd-btn cd-primary">' + esc(T.fetch) + '</button><button type="button" class="cd-btn" data-cd="back">' + esc(drawer.labels.cancel) + "</button></div></form>");
    var f = node.firstChild;
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = f.querySelector(".cd-primary"), err = f.querySelector(".cd-err");
      btn.disabled = true; btn.textContent = T.fetching; err.hidden = true;
      Promise.resolve(store.preview(f.elements.url.value.trim()))
        .then(function (pv) { pickView(pv); })
        .catch(function (x) { err.textContent = String((x && x.message) || x); err.hidden = false; })
        .then(function () { btn.disabled = false; btn.textContent = T.fetch; });
    });
    drawer.showView(T.importWeb, node);
    if (prefill) f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event("submit", { cancelable: true }));
  }

  function pickView(pv) {
    var esc = global.ChatDrawer.esc;
    var c = (pv.candidates || []).map(function (x) { return typeof x === "string" ? { text: x, exists: false } : x; });
    var fresh = c.filter(function (x) { return !x.exists; }).length;
    var node = el('<form class="cd-form kb-pick">' +
      '<p class="kb-found">' + esc(fresh ? T.found(fresh, pv.found) : T.nothingNew) + "</p>" +
      (c.length ? (fresh ? '<div class="kb-tools"><button type="button" class="cd-btn cd-small" data-kb="all">' + esc(T.all) + '</button><button type="button" class="cd-btn cd-small" data-kb="none">' + esc(T.none) + "</button></div>" : "") +
        '<div class="kb-list">' + c.map(function (x, i) {
          return x.exists
            ? '<label class="kb-cand kb-had" title="#' + esc(x.existing_id) + '"><input type="checkbox" disabled><span>' + esc(x.text) + '</span><em class="kb-had-t">' + esc(T.had) + "</em></label>"
            : '<label class="kb-cand"><input type="checkbox" name="c" value="' + i + '" checked><span>' + esc(x.text) + "</span></label>";
        }).join("") + "</div>" +
        (fresh ? '<div class="cd-field"><span>' + esc(T.group) + '</span><div data-pills></div></div>' : "") : "") +
      '<p class="cd-err" hidden></p><div class="cd-row">' + (fresh ? '<button type="submit" class="cd-btn cd-primary">' + esc(T.keep) + "</button>" : "") +
      '<button type="button" class="cd-btn" data-cd="back">' + esc(drawer.labels.back) + "</button></div></form>");
    var f = node.firstChild;
    var picker = drawer.pills(null), slot = f.querySelector("[data-pills]");
    if (slot) slot.replaceWith(picker.el);
    f.addEventListener("click", function (e) {
      var b = e.target.closest("[data-kb]");
      if (b) f.querySelectorAll('input[name="c"]').forEach(function (x) { x.checked = b.dataset.kb === "all"; });
    });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var sb = f.querySelector(".cd-primary"); if (sb) sb.disabled = true;
      drawer.ensureGroups(picker.value()).then(function (groups) {
        var items = Array.from(f.querySelectorAll('input[name="c"]:checked')).map(function (x) { return { text: c[+x.value].text, groups: groups }; });
        return store.commit({ url: pv.url, fetched_at: pv.fetched_at, items: items, offered: c.map(function (x) { return x.text; }) });
      })
        .then(function () { drawer.back(); return drawer.reload(); })
        .catch(function (x) { var p = f.querySelector(".cd-err"); p.textContent = String((x && x.message) || x); p.hidden = false; })
        .then(function () { if (sb) sb.disabled = false; });
    });
    drawer.showView(T.importWeb, node);
  }

  function sourcesView() {
    var esc = global.ChatDrawer.esc;
    Promise.resolve(store.sources()).then(function (list) {
      var node = el('<div class="kb-sources">' + (list.length ? list.map(function (s) {
        return '<div class="kb-src"><div class="kb-src-t"><span class="kb-url">' + esc(s.url) + '</span><span class="kb-when">' + esc(T.lastFetched + " " + String(s.last_fetched_at || "").slice(0, 16).replace("T", " ")) + "</span></div>" +
          '<button type="button" class="cd-btn cd-small" data-sync="' + esc(s.url) + '">' + esc(T.sync) + '</button><button type="button" class="cd-btn cd-small cd-danger" data-rm="' + esc(s.url) + '">' + esc(T.del) + "</button></div>";
      }).join("") : '<p class="cd-note">' + esc(T.noSources) + "</p>") + "</div>");
      node.addEventListener("click", function (e) {
        var sy = e.target.closest("[data-sync]"), rm = e.target.closest("[data-rm]");
        if (sy) importView(sy.dataset.sync);
        if (rm && confirm(T.confirmDelSource)) Promise.resolve(store.removeSource(rm.dataset.rm)).then(sourcesView);
      });
      drawer.showView(T.sources, node);
    });
  }

  function init(options) {
    o = Object.assign({ button: null, anchor: null, input: null, api: null, headers: null, store: null, lang: null, labels: null, onPick: null }, options || {});
    var lang = o.lang || (/^zh/i.test(navigator.language || "") ? "zh" : "en");
    T = Object.assign({}, L10N[lang] || L10N.en, o.labels || {});
    store = o.store || (o.api != null ? httpStore(o.api, o.headers) : localStore(o.seedUrl || null));
    var fields = [
      { key: "text", label: T.text, placeholder: T.textPh, required: true, max: 80 },
      { key: "groups", label: T.group, type: "groups" },
    ];
    drawer = global.ChatDrawer.create({
      kind: "kaomoji", button: o.button, anchor: o.anchor, embed: o.embed, host: o.host, title: T.title, store: store, lang: lang, labels: o.drawerLabels,
      cell: function (it) { return '<span class="kb-text">' + global.ChatDrawer.esc(it.text) + "</span>"; },
      cellTitle: function (it) { var g = drawer ? drawer.groupName(it) : ""; return it.text + (g ? " · " + g : ""); },
      nameOf: function (it) { return it.text; },
      fields: { add: fields, edit: fields },
      onSubmitError: function (err, d) {                      // same key already there: say so, jump to it
        if (!err || !err.duplicate) return false;
        d.flash(err.duplicate.id, T.dupe);
        return true;
      },
      menu: store.preview ? [{ id: "import", label: T.importWeb, onClick: function () { importView(""); } }, { id: "sources", label: T.sources, onClick: sourcesView }] : [],
      onPick: function (it) {
        if (o.onPick) return o.onPick(it.text, it);
        var input = typeof o.input === "string" ? document.querySelector(o.input) : o.input;
        global.ChatDrawer.insertAtCaret(input, it.text);        // insert, never send
      },
    });
    return api;
  }

  var api = {
    init: init,
    open: function () { drawer && drawer.open(); },
    close: function () { drawer && drawer.close(); },
    reload: function () { return drawer && drawer.reload(); },
    localStore: localStore, extract: extract, looksLikeKaomoji: looksLikeKaomoji, key: keyOf,
    drawer: function () { return drawer; },
  };
  global.KaomojiBox = api;
})(typeof window !== "undefined" ? window : this);

/* ---- packages/core/panel.js ---- */
/*! chat-stickers · panel.js — one entry button, one drawer, two tabs: 贴纸 | 颜文字 (stickers | kaomoji).
 *
 *   ChatStickers.panel({ button: "#drawerBtn", anchor: "#composer", input: "#input", send: (text) => mySend(text),
 *                        tabs: ["stickers", "kaomoji"], remember: true, api: "/chat-stickers" })
 *
 * A segmented switch sits on top; each tab holds the full drawer (search + add + more) built by
 * stickers/panel.js and kaomoji/kaomoji.js. `remember` keeps the last tab in localStorage.
 * The old way — one button per drawer — still works: call StickerPanel.init / KaomojiBox.init with their own buttons.
 * CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  var I = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>"; };
  var TABS = {
    stickers: { icon: I('<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>'), zh: "贴纸", en: "Stickers" },
    kaomoji: { icon: I('<path d="M6 4.5C3.8 6.4 3 9 3 12s.8 5.6 3 7.5"/><path d="M18 4.5c2.2 1.9 3 4.5 3 7.5s-.8 5.6-3 7.5"/><path d="M8.6 10.2h.01M15.4 10.2h.01"/><path d="M10 14.2c1.2 1 2.8 1 4 0"/>'), zh: "颜文字", en: "Kaomoji" },
  };
  var KEY = "chat_stickers_tab_v1";

  function $(x) { return typeof x === "string" ? document.querySelector(x) : x; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function panel(options) {
    var o = Object.assign({
      button: null, anchor: null, input: null, send: null, api: null, headers: null, lang: null,
      tabs: ["stickers", "kaomoji"], remember: true, labels: null,
      stickers: {}, kaomoji: {},          // extra options for each tab (store, seedUrl, labels…)
    }, options || {});
    var lang = o.lang || (/^zh/i.test(navigator.language || "") ? "zh" : "en");
    var tabs = (o.tabs || []).filter(function (t) {
      return (t === "stickers" && global.StickerPanel) || (t === "kaomoji" && global.KaomojiBox);
    });
    if (!tabs.length) throw new Error("ChatStickers.panel: no tabs (load stickers/panel.js and/or kaomoji/kaomoji.js)");
    var btn = $(o.button), anchor = $(o.anchor) || (btn && (btn.closest("form") || btn.parentElement));

    var root = document.createElement("div");
    root.className = "cs-panel";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.innerHTML =
      (tabs.length > 1 ? '<div class="cs-seg" role="tablist">' + tabs.map(function (t) {
        var name = (o.labels && o.labels[t]) || TABS[t][lang] || TABS[t].en;
        return '<button type="button" class="cs-seg-b" role="tab" data-tab="' + t + '" aria-selected="false">' + TABS[t].icon + "<span>" + esc(name) + "</span></button>";
      }).join("") + "</div>" : "") +
      tabs.map(function (t) { return '<div class="cs-pane" data-pane="' + t + '" role="tabpanel" hidden></div>'; }).join("");
    document.body.appendChild(root);

    var current = null, drawers = {};
    var host = {
      show: function (kind) { select(kind); open(); },
      hide: function () { close(); },
    };

    function saved() { try { return localStorage.getItem(KEY); } catch (_) { return null; } }
    function select(kind) {
      if (tabs.indexOf(kind) < 0) kind = tabs[0];
      if (current && current !== kind && drawers[current]) drawers[current].reset();
      current = kind;
      root.querySelectorAll(".cs-seg-b").forEach(function (b) {
        var on = b.dataset.tab === kind;
        b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false");
      });
      root.querySelectorAll(".cs-pane").forEach(function (p) { p.hidden = p.dataset.pane !== kind; });
      if (o.remember) { try { localStorage.setItem(KEY, kind); } catch (_) {} }
      var d = drawers[kind];
      if (d && !d.loaded()) d.reload();
    }
    function open() {
      if (!root.hidden) return;
      (global.ChatDrawer.all || []).forEach(function (d) { d.close(); });   // standalone drawers, if any
      global.ChatDrawer.placeAbove(root, anchor);
      root.hidden = false;
      requestAnimationFrame(function () { root.classList.add("open"); });
      if (btn) btn.setAttribute("aria-expanded", "true");
      if (!current) select((o.remember && saved()) || tabs[0]);
      else if (drawers[current] && !drawers[current].loaded()) drawers[current].reload();
    }
    function close() {
      if (root.hidden) return;
      Object.keys(drawers).forEach(function (k) { drawers[k].reset(); });
      root.classList.remove("open");
      root.hidden = true;
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
    function toggle() { if (root.hidden) open(); else close(); }

    var common = { lang: lang, api: o.api, headers: o.headers, input: o.input, host: host };
    if (tabs.indexOf("stickers") >= 0) {
      global.StickerPanel.init(Object.assign({}, common, { send: o.send }, o.stickers, { button: null, embed: root.querySelector('[data-pane="stickers"]') }));
      drawers.stickers = global.StickerPanel.drawer();
    }
    if (tabs.indexOf("kaomoji") >= 0) {
      global.KaomojiBox.init(Object.assign({}, common, o.kaomoji, { button: null, embed: root.querySelector('[data-pane="kaomoji"]') }));
      drawers.kaomoji = global.KaomojiBox.drawer();
    }

    root.addEventListener("click", function (e) {
      var b = e.target.closest(".cs-seg-b");
      if (b) select(b.dataset.tab);
    });
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (global.StickerPanel && global.StickerPanel.cancelPick) global.StickerPanel.cancelPick();   // opened by hand = normal mode
        toggle();
      });
    }
    document.addEventListener("pointerdown", function (e) {
      if (root.hidden || root.contains(e.target) || (btn && btn.contains(e.target))) return;
      close();
    });
    window.addEventListener("keydown", function (e) { if (e.key === "Escape" && !root.hidden) close(); });
    window.addEventListener("resize", function () { if (!root.hidden) global.ChatDrawer.placeAbove(root, anchor); });

    return { root: root, open: open, close: close, toggle: toggle, select: select, current: function () { return current; }, drawers: drawers };
  }

  global.ChatStickers = Object.assign(global.ChatStickers || {}, { panel: panel });
})(typeof window !== "undefined" ? window : this);

/* ---- packages/core/index.js ---- */
/*! chat-stickers · one entry for all of it — long-press where you want it to stick:
 *    empty chat area → the background (emoji-bg)
 *    a bubble        → that message (reactions: 2 × 4 grid, "+" opens your stickers)
 *    an image        → that picture's message (same grid, or your own onMedia)
 *  plus one drawer next to the composer with two tabs: 贴纸 stickers (send) | 颜文字 kaomoji (insert).
 *
 *   ChatStickers.init({
 *     container: "#messages", me: { id: "a", name: "A", emoji: "🐰" }, others: [{ id: "b", name: "B", emoji: "🦊" }],
 *     api: "/chat-stickers",                         // one base URL for the reference server, or leave out and pass stores
 *     panel: { button: "#drawerBtn", anchor: "#composer", input: "#input", send: (text) => send(text) },
 *   })
 * Any of background / reactions / panel can be `false`; `panel.tabs` picks ["stickers", "kaomoji"] or just one.
 * Old style — a separate button per drawer — still works: leave `panel` out and give `stickers.button` / `kaomoji.button`. CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  function $(x) { return typeof x === "string" ? document.querySelector(x) : x; }
  function cssEsc(s) { return global.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&"); }

  /* reactions over HTTP + SSE: POST {api}/react {id, value} → {id, reactions}; events {type:"reaction", id, reactions} */
  function httpReactions(api, headers, events) {
    var call = global.ChatDrawer ? global.ChatDrawer.http(headers) : null;
    return {
      react: function (id, value) { return call("POST", api + "/react", { id: id, value: value }).then(function (d) { return d.reactions; }); },
      subscribe: function (cb) {
        if (!events || typeof EventSource === "undefined") return;
        new EventSource(events).addEventListener("message", function (ev) {
          try { var d = JSON.parse(ev.data); if (d && d.type === "reaction") cb(d.id, d.reactions || {}); } catch (_) {}
        });
      },
    };
  }

  function init(opts) {
    var o = Object.assign({
      container: null, me: { id: "me", name: "", emoji: "🐰" }, others: [], bubble: ".bubble", media: "img, video, .media",
      api: null, headers: null, events: undefined, longPressMs: 500, lang: null,
      background: {}, reactions: {}, panel: null, stickers: {}, kaomoji: {}, onMedia: null,
    }, opts || {});
    var api = o.api;
    var events = o.events !== undefined ? o.events : (api != null ? api + "/events" : null);
    var box = $(o.container);
    var out = { press: null, reactions: {} };

    if (global.StickerRender && api != null) global.StickerRender.config({ src: function (n) { return api + "/sticker/" + encodeURIComponent(n); } });

    if (o.background && global.EmojiBg) {
      global.EmojiBg.init(Object.assign({
        me: o.me, others: o.others, lang: o.lang, headers: o.headers,
        endpoint: api != null ? api + "/chat-bg" : null, events: events,
      }, o.background, { longPress: false }));
    }

    var rx = o.reactions && global.Reactions ? o.reactions : null;
    if (rx) {
      var store = rx.store || (api != null ? httpReactions(api, o.headers, events) : null);
      var state = out.reactions;
      var bubbleOf = rx.bubbleOf || function (id) { return box && box.querySelector('[data-id="' + cssEsc(id) + '"] ' + o.bubble + ', ' + o.bubble + '[data-id="' + cssEsc(id) + '"]'); };
      var paintOne = function (id) { var b = bubbleOf(id); if (b) global.Reactions.paint(b, Object.values(state[id] || {})); };
      var apply = function (id, map) { state[id] = map || {}; paintOne(id); };
      global.Reactions.init(Object.assign({ lang: o.lang, bubble: o.bubble, media: o.media }, rx, {
        container: null,                                   // the shared press below does the long-press
        mine: rx.mine || function (id) { var v = state[id] && state[id][o.me.id]; return v ? [v] : []; },
        onReact: function (id, value, el) {
          var map = Object.assign({}, state[id] || {}); map[o.me.id] = value; apply(id, map);   // optimistic
          if (rx.onReact) rx.onReact(id, value, el);
          if (store) Promise.resolve(store.react(id, value)).then(function (m) { if (m) apply(id, m); }).catch(function () {});
        },
      }));
      if (store && store.subscribe) store.subscribe(apply);
      out.setReactions = apply;
      out.repaintReactions = function () { Object.keys(state).forEach(paintOne); };
    }

    if (box && global.ChatPress) {
      out.press = global.ChatPress.attach({
        container: box, bubble: o.bubble, media: o.media, longPressMs: o.longPressMs,
        onBackground: o.background && global.EmojiBg ? global.EmojiBg.open : null,
        onBubble: rx ? global.Reactions.open : null,
        onMedia: o.onMedia || (rx ? global.Reactions.open : null),
      });
    }

    if (o.panel && global.ChatStickers.panel) {
      // default: one button, one drawer, a 贴纸 | 颜文字 switch on top
      out.panel = global.ChatStickers.panel(Object.assign({ lang: o.lang, api: api, headers: o.headers,
        stickers: o.stickers || {}, kaomoji: o.kaomoji || {},
        tabs: [o.stickers !== false && "stickers", o.kaomoji !== false && "kaomoji"].filter(Boolean) }, o.panel));
    } else {
      // optional: each drawer on its own button
      if (o.stickers && o.stickers.button && global.StickerPanel) global.StickerPanel.init(Object.assign({ lang: o.lang, api: api, headers: o.headers }, o.stickers));
      if (o.kaomoji && o.kaomoji.button && global.KaomojiBox) global.KaomojiBox.init(Object.assign({ lang: o.lang, api: api, headers: o.headers }, o.kaomoji));
    }
    return out;
  }

  global.ChatStickers = Object.assign(global.ChatStickers || {}, { init: init, version: "0.1.0" });
})(typeof window !== "undefined" ? window : this);
