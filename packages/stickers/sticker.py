#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sticker-shelf — a tiny sticker library for chat pages (CLI + importable module).

Images live in one folder next to an index.json that gives every sticker a stable
number, a name, a one-line description, tags and a group. In chat text you write
[[sticker:name]] (or [[表情:name]] / [[sticker:12]]) and the page renders the image.

Folder: --dir PATH, or $STICKER_DIR, or ./stickers

  sticker.py add  <image> <name> ["description"] [tag,tag] [--group G] [--owner WHO]
  sticker.py list [keyword]                 search name / description / tags / aliases / group
  sticker.py edit <name|id> [--name NEW] [--desc TEXT] [--tags a,b] [--group G]
  sticker.py desc <name|id> "new description"
  sticker.py rm   <name|id>
  sticker.py groups [add NAME | rename ID NAME | rm ID | up ID | down ID]

  sticker.py kaomoji list [keyword]
  sticker.py kaomoji add  "<text>" [group]
  sticker.py kaomoji edit <id> [--text T] [--group G]
  sticker.py kaomoji rm   <id>
  sticker.py kaomoji import <url> [--group G] [--all]    fetch a public page, list new candidates
                                                         (--all adds them); run again later = sync
  sticker.py kaomoji sources [rm <url>]
  sticker.py kaomoji groups [add NAME | rename ID NAME | rm ID | up ID | down ID]

Kaomoji live in <folder>/kaomoji.json; the first run copies the built-in set that ships
in packages/kaomoji/kaomoji.json.

Groups are an ordered list ({id, name, order}); each sticker / kaomoji stores only a group id
(null = ungrouped). Deleting a group moves its members to "ungrouped". Old files that stored
group names are migrated on load.

