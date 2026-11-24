"""Step 1 - Arabic transcript with word timestamps, plus a round-trip for human fixes.

Writes into <episode>/01_transcript/:
  transcript.txt   <- EDIT THIS: one numbered line per sentence. Fix words in place.
                      Start a line with "x " to cut that sentence from the video.
  transcript.srt   subtitles on the RAW video's timeline
  transcript.json  machine copy (segments + word timings)
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import numpy as np

from .common import load_config, read_json, run, ts, write_json

LINE = re.compile(r"^\s*\[(\d+)\]\s+([\d:.]+)\s*→\s*([\d:.]+)\s*\|\s?(.*)$")
HEADER = """# عدالة زمان - transcript ({name})
# Fix misheard words directly on each line (keep the [number] and times as they are).
# To cut a whole sentence from the video, put "x " at the start of its text, e.g.:
#   [0007] 00:01:02.300 → 00:01:05.100 | x كنت كنت بقول
# Save, then run the same command again.
"""


def extract_audio(src: Path, out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-af", "highpass=f=70", out])
    return out


def transcribe(src: Path, ep: Path) -> dict:
    cfg = load_config(ep)
    d = ep / "01_transcript"
    wav = extract_audio(src, ep / "work" / "audio16k.wav")
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", str(wav), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True, check=True).stdout
    audio = np.frombuffer(pcm, np.float32)
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    from faster_whisper import WhisperModel
    model = WhisperModel(cfg["whisper_model"], device="auto", compute_type="int8",
                         download_root=str(Path.home() / ".cache" / "whisper"))
    print(f"  transcribing {len(audio) / 16000 / 60:.1f} min of audio with {cfg['whisper_model']}…", flush=True)
    opts = dict(language="ar", word_timestamps=True, beam_size=5, condition_on_previous_text=False,
                initial_prompt=cfg.get("whisper_prompt") or None,
                # her retakes repeat text; Whisper's default 2.4 would throw whole windows away as "hallucination"
                compression_ratio_threshold=3.2, log_prob_threshold=-1.5)
    segs, _info = model.transcribe(audio, vad_filter=True, vad_parameters={"min_silence_duration_ms": 400}, **opts)
    raw = [_seg(s) for s in segs]
    # safety net: speech the VAD heard but the transcript doesn't cover -> transcribe that span again
    from faster_whisper.vad import VadOptions, get_speech_timestamps
    speech = get_speech_timestamps(audio, VadOptions(min_silence_duration_ms=500, speech_pad_ms=200))
    for sp in speech:
        a, b = sp["start"] / 16000, sp["end"] / 16000
        covered = sum(max(0, min(b, s["end"]) - max(a, s["start"])) for s in raw)
        if b - a > 1.5 and covered < 0.5 * (b - a):
            print(f"  re-checking uncovered speech at {ts(a)}…", flush=True)
            extra, _ = model.transcribe(audio[int(a * 16000):int(b * 16000)], vad_filter=False, **opts)
            for s in extra:
                seg = _seg(s, offset=a)
                if not any(abs(seg["start"] - r["start"]) < 0.3 for r in raw):
                    raw.append(seg)
    raw.sort(key=lambda s: s["start"])
    # guard: drop lines that are just Whisper repeating the spelling hint back (happens on unclear audio)
    if opts["initial_prompt"]:
        from difflib import SequenceMatcher
        from .common import norm_ar
        hint = norm_ar(opts["initial_prompt"])
        kept = [r for r in raw if SequenceMatcher(None, norm_ar(r["text"]), hint).ratio() < 0.6]
        if len(kept) < len(raw):
            print(f"  dropped {len(raw) - len(kept)} line(s) that only echoed the spelling hint", flush=True)
        raw = kept
    out = {"source": str(src), "segments": []}
    for i, seg in enumerate(raw, 1):
        out["segments"].append({"id": i, **seg, "cut": False})
        print(f"  [{i:04d}] {ts(seg['start'])}  {seg['text']}", flush=True)
    write_json(d / "transcript.json", out)
    write_txt(out, d / "transcript.txt", src.name)
    write_srt(out["segments"], d / "transcript.srt")
    return out


def _seg(s, offset=0.0) -> dict:
    words = [{"start": round(w.start + offset, 3), "end": round(w.end + offset, 3), "word": w.word.strip(),
              "p": round(w.probability, 2)} for w in (s.words or []) if w.word.strip()]
    return {"start": round(s.start + offset, 3), "end": round(s.end + offset, 3), "text": s.text.strip(), "words": words}


def write_txt(tr: dict, path: Path, name: str):
    lines = [HEADER.format(name=name)]
    for s in tr["segments"]:
        low = [w["word"] for w in s["words"] if w.get("p", 1) < 0.45]
        flag = f"   # ؟ {' '.join(low)}" if low else ""
        lines.append(f"[{s['id']:04d}] {ts(s['start'])} → {ts(s['end'])} | {'x ' if s.get('cut') else ''}{s['text']}{flag}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def apply_txt_edits(ep: Path) -> tuple[dict, int]:
    """Merge the human-edited transcript.txt back into transcript.json (word timings kept/redistributed)."""
    d = ep / "01_transcript"
    tr = read_json(d / "transcript.json")
    by_id = {s["id"]: s for s in tr["segments"]}
    changed = 0
    for line in (d / "transcript.txt").read_text(encoding="utf-8").splitlines():
        m = LINE.match(line)
        if not m:
            continue
        sid, text = int(m.group(1)), m.group(4)
        text = re.sub(r"\s+#\s*؟.*$", "", text).strip()     # drop the low-confidence hint
        s = by_id.get(sid)
        if not s:
            continue
        cut = bool(re.match(r"^(x|✂)\s+", text, re.I)) or text == ""
        text = re.sub(r"^(x|✂)\s+", "", text, flags=re.I).strip()
        if cut != s.get("cut", False):
            s["cut"] = cut
            changed += 1
        if text and text != s["text"]:
            s["text"] = text
            s["words"] = retime_words(s, text.split())
            changed += 1
    write_json(d / "transcript.json", tr)
    write_srt(tr["segments"], d / "transcript.srt")
    return tr, changed


def retime_words(seg: dict, new_words: list[str]) -> list[dict]:
    old = seg["words"]
    if len(old) == len(new_words):
        return [{**w, "word": nw} for w, nw in zip(old, new_words)]
    a = old[0]["start"] if old else seg["start"]
    b = old[-1]["end"] if old else seg["end"]
    total = sum(len(w) + 1 for w in new_words) or 1
    out, t = [], a
    for w in new_words:
        d = (b - a) * (len(w) + 1) / total
        out.append({"start": round(t, 3), "end": round(t + d * 0.92, 3), "word": w, "p": 1.0})
        t += d
    return out


def caption_lines(words: list[dict], max_chars=42, max_dur=5.0, gap=0.7):
    """Group words into caption cues (used for both .srt and burnt-in captions)."""
    cues, cur = [], []
    for w in words:
        if cur:
            text = " ".join(x["word"] for x in cur + [w])
            if (len(text) > max_chars or w["end"] - cur[0]["start"] > max_dur or w["start"] - cur[-1]["end"] > gap
                    or re.search(r"[.!?؟،,…]$", cur[-1]["word"])):
                cues.append(cur)
                cur = []
        cur.append(w)
    if cur:
        cues.append(cur)
    return cues


def write_srt(segments: list[dict], path: Path, words: list[dict] | None = None):
    if words is None:
        words = [w for s in segments if not s.get("cut") for w in s["words"]]
    cues = caption_lines(words)
    out = []
    for i, c in enumerate(cues, 1):
        end = c[-1]["end"] + 0.25
        if i < len(cues):
            end = min(end, cues[i][0]["start"] - 0.01)
        out.append(f"{i}\n{ts(c[0]['start'], ',')} --> {ts(end, ',')}\n{' '.join(w['word'] for w in c)}\n")
    path.write_text("\n".join(out), encoding="utf-8")
