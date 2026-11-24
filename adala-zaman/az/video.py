"""Rendering: cut pieces -> edited video -> finished long video / Shorts, plus preview stills.

Pieces: each kept range is rendered on its own (accurate seek, framed for 16:9 or 9:16,
face-aware punch-in on alternate jump cuts, warm vintage grade), then concatenated.
Finishing pass adds B-roll overlays, intro/outro cards, grain, vignette, captions, and
the voice + ducked music mix.
"""
from __future__ import annotations

import hashlib
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .common import FPS, LONG, font_text, run
from .face import center

SEPIA = ((.393, .769, .189), (.349, .686, .168), (.272, .534, .131))


def grade_filter(g: float) -> str:
    """Warm vintage look: partial sepia matrix + lifted blacks + slightly soft highlights."""
    m = []
    for r in range(3):
        for c in range(3):
            m.append((1 - g) * (1.0 if r == c else 0.0) + g * SEPIA[r][c])
    cm = ":".join(f"{v:.3f}" for v in (m[0:3] + [0] + m[3:6] + [0] + m[6:9] + [0]))
    return (f"colorchannelmixer={cm},curves=all='0/0.045 0.5/0.52 1/0.96',"
            f"eq=contrast=1.04:saturation=0.92")


def frame_filter(info: dict, size, face, zoom: float) -> str:
    """Scale/crop the raw frame into `size`, centred on the face, zoomed by `zoom`."""
    W, H = size
    fx, fy, _fw = face
    iw, ih = info["width"], info["height"]
    portrait_out = H > W
    if portrait_out:
        if info["vertical"]:                     # 9:16 -> 9:16
            cw, ch = min(iw, ih * W / H), min(ih, iw * H / W)
        else:                                    # 16:9 -> 9:16: crop a column around her face
            cw, ch = ih * W / H, ih
        cw, ch = cw / zoom, ch / zoom
        x = min(max(fx * iw - cw / 2, 0), iw - cw)
        y = min(max(fy * ih - ch * 0.38, 0), ih - ch)
        return f"crop={int(cw) // 2 * 2}:{int(ch) // 2 * 2}:{int(x)}:{int(y)},scale={W}:{H}:flags=lanczos,setsar=1"
    if info["vertical"]:                         # 9:16 -> 16:9: blurred fill + her centred
        fg_w = int(round(H * iw / ih / 2) * 2)
        base = (f"split[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                f"boxblur=28:2,eq=brightness=-0.10:saturation=0.7[bg];[b]scale={fg_w}:{H}[fg];"
                f"[bg][fg]overlay=(W-w)/2:0")
        fx_frame = ((W - fg_w) / 2 + fx * fg_w) / W
        fy_frame = fy
    else:
        base = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}"
        fx_frame, fy_frame = fx, fy
    if zoom > 1.001:
        cw, ch = W / zoom, H / zoom
        x = min(max(fx_frame * W - cw / 2, 0), W - cw)
        y = min(max(fy_frame * H - ch * 0.4, 0), H - ch)
        base += f",crop={int(cw) // 2 * 2}:{int(ch) // 2 * 2}:{int(x)}:{int(y)},scale={W}:{H}:flags=lanczos"
    return base + ",setsar=1"


def piece_filters(info, size, keep, face_track, cfg):
    out, toggle = [], False
    for k in keep:
        if k["jump"]:
            toggle = not toggle
        z = cfg["punch_in"] if toggle else 1.0
        face = center(face_track, k["a"], k["b"])
        out.append(frame_filter(info, size, face, z))
    return out


def render_pieces(src: Path, info: dict, size, keep: list[dict], face_track: dict, cfg: dict, work: Path,
                  tag: str) -> Path:
    """Render every kept range, concat into one MKV (x264 + PCM, no generation loss in audio)."""
    work.mkdir(parents=True, exist_ok=True)
    filters = piece_filters(info, size, keep, face_track, cfg)
    grade = grade_filter(cfg["grade"])

    def job(i):
        k, vf = keep[i], filters[i]
        key = hashlib.sha1(f"{src}|{k['a']}|{k['b']}|{vf}|{grade}".encode()).hexdigest()[:12]
        out = work / f"piece_{key}.mkv"
        if out.exists():
            return out
        d = k["b"] - k["a"]
        fade = min(0.015, d / 4)
        run(["ffmpeg", "-y", "-v", "error", "-ss", f"{k['a']:.3f}", "-i", src, "-t", f"{d:.3f}",
             "-filter_complex", f"[0:v]{vf},{grade},fps={FPS},format=yuv420p[v];"
             f"[0:a]aformat=sample_rates=48000:channel_layouts=mono,afade=t=in:d={fade:.3f},"
             f"afade=t=out:st={max(0, d - fade):.3f}:d={fade:.3f}[a]",
             "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "15",
             "-c:a", "pcm_s16le", out])
        return out

    with ThreadPoolExecutor(4) as ex:
        parts = list(ex.map(job, range(len(keep))))
    lst = work / f"{tag}_list.txt"
    lst.write_text("".join(f"file '{p.resolve()}'\n" for p in parts))
    out = work / f"{tag}_edited.mkv"
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", out])
    return out


