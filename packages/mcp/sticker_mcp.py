#!/usr/bin/env python3
"""sticker-mcp — 表情包抽屉 MCP 服务器（给你的 AI 伴侣用的那一半）。

抽屉是「两个人的」：网页那一半（packages/stickers、packages/kaomoji）给人用，这一半给 AI 用。
接上以后，AI 可以翻你们的表情包库和颜文字库，挑一张贴进回复：
  · 聊天页：回复里写 `[[sticker:名字]]`，前端 `StickerRender.into` 换成 <img>，图不进模型上下文；
  · claude.ai / ChatGPT 这种带不了凭证的官方聊天窗：配上 STICKER_PUBLIC_BASE，工具多回一行
    markdown 图片，AI 原样贴进回复就能显示；图从本服务的 /img/<编号>.<扩展名> 出（只认编号，
    不列目录，只读）。
  · 认 MCP Apps 卡片的宿主（claude.ai，initialize 时报了 io.modelcontextprotocol/ui）：sticker_pick
    挂一张卡片（sticker_app.html，就是一张 <img>，gif 照常动），回话改成「卡片已显示，别再贴图」。
    宿主认不认看它自己报的 capabilities，记在会话号（Mcp-Session-Id）上；没报过的照旧拿标记和 markdown。

零第三方依赖（纯标准库），Streamable HTTP，默认只听回环。库文件直接读 packages/stickers/sticker.py
管的那份（index.json / kaomoji.json），不经过 serve.py，库只读不写；配了 STICKER_SESSIONS_FILE 才会写那一个文件（会话号）。

配置（环境变量）：
  STICKER_DIR           表情包目录（里面是 index.json + 图），默认 ./stickers（同 sticker.py）
  KAOMOJI_FILE          颜文字库，默认 $STICKER_DIR/kaomoji.json，没有就用仓库内置那份
  MCP_HOST / MCP_PORT   本服务监听地址，默认 127.0.0.1:18014
  STICKER_PUBLIC_BASE   可选。图片的公网前缀，如 https://你的域名/stickers ——反代把它指到本服务的 /img/。
                        配了以后 sticker_pick 多回一行 markdown 图片。
  STICKER_INLINE_IMAGE  可选。=1 时 sticker_pick 还会把图作为 MCP image 内容块一起返回
                        （支持的宿主直接显示；会进上下文，按图片计费，默认关）。
  STICKER_INLINE_MAX    内嵌图片上限字节数，默认 524288（512 KB），超过只给链接。
                        认卡片的宿主不内嵌（卡片已经是图了，内嵌会多出一张不动的）。
  STICKER_CARD          默认 1：配了 STICKER_PUBLIC_BASE 就给认卡片的宿主挂卡片。设 0 一概不挂。
  STICKER_ROUTE_SPLIT   默认 0。=1 时按来路只给一种：本机直连的（自家聊天页）只给标记，经反代来的
                        （带 X-Forwarded-For：官方聊天窗、云端 Claude Code）只给 markdown。两种都给的话，
                        认不出自己在哪的窗口会两行都贴，标记就成了一行字。
  STICKER_SESSIONS_FILE 可选。把「会话号 → 认不认卡片」记进这个文件，重启后老会话照样拿卡片。
                        不配就只放内存：重启后宿主得重新连一次（claude.ai 里刷新）才又有卡片。
  MCP_ONE_PER_MESSAGE   默认 1：工具说明里写明「一条消息最多一张」。设 0 去掉这句。
  STICKER_LIB           可选。sticker.py 所在目录（默认本文件旁边的 ../stickers）。

注册示例（Claude Code 的 .mcp.json）：
  { "mcpServers": { "sticker": { "type": "http", "url": "http://127.0.0.1:18014/mcp" } } }

起服务：
  STICKER_DIR=~/my-stickers python3 packages/mcp/sticker_mcp.py
"""
import base64
import json
import mimetypes
import os
import random
import re
import secrets
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
# sticker.py 在仓库的 packages/stickers；把本文件单独拷去别处跑时用 STICKER_LIB 指到那个目录。
sys.path.insert(0, os.environ.get("STICKER_LIB") or os.path.join(HERE, "..", "stickers"))
from sticker import Kaomoji, Shelf, group_names  # noqa: E402