Renaming keeps the old name in `aliases`, so old messages that say [[sticker:old]]
still find the picture. Numbers are never reused.
"""
import ipaddress
import json
import os
import re
import shutil
import socket
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from html.parser import HTMLParser

OK_EXT = ("png", "jpg", "jpeg", "gif", "webp")
BAD_NAME = re.compile(r"[/\\.:\[\]<>\"'&]")
KEEP = object()          # "leave this field as it is" for edit()


class ShelfError(Exception):
    pass


class DuplicateError(ShelfError):
    """Adding (or editing into) something that already exists; .item is the one already there."""

    def __init__(self, msg, item):
        super().__init__(msg)
        self.item = item


_ZERO_WIDTH = {"​", "‌", "‍", "﻿", "︎", "️"}


def kaomoji_key(text):
    """Dedup key: NFKC → drop all whitespace, zero-width chars (U+200B-U+200D, U+FEFF) and variation
    selectors (U+FE0E/FE0F) → full-width punctuation to half-width. Exact match only, no fuzzy similarity."""
    s = unicodedata.normalize("NFKC", str(text or ""))
    s = "".join(c for c in s if not c.isspace() and c not in _ZERO_WIDTH)
    return "".join(chr(ord(c) - 0xFEE0) if 0xFF01 <= ord(c) <= 0xFF5E else c for c in s)


def clean_name(name):
    name = re.sub(r"\s+", "-", str(name or "").strip())
    if not name or len(name) > 40 or BAD_NAME.search(name):
        raise ShelfError("name must be 1-40 chars, without / \\ . : [ ] < > \" ' &")
    return name


def clean_tags(tags):
    if isinstance(tags, str):
        tags = tags.split(",")
    return [t.strip() for t in (tags or []) if str(t).strip()]


def _save_json(path, d):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)                            # readers never see a half-written file


# ── groups: an ordered list, items keep only the id ──
def migrate_groups(d, items_key):
    """Normalise d["groups"] to [{id, name, order}] and make every item's "group" an id or None.
    Items that still carry a group *name* (older files) get a group created for it."""
    clean = []
    for i, g in enumerate(d.get("groups") or []):
        if isinstance(g, dict) and isinstance(g.get("id"), int) and str(g.get("name") or "").strip():
            clean.append({"id": g["id"], "name": str(g["name"]).strip(), "order": g.get("order", i + 1)})
    clean.sort(key=lambda g: g["order"])
    by_id = {g["id"]: g for g in clean}
    by_name = {g["name"]: g for g in clean}
    nxt = max([d.get("next_group_id", 1)] + [g["id"] + 1 for g in clean])
    for it in d.get(items_key, []):
        v = it.get("group")
        if v in (None, "", 0) or v is False:
            it["group"] = None
            continue
        if isinstance(v, int) and v in by_id:
            continue
        name = str(v).strip()
        g = by_name.get(name)
        if not g:
            g = {"id": nxt, "name": name, "order": len(clean) + 1}
            nxt += 1
            clean.append(g)
            by_name[name], by_id[g["id"]] = g, g
        it["group"] = g["id"]
    for i, g in enumerate(clean):
        g["order"] = i + 1
    d["groups"], d["next_group_id"] = clean, nxt
    return d


def _group_name(name):
    name = " ".join(str(name or "").split())
    if not name or len(name) > 20:
        raise ShelfError("group name must be 1-20 chars")
    return name


def resolve_group(d, v, create=True):
    """None / "" / 0 → None (ungrouped); an existing id (int or digits) → that id; otherwise a name,
    found or (create=True) created."""
    if v is None or v == "" or v == 0 or v is False:
        return None
    if isinstance(v, int) or (isinstance(v, str) and v.strip().isdigit()):
        gid = int(v)
        if any(g["id"] == gid for g in d["groups"]):
            return gid
        if isinstance(v, int):
            raise ShelfError("no group #%d" % gid)
    name = _group_name(v)
    g = next((g for g in d["groups"] if g["name"] == name), None)
    if not g:
        if not create:
            raise ShelfError("no group '%s'" % name)
        g = {"id": d["next_group_id"], "name": name, "order": len(d["groups"]) + 1}
        d["next_group_id"] += 1
        d["groups"].append(g)
    return g["id"]


class Groups:
    """Manage the groups of one library (a Shelf or a Kaomoji)."""

    def __init__(self, lib):
        self.lib, self.items_key = lib, lib.ITEMS

    def list(self):
        d = self.lib.load()
        counts = {}
        for it in d[self.items_key]:
            counts[it.get("group")] = counts.get(it.get("group"), 0) + 1
        return [dict(g, count=counts.get(g["id"], 0)) for g in d["groups"]]

    def _get(self, d, gid):
        g = next((g for g in d["groups"] if str(g["id"]) == str(gid).strip()), None)
        if not g:
            raise ShelfError("no group #%s" % gid)
        return g

    def add(self, name):
        d = self.lib.load()
        name = _group_name(name)
        old = next((g for g in d["groups"] if g["name"] == name), None)
        if old:
            raise DuplicateError("group '%s' already exists" % name, old)
        g = {"id": d["next_group_id"], "name": name, "order": len(d["groups"]) + 1}
        d["next_group_id"] += 1
        d["groups"].append(g)
        self.lib.save(d)
        return g

    def rename(self, gid, name):
        d = self.lib.load()
        g, name = self._get(d, gid), _group_name(name)
        old = next((x for x in d["groups"] if x["name"] == name and x is not g), None)
        if old:
            raise DuplicateError("group '%s' already exists" % name, old)
        g["name"] = name
        self.lib.save(d)
        return g

    def remove(self, gid):
        """Delete a group; its members become ungrouped."""
        d = self.lib.load()
        g = self._get(d, gid)
        for it in d[self.items_key]:
            if it.get("group") == g["id"]:
                it["group"] = None
        d["groups"].remove(g)
        for i, x in enumerate(d["groups"]):
            x["order"] = i + 1
        self.lib.save(d)
        return g

    def reorder(self, ids):
        d = self.lib.load()
        pos = {str(i): n for n, i in enumerate(ids or [])}
        d["groups"].sort(key=lambda g: (pos.get(str(g["id"]), len(pos) + g["order"])))
        for i, g in enumerate(d["groups"]):
            g["order"] = i + 1
        self.lib.save(d)
        return d["groups"]

    def move(self, gid, step):
        ids = [g["id"] for g in self.lib.load()["groups"]]
        i = next((n for n, x in enumerate(ids) if str(x) == str(gid)), None)
        if i is None:
            raise ShelfError("no group #%s" % gid)
        j = max(0, min(len(ids) - 1, i + step))
        ids.insert(j, ids.pop(i))
        return self.reorder(ids)


def _group_label(d, gid):
    return next((g["name"] for g in d["groups"] if g["id"] == gid), "")


class Shelf:
    ITEMS = "stickers"

    def __init__(self, folder=None):
        self.dir = os.path.abspath(folder or os.environ.get("STICKER_DIR") or "stickers")
        self.index = os.path.join(self.dir, "index.json")
        self.path = self.index
        self.groups = Groups(self)

    # ── index file ──
    def load(self):
        try:
            with open(self.index, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            d = {}
        d.setdefault("stickers", [])
        used = [s["id"] for s in d["stickers"] if isinstance(s.get("id"), int)]
        nxt = max([d.get("next_id", 1)] + [i + 1 for i in used])
        for s in d["stickers"]:                      # hand-written entries get a number
            if not isinstance(s.get("id"), int):
                s["id"] = nxt
                nxt += 1
            s.setdefault("desc", "")
            s.setdefault("tags", [])
            s.setdefault("aliases", [])
        d["next_id"] = nxt
        return migrate_groups(d, "stickers")

    def save(self, d):
        _save_json(self.index, d)

    # ── lookups ──
    @staticmethod
    def find(d, key):
        key = str(key).strip()
        for s in d["stickers"]:
            if key.isdigit() and s["id"] == int(key):
                return s
        for s in d["stickers"]:
            if key in (s["name"], s["file"]) or key in s.get("aliases", []):
                return s
        return None

    def get(self, key):
        return self.find(self.load(), key)

    def search(self, q=""):
        q = str(q or "").strip().lower()
        d = self.load()
        out = []
        for s in d["stickers"]:
            hay = [s["name"], s.get("desc", ""), _group_label(d, s.get("group"))] + s.get("tags", []) + s.get("aliases", [])
            if not q or any(q in str(h).lower() for h in hay):
                out.append(s)
        return sorted(out, key=lambda s: s["id"])

    def path_of(self, key):
        """Absolute path of the image for a name / alias / number / file name, or None."""
        s = self.get(key)
        name = s["file"] if s else os.path.basename(str(key))
        fp = os.path.join(self.dir, name)
        if not os.path.isfile(fp) and "." not in name:
            fp = next((fp + "." + e for e in OK_EXT if os.path.isfile(fp + "." + e)), fp)
        real = os.path.realpath(fp)
        if not os.path.isfile(real) or os.path.dirname(real) != os.path.realpath(self.dir):
            return None
        if real.rsplit(".", 1)[-1].lower() not in OK_EXT:
            return None
        return real

    # ── changes ──
    def _taken(self, d, name, but=None):
        return any(s is not but and (s["name"] == name or name in s.get("aliases", [])) for s in d["stickers"])

    def add(self, src, name, desc="", tags=None, owner=None, ext=None, group=None):
        """src is a file path, or raw bytes together with ext. Same name again = replace the picture."""
        name = clean_name(name)
        if isinstance(src, (bytes, bytearray)):
            raw, ext = bytes(src), (ext or "").lower().lstrip(".")
        else:
            if not os.path.isfile(src):
                raise ShelfError("file not found: %s" % src)
            with open(src, "rb") as f:
                raw = f.read()
            ext = src.rsplit(".", 1)[-1].lower()
        ext = "jpg" if ext == "jpeg" else ext
        if ext not in OK_EXT:
            raise ShelfError("only " + "/".join(OK_EXT))
        d = self.load()
        old = self.find(d, name)
        if old and old["name"] != name:
            raise ShelfError("'%s' is already an alias of #%d" % (name, old["id"]))
        gid = resolve_group(d, group)
        os.makedirs(self.dir, exist_ok=True)
        with open(os.path.join(self.dir, name + "." + ext), "wb") as f:
            f.write(raw)
        rec = {"id": old["id"] if old else d["next_id"], "name": name, "file": name + "." + ext,
               "desc": str(desc or ""), "tags": clean_tags(tags), "group": gid,
               "aliases": old.get("aliases", []) if old else []}
        if owner:
            rec["owner"] = str(owner)
        if old:                                      # same name again = replace the picture, keep the number
            if old["file"] != rec["file"] and os.path.isfile(os.path.join(self.dir, old["file"])):
                os.remove(os.path.join(self.dir, old["file"]))
            d["stickers"][d["stickers"].index(old)] = rec
        else:
            d["next_id"] += 1
            d["stickers"].append(rec)
        self.save(d)
        return rec

    def edit(self, key, name=None, desc=None, tags=None, group=KEEP):
        d = self.load()
        s = self.find(d, key)
        if not s:
            raise ShelfError("no sticker '%s'" % key)
        if name is not None and clean_name(name) != s["name"]:
            new = clean_name(name)
            if self._taken(d, new, but=s):
                raise ShelfError("name '%s' is taken" % new)
            ext = s["file"].rsplit(".", 1)[-1]
            src, dst = os.path.join(self.dir, s["file"]), os.path.join(self.dir, new + "." + ext)
            if os.path.isfile(src):
                os.replace(src, dst)
            s["aliases"] = [a for a in s.get("aliases", []) + [s["name"]] if a != new]
            s["name"], s["file"] = new, new + "." + ext
        if desc is not None:
            s["desc"] = str(desc)
        if tags is not None:
            s["tags"] = clean_tags(tags)
        if group is not KEEP:
            s["group"] = resolve_group(d, group)
        self.save(d)
        return s

    def remove(self, key):
        d = self.load()
        s = self.find(d, key)
        if not s:
            raise ShelfError("no sticker '%s'" % key)
        fp = os.path.join(self.dir, s["file"])
        if os.path.isfile(fp):
            os.remove(fp)
        d["stickers"].remove(s)
        self.save(d)
        return s


class Kaomoji:
    """Text faces, grouped. Same add / edit / remove shape as the sticker shelf."""

    ITEMS = "kaomoji"
    _HERE = os.path.dirname(os.path.abspath(__file__))
    BUILTIN = next((p for p in (os.path.join(_HERE, "..", "kaomoji", "kaomoji.json"), os.path.join(_HERE, "kaomoji.json")) if os.path.isfile(p)), "")

    def __init__(self, folder=None, path=None):
        base = os.path.abspath(folder or os.environ.get("STICKER_DIR") or "stickers")
        self.path = path or os.environ.get("KAOMOJI_FILE") or os.path.join(base, "kaomoji.json")
        self.groups = Groups(self)

    def load(self):
        for fp in (self.path, self.BUILTIN):
            try:
                with open(fp, encoding="utf-8") as f:
                    d = json.load(f)
                break
            except (OSError, ValueError):
                d = {}
        d.setdefault("kaomoji", [])
        for k in d["kaomoji"]:
            k["key"] = kaomoji_key(k.get("text", ""))
        d["next_id"] = max([d.get("next_id", 1)] + [k["id"] + 1 for k in d["kaomoji"] if isinstance(k.get("id"), int)])
        return migrate_groups(d, "kaomoji")

    def save(self, d):
        _save_json(self.path, d)

    @staticmethod
    def _text(t):
        t = str(t or "").strip()
        if not t or len(t) > 80 or "\n" in t:
            raise ShelfError("kaomoji text must be one line, 1-80 chars")
        return t

    def search(self, q=""):
        q = str(q or "").strip().lower()
        d = self.load()
        return [k for k in d["kaomoji"] if not q or q in k["text"].lower() or q in _group_label(d, k.get("group")).lower()]

    def _find(self, d, kid):
        k = next((k for k in d["kaomoji"] if str(k["id"]) == str(kid).strip()), None)
        if not k:
            raise ShelfError("no kaomoji #%s" % kid)
        return k

    @staticmethod
    def _dupe(d, key, but=None):
        return next((k for k in d["kaomoji"] if k is not but and k.get("key") == key), None)

    def add(self, text, group=None):
        d = self.load()
        text = self._text(text)
        old = self._dupe(d, kaomoji_key(text))
        if old:
            raise DuplicateError("already have it: #%d %s" % (old["id"], old["text"]), old)
        k = {"id": d["next_id"], "text": text, "key": kaomoji_key(text), "group": resolve_group(d, group)}
        d["kaomoji"].append(k)
        d["next_id"] += 1
        self.save(d)
        return k

    def edit(self, kid, text=None, group=KEEP):
        d = self.load()
        k = self._find(d, kid)
        if text is not None:
            text = self._text(text)
            old = self._dupe(d, kaomoji_key(text), but=k)
            if old:
                raise DuplicateError("already have it: #%d %s" % (old["id"], old["text"]), old)
            k["text"], k["key"] = text, kaomoji_key(text)
        if group is not KEEP:
            k["group"] = resolve_group(d, group)
        self.save(d)
        return k

    def remove(self, kid):
        d = self.load()
        k = self._find(d, kid)
        d["kaomoji"].remove(k)
        self.save(d)
        return k


# ── import kaomoji from any public web page ──
FETCH_TIMEOUT = 10
FETCH_MAX = 2 * 1024 * 1024


def _public_url(url):
    u = urllib.parse.urlparse(str(url or "").strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ShelfError("only http(s) URLs")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80))
    except OSError:
        raise ShelfError("cannot resolve %s" % u.hostname)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise ShelfError("refusing to fetch a private / local address")
    return u.geturl()


class _CheckRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _public_url(newurl)                              # a redirect must stay on the public internet too
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_page(url):
    """GET a public HTML/text page: 10 s timeout, 2 MB cap."""
    url = _public_url(url)
    opener = urllib.request.build_opener(_CheckRedirects)
    req = urllib.request.Request(url, headers={"User-Agent": "sticker-shelf/1 (+kaomoji import)", "Accept": "text/html,text/plain"})
    with opener.open(req, timeout=FETCH_TIMEOUT) as r:
        ctype = r.headers.get("Content-Type", "")
        if ctype and not re.match(r"text/(html|plain)|application/xhtml", ctype):
            raise ShelfError("not an HTML page (%s)" % ctype.split(";")[0])
        raw = r.read(FETCH_MAX + 1)
        if len(raw) > FETCH_MAX:
            raise ShelfError("page is over 2 MB")
        m = re.search(r"charset=([\w-]+)", ctype)
    return raw.decode(m.group(1) if m else "utf-8", errors="replace")


SMALL_BLOCKS = {"li", "td", "th", "code", "button", "dd", "dt", "option"}
BLOCK_TAGS = SMALL_BLOCKS | {"p", "div", "span", "pre", "h1", "h2", "h3", "h4", "a", "br", "tr", "section", "article"}


class _Blocks(HTMLParser):
    """Collects text per block; small blocks (li/td/code/[data-kaomoji]) are kept separately and win."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.small, self.other, self.stack, self.skip = [], [], [], 0
        self.buf = []

    def flush(self):
        text = "".join(self.buf)
        self.buf = []
        if text.strip():
            (self.small if any(t in SMALL_BLOCKS or t == "*data" for t in self.stack) else self.other).append(text)

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "svg", "head", "title"):
            self.skip += 1
            return
        a = dict(attrs)
        if "data-kaomoji" in a:
            if a["data-kaomoji"]:
                self.small.append(a["data-kaomoji"])
            self.flush()
            self.stack.append("*data")
            return
        if tag in BLOCK_TAGS:
            self.flush()
        if tag != "br":
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg", "head", "title"):
            self.skip = max(0, self.skip - 1)
            return
        if tag in BLOCK_TAGS or (self.stack and self.stack[-1] == "*data"):
            self.flush()
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i] == tag or self.stack[i] == "*data":
                del self.stack[i:]
                break

    def handle_data(self, data):
        if not self.skip:
            self.buf.append(data)