def render_card(kind: str, title: str, subtitle: str, size, dur: float, out: Path) -> Path:
    from .graphics import CardScene
    if out.exists():
        return out
    W, H = size
    card = CardScene(kind, size, title, subtitle, dur)
    enc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                            "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
                            "-pix_fmt", "yuv420p", str(out)], stdin=subprocess.PIPE)
    for f in range(int(round(dur * FPS))):
        enc.stdin.write(card.frame(f / FPS).tobytes())
    enc.stdin.close()
    enc.wait()
    return out


def _ass_arg(p: Path) -> str:
    return str(p).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def finish_long(edited: Path, intro: Path, outro: Path, broll: list[tuple[Path, float, float]], ass: Path,
                music: Path, out: Path, cfg: dict, edited_dur: float) -> Path:
    W, H = LONG
    ti, to = cfg["intro_seconds"], cfg["outro_seconds"]
    total = ti + edited_dur + to
    ins = ["-i", intro, "-i", edited, "-i", outro, "-i", music]
    fc = ["[1:v]setpts=PTS-STARTPTS[m0]"]
    cur = "m0"
    for n, (clip, t, d) in enumerate(broll):
        ins += ["-i", clip]
        idx = 4 + n
        fc.append(f"[{idx}:v]format=yuva420p,fade=t=in:d=0.45:alpha=1,fade=t=out:st={d - 0.45:.2f}:d=0.45:alpha=1,"
                  f"setpts=PTS-STARTPTS+{t:.3f}/TB[b{n}]")
        fc.append(f"[{cur}][b{n}]overlay=enable='between(t,{t:.3f},{t + d:.3f})':eof_action=pass[m{n + 1}]")
        cur = f"m{n + 1}"
    grain = f"noise=alls={cfg['grain']}:allf=t," if cfg["grain"] else ""
    fc += [f"[0:v][{cur}][2:v]concat=n=3:v=1:a=0,{grain}vignette=angle=PI/5,"
           f"ass='{_ass_arg(ass)}':fontsdir='{Path(font_text()).parent}',"
           f"fade=t=in:d=0.5,fade=t=out:st={total - 0.8:.3f}:d=0.8,format=yuv420p[vout]"]
    fc += _audio_mix(ti, total, cfg["music_db"])
    _encode(ins, fc, out, total)
    return out


def finish_short(edited: Path, ass: Path, music: Path, out: Path, cfg: dict, dur: float) -> Path:
    grain = f"noise=alls={cfg['grain']}:allf=t," if cfg["grain"] else ""
    ins = ["-i", edited, "-i", edited, "-i", edited, "-i", music]   # keeps input indices aligned with _audio_mix
    fc = [f"[0:v]{grain}vignette=angle=PI/5,ass='{_ass_arg(ass)}':fontsdir='{Path(font_text()).parent}',"
          f"fade=t=in:d=0.25,fade=t=out:st={dur - 0.4:.3f}:d=0.4,format=yuv420p[vout]"]
    fc += _audio_mix(0.0, dur, cfg["music_db"] - 3)
    _encode(ins, fc, out, dur)
    return out


def _audio_mix(delay: float, total: float, music_db: float) -> list[str]:
    d = int(delay * 1000)
    return [f"[1:a]highpass=f=70,afftdn=nf=-28,acompressor=threshold=0.1:ratio=2.5:attack=10:release=200,"
            f"loudnorm=I=-16:TP=-1.5:LRA=9,aformat=sample_rates=48000:channel_layouts=stereo,"
            f"adelay={d}|{d},apad=whole_dur={total:.3f}[vox]",
            "[vox]asplit=2[vox1][vox2]",
            f"[3:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={music_db}dB[mus]",
            "[mus][vox2]sidechaincompress=threshold=0.012:ratio=9:attack=20:release=650:makeup=1[duck]",
            "[vox1][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]"]


def _encode(ins, fc, out: Path, total: float):
    out.parent.mkdir(parents=True, exist_ok=True)
    script = out.with_suffix(".filter.txt")
    script.write_text(";\n".join(fc))
    cmd = ["ffmpeg", "-y", "-v", "error", "-stats", *ins, "-filter_complex_script", script,
           "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}", "-r", str(FPS),
           "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "10M", "-bufsize", "20M",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]
    r = subprocess.run([str(c) for c in cmd], stderr=subprocess.PIPE, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-2500:])
    script.replace(out.parent / "work" / script.name) if (out.parent / "work").exists() else None


def still(src: Path, info: dict, size, src_t: float, vf: str, cfg: dict, ass: Path | None, ass_t: float,
          out: Path) -> Path:
    """One finished-looking frame (framing + grade + grain + vignette + captions) for previews."""
    grain = f"noise=alls={cfg['grain']}:allf=t," if cfg["grain"] else ""
    chain = f"[0:v]{vf},{grade_filter(cfg['grade'])},{grain}vignette=angle=PI/5,setpts=PTS-STARTPTS+{ass_t:.3f}/TB"
    if ass:
        chain += f",ass='{_ass_arg(ass)}':fontsdir='{Path(font_text()).parent}'"
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{src_t:.3f}", "-i", src, "-filter_complex", chain + "[v]",
         "-map", "[v]", "-frames:v", "1", "-q:v", "3", out])
    return out

