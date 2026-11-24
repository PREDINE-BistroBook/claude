"""Animated warm-sepia vintage illustrations drawn in code.

Every graphic is `draw_<name>(pen, t)` drawing in a unit box (0..1 coords) with
light animation driven by `t` (seconds since the scene started). `GraphicScene`
puts it on aged paper with a label, entrance, gentle bob and a table shadow.

Cards (title / outro / quote / year) live here too.
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .common import (CREAM, GOLD, INK, INK_SOFT, PAPER, SEPIA_LIGHT, SEPIA_MID, ease,
                     font_display, font_text, paper_texture)

WOOD = (138, 92, 58)
WOOD_DK = (98, 64, 40)
WOOD_LT = (170, 120, 78)
METAL = (182, 166, 144)
METAL_DK = (132, 116, 98)
METAL_LT = (214, 202, 182)
FABRIC = (212, 178, 130)
WATER = (196, 186, 164)
CLAY = (176, 110, 70)
CLAY_DK = (132, 78, 48)
GLASS = (226, 214, 190)
TEA = (150, 82, 36)
SS = 2  # supersampling factor for anti-aliasing


class Pen:
    """Draw in normalised 0..1 coordinates on a square supersampled canvas.
    Translucent colours are alpha-blended (Pillow alone would overwrite)."""

    def __init__(self, size: int):
        self.n = size * SS
        self.img = Image.new("RGBA", (self.n, self.n), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    def P(self, x, y):
        return (x * self.n, y * self.n)

    def W(self, w):
        return max(1, int(w * self.n))

    def _do(self, pts, colours, w, fn):
        """Run fn(draw, offset_pts) directly, or via a small layer if translucent."""
        if all(c is None or len(c) == 3 or c[3] == 255 for c in colours):
            fn(self.d, pts)
            return
        pad = w + 2
        xs, ys = [q[0] for q in pts], [q[1] for q in pts]
        x0, y0 = int(max(0, min(xs) - pad)), int(max(0, min(ys) - pad))
        x1, y1 = int(min(self.n, max(xs) + pad + 1)), int(min(self.n, max(ys) + pad + 1))
        if x1 <= x0 or y1 <= y0:
            return
        layer = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
        fn(ImageDraw.Draw(layer), [(x - x0, y - y0) for x, y in pts])
        self.img.alpha_composite(layer, (x0, y0))

    def rect(self, x0, y0, x1, y1, fill=None, outline=INK, w=0.008, r=0.0):
        ww = self.W(w) if outline else 0
        def fn(d, q):
            box = [*q[0], *q[1]]
            if r:
                d.rounded_rectangle(box, radius=r * self.n, fill=fill, outline=outline, width=ww)
            else:
                d.rectangle(box, fill=fill, outline=outline, width=ww)
        self._do([self.P(x0, y0), self.P(x1, y1)], (fill, outline), ww, fn)

    def ellipse(self, cx, cy, rx, ry, fill=None, outline=INK, w=0.008):
        ww = self.W(w) if outline else 0
        self._do([self.P(cx - rx, cy - ry), self.P(cx + rx, cy + ry)], (fill, outline), ww,
                 lambda d, q: d.ellipse([*q[0], *q[1]], fill=fill, outline=outline, width=ww))

    def circle(self, cx, cy, r, **kw):
        self.ellipse(cx, cy, r, r, **kw)

    def poly(self, pts, fill=None, outline=INK, w=0.008):
        ww = self.W(w)
        def fn(d, q):
            if fill:
                d.polygon(q, fill=fill)
            if outline:
                d.line(q + [q[0]], fill=outline, width=ww, joint="curve")
        self._do([self.P(x, y) for x, y in pts], (fill, outline), ww, fn)

    def line(self, pts, fill=INK, w=0.008):
        ww = self.W(w)
        self._do([self.P(x, y) for x, y in pts], (fill,), ww,
                 lambda d, q: d.line(q, fill=fill, width=ww, joint="curve"))

    def arc(self, cx, cy, rx, ry, a0, a1, fill=INK, w=0.008):
        ww = self.W(w)
        self._do([self.P(cx - rx, cy - ry), self.P(cx + rx, cy + ry)], (fill,), ww,
                 lambda d, q: d.arc([*q[0], *q[1]], a0, a1, fill=fill, width=ww))

    def text(self, x, y, s, size, fill=INK, font=None):
        f = _font(font or font_display(), int(size * self.n))
        self.d.text(self.P(x, y), s, font=f, fill=fill, anchor="mm")

    def result(self, size: int) -> Image.Image:
        im = self.img.reduce(SS)
        return im if im.size == (size, size) else im.resize((size, size), Image.BILINEAR)


@lru_cache(64)
def _font(path: str, px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, px, layout_engine=ImageFont.Layout.RAQM)


def _alpha(c, a):
    return (*c[:3], int(max(0, min(1, a)) * 255))


def _note(pen, x, y, s, a):
    pen.ellipse(x, y, s * 0.55, s * 0.4, fill=_alpha(INK, a), outline=None)
    pen.line([(x + s * 0.5, y), (x + s * 0.5, y - s * 2.2), (x + s * 1.3, y - s * 1.7)], fill=_alpha(INK, a), w=0.006)


# ---------------------------------------------------------------- objects
def draw_radio(p: Pen, t):
    # sound waves either side
    for side in (-1, 1):
        for k in range(3):
            ph = ((t * 0.7 + k / 3) % 1.0)
            r = 0.05 + ph * 0.12
            a0, a1 = (-40, 40) if side == 1 else (140, 220)
            p.arc(0.5 + side * 0.38, 0.45, r, r * 1.3, a0, a1, fill=_alpha(INK_SOFT, 1 - ph), w=0.007)
    # floating notes
    for k in range(3):
        ph = (t * 0.35 + k * 0.33) % 1.0
        x = 0.2 + 0.3 * k + 0.03 * math.sin(t * 2 + k)
        _note(p, x, 0.2 - ph * 0.16, 0.022, (1 - ph) * min(1, ph * 4))
    # legs
    p.poly([(0.2, 0.82), (0.25, 0.82), (0.22, 0.92), (0.19, 0.92)], fill=WOOD_DK)
    p.poly([(0.75, 0.82), (0.8, 0.82), (0.81, 0.92), (0.78, 0.92)], fill=WOOD_DK)
    # cabinet with arched top
    p.ellipse(0.5, 0.36, 0.38, 0.16, fill=WOOD, w=0.01)
    p.rect(0.12, 0.36, 0.88, 0.84, fill=WOOD, outline=None)
    p.line([(0.12, 0.36), (0.12, 0.84), (0.88, 0.84), (0.88, 0.36)], w=0.01)
    p.arc(0.5, 0.36, 0.33, 0.12, 180, 360, fill=WOOD_LT, w=0.012)
    # grill cloth
    p.rect(0.2, 0.3, 0.8, 0.6, fill=FABRIC, r=0.04, w=0.008)
    for i in range(1, 12):
        x = 0.2 + i * 0.6 / 12
        p.line([(x, 0.32), (x, 0.58)], fill=_alpha(INK_SOFT, 0.55), w=0.004)
    p.arc(0.5, 0.45, 0.1, 0.1, 0, 360, fill=_alpha(WOOD_DK, 0.7), w=0.01)
    # dial window + moving needle
    p.rect(0.28, 0.65, 0.72, 0.75, fill=CREAM, r=0.02, w=0.007)
    for i in range(13):
        x = 0.31 + i * 0.38 / 12
        p.line([(x, 0.66), (x, 0.68 if i % 3 else 0.695)], fill=INK_SOFT, w=0.004)
    nx = 0.33 + 0.34 * (0.5 + 0.5 * math.sin(t * 0.6))
    p.line([(nx, 0.655), (nx, 0.745)], fill=(150, 40, 30), w=0.007)
    # knobs
    for kx in (0.2, 0.8):
        p.circle(kx, 0.7, 0.045, fill=WOOD_DK, w=0.008)
        ang = t * (1.2 if kx < 0.5 else -0.8)
        p.line([(kx, 0.7), (kx + 0.035 * math.cos(ang), 0.7 + 0.035 * math.sin(ang))], fill=CREAM, w=0.007)
    # glow on dial
    p.rect(0.28, 0.65, 0.72, 0.75, fill=_alpha(GOLD, 0.12 + 0.06 * math.sin(t * 3)), outline=None, r=0.02)


def draw_tasht(p: Pen, t):
    # cloth draped over the left rim
    # body
    p.poly([(0.1, 0.5), (0.9, 0.5), (0.77, 0.84), (0.23, 0.84)], fill=METAL, outline=None)
    p.ellipse(0.5, 0.84, 0.27, 0.05, fill=METAL_DK, w=0.008)
    p.line([(0.1, 0.5), (0.23, 0.84)], w=0.009)
    p.line([(0.9, 0.5), (0.77, 0.84)], w=0.009)
    for x0, a in ((0.25, 0.5), (0.31, 0.3), (0.68, 0.25)):
        p.line([(x0, 0.58), (x0 + 0.04, 0.8)], fill=_alpha(METAL_LT, a + 0.3), w=0.012)
    for yy in (0.62, 0.73):  # hammered rings
        p.arc(0.5, yy - 0.1, 0.36 - (yy - 0.5) * 0.35, 0.12, 20, 160, fill=_alpha(METAL_DK, 0.6), w=0.005)
    # rim + water
    p.ellipse(0.5, 0.5, 0.41, 0.11, fill=METAL_LT, w=0.01)
    p.ellipse(0.5, 0.51, 0.36, 0.08, fill=WATER, w=0.006)
    # ripples
    for k in range(2):
        ph = (t * 0.45 + k * 0.5) % 1
        p.ellipse(0.58, 0.51, 0.04 + ph * 0.18, 0.01 + ph * 0.045, outline=_alpha(CREAM, 1 - ph), w=0.005)
    # foam
    rng = np.random.default_rng(3)
    for i in range(26):
        ang = rng.uniform(0, 2 * math.pi)
        rr = rng.uniform(0.15, 0.95)
        x = 0.5 + math.cos(ang) * 0.32 * rr + 0.006 * math.sin(t * 2 + i)
        y = 0.51 + math.sin(ang) * 0.065 * rr
        r = rng.uniform(0.012, 0.026) * (1 + 0.12 * math.sin(t * 3 + i))
        p.circle(x, y, r, fill=CREAM, outline=_alpha(INK_SOFT, 0.5), w=0.003)
    # rising bubbles
    for i in range(6):
        ph = (t * 0.4 + i / 6) % 1
        x = 0.3 + i * 0.08 + 0.02 * math.sin(t * 2.5 + i * 2)
        y = 0.48 - ph * 0.3
        r = 0.012 + 0.012 * (i % 3) / 2
        p.circle(x, y, r, fill=_alpha(CREAM, 0.35 * (1 - ph)), outline=_alpha(INK_SOFT, 0.8 * (1 - ph)), w=0.003)
        p.circle(x - r * 0.35, y - r * 0.35, r * 0.25, fill=_alpha((255, 255, 255), 0.9 * (1 - ph)), outline=None)
    # striped cloth hanging over the rim
    sway = 0.008 * math.sin(t * 1.3)
    cloth = [(0.13, 0.45), (0.27, 0.47), (0.27 + sway, 0.67), (0.2 + sway, 0.7), (0.13 + sway, 0.64)]
    p.poly(cloth, fill=FABRIC, w=0.007)
    for k in range(3):
        y = 0.52 + k * 0.05
        p.line([(0.135 + sway * (y - 0.45) * 4, y), (0.268 + sway * (y - 0.45) * 4, y + 0.004)], fill=SEPIA_MID, w=0.008)


def draw_kanaba(p: Pen, t):
    # light beam with dust
    beam = [(0.62, 0.0), (0.82, 0.0), (0.5, 0.95), (0.18, 0.95)]
    p.poly(beam, fill=_alpha(CREAM, 0.16 + 0.03 * math.sin(t * 0.8)), outline=None)
    rng = np.random.default_rng(11)
    for i in range(28):
        bx, by, sp = rng.uniform(0, 1), rng.uniform(0, 1), rng.uniform(0.02, 0.06)
        y = (by + t * sp) % 1.0
        x = 0.72 - y * 0.42 + (bx - 0.5) * 0.22 + 0.015 * math.sin(t + i)
        p.circle(x, y * 0.95, 0.004 + 0.003 * (i % 3), fill=_alpha((255, 248, 230), 0.7), outline=None)
    # legs
    for x in (0.1, 0.33, 0.67, 0.9):
        p.poly([(x - 0.022, 0.72), (x + 0.022, 0.72), (x + 0.012, 0.86), (x - 0.012, 0.86)], fill=WOOD_DK, w=0.007)
        p.circle(x, 0.78, 0.022, fill=WOOD, w=0.006)
    # carved backrest (crest higher in the middle)
    back = [(0.07, 0.6), (0.07, 0.38), (0.2, 0.33), (0.35, 0.3), (0.43, 0.24), (0.5, 0.2), (0.57, 0.24),
            (0.65, 0.3), (0.8, 0.33), (0.93, 0.38), (0.93, 0.6)]
    p.poly(back, fill=WOOD, w=0.01)
    inner = [(0.13, 0.58), (0.13, 0.42), (0.25, 0.38), (0.38, 0.35), (0.5, 0.29), (0.62, 0.35), (0.75, 0.38),
             (0.87, 0.42), (0.87, 0.58)]
    p.poly(inner, fill=FABRIC, w=0.007)
    # tufted buttons
    for i in range(7):
        for j in range(2):
            x = 0.2 + i * 0.1 + (0.05 if j else 0)
            y = 0.44 + j * 0.07
            if 0.15 < x < 0.85:
                p.circle(x, y, 0.008, fill=SEPIA_MID, outline=None)
    p.circle(0.5, 0.235, 0.022, fill=WOOD_LT, w=0.006)  # crest rosette
    p.arc(0.5, 0.235, 0.04, 0.03, 200, 340, fill=WOOD_DK, w=0.006)
    # seat cushion with pattern
    p.rect(0.05, 0.58, 0.95, 0.7, fill=FABRIC, r=0.025, w=0.009)
    for i in range(14):
        x = 0.09 + i * 0.062
        p.poly([(x, 0.64), (x + 0.025, 0.605), (x + 0.05, 0.64), (x + 0.025, 0.675)], fill=_alpha(SEPIA_MID, 0.55), outline=None)
    p.rect(0.04, 0.69, 0.96, 0.73, fill=WOOD_DK, w=0.008)
    # scrolled armrests
    for sx in (0.06, 0.94):
        p.rect(sx - 0.035, 0.42, sx + 0.035, 0.7, fill=WOOD, r=0.02, w=0.008)
        p.circle(sx, 0.42, 0.045, fill=WOOD_LT, w=0.008)
        p.circle(sx, 0.42, 0.018, fill=WOOD_DK, outline=None)
    # pillows
    for cx, ang in ((0.2, -12), (0.8, 12)):
        s = 0.075
        c, sn = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        pts = [(cx + dx * c - dy * sn, 0.53 + dx * sn + dy * c) for dx, dy in ((-s, -s), (s, -s), (s, s), (-s, s))]
        p.poly(pts, fill=SEPIA_LIGHT, w=0.007)
        p.circle(cx, 0.53, 0.02, fill=_alpha(GOLD, 0.8), outline=INK_SOFT, w=0.004)
        for px, py in pts:
            p.line([(px, py), (px + (px - cx) * 0.25, py + (py - 0.53) * 0.25 + 0.012)], fill=GOLD, w=0.005)


def draw_tea(p: Pen, t):
    # steam
    for k in range(3):
        pts = []
        for i in range(30):
            u = i / 29
            y = 0.36 - u * 0.3
            x = 0.42 + k * 0.08 + 0.035 * math.sin(u * 7 - t * 2.2 + k * 2) * (0.3 + u)
            pts.append((x, y))
        for i in range(len(pts) - 1):
            u = i / 29
            p.line([pts[i], pts[i + 1]], fill=_alpha(INK_SOFT, 0.55 * math.sin(u * math.pi) * (0.7 + 0.3 * math.sin(t + k))), w=0.009)
    # saucer
    p.ellipse(0.5, 0.86, 0.3, 0.06, fill=CREAM, w=0.008)
    p.ellipse(0.5, 0.855, 0.18, 0.033, fill=PAPER, outline=_alpha(INK_SOFT, 0.6), w=0.005)
    # glass (tapered)
    top, bot = 0.38, 0.85
    p.poly([(0.36, top), (0.64, top), (0.6, bot), (0.4, bot)], fill=_alpha(GLASS, 0.55), outline=None)
    lvl = 0.45
    p.poly([(0.36 + (lvl - top) * 0.085, lvl), (0.64 - (lvl - top) * 0.085, lvl), (0.6, bot - 0.005), (0.4, bot - 0.005)],
           fill=TEA, outline=None)
    p.ellipse(0.5, lvl, 0.135, 0.018, fill=(186, 116, 56), outline=None)
    p.line([(0.36, top), (0.4, bot), (0.6, bot), (0.64, top)], w=0.008)
    p.ellipse(0.5, top, 0.14, 0.02, fill=None, w=0.007)
    for x in (0.42, 0.47, 0.53, 0.58):  # glass facets
        p.line([(x, top + 0.04), (x + (0.5 - x) * 0.12, bot - 0.03)], fill=_alpha(CREAM, 0.35), w=0.006)
    # spoon
    p.line([(0.56, 0.5), (0.7, 0.24)], fill=METAL_DK, w=0.012)
    p.ellipse(0.71, 0.22, 0.02, 0.012, fill=METAL, w=0.005)
    # mint leaves
    for ang, dx in ((-30, 0.0), (20, 0.03)):
        c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        pts = [(0.44 + dx + u * c * 0.06 - (0.015 * math.sin(u * math.pi)) * s * sg, 0.37 - u * s * 0.06 - 0.015 * math.sin(u * math.pi) * c * sg)
               for sg in (1, -1) for u in ([i / 8 for i in range(9)] if sg == 1 else [1 - i / 8 for i in range(9)])]
        p.poly(pts, fill=(120, 120, 70), w=0.004)


def draw_tv(p: Pen, t):
    # antenna
    p.line([(0.5, 0.2), (0.32, 0.04)], w=0.007)
    p.line([(0.5, 0.2), (0.7, 0.05)], w=0.007)
    p.circle(0.32, 0.04, 0.012, fill=METAL)
    p.circle(0.7, 0.05, 0.012, fill=METAL)
    p.ellipse(0.5, 0.2, 0.06, 0.03, fill=WOOD_DK)
    # legs
    p.line([(0.22, 0.82), (0.16, 0.95)], fill=WOOD_DK, w=0.016)
    p.line([(0.78, 0.82), (0.84, 0.95)], fill=WOOD_DK, w=0.016)
    # cabinet
    p.rect(0.1, 0.22, 0.9, 0.84, fill=WOOD, r=0.05, w=0.01)
    p.rect(0.15, 0.27, 0.68, 0.79, fill=(60, 50, 40), r=0.06, w=0.009)
    # side panel: speaker + knobs
    for i in range(6):
        p.line([(0.72, 0.32 + i * 0.03), (0.86, 0.32 + i * 0.03)], fill=WOOD_DK, w=0.006)
    for ky, sp in ((0.6, 0.7), (0.71, -0.5)):
        p.circle(0.79, ky, 0.035, fill=WOOD_DK)
        a = t * sp
        p.line([(0.79, ky), (0.79 + 0.03 * math.cos(a), ky + 0.03 * math.sin(a))], fill=CREAM, w=0.006)


def tv_screen(size: int, t: float) -> Image.Image:
    """Animated static + rolling bar for the TV screen (drawn separately, numpy)."""
    rng = np.random.default_rng(int(t * 25))
    w, h = int(size * 0.47), int(size * 0.46)
    n = rng.integers(70, 200, (h // 3 + 1, w // 3 + 1)).astype(np.uint8)
    img = np.repeat(np.repeat(n, 3, 0), 3, 1)[:h, :w].astype(np.float32)
    bar = int((t * 0.4 % 1.0) * h)
    img[max(0, bar - h // 12):bar] *= 1.25
    img = np.stack([img * 1.05, img * 0.95, img * 0.8], -1)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def draw_fanoos(p: Pen, t):
    # warm pulsing glow is drawn by GraphicScene (radial); here: hook + lantern
    p.line([(0.5, 0.0), (0.5, 0.1)], fill=INK_SOFT, w=0.006)
    p.arc(0.5, 0.12, 0.03, 0.03, 180, 360, fill=METAL_DK, w=0.01)
    p.poly([(0.5, 0.14), (0.66, 0.3), (0.34, 0.3)], fill=METAL, w=0.009)       # dome
    p.rect(0.32, 0.3, 0.68, 0.33, fill=METAL_DK, w=0.007)
    flick = 0.75 + 0.25 * math.sin(t * 9) * math.sin(t * 3.7)
    panels = [(0.34, 0.33, 0.43, 0.66), (0.43, 0.33, 0.57, 0.66), (0.57, 0.33, 0.66, 0.66)]
    cols = [(196, 130, 70), (232, 190, 110), (186, 110, 72)]
    for (x0, y0, x1, y1), c in zip(panels, cols):
        lit = tuple(int(v * (0.8 + 0.2 * flick)) for v in c)
        p.rect(x0, y0, x1, y1, fill=lit, w=0.007)
        p.arc((x0 + x1) / 2, y0 + 0.08, (x1 - x0) * 0.35, 0.05, 180, 360, fill=_alpha(INK, 0.6), w=0.005)
        p.circle((x0 + x1) / 2, y1 - 0.08, (x1 - x0) * 0.18, outline=_alpha(INK, 0.6), w=0.005)
    p.ellipse(0.5, 0.52, 0.025, 0.04 * flick, fill=_alpha((255, 240, 190), 0.9), outline=None)  # candle flame
    p.rect(0.32, 0.66, 0.68, 0.69, fill=METAL_DK, w=0.007)
    p.poly([(0.32, 0.69), (0.68, 0.69), (0.58, 0.8), (0.42, 0.8)], fill=METAL, w=0.008)
    p.rect(0.44, 0.8, 0.56, 0.84, fill=METAL_DK, w=0.006)
    for x in (0.38, 0.5, 0.62):
        p.circle(x, 0.735, 0.012, fill=GOLD, outline=None)


def draw_clock(p: Pen, t):
    p.rect(0.3, 0.04, 0.7, 0.96, fill=WOOD, r=0.04, w=0.01)
    p.poly([(0.28, 0.06), (0.5, 0.0), (0.72, 0.06)], fill=WOOD_DK, w=0.008)
    p.circle(0.5, 0.27, 0.16, fill=CREAM, w=0.01)
    p.circle(0.5, 0.27, 0.145, outline=_alpha(INK_SOFT, 0.5), w=0.004)
    nums = "١٢٣٤٥٦٧٨٩"
    labels = {0: "١٢", 3: "٣", 6: "٦", 9: "٩"}
    for h in range(12):
        a = math.radians(h * 30 - 90)
        if h % 3 == 0:
            p.text(0.5 + 0.115 * math.cos(a), 0.27 + 0.115 * math.sin(a), labels[h], 0.04, fill=INK, font=font_text())
        else:
            p.circle(0.5 + 0.12 * math.cos(a), 0.27 + 0.12 * math.sin(a), 0.006, fill=INK, outline=None)
    _ = nums
    mh = math.radians((t * 6) % 360 - 90 + 60)
    hh = math.radians(-90 + 300 + t * 0.5)
    sh = math.radians(int(t) * 6 - 90)
    p.line([(0.5, 0.27), (0.5 + 0.06 * math.cos(hh), 0.27 + 0.06 * math.sin(hh))], w=0.012)
    p.line([(0.5, 0.27), (0.5 + 0.1 * math.cos(mh), 0.27 + 0.1 * math.sin(mh))], w=0.008)
    p.line([(0.5, 0.27), (0.5 + 0.11 * math.cos(sh), 0.27 + 0.11 * math.sin(sh))], fill=(150, 40, 30), w=0.004)
    p.circle(0.5, 0.27, 0.012, fill=INK, outline=None)
    # pendulum window
    p.rect(0.38, 0.47, 0.62, 0.9, fill=(92, 62, 40), r=0.02, w=0.008)
    sw = math.radians(12 * math.sin(t * math.pi))  # 1 s period swing
    bx, by = 0.5 + math.sin(sw) * 0.3, 0.5 + math.cos(sw) * 0.3
    p.line([(0.5, 0.5), (bx, by)], fill=GOLD, w=0.006)
    p.circle(bx, by, 0.04, fill=GOLD, w=0.007)
    p.rect(0.38, 0.47, 0.62, 0.9, fill=_alpha(CREAM, 0.12), outline=None, r=0.02)


def draw_phone(p: Pen, t):
    ring = (t % 2.0) < 1.0
    jig = 0.012 * math.sin(t * 60) if ring else 0
    # ring marks
    if ring:
        for side in (-1, 1):
            for k in range(3):
                a = math.radians(-60 + k * 30) if side == 1 else math.radians(240 - k * 30)
                p.line([(0.5 + side * 0.36 + math.cos(a) * 0.02, 0.22 + math.sin(a) * 0.04),
                        (0.5 + side * 0.36 + math.cos(a) * 0.08, 0.22 + math.sin(a) * 0.1)], w=0.008)
    # body
    p.poly([(0.22, 0.85), (0.78, 0.85), (0.7, 0.42), (0.3, 0.42)], fill=(70, 50, 36), w=0.01)
    p.rect(0.2, 0.84, 0.8, 0.88, fill=(50, 36, 26), r=0.01, w=0.008)
    # dial
    p.circle(0.5, 0.64, 0.15, fill=CREAM, w=0.008)
    for i in range(10):
        a = math.radians(-60 - i * 28)
        p.circle(0.5 + 0.105 * math.cos(a), 0.64 + 0.105 * math.sin(a), 0.026, fill=(70, 50, 36), w=0.004)
    p.circle(0.5, 0.64, 0.05, fill=PAPER, w=0.005)
    # handset (jiggles while ringing)
    j = jig
    p.line([(0.23, 0.33 + j), (0.3, 0.26 + j), (0.7, 0.26 - j), (0.77, 0.33 - j)], fill=(70, 50, 36), w=0.05)
    p.ellipse(0.22, 0.36 + j, 0.07, 0.05, fill=(70, 50, 36), w=0.008)
    p.ellipse(0.78, 0.36 - j, 0.07, 0.05, fill=(70, 50, 36), w=0.008)
    # cord
    pts = [(0.22 + 0.012 * math.sin(i), 0.45 + i * 0.022) for i in range(18)]
    p.line(pts, fill=(60, 44, 32), w=0.006)


def draw_qolla(p: Pen, t):
    p.ellipse(0.5, 0.9, 0.26, 0.04, fill=CLAY_DK, w=0.007)   # plate
    p.ellipse(0.5, 0.6, 0.22, 0.25, fill=CLAY, w=0.01)         # body
    p.poly([(0.42, 0.37), (0.58, 0.37), (0.55, 0.2), (0.45, 0.2)], fill=CLAY, w=0.009)  # neck
    p.ellipse(0.5, 0.2, 0.07, 0.025, fill=CLAY_DK, w=0.008)
    for y in (0.5, 0.58, 0.66):
        p.arc(0.5, y - 0.12, 0.2 - abs(y - 0.58) * 0.5, 0.14, 30, 150, fill=_alpha(CLAY_DK, 0.8), w=0.006)
    for i in range(9):  # zig-zag band
        x = 0.33 + i * 0.04
        p.line([(x, 0.47), (x + 0.02, 0.44), (x + 0.04, 0.47)], fill=_alpha(CREAM, 0.6), w=0.005)
    p.ellipse(0.42, 0.52, 0.03, 0.08, fill=_alpha(CREAM, 0.25), outline=None)
    # condensation drops sliding / dripping
    for k in range(4):
        ph = (t * 0.25 + k * 0.27) % 1
        x = 0.36 + k * 0.09
        y = 0.55 + ph * 0.3
        a = 1 - max(0, (ph - 0.8) * 5)
        p.ellipse(x, y, 0.009, 0.013, fill=_alpha((236, 230, 214), 0.85 * a), outline=_alpha(INK_SOFT, 0.5 * a), w=0.003)


GRAPHICS = {
    "radio": draw_radio, "tasht": draw_tasht, "kanaba": draw_kanaba, "tea": draw_tea,
    "tv": draw_tv, "fanoos": draw_fanoos, "clock": draw_clock, "phone": draw_phone, "qolla": draw_qolla,
}


BRASS, BRASS_DK, BRASS_LT = (198, 152, 72), (146, 104, 42), (232, 196, 120)


def draw_wabour(p: Pen, t):
    """وابور الجاز: brass primus stove with a flickering flame and a kettle on top."""
    # steam from the kettle spout
    for k in range(2):
        pts = [(0.74 + 0.03 * math.sin(u * 6 - t * 2.4 + k * 2) * (0.3 + u) + k * 0.04, 0.2 - u * 0.17) for u in [i / 20 for i in range(21)]]
        for i in range(20):
            p.line([pts[i], pts[i + 1]], fill=_alpha(INK_SOFT, 0.5 * math.sin(i / 20 * math.pi)), w=0.008)
    # kettle (براد)
    p.ellipse(0.5, 0.33, 0.17, 0.12, fill=METAL, w=0.009)
    p.poly([(0.64, 0.32), (0.75, 0.22), (0.77, 0.24), (0.67, 0.36)], fill=METAL, w=0.007)
    p.arc(0.5, 0.25, 0.1, 0.09, 200, 340, fill=METAL_DK, w=0.012)
    p.ellipse(0.5, 0.22, 0.04, 0.015, fill=METAL_DK, w=0.006)
    p.line([(0.4, 0.3), (0.43, 0.42)], fill=_alpha(METAL_LT, 0.8), w=0.01)
    # flame ring under the kettle
    for i in range(9):
        a = i / 9
        x = 0.38 + a * 0.24
        h = 0.05 + 0.025 * math.sin(t * 13 + i * 1.7) * math.sin(t * 5.1 + i)
        p.poly([(x - 0.014, 0.5), (x, 0.5 - h), (x + 0.014, 0.5)], fill=(236, 150, 60) if i % 2 else (250, 200, 110), outline=None)
    p.ellipse(0.5, 0.5, 0.13, 0.02, fill=(110, 90, 80), w=0.006)          # burner
    # legs / pot stand
    for x0, x1 in ((0.3, 0.36), (0.7, 0.64)):
        p.line([(x1, 0.48), (x0, 0.6)], fill=BRASS_DK, w=0.012)
    p.line([(0.5, 0.52), (0.5, 0.6)], fill=BRASS_DK, w=0.016)
    # tank
    p.ellipse(0.5, 0.72, 0.24, 0.14, fill=BRASS, w=0.01)
    p.arc(0.5, 0.72, 0.2, 0.1, 200, 300, fill=_alpha(BRASS_LT, 0.9), w=0.014)
    p.ellipse(0.5, 0.6, 0.06, 0.02, fill=BRASS_DK, w=0.006)
    # pump + key
    p.rect(0.7, 0.62, 0.74, 0.7, fill=BRASS_DK, w=0.006)
    p.line([(0.72, 0.62), (0.72, 0.56)], fill=INK, w=0.008)
    p.circle(0.72, 0.555, 0.015, fill=WOOD, w=0.005)
    for x in (0.32, 0.5, 0.68):   # feet
        p.rect(x - 0.025, 0.84, x + 0.025, 0.88, fill=BRASS_DK, w=0.005)


def draw_namlia(p: Pen, t):
    """النملية: wooden food cabinet with fly-mesh doors (a fly tries and fails to get in)."""
    p.poly([(0.22, 0.12), (0.78, 0.12), (0.82, 0.07), (0.18, 0.07)], fill=WOOD_DK, w=0.008)
    p.rect(0.22, 0.12, 0.78, 0.86, fill=WOOD, w=0.01)
    for x in (0.27, 0.53):
        p.rect(x, 0.17, x + 0.2, 0.62, fill=(214, 200, 176), w=0.008)
        # shelves + jars seen through the mesh
        p.line([(x, 0.4), (x + 0.2, 0.4)], fill=_alpha(WOOD_DK, 0.6), w=0.008)
        p.ellipse(x + 0.06, 0.35, 0.03, 0.04, fill=_alpha(CLAY, 0.6), outline=None)
        p.rect(x + 0.11, 0.3, x + 0.17, 0.39, fill=_alpha(SEPIA_MID, 0.55), outline=None, r=0.01)
        p.ellipse(x + 0.1, 0.57, 0.07, 0.02, fill=_alpha(CREAM, 0.7), outline=None)
        for i in range(1, 12):                      # mesh
            p.line([(x + i * 0.2 / 12, 0.17), (x + i * 0.2 / 12, 0.62)], fill=_alpha(INK_SOFT, 0.35), w=0.003)
        for i in range(1, 24):
            p.line([(x, 0.17 + i * 0.45 / 24), (x + 0.2, 0.17 + i * 0.45 / 24)], fill=_alpha(INK_SOFT, 0.35), w=0.003)
        p.circle(x + (0.18 if x < 0.5 else 0.02), 0.4, 0.012, fill=BRASS if 'BRASS' in globals() else GOLD, w=0.004)
    for y in (0.66, 0.76):   # drawers
        p.rect(0.27, y, 0.73, y + 0.08, fill=WOOD_LT, w=0.007)
        p.circle(0.5, y + 0.04, 0.012, fill=WOOD_DK, outline=None)
    for x in (0.25, 0.75):
        p.rect(x - 0.02, 0.86, x + 0.02, 0.93, fill=WOOD_DK, w=0.006)
    # the fly
    a = t * 2.2
    fx, fy = 0.5 + 0.33 * math.cos(a) + 0.02 * math.sin(t * 9), 0.36 + 0.12 * math.sin(a * 1.6)
    if 0.27 < fx < 0.73:
        fx = 0.27 if fx < 0.5 else 0.73           # bounces off the mesh
    p.ellipse(fx, fy, 0.012, 0.008, fill=INK, outline=None)
    wing = 0.008 + 0.006 * abs(math.sin(t * 40))
    p.ellipse(fx - 0.006, fy - 0.01, 0.01, wing, fill=_alpha(CREAM, 0.7), outline=_alpha(INK, 0.5), w=0.002)
    p.ellipse(fx + 0.006, fy - 0.01, 0.01, wing, fill=_alpha(CREAM, 0.7), outline=_alpha(INK, 0.5), w=0.002)


def draw_qubqab(p: Pen, t):
    """القبقاب الخشب: a pair of wooden clogs stepping in turn - طق طق."""
    for side, (cx, phase) in enumerate(((0.33, 0.0), (0.67, 0.5))):
        ph = (t * 1.6 + phase) % 1.0
        lift = max(0.0, math.sin(ph * 2 * math.pi)) * 0.07
        y = 0.62 - lift
        p.ellipse(cx, 0.82, 0.13 - lift * 0.6, 0.02, fill=_alpha(INK, 0.18), outline=None)   # shadow
        p.rect(cx - 0.14, y + 0.04, cx + 0.14, y + 0.1, fill=WOOD_DK, r=0.02, w=0.008)       # sole
        p.rect(cx - 0.12, y + 0.1, cx - 0.06, y + 0.17, fill=WOOD_DK, w=0.006)               # heels
        p.rect(cx + 0.05, y + 0.1, cx + 0.11, y + 0.17, fill=WOOD_DK, w=0.006)
        p.rect(cx - 0.15, y - 0.01, cx + 0.15, y + 0.05, fill=WOOD, r=0.025, w=0.008)       # footbed
        p.arc(cx + 0.03, y + 0.01, 0.1, 0.09, 180, 360, fill=(120, 60, 40), w=0.03)          # leather strap
        p.arc(cx + 0.03, y + 0.01, 0.1, 0.09, 200, 340, fill=_alpha(CREAM, 0.35), w=0.006)
        if ph < 0.08 or ph > 0.97:                                                           # impact!
            for k in range(5):
                a = math.radians(200 + k * 35)
                p.line([(cx + math.cos(a) * 0.17, 0.79 + math.sin(a) * 0.05 + 0.02),
                        (cx + math.cos(a) * 0.23, 0.79 + math.sin(a) * 0.08 + 0.02)], w=0.007)
            p.text(cx, 0.32, "طق!", 0.09, fill=INK)


def draw_lamp(p: Pen, t):
    """لمبة الجاز: kerosene lamp with a living flame (glow added by GraphicScene)."""
    flick = 0.8 + 0.2 * math.sin(t * 11) * math.sin(t * 4.3)
    p.ellipse(0.5, 0.9, 0.2, 0.035, fill=BRASS_DK, w=0.007)
    p.poly([(0.36, 0.88), (0.64, 0.88), (0.6, 0.8), (0.4, 0.8)], fill=BRASS, w=0.008)
    p.ellipse(0.5, 0.68, 0.17, 0.13, fill=_alpha(GLASS, 0.8), w=0.008)                     # fuel bowl
    p.ellipse(0.5, 0.72, 0.14, 0.07, fill=_alpha((170, 110, 50), 0.55), outline=None)      # kerosene
    p.rect(0.42, 0.53, 0.58, 0.57, fill=BRASS_DK, w=0.006)                                  # burner collar
    p.circle(0.62, 0.55, 0.018, fill=BRASS, w=0.005)                                        # wick knob
    # glass chimney (hourglass)
    ch = [(0.44, 0.53), (0.4, 0.44), (0.4, 0.36), (0.45, 0.28), (0.45, 0.14), (0.55, 0.14), (0.55, 0.28),
          (0.6, 0.36), (0.6, 0.44), (0.56, 0.53)]
    p.poly(ch, fill=_alpha(CREAM, 0.35), w=0.006)
    p.ellipse(0.5, 0.43, 0.035, 0.07 * flick, fill=(246, 178, 80), outline=None)            # flame
    p.ellipse(0.5, 0.45, 0.018, 0.04 * flick, fill=(255, 238, 190), outline=None)
    p.line([(0.43, 0.36), (0.44, 0.48)], fill=_alpha((255, 255, 255), 0.6), w=0.008)


GRAPHICS.update({"wabour": draw_wabour, "namlia": draw_namlia, "qubqab": draw_qubqab, "lamp": draw_lamp})


# ---------------------------------------------------------------- scene renderers
@lru_cache(8)
def _paper(size):
    return paper_texture(size).convert("RGBA")


@lru_cache(8)
def _shadow(size, S, cx, cy):
    W, H = size
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - S * 0.42, cy + S * 0.41, cx + S * 0.42, cy + S * 0.5], fill=(60, 40, 20, 70))
    return sh.filter(ImageFilter.GaussianBlur(S * 0.03))


@lru_cache(8)
def _glow(n):
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    d = np.sqrt((xx - n / 2) ** 2 + (yy - n / 2) ** 2) / (n / 2)
    a = np.clip(1 - d, 0, 1) ** 2
    img = np.zeros((n, n, 4), np.uint8)
    img[..., :3] = (255, 214, 140)
    img[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(img, "RGBA")


def _layout(size):
    W, H = size
    if H > W:  # portrait (Shorts)
        S = int(W * 0.8)
        return S, W // 2, int(H * 0.36)
    S = int(min(W * 0.5, H * 0.56))
    return S, W // 2, int(H * 0.39)


class GraphicScene:
    def __init__(self, name: str, size, label: str | None = None):
        self.fn = GRAPHICS[name]
        self.name, self.size, self.label = name, size, label

    def frame(self, t: float) -> Image.Image:
        W, H = self.size
        S, cx, cy = _layout(self.size)
        canvas = _paper(self.size).copy()
        k = ease(t / 0.7)
        bob = math.sin(t * 1.3) * H * 0.006
        sh = _shadow(self.size, S, cx, cy)   # table shadow (cached)
        if k < 1:
            sh = sh.copy()
            sh.putalpha(sh.getchannel("A").point(lambda v: int(v * k)))
        canvas.alpha_composite(sh)
        if self.name in ("fanoos", "lamp"):
            g = _glow(int(S * 1.3))
            g.putalpha(g.getchannel("A").point(lambda v: int(v * (0.45 + 0.15 * math.sin(t * 7)) * k)))
            canvas.alpha_composite(g, (cx - g.width // 2, int(cy - g.height // 2 + bob)))
        pen = Pen(S)
        self.fn(pen, t)
        obj = pen.result(S)
        if self.name == "tv":
            scr = tv_screen(S, t)
            m = Image.new("L", scr.size, 0)
            ImageDraw.Draw(m).rounded_rectangle([0, 0, *scr.size], radius=int(S * 0.05), fill=255)
            obj.paste(scr, (int(S * 0.18), int(S * 0.3)), m)
        if self.name == "fanoos":
            ang = 4 * math.sin(t * 1.4)
            obj = obj.rotate(ang, resample=Image.BICUBIC, center=(S // 2, 0))
        sc = 0.94 + 0.06 * k
        if sc != 1:
            obj = obj.resize((int(S * sc), int(S * sc)), Image.BILINEAR)
        if k < 1:
            obj.putalpha(obj.getchannel("A").point(lambda v: int(v * k)))
        canvas.alpha_composite(obj, (int(cx - obj.width / 2), int(cy - obj.height / 2 + bob)))
        if self.label:
            _label(canvas, self.label, cx, int(cy + S * 0.56), int(S * 0.11), k)
        return canvas.convert("RGB")

    def close(self):
        pass


def _label(canvas, text, cx, y, px, alpha=1.0):
    d = ImageDraw.Draw(canvas)
    f = _font(font_display(), px)
    a = int(255 * alpha)
    d.text((cx, y), text, font=f, fill=(*INK, a), anchor="mm")
    bw = f.getlength(text) / 2 + px * 0.6
    yy = y + px * 0.75
    d.line([(cx - bw, yy), (cx - px * 0.25, yy)], fill=(*INK_SOFT, a), width=max(2, px // 18))
    d.line([(cx + px * 0.25, yy), (cx + bw, yy)], fill=(*INK_SOFT, a), width=max(2, px // 18))
    r = px * 0.11
    d.polygon([(cx, yy - r), (cx + r, yy), (cx, yy + r), (cx - r, yy)], fill=(*GOLD, a))


def _ornament(d, cx, y, half, px, a=255):
    w = max(2, px // 20)
    d.line([(cx - half, y), (cx - px * 0.5, y)], fill=(*INK_SOFT, a), width=w)
    d.line([(cx + px * 0.5, y), (cx + half, y)], fill=(*INK_SOFT, a), width=w)
    r = px * 0.22
    d.polygon([(cx, y - r), (cx + r, y), (cx, y + r), (cx - r, y)], fill=(*GOLD, a), outline=(*INK, a))
    for s in (-1, 1):
        d.ellipse([cx + s * px * 0.38 - r * 0.4, y - r * 0.4, cx + s * px * 0.38 + r * 0.4, y + r * 0.4], fill=(*INK_SOFT, a))
        d.ellipse([cx + s * half - r * 0.35, y - r * 0.35, cx + s * half + r * 0.35, y + r * 0.35], fill=(*INK_SOFT, a))


def _frame_border(d, W, H, a=255):
    m = int(min(W, H) * 0.045)
    w = max(2, int(min(W, H) * 0.004))
    d.rectangle([m, m, W - m, H - m], outline=(*INK_SOFT, a), width=w)
    m2 = m + w * 4
    d.rectangle([m2, m2, W - m2, H - m2], outline=(*SEPIA_MID, a), width=max(1, w // 2))
    r = m * 0.45
    for x, y in ((m, m), (W - m, m), (m, H - m), (W - m, H - m)):
        d.polygon([(x, y - r), (x + r, y), (x, y + r), (x - r, y)], fill=(*GOLD, a), outline=(*INK, a))


def wrap_ar(text: str, font, max_w: float) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        cand = (cur + " " + w).strip()
        if font.getlength(cand) <= max_w or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


class CardScene:
    """kind: title | outro | quote | year | cta"""

    def __init__(self, kind: str, size, title: str = "", subtitle: str = "", duration: float = 5.0):
        self.kind, self.size, self.title, self.subtitle, self.duration = kind, size, title, subtitle, duration
        self._base = None

    def _static(self):
        if self._base is None:
            W, H = self.size
            base = _paper(self.size).copy()
            _frame_border(ImageDraw.Draw(base), W, H)
            self._base = base
        return self._base

    def frame(self, t: float) -> Image.Image:
        W, H = self.size
        canvas = self._static().copy()
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        portrait = H > W
        k1 = ease(t / 1.0)
        k2 = ease((t - 0.6) / 1.0)
        out = 1.0 - ease((t - (self.duration - 0.6)) / 0.6) if self.kind in ("title", "outro") else 1.0
        if self.kind in ("title", "outro", "cta"):
            px = int((W * 0.13) if portrait else (H * 0.15))
            f = _font(font_display(), px)
            lines = wrap_ar(self.title, f, W * 0.8)
            lh = px * 1.35
            y0 = H * 0.46 - (len(lines) - 1) * lh / 2 - (H * 0.02) * (1 - k1)
            for i, ln in enumerate(lines):
                d.text((W / 2, y0 + i * lh), ln, font=f, fill=(*INK, int(255 * k1 * out)), anchor="mm")
            oy = y0 + (len(lines) - 1) * lh + px * 0.95
            _ornament(d, W / 2, oy, W * 0.22 * k2 + 1, int(px * 0.5), int(255 * k2 * out))
            if self.subtitle:
                fs = _font(font_text(), int(px * 0.38))
                d.text((W / 2, oy + px * 0.75), self.subtitle, font=fs, fill=(*INK_SOFT, int(255 * k2 * out)), anchor="mm")
            _ornament(d, W / 2, y0 - px * 0.95, W * 0.12 * k2 + 1, int(px * 0.35), int(255 * k2 * out))
        elif self.kind == "quote":
            px = int((W * 0.085) if portrait else (H * 0.085))
            f = _font(font_display(), px)
            lines = wrap_ar("«" + self.title + "»", f, W * (0.78 if portrait else 0.7))
            lh = px * 1.5
            y0 = H * 0.42 - (len(lines) - 1) * lh / 2
            for i, ln in enumerate(lines):
                ki = ease((t - 0.25 * i) / 0.8)
                d.text((W / 2, y0 + i * lh + (1 - ki) * px * 0.3), ln, font=f, fill=(*INK, int(255 * ki)), anchor="mm")
            _ornament(d, W / 2, y0 + (len(lines) - 1) * lh + px * 1.1, W * 0.15, int(px * 0.55), int(255 * k2))
        elif self.kind == "year":
            px = int((W * 0.3) if portrait else (H * 0.32))
            f = _font(font_display(), px)
            s = 1.0 + 0.04 * t / max(1, self.duration)
            d.text((W / 2, H * 0.44), self.title, font=_font(font_display(), int(px * s)), fill=(*INK, int(255 * k1)), anchor="mm")
            if self.subtitle:
                d.text((W / 2, H * 0.44 + px * 0.75), self.subtitle, font=_font(font_text(), int(px * 0.2)),
                       fill=(*INK_SOFT, int(255 * k2)), anchor="mm")
            _ = f
        canvas.alpha_composite(layer)
        return canvas.convert("RGB")

    def close(self):
        pass
