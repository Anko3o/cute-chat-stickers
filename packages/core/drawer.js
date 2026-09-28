/*! chat-stickers · drawer.js — the little drawer both the sticker shelf and the kaomoji box are built on.
 *
 * Top bar = search + add (+) + more (…). The grid only picks. Add / edit / delete all live in the top bar:
 * "…" → "Organize" (or long-press / right-click a cell) selects a cell, and the top bar turns into
 * "Edit · Delete". No per-cell buttons, no emoji icons — every icon is a 1.8-stroke line SVG.
 *
 *   ChatDrawer.create({ button, anchor, title, store: { list, add, edit, remove }, cell, onPick, fields })
 *
 * Groups: if the store has `groups` ({list, add, rename, remove, reorder}), items carry a group id, the grid is split by
 * group in the user's order ("Ungrouped" last), forms get package-drawn group pills (plus "+ New group"), and
 * "…" gets "Manage groups" (new · rename · delete → items become ungrouped · move up / down).
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
      noGroups: "还没有分组——在下面起一个名字", up: "上移", down: "下移", rename: "点名字改名",
      confirmDelGroup: function (n, c) { return "删掉分组「" + n + "」？" + (c ? "里面的 " + c + " 个会并入「未分组」。" : ""); } },
    en: { search: "Search", add: "Add", more: "More", organize: "Organize (pick one to edit or delete)", edit: "Edit", del: "Delete", cancel: "Cancel", save: "Save",
      back: "Back", loading: "Loading…", failed: "Couldn't load, try again later", empty: "Empty — tap + at the top to add the first one", noHit: "No match",
      pickOne: "Tap one to edit or delete", confirmDel: function (n) { return "Delete \"" + n + "\"?"; },
      group: "Group", ungrouped: "Ungrouped", newGroup: "New group", groupPh: "Group name", manageGroups: "Manage groups", addGroup: "Add",
      noGroups: "No groups yet — name one below", up: "Move up", down: "Move down", rename: "Tap the name to rename",
      confirmDelGroup: function (n, c) { return "Delete the group \"" + n + "\"?" + (c ? " Its " + c + " item(s) become ungrouped." : ""); } },
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
    function groupName(it) {
      if (!G) return o.groupOf ? (o.groupOf(it) || "") : "";
      var g = groupById(it.group); return g ? g.name : "";
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
      var hay = o.searchText ? o.searchText(it) : [it.name, it.desc, it.text, groupName(it)].concat(it.tags || [], it.aliases || []).join(" ");
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
      if (G && heads) {                                // the user's group order, ungrouped last; inside a group, oldest first
        var rank = {}; groups.forEach(function (g, i) { rank[g.id] = i; });
        var r = function (it) { var g = groupById(it.group); return g ? rank[g.id] : 1e9; };
        list = list.map(function (it, i) { return [it, i]; }).sort(function (a, b) { return (r(a[0]) - r(b[0])) || (a[1] - b[1]); }).map(function (x) { return x[0]; });
      }
      list.forEach(function (it) {
        var g = heads ? (groupName(it) || L.ungrouped) : null;
        if (g !== null && g !== lastGroup) { html.push('<h3 class="cd-group">' + esc(g) + "</h3>"); lastGroup = g; }
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
      return Promise.all([o.store.list(""), G ? Promise.resolve(G.list()).catch(function () { return []; }) : null])
        .then(function (r) { items = r[0] || []; if (G) groups = (r[1] || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }); })
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
      f.innerHTML = fields.map(function (fd) {
        var v = initial ? initial[fd.key] : "";
        if (fd.type === "tags" && Array.isArray(v)) v = v.join(", ");
        var ph = ' placeholder="' + esc(fd.placeholder || "") + '"', req = fd.required ? " required" : "", mx = fd.max ? ' maxlength="' + fd.max + '"' : "";
        var ctl;
        if (fd.type === "file") ctl = '<input type="file" name="' + fd.key + '" accept="' + esc(fd.accept || "image/png,image/jpeg,image/gif,image/webp") + '"' + req + '><img class="cd-preview" alt="" hidden>';
        else if (fd.type === "textarea") ctl = '<textarea name="' + fd.key + '" rows="2"' + ph + req + mx + ">" + esc(v) + "</textarea>";
        else if (fd.type === "group") return G ? '<div class="cd-field"><span>' + esc(fd.label || L.group) + '</span><div data-pills="' + fd.key + '"></div></div>' : "";
        else ctl = '<input type="text" name="' + fd.key + '" value="' + esc(v) + '"' + ph + req + mx + ">";
        return '<label class="cd-field"><span>' + esc(fd.label) + "</span>" + ctl + "</label>";
      }).join("") +
        '<p class="cd-err" hidden></p>' +
        '<div class="cd-row"><button type="submit" class="cd-btn cd-primary">' + esc(submitLabel) + '</button><button type="button" class="cd-btn" data-cd="back">' + esc(L.cancel) + "</button></div>";
      var pickers = {};
      f.querySelectorAll("[data-pills]").forEach(function (slot) {
        var p = pills(initial ? initial[slot.dataset.pills] : (o.defaultGroup != null ? o.defaultGroup : null));
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
          else if (fd.type === "group") { if (pickers[fd.key]) out[fd.key] = pickers[fd.key].value(); }
          else { var v = f.elements[fd.key].value.trim(); out[fd.key] = fd.type === "tags" ? v.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean) : v; }
        });
        var sb = f.querySelector(".cd-primary"); sb.disabled = true;
        var keys = Object.keys(pickers);
        Promise.all(keys.map(function (k) { return ensureGroup(out[k]); }))
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

    /* Group pills drawn by the package: "Ungrouped", every group in order, then "+ New group" (turns into an inline input).
       value() → null | {id} | {name} (a new name; ensureGroup() creates it on save). */
    function pills(initialId, onChange) {             // initialId: a group id, or a value from another picker
      var el = document.createElement("div");
      el.className = "cd-pills"; el.setAttribute("role", "radiogroup"); el.setAttribute("aria-label", L.group);
      var cur = null, fresh = [];
      if (initialId && typeof initialId === "object") { cur = initialId; if (initialId.name != null) fresh.push(initialId.name); }
      else if (groupById(initialId)) cur = { id: groupById(initialId).id };
      function same(a, b) { return (!a && !b) || (a && b && (a.id != null ? String(a.id) === String(b.id) : a.name === b.name)); }
      function pill(v, label) {
        return '<button type="button" class="cd-pill' + (same(v, cur) ? " on" : "") + '" role="radio" aria-checked="' + (same(v, cur) ? "true" : "false") + '" data-v="' + esc(JSON.stringify(v)) + '">' + esc(label) + "</button>";
      }
      function draw() {
        el.innerHTML = pill(null, L.ungrouped) +
          groups.map(function (g) { return pill({ id: g.id }, g.name); }).join("") +
          fresh.map(function (n) { return pill({ name: n }, n); }).join("") +
          '<button type="button" class="cd-pill cd-pill-new" data-new="1">' + ICON.plus + "<span>" + esc(L.newGroup) + "</span></button>";
      }
      function set(v) { cur = v; draw(); if (onChange) onChange(cur); }
      function edit() {
        var nb = el.querySelector(".cd-pill-new");
        var box = document.createElement("span");
        box.className = "cd-pill-edit";
        box.innerHTML = '<input type="text" maxlength="20" enterkeyhint="done" placeholder="' + esc(L.groupPh) + '" aria-label="' + esc(L.newGroup) + '"><button type="button" aria-label="' + esc(L.save) + '">' + ICON.check + "</button>";
        nb.replaceWith(box);
        var inp = box.querySelector("input"), done = false;
        function commit() {
          if (done) return; done = true;
          var n = inp.value.split(/\s+/).join(" ").trim().slice(0, 20);
          if (!n) return draw();
          var g = groups.find(function (x) { return x.name === n; });
          if (g) return set({ id: g.id });
          if (fresh.indexOf(n) < 0) fresh.push(n);
          set({ name: n });
        }
        inp.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done = true; draw(); }
        });
        inp.addEventListener("blur", function () { setTimeout(commit, 120); });
        box.querySelector("button").addEventListener("click", commit);
        setTimeout(function () { inp.focus(); }, 20);
      }
      el.addEventListener("click", function (e) {
        if (e.target.closest(".cd-pill-new")) return edit();
        var b = e.target.closest(".cd-pill[data-v]");
        if (b) set(JSON.parse(b.dataset.v));
      });
      draw();
      return { el: el, value: function () { return cur; }, set: set };
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
      showView(L.edit + " · " + nameOf(it), form(o.fields.edit, it, L.save, function (v) { return o.store.edit(it, v); }));
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
      groups: function () { return groups.slice(); }, groupName: groupName, pills: pills, ensureGroup: ensureGroup, refreshGroups: refreshGroups,
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

  /* Groups kept next to the items: [{id, name, order}], items hold only the id. Older saves that stored group
     names on the items are migrated (a group is created for each name). */
  function migrateGroups(m) {
    m.groups = (m.groups || []).filter(function (g) { return g && g.id != null && g.name; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var next = m.groups.reduce(function (x, g) { return Math.max(x, (+g.id || 0) + 1); }, m.nextGroup || 1);
    (m.items || []).forEach(function (it) {
      var v = it.group;
      if (v == null || v === "") { it.group = null; return; }
      if (typeof v === "number") { if (!m.groups.some(function (g) { return g.id === v; })) it.group = null; return; }
      var name = String(v).trim(), g = m.groups.find(function (x) { return x.name === name; });
      if (!g) { g = { id: next++, name: name, order: m.groups.length + 1 }; m.groups.push(g); }
      it.group = g.id;
    });
    m.groups.forEach(function (g, i) { g.order = i + 1; });
    m.nextGroup = next;
    return m;
  }

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
          return m.groups.map(function (g) { return Object.assign({}, g, { count: m.items.filter(function (it) { return String(it.group) === String(g.id); }).length }); });
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
      remove: function (id) {                          // members become ungrouped
        return load().then(function (m) {
          m.groups = m.groups.filter(function (x) { return String(x.id) !== String(id); });
          m.groups.forEach(function (g, i) { g.order = i + 1; });
          m.items.forEach(function (it) { if (String(it.group) === String(id)) it.group = null; });
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
