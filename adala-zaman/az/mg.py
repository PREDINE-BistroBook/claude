"""Motion-graphics A-roll, for episodes where she isn't on camera (audio-only input, or no face found).

The picture becomes a sequence of animated scenes that changes every 4-8 s with what she is
saying (on the EDITED timeline):
  * chapter cards   - when a chapter from episode.json starts («يوم الغسيل»…)
  * drawn objects   - the vintage object she's talking about, animated, with a slow camera move
  * her photos      - photos/ matched by tags, slow Ken Burns
  * her handwriting - a page of her notes, used sparingly as an authentic touch
Fallback when nothing matches: the object from the topic she's still on, or one of the
episode's own objects - so every frame stays on-theme.
"""
from __future__ import annotations

import math
import os
import random
import re
import subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

from .common import FPS, ROOT, ease, norm_ar, token_forms
from .keywords import match_topics

XF = 0.5           # crossfade between scenes
SENT_END = re.compile(r"[.!?؟،,…]$")


# ------------------------------------------------------------------ planning
def cut_scenes(words, total, smin=4.0, smax=8.0, target=5.5):
    """Split [0,total] into scenes cut between words, preferring sentence ends and pauses."""
    bounds = []
    for i in range(len(words) - 1):
        gap = max(0.0, words[i + 1]["start"] - words[i]["end"])
        bonus = gap * 2 + (1.0 if SENT_END.search(words[i]["word"]) else 0) + (0.8 if words[i]["seg"] != words[i + 1]["seg"] else 0)
        bounds.append(((words[i]["end"] + words[i + 1]["start"]) / 2, bonus))
    scenes, t = [], 0.0
    while total - t > smax:
        c = [(abs(b - (t + target)) - bonus, b) for b, bonus in bounds if t + smin <= b <= t + smax]
        nb = min(c)[1] if c else t + target
        scenes.append([t, nb])
        t = nb
    if scenes and total - t < smin:
        scenes[-1][1] = total
    else:
        scenes.append([t, total])
    out = []
    for a, b in scenes:
        ws = [w for w in words if a <= (w["start"] + w["end"]) / 2 < b]
        out.append({"start": round(a, 3), "end": round(b, 3), "text": " ".join(w["word"] for w in ws),
                    "segs": sorted({w["seg"] for w in ws})})
    return out