def _is_cjk(ch):
    o = ord(ch)
    return 0x4E00 <= o <= 0x9FFF or 0x3400 <= o <= 0x4DBF or 0xAC00 <= o <= 0xD7AF


_WORD_RANGES = ((0x41, 0x5A), (0x61, 0x7A), (0xC0, 0x24F), (0x370, 0x3FF), (0x400, 0x4FF), (0x590, 0x5FF),
                (0x600, 0x6FF), (0x900, 0x97F), (0xE00, 0xE7F), (0x1E00, 0x1EFF), (0x3040, 0x30FF),
                (0xFF21, 0xFF3A), (0xFF41, 0xFF5A), (0xFF66, 0xFF9F))
_PROSE_PUNCT = set("…—–“”‘’«»„")


def _is_word_letter(c):
    """Letters of scripts people write words in. IPA / phonetic / Georgian / Canadian letters that kaomoji
    borrow (ʕ ᴥ ᵔ ა ᐢ …) don't count, so ʕᵔᴥᵔʔ is not mistaken for a word."""
    o = ord(c)
    return unicodedata.category(c)[0] == "L" and any(a <= o <= b for a, b in _WORD_RANGES)


def looks_like_kaomoji(t):
    """Generic rule, no per-site parsing. A candidate is 2-40 chars, has a non-ASCII char that isn't just
    prose punctuation (… — “ ”), has at least two symbol-ish chars (punctuation, symbols, combining marks,
    or letters/digits borrowed from other scripts such as ૮ ა ᐢ ໒), and is not a word or phrase:
    no 3+ CJK chars, no run of 4+ word letters, no 3+ digits."""
    t = t.strip()
    if not (2 <= len(t) <= 40) or "://" in t or ("@" in t and "." in t):
        return False
    wide = [c for c in t if ord(c) > 127]
    if not wide or all(c in _PROSE_PUNCT for c in wide) or len(set(t.replace(" ", ""))) < 2:
        return False
    sym = 0
    run = 0
    for c in t:
        cat = unicodedata.category(c)
        if _is_word_letter(c):
            run += 1
            if run >= 4:
                return False
        else:
            run = 0
        if cat[0] in "PSM" or (ord(c) > 127 and not _is_cjk(c) and cat[0] != "Z"):
            sym += 1
    if sym < 2 or sum(1 for c in t if _is_cjk(c)) >= 3 or re.search(r"\d{3,}", t):
        return False
    return True


