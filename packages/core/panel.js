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
