"""Shared paths, config, fonts and image helpers."""
from __future__ import annotations

import json
import re
import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / "input"
PHOTOS = ROOT / "photos"
MUSIC = ROOT / "music"
WORK = ROOT / "work"
OUT = ROOT / "output"
FPS = 25

LONG_SIZE = (1920, 1080)
SHORT_SIZE = (1080, 1920)

# Warm vintage palette (RGB)
PAPER = (236, 222, 196)
PAPER_DARK = (214, 194, 160)
INK = (74, 50, 32)
INK_SOFT = (120, 88, 60)
SEPIA_MID = (168, 128, 88)
SEPIA_LIGHT = (205, 170, 125)
GOLD = (222, 176, 92)
CREAM = (250, 240, 220)

DEFAULT_CONFIG = {
    "title_ar": "حكايات زمان",
    "subtitle_ar": "",
    "outro_ar": "شكراً إنكم سمعتوا الحكاية",
    "outro_sub_ar": "",
    "shorts_cta_ar": "الحكاية كاملة على القناة",
    "intro_seconds": 5.0,
    "outro_seconds": 6.0,
    "waveform": True,
    "music_db": -9,           # music level before ducking (auto-ducks ~15 dB under her voice)
    "sepia_strength": 0.8,    # how much family photos get toned (0..1)
    "whisper_model": "large-v3",
    "language": "ar",
    "whisper_prompt": "",
    "scene_min": 4.0,
    "scene_max": 8.0,
    "scene_target": 6.0,
}


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    p = ROOT / "project.json"
    if p.exists():
        cfg.update(json.loads(p.read_text(encoding="utf-8")))
    return cfg


def read_json(p: Path):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def write_json(p: Path, data) -> None:
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


@lru_cache(None)
def font_path(spec: str) -> str:
    """Resolve a fontconfig pattern ("Amiri:bold") to a file."""
    out = subprocess.run(["fc-match", "-f", "%{file}", spec], capture_output=True, text=True)
    return out.stdout.strip()


def font_display() -> str:   # calligraphic titles
    return font_path("Amiri:bold")


def font_text() -> str:      # captions / labels
    return font_path("Noto Naskh Arabic:bold")


# ---------- Arabic text normalisation (for keyword matching) ----------
_DIAC = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)


def norm_ar(s: str) -> str:
    s = _DIAC.sub("", s)
    s = re.sub("[إأآٱ]", "ا", s)
    s = s.replace("ة", "ه").replace("ى", "ي").replace("ؤ", "و").replace("ئ", "ي")
    s = _PUNCT.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip().lower()


_PREFIXES = ("وبال", "وال", "بال", "فال", "كال", "لل", "ال", "و", "ف", "ب", "ل", "ك")


def token_forms(tok: str) -> set[str]:
    """A token plus its forms with common clitic prefixes stripped."""
    forms = {tok}
    for p in _PREFIXES:
        if tok.startswith(p) and len(tok) - len(p) >= 2:
            forms.add(tok[len(p):])
    return forms


# ---------- image helpers ----------
def sepia(img: Image.Image, strength: float = 1.0) -> Image.Image:
    """Warm sepia tone, blended with the original by `strength`."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    # gentle S-curve + lifted blacks for a faded print look
    l = lum / 255.0
    l = 0.06 + 0.88 * (l * l * (3 - 2 * l)) * 0.5 + 0.88 * l * 0.5
    tone = np.stack([l * 255 * 1.08 + 8, l * 255 * 0.92 + 4, l * 255 * 0.72], axis=-1)
    out = a * (1 - strength) + tone * strength
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def cover(img: Image.Image, size, scale: float = 1.0) -> Image.Image:
    """Resize to cover `size*scale` (crop centre)."""
    W, H = int(size[0] * scale), int(size[1] * scale)
    r = max(W / img.width, H / img.height)
    im = img.resize((max(W, round(img.width * r)), max(H, round(img.height * r))), Image.LANCZOS)
    x, y = (im.width - W) // 2, (im.height - H) // 2
    return im.crop((x, y, x + W, y + H))


def paper_texture(size, seed: int = 7) -> Image.Image:
    """Aged paper: base colour + low-frequency blotches + fibre noise + vignette."""
    W, H = size
    rng = np.random.default_rng(seed)
    low = np.zeros((H, W), np.float32)
    for div, amp in ((160, 0.6), (60, 0.3), (20, 0.1)):   # smooth multi-octave blotches
        n = rng.random((H // div + 3, W // div + 3)).astype(np.float32)
        n = Image.fromarray((n * 255).astype(np.uint8)).resize((W + 2 * div, H + 2 * div), Image.BICUBIC)
        low += np.asarray(n, np.float32)[div:div + H, div:div + W] / 255 * amp
    low = np.asarray(Image.fromarray((np.clip(low, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), np.float32) / 255
    fine = rng.normal(0, 1, (H, W)).astype(np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    vig = np.clip(1 - 0.28 * d ** 2, 0, 1)
    base = np.array(PAPER, np.float32)
    dark = np.array(PAPER_DARK, np.float32)
    mix = (low * 0.55)[..., None]
    out = base * (1 - mix) + dark * mix + fine[..., None] * 3
    out *= vig[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def print_on_background(photo: Image.Image, size, rng) -> Image.Image:
    """Place a photo whose aspect doesn't fit the frame as a bordered print
    over a blurred, darkened copy of itself. Returns an image 1.18x `size`
    (headroom for Ken Burns)."""
    W, H = int(size[0] * 1.18), int(size[1] * 1.18)
    bg = cover(photo, (W, H)).filter(ImageFilter.GaussianBlur(40))
    bg = Image.blend(bg, Image.new("RGB", bg.size, (40, 28, 18)), 0.45)
    maxw, maxh = W * 0.74, H * 0.74
    r = min(maxw / photo.width, maxh / photo.height)
    ph = photo.resize((round(photo.width * r), round(photo.height * r)), Image.LANCZOS)
    b = max(12, int(min(ph.size) * 0.035))
    printed = Image.new("RGB", (ph.width + 2 * b, ph.height + 2 * b), CREAM)
    printed.paste(ph, (b, b))
    angle = float(rng.uniform(-2.5, 2.5))
    pr = printed.convert("RGBA").rotate(angle, resample=Image.BICUBIC, expand=True)
    shadow = Image.new("RGBA", pr.size, (0, 0, 0, 0))
    shadow.putalpha(pr.getchannel("A").point(lambda v: int(v * 0.55)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas = bg.convert("RGBA")
    x, y = (W - pr.width) // 2, (H - pr.height) // 2
    canvas.alpha_composite(shadow, (x + 14, y + 18))
    canvas.alpha_composite(pr, (x, y))
    return canvas.convert("RGB")


def ease(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def ffprobe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    return float(out.stdout.strip() or 0)