HOST = os.environ.get("MCP_HOST", "127.0.0.1")
PORT = int(os.environ.get("MCP_PORT", "18014"))
PROTOCOL = "2024-11-05"
PUBLIC_BASE = os.environ.get("STICKER_PUBLIC_BASE", "").strip().rstrip("/")
INLINE = os.environ.get("STICKER_INLINE_IMAGE", "0") == "1"
INLINE_MAX = int(os.environ.get("STICKER_INLINE_MAX", str(512 * 1024)))
ONE_PER_MESSAGE = os.environ.get("MCP_ONE_PER_MESSAGE", "1") != "0"
ROUTE_SPLIT = os.environ.get("STICKER_ROUTE_SPLIT", "0") == "1"

# 官端卡片（MCP Apps）。模板 URI 也是宿主的缓存键，卡片有破坏性改动就换版本号。
UI_EXT = "io.modelcontextprotocol/ui"
UI_RESOURCE_URI = "ui://sticker/card-v1.html"
UI_MIME = "text/html;profile=mcp-app"
APP_HTML_PATH = os.path.join(HERE, "sticker_app.html")
CARD = bool(PUBLIC_BASE) and os.environ.get("STICKER_CARD", "1") != "0" and os.path.exists(APP_HTML_PATH)
# 会话号 → 这个宿主认不认卡片。默认只放内存：重启后老会话按不认处理，宁可多一张图，不能一张都不显示。
# claude.ai 不会因为我们重启就重新握手，所以配了 STICKER_SESSIONS_FILE 就记进文件，重启后接着认。
SESSIONS, SESSIONS_MAX, SESSIONS_LOCK = {}, 500, threading.Lock()
SESSIONS_FILE = os.environ.get("STICKER_SESSIONS_FILE", "").strip()
REQ = threading.local()   # 这一次 tools/call 的宿主认不认卡片（.ui）、是不是经反代来的（.proxied），sticker_pick 交回的卡片数据（.struct）

shelf, km = Shelf(), Kaomoji()


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def load_sessions():
    if not SESSIONS_FILE:
        return
    try:
        with open(SESSIONS_FILE, encoding="utf-8") as f:
            saved = json.load(f)
        SESSIONS.update({str(k): bool(v) for k, v in list(saved.items())[-SESSIONS_MAX:]})
    except FileNotFoundError:
        pass
    except Exception as e:
        log(f"sessions file unreadable, starting empty: {e}")


def save_sessions():   # 调用时要持着 SESSIONS_LOCK
    if not SESSIONS_FILE:
        return
    try:
        with open(SESSIONS_FILE + ".tmp", "w", encoding="utf-8") as f:
            json.dump(SESSIONS, f)
        os.replace(SESSIONS_FILE + ".tmp", SESSIONS_FILE)
    except Exception as e:
        log(f"sessions file not saved: {e}")


class ToolError(Exception):
    """工具层的『没成』：抛出来由 tools/call 标 isError。"""


# ── 下层跑腿 ────────────────────────────────────────────────

def ext_of(s):
    return s["file"].rsplit(".", 1)[-1].lower()


def public_url(s):
    """公网图片地址：<STICKER_PUBLIC_BASE>/<编号>.<扩展名>。没配前缀就 None。"""
    if not PUBLIC_BASE:
        return None
    return f"{PUBLIC_BASE}/{s['id']}.{ext_of(s)}"


def line_of(d, s):
    groups = group_names(d, s)
    bits = [f"#{s['id']} {s['name']}"]
    if s.get("desc"):
        bits.append(f"— {s['desc']}")
    if groups:
        bits.append("[" + "/".join(groups) + "]")
    return " ".join(bits)


