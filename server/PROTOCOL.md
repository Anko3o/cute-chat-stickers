# Protocol / 接口契约

Everything the front end needs, under one base URL (`api` in `ChatStickers.init`). JSON in, JSON out.
`server/fastapi_example.py` implements all of it; `packages/stickers/serve.py` implements the sticker and kaomoji half with the standard library only.

前端用到的全部接口，挂在同一个前缀下（`ChatStickers.init` 的 `api`）。参考实现见 `server/fastapi_example.py`；只要贴纸和颜文字的话，`packages/stickers/serve.py` 只用标准库。

**Auth is yours / 鉴权由宿主决定.** Every write must know *who* is calling — that is how `PUT /chat-bg` knows whose emoji to change and `POST /react` knows whose reaction it is. The reference server reads a plain `X-User` header so you can try it in two tabs; replace `current_user()` with your own login (session cookie, signed header, anything). The front end sends whatever `headers` you give it. `EventSource` cannot send custom headers, so protect `/events` with a cookie or keep it read-only.

每个写操作都得知道「是谁」。参考后端用的是明文 `X-User` 头，只为两个标签页能试；上线前换成你自己的登录。

---

## Events · 事件流

`GET /events` — Server-Sent Events, one JSON object per `data:` line.

```json
{"type": "chat_bg", "state": {"a": {"emoji": "🐰", "updated_at": "…"}, "b": {"emoji": "🦊", "updated_at": "…"}}, "by": "b", "emoji": "🦊", "prev": "🐷"}
{"type": "reaction", "id": "m42", "reactions": {"a": "❤️", "b": "[[sticker:蝴蝶结]]"}, "by": "b"}
```

If your chat already has a stream, skip `/events` and call `EmojiBg.apply(state)` / `chat.setReactions(id, reactions)` from your own handler. Want a line in the chat ("B added 🦊 to the background")? Save a system message when `chat_bg` changes and render it with `EmojiBg.notice({who, emoji, prev})`.

已有自己的推送通道就不必用 `/events`，收到事件时调 `EmojiBg.apply(state)`、`setReactions(id, reactions)` 即可。聊天流里要一条系统小灰条的话，在后端落一条系统消息，前端用 `EmojiBg.notice({who, emoji, prev})` 画。

## Background emoji · 聊天背景

| | | |
|---|---|---|
| `GET /chat-bg` | → state | `{"<user id>": {"emoji": "🐰", "updated_at": "ISO time"}, …}` |
| `PUT /chat-bg` | `{"emoji": "🦊"}` → `{"ok": true, "changed": true, "state": {…}}` | changes **the caller's** emoji only; `""` removes it |

Validate that `emoji` is one short emoji (the reference rejects ASCII letters/digits, `<>&"'` and anything over 16 code points). Broadcast `chat_bg` after a change.

只改调用者自己那一枚；空字符串＝揭下来。改了就广播 `chat_bg`。

## Reactions · 气泡贴表情

| | | |
|---|---|---|
| `POST /react` | `{"id": "<message id>", "value": "❤️"}` → `{"ok": true, "id": "…", "reactions": {"<user id>": "❤️"}}` | one value per person per message; `""` takes yours off |

`value` is an emoji or a sticker tag `[[sticker:name]]`. Store it with the message so it survives reloads. Broadcast `reaction`.

`value` 是 emoji 或贴纸记号 `[[sticker:名字]]`。跟着消息存，刷新不丢；改了广播 `reaction`。

## Stickers · 表情包库

| | | |
|---|---|---|
| `GET /stickers?q=` | → `{"stickers": [Sticker…], "groups": [Group…]}` | searches name, description, tags, aliases, group name |
| `GET /sticker/<name \| alias \| id>` | → the image | old names keep working after a rename |
| `POST /stickers` | `{"name", "desc"?, "tags"?, "group"?, "data": "data:image/png;base64,…"}` → `{"ok": true, "sticker"}` | png / jpg / gif / webp, ≤ 8 MB |
| `PUT /stickers/<id \| name>` | `{"name"?, "desc"?, "tags"?, "group"?}` → `{"ok": true, "sticker"}` | renaming renames the file and appends the old name to `aliases`; `group` present = move (`null` = ungrouped), absent = keep |
| `DELETE /stickers/<id \| name>` | → `{"ok": true, "sticker"}` | |

```json
{"id": 1, "name": "蝴蝶结", "file": "sample-bow.webp", "desc": "…", "tags": ["示例"], "aliases": [], "group": null, "owner": "a"}
```

`id` is stable and never reused. Names: 1–40 chars, none of `/ \ . : [ ] < > " ' &`. Schema: `packages/stickers/index.schema.json`.

编号稳定、永不复用；改名时文件跟着改，旧名进 `aliases`，历史消息里的 `[[sticker:旧名]]` 不会断图。

