"""Free stock footage/photos from Pexels (preferred) or Pixabay, cached on disk.

Keys come from env vars PEXELS_API_KEY / PIXABAY_API_KEY, or a `.env` file in the
project root (git-ignored), e.g.
    PEXELS_API_KEY=xxxx
    PIXABAY_API_KEY=yyyy
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import requests

from .common import ROOT, WORK, read_json, write_json

STOCK = WORK / "stock"
CREDITS = STOCK / "credits.json"


def _keys():
    env = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return (os.environ.get("PEXELS_API_KEY") or env.get("PEXELS_API_KEY"),
            os.environ.get("PIXABAY_API_KEY") or env.get("PIXABAY_API_KEY"))


def have_keys() -> bool:
    return any(_keys())


def _slug(q: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", q.lower()).strip("-")[:60]


def _download(url: str, dest: Path) -> Path | None:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with requests.get(url, stream=True, timeout=60) as r:
            r.raise_for_status()
            tmp = dest.with_suffix(dest.suffix + ".part")
            with open(tmp, "wb") as fh:
                for chunk in r.iter_content(1 << 16):
                    fh.write(chunk)
            tmp.rename(dest)
        return dest
    except Exception as e:  # noqa: BLE001
        print(f"  ! download failed {url[:80]}: {e}")
        return None


def _pexels(q, key, vertical, want_video):
    h = {"Authorization": key}
    orient = "portrait" if vertical else "landscape"
    out = []
    if want_video:
        r = requests.get("https://api.pexels.com/videos/search", headers=h, timeout=30,
                         params={"query": q, "orientation": orient, "per_page": 15})
        if r.ok:
            for v in r.json().get("videos", []):
                files = [f for f in v.get("video_files", []) if f.get("file_type") == "video/mp4" and f.get("width")]
                # prefer ~HD, avoid 4K downloads
                files.sort(key=lambda f: abs((f["height"] if not vertical else f["width"]) - 1080))
                if files and v.get("duration", 0) >= 4:
                    out.append(dict(kind="video", url=files[0]["link"], id=f"pexels-v{v['id']}",
                                    credit=f"{v.get('user', {}).get('name', 'Pexels')} / Pexels", page=v.get("url")))
    r = requests.get("https://api.pexels.com/v1/search", headers=h, timeout=30,
                     params={"query": q, "orientation": orient, "per_page": 15})
    if r.ok:
        for p in r.json().get("photos", []):
            out.append(dict(kind="photo", url=p["src"]["large2x"], id=f"pexels-p{p['id']}",
                            credit=f"{p.get('photographer', 'Pexels')} / Pexels", page=p.get("url")))
    return out


def _pixabay(q, key, vertical, want_video):
    out = []
    if want_video:
        r = requests.get("https://pixabay.com/api/videos/", timeout=30,
                         params={"key": key, "q": q, "per_page": 15, "safesearch": "true"})
        if r.ok:
            for v in r.json().get("hits", []):
                vids = v.get("videos", {})
                f = vids.get("large") if vids.get("large", {}).get("url") else vids.get("medium")
                if f and f.get("url") and v.get("duration", 0) >= 4:
                    out.append(dict(kind="video", url=f["url"], id=f"pixabay-v{v['id']}",
                                    credit=f"{v.get('user', 'Pixabay')} / Pixabay", page=v.get("pageURL")))
    r = requests.get("https://pixabay.com/api/", timeout=30,
                     params={"key": key, "q": q, "image_type": "photo", "per_page": 15, "safesearch": "true",
                             "orientation": "vertical" if vertical else "horizontal"})
    if r.ok:
        for p in r.json().get("hits", []):
            out.append(dict(kind="photo", url=p.get("largeImageURL") or p["webformatURL"], id=f"pixabay-p{p['id']}",
                            credit=f"{p.get('user', 'Pixabay')} / Pixabay", page=p.get("pageURL")))
    return out


_search_cache: dict = {}


def search(q: str, vertical=False, want_video=True) -> list[dict]:
    ck = (q, vertical, want_video)
    if ck in _search_cache:
        return _search_cache[ck]
    idx = STOCK / f"{_slug(q)}{'-v' if vertical else ''}.json"
    if idx.exists():
        res = read_json(idx)
    else:
        pk, xk = _keys()
        res = []
        try:
            if pk:
                res = _pexels(q, pk, vertical, want_video)
            if not res and xk:
                res = _pixabay(q, xk, vertical, want_video)
        except requests.RequestException as e:
            print(f"  ! stock search failed for '{q}': {e}")
        if res:
            write_json(idx, res)
    # videos first (motion), then photos
    res = sorted(res, key=lambda r: 0 if r["kind"] == "video" else 1)
    _search_cache[ck] = res
    return res


def fetch(q: str, n: int, vertical=False) -> dict | None:
    """Return the n-th result for a query, downloaded. {'kind','path','credit'}"""
    res = search(q, vertical)
    if not res:
        return None
    item = res[n % len(res)]
    ext = ".mp4" if item["kind"] == "video" else ".jpg"
    path = _download(item["url"], STOCK / "files" / f"{item['id']}{ext}")
    if not path:
        return None
    credits = read_json(CREDITS) if CREDITS.exists() else {}
    credits[item["id"]] = {"credit": item["credit"], "page": item.get("page")}
    write_json(CREDITS, credits)
    return {"kind": item["kind"], "path": str(path.relative_to(ROOT)), "credit": item["credit"]}


def resolve_plan(plan: dict) -> int:
    """Fill `file` for every stock scene in a plan; returns how many are unresolved."""
    vertical = plan["size"][1] > plan["size"][0]
    missing = 0
    for sc in plan["scenes"]:
        if sc["type"] != "stock" or (sc.get("file") and (ROOT / sc["file"]).exists()):
            continue
        got = fetch(sc["query"], sc.get("pick", 0), vertical) or fetch(sc["query"], sc.get("pick", 0), not vertical)
        if got:
            sc["file"], sc["kind"], sc["credit"] = got["path"], got["kind"], got["credit"]
            print(f"  stock '{sc['query']}' -> {got['path']}")
        else:
            missing += 1
    return missing