def pick_group_ids(d, group):
    """分组名（或编号）→ 该组 id；空字符串 → None（不过滤）。找不到报错并列出可选组。"""
    group = str(group or "").strip()
    if not group:
        return None
    for g in d["groups"]:
        if group == g["name"] or group == str(g["id"]):
            return g["id"]
    names = "、".join(g["name"] for g in d["groups"]) or "（还没有分组）"
    raise ToolError(f"没有叫「{group}」的分组。现有分组：{names}")


# ── 工具 ────────────────────────────────────────────────────

UNGROUPED = "没分组"


def t_sticker_list(args):
    # 先按分组选，再按名字选，最后才展开详情：不带参数只报分组，
    # group 列这一组的编号和名字，sticker 看一张的描述；q 照旧按词搜、整行给。
    q = str(args.get("q") or "").strip()
    group = str(args.get("group") or "").strip()
    key = str(args.get("sticker") or "").strip()
    d = shelf.load()
    if not d["stickers"]:
        raise ToolError("表情包库是空的。用 sticker.py add 往库里加，或者先用颜文字。")
    if key:
        s = shelf.find(d, key.lstrip("#"))
        if not s:
            near = shelf.search(key)[:5]
            raise ToolError(f"库里没有「{key}」" + ("；像这几张？" + "、".join(x["name"] for x in near) if near else ""))
        out = [line_of(d, s), "", f"发它就 sticker_pick(sticker={s['name']})。"]
    elif not q and not group:
        counts = [(g["name"], sum(1 for s in d["stickers"] if g["id"] in (s.get("groups") or [])))
                  for g in sorted(d["groups"], key=lambda g: g.get("order", 0))]
        counts.append((UNGROUPED, sum(1 for s in d["stickers"] if not s.get("groups"))))
        out = [f"表情包库 {len(d['stickers'])} 张，先挑一组：",
               " · ".join(f"{n} {c}" for n, c in counts if c),
               "",
               "下一步 sticker_list(group=分组名) 看这一组有哪些。"]
    else:
        if group == UNGROUPED and not any(g["name"] == UNGROUPED for g in d["groups"]):
            items = [s for s in shelf.search(q) if not s.get("groups")]
        else:
            gid = pick_group_ids(d, group)
            items = shelf.search(q)
            if gid is not None:
                items = [s for s in items if gid in (s.get("groups") or [])]
        if not items:
            hint = f"没有和「{q}」沾边的表情包" if q else f"「{group}」这组还没有表情包"
            raise ToolError(hint + "。用 sticker.py add 往库里加，或者先用颜文字。")
        if q:
            out = [f"表情包库（{len(items)} 张，搜「{q}」" + (f"，只看{group}" if group else "") + "）：", ""]
            out += [line_of(d, s) for s in items]
        else:
            out = [f"{group} {len(items)} 张：", ""]
            out += [f"#{s['id']} {s['name']}" for s in items]
            out += ["", "想看哪张的描述就 sticker_list(sticker=名字或编号)。"]
        out += ["", "要发哪张就 sticker_pick(sticker=名字或编号)。"]
    if ONE_PER_MESSAGE:
        out.append("一条消息最多一张。")
    return "\n".join(out), []


