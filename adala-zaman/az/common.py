"""Shared paths, config, palette, fonts and small helpers."""
from __future__ import annotations

import json
import re
import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RAW, NOTES, PHOTOS, MUSIC, OUTPUT = (ROOT / d for d in ("raw", "notes", "photos", "music", "output"))
WORK = OUTPUT / ".cache"          # shared cache (generated music loop etc.)
FPS = 25
LONG = (1920, 1080)
SHORT = (1080, 1920)
CHANNEL = "عدالة زمان"

# warm vintage palette (RGB)
PAPER, PAPER_DARK = (236, 222, 196), (214, 194, 160)
INK, INK_SOFT = (74, 50, 32), (120, 88, 60)
SEPIA_MID, SEPIA_LIGHT = (168, 128, 88), (205, 170, 125)
GOLD, CREAM = (222, 176, 92), (250, 240, 220)

DEFAULTS = {
    "channel": CHANNEL,
    "outro_title": "اشترك وتابعنا",
    "outro_sub": "واحكولنا ذكرياتكم في التعليقات",
    "shorts_cta": "تابعونا لحكايات زمان",
    "intro_seconds": 5.0,
    "outro_seconds": 6.0,
    "whisper_model": "large-v3",
    "whisper_prompt": "",          # optional spelling hint, e.g. names from her notes
    "max_pause": 0.6,              # pauses longer than this get shortened
    "pause_keep": 0.35,            # ...to this
    "music_db": -9,                # music before ducking (ducks ~15 dB under her voice)
    "grade": 0.55,                 # 0 = original colour, 1 = full sepia
    "grain": 4,                    # film grain strength (0 = off)
    "punch_in": 1.08,              # zoom used on alternate jump cuts (1.0 = off)
    "broll_every": 18.0,           # min seconds between B-roll inserts
    "broll_graphics": True,        # use drawn vintage objects when no photo matches
    "n_shorts": [3, 5],
    "claude_model": "claude-opus-5-5",
}


def load_config(ep_dir: Path | None = None) -> dict:
    cfg = dict(DEFAULTS)
    for p in (ROOT / "channel.json", (ep_dir / "episode.json") if ep_dir else None):
        if p and p.exists():
            cfg.update(json.loads(p.read_text(encoding="utf-8")))
    return cfg


def read_json(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def write_json(p, data):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def run(cmd, **kw):
    """subprocess.run that shows ffmpeg's error text when it fails."""
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, **kw)
    if r.returncode:
        raise RuntimeError(f"command failed: {' '.join(map(str, cmd))[:300]}\n{r.stderr[-2000:]}")
    return r


@lru_cache(None)
def font_path(spec: str) -> str:
    return subprocess.run(["fc-match", "-f", "%{file}", spec], capture_output=True, text=True).stdout.strip()


def font_display() -> str:
    return font_path("Amiri:bold")


def font_text() -> str:
    return font_path("Noto Naskh Arabic:bold")


# ---------------------------------------------------------------- media probing
def probe(path: Path) -> dict:
    out = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
               "stream=width,height,r_frame_rate:stream_side_data=rotation:stream_tags=rotate:format=duration",
               "-of", "json", path]).stdout
    j = json.loads(out)
    st = (j.get("streams") or [{}])[0]
    w, h = st.get("width", 0), st.get("height", 0)
    rot = 0
    for sd in st.get("side_data_list", []) or []:
        rot = int(sd.get("rotation", 0) or 0)
    rot = rot or int((st.get("tags") or {}).get("rotate", 0) or 0)
    if abs(rot) % 180 == 90:      # phone videos: ffmpeg auto-rotates, so swap
        w, h = h, w
    return {"width": w, "height": h, "duration": float(j["format"]["duration"]), "vertical": h > w}


# ---------------------------------------------------------------- Arabic text
_DIAC = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")


def norm_ar(s: str) -> str:
    s = _DIAC.sub("", s)
    s = re.sub("[إأآٱ]", "ا", s).replace("ة", "ه").replace("ى", "ي").replace("ؤ", "و").replace("ئ", "ي")
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip().lower()


