"""Burnt-in Arabic captions as ASS subtitles (libass shapes Arabic + RTL correctly).

long  : sentence-chunk captions at the bottom, cream on dark-brown outline
shorts: big centred word-by-word captions (current word in gold, with a pop),
        hook text for the first ~2 s, CTA at the end
"""
from __future__ import annotations

import re
from pathlib import Path

from .common import read_json, WORK

CREAM, GOLD, BROWN, BOX = "&H00DCF0FA", "&H005CB0DE", "&H00101A28", "&H5A0E1620"
PUNCT_END = re.compile(r"[.!?؟،,…:]$")


def _t(x: float) -> str:
    x = max(0.0, x)
    h, m, s = int(x // 3600), int(x % 3600 // 60), x % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _esc(s: str) -> str:
    return s.replace("\\", "").replace("{", "(").replace("}", ")").strip()


def _header(W, H, styles):
    return (f"[Script Info]\nScriptType: v4.00+\nPlayResX: {W}\nPlayResY: {H}\nWrapStyle: 0\n"
            "ScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\n\n[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
            "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
            "MarginR, MarginV, Encoding\n" + "\n".join(styles) +
            "\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")


def _style(name, font, size, primary=CREAM, outline=BROWN, back="&H96000000", bold=-1, border=1, ol=3.5, sh=2.0,
           align=2, ml=80, mr=80, mv=60):
    return (f"Style: {name},{font},{size},{primary},{primary},{outline},{back},{bold},0,0,0,100,100,0,0,"
            f"{border},{ol},{sh},{align},{ml},{mr},{mv},1")


def _words_in(tr, a, b):
    out = []
    for s in tr["segments"]:
        ws = s["words"] or [{"start": s["start"], "end": s["end"], "word": s["text"]}]
        for k, w in enumerate(ws):
            mid = (w["start"] + w["end"]) / 2
            if a <= mid < b:
                out.append({**w, "seg_end": k == len(ws) - 1})
    return out


def chunk_words(words, max_words, max_chars, max_dur, gap_break=0.6):
    chunks, cur = [], []
    for i, w in enumerate(words):
        if cur:
            text = " ".join(x["word"] for x in cur + [w])
            gap = w["start"] - cur[-1]["end"]
            if (len(cur) >= max_words or len(text) > max_chars or w["end"] - cur[0]["start"] > max_dur
                    or gap > gap_break or PUNCT_END.search(cur[-1]["word"]) or cur[-1]["seg_end"]):
                chunks.append(cur)
                cur = []
        cur.append(w)
    if cur:
        chunks.append(cur)
    return chunks


def write_long(plan: dict, out: Path, tr=None, font="Noto Naskh Arabic") -> Path:
    tr = tr or read_json(WORK / "transcript.json")
    W, H = plan["size"]
    off, a, b = plan["voice_offset"], plan["voice_in"], plan["voice_out"]
    mv = 150 if plan.get("waveform", True) else 70
    body = [_header(W, H, [_style("Cap", font, 68, ol=4, sh=2.5, mv=mv)])]
    chunks = chunk_words(_words_in(tr, a, b), max_words=8, max_chars=46, max_dur=4.8)
    for i, c in enumerate(chunks):
        st = c[0]["start"] - a + off
        en = c[-1]["end"] - a + off + 0.3
        if i + 1 < len(chunks):
            en = min(en, chunks[i + 1][0]["start"] - a + off - 0.02)
        txt = _esc(" ".join(w["word"] for w in c)).rstrip("،,")
        body.append(f"Dialogue: 0,{_t(st)},{_t(en)},Cap,,0,0,0,,{{\\fad(120,120)}}{txt}\n")
    out.write_text("".join(body), encoding="utf-8")
    return out


def write_short(plan: dict, out: Path, tr=None, font="Noto Naskh Arabic") -> Path:
    tr = tr or read_json(WORK / "transcript.json")
    W, H = plan["size"]
    a, b = plan["voice_in"], plan["voice_out"]
    dur = b - a
    styles = [
        _style("Word", font, 118, ol=7, sh=3, align=5),
        _style("Hook", font, 92, primary=CREAM, outline=BOX, back=BOX, border=3, ol=22, sh=0, align=8, ml=90, mr=90, mv=300),
        _style("CTA", font, 54, primary=CREAM, outline=BOX, back=BOX, border=3, ol=16, sh=0, align=2, ml=90, mr=90, mv=230),
    ]
    body = [_header(W, H, styles)]
    cx, cy = W // 2, int(H * 0.73)
    chunks = chunk_words(_words_in(tr, a, b), max_words=3, max_chars=22, max_dur=2.2, gap_break=0.45)
    for ci, c in enumerate(chunks):
        nxt = chunks[ci + 1][0]["start"] if ci + 1 < len(chunks) else c[-1]["end"] + 0.4
        for k, w in enumerate(c):
            st = w["start"] - a
            en = (c[k + 1]["start"] if k + 1 < len(c) else min(nxt, w["end"] + 0.4)) - a
            parts = []
            for j, x in enumerate(c):
                word = _esc(x["word"])
                if j == k:
                    parts.append(f"{{\\c{GOLD}\\fscx88\\fscy88\\t(0,90,\\fscx112\\fscy112)\\t(90,160,\\fscx106\\fscy106)}}"
                                 f"{word}{{\\c{CREAM}\\fscx100\\fscy100}}")
                else:
                    parts.append(word)
            fade = "\\fad(60,0)" if k == 0 else ""
            body.append(f"Dialogue: 1,{_t(st)},{_t(en)},Word,,0,0,0,,{{\\pos({cx},{cy}){fade}}}{' '.join(parts)}\n")
    if plan.get("hook"):
        body.append(f"Dialogue: 2,{_t(0)},{_t(2.4)},Hook,,0,0,0,,{{\\fad(0,300)\\t(0,120,\\fscx104\\fscy104)\\t(120,240,\\fscx100\\fscy100)}}"
                    f"{_esc(plan['hook'])}\n")
    if plan.get("cta"):
        body.append(f"Dialogue: 2,{_t(max(0, dur - 2.6))},{_t(dur)},CTA,,0,0,0,,{{\\fad(250,0)}}{_esc(plan['cta'])}\n")
    out.write_text("".join(body), encoding="utf-8")
    return out
