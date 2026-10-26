/*! chat-stickers · deck.js — the sticker drawer as one keyboard-style panel docked under the composer.
 *
 *   ChatStickers.deck({ button: "#drawerBtn", dock: "#composer", input: "#input", send: (text) => mySend(text),
 *                       container: "#messages", api: "/chat-stickers" })
 *
 * One panel, everything inside it (no floating drawer, no pop-ups):
 *  - top row: 贴纸 | 颜文字 switch · group pills (All / ♡ Recent / each group / Ungrouped) · search · manage
 *  - the wall: newest first, "+" as the first cell (upload a picture / add a kaomoji)
 *  - tap a sticker: the panel stays open. Tapping the same one again counts up (×2, ×3 …); after `repeat` ms
 *    without a new tap it is sent once as `[[sticker:name]]×N` (just the tag for one tap). Tapping another
 *    sticker sends the pending one first. Mid-sentence (the input has text) a tap inserts the tag instead.
 *  - tap a kaomoji: inserted at the caret, never sent; the input is not focused, so phones don't raise the keyboard
 *  - long-press / right-click a cell: a sheet slides up inside the panel — spam ×5 ×20 ×50 ×100 · edit · delete
 *  - forms and "manage groups" slide in from the right, still inside the panel
 * Stores are the same as the floating drawer's (StickerPanel / KaomojiBox `httpStore`, `localStore`, or your own).
 * Needs core/drawer.js (http helpers), stickers/panel.js and/or kaomoji/kaomoji.js; core/press.js for long-press.
 * Zero dependencies. CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  var I = function (d, w) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>"; };
  var ICON = {
    search: I('<circle cx="11" cy="11" r="6.3"/><path d="M20 20l-4.3-4.3"/>'),
    manage: I('<path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="9.5" cy="17" r="2.3"/>'),
    up: I('<path d="M6 14l6-6 6 6"/>', 2),
    down: I('<path d="M6 10l6 6 6-6"/>', 2),
    trash: I('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'),
    back: I('<path d="M14.5 6l-6 6 6 6"/>', 2),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    x: I('<path d="M18 6 6 18M6 6l12 12"/>'),
  };

  var L10N = {
    zh: {
      stickers: "贴纸", kaomoji: "颜文字", switchTo: "贴纸或颜文字", groups: "分组", all: "全部", recent: "♡ 最近", ungrouped: "未分组",
      search: "搜索", cancel: "取消", manage: "整理分组", back: "返回", save: "保存", saving: "存着…", keep: "存进去",
      searchStk: "搜名字或描述", searchKao: "搜颜文字或分组名",
      loading: "在取…", failedStk: "表情包没取到，过会儿再翻回来试试", failedKao: "颜文字没取到，过会儿再翻回来试试", noStore: "这一边没有接上库",
      noHit: function (q) { return "没找到「" + q + "」"; }, recentEmptyStk: "发过的会排在这里", recentEmptyKao: "用过的颜文字会排在这里",
      groupEmpty: "这一组还是空的", emptyStk: "还没有表情包，点「＋」加一张", emptyKao: "还没有颜文字，点「＋」加一条",
      upload: "上传表情包", addKao: "＋ 新颜文字", sendNow: "现在就发", dontSend: "不发了", spam: "刷屏",
      edit: "修改", del: "删除", delSure: "再点一下删掉", deleted: "删掉了", saved: "存好了 ♡", changed: "改好了", added: "加好了",
      pickImg: "选一张图", name: "名字", namePh: "比如：兔子晕倒", desc: "一句描述", descPh: "不看图也能认出它",
      groupHint: "点一下放进去，再点拿出来；能进好几个", newGroup: "＋ 新分组", newGroupPh: "新分组名字", addIt: "加", createOnSave: "保存时新建",
      editStk: "修改表情包", text: "颜文字", textPh: "૮₍ ｡• ̫ •｡ ₎ა", editKao: "修改颜文字", newKao: "新颜文字",
      manageStk: "整理贴纸分组", manageKao: "整理颜文字分组",
      hintStk: "长按一张表情：修改 · 删除 · 刷屏。墙上第一格「＋」上传新的。", hintKao: "长按一条颜文字：修改 · 删除。第一格「＋」加新的。",
      noGroupsLib: "这边的库没有分组。", noGroups: "还没有分组，在下面起一个名字", addGroup: "添加", groupName: "分组名字，改完回车",
      moveUp: "往前挪", moveDown: "往后挪", delGroup: "删掉这个分组", delGroupSure: "再点一下删掉", delGroupShort: "删?",
      groupDeleted: "删掉了，里面的变成未分组", groupExists: function (n) { return "已经有「" + n + "」这个分组了"; },
      unitStk: "张", unitKao: "条",
      needImg: "先点左边选一张图", needName: "起个名字吧", badName: "名字里不能有 / \\ . : [ ] < > \" ' &",
      nameTaken: function (n) { return "已经有一张叫「" + n + "」的了"; }, badType: "只收 png / jpg / gif / webp", tooBig: "超过 8MB 了，表情包不用这么高清",
      needText: "先写一个颜文字", dupKao: function (t) { return "已经有类似的啦：" + t; },
      authFail: "没有权限，存不进去（重新登录一下？）", failed: function (m) { return m ? "没成：" + m : "没成，过会儿再试试"; },
      pickFor: "选一张贴上去",
    },
    en: {
      stickers: "Stickers", kaomoji: "Kaomoji", switchTo: "Stickers or kaomoji", groups: "Groups", all: "All", recent: "♡ Recent", ungrouped: "Ungrouped",
      search: "Search", cancel: "Cancel", manage: "Organize groups", back: "Back", save: "Save", saving: "Saving…", keep: "Add",
      searchStk: "Name or description", searchKao: "Kaomoji or group name",
      loading: "Loading…", failedStk: "Couldn't load stickers, try again in a bit", failedKao: "Couldn't load kaomoji, try again in a bit", noStore: "No library connected",
      noHit: function (q) { return "Nothing for \"" + q + "\""; }, recentEmptyStk: "Stickers you send show up here", recentEmptyKao: "Kaomoji you use show up here",
      groupEmpty: "This group is empty", emptyStk: "No stickers yet — tap + to add one", emptyKao: "No kaomoji yet — tap + to add one",
      upload: "Upload a sticker", addKao: "+ New kaomoji", sendNow: "Send now", dontSend: "Don't send", spam: "Spam",
      edit: "Edit", del: "Delete", delSure: "Tap again to delete", deleted: "Deleted", saved: "Saved ♡", changed: "Saved", added: "Added",
      pickImg: "Pick a picture", name: "Name", namePh: "e.g. dizzy-bunny", desc: "Description", descPh: "so it can be found without seeing it",
      groupHint: "tap to put it in, tap again to take it out; it can be in several", newGroup: "+ New group", newGroupPh: "Group name", addIt: "Add", createOnSave: "created when you save",
      editStk: "Edit sticker", text: "Kaomoji", textPh: "૮₍ ｡• ̫ •｡ ₎ა", editKao: "Edit kaomoji", newKao: "New kaomoji",
      manageStk: "Sticker groups", manageKao: "Kaomoji groups",
      hintStk: "Long-press a sticker to edit, delete or spam it. The + cell uploads a new one.", hintKao: "Long-press a kaomoji to edit or delete it. The + cell adds one.",
      noGroupsLib: "This library has no groups.", noGroups: "No groups yet — name one below", addGroup: "Add", groupName: "Group name, Enter to save",
      moveUp: "Move up", moveDown: "Move down", delGroup: "Delete this group", delGroupSure: "Tap again to delete", delGroupShort: "Del?",
      groupDeleted: "Deleted; its items are ungrouped now", groupExists: function (n) { return "There's already a group called \"" + n + "\""; },
      unitStk: "", unitKao: "",
      needImg: "Pick a picture on the left first", needName: "Give it a name", badName: "Names can't contain / \\ . : [ ] < > \" ' &",
      nameTaken: function (n) { return "There's already one called \"" + n + "\""; }, badType: "png / jpg / gif / webp only", tooBig: "Over 8 MB — stickers don't need to be that sharp",
      needText: "Write a kaomoji first", dupKao: function (t) { return "There's a similar one already: " + t; },
      authFail: "Not allowed to save (log in again?)", failed: function (m) { return m ? "Didn't work: " + m : "Didn't work, try again in a bit"; },
      pickFor: "Pick one to stick on",
    },
  };

  var BAD_NAME = /[\/\\.:\[\]<>"'&]/;                // same rule as PROTOCOL.md / sticker.py
  var OK_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  var KEY = "chat_stickers_deck_";

  function $(x) { return typeof x === "string" ? document.querySelector(x) : x; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(KEY + k); return v == null ? d : v; } catch (_) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(KEY + k, v); } catch (_) {} }
  function lsList(k) { try { return (JSON.parse(localStorage.getItem(KEY + k) || "[]") || []).map(String); } catch (_) { return []; } }
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; } }
  function norm(t) { t = String(t == null ? "" : t); try { t = t.normalize("NFKC"); } catch (_) {} return t.toLowerCase(); }
  function byOrder(a, b) { return (a.order || 0) - (b.order || 0); }
  function groupIds(it) { return (Array.isArray(it.groups) ? it.groups : (it.group != null && it.group !== "" ? [it.group] : [])).map(String); }
  function idVal(x) { return isNaN(Number(x)) ? x : Number(x); }

  function deck(options) {
    var o = Object.assign({
      button: null, dock: null, anchor: null, input: null, send: null, container: null,
      api: null, headers: null, lang: null, labels: null,
      tabs: ["stickers", "kaomoji"], remember: true,
      stickers: {}, kaomoji: {},          // { store } / { store, seedUrl } — or false to drop that tab
      order: "newest",                    // "newest": highest id first · "store": as the store lists them
      repeat: 3000,                       // ms to wait for more taps on the same sticker; 0 = send every tap
      maxRepeat: 999,
      spam: [5, 20, 50, 100],             // counts offered in the long-press sheet; [] hides the row
      recent: { stickers: 8, kaomoji: 24 },
      closeOnInputFocus: true,
    }, options || {});
    var lang = o.lang || (/^zh/i.test(navigator.language || "") ? "zh" : "en");
    var L = Object.assign({}, L10N[lang] || L10N.en, o.labels || {});
    var input = $(o.input), btn = $(o.button), dock = $(o.dock || o.anchor) || (btn && (btn.closest("form") || btn.parentElement));
    var scroller = $(o.container);

    function makeStore(kind) {
      var opt = o[kind];
      if (opt === false) return null;
      opt = opt || {};
      if (opt.store) return opt.store;
      if (kind === "stickers") return o.api != null && global.StickerPanel && global.StickerPanel.httpStore ? global.StickerPanel.httpStore(o.api, o.headers) : null;
      if (!global.KaomojiBox) return null;
      return o.api != null ? global.KaomojiBox.httpStore(o.api, o.headers) : global.KaomojiBox.localStore(opt.seedUrl || null);
    }
    var stores = { stickers: makeStore("stickers"), kaomoji: makeStore("kaomoji") };
    var tabs = (o.tabs || []).filter(function (t) { return (t === "stickers" || t === "kaomoji") && stores[t]; });
    if (!tabs.length) throw new Error("ChatStickers.deck: no tabs (give `api`, or stickers.store / kaomoji.store)");
    var spamCounts = (o.spam || []).filter(function (n) { return n >= 2; });

    function srcOf(it) {
      if (it && it.src) return it.src;
      var name = it && it.name != null ? it.name : it;
      return global.StickerRender ? global.StickerRender.src(name) : (o.api || "") + "/sticker/" + encodeURIComponent(name);
    }
    function tagOf(name) { return global.StickerRender ? global.StickerRender.tag(name) : "[[sticker:" + name + "]]"; }
    function errText(err) {
      if (err && (err.status === 401 || err.status === 403)) return L.authFail;
      return L.failed(err && err.message ? String(err.message) : "");
    }

    /* ── skeleton ── */
    var root = document.createElement("div");
    root.className = "cs-deck";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", tabs.map(function (t) { return L[t]; }).join(" · "));
    root.innerHTML =
      '<div class="cs-dk-in">' +
        '<div class="cs-dk-bar">' +
          (tabs.length > 1 ? '<div class="cs-dk-seg" role="tablist" aria-label="' + esc(L.switchTo) + '">' + tabs.map(function (t) {
            return '<button type="button" class="cs-dk-seg-b" role="tab" data-dk-view="' + t + '" aria-selected="false">' + esc(L[t]) + "</button>";
          }).join("") + "</div>" : "") +
          '<div class="cs-dk-pills" role="tablist" aria-label="' + esc(L.groups) + '"></div>' +
          '<button type="button" class="cs-dk-tool" data-dk-act="search" aria-label="' + esc(L.search) + '" title="' + esc(L.search) + '">' + ICON.search + "</button>" +
          '<button type="button" class="cs-dk-tool" data-dk-act="manage" aria-label="' + esc(L.manage) + '" title="' + esc(L.manage) + '">' + ICON.manage + "</button>" +
        "</div>" +
        '<form class="cs-dk-search" role="search" hidden>' + ICON.search +
          '<input type="search" class="cs-dk-search-in" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="' + esc(L.search) + '">' +
          '<button type="button" class="cs-dk-search-x" data-dk-act="search-close">' + esc(L.cancel) + "</button>" +
        "</form>" +
        tabs.map(function (t) {
          return '<div class="cs-dk-scroll" data-dk-pane="' + t + '" hidden><div class="cs-dk-wall cs-dk-' + t + '"></div><p class="cs-dk-note" hidden></p></div>';
        }).join("") +
        '<div class="cs-dk-scrim" data-dk-act="sheet-close" hidden></div>' +
        '<div class="cs-dk-sheet" role="menu" hidden></div>' +
        '<div class="cs-dk-sub" role="group" hidden>' +
          '<div class="cs-dk-sub-head">' +
            '<button type="button" class="cs-dk-back" data-dk-act="back" aria-label="' + esc(L.back) + '">' + ICON.back + "<span>" + esc(L.back) + "</span></button>" +
            '<b class="cs-dk-sub-title"></b>' +
            '<button type="button" class="cs-dk-save" data-dk-act="save">' + esc(L.save) + "</button>" +
          "</div>" +
          '<div class="cs-dk-sub-body"></div>' +
        "</div>" +
        '<div class="cs-dk-combo" hidden>' +
          '<button type="button" class="cs-dk-combo-go" aria-label="' + esc(L.sendNow) + '"><img alt="" draggable="false"><b class="cs-dk-combo-n"></b><i class="cs-dk-combo-bar" aria-hidden="true"></i></button>' +
          '<button type="button" class="cs-dk-combo-x" aria-label="' + esc(L.dontSend) + '">' + ICON.x + "</button>" +
        "</div>" +
        '<div class="cs-dk-toast" role="status" aria-live="polite" hidden></div>' +
        '<input type="file" class="cs-dk-file" accept="' + OK_TYPES.join(",") + '" hidden>' +
      "</div>";
    if (dock && dock.parentNode) dock.parentNode.insertBefore(root, dock.nextSibling);
    else { root.classList.add("cs-deck-fixed"); document.body.appendChild(root); }

    var q = function (s) { return root.querySelector(s); };
    var bar = q(".cs-dk-bar"), pillsBox = q(".cs-dk-pills"), searchForm = q(".cs-dk-search"), searchIn = q(".cs-dk-search-in");
    var panes = {}, walls = {}, notes = {};
    tabs.forEach(function (t) {
      panes[t] = q('[data-dk-pane="' + t + '"]'); walls[t] = panes[t].querySelector(".cs-dk-wall"); notes[t] = panes[t].querySelector(".cs-dk-note");
    });
    var scrim = q(".cs-dk-scrim"), sheet = q(".cs-dk-sheet"), sub = q(".cs-dk-sub"), subTitle = q(".cs-dk-sub-title"), subBody = q(".cs-dk-sub-body"), saveBtn = q(".cs-dk-save");
    var toastEl = q(".cs-dk-toast"), fileIn = q(".cs-dk-file");
    var pill = q(".cs-dk-combo"), pillImg = pill.querySelector("img"), pillN = q(".cs-dk-combo-n"), pillBar = q(".cs-dk-combo-bar");

    /* ── state ── */
    var st = {};
    tabs.forEach(function (t) { st[t] = { items: [], groups: [], byId: {}, loaded: false, busy: null, group: lsGet("group_" + t, "all") }; });
    var view = o.remember && tabs.indexOf(lsGet("view", "")) >= 0 ? lsGet("view", "") : tabs[0];
    var query = "", stale = {}, isOpen = false, pickCb = null;

    function setNote(kind, text) { var n = notes[kind]; if (n) { n.textContent = text || ""; n.hidden = !text; } }
    var toastT = 0;
    function toast(text) {
      toastEl.textContent = text; toastEl.hidden = false;
      toastEl.classList.remove("cs-on"); void toastEl.offsetWidth; toastEl.classList.add("cs-on");
      clearTimeout(toastT);
      toastT = setTimeout(function () { toastEl.classList.remove("cs-on"); toastT = setTimeout(function () { toastEl.hidden = true; }, 220); }, 1600);
    }
    /* enter: drop [hidden], then .cs-on next frame (so the transition has a start); leave: drop .cs-on, hide when done */
    function reveal(el) { el.hidden = false; void el.offsetWidth; el.classList.add("cs-on"); }
    function conceal(el) { el.classList.remove("cs-on"); setTimeout(function () { if (!el.classList.contains("cs-on")) el.hidden = true; }, reduced() ? 0 : 230); }

    /* ── load ── */
    function load(kind, force) {
      var s = st[kind], store = stores[kind];
      if (!store || !store.list) { setNote(kind, L.noStore); return Promise.resolve(); }
      if (s.busy) return s.busy;
      if (s.loaded && !force) return Promise.resolve();
      if (!s.loaded) setNote(kind, L.loading);
      var gp = store.groups && store.groups.list ? Promise.resolve(store.groups.list()).catch(function () { return []; }) : Promise.resolve([]);
      s.busy = Promise.all([store.list(""), gp]).then(function (r) {
        var list = (r[0] || []).filter(function (it) { return it && it.id != null && (kind === "stickers" ? it.name : it.text); });
        if (o.order === "newest") list = list.slice().sort(function (a, b) { return (Number(b.id) || 0) - (Number(a.id) || 0); });
        s.items = list;
        s.groups = (r[1] || []).slice().sort(byOrder);
        s.byId = {};
        list.forEach(function (it) { s.byId[String(it.id)] = it; });
        s.loaded = true;
        build(kind);
      }, function () {
        if (!s.loaded) setNote(kind, kind === "stickers" ? L.failedStk : L.failedKao);
      }).then(function () { s.busy = null; });
      return s.busy;
    }

    /* the wall is drawn once; switching groups or searching only toggles .cs-dk-off (no rebuild, no image flash) */
    function build(kind) {
      var s = st[kind], frag = document.createDocumentFragment(), add = document.createElement("button");
      add.type = "button"; add.dataset.dkAct = "add";
      if (kind === "stickers") { add.className = "cs-dk-st cs-dk-add"; add.title = L.upload; add.setAttribute("aria-label", L.upload); add.innerHTML = ICON.plus; }
      else { add.className = "cs-dk-kao cs-dk-kao-add"; add.textContent = L.addKao; }
      frag.appendChild(add);
      s.items.forEach(function (it) {
        var b = document.createElement("button");
        b.type = "button"; b.dataset.id = String(it.id);
        if (kind === "stickers") {
          b.className = "cs-dk-st"; b.dataset.name = it.name;
          b.title = it.desc ? it.name + " · " + it.desc : it.name;
          b.setAttribute("aria-label", it.name);
          var img = document.createElement("img");
          img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.draggable = false; img.src = srcOf(it);
          b.appendChild(img);
          if (combo && combo.name === it.name) { combo.cell = b; b.dataset.combo = "×" + combo.n; }
        } else { b.className = "cs-dk-kao"; b.textContent = it.text; }
        frag.appendChild(b);
      });
      walls[kind].textContent = "";
      walls[kind].appendChild(frag);
      if (kind === view) renderPills();
      applyFilter(kind);
    }

    function renderPills() {
      var s = st[view], pills = [{ key: "all", label: L.all }, { key: "recent", label: L.recent }], firstOf = {}, count = {};
      s.items.forEach(function (it) {
        groupIds(it).forEach(function (g) { count[g] = (count[g] || 0) + 1; if (view === "stickers" && firstOf[g] == null) firstOf[g] = it; });
      });
      s.groups.forEach(function (g) { var k = String(g.id); if (count[k]) pills.push({ key: k, label: g.name, icon: firstOf[k] }); });
      if (s.groups.length && s.items.some(function (it) { return !groupIds(it).length; })) pills.push({ key: "none", label: L.ungrouped });
      if (!pills.some(function (p) { return p.key === s.group; })) s.group = "all";
      pillsBox.innerHTML = pills.map(function (p) {
        return '<button type="button" class="cs-dk-g" role="tab" data-group="' + esc(p.key) + '" aria-selected="' + (p.key === s.group) + '">' +
          (p.icon ? '<img alt="" draggable="false" loading="lazy" src="' + esc(srcOf(p.icon)) + '">' : "") + "<span>" + esc(p.label) + "</span></button>";
      }).join("");
    }

    function matches(kind, it, qq) {
      if (kind === "stickers") return norm([it.name, it.desc || "", (it.aliases || []).join(" "), "#" + it.id].join(" ")).indexOf(qq) >= 0;
      if (norm(it.text).indexOf(qq) >= 0) return true;
      var gs = groupIds(it);
      return st[kind].groups.some(function (g) { return gs.indexOf(String(g.id)) >= 0 && norm(g.name).indexOf(qq) >= 0; });
    }

    function applyFilter(kind) {
      var s = st[kind], shown = 0, rec = s.group === "recent" && !query ? lsList("recent_" + kind) : null;
      Array.prototype.forEach.call(walls[kind].children, function (cell) {
        if (cell.dataset.dkAct === "add") { cell.classList.toggle("cs-dk-off", !!query); return; }
        var it = s.byId[cell.dataset.id], on, gs;
        if (!it) on = false;
        else if (query) on = matches(kind, it, query);
        else if (s.group === "all") on = true;
        else if (s.group === "recent") on = rec.indexOf(cell.dataset.id) >= 0;
        else { gs = groupIds(it); on = s.group === "none" ? !gs.length : gs.indexOf(s.group) >= 0; }
        cell.classList.toggle("cs-dk-off", !on);
        cell.style.order = rec && on ? String(rec.indexOf(cell.dataset.id) + 1) : "";   // ♡ Recent: last used first; the + cell stays first
        if (on) shown++;
      });
      if (kind === view) Array.prototype.forEach.call(pillsBox.querySelectorAll(".cs-dk-g"), function (p) { p.setAttribute("aria-selected", String(p.dataset.group === s.group)); });
      if (!s.loaded) return;
      if (shown) setNote(kind, "");
      else if (query) setNote(kind, L.noHit(searchIn.value.trim()));
      else if (s.group === "recent") setNote(kind, kind === "stickers" ? L.recentEmptyStk : L.recentEmptyKao);
      else if (s.items.length) setNote(kind, L.groupEmpty);
      else setNote(kind, kind === "stickers" ? L.emptyStk : L.emptyKao);
    }

    function setView(kind, noLoad) {
      if (tabs.indexOf(kind) < 0) kind = tabs[0];
      if (kind !== view) flushCombo();
      view = kind;
      if (o.remember) lsSet("view", kind);
      Array.prototype.forEach.call(bar.querySelectorAll("[data-dk-view]"), function (b) { b.setAttribute("aria-selected", String(b.dataset.dkView === kind)); });
      tabs.forEach(function (t) { panes[t].hidden = t !== kind; });
      root.dataset.dkMode = kind;
      searchIn.placeholder = kind === "stickers" ? L.searchStk : L.searchKao;
      renderPills();
      applyFilter(kind);
      if (!noLoad) load(kind, stale[kind]).then(function () { stale[kind] = false; });
    }

    /* ── insert / send ── */
    function insertNoFocus(text) {                    // don't focus the input: on phones that raises the keyboard over the panel
      if (!input) return;
      var v = input.value, a = input.selectionStart == null ? v.length : input.selectionStart, b = input.selectionEnd == null ? v.length : input.selectionEnd;
      input.value = v.slice(0, a) + text + v.slice(b);
      try { input.setSelectionRange(a + text.length, a + text.length); } catch (_) {}
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function remember(kind, id) {
      var max = (o.recent && o.recent[kind]) || 0;
      if (!max || id == null) return;
      var l = lsList("recent_" + kind).filter(function (x) { return x !== String(id); });
      l.unshift(String(id));
      lsSet("recent_" + kind, JSON.stringify(l.slice(0, max)));
    }
    function sendTagNow(tag, it) {
      if (input && input.value.trim()) { insertNoFocus(tag); return; }   // started typing while it was pending: don't wipe the text, insert
      if (o.send) o.send(tag, it);
      else insertNoFocus(tag);
    }

    /* repeat taps on the same sticker: wait, count, then send once as ×N */
    var combo = null, comboTimer = 0;
    function endCombo() {
      clearTimeout(comboTimer); comboTimer = 0;
      if (combo && combo.cell) delete combo.cell.dataset.combo;
      combo = null; pill.hidden = true;
    }
    function flushCombo() {
      if (!combo) return;
      var c = combo;
      endCombo();
      sendTagNow(tagOf(c.name) + (c.n > 1 ? "×" + c.n : ""), c.it);
    }
    function hit(cell) { cell.classList.remove("cs-dk-hit"); void cell.offsetWidth; cell.classList.add("cs-dk-hit"); }
    function tapSticker(cell, it) {
      if (!(o.repeat > 0)) { hit(cell); sendTagNow(tagOf(it.name), it); return; }
      if (combo && combo.name !== it.name) flushCombo();   // a different sticker: send the pending one first
      if (!combo) combo = { name: it.name, it: it, n: 0 };
      combo.cell = cell;
      combo.n = Math.min(o.maxRepeat || 999, combo.n + 1);
      cell.dataset.combo = "×" + combo.n;
      var src = srcOf(it);
      if (pillImg.getAttribute("src") !== src) pillImg.src = src;
      pillN.textContent = "×" + combo.n;
      pill.hidden = false;
      pill.style.setProperty("--cs-dk-repeat", o.repeat + "ms");
      pillBar.classList.remove("run"); void pillBar.offsetWidth; pillBar.classList.add("run");
      hit(cell);
      clearTimeout(comboTimer);
      comboTimer = setTimeout(flushCombo, o.repeat);
    }
    pill.addEventListener("click", function (ev) {
      if (ev.target.closest(".cs-dk-combo-x")) endCombo();
      else if (ev.target.closest(".cs-dk-combo-go")) flushCombo();
    });
    document.addEventListener("visibilitychange", function () { if (document.hidden) flushCombo(); });

    /* ── search: only when 🔍 is tapped ── */
    function openSearch() {
      root.classList.add("cs-dk-searching"); searchForm.hidden = false;
      try { searchIn.focus({ preventScroll: true }); } catch (_) { searchIn.focus(); }
    }
    function closeSearch() {
      var was = !!query || root.classList.contains("cs-dk-searching");
      query = ""; searchIn.value = "";
      root.classList.remove("cs-dk-searching", "cs-dk-typing"); searchForm.hidden = true;
      if (document.activeElement === searchIn) searchIn.blur();
      if (was) applyFilter(view);
    }
    searchIn.addEventListener("input", function () { query = norm(searchIn.value.trim()); applyFilter(view); panes[view].scrollTop = 0; });
    searchForm.addEventListener("submit", function (ev) { ev.preventDefault(); searchIn.blur(); });   // Enter = put the keyboard away, look at the results
    var typT = 0;   // a squeezed panel while the search box has the keyboard (touch screens only, see deck.css)
    searchIn.addEventListener("focus", function () { clearTimeout(typT); root.classList.add("cs-dk-typing"); });
    searchIn.addEventListener("blur", function () { clearTimeout(typT); typT = setTimeout(function () { if (document.activeElement !== searchIn) root.classList.remove("cs-dk-typing"); }, 260); });
    /* tapping a cell or pill while searching keeps the focus (the keyboard stays, the panel doesn't jump); mousedown, so scrolling is untouched */
    root.addEventListener("mousedown", function (ev) {
      if (document.activeElement === searchIn && ev.target.closest && ev.target.closest(".cs-dk-st, .cs-dk-kao, .cs-dk-g")) ev.preventDefault();
    });

    /* ── long-press sheet (slides up inside the panel) ── */
    var sheetItem = null, sheetKind = null, armT = 0, quietUntil = 0;
    function actsHtml() {
      return '<div class="cs-dk-sheet-acts">' +
        '<button type="button" class="cs-dk-btn" data-dk-act="edit">' + esc(L.edit) + "</button>" +
        '<button type="button" class="cs-dk-btn cs-dk-danger" data-dk-act="del">' + esc(L.del) + "</button>" +
        '<button type="button" class="cs-dk-btn cs-dk-ghost" data-dk-act="sheet-close">' + esc(L.cancel) + "</button></div>" +
        '<p class="cs-dk-msg" hidden></p>';
    }
    function openSheet(cell) {
      flushCombo();
      var kind = cell.classList.contains("cs-dk-kao") ? "kaomoji" : "stickers", it = st[kind] && st[kind].byId[cell.dataset.id];
      if (!it) return;
      sheetItem = it; sheetKind = kind;
      if (kind === "stickers") {
        var gn = st[kind].groups.filter(function (g) { return groupIds(it).indexOf(String(g.id)) >= 0; }).map(function (g) { return g.name; });
        sheet.innerHTML =
          '<div class="cs-dk-sheet-head"><img alt="" draggable="false" src="' + esc(srcOf(it)) + '">' +
            '<div class="cs-dk-sheet-meta"><b>' + esc(it.name) + "</b><small>#" + esc(it.id) + (gn.length ? " · " + esc(gn.join(lang === "zh" ? "、" : ", ")) : "") + (it.desc ? " · " + esc(it.desc) : "") + "</small></div></div>" +
          (spamCounts.length && !pickCb ? '<div class="cs-dk-sheet-spam"><span>' + esc(L.spam) + "</span>" + spamCounts.map(function (n) {
            return '<button type="button" class="cs-dk-chip" data-dk-act="spam" data-n="' + n + '">×' + n + "</button>";
          }).join("") + "</div>" : "") + actsHtml();
      } else {
        sheet.innerHTML = '<div class="cs-dk-sheet-head cs-dk-sheet-kao"><b>' + esc(it.text) + "</b></div>" + actsHtml();
      }
      reveal(scrim); reveal(sheet);
    }
    function closeSheet() { clearTimeout(armT); if (sheet.hidden) return; sheetItem = null; conceal(scrim); conceal(sheet); }
    function sheetMsg(t) { var m = sheet.querySelector(".cs-dk-msg"); if (m) { m.textContent = t; m.hidden = !t; } }
    function cellAt(t) { return t && t.closest ? t.closest(".cs-dk-st[data-id], .cs-dk-kao[data-id]") : null; }
    tabs.forEach(function (t) {
      if (global.ChatPress) {                          // touch-event timing, passive listeners, cancel on move / scroll (see press.js)
        global.ChatPress.attach({ container: panes[t], bubble: ".cs-dk-st[data-id], .cs-dk-kao[data-id]", media: null, ignore: "a, input, textarea",
          onBubble: function (cell) { quietUntil = Date.now() + 700; openSheet(cell); } });
      } else {
        panes[t].addEventListener("contextmenu", function (ev) {
          var cell = cellAt(ev.target);
          if (!cell) return;
          ev.preventDefault(); quietUntil = Date.now() + 700; openSheet(cell);
        });
      }
    });

    /* ── sub-pages (slide in from the right, cover the panel; not a modal) ── */
    var subSaveFn = null;
    function openSub(title, body, onSave, saveLabel) {
      closeSheet(); flushCombo();
      if (document.activeElement === searchIn) searchIn.blur();
      subTitle.textContent = title;
      subBody.textContent = ""; subBody.appendChild(body);
      subSaveFn = onSave || null;
      saveBtn.hidden = !onSave; saveBtn.disabled = false; saveBtn.textContent = saveLabel || L.save;
      subBody.scrollTop = 0;
      reveal(sub);
    }
    function closeSub() {
      subSaveFn = null; fileIn.onchange = null;
      if (sub.contains(document.activeElement)) try { document.activeElement.blur(); } catch (_) {}
      conceal(sub);
    }
    function subMsg(t) { var m = subBody.querySelector(".cs-dk-msg"); if (m) { m.textContent = t || ""; m.hidden = !t; } }
    function doSave() {
      if (!subSaveFn || saveBtn.disabled) return;
      var label = saveBtn.textContent;
      saveBtn.disabled = true; saveBtn.textContent = L.saving; subMsg("");
      Promise.resolve().then(subSaveFn).catch(function (err) { subMsg(errText(err)); })
        .then(function () { saveBtn.disabled = false; saveBtn.textContent = label; });
    }

    /* group pills: tap to put it in, tap again to take it out, several can be on; "+ New group" names one in place,
       created only on save (cancel leaves nothing behind) */
    function groupPicker(kind, selected) {
      var sel = (selected || []).map(String), pend = [], adding = false, el = document.createElement("div");
      el.className = "cs-dk-gpills";
      function paint() {
        el.innerHTML = st[kind].groups.map(function (g) {
          return '<button type="button" class="cs-dk-gp" data-gid="' + esc(g.id) + '" aria-pressed="' + (sel.indexOf(String(g.id)) >= 0) + '">' + esc(g.name) + "</button>";
        }).join("") + pend.map(function (n, i) {
          return '<button type="button" class="cs-dk-gp cs-dk-gp-new" data-pend="' + i + '" aria-pressed="true" title="' + esc(L.createOnSave) + '">' + esc(n) + "</button>";
        }).join("") + (adding
          ? '<span class="cs-dk-gp-addbox"><input class="cs-dk-gp-in" maxlength="20" enterkeyhint="done" autocomplete="off" placeholder="' + esc(L.newGroupPh) + '"><button type="button" class="cs-dk-gp" data-gnew-ok>' + esc(L.addIt) + "</button></span>"
          : '<button type="button" class="cs-dk-gp cs-dk-gp-plus" data-gnew>' + esc(L.newGroup) + "</button>");
      }
      function commitNew() {
        var inp = el.querySelector(".cs-dk-gp-in"), n = inp ? inp.value.split(/\s+/).join(" ").trim().slice(0, 20) : "";
        adding = false;
        if (n) {
          var g = st[kind].groups.find(function (x) { return x.name === n; });
          if (g) { if (sel.indexOf(String(g.id)) < 0) sel.push(String(g.id)); }
          else if (pend.indexOf(n) < 0) pend.push(n);
        }
        paint();
      }
      el.addEventListener("click", function (ev) {
        var b = ev.target.closest("button");
        if (!b) return;
        if (b.dataset.gid != null) {
          var i = sel.indexOf(b.dataset.gid);
          if (i >= 0) sel.splice(i, 1); else sel.push(b.dataset.gid);
          b.setAttribute("aria-pressed", String(i < 0));
        } else if (b.dataset.pend != null) { pend.splice(Number(b.dataset.pend), 1); paint(); }
        else if (b.hasAttribute("data-gnew")) {
          adding = true; paint();
          var inp = el.querySelector(".cs-dk-gp-in");
          if (inp) try { inp.focus({ preventScroll: true }); } catch (_) { inp.focus(); }
        } else if (b.hasAttribute("data-gnew-ok")) commitNew();
      });
      el.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && ev.target.classList.contains("cs-dk-gp-in")) { ev.preventDefault(); commitNew(); } });
      paint();
      return {
        el: el,
        value: function () {
          if (adding) commitNew();
          var G = stores[kind].groups, ids = sel.slice();
          return pend.reduce(function (p, n) {
            return p.then(function () { return G.add(n); }).then(function (g) {
              g = (g && g.group) || g;
              if (g && g.id != null) ids.push(String(g.id));
            }, function (err) {
              var d = err && err.data && err.data.duplicate;   // created meanwhile elsewhere: use that one
              if (d && d.id != null) ids.push(String(d.id)); else throw err;
            });
          }, Promise.resolve()).then(function () { pend = []; return ids.map(idVal); });
        },
      };
    }
    function curGroupDefault(kind) { var g = st[kind].group; return g && g !== "all" && g !== "recent" && g !== "none" ? [g] : []; }
    function groupsField(kind) { return stores[kind].groups ? '<div class="cs-dk-field cs-dk-field-g"><span>' + esc(L.groups) + "<small>" + esc(L.groupHint) + "</small></span></div>" : ""; }

    function pickFile() { fileIn.value = ""; fileIn.click(); }
    function openStickerForm(it) {
      var isNew = !it, data = "", store = stores.stickers, f = document.createElement("div");
      f.className = "cs-dk-form cs-dk-form-stk";
      f.innerHTML =
        '<div class="cs-dk-form-top">' +
          (isNew
            ? '<button type="button" class="cs-dk-pick" data-pick aria-label="' + esc(L.pickImg) + '"><span class="cs-dk-pick-ph">' + ICON.plus + "<small>" + esc(L.pickImg) + '</small></span><img alt="" hidden></button>'
            : '<div class="cs-dk-pick cs-dk-pick-static"><img alt="" draggable="false" src="' + esc(srcOf(it)) + '"></div>') +
          '<div class="cs-dk-fields">' +
            '<label class="cs-dk-field"><span>' + esc(L.name) + '</span><input name="name" maxlength="40" autocomplete="off" enterkeyhint="next" placeholder="' + esc(L.namePh) + '"></label>' +
            '<label class="cs-dk-field"><span>' + esc(L.desc) + '</span><input name="desc" maxlength="120" autocomplete="off" enterkeyhint="done" placeholder="' + esc(L.descPh) + '"></label>' +
          "</div>" +
        "</div>" + groupsField("stickers") + '<p class="cs-dk-msg" hidden></p>';
      var nameIn = f.querySelector('input[name="name"]'), descIn = f.querySelector('input[name="desc"]');
      if (it) { nameIn.value = it.name || ""; descIn.value = it.desc || ""; }
      var picker = store.groups ? groupPicker("stickers", it ? groupIds(it) : curGroupDefault("stickers")) : null;
      if (picker) f.querySelector(".cs-dk-field-g").appendChild(picker.el);
      nameIn.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); descIn.focus(); } });
      descIn.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); descIn.blur(); } });
      if (isNew) {
        var pick = f.querySelector("[data-pick]"), pv = pick.querySelector("img"), ph = pick.querySelector(".cs-dk-pick-ph");
        pick.addEventListener("click", pickFile);
        fileIn.onchange = function () {
          var fl = fileIn.files && fileIn.files[0];
          if (!fl) return;
          if (fl.type && OK_TYPES.indexOf(fl.type) < 0) { subMsg(L.badType); return; }
          if (fl.size > 8 * 1024 * 1024) { subMsg(L.tooBig); return; }
          var rd = new FileReader();
          rd.onload = function () {
            data = String(rd.result || ""); pv.src = data; pv.hidden = false; ph.hidden = true; subMsg("");
            var base = fl.name.replace(/\.[^.]+$/, "").replace(/[\/\\.:\[\]<>"'&]/g, "").trim().slice(0, 40);
            if (!nameIn.value && base && !/^(img|image|photo|pxl|dsc|screenshot)?[_\-\s]*\d[\d_\-\s]*$/i.test(base)) nameIn.value = base;   // camera-roll numbers aren't names
          };
          rd.readAsDataURL(fl);
        };
      }
      openSub(isNew ? L.upload : L.editStk, f, function () {
        var name = nameIn.value.trim(), desc = descIn.value.trim();
        if (isNew && !data) { subMsg(L.needImg); return; }
        if (!name) { subMsg(L.needName); nameIn.focus(); return; }
        if (BAD_NAME.test(name)) { subMsg(L.badName); return; }
        if (st.stickers.items.some(function (x) { return x.name === name && (!it || String(x.id) !== String(it.id)); })) { subMsg(L.nameTaken(name)); return; }
        return (picker ? picker.value() : Promise.resolve(undefined)).then(function (groups) {
          var v = { name: name, desc: desc };
          if (groups) v.groups = groups;
          if (isNew) { v.data = data; return store.add(v); }
          return store.edit(it, v);
        }).then(function () { closeSub(); toast(isNew ? L.saved : L.changed); return load("stickers", true); });
      }, isNew ? L.keep : L.save);
      if (isNew) pickFile();                           // "+" opens the photo picker right away; cancel it and you stay on the form
    }

    function openKaoForm(it) {
      var store = stores.kaomoji, f = document.createElement("div");
      f.className = "cs-dk-form cs-dk-form-kao";
      f.innerHTML = '<label class="cs-dk-field"><span>' + esc(L.text) + '</span><input name="text" class="cs-dk-kao-in" maxlength="80" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="' + esc(L.textPh) + '"></label>' +
        groupsField("kaomoji") + '<p class="cs-dk-msg" hidden></p>';
      var textIn = f.querySelector('input[name="text"]');
      if (it) textIn.value = it.text || "";
      var picker = store.groups ? groupPicker("kaomoji", it ? groupIds(it) : curGroupDefault("kaomoji")) : null;
      if (picker) f.querySelector(".cs-dk-field-g").appendChild(picker.el);
      textIn.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); textIn.blur(); } });
      openSub(it ? L.editKao : L.newKao, f, function () {
        var text = textIn.value.trim();
        if (!text) { subMsg(L.needText); textIn.focus(); return; }
        return (picker ? picker.value() : Promise.resolve(undefined)).then(function (groups) {
          var v = { text: text };
          if (groups) v.groups = groups;
          return it ? store.edit(it, v) : store.add(v);
        }).then(function () { closeSub(); toast(it ? L.changed : L.saved); return load("kaomoji", true); }, function (err) {
          var dup = err && (err.duplicate || (err.data && err.data.duplicate));
          if (dup) { subMsg(L.dupKao(dup.text || "")); return; }
          throw err;
        });
      }, it ? L.save : L.keep);
    }

    /* manage groups: rename (edit the name in place) · ↑↓ reorder · delete (tap twice) · add. Changes apply at once, so no Save. */
    function openGroups(kind) {
      var store = stores[kind], G = store && store.groups, unit = kind === "stickers" ? L.unitStk : L.unitKao;
      var box = document.createElement("div"), hint = kind === "stickers" ? L.hintStk : L.hintKao;
      box.className = "cs-dk-form cs-dk-gman";
      var title = kind === "stickers" ? L.manageStk : L.manageKao;
      if (!G) { box.innerHTML = '<p class="cs-dk-hint">' + esc(hint) + '</p><p class="cs-dk-hint">' + esc(L.noGroupsLib) + "</p>"; openSub(title, box, null); return; }
      var busy = false, delArm = null, delT = 0;
      function countOf(g) { return g.count != null ? g.count : st[kind].items.filter(function (it) { return groupIds(it).indexOf(String(g.id)) >= 0; }).length; }
      function paint(msg) {
        var gs = st[kind].groups;
        box.innerHTML = '<p class="cs-dk-hint">' + esc(hint) + "</p>" +
          (gs.length ? '<ul class="cs-dk-glist">' + gs.map(function (g, i) {
            var armed = delArm === String(g.id);
            return '<li class="cs-dk-grow" data-gid="' + esc(g.id) + '">' +
              '<input class="cs-dk-gname" maxlength="20" enterkeyhint="done" autocomplete="off" aria-label="' + esc(L.groupName) + '" value="' + esc(g.name) + '">' +
              "<small>" + esc(countOf(g) + (unit ? " " + unit : "")) + "</small>" +
              '<button type="button" class="cs-dk-ib" data-gm="up" aria-label="' + esc(L.moveUp) + '"' + (i === 0 ? " disabled" : "") + ">" + ICON.up + "</button>" +
              '<button type="button" class="cs-dk-ib" data-gm="down" aria-label="' + esc(L.moveDown) + '"' + (i === gs.length - 1 ? " disabled" : "") + ">" + ICON.down + "</button>" +
              '<button type="button" class="cs-dk-ib cs-dk-ib-del' + (armed ? " cs-dk-armed" : "") + '" data-gm="del" aria-label="' + esc(armed ? L.delGroupSure : L.delGroup) + '">' + (armed ? esc(L.delGroupShort) : ICON.trash) + "</button></li>";
          }).join("") + "</ul>" : '<p class="cs-dk-hint cs-dk-hint-c">' + esc(L.noGroups) + "</p>") +
          '<div class="cs-dk-gadd"><input class="cs-dk-gadd-in" maxlength="20" enterkeyhint="done" autocomplete="off" placeholder="' + esc(L.newGroupPh) + '"><button type="button" class="cs-dk-btn" data-gm="add">' + esc(L.addGroup) + "</button></div>" +
          '<p class="cs-dk-msg"' + (msg ? "" : " hidden") + ">" + esc(msg || "") + "</p>";
      }
      function run(p, okText) {
        busy = true; delArm = null;
        return Promise.resolve(p).then(function () { return load(kind, true); })
          .then(function () { paint(); if (okText) toast(okText); }, function (err) { paint(errText(err)); })
          .then(function () { busy = false; });
      }
      box.addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-gm]");
        if (!b || busy) return;
        var row = b.closest(".cs-dk-grow"), gid = row ? row.dataset.gid : null, gs = st[kind].groups, act = b.dataset.gm;
        if (act === "up" || act === "down") {
          var ids = gs.map(function (g) { return g.id; }), i = ids.map(String).indexOf(gid), j = i + (act === "up" ? -1 : 1);
          if (i < 0 || j < 0 || j >= ids.length) return;
          var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
          run(G.reorder(ids));
        } else if (act === "del") {
          if (delArm !== gid) {
            delArm = gid; paint(); clearTimeout(delT);
            delT = setTimeout(function () { if (delArm === gid) { delArm = null; paint(); } }, 3000);
            return;
          }
          run(G.remove(idVal(gid)), L.groupDeleted);
        } else if (act === "add") {
          var inp = box.querySelector(".cs-dk-gadd-in"), n = inp ? inp.value.split(/\s+/).join(" ").trim().slice(0, 20) : "";
          if (!n) { if (inp) inp.focus(); return; }
          if (gs.some(function (g) { return g.name === n; })) { paint(L.groupExists(n)); return; }
          run(G.add(n), L.added);
        }
      });
      box.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter") return;
        if (ev.target.classList.contains("cs-dk-gname")) { ev.preventDefault(); ev.target.blur(); }
        else if (ev.target.classList.contains("cs-dk-gadd-in")) { ev.preventDefault(); var b = box.querySelector('[data-gm="add"]'); if (b) b.click(); }
      });
      box.addEventListener("change", function (ev) {
        if (!ev.target.classList.contains("cs-dk-gname") || busy) return;
        var gid = ev.target.closest(".cs-dk-grow").dataset.gid, g = st[kind].groups.find(function (x) { return String(x.id) === gid; });
        var v = ev.target.value.split(/\s+/).join(" ").trim().slice(0, 20);
        if (!g || v === g.name) return;
        if (!v) { ev.target.value = g.name; return; }
        run(G.rename(g.id, v), L.changed);
      });
      paint();
      openSub(title, box, null);
    }

    /* ── one click handler for the whole panel ── */
    root.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var cell = cellAt(t);
      if (cell && Date.now() < quietUntil) return;     // the finger-up right after a long-press opened the sheet
      var act = t.closest("[data-dk-act]");
      if (act) {
        var a = act.dataset.dkAct;
        if (a === "add") { if (view === "stickers") openStickerForm(null); else openKaoForm(null); }
        else if (a === "search") openSearch();
        else if (a === "search-close") closeSearch();
        else if (a === "manage") openGroups(view);
        else if (a === "back") closeSub();
        else if (a === "save") doSave();
        else if (a === "sheet-close") closeSheet();
        else if (a === "edit") {
          var it = sheetItem, k = sheetKind;
          closeSheet();
          if (it) { if (k === "stickers") openStickerForm(it); else openKaoForm(it); }
        } else if (a === "del") {
          if (!sheetItem) return;
          if (!act.classList.contains("cs-dk-armed")) {
            act.classList.add("cs-dk-armed"); act.textContent = L.delSure; clearTimeout(armT);
            armT = setTimeout(function () { act.classList.remove("cs-dk-armed"); act.textContent = L.del; }, 3000);
            return;
          }
          var dIt = sheetItem, dK = sheetKind;
          act.disabled = true;
          Promise.resolve(stores[dK].remove(dIt)).then(function () { closeSheet(); toast(L.deleted); return load(dK, true); })
            .catch(function (err) { act.disabled = false; sheetMsg(errText(err)); });
        } else if (a === "spam") {
          if (!sheetItem || sheetKind !== "stickers") return;
          var sIt = sheetItem;
          remember("stickers", sIt.id);
          closeSheet();
          sendTagNow(tagOf(sIt.name) + "×" + (parseInt(act.dataset.n, 10) || 5), sIt);
        }
        return;
      }
      var vb = t.closest(".cs-dk-seg-b[data-dk-view]");
      if (vb) { if (vb.dataset.dkView !== view) setView(vb.dataset.dkView); return; }
      var gp = t.closest(".cs-dk-g");
      if (gp) {
        st[view].group = gp.dataset.group;
        lsSet("group_" + view, st[view].group);
        applyFilter(view);
        panes[view].scrollTop = 0;
        return;
      }
      if (!cell) return;
      if (cell.classList.contains("cs-dk-st")) {
        var sIt2 = st.stickers.byId[cell.dataset.id];
        if (!sIt2) return;
        if (pickCb) { var cb = pickCb; pickCb = null; root.classList.remove("cs-dk-picking"); close(); cb(tagOf(sIt2.name), sIt2); return; }
        remember("stickers", sIt2.id);
        if (input && input.value.trim()) { insertNoFocus(tagOf(sIt2.name)); hit(cell); return; }   // mid-sentence: insert, don't send or count
        tapSticker(cell, sIt2);
      } else {
        var kIt = st.kaomoji.byId[cell.dataset.id];
        if (!kIt) return;
        remember("kaomoji", kIt.id);
        insertNoFocus(kIt.text);
        hit(cell);
      }
    });

    /* ── open / close: the panel takes the keyboard's place under the composer ── */
    var settleT = 0, pinRaf = 0;
    function nearBottom() { return scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24 : false; }
    function pinToBottom(ms) {
      if (!scroller) return;
      cancelAnimationFrame(pinRaf);
      var until = performance.now() + ms;
      (function step() { scroller.scrollTop = scroller.scrollHeight; if (performance.now() < until) pinRaf = requestAnimationFrame(step); })();
    }
    function markButton() { if (btn) btn.setAttribute("aria-expanded", String(isOpen)); }
    function open() {
      if (isOpen) return;
      var stick = nearBottom();
      if (input && document.activeElement === input) try { input.blur(); } catch (_) {}   // put the soft keyboard away first
      isOpen = true; markButton();
      clearTimeout(settleT);
      root.hidden = false; void root.offsetHeight;
      root.classList.add("open");
      setView(view, true);
      load(view, stale[view]).then(function () { stale[view] = false; });
      if (stick) pinToBottom(reduced() ? 40 : 300);
    }
    function close() {
      if (!isOpen) return;
      var stick = nearBottom();
      flushCombo(); closeSheet();
      if (!sub.hidden) closeSub();
      if (root.classList.contains("cs-dk-searching")) closeSearch();
      if (pickCb) { pickCb = null; root.classList.remove("cs-dk-picking"); }
      isOpen = false; markButton();
      if (root.contains(document.activeElement)) try { document.activeElement.blur(); } catch (_) {}
      root.classList.remove("open");
      clearTimeout(settleT);
      settleT = setTimeout(function () { if (!isOpen) root.hidden = true; }, reduced() ? 0 : 240);
      if (stick) pinToBottom(reduced() ? 40 : 300);
    }
    function toggle() { if (isOpen) close(); else open(); }

    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (pickCb && isOpen) { pickCb = null; root.classList.remove("cs-dk-picking"); return; }   // opened to pick: the button goes back to normal mode
        toggle();
      });
    }
    if (input && o.closeOnInputFocus) input.addEventListener("focus", function () { close(); });   // the keyboard takes its place
    document.addEventListener("pointerdown", function (e) {
      if (!isOpen || root.contains(e.target) || (btn && btn.contains(e.target)) || (dock && dock.contains(e.target))) return;
      close();
    });
    window.addEventListener("keydown", function (e) {   // Esc: sheet → sub-page → search → the panel
      if (e.key !== "Escape" || !isOpen) return;
      if (!sheet.hidden) closeSheet();
      else if (!sub.hidden) closeSub();
      else if (root.classList.contains("cs-dk-searching")) closeSearch();
      else close();
    });

    setView(view, true);
    var api = {
      root: root, open: open, close: close, toggle: toggle, isOpen: function () { return isOpen; },
      select: function (kind) { setView(kind); }, current: function () { return view; },
      flush: flushCombo,
      reload: function () { tabs.forEach(function (t) { stale[t] = true; }); if (isOpen) load(view, true).then(function () { stale[view] = false; }); },
      /* open on the stickers tab to pick one for something else (e.g. a reaction); cb(tag, item) */
      pick: function (cb) {
        if (tabs.indexOf("stickers") < 0) return;
        pickCb = cb; root.classList.add("cs-dk-picking");
        if (view !== "stickers") setView("stickers");
        open(); toast(L.pickFor);
      },
      cancelPick: function () { pickCb = null; root.classList.remove("cs-dk-picking"); },
      stores: stores, labels: L,
    };
    global.StickerDeck = api;
    return api;
  }

  global.ChatStickers = Object.assign(global.ChatStickers || {}, { deck: deck });
})(typeof window !== "undefined" ? window : this);