def extract_kaomoji(html, limit=2000):
    p = _Blocks()
    p.feed(html)
    p.flush()
    out, seen = [], set()
    for block in p.small + p.other:
        for piece in re.split(r"\n|\t| {2,}|　{2,}", block):
            piece = " ".join(piece.split())
            if piece not in seen and looks_like_kaomoji(piece):
                seen.add(piece)
                out.append(piece)
                if len(out) >= limit:
                    return out
    return out


class Sources:
    """kaomoji-sources.json: every page kaomoji were imported from, plus what it offered last time."""

    def __init__(self, km):
        self.path = os.path.join(os.path.dirname(km.path) or ".", "kaomoji-sources.json")

    def load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            d = {}
        d.setdefault("sources", [])
        return d

    def save(self, d):
        _save_json(self.path, d)

    def get(self, url):
        return next((s for s in self.load()["sources"] if s["url"] == url), None)

    def remove(self, url):
        d = self.load()
        d["sources"] = [s for s in d["sources"] if s["url"] != url]
        self.save(d)

    def remember(self, url, fetched_at, seen):
        d = self.load()
        s = next((s for s in d["sources"] if s["url"] == url), None)
        if not s:
            s = {"url": url, "added_at": fetched_at, "seen": []}
            d["sources"].append(s)
        s["last_fetched_at"] = fetched_at
        s["seen"] = sorted({kaomoji_key(x) for x in s.get("seen", [])} | {kaomoji_key(x) for x in seen if x})
        self.save(d)


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def import_preview(km, url):
    """Fetch the page and list candidates. Same-key duplicates inside the batch keep only the first;
    ones this page already offered before (sync) are left out; ones you already have are marked exists=True."""
    html = fetch_page(url)
    have = {k["key"]: k for k in km.load()["kaomoji"]}
    src = Sources(km).get(url)
    seen = {kaomoji_key(x) for x in (src.get("seen", []) if src else [])}
    found = extract_kaomoji(html)
    out, keys = [], set()
    for t in found:
        key = kaomoji_key(t)
        if key in keys or key in seen:
            continue
        keys.add(key)
        c = {"text": t, "key": key, "exists": key in have}
        if c["exists"]:
            c["existing_id"] = have[key]["id"]
        out.append(c)
    return {"url": url, "fetched_at": _now(), "found": len(found),
            "new": sum(1 for c in out if not c["exists"]), "candidates": out, "known_source": bool(src)}


