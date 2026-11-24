"""Step 4: plan -> finished MP4.

1. Compositor (Python/PIL) renders every scene - Ken Burns photos, sepia stock
   footage, drawn motion graphics, cards - with crossfades, piped into x264.
   The timeline is split into chunks rendered in parallel, then concatenated.
2. Finishing pass (ffmpeg): film grain + vignette + gentle flicker, optional
   waveform, burnt-in ASS captions, voice + ducked music mix, loudness.
"""
from __future__ import annotations

import math
import os
import random
import subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from .common import FPS, OUT, ROOT, WORK, cover, ease, font_text, load_config, print_on_background, sepia
from .graphics import CardScene, GraphicScene

XF = 0.6  # crossfade seconds
SEPIA_MIX = "colorchannelmixer=.40:.70:.17:0:.34:.62:.15:0:.25:.47:.11:0"


# ------------------------------------------------------------------ sources
class PhotoScene:
    MOVES = ("in", "out", "left", "right", "up")

    def __init__(self, path: Path, size, dur, seed, strength):
        self.size, self.dur = size, dur
        rng = random.Random(seed)
        npr = np.random.default_rng(seed)
        im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        W, H = size
        ar, far = im.width / im.height, W / H
        if abs(math.log(ar / far)) > 0.18:
            still = print_on_background(im, size, npr)
        else:
            still = cover(im, size, 1.18)
        self.still = sepia(still, strength)
        self.move = rng.choice(self.MOVES)

    def frame(self, t):
        W, H = self.size
        Sw, Sh = self.still.size
        u = ease(0.15 + 0.7 * min(1, max(0, t / self.dur))) * 0.6 + 0.4 * min(1, max(0, t / self.dur))
        zmin, zmax = 1.0, 1.15        # view = still / z
        if self.move == "in":
            z, px, py = zmin + (zmax - zmin) * u, 0.5, 0.45
        elif self.move == "out":
            z, px, py = zmax - (zmax - zmin) * u, 0.5, 0.5
        elif self.move == "left":
            z, px, py = 1.1, 0.15 + 0.7 * u, 0.5
        elif self.move == "right":
            z, px, py = 1.1, 0.85 - 0.7 * u, 0.5
        else:
            z, px, py = 1.1, 0.5, 0.8 - 0.6 * u
        vw, vh = Sw / z, Sh / z
        x0 = (Sw - vw) * px
        y0 = (Sh - vh) * py
        return self.still.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + vw, y0 + vh), reducing_gap=None)

    def close(self):
        pass


class VideoScene:
    def __init__(self, path: Path, size, dur, t_in=0.0, src_skip=1.0):
        self.size, self.path = size, path
        self.dur = dur
        self.t_in = t_in      # where in this scene the chunk starts
        self.skip = src_skip
        self.proc = None
        self.last = None
        self.pos = 0

    def _open(self, t0):
        W, H = self.size
        vf = (f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},"
              f"{SEPIA_MIX},eq=contrast=0.96:brightness=0.01")
        self.proc = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-stream_loop", "-1", "-ss", f"{self.skip + t0:.3f}", "-i", str(self.path),
             "-t", f"{self.dur - t0 + 2:.3f}", "-vf", vf, "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.pos = int(round(t0 * FPS))

    def frame(self, t):
        W, H = self.size
        want = int(round(t * FPS))
        if self.proc is None:
            self._open(max(0.0, t))
            self.pos = want
        while self.pos <= want:
            raw = self.proc.stdout.read(W * H * 3)
            if len(raw) < W * H * 3:
                break
            self.last = Image.frombuffer("RGB", (W, H), raw, "raw", "RGB", 0, 1).copy()
            self.pos += 1
        return self.last if self.last is not None else Image.new("RGB", (W, H), (40, 30, 20))

    def close(self):
        if self.proc:
            self.proc.kill()
            self.proc.wait()


