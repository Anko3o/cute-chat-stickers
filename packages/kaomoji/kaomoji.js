/*! chat-stickers · kaomoji.js — the kaomoji drawer, a separate little drawer next to the sticker one.
 * Tap = insert at the caret (never sends). Add / edit / delete from the top bar, same as stickers.
 * "…" → "Import from a web page": paste any kaomoji page, tick the ones you want, file them under a group.
 * Running it again on the same page (Sync) only offers what's new and never touches the ones you edited.
 * Groups are managed from "…" → "Manage groups"; items store only a group id.
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
    en: { title: "Kaomoji", text: "Kaomoji", textPh: "૮₍ ｡• ̫ •｡ ₎ა", group: "Group",
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
      add: function (v) { return call("POST", api + "/kaomoji", { text: v.text, group: v.group }).catch(dupe); },
      edit: function (it, v) { return call("PUT", api + "/kaomoji/" + it.id, { text: v.text, group: v.group }).catch(dupe); },
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
      function (v, id) { return { id: id, text: v.text, key: keyOf(v.text), group: v.group == null ? null : v.group }; });
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
        return edit(it, { text: v.text, group: v.group, key: keyOf(v.text) });
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
          m.items.push({ id: m.next++, text: it.text, key: k, group: it.group == null ? null : it.group, source: { url: p.url, fetched_at: p.fetched_at } });
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

  /* Step 1: URL. Step 2: tick candidates, pick a group, keep. */
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
      drawer.ensureGroup(picker.value()).then(function (group) {
        var items = Array.from(f.querySelectorAll('input[name="c"]:checked')).map(function (x) { return { text: c[+x.value].text, group: group }; });
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
      { key: "group", label: T.group, type: "group" },
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
