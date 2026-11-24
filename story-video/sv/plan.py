"""Step 2: transcript -> editable scene plans.

work/plan_long.json   - the long 16:9 video (intro card, story scenes every 4-8 s, outro card)
work/plan_shorts.json - 3-5 best 30-60 s moments, each with its own 9:16 scene list + hook text

Both are plain JSON on purpose: review / hand-edit them (swap a photo, fix a hook,
move a cut), then render. Times inside a plan are on the OUTPUT timeline.
"""
from __future__ import annotations

import json
import random
import re
from pathlib import Path

from .common import LONG_SIZE, PHOTOS, ROOT, SHORT_SIZE, WORK, load_config, norm_ar, read_json, token_forms, write_json
from .keywords import TOPICS, emotion_score, match_topics

IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp", ".tif", ".tiff"}
SENT_END = re.compile(r"[.!?؟،,…]$")
YEAR = re.compile(r"(?<!\d)(19[0-9]{2}|20[0-2][0-9]|١٩[٠-٩]{2}|٢٠[٠-٢][٠-٩])(?!\d)")


# ------------------------------------------------------------------ inputs
def all_words(tr: dict) -> list[dict]:
    words = []
    for si, s in enumerate(tr["segments"]):
        ws = s["words"] or [{"start": s["start"], "end": s["end"], "word": s["text"]}]
        for k, w in enumerate(ws):
            words.append({**w, "seg": si, "seg_end": k == len(ws) - 1})
    return words


def load_photos() -> list[dict]:
    """photos/ + optional photos/tags.json {"file.jpg": ["ستي", "الفرح", ...]}.
    Filenames count as tags too (e.g. radio.jpg, راديو_جدي.jpg)."""
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
        out.append({"file": str(p.relative_to(ROOT)), "tokens": toks, "topics": topics,
                    "tagged": bool(tags.get(rel)) or bool(topics)})
    return out


# ------------------------------------------------------------------ scene cuts
def cut_scenes(words, t0, t1, smin, smax, target):
    """Split [t0, t1] (voice time) into scenes whose cuts fall between words,
    preferring sentence ends and pauses. Returns [(start, end, text)]."""
    ws = [w for w in words if w["end"] > t0 and w["start"] < t1]
    bounds = []
    for i in range(len(ws) - 1):
        gap = max(0.0, ws[i + 1]["start"] - ws[i]["end"])
        b = (ws[i]["end"] + ws[i + 1]["start"]) / 2
        bonus = gap * 2.0 + (1.2 if ws[i]["seg_end"] else 0) + (0.8 if SENT_END.search(ws[i]["word"]) else 0)
        bounds.append((b, bonus))
    scenes, t = [], t0
    while t1 - t > smax:
        cands = [(abs(b - (t + target)) - bonus, b) for b, bonus in bounds if t + smin <= b <= t + smax]
        nb = min(cands)[1] if cands else t + target
        scenes.append([t, nb])
        t = nb
    if scenes and t1 - t < smin:
        scenes[-1][1] = t1
    else:
        scenes.append([t, t1])
    out = []
    for a, b in scenes:
        text = " ".join(w["word"] for w in ws if (w["start"] + w["end"]) / 2 >= a and (w["start"] + w["end"]) / 2 < b)
        out.append((round(a, 3), round(b, 3), text))
    return out