_PREFIXES = ("وبال", "وال", "بال", "فال", "كال", "لل", "ال", "و", "ف", "ب", "ل", "ك")


def token_forms(tok: str) -> set[str]:
    forms = {tok}
    for p in _PREFIXES:
        if tok.startswith(p) and len(tok) - len(p) >= 2:
            forms.add(tok[len(p):])
    return forms


def ts(t: float, sep=".") -> str:
    t = max(0.0, t)
    return f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{int(t % 60):02d}{sep}{int(round((t % 1) * 1000)) % 1000:03d}"


def ease(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------- images
def sepia(img: Image.Image, strength: float = 1.0) -> Image.Image:
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    l = (a @ np.array([0.299, 0.587, 0.114], np.float32)) / 255.0
    l = 0.06 + 0.88 * (0.5 * l * l * (3 - 2 * l) + 0.5 * l)
    tone = np.stack([l * 255 * 1.08 + 8, l * 255 * 0.92 + 4, l * 255 * 0.72], axis=-1)
    return Image.fromarray(np.clip(a * (1 - strength) + tone * strength, 0, 255).astype(np.uint8))


def cover(img: Image.Image, size, scale: float = 1.0) -> Image.Image:
    W, H = int(size[0] * scale), int(size[1] * scale)
    r = max(W / img.width, H / img.height)
    im = img.resize((max(W, round(img.width * r)), max(H, round(img.height * r))), Image.LANCZOS)
    x, y = (im.width - W) // 2, (im.height - H) // 2
    return im.crop((x, y, x + W, y + H))


def paper_texture(size, seed: int = 7) -> Image.Image:
    W, H = size
    rng = np.random.default_rng(seed)
    low = np.zeros((H, W), np.float32)
    for div, amp in ((160, 0.6), (60, 0.3), (20, 0.1)):
        n = rng.random((H // div + 3, W // div + 3)).astype(np.float32)
        n = Image.fromarray((n * 255).astype(np.uint8)).resize((W + 2 * div, H + 2 * div), Image.BICUBIC)
        low += np.asarray(n, np.float32)[div:div + H, div:div + W] / 255 * amp
    low = np.asarray(Image.fromarray((np.clip(low, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)),
                     np.float32) / 255
    fine = rng.normal(0, 1, (H, W)).astype(np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    vig = np.clip(1 - 0.28 * d ** 2, 0, 1)
    mix = (low * 0.55)[..., None]
    out = (np.array(PAPER, np.float32) * (1 - mix) + np.array(PAPER_DARK, np.float32) * mix + fine[..., None] * 3)
    return Image.fromarray(np.clip(out * vig[..., None], 0, 255).astype(np.uint8))


def print_on_background(photo: Image.Image, size, rng) -> Image.Image:
    """Photo as a bordered print over a blurred copy of itself (1.18x size, room for Ken Burns)."""
    W, H = int(size[0] * 1.18), int(size[1] * 1.18)
    bg = cover(photo, (W, H)).filter(ImageFilter.GaussianBlur(40))
    bg = Image.blend(bg, Image.new("RGB", bg.size, (40, 28, 18)), 0.45)
    r = min(W * 0.74 / photo.width, H * 0.74 / photo.height)
    ph = photo.resize((round(photo.width * r), round(photo.height * r)), Image.LANCZOS)
    b = max(12, int(min(ph.size) * 0.035))
    printed = Image.new("RGB", (ph.width + 2 * b, ph.height + 2 * b), CREAM)
    printed.paste(ph, (b, b))
    pr = printed.convert("RGBA").rotate(float(rng.uniform(-2.5, 2.5)), resample=Image.BICUBIC, expand=True)
    shadow = Image.new("RGBA", pr.size, (0, 0, 0, 0))
    shadow.putalpha(pr.getchannel("A").point(lambda v: int(v * 0.55)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas = bg.convert("RGBA")
    x, y = (W - pr.width) // 2, (H - pr.height) // 2
    canvas.alpha_composite(shadow, (x + 14, y + 18))
    canvas.alpha_composite(pr, (x, y))
    return canvas.convert("RGB")
