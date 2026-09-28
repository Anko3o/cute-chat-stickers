/*! chat-stickers · emoji-bg.js — each person picks one emoji; both get scattered across the same chat background.
 *
 *   EmojiBg.init({ me: { id: "a", name: "A", emoji: "🐰" }, others: [{ id: "b", name: "B", emoji: "🦊" }],
 *                  endpoint: "/chat-bg", events: "/events", container: "#messages" })
 *
 * - The layer is `position:fixed`, `pointer-events:none`, and is only re-scattered when an emoji or the
 *   viewport grid changes — scrolling never repaints it.
 * - Layout is deterministic (seeded by the emoji pair + grid size + `seed`), so two same-sized screens match.
 * - The page background is tinted a little towards the emojis' average colour (`mix`), less when the colour is grey.
 * - State is shared through a tiny adapter: GET/PUT `endpoint` + an SSE stream by default (see server/PROTOCOL.md),
 *   localStorage when there is no endpoint, or bring your own `adapter: { load, save, subscribe }`.
 * Zero dependencies. CC BY-NC-SA 4.0.
 */
(function (global) {
  "use strict";

  var EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

  var L10N = {
    zh: {
      title: "聊天背景", close: "不改了", ok: "就这样贴", remove: "移除", me: "我", you: "你",
      picked: function (n, e) { return n + "已选择" + e; }, none: function (n) { return n + "还没贴"; },
      set: function (n, e) { return n + "给背景贴了一个 " + e; }, unset: function (n, e) { return n + "揭下了背景上的" + e; },
      addYours: "贴一个", failed: "没贴上，再试一次", recentEmpty: "贴过的会排在这里", tabs: "emoji 分类",
      cats: { recent: "最近使用", face: "表情", animal: "动物与自然", food: "食物", activity: "活动", travel: "旅行", object: "物品", symbol: "符号" },
    },
    en: {
      title: "Chat background", close: "Cancel", ok: "Done", remove: "Remove", me: "Me", you: "You",
      picked: function (n, e) { return n + " picked " + e; }, none: function (n) { return n + ": none yet"; },
      set: function (n, e) { return n + " added " + e + " to the background"; }, unset: function (n, e) { return n + " removed " + e + " from the background"; },
      addYours: "Add yours", failed: "Couldn't save, try again", recentEmpty: "Emoji you use show up here", tabs: "Emoji categories",
      cats: { recent: "Recent", face: "Smileys", animal: "Animals & Nature", food: "Food", activity: "Activities", travel: "Travel", object: "Objects", symbol: "Symbols" },
    },
  };

  var CATS = [
    { id: "recent", icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>' },
    { id: "face", icon: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.2a4.2 4.2 0 0 0 7 0"/><path d="M9.3 9.6h.01M14.7 9.6h.01"/>',
      list: "😀 😃 😄 😁 😆 🥹 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🫣 🤗 🫡 🤔 🫢 🤭 🤫 🫠 😶 🫥 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 👽 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🫶 👐 🙌 👏 🤝 👍 👎 👊 ✌️ 🤞 🫰 🤟 👌 🤌 👈 👉 🙏 💅 💪 👀 👄 👶 👧 👸 🧚 🧜‍♀️ 🧸" },
    { id: "animal", icon: '<ellipse cx="12" cy="15.5" rx="4.2" ry="3.4"/><circle cx="6.2" cy="10.4" r="1.7"/><circle cx="9.6" cy="6.8" r="1.7"/><circle cx="14.4" cy="6.8" r="1.7"/><circle cx="17.8" cy="10.4" r="1.7"/>',
      list: "🐰 🐇 🦊 🐱 🐈 🐶 🐕 🐭 🐹 🐻 🐻‍❄️ 🐼 🐨 🐯 🦁 🐮 🐄 🐷 🐖 🐽 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦢 🦉 🦩 🦚 🦜 🦇 🐺 🐗 🐴 🦄 🦓 🦌 🦙 🦘 🦥 🦦 🦨 🦡 🐿️ 🦔 🐝 🪲 🐞 🦋 🐌 🐛 🐢 🐍 🦎 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦭 🦈 🐊 🐘 🦒 🦛 🐪 🐾 🌸 🌷 🌹 🥀 🌺 🌻 🌼 💐 🪷 🪻 🌱 🌿 ☘️ 🍀 🍃 🍂 🍁 🍄 🌵 🌴 🌳 🌲 🪴 🌾 🌙 🌛 🌝 🌚 ⭐ 🌟 ✨ ⚡ ☄️ 🔥 🌈 ☀️ 🌤️ ⛅ ☁️ 🌧️ ⛈️ ❄️ ☃️ ⛄ 🌊 💧 🫧 🌍 🪐" },
    { id: "food", icon: '<path d="M12 8.2c-1.6-1.3-5.2-1.1-6 2.4-.8 3.5 1.8 8.4 4 8.4.8 0 1.2-.4 2-.4s1.2.4 2 .4c2.2 0 4.8-4.9 4-8.4-.8-3.5-4.4-3.7-6-2.4Z"/><path d="M12 8.2c0-2 .8-3.4 2.4-4.2"/>',
      list: "🍓 🍒 🍑 🍎 🍏 🍐 🍊 🍋 🍌 🍉 🍇 🫐 🍈 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥕 🌽 🌶️ 🥒 🥬 🥦 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 🫖 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🍸 🍹 🧉 🧊" },
    { id: "activity", icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2l3.2 2.3-1.2 3.8h-4l-1.2-3.8Z"/><path d="M12 3.5v3.7M15.2 9.5l4.6-1.3M14 13.3l2.6 4.4M10 13.3l-2.6 4.4M8.8 9.5 4.2 8.2"/>',
      list: "⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🏓 🏸 🏒 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 🏂 🏋️ 🤸 ⛹️ 🤺 🏇 🧘 🏄 🏊 🚴 🧗 🏆 🥇 🥈 🥉 🏅 🎖️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🪗 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🕹️ 🎰 🧩" },
    { id: "travel", icon: '<path d="M4.5 15.5v-3.2l2-4.3a1.6 1.6 0 0 1 1.5-1h8a1.6 1.6 0 0 1 1.5 1l2 4.3v3.2Z"/><path d="M4.5 12.3h15"/><circle cx="8" cy="15.8" r="1.6"/><circle cx="16" cy="15.8" r="1.6"/>',
      list: "🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🛵 🏍️ 🛺 🚲 🛴 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🛖 🏠 🏡 🏘️ 🏗️ 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🛕 🕍 ⛩️ 🗾 🎑 🏞️ 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙️ 🌃 🌌 🌉 🌁" },
    { id: "object", icon: '<path d="M9 17.5h6M9.8 20h4.4"/><path d="M12 3.8a5.6 5.6 0 0 0-3.4 10c.5.4.8 1 .8 1.7v.5h5.2v-.5c0-.7.3-1.3.8-1.7a5.6 5.6 0 0 0-3.4-10Z"/>',
      list: "💡 🔦 🕯️ 🪔 🧸 🪆 🎀 🎁 🎈 🎏 🎐 🧧 ✉️ 💌 📮 📦 📜 📃 📄 📑 📊 📈 📉 🗒️ 🗓️ 📆 📅 📇 🗃️ 🗳️ 🗄️ 📋 📁 📂 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇️ 📐 📏 🧮 📌 📍 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓 🔑 🗝️ 🔨 🪄 ⚙️ 🧲 🧪 🔭 🔬 💊 🩹 🧴 🧼 🪥 🧽 🪞 🛁 🛏️ 🛋️ 🪑 🚪 🪟 🧺 🧻 🪣 🧹 🧯 🛒 👑 💍 💎 👒 🎩 👓 🕶️ 👗 👘 👙 👚 👛 👜 👝 🎒 👠 👡 👢 🧦 🧤 🧣 💄 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💽 💾 💿 📀 🎥 📷 📸 📹 📼 🔮 🧿 🪬 📿 🕰️ ⏰ ⏳ 🔔 🎵 🎶 📣 📢 🔇" },
    { id: "symbol", icon: '<path d="M12 19.2S4.5 14.8 4.5 9.6A3.9 3.9 0 0 1 12 7.8a3.9 3.9 0 0 1 7.5 1.8c0 5.2-7.5 9.6-7.5 9.6Z"/>',
      list: "❤️ 🩷 🧡 💛 💚 💙 🩵 💜 🤎 🖤 🩶 🤍 ❤️‍🔥 ❤️‍🩹 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ☯️ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ ⚛️ 🉑 🈶 🈚 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨️ ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🔱 ⚜️ 🔰 ♻️ ✅ ❇️ ✳️ ❎ 🌐 💠 🌀 💤 🆗 🆙 🆒 🆕 🆓 ➕ ➖ ➗ ✖️ ♾️ 〰️ ➰ ➿ ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🟫 💬 💭 🗯️ ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄" },
  ];

  var DEFAULTS = {
    me: { id: "me", name: "", emoji: "🐰" },
    others: [{ id: "other", name: "", emoji: "🦊" }],
    endpoint: null,          // GET → state, PUT {emoji} → {state}
    headers: null,           // object, or function returning one (add your auth header here)
    events: null,            // SSE url; messages shaped {type: eventName, state, by}
    eventName: "chat_bg",
    adapter: null,           // { load(): Promise<state>, save(emoji): Promise<state>, subscribe(cb) }
    container: null,         // message list; with press.js loaded, long-pressing its empty area opens the picker
    longPress: true,
    longPressMs: 500,
    insertBefore: null,      // element/selector the layer is inserted before (default: first child of <body>)
    cellSize: 0,             // px per grid cell; 0 = 124 on phones, 170 on wide screens
    densityPerScreen: 0,     // or: roughly how many emoji per screen (overrides cellSize)
    mix: { day: 0.12, night: 0.06 },   // how far the background moves towards the emoji colour
    seed: "",
    isNight: null,           // () => boolean; default: <html data-cs-theme>, else prefers-color-scheme
    enabled: null,           // () => boolean; e.g. only in some rooms. Call EmojiBg.refresh() when it changes.
    lang: null,              // "zh" | "en" (default from navigator.language)
    labels: null,            // override any L10N key
    recentKey: "emoji_bg_recent_v1",
    onChange: null,          // (state, by) => void
    toast: null,             // (text) => void, for save errors
  };

  /* ── helpers ── */
  function hash(str) {                                      // FNV-1a
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {                                      // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function $(x) { return typeof x === "string" ? document.querySelector(x) : x; }
  function svg(inner) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>"; }

  /* ── scatter: one emoji per grid cell at most ── */
  var SIZES = [0.20, 0.28, 0.38, 0.52], SIZE_W = [0.30, 0.30, 0.25, 0.15];
  function cellFor(w, h, o) {
    if (o.densityPerScreen > 0) return Math.max(40, Math.min(400, Math.sqrt((w * h * 0.86) / o.densityPerScreen)));
    return o.cellSize || (w < 600 ? 124 : 170);
  }
  function scatter(box, w, h, list, cell, seed) {
    box.textContent = "";
    if (!list.length || w < 10 || h < 10) return 0;
    var cols = Math.max(3, Math.round(w / cell));
    var cw = w / cols, ch = cw * 1.02, rows = Math.ceil(h / ch) + 1;
    var rand = rng(hash(list.join("|") + ":" + cols + ":" + (seed || "")));
    var frag = document.createDocumentFragment(), n = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (rand() < 0.14) continue;                          // leave some air
        var pick = list.length === 1 ? 0 : (r + c) % list.length;
        if (list.length > 1 && rand() < 0.22) pick = (pick + 1) % list.length;
        var u = rand(), tier = 0, acc = 0;
        for (var i = 0; i < SIZE_W.length; i++) { acc += SIZE_W[i]; if (u <= acc) { tier = i; break; } }
        var size = Math.round(cw * SIZES[tier] * (0.9 + rand() * 0.2));
        var pad = size * 0.6;
        var x = c * cw + pad + rand() * Math.max(1, cw - pad * 2);
        var y = r * ch - ch * 0.35 + pad + rand() * Math.max(1, ch - pad * 2);
        var rot = Math.round((rand() - 0.5) * 28);
        var alpha = (0.72 + rand() * 0.28).toFixed(2);
        var s = document.createElement("span");
        s.className = "ebg-e";
        s.textContent = list[pick];
        s.style.cssText = "left:" + x.toFixed(1) + "px;top:" + y.toFixed(1) + "px;font-size:" + size + "px;transform:translate(-50%,-50%) rotate(" + rot + "deg);opacity:" + alpha;
        frag.appendChild(s);
        n++;
      }
    }
    box.appendChild(frag);
    return n;
  }

  /* ── average emoji colour → background tint ── */
  var colorCache = new Map();
  function emojiColor(e) {
    if (colorCache.has(e)) return colorCache.get(e);
    var out = null;
    try {
      var S = 40, cv = document.createElement("canvas");
      cv.width = S; cv.height = S;
      var cx = cv.getContext("2d", { willReadFrequently: true });
      cx.textAlign = "center"; cx.textBaseline = "middle";
      cx.font = "32px " + EMOJI_FONT;
      cx.fillText(e, S / 2, S / 2 + 2);
      var d = cx.getImageData(0, 0, S, S).data, r = 0, g = 0, b = 0, wsum = 0;
      for (var i = 0; i < d.length; i += 4) {
        var a = d[i + 3];
        if (a < 48) continue;
        r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; wsum += a;
      }
      if (wsum > 0) out = { r: r / wsum, g: g / wsum, b: b / wsum };
    } catch (_) {}
    colorCache.set(e, out);
    return out;
  }
  function tintFor(list, night, mix) {
    var cols = list.map(emojiColor).filter(Boolean);
    if (!cols.length) return "transparent";
    var c = cols.reduce(function (a, x) { return { r: a.r + x.r / cols.length, g: a.g + x.g / cols.length, b: a.b + x.b / cols.length }; }, { r: 0, g: 0, b: 0 });
    var mx = Math.max(c.r, c.g, c.b) / 255, mn = Math.min(c.r, c.g, c.b) / 255;
    var L = (mx + mn) / 2, sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * L - 1));
    var k = Math.max(0.25, Math.min(1, (sat - 0.08) / 0.30)); // greyish colours tint less
    if (L > 0.86 || L < 0.18) k *= 0.6;
    var a = (night ? mix.night : mix.day) * k;
    return "rgba(" + Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b) + "," + a.toFixed(3) + ")";
  }

  /* ── adapters ── */
  function httpAdapter(o) {
    function hdr(extra) { var h = typeof o.headers === "function" ? o.headers() : (o.headers || {}); return Object.assign({}, h, extra || {}); }
    return {
      load: function () {
        return fetch(o.endpoint, { headers: hdr(), cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
      },
      save: function (emoji) {
        return fetch(o.endpoint, { method: "PUT", headers: hdr({ "Content-Type": "application/json" }), body: JSON.stringify({ emoji: emoji }) })
          .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then(function (d) { return d && d.state ? d.state : null; });
      },
      subscribe: function (cb) {
        if (!o.events || typeof EventSource === "undefined") return;
        var es = new EventSource(o.events);
        es.onmessage = function (ev) {
          try { var d = JSON.parse(ev.data); if (d && d.type === o.eventName && d.state) cb(d.state, d.by); } catch (_) {}
        };
      },
    };
  }
  function localAdapter(o, meId) {
    var KEY = "emoji_bg_state_v1";
    function read() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (_) { return {}; } }
    return {
      load: function () { return Promise.resolve(read()); },
      save: function (emoji) {
        var s = read(); s[meId] = { emoji: emoji, updated_at: new Date().toISOString() };
        try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {}
        return Promise.resolve(s);
      },
      subscribe: function (cb) { window.addEventListener("storage", function (e) { if (e.key === KEY) cb(read()); }); },
    };
  }

  /* ── the widget ── */
  var o = null, L = null, people = [], state = {}, layer = null, sheet = null, press = null;
  var draft = "", openedAt = 0, saving = false, paintedKey = "", adapter = null;

  function isNight() {
    if (o.isNight) return !!o.isNight();
    var t = document.documentElement.dataset.csTheme;                    // same switch as core/theme.css
    if (t === "dark" || t === "light") return t === "dark";
    return !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function isEnabled() { return o.enabled ? !!o.enabled() : true; }
  function listOf(s) { return people.map(function (p) { return s[p.id] && s[p.id].emoji; }).filter(Boolean); }
  function nameOf(id) { var p = people.find(function (x) { return x.id === id; }); return (p && p.name) || id; }
  function toast(t) { if (o && o.toast) o.toast(t); }

  function paint(force) {
    if (!layer) return;
    var list = listOf(state);
    var w = window.innerWidth, h = Math.max(window.innerHeight, document.documentElement.clientHeight || 0);
    var cell = cellFor(w, h, o);
    var key = list.join("|") + "@" + Math.round(w / cell) + "x" + Math.ceil(h / 40);
    document.documentElement.style.setProperty("--ebg-tint", tintFor(list, isNight(), o.mix));
    document.documentElement.dataset.emojiBg = isEnabled() && list.length ? "on" : "off";
    document.documentElement.dataset.emojiBgNight = isNight() ? "1" : "0";
    if (!force && key === paintedKey) return;
    paintedKey = key;
    scatter(layer, w, h, list, cell, o.seed);
  }

  function apply(next, by) {
    if (!next || typeof next !== "object") return;
    var changed = false;
    people.forEach(function (p) {
      var v = next[p.id];
      if (v && typeof v.emoji === "string" && (!state[p.id] || state[p.id].emoji !== v.emoji)) {
        state[p.id] = { emoji: v.emoji, updated_at: v.updated_at || "" };
        changed = true;
      }
    });
    paint();
    if (sheet && !sheet.hidden) paintSheet();
    if (changed && o.onChange) o.onChange(getState(), by);
  }
  function getState() { return JSON.parse(JSON.stringify(state)); }
  function reload() { return adapter.load().then(function (s) { apply(s); }).catch(function () {}); }

  /* recent picks (this device only) */
  function recent() { try { var v = JSON.parse(localStorage.getItem(o.recentKey) || "[]"); return Array.isArray(v) ? v.slice(0, 16) : []; } catch (_) { return []; } }
  function pushRecent(e) {
    if (!e) return;
    try { localStorage.setItem(o.recentKey, JSON.stringify([e].concat(recent().filter(function (x) { return x !== e; })).slice(0, 16))); } catch (_) {}
  }

  /* ── picker sheet ── */
  function ensureSheet() {
    if (sheet) return sheet;
    sheet = document.createElement("div");
    sheet.className = "ebg-sheet";
    sheet.hidden = true;
    var others = people.filter(function (p) { return p.id !== o.me.id; });
    sheet.innerHTML =
      '<div class="ebg-scrim" data-ebg="close"></div>' +
      '<section class="ebg-panel" role="dialog" aria-modal="true" aria-labelledby="ebgTitle">' +
        '<header class="ebg-head">' +
          '<button type="button" class="ebg-icon" data-ebg="close" aria-label="' + esc(L.close) + '">' + svg('<path d="m7 7 10 10M17 7 7 17"/>') + "</button>" +
          '<h2 class="ebg-title" id="ebgTitle">' + esc(L.title) + "</h2>" +
          '<button type="button" class="ebg-icon ebg-ok" data-ebg="ok" aria-label="' + esc(L.ok) + '">' + svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>') + "</button>" +
        "</header>" +
        '<div class="ebg-preview"><div class="ebg-preview-field" aria-hidden="true"></div>' +
          '<div class="ebg-pills">' +
            '<span class="ebg-others">' + others.map(function (p) { return '<span class="ebg-pill ebg-pill-other" data-who="' + esc(p.id) + '"></span>'; }).join("") + "</span>" +
            '<span class="ebg-pill ebg-pill-mine"><span class="ebg-pill-t"></span><button type="button" class="ebg-remove" data-ebg="remove">' + esc(L.remove) + "</button></span>" +
          "</div>" +
        "</div>" +
        '<nav class="ebg-tabs" role="tablist" aria-label="' + esc(L.tabs) + '">' +
          CATS.map(function (c, i) { var n = L.cats[c.id]; return '<button type="button" class="ebg-tab' + (i === 0 ? " on" : "") + '" role="tab" data-cat="' + c.id + '" aria-label="' + esc(n) + '" title="' + esc(n) + '">' + svg(c.icon) + "</button>"; }).join("") +
        "</nav>" +
        '<div class="ebg-grid-wrap"></div>' +
      "</section>";
    document.body.appendChild(sheet);
    sheet.addEventListener("click", onSheetClick);
    sheet.querySelector(".ebg-grid-wrap").addEventListener("scroll", syncTabs, { passive: true });
    return sheet;
  }
  function paintGrid() {
    var rec = recent();
    sheet.querySelector(".ebg-grid-wrap").innerHTML = CATS.map(function (c) {
      var list = c.id === "recent" ? rec : c.list.split(/\s+/).filter(Boolean);
      var body = list.length
        ? '<div class="ebg-grid">' + list.map(function (e) { return '<button type="button" class="ebg-cell" data-emoji="' + esc(e) + '" aria-label="' + esc(e) + '">' + esc(e) + "</button>"; }).join("") + "</div>"
        : '<p class="ebg-empty">' + esc(L.recentEmpty) + "</p>";
      return '<section class="ebg-sec" data-sec="' + c.id + '"><h3 class="ebg-sec-t">' + esc(L.cats[c.id]) + "</h3>" + body + "</section>";
    }).join("");
  }
  function paintSheet() {
    if (!sheet) return;
    var preview = {};
    people.forEach(function (p) { preview[p.id] = p.id === o.me.id ? { emoji: draft } : state[p.id]; });
    var list = listOf(preview);
    var field = sheet.querySelector(".ebg-preview-field");
    sheet.querySelector(".ebg-preview").style.setProperty("--ebg-tint", tintFor(list, isNight(), o.mix));
    var r = field.getBoundingClientRect();
    scatter(field, r.width || 320, r.height || 200, list, 92, o.seed);
    sheet.querySelectorAll(".ebg-pill-other").forEach(function (el) {
      var id = el.dataset.who, e = state[id] && state[id].emoji;
      el.textContent = e ? L.picked(nameOf(id), e) : L.none(nameOf(id));
    });
    sheet.querySelector(".ebg-pill-mine .ebg-pill-t").textContent = draft ? L.picked(L.me, draft) : L.none(L.me);
    sheet.querySelector(".ebg-remove").hidden = !draft;
    sheet.querySelector(".ebg-ok").disabled = draft === ((state[o.me.id] && state[o.me.id].emoji) || "");
    sheet.querySelectorAll(".ebg-cell").forEach(function (b) { b.classList.toggle("on", !!draft && b.dataset.emoji === draft); });
  }
  function syncTabs() {
    var wrap = sheet.querySelector(".ebg-grid-wrap");
    var top = wrap.getBoundingClientRect().top + 8, cur = CATS[0].id;
    sheet.querySelectorAll(".ebg-sec").forEach(function (s) { if (s.getBoundingClientRect().top <= top) cur = s.dataset.sec; });
    sheet.querySelectorAll(".ebg-tab").forEach(function (t) { t.classList.toggle("on", t.dataset.cat === cur); });
  }
  function onSheetClick(e) {
    var t = e.target.closest("[data-ebg], .ebg-tab, .ebg-cell");
    if (!t || Date.now() - openedAt < 450) return;          // the click that iOS sends when the long-press finger lifts
    if (t.classList.contains("ebg-cell")) { draft = t.dataset.emoji; paintSheet(); return; }
    if (t.classList.contains("ebg-tab")) {
      var sec = sheet.querySelector('.ebg-sec[data-sec="' + t.dataset.cat + '"]');
      var wrap = sheet.querySelector(".ebg-grid-wrap");
      if (sec) wrap.scrollTo({ top: sec.offsetTop - wrap.offsetTop, behavior: "smooth" });
      sheet.querySelectorAll(".ebg-tab").forEach(function (x) { x.classList.toggle("on", x === t); });
      return;
    }
    var act = t.dataset.ebg;
    if (act === "close") close();
    else if (act === "remove") { draft = ""; paintSheet(); }
    else if (act === "ok") save(draft);
  }
  function save(emoji) {
    if (saving || emoji === ((state[o.me.id] && state[o.me.id].emoji) || "")) return Promise.resolve();
    saving = true;
    return adapter.save(emoji)
      .then(function (s) {
        var next = s || {}; if (!s) { next[o.me.id] = { emoji: emoji }; }
        apply(next, o.me.id); pushRecent(emoji); close();
      })
      .catch(function () { toast(L.failed); })
      .then(function () { saving = false; });
  }
  function open() {
    if (!isEnabled()) return;
    ensureSheet();
    if (!sheet.hidden) return;
    try { var ae = document.activeElement; if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT")) ae.blur(); } catch (_) {}
    draft = (state[o.me.id] && state[o.me.id].emoji) || "";
    openedAt = Date.now();
    paintGrid();
    sheet.hidden = false;
    requestAnimationFrame(function () {
      sheet.classList.add("open");
      paintSheet();
      sheet.querySelector(".ebg-grid-wrap").scrollTop = 0;
      syncTabs();
    });
    reload();
  }
  function close() {
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove("open");
    setTimeout(function () { if (!sheet.classList.contains("open")) sheet.hidden = true; }, 260);
  }

  /* A system line for the chat stream: "B added 🦊 to the background  [Add yours]" */
  function notice(ev) {
    ev = ev || {};
    var mine = ev.who === o.me.id, who = mine ? L.you : nameOf(ev.who);
    var shown = ev.emoji || ev.prev || "";
    var eHtml = '<span class="ebg-notice-e">' + esc(shown) + "</span>";
    var d = document.createElement("div");
    d.className = "ebg-notice";
    d.innerHTML = '<span class="ebg-chip">' + (ev.emoji ? L.set(esc(who), eHtml) : L.unset(esc(who), eHtml)) +
      (mine ? "" : '<button type="button" class="ebg-notice-go">' + esc(L.addYours) + "</button>") + "</span>";
    var go = d.querySelector(".ebg-notice-go");
    if (go) go.addEventListener("click", function (e) { e.stopPropagation(); open(); });
    return d;
  }

  function init(options) {
    o = Object.assign({}, DEFAULTS, options || {});
    o.mix = Object.assign({}, DEFAULTS.mix, o.mix || {});
    var lang = o.lang || (/^zh/i.test(navigator.language || "") ? "zh" : "en");
    L = Object.assign({}, L10N[lang] || L10N.en, o.labels || {});
    L.cats = Object.assign({}, (L10N[lang] || L10N.en).cats, (o.labels && o.labels.cats) || {});
    people = [o.me].concat(o.others || []).slice().sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : 1; }); // same order on every device
    state = {};
    people.forEach(function (p) { state[p.id] = { emoji: p.emoji || "", updated_at: "" }; });
    adapter = o.adapter || (o.endpoint ? httpAdapter(o) : localAdapter(o, o.me.id));

    if (!layer) {
      layer = document.createElement("div");
      layer.className = "ebg-layer";
      layer.setAttribute("aria-hidden", "true");
      var before = $(o.insertBefore);
      if (before && before.parentNode) before.parentNode.insertBefore(layer, before);
      else document.body.insertBefore(layer, document.body.firstChild);
      var rz = 0;
      window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { paint(); }, 160); }, { passive: true });
      if (window.matchMedia) { try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { paint(true); }); } catch (_) {} }
      new MutationObserver(function () { paint(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-cs-theme"] });
      window.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
      document.addEventListener("visibilitychange", function () { if (!document.hidden) reload(); });
    }
    if (o.container && o.longPress && global.ChatPress && !press) {
      press = global.ChatPress.attach({ container: o.container, longPressMs: o.longPressMs, onBackground: open });
    }
    if (adapter.subscribe) adapter.subscribe(function (s, by) { apply(s, by); });
    paint(true);
    reload();
    return api;
  }

  var api = {
    init: init, open: open, close: close, apply: apply, reload: reload, notice: notice,
    state: getState,
    refresh: function () { paint(true); },
    setMix: function (day, night) { if (day != null) o.mix.day = +day; if (night != null) o.mix.night = +night; paint(true); if (sheet && !sheet.hidden) paintSheet(); },
    tintFor: function (list, night) { return tintFor(list, night, o ? o.mix : DEFAULTS.mix); },
    scatter: scatter,
  };
  global.EmojiBg = api;
})(typeof window !== "undefined" ? window : this);
