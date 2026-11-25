"""Step 2c - pick the 3-5 best self-contained 30-60 s moments for Shorts/Reels/TikTok.

With Claude API credentials: Claude reads the edited transcript (and her notes) and picks
moments with a strong opening line and an emotional or funny payoff, writes the on-screen
hook and explains each pick. Without: a scoring heuristic (emotion words, story topics,
question/exclamation openers, clean sentence ends) with an auto-generated reason.

Each moment is a range of transcript sentence ids; its pieces are the long edit's kept
ranges inside it, so Shorts get the same silence/repeat cleanup.
"""
from __future__ import annotations

import re

from . import ai
from .common import norm_ar
from .keywords import emotion_score, match_topics

SCHEMA = {
    "type": "object",
    "properties": {"moments": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "start_id": {"type": "integer"}, "end_id": {"type": "integer"},
            "hook": {"type": "string", "description": "on-screen hook for the first 2 s, Egyptian Arabic, max 8 words"},
            "title": {"type": "string", "description": "short working title, Egyptian Arabic"},
            "why": {"type": "string", "description": "1-3 sentences in English: why this moment works as a Short"},
        },
        "required": ["start_id", "end_id", "hook", "title", "why"], "additionalProperties": False}}},
    "required": ["moments"], "additionalProperties": False,
}

SYSTEM = """You are the editor of "عدالة زمان", a YouTube channel where an Egyptian mother, عدالة, tells stories
in Egyptian Arabic about life in the old days (the simple house, laundry day with the طشت and النيلة,
Ramadan around the radio...). You pick moments for vertical Shorts/Reels/TikTok."""


def sentence_table(tr: dict, edit: dict) -> list[dict]:
    """Kept sentences with their position/duration on the edited timeline."""
    by_seg = {}
    for w in edit["words"]:
        if w["t"] is None:
            continue
        by_seg.setdefault(w["seg"], []).append(w)
    rows = []
    for s in tr["segments"]:
        ws = by_seg.get(s["id"])
        if not ws:
            continue
        rows.append({"id": s["id"], "t0": ws[0]["t"] - (ws[0]["end"] - ws[0]["start"]) / 2,
                     "t1": ws[-1]["t"] + (ws[-1]["end"] - ws[-1]["start"]) / 2,
                     "a": s["start"], "b": s["end"], "text": " ".join(w["word"] for w in ws)})
    return rows


def _dur(rows, i, j):
    return rows[j]["t1"] - rows[i]["t0"]


def heuristic(rows: list[dict], k_min=3, k_max=5) -> list[dict]:
    cands = []
    for i in range(len(rows)):
        for j in range(i, len(rows)):
            d = _dur(rows, i, j)
            if d > 60:
                break
            if d < 30:
                continue
            text = " ".join(r["text"] for r in rows[i:j + 1])
            first = rows[i]["text"]
            emo, topics = emotion_score(text), sum(h for _, h in match_topics(text))
            opener = emotion_score(first) > 0 or bool(re.search(r"[؟?!]", first)) or any(
                w in norm_ar(first) for w in ("كان زمان", "زمان", "فاكرين", "تعرفوا", "تصدقوا", "اول مره"))
            score = emo * 1.6 + topics + 2.5 * opener + 1.0 * bool(re.search(r"[.!؟?]$", rows[j]["text"])) - abs(d - 45) / 15
            cands.append((score, i, j, emo, topics, opener, d))
    cands.sort(reverse=True)
    picked = []
    for c in cands:
        if all(c[2] < p[1] or c[1] > p[2] for p in picked):
            picked.append(c)
        if len(picked) >= k_max:
            break
    if picked:
        picked = [p for n, p in enumerate(picked) if n < k_min or p[0] >= picked[0][0] * 0.55]
    out = []
    for score, i, j, emo, topics, opener, d in sorted(picked, key=lambda p: p[1]):
        hook_src = max(rows[i:j + 1], key=lambda r: emotion_score(r["text"]) * 2 + sum(h for _, h in match_topics(r["text"])))
        hw = hook_src["text"].split()
        reasons = []
        if opener:
            reasons.append("opens on a question/exclamation or a 'back in the day' line")
        if emo:
            reasons.append(f"{emo} emotional beat(s) (e.g. memories, laughter, a blessing)")
        if topics:
            reasons.append("names concrete old-days objects/places viewers recognise")
        reasons.append(f"{d:.0f}s, ends on a complete sentence")
        out.append({"start_id": rows[i]["id"], "end_id": rows[j]["id"],
                    "hook": " ".join(hw[:7]) + ("…" if len(hw) > 7 else ""),
                    "title": " ".join(rows[i]["text"].split()[:6]),
                    "why": "Heuristic pick: " + "; ".join(reasons) + ".", "picked_by": "heuristic"})
    return out


def pick(tr: dict, edit: dict, cfg: dict, notes: list, notes_txt: str = "") -> list[dict]:
    rows = sentence_table(tr, edit)
    k_min, k_max = cfg["n_shorts"]
    moments = None
    if ai.available() and rows:
        listing = "\n".join(f"[{r['id']}] ({r['t0']:.1f}-{r['t1']:.1f}s) {r['text']}" for r in rows)
        content = [*[ai.image_block(p) for p in notes[:6]],
                   {"type": "text", "text":
                    f"{'Above are photos of her handwritten notes for this episode. ' if notes else ''}"
                    f"{('Typed reading of the notes:' + chr(10) + notes_txt + chr(10) + chr(10)) if notes_txt else ''}"
                    "Here is the edited transcript. Each line: [sentence id] (start-end seconds on the edited "
                    f"timeline) text.\n\n{listing}\n\n"
                    f"Pick {k_min}-{k_max} non-overlapping moments for Shorts. Each moment is a contiguous range "
                    "start_id..end_id lasting 30-60 seconds (end of end_id minus start of start_id). Each must be "
                    "self-contained (understandable with no context), start on a strong opening line (no 'و', 'فـ' or "
                    "mid-thought start), and carry an emotional or funny story with a payoff before it ends. "
                    "Prefer variety across the episode. Write the hook as text a viewer reads in the first 2 seconds: "
                    "Egyptian Arabic, max 8 words, curiosity or emotion, no clickbait lies."}]
        res = ai.ask_json(SYSTEM, content, SCHEMA, cfg["claude_model"])
        if res and res.get("moments"):
            moments = [{**m, "picked_by": "claude"} for m in res["moments"]]
    if not moments:
        moments = heuristic(rows, k_min, k_max)
    return validate(rows, moments)


def validate(rows: list[dict], moments: list[dict]) -> list[dict]:
    """Snap each moment to 30-60 s on the edited timeline and attach its raw range."""
    idx = {r["id"]: n for n, r in enumerate(rows)}
    good = []
    for m in moments:
        if m["start_id"] not in idx or m["end_id"] not in idx:
            continue
        i, j = idx[m["start_id"]], idx[m["end_id"]]
        while j > i and _dur(rows, i, j) > 60:
            j -= 1
        while j + 1 < len(rows) and _dur(rows, i, j) < 30:
            j += 1
        d = _dur(rows, i, j)
        if not 25 <= d <= 62:
            continue
        good.append({**m, "end_id": rows[j]["id"], "raw_a": rows[i]["a"] - 0.2, "raw_b": rows[j]["b"] + 0.3,
                     "duration": round(d, 1), "opening_line": rows[i]["text"]})
    return good
