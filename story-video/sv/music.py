"""Soft background music.

If music/ contains an audio file, the first one is used (looped). Otherwise a gentle
original bed is synthesised: a warm drone + slow plucked (oud-like, Karplus-Strong)
phrases in maqam Nahawand on D, with a soft room reverb. Royalty-free by
construction.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from .common import MUSIC, WORK

SR = 44100
AUDIO_EXT = {".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac"}


def user_track() -> Path | None:
    for p in sorted(MUSIC.glob("*")):
        if p.suffix.lower() in AUDIO_EXT:
            return p
    return None


def _pluck(freq, dur, rng, bright=0.5):
    n = int(SR * dur)
    N = max(2, int(SR / freq))
    buf = rng.uniform(-1, 1, N)
    # soften the excitation for a warmer, nylon/oud tone
    for _ in range(2):
        buf = 0.5 * (buf + np.roll(buf, 1))
    out = np.zeros(n)
    decay = 0.996
    pos = 0
    prev = buf.copy()
    while pos < n:
        k = min(N, n - pos)
        out[pos:pos + k] = prev[:k]
        nxt = decay * (bright * prev + (1 - bright) * np.roll(prev, 1))
        prev = nxt
        pos += k
    env = np.minimum(1, np.arange(n) / (SR * 0.004)) * np.exp(-np.arange(n) / (SR * dur * 0.45))
    return out * env


def _reverb(x, seconds=2.2, rng=None):
    rng = rng or np.random.default_rng(0)
    n = int(SR * seconds)
    ir = rng.normal(0, 1, n) * np.exp(-np.arange(n) / (SR * seconds / 6.0))
    ir[: int(SR * 0.012)] = 0
    ir /= np.sqrt((ir ** 2).sum())
    L = len(x) + n
    size = 1 << (L - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    return y


def synth_loop(seconds=64.0, seed=5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(SR * seconds)
    t = np.arange(n) / SR
    # drone: D2 + A2 + D3, slow breathing
    drone = np.zeros(n)
    for f, a in ((73.42, 0.5), (110.0, 0.25), (146.83, 0.2)):
        for h, ha in ((1, 1.0), (2, 0.35), (3, 0.12)):
            drone += a * ha * np.sin(2 * np.pi * f * h * t + rng.uniform(0, 6))
    drone *= 0.55 + 0.45 * np.sin(2 * np.pi * t / 16.0) ** 2
    drone *= 0.09
    # Nahawand on D: D E F G A Bb C# D
    scale = [293.66, 329.63, 349.23, 392.0, 440.0, 466.16, 554.37, 587.33, 659.25, 698.46]
    L, R = np.zeros(n), np.zeros(n)
    pos, idx = 1.0, 4
    while pos < seconds - 3:
        phrase = rng.integers(3, 7)
        for _ in range(phrase):
            idx = int(np.clip(idx + rng.choice([-2, -1, -1, 1, 1, 2, 0]), 0, len(scale) - 1))
            f = scale[idx] * (0.5 if rng.random() < 0.3 else 1.0)
            d = float(rng.choice([0.6, 0.9, 1.2, 1.8]))
            note = _pluck(f, d * 2.2, rng) * (0.22 + 0.08 * rng.random())
            s = int(pos * SR)
            e = min(n, s + len(note))
            pan = rng.uniform(0.3, 0.7)
            L[s:e] += note[: e - s] * (1 - pan)
            R[s:e] += note[: e - s] * pan
            pos += d
            if pos >= seconds - 3:
                break
        pos += float(rng.choice([1.5, 2.5, 3.5]))   # breathe between phrases
    L, R = L + drone, R + drone
    wetL, wetR = _reverb(L, rng=np.random.default_rng(1)), _reverb(R, rng=np.random.default_rng(2))
    L, R = 0.65 * L + 0.55 * wetL, 0.65 * R + 0.55 * wetR
    st = np.stack([L, R], 1)
    # make loop seams soft
    fade = int(SR * 2)
    st[:fade] *= np.linspace(0, 1, fade)[:, None]
    st[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return st / (np.abs(st).max() + 1e-9) * 0.7


def _write_wav(path: Path, st: np.ndarray):
    import wave
    data = (np.clip(st, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def make_music(duration: float, out: Path | None = None) -> Path:
    WORK.mkdir(exist_ok=True)
    out = out or WORK / f"music_{int(duration)}.wav"
    if out.exists():
        return out
    src = user_track()
    if src is None:
        loop = WORK / "music_loop.wav"
        if not loop.exists():
            _write_wav(loop, synth_loop())
        src = loop
    # loop to length with crossfaded seams, fade in/out
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "-1", "-i", str(src), "-t", f"{duration:.3f}",
                    "-af", f"afade=t=in:d=2,afade=t=out:st={max(0, duration - 3):.3f}:d=3",
                    "-ar", "48000", "-ac", "2", str(out)], check=True)
    return out