def plan(words: list[dict], total: float, cfg: dict, photos: list[dict], notes: list[Path], seed=1) -> list[dict]:
    """words: kept words on the output timeline (start/end/word/seg)."""
    rng = random.Random(seed)
    chapters = {c["start_id"]: c["title"] for c in cfg.get("chapters", [])}
    episode_graphics = []            # objects this episode talks about, in order
    for t, _ in match_topics(" ".join(w["word"] for w in words)):
        if t.get("graphic"):
            episode_graphics.append(t)
    scenes = cut_scenes(words, total)
    # each scene's chapter, and each chapter's main object (most-mentioned drawn object in it)
    chap_of, cur = [], -1
    for sc in scenes:
        if any(s in chapters for s in sc["segs"]):
            cur += 1
        chap_of.append(cur)
    chap_topic = {}
    for c in set(chap_of):
        txt = " ".join(sc["text"] for sc, k in zip(scenes, chap_of) if k == c)
        chap_topic[c] = next((tp for tp, _ in match_topics(txt) if tp.get("graphic")), None)
    last_use, uses, plan_out = {}, {}, []
    last_topic, last_notes, note_i = None, -1e9, 0
    shown_chapters = set()

    def fresh(key, t, gap):
        return t - last_use.get(key, -1e9) >= gap

    def mark(key, t):
        last_use[key] = t
        uses[key] = uses.get(key, 0) + 1

    for n, sc in enumerate(scenes):
        t, text = sc["start"], sc["text"]
        chap = next((chapters[s] for s in sc["segs"] if s in chapters and s not in shown_chapters), None)
        topics = match_topics(text)
        toks = set()
        for tok in norm_ar(text).split():
            toks |= token_forms(tok)
        pick = None
        if chap:
            shown_chapters.update(s for s in sc["segs"] if s in chapters)
            pick = {"type": "chapter", "title": chap, "why": "chapter starts"}
        if not pick and n == 0 and notes:
            pick = {"type": "notes", "file": str(notes[0]), "why": "opening: her own handwriting"}
            last_notes, note_i = t, 1
        if not pick:   # her photos first
            best, score = None, 0
            for ph in photos:
                s = len(ph["tokens"] & toks) * 2 + sum(h * 3 for tp, h in topics if tp["id"] in ph["topics"])
                s -= uses.get(ph["file"], 0) * 2
                if s > score and fresh(ph["file"], t, 20):
                    best, score = ph, s
            if best:
                pick = {"type": "photo", "file": best["file"], "why": "photo matches her words"}
                mark(best["file"], t)
        if not pick:   # the object she's talking about
            for tp, _ in topics:
                if tp.get("graphic") and fresh("g:" + tp["graphic"], t, 20):
                    pick = {"type": "graphic", "name": tp["graphic"], "label": tp.get("label"), "why": f"she mentions {tp['id']}"}
                    mark("g:" + tp["graphic"], t)
                    last_topic = tp
                    break
            if not pick:
                last_topic = next((tp for tp, _ in topics if tp.get("graphic")), last_topic)
        prev = plan_out[-1] if plan_out else {}
        if not pick:   # stay with what she's talking about: current topic, else this chapter's object
            for tp in (last_topic, chap_topic.get(chap_of[n]) if chap_of[n] >= 0 else None):
                if tp and tp.get("graphic") and prev.get("name") != tp["graphic"]:
                    pick = {"type": "graphic", "name": tp["graphic"], "label": tp.get("label"), "why": f"still on {tp['id']}"}
                    mark("g:" + tp["graphic"], t)
                    break
        if not pick and notes and t - last_notes > 25:
            pick = {"type": "notes", "file": str(notes[note_i % len(notes)]), "why": "her handwriting"}
            last_notes, note_i = t, note_i + 1
        if not pick and chap_of[n] < 0 and episode_graphics:   # intro: a montage of what's coming
            pool = sorted(episode_graphics, key=lambda tp: (uses.get("g:" + tp["graphic"], 0), last_use.get("g:" + tp["graphic"], -1e9)))
            tp = next((tp for tp in pool if prev.get("name") != tp["graphic"]), pool[0])
            pick = {"type": "graphic", "name": tp["graphic"], "label": tp.get("label"), "why": "intro montage of the episode"}
            mark("g:" + tp["graphic"], t)
        if not pick:   # last resort: repeat the chapter object / previous scene with a new camera move
            tp = chap_topic.get(chap_of[n]) or last_topic
            if tp and tp.get("graphic"):
                pick = {"type": "graphic", "name": tp["graphic"], "label": tp.get("label"), "why": f"still on {tp['id']}"}
            elif notes:
                pick = {"type": "notes", "file": str(notes[note_i % len(notes)]), "why": "her handwriting"}
                note_i += 1
            else:
                pick = {"type": "chapter", "title": cfg.get("channel", ""), "why": "fallback"}
        repeat = pick.get("name") and pick.get("name") == prev.get("name")
        recent = pick.get("name") and sum(1 for q in plan_out[-4:] if q.get("name") == pick.get("name")) >= 1
        pick["move"] = rng.choice(["close_l", "close_r", "close_up"] if (repeat or recent) else ["in", "out", "left", "right"])
        plan_out.append({**sc, **pick})
    return plan_out