def build_scene(sc: dict, size, idx: int, cfg: dict):
    dur = sc["end"] - sc["start"] + XF
    typ = sc["type"]
    try:
        if typ == "photo":
            return PhotoScene(ROOT / sc["file"], size, dur, idx * 7919 + 13, cfg["sepia_strength"])
        if typ == "stock" and sc.get("file"):
            if sc.get("kind") == "video":
                return VideoScene(ROOT / sc["file"], size, dur)
            return PhotoScene(ROOT / sc["file"], size, dur, idx * 7919 + 13, 1.0)
        if typ == "graphic":
            return GraphicScene(sc["name"], size, sc.get("label"))
        if typ == "card":
            return CardScene(sc["kind"], size, sc.get("title", ""), sc.get("subtitle", ""), dur)
        if typ == "quote":
            return CardScene("quote", size, sc["title"], duration=dur)
        if typ == "year":
            return CardScene("year", size, sc["title"], sc.get("subtitle", ""), dur)
    except Exception as e:  # noqa: BLE001
        print(f"  ! scene {idx} ({typ}) failed: {e} - using a quote card")
    # unresolved stock / failure: fall back to her words on paper
    text = sc.get("text") or sc.get("title") or ""
    return CardScene("quote", size, " ".join(text.split()[:14]) or "…", duration=dur)


# ------------------------------------------------------------------ compositor
def _render_chunk(args):
    plan, f0, f1, out = args
    cfg = load_config()
    size = tuple(plan["size"])
    W, H = size
    scenes = plan["scenes"]
    live: dict[int, object] = {}
    enc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
         "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p",
         "-threads", "2", str(out)], stdin=subprocess.PIPE)
    for f in range(f0, f1):
        t = f / FPS
        active = [i for i, s in enumerate(scenes)
                  if (s["start"] - (XF / 2 if i else 0)) <= t < (s["end"] + (XF / 2 if i < len(scenes) - 1 else 0.001))]
        if not active:
            active = [min(range(len(scenes)), key=lambda i: abs(scenes[i]["start"] - t))]
        for i in list(live):
            if i not in active and scenes[i]["end"] + XF < t:
                live.pop(i).close()
        imgs = []
        for i in active[-2:]:
            if i not in live:
                live[i] = build_scene(scenes[i], size, i, cfg)
            lt = t - scenes[i]["start"] + (XF / 2 if i else 0)
            imgs.append((i, live[i].frame(lt)))
        if len(imgs) == 2:
            i2 = imgs[1][0]
            a = min(1, max(0, (t - (scenes[i2]["start"] - XF / 2)) / XF))
            frame = Image.blend(imgs[0][1], imgs[1][1], ease(a))
        else:
            frame = imgs[0][1]
        if frame.size != size:
            frame = frame.resize(size)
        enc.stdin.write(frame.tobytes())
    for s in live.values():
        s.close()
    enc.stdin.close()
    enc.wait()
    return out


def render_visuals(plan: dict, out: Path, workers: int | None = None) -> Path:
    total = int(math.ceil(plan["duration"] * FPS))
    workers = workers or max(1, min(4, (os.cpu_count() or 2)))
    chunk = max(FPS * 20, total // workers + 1)
    parts, jobs = [], []
    tmp = out.parent / (out.stem + "_parts")
    tmp.mkdir(parents=True, exist_ok=True)
    for k, f0 in enumerate(range(0, total, chunk)):
        p = tmp / f"part_{k:03d}.mp4"
        parts.append(p)
        jobs.append((plan, f0, min(total, f0 + chunk), p))
    print(f"  compositing {total} frames in {len(jobs)} chunks on {workers} workers…", flush=True)
    with ProcessPoolExecutor(workers) as ex:
        for p in ex.map(_render_chunk, jobs):
            print(f"    done {p.name}", flush=True)
    lst = tmp / "list.txt"
    lst.write_text("".join(f"file '{p.resolve()}'\n" for p in parts))
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out)],
                   check=True)
    return out