## Kaomoji · 颜文字

| | | |
|---|---|---|
| `GET /kaomoji?q=` | → `{"kaomoji": [{"id", "text", "key", "group", "source"?}…], "groups": [Group…]}` | searches text and group name |
| `POST /kaomoji` | `{"text", "group"?}` | one line, ≤ 80 chars; same `key` already there → **409** `{"ok": false, "error", "duplicate": {…the existing one…}}` |
| `PUT /kaomoji/<id>` | `{"text"?, "group"?}` | same 409 if the new text's `key` belongs to another one; `group` present = move, absent = keep |
| `DELETE /kaomoji/<id>` | | |
| `POST /kaomoji/import/preview` | `{"url"}` → `{"url", "fetched_at", "found", "new", "candidates": [{"text", "key", "exists", "existing_id"?}], "known_source"}` | same key twice in one page → only the first; offered by this page before → left out; already saved → `exists: true` (the panel greys it out, unticked) |
| `POST /kaomoji/import` | `{"url", "fetched_at", "items": [{"text", "group"?}], "offered": ["…"]}` → `{"ok": true, "added": […]}` | saves the ticked ones with `source: {url, fetched_at}`; remembers everything offered |
| `GET /kaomoji/sources` | → `{"sources": [{"url", "added_at", "last_fetched_at", "seen": […]}]}` | |
| `DELETE /kaomoji/sources?url=` | | forgets the page; kept kaomoji stay |

**Import rules / 导入规则** (generic, no per-site parsing): public `http(s)` only (private, loopback and link-local addresses are refused, redirects are re-checked), 10 s timeout, 2 MB cap, `text/html` or `text/plain`. Small blocks first — `[data-kaomoji]`, `li`, `td`, `th`, `code`, `button`, `dd`, `dt`, `option` — then other text. Each line / cell is split on tabs and runs of spaces; a piece is a candidate when it is 2–40 characters, has a non-ASCII character, has at least two symbol-like characters (punctuation, symbols, combining marks, or letters/digits borrowed from other scripts such as ૮ ა ᐢ ໒), and is not a word or phrase (no 3+ CJK characters, no run of 4+ letters, no 3+ digits). Pure-ASCII faces like `(\_/)` are not picked up — add those by hand.

**Dedup key / 去重 key.** Every kaomoji stores `key` = NFKC → remove all whitespace, zero-width characters (U+200B–U+200D, U+FEFF) and variation selectors (U+FE0E / U+FE0F) → full-width punctuation (U+FF01–U+FF5E) to half-width. Two kaomoji are the same only when their keys are equal — no fuzzy similarity. Manual add / edit, import preview and import commit all use it; `sticker.py`'s `kaomoji_key()` and `KaomojiBox.key()` give identical results.

每条颜文字存 `key`：NFKC → 去掉全部空白、零宽字符、变体选择符 → 全角标点转半角。key 相同才算重复，不做模糊相似。手动添加、修改、导入预览、导入保存都过这一道。

**Sync / 同步** = import the same URL again. Only new candidates come back; nothing you already saved or edited is touched.

同步＝对同一个网址再导入一次，只端出新出现的；你存过、改过的一条都不动。

## Groups · 分组

Stickers and kaomoji each have their own list of groups, same shape and same endpoints (`<lib>` = `stickers` or `kaomoji`).

| | | |
|---|---|---|
| `GET /<lib>/groups` | → `{"groups": [{"id", "name", "order", "count"}…]}` | in the user's order |
| `POST /<lib>/groups` | `{"name"}` → `{"ok": true, "group"}` | 1–20 chars; a name that exists → **409** `{"duplicate": {…}}` |
| `PUT /<lib>/groups` | `{"order": [id, id, …]}` → `{"ok": true, "groups"}` | reorder; ids left out keep their relative order after the listed ones |
| `PUT /<lib>/groups/<id>` | `{"name"}` → `{"ok": true, "group"}` | rename; same 409 rule |
| `DELETE /<lib>/groups/<id>` | → `{"ok": true, "group"}` | the group's items become ungrouped (`group: null`); nothing else is deleted |

```json
{"groups": [{"id": 1, "name": "开心", "order": 1}, {"id": 6, "name": "困了", "order": 2}], "next_group_id": 12}
```

Items store only `group`: a group id, or `null` for ungrouped. On add / edit the server also accepts a group **name** and creates the group if it's new (the panel creates new groups first and sends the id). Files written by older versions stored group names on the items; they are migrated on load — one group per distinct name, in first-seen order. Group ids are never reused.

条目只存分组 id（未分组是 `null`）；分组单独存一个有序数组。删分组时里面的条目并入「未分组」。旧数据存的是分组名字，读的时候自动迁移。

