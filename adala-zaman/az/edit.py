"""Step 2a - decide what to cut.

Removes, with a logged reason for every cut (02_edit/cuts.txt):
  * sentences you marked with "x" in transcript.txt
  * repeated takes   - she says a sentence, then says it again: keep the LAST take
  * false starts     - a few words, stop, restart with the same words
  * stutter repeats  - "كنا بنروح كنا بنروح" -> the first copy (2+ words only; single-word
                       doubling like "شوية شوية" is normal Egyptian emphasis and is kept)
  * hesitation noises (اممم / ااا)
  * long silences    - pauses longer than max_pause are shortened to pause_keep

Output: a list of KEEP ranges on the raw video's timeline, and a mapping from raw time
to edited time (used by captions, B-roll and Shorts).
"""
from __future__ import annotations

from difflib import SequenceMatcher

from .common import norm_ar, ts

HESITATION = {"ام", "امم", "اممم", "ممم", "مم", "اا", "ااا", "اه اه", "اهه", "ههه"}
PAD_IN, PAD_OUT = 0.10, 0.16


def _toks(s):
    return norm_ar(s).split()


def _sim(a, b):
    return SequenceMatcher(None, a, b).ratio()


def find_cuts(segments: list[dict]) -> dict[int, str]:
    """segment id -> reason, for whole sentences to drop."""
    cut = {s["id"]: "marked with x in transcript" for s in segments if s.get("cut")}
    live = [s for s in segments if s["id"] not in cut]
    toks = [_toks(s["text"]) for s in live]
    for i, s in enumerate(live):
        if s["id"] in cut:
            continue
        if not toks[i]:
            cut[s["id"]] = "empty"
            continue
        # false start: a few words, then a restart beginning with the same words
        if i + 1 < len(live) and len(toks[i]) <= 4 and len(toks[i + 1]) > len(toks[i]) and toks[i][:2] == toks[i + 1][:2]:
            cut[s["id"]] = f"false start (restarted at [{live[i + 1]['id']:04d}])"
            continue
        # repeated take: sentence(s) i..i+w-1 said again right after (w = 1..3 fragments)
        for w in (1, 2, 3):
            if i + 2 * w > len(live):
                break
            A = [t for k in range(i, i + w) for t in toks[k]]
            for gap in (0, 1):                       # allow one fragment in between
                j = i + w + gap
                if j + w > len(live) or live[j]["start"] - live[i + w - 1]["end"] > 20:
                    continue
                B = [t for k in range(j, j + w) for t in toks[k]]
                n = min(len(A), len(B))
                same_start = SequenceMatcher(None, A[0], B[0]).ratio() >= 0.75   # a retake restarts with the same word
                if len(A) >= 2 and same_start and (_sim(A, B) >= 0.75 or (n >= 4 and _sim(A[:n], B[:n]) >= 0.8 and len(B) >= 0.8 * len(A))):
                    for k in range(i, i + w):
                        cut.setdefault(live[k]["id"], f"repeated take (kept the later take [{live[j]['id']:04d}])")
                    break
            if s["id"] in cut:
                break
    return cut


def word_level_drops(words: list[dict]) -> dict[int, str]:
    """index -> reason, for words inside kept sentences."""
    drop = {}
    norm = [norm_ar(w["word"]) for w in words]
    for k, n in enumerate(norm):
        if n in HESITATION or not n:
            drop[k] = "hesitation"
    for size in (5, 4, 3, 2):
        for k in range(len(words) - 2 * size + 1):
            if any(x in drop for x in range(k, k + 2 * size)):
                continue
            if norm[k:k + size] == norm[k + size:k + 2 * size] and words[k + size]["start"] - words[k + size - 1]["end"] < 1.2:
                for x in range(k, k + size):
                    drop[x] = f"stutter repeat: {' '.join(w['word'] for w in words[k:k + size])}"
    return drop


