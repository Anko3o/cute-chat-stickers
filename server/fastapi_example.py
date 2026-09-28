"""Reference backend for chat-stickers: every endpoint the front end talks to, in one FastAPI app.

    pip install fastapi uvicorn
    STICKER_DIR=../packages/stickers/stickers uvicorn fastapi_example:app --port 8000

It keeps chat-bg and reactions in memory and the sticker / kaomoji library on disk (via packages/stickers/sticker.py).
Who is calling comes from `current_user()` — a plain X-User header here so you can try it with two tabs.
REPLACE IT with your own login before this leaves your laptop. See PROTOCOL.md for the shapes.
"""
import asyncio, base64, json, os, re, sys, time

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packages", "stickers"))
from sticker import KEEP, DuplicateError, Kaomoji, Shelf, ShelfError, Sources, import_commit, import_preview  # noqa: E402

PEOPLE = {"a": "🐰", "b": "🦊"}          # participant id → default emoji
app = FastAPI(title="chat-stickers reference server")
shelf, km = Shelf(), Kaomoji()
chat_bg = {who: {"emoji": e, "updated_at": ""} for who, e in PEOPLE.items()}
reactions: dict = {}                     # message id → {user id: value}
listeners: set = set()


def current_user(request: Request) -> str:
    who = request.headers.get("x-user", "")          # demo only — use your session / auth here
    if who not in PEOPLE:
        raise HTTPException(401, "unknown user")
    return who


async def broadcast(event: dict):
    for q in list(listeners):
        q.put_nowait(event)


