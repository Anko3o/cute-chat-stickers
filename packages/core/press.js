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
