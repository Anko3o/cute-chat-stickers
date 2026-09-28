/*! chat-stickers · one entry for all of it — long-press where you want it to stick:
 *    empty chat area → the background (emoji-bg)
 *    a bubble        → that message (reactions: 2 × 4 grid, "+" opens your stickers)
 *    an image        → that picture's message (same grid, or your own onMedia)
 *  plus two drawers next to the composer: stickers (send) and kaomoji (insert).
 *
 *   ChatStickers.init({
 *     container: "#messages", me: { id: "a", name: "A", emoji: "🐰" }, others: [{ id: "b", name: "B", emoji: "🦊" }],
 *     api: "/chat-stickers",                         // one base URL for the reference server, or leave out and pass stores
 *     stickers: { button: "#stickerBtn", input: "#input", send: (text) => send(text) },
 *     kaomoji:  { button: "#kaomojiBtn", input: "#input" },
 *   })
 * Any of background / reactions / stickers / kaomoji can be `false`. MIT (placeholder).
 */
(function (global) {
  "use strict";

  function $(x) { return typeof x === "string" ? document.querySelector(x) : x; }
  function cssEsc(s) { return global.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&"); }

  /* reactions over HTTP + SSE: POST {api}/react {id, value} → {id, reactions}; events {type:"reaction", id, reactions} */
  function httpReactions(api, headers, events) {
    var call = global.ChatDrawer ? global.ChatDrawer.http(headers) : null;
    return {
      react: function (id, value) { return call("POST", api + "/react", { id: id, value: value }).then(function (d) { return d.reactions; }); },
      subscribe: function (cb) {
        if (!events || typeof EventSource === "undefined") return;
        new EventSource(events).addEventListener("message", function (ev) {
          try { var d = JSON.parse(ev.data); if (d && d.type === "reaction") cb(d.id, d.reactions || {}); } catch (_) {}
        });
      },
    };
  }

  function init(opts) {
    var o = Object.assign({
      container: null, me: { id: "me", name: "", emoji: "🐰" }, others: [], bubble: ".bubble", media: "img, video, .media",
      api: null, headers: null, events: undefined, longPressMs: 500, lang: null,
      background: {}, reactions: {}, stickers: {}, kaomoji: {}, onMedia: null,
    }, opts || {});
    var api = o.api;
    var events = o.events !== undefined ? o.events : (api != null ? api + "/events" : null);
    var box = $(o.container);
    var out = { press: null, reactions: {} };

    if (global.StickerRender && api != null) global.StickerRender.config({ src: function (n) { return api + "/sticker/" + encodeURIComponent(n); } });

    if (o.background && global.EmojiBg) {
      global.EmojiBg.init(Object.assign({
        me: o.me, others: o.others, lang: o.lang, headers: o.headers,
        endpoint: api != null ? api + "/chat-bg" : null, events: events,
      }, o.background, { longPress: false }));
    }

    var rx = o.reactions && global.Reactions ? o.reactions : null;
    if (rx) {
      var store = rx.store || (api != null ? httpReactions(api, o.headers, events) : null);
      var state = out.reactions;
      var bubbleOf = rx.bubbleOf || function (id) { return box && box.querySelector('[data-id="' + cssEsc(id) + '"] ' + o.bubble + ', ' + o.bubble + '[data-id="' + cssEsc(id) + '"]'); };
      var paintOne = function (id) { var b = bubbleOf(id); if (b) global.Reactions.paint(b, Object.values(state[id] || {})); };
      var apply = function (id, map) { state[id] = map || {}; paintOne(id); };
      global.Reactions.init(Object.assign({ lang: o.lang, bubble: o.bubble, media: o.media }, rx, {
        container: null,                                   // the shared press below does the long-press
        mine: rx.mine || function (id) { var v = state[id] && state[id][o.me.id]; return v ? [v] : []; },
        onReact: function (id, value, el) {
          var map = Object.assign({}, state[id] || {}); map[o.me.id] = value; apply(id, map);   // optimistic
          if (rx.onReact) rx.onReact(id, value, el);
          if (store) Promise.resolve(store.react(id, value)).then(function (m) { if (m) apply(id, m); }).catch(function () {});
        },
      }));
      if (store && store.subscribe) store.subscribe(apply);
      out.setReactions = apply;
      out.repaintReactions = function () { Object.keys(state).forEach(paintOne); };
    }

    if (box && global.ChatPress) {
      out.press = global.ChatPress.attach({
        container: box, bubble: o.bubble, media: o.media, longPressMs: o.longPressMs,
        onBackground: o.background && global.EmojiBg ? global.EmojiBg.open : null,
        onBubble: rx ? global.Reactions.open : null,
        onMedia: o.onMedia || (rx ? global.Reactions.open : null),
      });
    }

    if (o.stickers && global.StickerPanel) global.StickerPanel.init(Object.assign({ lang: o.lang, api: api, headers: o.headers }, o.stickers));
    if (o.kaomoji && global.KaomojiBox) global.KaomojiBox.init(Object.assign({ lang: o.lang, api: api, headers: o.headers }, o.kaomoji));
    return out;
  }

  global.ChatStickers = { init: init, version: "0.1.0" };
})(typeof window !== "undefined" ? window : this);
