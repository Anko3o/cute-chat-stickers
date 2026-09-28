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