# ------------------------------------------------------------------ visual choice
class Chooser:
    def __init__(self, photos, seed=1):
        self.photos = photos
        self.use = {}            # key -> last used time
        self.count = {}
        self.stock_pick = {}
        self.last_quote = -1e9
        self.prev_type = None
        self.rng = random.Random(seed)

    def _fresh(self, key, t, gap):
        return t - self.use.get(key, -1e9) >= gap

    def _mark(self, key, t):
        self.use[key] = t
        self.count[key] = self.count.get(key, 0) + 1

    def choose(self, text: str, t: float, allow_quote=True) -> dict:
        topics = match_topics(text)
        toks = set()
        for tok in norm_ar(text).split():
            toks |= token_forms(tok)
        # 0) a year mentioned -> year card (once per year)
        m = YEAR.search(text)
        if m and self._fresh("year:" + m.group(1), t, 1e9):
            self._mark("year:" + m.group(1), t)
            return {"type": "year", "title": m.group(1), "why": "year mentioned"}
        # 1) tagged family photo / prop photo that matches what she's saying
        best, best_score = None, 0
        for ph in self.photos:
            if not ph["tagged"] or not self._fresh(ph["file"], t, 45):
                continue
            score = len(ph["tokens"] & toks) * 2 + sum(h for tp, h in topics if tp["id"] in ph["topics"]) * 3
            score -= self.count.get(ph["file"], 0)
            if score > best_score:
                best, best_score = ph, score
        if best:
            self._mark(best["file"], t)
            return {"type": "photo", "file": best["file"], "why": "photo tags match"}
        for tp, _hits in topics:
            g = tp.get("graphic")
            # 2) drawn motion graphic for the object
            if g and self._fresh("g:" + g, t, 40) and self.prev_type != "graphic":
                self._mark("g:" + g, t)
                return {"type": "graphic", "name": g, "label": tp.get("label"), "why": f"mentions {tp['id']}"}
            # 3) stock footage for the topic
            if tp.get("stock") and self._fresh("s:" + tp["id"], t, 12):
                n = self.stock_pick.get(tp["stock"], 0)
                self.stock_pick[tp["stock"]] = n + 1
                self._mark("s:" + tp["id"], t)
                return {"type": "stock", "query": tp["stock"], "pick": n, "why": f"mentions {tp['id']}"}
        # 4) occasional quote card of her own words
        nwords = len(text.split())
        if allow_quote and 5 <= nwords <= 16 and t - self.last_quote > 75 and emotion_score(text) > 0:
            self.last_quote = t
            return {"type": "quote", "title": text.strip(" .،,"), "why": "emotional line"}
        # 5) family photos as the default backbone (least-used first)
        if self.photos:
            pool = sorted(self.photos, key=lambda p: (self.count.get(p["file"], 0), self.use.get(p["file"], -1e9)))
            fresh = [p for p in pool if self._fresh(p["file"], t, 30)] or pool
            ph = fresh[0]
            self._mark(ph["file"], t)
            return {"type": "photo", "file": ph["file"], "why": "family photo (filler)"}
        # 6) generic nostalgic stock
        q = self.rng.choice(["vintage family photo", "old photographs album", "old cairo street", "vintage living room"])
        n = self.stock_pick.get(q, 0)
        self.stock_pick[q] = n + 1
        return {"type": "stock", "query": q, "pick": n, "why": "generic filler"}

    def pick(self, text, t, **kw):
        v = self.choose(text, t, **kw)
        self.prev_type = v["type"]
        return v


# ------------------------------------------------------------------ plans
def plan_long(tr: dict, cfg: dict) -> dict:
    words = all_words(tr)
    intro, outro = cfg["intro_seconds"], cfg["outro_seconds"]
    dur = tr["duration"]
    chooser = Chooser(load_photos())
    scenes = [{"start": 0.0, "end": intro, "type": "card", "kind": "title",
               "title": cfg["title_ar"], "subtitle": cfg["subtitle_ar"]}]
    for a, b, text in cut_scenes(words, 0.0, dur, cfg["scene_min"], cfg["scene_max"], cfg["scene_target"]):
        v = chooser.pick(text, a)
        scenes.append({"start": round(a + intro, 3), "end": round(b + intro, 3), **v, "text": text})
    scenes.append({"start": round(dur + intro, 3), "end": round(dur + intro + outro, 3), "type": "card",
                   "kind": "outro", "title": cfg["outro_ar"], "subtitle": cfg["outro_sub_ar"]})
    return {"size": list(LONG_SIZE), "voice_offset": intro, "voice_in": 0.0, "voice_out": dur,
            "duration": round(dur + intro + outro, 3), "scenes": scenes}


