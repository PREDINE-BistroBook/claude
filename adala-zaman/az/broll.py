"""Step 2b - B-roll: photos (or drawn vintage objects) over her video when she mentions them.

Planned on the EDITED timeline. Each insert is 4-6 s, starts at the sentence where the
match happens, never in the first 8 s, and at least `broll_every` s apart. Her voice keeps
playing underneath. Rendered clips are slow Ken Burns zooms, sepia-toned.
"""
from __future__ import annotations

import json
import math
import random
import re
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from .common import FPS, PHOTOS, ROOT, cover, ease, norm_ar, print_on_background, sepia, token_forms
from .keywords import TOPICS, match_topics

IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def load_photos() -> list[dict]:
    tags_file = PHOTOS / "tags.json"
    tags = json.loads(tags_file.read_text(encoding="utf-8")) if tags_file.exists() else {}
    out = []
    for p in sorted(PHOTOS.rglob("*")):
        if p.suffix.lower() not in IMG_EXT:
            continue
        rel = str(p.relative_to(PHOTOS))
        words = list(tags.get(rel, [])) + re.split(r"[_\-\s.]+", p.stem)
        toks = set()
        for w in words:
            for t in norm_ar(w).split():
                toks |= token_forms(t)
        topics = {t["id"] for t in TOPICS if t["id"] in toks or any(norm_ar(w) in toks for w in t["words"])}
        out.append({"file": str(p.relative_to(ROOT)), "tokens": toks, "topics": topics})
    return out


def plan_broll(sentences: list[dict], cfg: dict, total: float) -> list[dict]:
    """sentences: [{t0, t1, text}] on the edited timeline."""
    photos = load_photos()
    used, last_t, last_end, plan = {}, -1e9, -1e9, []
    for s in sentences:
        if s["t0"] < 8 or s["t0"] - last_end < 2 or s["t0"] > total - 3:
            continue
        topics = match_topics(s["text"])
        # normal spacing is broll_every seconds; a topic not shown yet may come sooner
        fresh = any(tp.get("graphic") and not used.get("g:" + tp["graphic"]) for tp, _ in topics)
        if s["t0"] - last_t < (cfg["broll_every"] / 2 if fresh else cfg["broll_every"]):
            continue
        toks = set()
        for tok in norm_ar(s["text"]).split():
            toks |= token_forms(tok)
        best, score = None, 0
        for ph in photos:
            sc = len(ph["tokens"] & toks) * 2 + sum(h * 3 for tp, h in topics if tp["id"] in ph["topics"]) - used.get(ph["file"], 0) * 3
            if sc > score:
                best, score = ph, sc
        dur = float(min(6.0, max(4.0, s["t1"] - s["t0"] + 0.5), total - s["t0"] - 0.3))
        if best:
            used[best["file"]] = used.get(best["file"], 0) + 1
            plan.append({"t": round(s["t0"] + 0.2, 2), "dur": dur, "type": "photo", "file": best["file"],
                         "why": f"she says: {s['text'][:50]}"})
            last_t, last_end = s["t0"], s["t0"] + 0.2 + dur
        elif cfg.get("broll_graphics"):
            g = next((tp for tp, _ in topics if tp.get("graphic") and used.get("g:" + tp["graphic"], 0) == 0), None)
            if g:
                used["g:" + g["graphic"]] = 1
                plan.append({"t": round(s["t0"] + 0.2, 2), "dur": dur, "type": "graphic", "name": g["graphic"],
                             "label": g.get("label"), "why": f"mentions {g['id']} (no matching photo)"})
                last_t, last_end = s["t0"], s["t0"] + 0.2 + dur
    return plan


class KenBurns:
    def __init__(self, path: Path, size, dur, seed, strength):
        self.size, self.dur = size, dur
        rng = random.Random(seed)
        im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        if abs(math.log((im.width / im.height) / (size[0] / size[1]))) > 0.18:
            still = print_on_background(im, size, np.random.default_rng(seed))
        else:
            still = cover(im, size, 1.18)
        self.still = sepia(still, strength)
        self.move = rng.choice(("in", "out", "left", "right"))

    def frame(self, t):
        W, H = self.size
        Sw, Sh = self.still.size
        u = ease(min(1, max(0, t / self.dur))) * 0.5 + 0.5 * min(1, max(0, t / self.dur))
        z, px, py = {"in": (1 + 0.15 * u, 0.5, 0.45), "out": (1.15 - 0.15 * u, 0.5, 0.5),
                     "left": (1.1, 0.2 + 0.6 * u, 0.5), "right": (1.1, 0.8 - 0.6 * u, 0.5)}[self.move]
        vw, vh = Sw / z, Sh / z
        x0, y0 = (Sw - vw) * px, (Sh - vh) * py
        return self.still.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + vw, y0 + vh))


def render_clip(item: dict, size, out: Path, seed: int) -> Path:
    from .graphics import GraphicScene
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    W, H = size
    if item["type"] == "photo":
        src = KenBurns(ROOT / item["file"], size, item["dur"], seed, 0.75)
    else:
        src = GraphicScene(item["name"], size, item.get("label"))
    enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                            "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
                            "-pix_fmt", "yuv420p", str(out)], stdin=subprocess.PIPE)
    for f in range(int(item["dur"] * FPS)):
        enc.stdin.write(src.frame(f / FPS).tobytes())
    enc.stdin.close()
    enc.wait()
    return out
