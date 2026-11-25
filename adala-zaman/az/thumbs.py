"""YouTube thumbnails (1280x720): 3 variants per episode, for YouTube's "Test & compare".

Face episodes: her sharpest, largest, best-framed face moments, placed on the right third.
Faceless episodes: the episode's main drawn objects, big, on warm paper.
Text: 2-4 big words (never the full title), heavy Arabic face, thick outline; channel badge.
Kept bright and warm: tiny phone thumbnails punish dark sepia.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from .common import CHANNEL, font_path, paper_texture, sepia

TW, TH = 1280, 720


def _font(px):
    for spec in ("Noto Kufi Arabic:black", "Noto Kufi Arabic:bold", "Noto Naskh Arabic:bold"):
        p = font_path(spec)
        if p and ("Kufi" in p or "Naskh" in p):          # fc-match silently falls back to Latin fonts
            return ImageFont.truetype(p, px, layout_engine=ImageFont.Layout.RAQM)
    raise RuntimeError("no Arabic font found - run setup.sh")


FILLER = {"كان", "كانت", "في", "اللي", "و", "من", "على", "عن", "ده", "دي", "يا", "بقى"}


def short_text(s: str, n=3) -> str:
    """2-3 words that stand alone: stop at the first natural break, drop trailing filler words."""
    s = re.split(r"\.\.|…|[؟?!،,:]", s)[0]
    w = re.sub(r"[.«»\"]", " ", s).split()[:n]
    while len(w) > 1 and w[-1] in FILLER:
        w.pop()
    return " ".join(w)


def _grab(src: Path, t: float, w=1920) -> Image.Image | None:
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(src), "-frames:v", "1", "-vf",
                        f"scale={w}:-2", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True)
    if r.returncode or not r.stdout:
        return None
    import io
    return Image.open(io.BytesIO(r.stdout)).convert("RGB")


def face_candidates(src: Path, face_track: dict, k=3) -> list[tuple[Image.Image, tuple]]:
    import cv2
    pts = face_track.get("points") or []
    if not pts:
        return []
    mw = float(np.median([p[3] for p in pts]))
    pts = [p for p in pts if 0.7 * mw <= p[3] <= 1.4 * mw]    # her usual face size only (drops false detections)
    pts = sorted(pts, key=lambda p: -p[3])[:60]
    scored = []
    for t, fx, fy, fw in pts[::max(1, len(pts) // 25)]:
        im = _grab(src, t)
        if im is None:
            continue
        g = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2GRAY)
        x0, y0 = int((fx - fw) * im.width), int((fy - fw) * im.height)
        x1, y1 = int((fx + fw) * im.width), int((fy + fw) * im.height)
        crop = g[max(0, y0):max(1, y1), max(0, x0):max(1, x1)]
        sharp = cv2.Laplacian(crop, cv2.CV_64F).var() if crop.size else 0
        scored.append((sharp * fw, t, im, (fx, fy, fw)))
    scored.sort(key=lambda s: -s[0])
    out, used = [], []
    for sc, t, im, f in scored:
        if all(abs(t - u) > 15 for u in used):
            out.append((im, f))
            used.append(t)
        if len(out) == k:
            break
    return out


def _face_layout(im: Image.Image, face) -> Image.Image:
    """Crop so her face sits on the right third, about 45% of the frame height."""
    fx, fy, fw = face
    fh_px = fw * im.width * 1.25                              # face box height in px (approx)
    scale = (TH * 0.45) / max(fh_px, 1)
    scale = max(scale, TW / im.width, TH / im.height)
    big = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    cx, cy = fx * big.width, fy * big.height
    x0 = int(min(max(cx - TW * 0.68, 0), big.width - TW))
    y0 = int(min(max(cy - TH * 0.42, 0), big.height - TH))
    return big.crop((x0, y0, x0 + TW, y0 + TH))


def _object_layout(names: list[str], k: int) -> Image.Image:
    from .graphics import GRAPHICS, Pen
    bg = paper_texture((TW, TH), seed=11 + k).convert("RGB")
    bg = ImageEnhance.Brightness(bg).enhance(1.08)
    name = names[k % len(names)] if names else "radio"
    S = int(TH * 0.8)
    pen = Pen(S)                       # draw straight onto a transparent layer: clean edges, no paper square
    GRAPHICS[name](pen, 2.2)
    obj = pen.result(S)
    shadow = Image.new("RGBA", obj.size, (40, 25, 10, 0))
    shadow.putalpha(obj.getchannel("A").point(lambda v: int(v * 0.35)).filter(ImageFilter.GaussianBlur(14)))
    canvas = bg.convert("RGBA")
    x, y = int(TW * 0.98 - S), int(TH * 0.12)
    canvas.alpha_composite(shadow, (x + 16, y + 20))
    canvas.alpha_composite(obj, (x, y))
    return canvas.convert("RGB")


def _text(img: Image.Image, text: str, accent=(255, 214, 92)) -> Image.Image:
    d = ImageDraw.Draw(img)
    words = text.split()
    lines = [" ".join(words[:2]), " ".join(words[2:])] if len(words) > 2 else [text]
    lines = [l for l in lines if l]
    px = 150 if len(lines) == 1 else 128
    f = _font(px)
    while max(f.getlength(l) for l in lines) > TW * 0.56 and px > 70:
        px -= 8
        f = _font(px)
    y = TH * 0.5 - (len(lines) - 1) * px * 0.62
    for i, l in enumerate(lines):
        xc = TW * 0.3
        col = accent if i == len(lines) - 1 else (255, 248, 235)
        d.text((xc + 6, y + 8), l, font=f, fill=(0, 0, 0), anchor="mm", stroke_width=14, stroke_fill=(0, 0, 0))
        d.text((xc, y), l, font=f, fill=col, anchor="mm", stroke_width=12, stroke_fill=(45, 26, 12))
        y += px * 1.22
    # channel badge
    bf = _font(34)
    bw = bf.getlength(CHANNEL) + 48
    d.rounded_rectangle([28, 26, 28 + bw, 86], radius=30, fill=(92, 52, 26))
    d.text((28 + bw / 2, 56), CHANNEL, font=bf, fill=(255, 236, 200), anchor="mm")
    return img


def _finish(img: Image.Image) -> Image.Image:
    img = sepia(img, 0.25)
    img = ImageEnhance.Contrast(img).enhance(1.12)
    img = ImageEnhance.Color(img).enhance(1.15)
    img = ImageEnhance.Brightness(img).enhance(1.05)
    # gentle left-side darkening so the text pops, no heavy vignette
    grad = Image.linear_gradient("L").rotate(90).resize((TW, TH))
    shade = Image.new("RGB", (TW, TH), (30, 18, 8))
    return Image.composite(img, shade, grad.point(lambda v: int(150 + v * 105 / 255)))


def make(out_dir: Path, name: str, texts: list[str], src: Path | None, face_track: dict | None,
         objects: list[str], exact: bool = False, contexts: list[str] | None = None) -> list[Path]:
    """objects: fallback drawn objects; contexts[k]: text whose topic picks thumbnail k's object."""
    from .keywords import match_topics
    texts = [t.strip() if exact else short_text(t) for t in texts if t.strip()] or [CHANNEL]
    texts = [re.sub(r"[!?\"']", "", t).strip() for t in texts]      # Latin punctuation has no Kufi glyph
    cands = face_candidates(src, face_track) if (src and face_track) else []
    outs = []
    for k in range(3):
        if cands:
            im, face = cands[k % len(cands)]
            base = _face_layout(im, face)
        else:
            pick = None
            for txt in (texts[k % len(texts)], (contexts or [""] * 3)[k % max(1, len(contexts or [1]))]):
                pick = next((tp["graphic"] for tp, _ in match_topics(txt or "") if tp.get("graphic")), None)
                if pick:
                    break
            base = _object_layout([pick] if pick else objects, 0 if pick else k)
        img = _text(_finish(base), texts[k % len(texts)])
        p = out_dir / f"{name}_thumbnail_{k + 1}.jpg"
        img.save(p, quality=92)
        outs.append(p)
    return outs
