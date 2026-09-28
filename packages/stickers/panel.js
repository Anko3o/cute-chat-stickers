/*! chat-stickers · panel.js — the sticker drawer. Tap = send (or insert at the caret if you're mid-sentence);
 * add / edit / delete from the top bar; groups from "…" → "Manage groups". Built on core/drawer.js.
 *
 *   StickerPanel.init({ button: "#stickerBtn", input: "#input", send: (text) => mySend(text), api: "" })
 *
 * With `api`, it talks to packages/stickers/serve.py (or server/fastapi_example.py):
 *   GET {api}/stickers · POST {api}/stickers · PUT/DELETE {api}/stickers/<id> · GET {api}/sticker/<name> ·
 *   {api}/stickers/groups (list · add · rename · delete · reorder)
 * Without it, pass `store` (see StickerPanel.localStore) or `listUrl` for a read-only index.json.
 * Adding = upload a picture from this device + name / description / tags / group.
 * Zero dependencies besides core/drawer.js. CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  var L10N = {
    zh: { title: "表情包", name: "名字", namePh: "比如：兔子晕倒", desc: "一句描述", descPh: "不看图也能认出它", tags: "标签", tagsPh: "打完回车接着加", image: "图片", group: "分组" },
    en: { title: "Stickers", name: "Name", namePh: "e.g. dizzy-bunny", desc: "Description", descPh: "so it can be found without seeing it", tags: "Tags", tagsPh: "Enter adds another", image: "Image", group: "Group" },
  };

  var drawer = null, o = null, pickCb = null;

  function httpStore(api, headers) {
    var call = global.ChatDrawer.http(headers);
    return {
      list: function (q) { return call("GET", api + "/stickers" + (q ? "?q=" + encodeURIComponent(q) : "")).then(function (d) { return d.stickers || []; }); },
      add: function (v) { return call("POST", api + "/stickers", v); },
      edit: function (it, v) { return call("PUT", api + "/stickers/" + encodeURIComponent(it.id), { name: v.name, desc: v.desc, tags: v.tags, group: v.group }); },
      remove: function (it) { return call("DELETE", api + "/stickers/" + encodeURIComponent(it.id)); },
      groups: global.ChatDrawer.httpGroups(call, api + "/stickers"),
    };
  }

  /* Browser-only store seeded from an index.json; new pictures are kept as data URLs in localStorage. */
  function localStore(indexUrl, imageBase) {
    var s = global.ChatDrawer.localStore("sticker_shelf_v1", indexUrl,
      function (d) { return (d.stickers || []).map(function (x) { return Object.assign({ aliases: [], tags: [] }, x, { src: imageBase + encodeURIComponent(x.file) }); }); },
      function (v, id) { return { id: id, name: v.name, desc: v.desc || "", tags: v.tags || [], aliases: [], group: v.group == null ? null : v.group, src: v.data }; });
    var edit = s.edit;
    s.edit = function (it, v) {                       // renaming keeps the old name as an alias, like the server does
      var patch = { desc: v.desc, tags: v.tags };
      if ("group" in v) patch.group = v.group;
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
    var tagFields = [
      { key: "name", label: T.name, placeholder: T.namePh, required: true, max: 40 },
      { key: "desc", label: T.desc, placeholder: T.descPh, max: 120 },
      { key: "tags", label: T.tags, placeholder: T.tagsPh, type: "tags" },
      { key: "group", label: T.group, type: "group" },
    ];
    var esc = global.ChatDrawer.esc;
    drawer = global.ChatDrawer.create({
      kind: "stickers", button: o.button, anchor: o.anchor, embed: o.embed, host: o.host, title: T.title, store: store, lang: lang, labels: o.drawerLabels,
      cell: function (it) { return '<img src="' + esc(srcOf(it)) + '" alt="' + esc(it.name) + '" loading="lazy" draggable="false">'; },
      cellTitle: function (it) {
        var g = drawer ? drawer.groupName(it) : "";
        return (it.id ? "#" + it.id + " · " : "") + (it.desc || it.name) + (g ? " · " + g : "");
      },
      fields: { add: [{ key: "data", label: T.image, type: "file", required: true }].concat(tagFields), edit: tagFields },
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
