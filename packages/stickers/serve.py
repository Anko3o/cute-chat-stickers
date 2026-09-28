#!/usr/bin/env python3
"""Minimal sticker + kaomoji server (stdlib only). Binds 127.0.0.1 — put your own auth in front before exposing writes.

  GET    /stickers?q=word          list / search                → {"stickers": [...]}
  GET    /sticker/<name|id>        the image (old names in `aliases` still work)
  POST   /stickers                 {name, desc?, tags?, data: "data:image/png;base64,..."}
  PUT    /stickers/<id>            {name?, desc?, tags?}         renaming keeps the old name as an alias
  DELETE /stickers/<id>

  GET    /kaomoji?q=word           → {"kaomoji": [...]}
  POST   /kaomoji                  {text, group?}               409 {duplicate} if the same key exists
  PUT    /kaomoji/<id>             {text?, group?}
  DELETE /kaomoji/<id>
  POST   /kaomoji/import/preview   {url}   → {url, fetched_at, found, candidates: [...]}   (only what's new)
  POST   /kaomoji/import           {url, fetched_at, items: [{text, group}], offered: [...]}
  GET    /kaomoji/sources          DELETE /kaomoji/sources?url=...

  STICKER_DIR=./stickers python3 serve.py [port]        (STICKER_READONLY=1 turns writes off)
"""
import base64, json, mimetypes, os, re, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.parse import parse_qs, unquote, urlparse
from sticker import DuplicateError, Kaomoji, Shelf, ShelfError, Sources, import_commit, import_preview

shelf, km = Shelf(), Kaomoji()
READONLY = os.environ.get("STICKER_READONLY") == "1"


def add_sticker(b):
    m = re.match(r"^data:image/(png|jpe?g|gif|webp);base64,(.+)$", str(b.get("data") or ""), re.S)
    if not m:
        raise ShelfError("data must be a png/jpg/gif/webp data URL")
    raw = base64.b64decode(m.group(2))
    if len(raw) > 8 * 1024 * 1024:
        raise ShelfError("image over 8 MB")
    return shelf.add(raw, b.get("name"), b.get("desc", ""), b.get("tags"), ext=m.group(1))


# (method, path regex) → handler(match, body, query)
ROUTES = [
    ("POST", r"/stickers", lambda m, b, q: {"sticker": add_sticker(b)}),
    ("PUT", r"/stickers/([^/]+)", lambda m, b, q: {"sticker": shelf.edit(m[1], name=b.get("name"), desc=b.get("desc"), tags=b.get("tags"))}),
    ("DELETE", r"/stickers/([^/]+)", lambda m, b, q: {"sticker": shelf.remove(m[1])}),
    ("POST", r"/kaomoji", lambda m, b, q: {"kaomoji": km.add(b.get("text"), b.get("group", ""))}),
    ("PUT", r"/kaomoji/(\d+)", lambda m, b, q: {"kaomoji": km.edit(m[1], text=b.get("text"), group=b.get("group"))}),
    ("DELETE", r"/kaomoji/(\d+)", lambda m, b, q: {"kaomoji": km.remove(m[1])}),
    ("POST", r"/kaomoji/import/preview", lambda m, b, q: import_preview(km, b.get("url"))),
    ("POST", r"/kaomoji/import", lambda m, b, q: {"added": import_commit(km, b.get("url"), b.get("fetched_at"), b.get("items"), b.get("offered"))}),
    ("DELETE", r"/kaomoji/sources", lambda m, b, q: Sources(km).remove(q.get("url", [""])[0]) or {}),
]


class H(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="application/json; charset=utf-8"):
        body = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query).get("q", [""])[0]
        if u.path == "/stickers":
            return self.send(200, {"stickers": shelf.search(q)})
        if u.path == "/kaomoji":
            return self.send(200, {"kaomoji": km.search(q)})
        if u.path == "/kaomoji/sources":
            return self.send(200, Sources(km).load())
        m = re.match(r"^/sticker/([^/]+)$", u.path)
        fp = m and shelf.path_of(unquote(m.group(1)))
        if not fp:
            return self.send(404, {"error": "not found"})
        with open(fp, "rb") as f:
            self.send(200, f.read(), mimetypes.guess_type(fp)[0] or "application/octet-stream")

    def write(self):
        u = urlparse(self.path)
        for method, pattern, fn in ROUTES:
            m = re.fullmatch(pattern, u.path)
            if method == self.command and m:
                break
        else:
            return self.send(404, {"error": "not found"})
        if READONLY:
            return self.send(403, {"ok": False, "error": "read-only"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n)) if n else {}
            groups = [unquote(g) for g in m.groups()]
            out = fn([m.group(0)] + groups, body if isinstance(body, dict) else {}, parse_qs(u.query))
            return self.send(200, dict(ok=True, **out))
        except DuplicateError as e:                      # same kaomoji key already there → 409 + which one
            return self.send(409, {"ok": False, "error": str(e), "duplicate": e.item})
        except (ShelfError, ValueError, URLError, OSError) as e:
            return self.send(400, {"ok": False, "error": str(getattr(e, "reason", e))})

    do_POST = do_PUT = do_DELETE = write


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print("stickers from %s, kaomoji from %s, on http://127.0.0.1:%d" % (shelf.dir, km.path, port))
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
