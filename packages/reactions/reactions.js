/*! chat-stickers · reactions.js — long-press a bubble, pick from a 2 × 4 grid, the emoji sticks to the bubble's corner.
 *
 *   Reactions.init({ container: "#messages", getId: (el) => el.closest("[data-id]").dataset.id,
 *                    onReact: (id, value) => sendToServer(id, value) })
 *
 * No text labels in the grid (aria-label only). The 8th cell opens "more": by default the sticker panel
 * (if stickers/panel.js is loaded), so a bubble can get a sticker too. Values are plain strings:
 * an emoji, or a sticker tag like [[sticker:name]].
 * Zero dependencies. MIT (placeholder).
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