# ------------------------------------------------------------------ finishing
def finish(plan: dict, visuals: Path, voice: Path, music: Path, ass: Path, out: Path, waveform: bool,
           music_db: float, fade_out=True) -> Path:
    W, H = plan["size"]
    dur = plan["duration"]
    off = plan["voice_offset"]
    vin, vout = plan["voice_in"], plan["voice_out"]
    vlen = vout - vin
    d_ms = int(off * 1000)
    fonts_dir = str(Path(font_text()).parent)
    vf = [f"[0:v]noise=alls=4:allf=t,vignette=angle=PI/4.6,"
          f"eq=brightness='0.012*sin(2*PI*t*0.9)+0.006*sin(2*PI*t*7.3)':eval=frame[base]"]
    af = [f"[1:a]atrim={vin:.3f}:{vout:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.08,"
          f"afade=t=out:st={max(0, vlen - 0.25):.3f}:d=0.25,aformat=sample_rates=48000:channel_layouts=stereo,"
          f"adelay={d_ms}|{d_ms},apad=whole_dur={dur:.3f}[vox]",
          "[vox]asplit=3[vox1][vox2][vox3]",
          f"[2:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={music_db}dB[mus]",
          "[mus][vox2]sidechaincompress=threshold=0.012:ratio=9:attack=20:release=650:makeup=1[duck]",
          "[vox1][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]"]
    if waveform:
        wh = int(H * 0.075)
        vf.append(f"[vox3]showwaves=s={int(W * 0.5)}x{wh}:mode=cline:rate={FPS}:colors=0xF4E2BE:scale=sqrt,"
                  f"format=rgba,colorchannelmixer=aa=0.5[wf]")
        vf.append(f"[base][wf]overlay=x=(W-w)/2:y=H-h-{int(H * 0.025)}:"
                  f"enable='between(t,{off:.2f},{off + vlen:.2f})'[base2]")
        last = "base2"
    else:
        af[1] = "[vox]asplit=2[vox1][vox2]"
        last = "base"
    fade = f",fade=t=in:d=0.6,fade=t=out:st={dur - 0.8:.3f}:d=0.8" if fade_out else ""
    ass_arg = str(ass).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    vf.append(f"[{last}]ass='{ass_arg}':fontsdir='{fonts_dir}'{fade}[vout]")
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-v", "error", "-stats", "-i", str(visuals), "-i", str(voice), "-i", str(music),
           "-filter_complex", ";".join(vf + af), "-map", "[vout]", "-map", "[aout]", "-t", f"{dur:.3f}",
           "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "10M", "-bufsize", "20M",
           "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)
    return out


def render_plan(plan: dict, name: str, ass: Path, waveform: bool) -> Path:
    from .music import make_music
    cfg = load_config()
    vis = render_visuals(plan, WORK / "render" / f"{name}_visuals.mp4")
    music = make_music(plan["duration"])
    out = OUT / f"{name}.mp4"
    finish(plan, vis, WORK / "voice.wav", music, ass, out, waveform, cfg["music_db"])
    print(f"  -> {out}")
    return out


def preview_sheet(plan: dict, out: Path, cols=6) -> Path:
    """One frame from the middle of every scene, as a contact sheet."""
    cfg = load_config()
    size = tuple(plan["size"])
    tw = 320 if size[0] > size[1] else 180
    th = int(tw * size[1] / size[0])
    scenes = plan["scenes"]
    rows = math.ceil(len(scenes) / cols)
    sheet = Image.new("RGB", (cols * tw, rows * th), (20, 14, 10))
    for i, sc in enumerate(scenes):
        s = build_scene(sc, size, i, cfg)
        im = s.frame((sc["end"] - sc["start"]) / 2)
        s.close()
        sheet.paste(im.resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    return out