def t_sticker_pick(args):
    key = str(args.get("sticker") or "").strip()
    if not key:
        raise ToolError("要告诉我发哪张：sticker=名字或编号（不记得就先 sticker_list）")
    d = shelf.load()
    s = shelf.find(d, key)
    if not s:
        near = shelf.search(key)[:5]
        hint = ("；像这几张？" + "、".join(x["name"] for x in near)) if near else "；先 sticker_list 看看有什么"
        raise ToolError(f"库里没有「{key}」{hint}")
    path = shelf.path_of(s["id"])
    if not path:
        raise ToolError(f"「{s['name']}」登记了但图不见了（{s['file']}）")
    caption = str(args.get("caption") or "").strip()
    url = public_url(s)
    if url and CARD and getattr(REQ, "ui", False):
        REQ.struct = {"url": url, "alt": caption or s.get("desc") or s["name"], "name": s["name"], "id": s["id"]}
        out = [f"已挑好：{line_of(d, s)}",
               "",
               "卡片已经显示在聊天窗里了（会动的那张），不要再贴图、链接或标记。"]
        if ONE_PER_MESSAGE:
            out += ["", "一条消息最多一张。"]
        return "\n".join(out), []
    marker = f"[[sticker:{s['name']}]]"
    md = f"![{caption or s.get('desc') or s['name']}]({url})" if url else ""
    if ROUTE_SPLIT and md and getattr(REQ, "proxied", False):
        out = [f"已挑好：{line_of(d, s)}", "", "把下面这行 markdown 原样贴进回复，只贴这一行：", md]
    elif ROUTE_SPLIT and md:
        out = [f"已挑好：{line_of(d, s)}", "", "把下面这行标记原样写进回复，前端会换成图（图不进上下文）：", marker]
    else:
        out = [f"已挑好：{line_of(d, s)}",
               "",
               "聊天页：把下面这行标记原样写进回复，前端会换成图（图不进上下文）：",
               marker]
        if md:
            out += ["",
                    "官方聊天窗（claude.ai / ChatGPT）：把下面这行 markdown 原样贴进回复：",
                    md]
    if ONE_PER_MESSAGE:
        out += ["", "一条消息最多一张。"]
    extra = []
    if INLINE:
        try:
            size = os.path.getsize(path)
            if size <= INLINE_MAX:
                with open(path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("ascii")
                mime = mimetypes.guess_type(path)[0] or "image/" + ext_of(s)
                extra.append({"type": "image", "data": b64, "mimeType": mime})
            else:
                out.append(f"（图 {size} 字节，超过内嵌上限 {INLINE_MAX}，只给链接）")
        except OSError as e:
            out.append(f"（读图失败：{e}）")
    return "\n".join(out), extra


def t_kaomoji_pick(args):
    q = str(args.get("q") or "").strip()
    n = max(1, min(int(args.get("n") or 1), 10))
    d = km.load()
    gid = pick_group_ids(d, args.get("group"))
    items = km.search(q)
    if gid is not None:
        items = [k for k in items if gid in (k.get("groups") or [])]
    if not items:
        names = "、".join(g["name"] for g in d["groups"])
        raise ToolError(f"没有匹配的颜文字" + (f"（搜「{q}」）" if q else "") + f"。分组有：{names}")
    picks = random.sample(items, min(n, len(items)))
    out = []
    for k in picks:
        g = group_names(d, k)
        out.append(k["text"] + (f"　（{'/'.join(g)}）" if g else ""))
    out.append("")
    out.append(f"从 {len(items)} 条里随机挑的" + (f"，分组：{'、'.join(g['name'] for g in d['groups'])}" if not q and gid is None else "") + "。直接写进回复里就行。")
    return "\n".join(out), []


TOOLS = [
    {"name": "sticker_list",
     "description": "翻表情包库，一层一层看：不带参数只报分组和张数；group=分组名 列这一组的编号和名字；"
                    "sticker=名字或编号 看那一张的描述。q 按名字/描述/分组名/旧名搜，直接给整行。"
                    "开新对话先翻一下分组，知道有什么再挑。",
     "inputSchema": {"type": "object", "properties": {
         "q": {"type": "string", "description": "关键词，空=不搜"},
         "group": {"type": "string", "description": "分组名或编号；没分组的那些写「没分组」"},
         "sticker": {"type": "string", "description": "看某一张的描述：名字或编号"}}}},
    {"name": "sticker_pick",
     "description": "挑一张表情包发出去。回来的是 [[sticker:名字]] 标记（聊天页用）；配了公网前缀时还有一行 "
                    "markdown 图片（claude.ai/ChatGPT 用），照原样贴进回复。"
                    + ("一条消息最多一张。" if ONE_PER_MESSAGE else ""),
     "inputSchema": {"type": "object", "required": ["sticker"], "properties": {
         "sticker": {"type": "string", "description": "名字、旧名或编号"},
         "caption": {"type": "string", "description": "可选，图片的 alt 文字（默认用描述）"}}}},
    {"name": "kaomoji_pick",
     "description": "从颜文字库随机挑几条。group 按分组（开心/撒娇/害羞/委屈/生气/困了/装死/猫/兔/花边/其他，以库里为准），"
                    "q 按文字或分组名搜，n 挑几条（1–10）。",
     "inputSchema": {"type": "object", "properties": {
         "group": {"type": "string", "description": "分组名或编号"},
         "q": {"type": "string", "description": "关键词"},
         "n": {"type": "integer", "description": "挑几条，默认 1，最多 10"}}}},
]

HANDLERS = {"sticker_list": t_sticker_list, "sticker_pick": t_sticker_pick, "kaomoji_pick": t_kaomoji_pick}


def call(name, args):
    fn = HANDLERS.get(name)
    if not fn:
        raise ToolError(f"没有这个工具：{name}")
    return fn(args or {})


# ── HTTP ────────────────────────────────────────────────────

IMG_RE = re.compile(r"^/img/(\d+)\.(png|jpe?g|gif|webp)$")


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        pass

    def _send(self, code, obj, headers=None):
        raw = b"" if obj is None else json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if raw:
            self.wfile.write(raw)

    def _send_img(self, sid, ext):
        """只认编号 + 登记过的扩展名；名字、目录、index.json 都摸不到。"""
        d = shelf.load()
        s = shelf.find(d, sid)
        norm = lambda e: "jpg" if e in ("jpg", "jpeg") else e
        if not s or norm(ext_of(s)) != norm(ext):
            return self._send(404, {"error": "not found"})
        path = shelf.path_of(s["id"])
        if not path:
            return self._send(404, {"error": "not found"})
        with open(path, "rb") as f:
            raw = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        p = self.path.split("?", 1)[0]
        if p.rstrip("/") == "/healthz":
            return self._send(200, {"ok": True, "service": "sticker-mcp"})
        m = IMG_RE.match(p)
        if m:
            return self._send_img(m.group(1), m.group(2).lower())
        if p.rstrip("/") == "/mcp":
            return self._send(405, {"error": "SSE not supported, POST only"})
        self._send(404, {"error": "not found"})

    def do_DELETE(self):
        if self.path.rstrip("/") == "/mcp":
            with SESSIONS_LOCK:
                SESSIONS.pop(self.headers.get("Mcp-Session-Id") or "", None)
                save_sessions()
            return self._send(200, {"ok": True})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?", 1)[0].rstrip("/") != "/mcp":
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            msg = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._send(400, {"error": "bad json"})
        method, mid = msg.get("method"), msg.get("id")
        if mid is None:
            return self._send(202, None)
        sid_in = self.headers.get("Mcp-Session-Id") or ""
        with SESSIONS_LOCK:
            known, ui = sid_in in SESSIONS, SESSIONS.get(sid_in, False)
        headers = None
        if method == "initialize":
            params = msg.get("params") or {}
            client_pv = str(params.get("protocolVersion") or "")
            pv = client_pv if re.match(r"^20\d{2}-\d{2}-\d{2}$", client_pv) else PROTOCOL
            ui = ui_capable(params.get("capabilities"))
            sid = secrets.token_hex(16)
            with SESSIONS_LOCK:
                while len(SESSIONS) >= SESSIONS_MAX:
                    SESSIONS.pop(next(iter(SESSIONS)))
                SESSIONS[sid] = ui
                save_sessions()
            headers = {"Mcp-Session-Id": sid}
            who = params.get("clientInfo") or {}
            log(f"initialize: {who.get('name', '?')} {who.get('version', '')} ui={'yes' if ui else 'no'}")
            r = {"protocolVersion": pv, "capabilities": {"tools": {}, **({"resources": {}} if CARD else {})},
                 "serverInfo": {"name": "sticker", "version": "1.0.0"},
                 "instructions": ("表情包抽屉。开新对话先 sticker_list 翻一遍库；挑好用 sticker_pick，"
                                  "把回来的标记或 markdown 原样写进回复。"
                                  + ("一条消息最多一张表情包。" if ONE_PER_MESSAGE else "")
                                  + "颜文字用 kaomoji_pick，直接写进句子里。只读，不改库。")}
        elif method == "tools/list":
            tools = TOOLS
            if CARD and ui:
                tools = [dict(t, _meta={"ui": {"resourceUri": UI_RESOURCE_URI}}) if t["name"] == "sticker_pick" else t
                         for t in TOOLS]
            r = {"tools": tools}
        elif method == "tools/call":
            p = msg.get("params") or {}
            REQ.ui, REQ.struct, REQ.proxied = ui, None, bool(self.headers.get("X-Forwarded-For"))
            try:
                text, extra = call(p.get("name"), p.get("arguments") or {})
                is_err = False
            except ToolError as e:
                text, extra, is_err = str(e), [], True
            except Exception as e:
                text, extra, is_err = f"执行出错: {e}", [], True
            r = {"content": [{"type": "text", "text": text}] + extra}
            if REQ.struct and not is_err:
                r["structuredContent"] = REQ.struct
            if p.get("name") == "sticker_pick":   # 验卡片用：哪个宿主拿的是卡片、哪个拿的是文字
                log(f"sticker_pick: {'card' if REQ.struct else 'text'}, session {'ui' if ui else 'plain' if known else 'none'}, "
                    f"{'proxy' if REQ.proxied else 'local'}")
            if is_err:
                r["isError"] = True
        elif method == "resources/list":
            r = {"resources": [{"uri": UI_RESOURCE_URI, "name": "sticker card", "mimeType": UI_MIME}] if CARD else []}
        elif method == "resources/templates/list":
            r = {"resourceTemplates": []}
        elif method == "resources/read":
            uri = str((msg.get("params") or {}).get("uri") or "")
            if not (CARD and uri == UI_RESOURCE_URI):
                return self._send(200, {"jsonrpc": "2.0", "id": mid,
                                        "error": {"code": -32002, "message": f"resource not found: {uri}"}})
            with open(APP_HTML_PATH, encoding="utf-8") as f:
                html = f.read()
            origin = re.match(r"^https?://[^/]+", PUBLIC_BASE).group(0)   # 卡片 iframe 只放行图床这一个源
            r = {"contents": [{"uri": uri, "mimeType": UI_MIME, "text": html,
                               "_meta": {"ui": {"csp": {"resourceDomains": [origin], "connectDomains": []},
                                                "prefersBorder": False}}}]}
        elif method == "ping":
            r = {}
        else:
            return self._send(200, {"jsonrpc": "2.0", "id": mid,
                                    "error": {"code": -32601, "message": f"method not found: {method}"}})
        self._send(200, {"jsonrpc": "2.0", "id": mid, "result": r}, headers)


def ui_capable(caps):
    """宿主 initialize 时报没报 MCP Apps：capabilities.extensions[io.modelcontextprotocol/ui]，
    列了 mimeTypes 的话还得有 text/html;profile=mcp-app。"""
    caps = caps if isinstance(caps, dict) else {}
    for box in (caps.get("extensions"), caps.get("experimental")):
        v = box.get(UI_EXT) if isinstance(box, dict) else None
        if v is None or v is False:
            continue
        mimes = v.get("mimeTypes") if isinstance(v, dict) else None
        return not mimes or UI_MIME in mimes
    return False


if __name__ == "__main__":
    log(f"sticker-mcp on http://{HOST}:{PORT}/mcp  (stickers: {shelf.dir}; kaomoji: {km.path})")
    if PUBLIC_BASE:
        log(f"public images: {PUBLIC_BASE}/<id>.<ext>  →  /img/")
    log(f"cards for MCP Apps hosts: {'on' if CARD else 'off'}")
    log(f"route split (local → marker, proxied → markdown): {'on' if ROUTE_SPLIT else 'off'}")
    load_sessions()
    if SESSIONS_FILE:
        log(f"sessions: {SESSIONS_FILE} ({len(SESSIONS)} kept)")
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
