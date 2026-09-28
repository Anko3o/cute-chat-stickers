/*! chat-stickers · drawer.js — the little drawer both the sticker shelf and the kaomoji box are built on.
 *
 * Top bar = search + add (+) + more (…). The grid only picks. Add / edit / delete all live in the top bar:
 * "…" → "Organize" (or long-press / right-click a cell) selects a cell, and the top bar turns into
 * "Edit · Delete". No per-cell buttons, no emoji icons — every icon is a 1.8-stroke line SVG.
 *
 *   ChatDrawer.create({ button, anchor, title, store: { list, add, edit, remove }, cell, onPick, fields })
 *
 * Needs core/press.js for long-press on cells (right-click works without it). Zero dependencies. MIT (placeholder).
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
    trash: I('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  };

  var L10N = {
    zh: { search: "搜索", add: "添加", more: "更多", organize: "整理（选一格修改或删除）", edit: "修改", del: "删除", cancel: "取消", save: "保存",
      back: "返回", loading: "在翻抽屉…", failed: "没读到，等会儿再试", empty: "还空着——点右上角的 ＋ 加第一个", noHit: "没搜到",
      pickOne: "点一格来修改或删除", confirmDel: function (n) { return "删掉「" + n + "」？"; } },
    en: { search: "Search", add: "Add", more: "More", organize: "Organize (pick one to edit or delete)", edit: "Edit", del: "Delete", cancel: "Cancel", save: "Save",
      back: "Back", loading: "Loading…", failed: "Couldn't load, try again later", empty: "Empty — tap + at the top to add the first one", noHit: "No match",
      pickOne: "Tap one to edit or delete", confirmDel: function (n) { return "Delete \"" + n + "\"?"; } },
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
    }, options || {});
    var L = Object.assign({}, L10N[lang(o)] || L10N.en, o.labels || {});
    var btn = $(o.button), anchor = $(o.anchor) || (btn && (btn.closest("form") || btn.parentElement));
    var items = null, loading = false, selecting = false, selected = null, q = "", mode = "grid", press = null;
    function nameOf(it) { return o.nameOf ? o.nameOf(it) : (it.name || it.text || ""); }

    var root = document.createElement("div");
    root.className = "cd-drawer cd-" + o.kind;
    root.hidden = true;
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
    document.body.appendChild(root);
    var grid = root.querySelector(".cd-grid"), view = root.querySelector(".cd-view"), menu = root.querySelector(".cd-menu");
    var input = root.querySelector(".cd-search input");

    function place() {
      if (!anchor) return;
      var r = anchor.getBoundingClientRect(), vw = window.innerWidth;
      var w = Math.min(520, vw - 20, Math.max(300, r.width));
      var left = Math.max(10, Math.min(vw - w - 10, r.left));
      root.style.left = left + "px";
      root.style.width = w + "px";
      root.style.bottom = Math.max(10, window.innerHeight - r.top + 8) + "px";
    }

    function matches(it) {
      if (!q) return true;
      var hay = o.searchText ? o.searchText(it) : [it.name, it.desc, it.text, it.group].concat(it.tags || [], it.aliases || []).join(" ");
      return String(hay).toLowerCase().indexOf(q.toLowerCase()) >= 0;
    }

    function paint() {
      if (mode !== "grid") return;
      if (loading && !items) { grid.innerHTML = '<p class="cd-note">' + esc(L.loading) + "</p>"; return; }
      if (!items) { grid.innerHTML = '<p class="cd-note">' + esc(L.failed) + "</p>"; return; }
      var list = items.filter(matches);
      if (!items.length) { grid.innerHTML = '<p class="cd-note">' + esc(L.empty) + "</p>"; return; }
      if (!list.length) { grid.innerHTML = '<p class="cd-note">' + esc(L.noHit) + "</p>"; return; }
      var html = [], lastGroup = null;
      list.forEach(function (it) {
        var g = o.groupOf ? (o.groupOf(it) || "") : null;
        if (g !== null && g !== lastGroup) { html.push('<h3 class="cd-group">' + esc(g || "·") + "</h3>"); lastGroup = g; }
        var on = selected && selected.id === it.id;
        html.push('<button type="button" class="cd-cell' + (on ? " on" : "") + '" data-id="' + esc(it.id) + '" title="' + esc(o.cellTitle ? o.cellTitle(it) : nameOf(it)) + '">' + o.cell(it) + "</button>");
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
      return Promise.resolve(o.store.list("")).then(function (list) { items = list || []; })
        .catch(function () { items = null; })
        .then(function () { loading = false; paint(); });
    }

    function select(it) { selecting = true; selected = it || null; paintBars(); paint(); }
    function unselect() { selecting = false; selected = null; paintBars(); paint(); }

    function showView(title, node) {
      mode = "view";
      closeMenu();
      root.querySelector(".cd-view-t").textContent = title || "";
      view.innerHTML = "";
      view.appendChild(node);
      grid.hidden = true; view.hidden = false;
      paintBars();
      var f = view.querySelector("input[type=text], input[type=url], textarea");
      if (f) setTimeout(function () { f.focus(); }, 30);
    }
    function back() { mode = "grid"; view.hidden = true; grid.hidden = false; view.innerHTML = ""; paintBars(); paint(); }

    /* A tiny form from field specs: {key, label, type: text|textarea|tags|group|file, placeholder, required, max} */
    function form(fields, initial, submitLabel, onSubmit) {
      var f = document.createElement("form");
      f.className = "cd-form";
      var groups = items ? Array.from(new Set(items.map(function (it) { return o.groupOf ? o.groupOf(it) : ""; }).filter(Boolean))) : [];
      var dl = "cd-dl-" + Math.random().toString(36).slice(2);
      f.innerHTML = fields.map(function (fd) {
        var v = initial ? initial[fd.key] : "";
        if (fd.type === "tags" && Array.isArray(v)) v = v.join(", ");
        var ph = ' placeholder="' + esc(fd.placeholder || "") + '"', req = fd.required ? " required" : "", mx = fd.max ? ' maxlength="' + fd.max + '"' : "";
        var ctl;
        if (fd.type === "file") ctl = '<input type="file" name="' + fd.key + '" accept="' + esc(fd.accept || "image/png,image/jpeg,image/gif,image/webp") + '"' + req + '><img class="cd-preview" alt="" hidden>';
        else if (fd.type === "textarea") ctl = '<textarea name="' + fd.key + '" rows="2"' + ph + req + mx + ">" + esc(v) + "</textarea>";
        else ctl = '<input type="text" name="' + fd.key + '" value="' + esc(v) + '"' + ph + req + mx + (fd.type === "group" ? ' list="' + dl + '"' : "") + ">";
        return '<label class="cd-field"><span>' + esc(fd.label) + "</span>" + ctl + "</label>";
      }).join("") +
        '<datalist id="' + dl + '">' + groups.map(function (g) { return '<option value="' + esc(g) + '">'; }).join("") + "</datalist>" +
        '<p class="cd-err" hidden></p>' +
        '<div class="cd-row"><button type="submit" class="cd-btn cd-primary">' + esc(submitLabel) + '</button><button type="button" class="cd-btn" data-cd="back">' + esc(L.cancel) + "</button></div>";
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
          else { var v = f.elements[fd.key].value.trim(); out[fd.key] = fd.type === "tags" ? v.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean) : v; }
        });
        var sb = f.querySelector(".cd-primary"); sb.disabled = true;
        Promise.resolve(onSubmit(out)).then(function () { back(); unselect(); return reload(); })
          .catch(function (err) {
            if (o.onSubmitError && o.onSubmitError(err, api)) return;
            var p = f.querySelector(".cd-err"); p.textContent = String((err && err.message) || err); p.hidden = false;
          })
          .then(function () { sb.disabled = false; });
      });
      return f;
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
      showView(L.edit + " · " + nameOf(it), form(o.fields.edit, it, L.save, function (v) { return o.store.edit(it, v); }));
    }
    function doDelete() {
      if (!selected || !confirm(L.confirmDel(nameOf(selected)))) return;
      Promise.resolve(o.store.remove(selected)).then(function () { unselect(); return reload(); })
        .catch(function (err) { alert(String((err && err.message) || err)); });
    }

    function openMenu() {
      var entries = [{ id: "organize", label: L.organize }].concat(o.menu || []);
      menu.innerHTML = entries.map(function (m) { return '<button type="button" role="menuitem" class="cd-mi" data-mi="' + esc(m.id) + '">' + esc(m.label) + "</button>"; }).join("");
      menu.hidden = false;
    }
    function closeMenu() { menu.hidden = true; }

    root.addEventListener("click", function (e) {
      var mi = e.target.closest(".cd-mi");
      if (mi) {
        closeMenu();
        if (mi.dataset.mi === "organize") return select(null);
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

    function open() {
      all.forEach(function (d) { if (d !== api) d.close(); });
      place();
      root.hidden = false;
      requestAnimationFrame(function () { root.classList.add("open"); });
      if (btn) btn.setAttribute("aria-expanded", "true");
      if (items === null && !loading) reload();
    }
    function close() {
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
    document.addEventListener("pointerdown", function (e) {
      if (root.hidden || root.contains(e.target) || (btn && btn.contains(e.target))) return;
      close();
    });
    window.addEventListener("keydown", function (e) { if (e.key === "Escape" && !root.hidden) close(); });
    window.addEventListener("resize", function () { if (!root.hidden) place(); });

    var api = {
      root: root, open: open, close: close, toggle: toggle, reload: reload, paint: paint,
      showView: showView, back: back, form: form, select: select, unselect: unselect, flash: flash,
      items: function () { return items || []; }, labels: L, esc: esc, icons: ICON,
    };
    all.push(api);
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

  /* Store backed by localStorage, seeded from a JSON file — for demos and single-device use. */
  function localStore(key, seedUrl, pickList, makeItem) {
    var mem = null;
    function load() {
      if (mem) return Promise.resolve(mem);
      try { var s = JSON.parse(localStorage.getItem(key) || "null"); if (s) { mem = s; return Promise.resolve(mem); } } catch (_) {}
      return (seedUrl ? fetch(seedUrl).then(function (r) { return r.json(); }).catch(function () { return {}; }) : Promise.resolve({}))
        .then(function (d) { var list = pickList(d) || []; mem = { items: list, next: list.reduce(function (m, x) { return Math.max(m, (+x.id || 0) + 1); }, 1) }; persist(); return mem; });
    }
    function persist() { try { localStorage.setItem(key, JSON.stringify(mem)); } catch (_) {} }
    return {
      list: function () { return load().then(function (m) { return m.items.slice(); }); },
      add: function (v) { return load().then(function (m) { var it = makeItem(v, m.next++); m.items.push(it); persist(); return it; }); },
      edit: function (it, v) { return load().then(function (m) { var x = m.items.find(function (y) { return y.id === it.id; }); if (x) Object.assign(x, v); persist(); return x; }); },
      remove: function (it) { return load().then(function (m) { m.items = m.items.filter(function (y) { return y.id !== it.id; }); persist(); }); },
      _all: function () { return load(); }, _persist: persist,
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

  global.ChatDrawer = { create: create, insertAtCaret: insertAtCaret, localStore: localStore, http: http, icons: ICON, esc: esc };
})(typeof window !== "undefined" ? window : this);