def shelf_call(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except DuplicateError:
        raise
    except ShelfError as e:
        raise HTTPException(400, str(e))


@app.exception_handler(DuplicateError)
async def duplicate(request: Request, e: DuplicateError):
    """Same kaomoji key / same group name already exists: 409 and which one, so the page can jump to it."""
    return JSONResponse({"ok": False, "error": str(e), "duplicate": e.item}, status_code=409)


# ── events (SSE): {type: "chat_bg", state, by} and {type: "reaction", id, reactions} ──
@app.get("/events")
async def events():
    q: asyncio.Queue = asyncio.Queue()
    listeners.add(q)

    async def stream():
        try:
            while True:
                try:
                    yield "data: %s\n\n" % json.dumps(await asyncio.wait_for(q.get(), 25), ensure_ascii=False)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            listeners.discard(q)
    return StreamingResponse(stream(), media_type="text/event-stream")


# ── background emoji ──
@app.get("/chat-bg")
def get_chat_bg(who: str = Depends(current_user)):
    return chat_bg


@app.put("/chat-bg")
async def put_chat_bg(request: Request, who: str = Depends(current_user)):
    emoji = "".join(str((await request.json()).get("emoji") or "").split())
    if len(emoji) > 16 or re.search(r"[A-Za-z0-9<>&\"'`\\]", emoji):
        raise HTTPException(400, "emoji must be a single emoji")
    prev = chat_bg[who]["emoji"]
    if emoji != prev:
        chat_bg[who] = {"emoji": emoji, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        await broadcast({"type": "chat_bg", "state": chat_bg, "by": who, "emoji": emoji, "prev": prev})
    return {"ok": True, "changed": emoji != prev, "state": chat_bg}


# ── reactions ──
@app.post("/react")
async def react(request: Request, who: str = Depends(current_user)):
    body = await request.json()
    mid, value = str(body.get("id", "")), str(body.get("value") or "")[:120]
    if not mid:
        raise HTTPException(400, "id required")
    rx = reactions.setdefault(mid, {})
    if value:
        rx[who] = value
    else:
        rx.pop(who, None)
    await broadcast({"type": "reaction", "id": mid, "reactions": rx, "by": who})
    return {"ok": True, "id": mid, "reactions": rx}


# ── groups (the same for stickers and kaomoji; declared before /stickers/{key} so "groups" isn't taken for a key) ──
def group_routes(prefix: str, lib):
    g = lib.groups

    @app.get(prefix + "/groups")
    def list_groups():
        return {"groups": g.list()}

    @app.post(prefix + "/groups")
    async def add_group(request: Request, who: str = Depends(current_user)):
        return {"ok": True, "group": shelf_call(g.add, (await request.json()).get("name"))}

    @app.put(prefix + "/groups")
    async def reorder_groups(request: Request, who: str = Depends(current_user)):
        return {"ok": True, "groups": shelf_call(g.reorder, (await request.json()).get("order"))}

    @app.put(prefix + "/groups/{gid}")
    async def rename_group(gid: int, request: Request, who: str = Depends(current_user)):
        return {"ok": True, "group": shelf_call(g.rename, gid, (await request.json()).get("name"))}

    @app.delete(prefix + "/groups/{gid}")
    def delete_group(gid: int, who: str = Depends(current_user)):
        return {"ok": True, "group": shelf_call(g.remove, gid)}      # its items become ungrouped


group_routes("/stickers", shelf)
group_routes("/kaomoji", km)


# ── stickers ──
@app.get("/stickers")
def list_stickers(q: str = ""):
    return {"stickers": shelf.search(q), "groups": shelf.groups.list()}


@app.get("/sticker/{key}")
def sticker_image(key: str):
    fp = shelf.path_of(key)
    if not fp:
        raise HTTPException(404, "no such sticker")
    return FileResponse(fp, headers={"Cache-Control": "public, max-age=86400"})


@app.post("/stickers")
async def add_sticker(request: Request, who: str = Depends(current_user)):
    b = await request.json()
    m = re.match(r"^data:image/(png|jpe?g|gif|webp);base64,(.+)$", str(b.get("data") or ""), re.S)
    if not m:
        raise HTTPException(400, "data must be a png/jpg/gif/webp data URL")
    raw = base64.b64decode(m.group(2))
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(400, "image over 8 MB")
    return {"ok": True, "sticker": shelf_call(shelf.add, raw, b.get("name"), b.get("desc", ""), b.get("tags"), owner=who,
                                              ext=m.group(1), group=b.get("group"))}


@app.put("/stickers/{key}")
async def edit_sticker(key: str, request: Request, who: str = Depends(current_user)):
    b = await request.json()
    return {"ok": True, "sticker": shelf_call(shelf.edit, key, name=b.get("name"), desc=b.get("desc"), tags=b.get("tags"),
                                              group=b["group"] if "group" in b else KEEP)}


@app.delete("/stickers/{key}")
def delete_sticker(key: str, who: str = Depends(current_user)):
    return {"ok": True, "sticker": shelf_call(shelf.remove, key)}


# ── kaomoji ──
@app.get("/kaomoji")
def list_kaomoji(q: str = ""):
    return {"kaomoji": km.search(q), "groups": km.groups.list()}


@app.post("/kaomoji")
async def add_kaomoji(request: Request, who: str = Depends(current_user)):
    b = await request.json()
    return {"ok": True, "kaomoji": shelf_call(km.add, b.get("text"), b.get("group"))}


@app.put("/kaomoji/{kid}")
async def edit_kaomoji(kid: int, request: Request, who: str = Depends(current_user)):
    b = await request.json()
    return {"ok": True, "kaomoji": shelf_call(km.edit, kid, text=b.get("text"), group=b["group"] if "group" in b else KEEP)}


@app.delete("/kaomoji/{kid}")
def delete_kaomoji(kid: int, who: str = Depends(current_user)):
    return {"ok": True, "kaomoji": shelf_call(km.remove, kid)}


@app.post("/kaomoji/import/preview")
async def kaomoji_preview(request: Request, who: str = Depends(current_user)):
    url = (await request.json()).get("url")
    try:
        return await asyncio.to_thread(import_preview, km, url)       # 10 s timeout, 2 MB cap, public addresses only
    except (ShelfError, OSError) as e:
        raise HTTPException(400, str(getattr(e, "reason", e)))


@app.post("/kaomoji/import")
async def kaomoji_import(request: Request, who: str = Depends(current_user)):
    b = await request.json()
    return {"ok": True, "added": shelf_call(import_commit, km, b.get("url"), b.get("fetched_at"), b.get("items"), b.get("offered"))}


@app.get("/kaomoji/sources")
def kaomoji_sources(who: str = Depends(current_user)):
    return Sources(km).load()


@app.delete("/kaomoji/sources")
def delete_kaomoji_source(url: str, who: str = Depends(current_user)):
    Sources(km).remove(url)
    return {"ok": True}