def build_edit(tr: dict, duration: float, max_pause: float, pause_keep: float, keep_ids=()) -> dict:
    segs = tr["segments"]
    seg_cut = {k: v for k, v in find_cuts(segs).items() if k not in set(keep_ids)}
    kept_words, removed = [], []
    for s in segs:
        if s["id"] in seg_cut:
            removed.append({"id": s["id"], "start": s["start"], "end": s["end"], "text": s["text"], "why": seg_cut[s["id"]]})
            continue
        ws = s["words"] or [{"start": s["start"], "end": s["end"], "word": s["text"]}]
        drops = word_level_drops(ws)
        for k, w in enumerate(ws):
            if k in drops:
                if not removed or removed[-1].get("why") != drops[k] or removed[-1]["id"] != s["id"]:
                    removed.append({"id": s["id"], "start": w["start"], "end": w["end"], "text": w["word"], "why": drops[k]})
                else:
                    removed[-1]["end"], removed[-1]["text"] = w["end"], removed[-1]["text"] + " " + w["word"]
            else:
                kept_words.append({**w, "seg": s["id"]})
    # keep ranges from kept words; long pauses shortened
    ranges = []
    for w in kept_words:
        a, b = max(0.0, w["start"] - PAD_IN), min(duration, w["end"] + PAD_OUT)
        if ranges and a - ranges[-1][1] <= max_pause - PAD_IN - PAD_OUT:
            ranges[-1][1] = max(ranges[-1][1], b)
        else:
            if ranges:   # keep a natural breath: extend the previous range a little
                extra = max(0.0, pause_keep - PAD_IN - PAD_OUT)
                ranges[-1][1] = min(a, ranges[-1][1] + extra)
            ranges.append([a, b])
    ranges = [[round(a, 3), round(b, 3)] for a, b in ranges if b - a > 0.12]
    # timeline mapping
    keep, t = [], 0.0
    for i, (a, b) in enumerate(ranges):
        # a "jump cut" is a boundary where content or a long pause was removed
        jump = i > 0 and (a - ranges[i - 1][1] > max_pause or any(ranges[i - 1][1] <= r["start"] < a for r in removed))
        keep.append({"a": a, "b": b, "out": round(t, 3), "jump": bool(jump)})
        t += b - a
    return {"keep": keep, "removed": removed, "edited_duration": round(t, 3), "raw_duration": duration,
            "words": [{**w, "t": map_time(keep, (w["start"] + w["end"]) / 2)} for w in kept_words]}


def map_time(keep: list[dict], src_t: float) -> float | None:
    """raw time -> edited time (None if that moment was cut)."""
    for r in keep:
        if r["a"] <= src_t <= r["b"]:
            return round(r["out"] + src_t - r["a"], 3)
    return None


def map_words(edit: dict, a: float | None = None, b: float | None = None, offset: float = 0.0) -> list[dict]:
    """Kept words with start/end on the edited timeline (+offset), optionally limited to raw [a, b]."""
    out = []
    for w in edit["words"]:
        if a is not None and not (a <= w["start"] and w["end"] <= b):
            continue
        s, e = map_time(edit["keep"], w["start"]), map_time(edit["keep"], w["end"])
        if s is None and e is None:
            continue
        s = e - (w["end"] - w["start"]) if s is None else s
        e = s + (w["end"] - w["start"]) if e is None else e
        out.append({"word": w["word"], "start": s + offset, "end": e + offset, "seg": w.get("seg")})
    return out


def cuts_report(edit: dict) -> str:
    lines = [f"Raw length {edit['raw_duration'] / 60:.1f} min  ->  edited {edit['edited_duration'] / 60:.1f} min "
             f"({len(edit['keep'])} kept pieces, {sum(1 for k in edit['keep'] if k['jump'])} jump cuts)", "",
             "REMOVED (raw time | why | what):"]
    for r in edit["removed"]:
        lines.append(f"  {ts(r['start'])}  {r['why']:<48} | {r['text']}")
    silence = edit["raw_duration"] - edit["edited_duration"] - sum(r["end"] - r["start"] for r in edit["removed"])
    lines += ["", f"Plus ~{max(0, silence):.0f}s of silences/pauses shortened.",
              "Disagree with a cut? Remove the x / fix the line in 01_transcript/transcript.txt, or add the sentence",
              "number to \"keep_ids\" in episode.json, then re-run."]
    return "\n".join(lines)
