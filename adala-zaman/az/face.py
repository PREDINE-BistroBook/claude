"""Face tracking (OpenCV Haar cascade) -> where to centre crops and punch-ins.

Samples the raw video at 2 fps, keeps the largest plausible face per frame, fills gaps,
smooths, and answers "where is her face around time t". Crops are held steady per
kept piece (changes only happen on cuts), so there's no jittery auto-pan.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from .common import probe, read_json, write_json

SAMPLE_FPS = 2.0
SW = 960   # analysis width


def track(src: Path, out: Path) -> dict:
    if out.exists():
        return read_json(out)
    import cv2
    info = probe(src)
    sh = int(round(SW * info["height"] / info["width"] / 2) * 2)
    casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    prof = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(src), "-vf", f"fps={SAMPLE_FPS},scale={SW}:{sh}",
                          "-f", "rawvideo", "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE)
    pts, i = [], 0
    while True:
        buf = p.stdout.read(SW * sh)
        if len(buf) < SW * sh:
            break
        g = np.frombuffer(buf, np.uint8).reshape(sh, SW)
        g = cv2.equalizeHist(g)
        min_side = int(min(SW, sh) * 0.06)
        faces = casc.detectMultiScale(g, 1.08, 4, minSize=(min_side, min_side))
        if len(faces) == 0:
            faces = prof.detectMultiScale(g, 1.1, 5, minSize=(min_side, min_side))
        if len(faces):
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            pts.append([i / SAMPLE_FPS, (x + w / 2) / SW, (y + h / 2) / sh, w / SW])
        i += 1
    p.wait()
    raw_hits = len(pts)
    # keep only detections consistent with where her face usually is (drops false hits on
    # patterns, pictures, handwriting...); if too few agree, treat the video as faceless
    if pts:
        a = np.array(pts)
        mx, my, mw = np.median(a[:, 1]), np.median(a[:, 2]), np.median(a[:, 3])
        ok = (np.hypot(a[:, 1] - mx, a[:, 2] - my) < 0.15) & (a[:, 3] > mw * 0.6) & (a[:, 3] < mw * 1.6)
        pts = a[ok].tolist() if ok.sum() >= 0.25 * i else []
    data = {"n_samples": i, "hits": len(pts), "raw_hits": raw_hits, "points": pts}
    write_json(out, data)
    print(f"  face found in {len(pts)}/{i} sampled frames" + (f" (ignored {raw_hits - len(pts)} inconsistent detections)" if raw_hits > len(pts) else ""), flush=True)
    return data


def center(track_data: dict, a: float, b: float) -> tuple[float, float, float]:
    """Median face centre (x, y, width) between raw times a..b; falls back to nearby / frame centre."""
    pts = np.array(track_data["points"]) if track_data["points"] else np.zeros((0, 4))
    if len(pts) == 0:
        return 0.5, 0.42, 0.0
    sel = pts[(pts[:, 0] >= a - 0.5) & (pts[:, 0] <= b + 0.5)]
    if len(sel) == 0:   # nearest detections in time
        idx = np.argsort(np.abs(pts[:, 0] - (a + b) / 2))[:6]
        sel = pts[idx]
    return float(np.median(sel[:, 1])), float(np.median(sel[:, 2])), float(np.median(sel[:, 3]))