def find_moments(tr: dict, k_max=5, k_min=3, lo=30.0, hi=60.0) -> list[dict]:
    segs = tr["segments"]
    cands = []
    for i in range(len(segs)):
        for j in range(i, len(segs)):
            a, b = segs[i]["start"], segs[j]["end"]
            d = b - a
            if d > hi:
                break
            if d < lo:
                continue
            text = " ".join(s["text"] for s in segs[i:j + 1])
            nw = len(text.split())
            topic_hits = sum(h for _, h in match_topics(text))
            emo = emotion_score(text)
            first = segs[i]["text"]
            score = (topic_hits * 1.0 + emo * 1.6
                     + 2.0 * (emotion_score(first) > 0 or "؟" in first or "?" in first)
                     + 1.0 * bool(SENT_END.search(segs[j]["text"].strip()))
                     - abs(d - 45) / 15
                     - (3 if nw / d < 1.2 else 0))   # too much silence
            cands.append((score, a, b, i, j, text))
    cands.sort(reverse=True)
    picked = []
    for c in cands:
        if all(c[2] <= p[1] or c[1] >= p[2] for p in picked):
            picked.append(c)
        if len(picked) >= k_max:
            break
    if picked:
        best = picked[0][0]
        keep = [p for p in picked if p[0] >= best * 0.5 or picked.index(p) < k_min]
    else:
        keep = []
    out = []
    for n, (score, a, b, i, j, text) in enumerate(sorted(keep, key=lambda p: p[1]), 1):
        seg_scores = sorted(segs[i:j + 1], key=lambda s: -(emotion_score(s["text"]) + sum(h for _, h in match_topics(s["text"]))))
        hook_words = seg_scores[0]["text"].split()
        hook = " ".join(hook_words[:7]) + ("…" if len(hook_words) > 7 else "")
        out.append({"id": f"short_{n}", "voice_in": round(max(0, a - 0.15), 3), "voice_out": round(b + 0.35, 3),
                    "hook": hook, "score": round(score, 2), "text": text})
    return out


def plan_short(tr: dict, m: dict, cfg: dict, seed: int) -> dict:
    words = all_words(tr)
    a, b = m["voice_in"], m["voice_out"]
    chooser = Chooser(load_photos(), seed=seed)
    scenes = []
    for s, e, text in cut_scenes(words, a, b, 3.0, 5.5, 4.0):
        v = chooser.pick(text, s, allow_quote=False)
        scenes.append({"start": round(s - a, 3), "end": round(e - a, 3), **v, "text": text})
    return {"id": m["id"], "size": list(SHORT_SIZE), "voice_offset": 0.0, "voice_in": a, "voice_out": b,
            "duration": round(b - a, 3), "hook": m["hook"], "cta": cfg["shorts_cta_ar"], "scenes": scenes}


def make_plans(n_shorts: tuple[int, int] = (3, 5)) -> tuple[dict, dict]:
    cfg = load_config()
    tr = read_json(WORK / "transcript.json")
    long_plan = plan_long(tr, cfg)
    write_json(WORK / "plan_long.json", long_plan)
    moments = find_moments(tr, k_max=n_shorts[1], k_min=n_shorts[0])
    shorts = {"shorts": [plan_short(tr, m, cfg, seed=i + 2) for i, m in enumerate(moments)]}
    write_json(WORK / "plan_shorts.json", shorts)
    return long_plan, shorts


def summary(plan: dict) -> str:
    lines = []
    for s in plan["scenes"]:
        what = s.get("file") or s.get("name") or s.get("query") or s.get("title", "")
        lines.append(f"{s['start']:7.2f}-{s['end']:7.2f}  {s['type']:8s} {what}  | {s.get('text', '')[:60]}")
    return "\n".join(lines)


if __name__ == "__main__":
    lp, sp = make_plans()
    print(summary(lp))
    for sh in sp["shorts"]:
        print(f"\n== {sh['id']} {sh['voice_in']}-{sh['voice_out']} hook: {sh['hook']}")
        print(summary(sh))
    _ = Path