def import_commit(km, url, fetched_at, items, offered):
    """items: [{text, group}] she ticked (group = id or name); offered: every candidate she was shown
    (so a sync won't offer them again). Anything whose key is already there is skipped, never overwritten."""
    d = km.load()
    have = {k["key"] for k in d["kaomoji"]}
    added = []
    for it in items or []:
        text = km._text(it.get("text") if isinstance(it, dict) else it)
        key = kaomoji_key(text)
        if key in have:
            continue
        k = {"id": d["next_id"], "text": text, "key": key,
             "group": resolve_group(d, it.get("group") if isinstance(it, dict) else None),
             "source": {"url": url, "fetched_at": fetched_at}}
        d["kaomoji"].append(k)
        d["next_id"] += 1
        have.add(key)
        added.append(k)
    km.save(d)
    offered = [(o.get("text") if isinstance(o, dict) else o) for o in (offered or [])]
    Sources(km).remember(url, fetched_at, offered + [k["key"] for k in added])
    return added


# ── CLI ──
def _pop(argv, flag):
    if flag in argv:
        i = argv.index(flag)
        if i + 1 >= len(argv):
            raise ShelfError(flag + " needs a value")
        v = argv[i + 1]
        del argv[i:i + 2]
        return v
    return None


def groups_cli(lib, args):
    g = lib.groups
    sub = args[0] if args else "list"
    if sub == "add":
        x = g.add(args[1])
        print("added group #%d %s" % (x["id"], x["name"]))
    elif sub == "rename":
        x = g.rename(args[1], args[2])
        print("#%d is now %s" % (x["id"], x["name"]))
    elif sub == "rm":
        x = g.remove(args[1])
        print("removed group %s (its items are ungrouped now)" % x["name"])
    elif sub in ("up", "down"):
        g.move(args[1], -1 if sub == "up" else 1)
    elif sub != "list":
        raise ShelfError("groups: list / add / rename / rm / up / down")
    for x in g.list():
        print("#%-3d %-12s %d" % (x["id"], x["name"], x["count"]))


