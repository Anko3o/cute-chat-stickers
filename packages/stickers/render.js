/*! chat-stickers · render.js — turn [[sticker:name]] (also [[表情:name]], [[sticker:12]]) in chat text into <img>.
 *
 *   StickerRender.config({ src: (name) => "/sticker/" + encodeURIComponent(name) });
 *   StickerRender.into(bubbleEl, messageText);     // escapes the text, swaps sticker tags for images,
 *                                                  // adds .st-only when the message is just one sticker
 *
 * Sticker spam: a tag followed by ×N (× or x / X, N = 2…999), e.g. [[sticker:name]]×5, is drawn as one sticker with a
 * ×N badge. Let it play — the copies pop out one by one under it, slow at first, then faster, the odd pause —
 * by passing options to into():
 *
 *   StickerRender.into(bubbleEl, text, { key: message.id, play: isNew, after: bubbleEl, follow: listEl });
 *     key    — remembers how far each run got, so re-rendering the same message picks up where it was
 *     play   — start now (for a message that just arrived); otherwise it stays stacked and a tap plays it
 *     after  — put the copies right after this element (e.g. the bubble, so they stand outside it);
 *              default: inside the bubble, right under the sticker
 *     end    — line the copies up on the right (your own messages)
 *     follow — the scrolling list: if it's at the bottom, keep it there while the copies come in
 * Zero dependencies. CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  var NAME = "\\[\\[(?:sticker|表情)[:：]\\s*([^\\[\\]\\n<>\"'&]+?)\\s*\\]\\]";
  var TIMES = "(?:[^\\S\\n]*[×xX][^\\S\\n]?(\\d{1,3})(?!\\d))?";
  var TAG = new RegExp(NAME, "g");                  // one sticker tag
  var RUN = new RegExp(NAME + TIMES, "g");          // a tag with an optional ×N after it
  var ONE = new RegExp("^\\s*" + NAME + TIMES + "\\s*$");
  var cfg = {
    src: function (name) { return "/sticker/" + encodeURIComponent(name); },
    tag: function (name) { return "[[sticker:" + name + "]]"; },
    maxCopies: 100,          // at most this many pictures really pop out; the badge still says the full ×N
    tapToPlay: true,         // tap a stacked ×N to play it (again)
  };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* { name, n } if `value` is exactly one sticker tag (n = 1, or the ×N after it), else null. */
  function parseRun(value) {
    var m = ONE.exec(String(value == null ? "" : value));
    if (!m) return null;
    var n = m[2] != null ? parseInt(m[2], 10) : 1;
    return { name: m[1], n: n >= 2 ? n : 1 };
  }
  /* The sticker name if `value` is exactly one sticker tag (a ×N after it is fine), else null. */
  function parse(value) { var r = parseRun(value); return r ? r.name : null; }

  function img(name) { return '<img class="st-inline" src="' + esc(cfg.src(name)) + '" alt="' + esc(name) + '" loading="lazy" draggable="false">'; }

  /* Escaped HTML for a whole message, stickers swapped in, ×N runs wrapped in <span class="st-spam" data-n>. */
  function html(text) {
    var out = "", last = 0, s = String(text == null ? "" : text), m;
    RUN.lastIndex = 0;
    while ((m = RUN.exec(s))) {
      out += esc(s.slice(last, m.index));
      var n = m[2] != null ? parseInt(m[2], 10) : 0;
      if (n >= 2) out += '<span class="st-spam" data-n="' + n + '" role="img" aria-label="' + esc(m[1] + " ×" + n) + '">' + img(m[1]) + "</span>";
      else out += img(m[1]) + esc(m[0].slice(m[0].indexOf("]]") + 2));   // ×0 / ×1: just the picture and the text as written
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }

  /* ── spam playback ── */
  var states = new Map();    // key|index → { n, t0, times, done }
  var live = new Set();      // { st, span, train, opts }
  var timer = 0;
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var s = seed || 1; return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }
  function copiesOf(n) { return Math.max(0, Math.min(n, cfg.maxCopies) - 1); }
  /* like a thumb: the first few slow, then faster, uneven, now and then a little rest */
  function makeTimes(n, seed) {
    var r = rng(seed), t = 0, out = [], c = copiesOf(n);
    for (var i = 0; i < c; i++) {
      var gap = (130 + 300 * Math.exp(-i / 4)) * (0.65 + r() * 0.8);
      if (i > 3 && r() < 0.07) gap += 350 + r() * 650;
      t += gap; out.push(Math.round(t));
    }
    return out;
  }
  function start(key, n, delay) {
    var t0 = Date.now() + (delay || 0), st = { n: n, t0: t0, times: makeTimes(n, hash(key + "|" + t0)), done: false };
    if (key) states.set(key, st);
    return st;
  }
  function due(st, now) { var c = 0, T = st.times; while (c < T.length && T[c] <= now - st.t0) c++; return c; }
  function nearBottom(el) { return el && el.scrollHeight - el.scrollTop - el.clientHeight < 160; }

  function grow(e, now) {
    var want = e.st.done ? e.st.times.length : due(e.st, now), have = e.train.childElementCount;
    if (want <= have) return false;
    var src = e.span.querySelector("img"), w = src && src.offsetWidth, h = src && src.offsetHeight, pop = want - have <= 3;
    var stick = e.opts.follow && nearBottom(e.opts.follow), frag = document.createDocumentFragment();
    for (var i = have; i < want; i++) {
      var c = document.createElement("img");
      c.className = "st-inline st-copy" + (pop ? " st-pop" : "");
      c.src = src ? src.getAttribute("src") : ""; c.alt = ""; c.draggable = false;
      if (w && h) { c.style.width = w + "px"; c.style.height = h + "px"; }   // reserve the size, or a stuck-to-bottom list ends one short
      frag.appendChild(c);
    }
    e.train.appendChild(frag);
    if (stick) e.opts.follow.scrollTop = e.opts.follow.scrollHeight;
    return true;
  }
  function tick() {
    timer = 0;
    var now = Date.now();
    live.forEach(function (e) {
      if (!e.span.isConnected) { live.delete(e); return; }   // re-rendered: the state stays in `states`, into() picks it up
      grow(e, now);
      if (now - e.st.t0 >= (e.st.times[e.st.times.length - 1] || 0)) { e.st.done = true; live.delete(e); }
    });
    if (live.size) timer = setTimeout(tick, 50);
  }
  function attachRun(span, st, train, opts) {
    span.classList.add("st-on");
    var e = { st: st, span: span, train: train, opts: opts };
    grow(e, Date.now());
    if (!st.done && st.times.length) { live.add(e); if (!timer) timer = setTimeout(tick, 50); }
    else st.done = true;
  }
  function trainFor(el, span, i, opts, only) {
    var t = document.createElement("div");
    t.className = "st-train" + (opts.end ? " st-end" : "") + (only ? " st-train-only" : "");
    t.dataset.i = i;
    if (opts.after) {
      var anchor = opts.after === true ? el : opts.after, prev = (el._stTrains || [])[i - 1];
      (prev || anchor).insertAdjacentElement("afterend", t);
    } else span.insertAdjacentElement("afterend", t);
    return t;
  }

  function into(el, text, opts) {
    opts = opts || {};
    (el._stTrains || []).forEach(function (t) { t.remove(); });   // trains left outside by an earlier render of this element
    el._stTrains = [];
    el.innerHTML = html(text);
    var only = parse(text) !== null;
    el.classList.toggle("st-only", only);
    var spans = el.querySelectorAll(".st-spam");
    Array.prototype.forEach.call(spans, function (span, i) {
      var n = parseInt(span.dataset.n, 10) || 0, key = opts.key != null ? String(opts.key) + "|" + i : "";
      span._st = { el: el, i: i, key: key, opts: opts, only: only };
      var st = key ? states.get(key) : null;
      if (st && st.n < n) { st.n = n; st.times = makeTimes(n, hash(key + "|" + st.t0)); st.done = false; }   // a streamed reply grew from ×10 to ×100
      if (!st && opts.play) st = start(key, n, opts.delay != null ? opts.delay : 300);
      if (!st) return;                                 // history: stays stacked with its ×N badge until tapped
      var train = trainFor(el, span, i, opts, only);
      el._stTrains[i] = train;
      attachRun(span, st, train, opts);
    });
    if (!opts.after) el._stTrains = [];                // inside the element: replaced with innerHTML next time anyway
    return el;
  }

  /* tap a stacked ×N: play it */
  function replay(span) {
    var m = span && span._st;
    if (!m) return false;
    var st = start(m.key, parseInt(span.dataset.n, 10) || 0, 120);
    var old = m.opts.after ? (m.el._stTrains || [])[m.i] : span.nextElementSibling;
    if (old && old.classList && old.classList.contains("st-train")) old.remove();
    var train = trainFor(m.el, span, m.i, m.opts, m.only);
    if (m.opts.after) { m.el._stTrains = m.el._stTrains || []; m.el._stTrains[m.i] = train; }
    attachRun(span, st, train, m.opts);
    return true;
  }
  if (typeof document !== "undefined") document.addEventListener("click", function (e) {
    if (!cfg.tapToPlay) return;
    var sp = e.target && e.target.closest && e.target.closest(".st-spam");
    if (sp && !sp.classList.contains("st-on")) replay(sp);
  });

  global.StickerRender = {
    config: function (c) { Object.assign(cfg, c || {}); return this; },
    parse: parse, parseRun: parseRun, html: html, into: into, replay: replay,
    src: function (name) { return cfg.src(name); },
    tag: function (name) { return cfg.tag(name); },
    /* "[[sticker:name]]×5" — what a repeat tap in the deck sends */
    run: function (name, n) { return cfg.tag(name) + (n > 1 ? "×" + n : ""); },
    TAG: TAG, RUN: RUN,
  };
})(typeof window !== "undefined" ? window : this);
