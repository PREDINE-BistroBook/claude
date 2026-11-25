"""Burnt-in Arabic captions as ASS (libass does the Arabic shaping + right-to-left).

long  : one clean line at the bottom, cream text with a soft dark outline
shorts: big word-by-word captions in the middle-lower area, current word in gold with a
        small pop; hook text (first 2.4 s) at the top; call-to-action at the end
"""
from __future__ import annotations

from pathlib import Path

from .transcribe import caption_lines

CREAM, GOLD, BROWN, BOX = "&H00DCF0FA", "&H004FC3F2", "&H00101A28", "&H5A0E1620"
FONT = "Noto Naskh Arabic"


def _t(x):
    x = max(0.0, x)
    return f"{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}"


def _esc(s):
    return s.replace("\\", "").replace("{", "(").replace("}", ")").strip()


def _header(W, H, styles):
    return (f"[Script Info]\nScriptType: v4.00+\nPlayResX: {W}\nPlayResY: {H}\nWrapStyle: 0\n"
            "ScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, "
            "PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, "
            "ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            + "\n".join(styles) + "\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")


def _style(name, size, primary=CREAM, outline=BROWN, back="&H96000000", border=1, ol=3.5, sh=2.0, align=2,
           ml=90, mr=90, mv=60):
    return (f"Style: {name},{FONT},{size},{primary},{primary},{outline},{back},-1,0,0,0,100,100,0,0,"
            f"{border},{ol},{sh},{align},{ml},{mr},{mv},1")


def write_long(words: list[dict], size, out: Path, end_limit: float | None = None) -> Path:
    W, H = size
    body = [_header(W, H, [_style("Cap", 62, outline=BOX, back=BOX, border=3, ol=14, sh=0, mv=60)])]
    cues = caption_lines(words, max_chars=44, max_dur=4.8)
    for i, c in enumerate(cues):
        st, en = c[0]["start"], c[-1]["end"] + 0.3
        if i + 1 < len(cues):
            en = min(en, cues[i + 1][0]["start"] - 0.02)
        if end_limit:
            en = min(en, end_limit)
        body.append(f"Dialogue: 0,{_t(st)},{_t(en)},Cap,,0,0,0,,{{\\fad(100,100)}}{_esc(' '.join(w['word'] for w in c)).rstrip('،,')}\n")
    out.write_text("".join(body), encoding="utf-8")
    return out


def write_short(words: list[dict], size, out: Path, hook: str = "", cta: str = "", duration: float = 0.0) -> Path:
    W, H = size
    styles = [_style("Word", 124, outline=BOX, back=BOX, border=3, ol=20, sh=0, align=5),
              _style("Hook", 86, outline=BOX, back=BOX, border=3, ol=24, sh=0, align=8, mv=260),
              _style("CTA", 54, outline=BOX, back=BOX, border=3, ol=16, sh=0, align=2, mv=200)]
    body = [_header(W, H, styles)]
    cx, cy = W // 2, int(H * 0.77)
    groups = caption_lines(words, max_chars=20, max_dur=2.0, gap=0.45)
    groups = [g[i:i + 3] for g in groups for i in range(0, len(g), 3)]
    for gi, g in enumerate(groups):
        nxt = groups[gi + 1][0]["start"] if gi + 1 < len(groups) else g[-1]["end"] + 0.4
        for k, w in enumerate(g):
            st = w["start"]
            en = g[k + 1]["start"] if k + 1 < len(g) else min(nxt, w["end"] + 0.4)
            parts = []
            for j, x in enumerate(g):
                word = _esc(x["word"])
                parts.append(f"{{\\c{GOLD}\\fscx90\\fscy90\\t(0,90,\\fscx112\\fscy112)\\t(90,170,\\fscx106\\fscy106)}}"
                             f"{word}{{\\c{CREAM}\\fscx100\\fscy100}}" if j == k else word)
            fade = "\\fad(60,0)" if k == 0 else ""
            body.append(f"Dialogue: 1,{_t(st)},{_t(max(en, st + 0.05))},Word,,0,0,0,,{{\\pos({cx},{cy}){fade}}}{' '.join(parts)}\n")
    if hook:
        body.append(f"Dialogue: 2,{_t(0)},{_t(2.4)},Hook,,0,0,0,,{{\\fad(0,250)\\t(0,120,\\fscx104\\fscy104)"
                    f"\\t(120,240,\\fscx100\\fscy100)}}{_esc(hook)}\n")
    if cta and duration > 6:
        body.append(f"Dialogue: 2,{_t(duration - 2.8)},{_t(duration)},CTA,,0,0,0,,{{\\fad(250,0)}}{_esc(cta)}\n")
    out.write_text("".join(body), encoding="utf-8")
    return out