def kaomoji_cli(km, args):
    sub, args = (args[0] if args else "list"), args[1:]
    if sub in ("list", "ls"):
        d = km.load()
        hits = km.search(args[0] if args else "")
        for k in hits:
            print("#%-3d %-8s %s" % (k["id"], _group_label(d, k.get("group")), k["text"]))
        print("-- %d kaomoji in %s" % (len(hits), km.path))
    elif sub == "add":
        try:
            k = km.add(args[0], args[1] if len(args) > 1 else None)
        except DuplicateError as e:
            raise ShelfError("添加失败···ᴛ ω ᴛ已经有类似的啦\n  #%d %s" % (e.item["id"], e.item["text"]))
        print("added #%d %s" % (k["id"], k["text"]))
    elif sub == "edit":
        text, group = _pop(args, "--text"), _pop(args, "--group")
        if text is None and group is None:
            raise ShelfError("kaomoji edit needs --text or --group")
        k = km.edit(args[0], text=text, group=KEEP if group is None else group)
        print("#%d %s  %s" % (k["id"], _group_label(km.load(), k.get("group")), k["text"]))
    elif sub == "rm":
        k = km.remove(args[0])
        print("removed #%d %s" % (k["id"], k["text"]))
    elif sub == "groups":
        groups_cli(km, args)
    elif sub == "import":
        group, take_all = _pop(args, "--group"), "--all" in args
        args = [a for a in args if a != "--all"]
        pv = import_preview(km, args[0])
        for c in pv["candidates"]:
            print("  " + c["text"] + ("   (already have #%d)" % c["existing_id"] if c["exists"] else ""))
        print("-- %d new of %d found on the page" % (pv["new"], pv["found"]))
        if take_all:
            new = [c for c in pv["candidates"] if not c["exists"]]
            added = import_commit(km, pv["url"], pv["fetched_at"], [{"text": c["text"], "group": group} for c in new],
                                  [c["text"] for c in pv["candidates"]])
            print("added %d" % len(added))
        else:
            print("(nothing saved; add --all to keep them all, or pick them in the panel)")
    elif sub == "sources":
        srcs = Sources(km)
        if args[:1] == ["rm"]:
            srcs.remove(args[1])
            print("removed source", args[1])
        for s in srcs.load()["sources"]:
            print("%s   last fetched %s, %d seen" % (s["url"], s.get("last_fetched_at", "-"), len(s.get("seen", []))))
    else:
        raise ShelfError("kaomoji: list / add / edit / rm / groups / import / sources")