# ------------------------------------------------------------------ rendering
class Camera:
    """Slow push/pull/drift over any scene so nothing ever sits still."""

    def __init__(self, scene, size, dur, move):
        self.scene, self.size, self.dur, self.move = scene, size, dur, move

    def frame(self, t):
        im = self.scene.frame(t)
        W, H = self.size
        u = ease(min(1.0, max(0.0, t / max(self.dur, 0.1))))
        z, px, py = {"in": (1.0 + 0.07 * u, 0.5, 0.45), "out": (1.07 - 0.07 * u, 0.5, 0.5),
                     "left": (1.06, 0.3 + 0.4 * u, 0.5), "right": (1.06, 0.7 - 0.4 * u, 0.5),
                     # detail shots for when the same object comes back
                     "close_l": (1.55 + 0.05 * u, 0.35 + 0.15 * u, 0.4), "close_r": (1.55 + 0.05 * u, 0.65 - 0.15 * u, 0.4),
                     "close_up": (1.5 + 0.08 * u, 0.5, 0.25 + 0.2 * u)}[self.move]
        vw, vh = W / z, H / z
        x0, y0 = (W - vw) * px, (H - vh) * py
        return im.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + vw, y0 + vh))


def build(sc: dict, size, idx: int, cfg: dict):
    from .broll import KenBurns
    from .graphics import CardScene, GraphicScene
    dur = sc["end"] - sc["start"] + XF
    if sc["type"] == "graphic":
        # no name label in vertical (captions carry the words) or in close-ups (the zoom pushes it under the captions)
        label = sc.get("label") if size[0] > size[1] and not sc.get("move", "").startswith("close") else None
        return Camera(GraphicScene(sc["name"], size, label), size, dur, sc.get("move", "in"))
    if sc["type"] == "photo":
        return KenBurns(ROOT / sc["file"], size, dur, idx + 3, 0.75)
    if sc["type"] == "notes":
        return KenBurns(Path(sc["file"]), size, dur, idx + 3, 0.35)
    if sc["type"] == "chapter":
        return Camera(CardScene("chapter", size, sc["title"], cfg.get("channel", ""), dur), size, dur, "in")
    return Camera(CardScene("quote", size, sc.get("text", "")[:80], duration=dur), size, dur, "in")


def _chunk(args):
    scenes, size, f0, f1, out, cfg = args
    W, H = size
    live = {}
    enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                            "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "15",
                            "-pix_fmt", "yuv420p", "-threads", "2", str(out)], stdin=subprocess.PIPE)
    for f in range(f0, f1):
        t = f / FPS
        act = [i for i, s in enumerate(scenes)
               if s["start"] - (XF / 2 if i else 0) <= t < s["end"] + (XF / 2 if i < len(scenes) - 1 else 1)]
        act = act[-2:] or [len(scenes) - 1]
        for i in list(live):
            if i not in act and scenes[i]["end"] + XF < t:
                live.pop(i)
        imgs = []
        for i in act:
            if i not in live:
                live[i] = build(scenes[i], size, i, cfg)
            imgs.append(live[i].frame(t - scenes[i]["start"] + (XF / 2 if i else 0)).convert("RGB"))
        if len(imgs) == 2:
            a = (t - (scenes[act[1]]["start"] - XF / 2)) / XF
            frame = Image.blend(imgs[0], imgs[1], ease(a))
        else:
            frame = imgs[0]
        enc.stdin.write(frame.tobytes())
    enc.stdin.close()
    enc.wait()
    return out


def render(scenes: list[dict], size, total: float, out: Path, cfg: dict) -> Path:
    if out.exists():
        return out
    frames = int(math.ceil(total * FPS))
    workers = max(1, min(4, os.cpu_count() or 2))
    step = max(FPS * 15, frames // workers + 1)
    tmp = out.parent / (out.stem + "_parts")
    tmp.mkdir(parents=True, exist_ok=True)
    jobs = [(scenes, size, f0, min(frames, f0 + step), tmp / f"p{k:03d}.mp4", cfg) for k, f0 in enumerate(range(0, frames, step))]
    with ProcessPoolExecutor(workers) as ex:
        parts = list(ex.map(_chunk, jobs))
    lst = tmp / "list.txt"
    lst.write_text("".join(f"file '{p.resolve()}'\n" for p in parts))
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out)], check=True)
    return out


def summary(scenes: list[dict]) -> str:
    return "\n".join(f"{s['start']:7.1f}-{s['end']:6.1f}  {s['type']:8s} {s.get('name') or s.get('title') or Path(s.get('file', '')).name:<14} | {s['why']}  «{s['text'][:40]}»"
                     for s in scenes)