def main(argv):
    folder = _pop(argv, "--dir")
    shelf = Shelf(folder)
    if not argv:
        sys.exit(__doc__)
    cmd, args = argv[0], argv[1:]
    if cmd == "add":
        owner, group = _pop(args, "--owner"), _pop(args, "--group")
        rec = shelf.add(args[0], args[1], args[2] if len(args) > 2 else "",
                        args[3] if len(args) > 3 else None, owner, group=group)
        print("added #%d %s   use: [[sticker:%s]]  or  [[sticker:%d]]" % (rec["id"], rec["name"], rec["name"], rec["id"]))
    elif cmd in ("list", "ls"):
        d = shelf.load()
        hits = shelf.search(args[0] if args else "")
        for s in hits:
            line = "#%-3d [[sticker:%s]]  %s" % (s["id"], s["name"], s["desc"] or "(no description)")
            if s.get("group"):
                line += "   [" + _group_label(d, s["group"]) + "]"
            if s["tags"]:
                line += "   #" + " #".join(s["tags"])
            if s["aliases"]:
                line += "   (was: " + ", ".join(s["aliases"]) + ")"
            print(line)
        print("-- %d sticker(s) in %s" % (len(hits), shelf.dir))
    elif cmd == "edit":
        name, desc, tags, group = _pop(args, "--name"), _pop(args, "--desc"), _pop(args, "--tags"), _pop(args, "--group")
        if name is None and desc is None and tags is None and group is None:
            raise ShelfError("edit needs --name, --desc, --tags or --group")
        s = shelf.edit(args[0], name=name, desc=desc, tags=tags, group=KEEP if group is None else group)
        print("#%d %s  %s  %s" % (s["id"], s["name"], s["desc"], ",".join(s["tags"])))
    elif cmd == "desc":
        s = shelf.edit(args[0], desc=args[1])
        print("#%d %s -> %s" % (s["id"], s["name"], s["desc"]))
    elif cmd == "groups":
        groups_cli(shelf, args)
    elif cmd == "kaomoji":
        kaomoji_cli(Kaomoji(folder), args)
    elif cmd == "rm":
        s = shelf.remove(args[0])
        print("removed #%d %s" % (s["id"], s["name"]))
    else:
        sys.exit("unknown command: %s\n%s" % (cmd, __doc__))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except ShelfError as e:
        sys.exit("error: %s" % e)
    except IndexError:
        sys.exit("not enough arguments\n" + __doc__)
