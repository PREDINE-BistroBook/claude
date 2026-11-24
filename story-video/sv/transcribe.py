"""Step 1: audio -> clean WAV + Arabic transcript with word timestamps.

Output: work/voice.wav (48 kHz mono, loudness-normalised)
        work/transcript.json  {"duration", "segments":[{start,end,text,words:[{start,end,word}]}]}
        work/transcript.txt   human-readable, timestamped (handy for reviewing / fixing)
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import numpy as np

from .common import WORK, ffprobe_duration, load_config, write_json


def prepare_audio(src: Path) -> Path:
    WORK.mkdir(exist_ok=True)
    out = WORK / "voice.wav"
    # light cleanup: rumble cut, gentle denoise, broadcast loudness
    af = "highpass=f=70,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-af", af,
                    "-ar", "48000", "-ac", "1", str(out)], check=True)
    return out


def transcribe(src: Path, model_name: str | None = None) -> dict:
    cfg = load_config()
    wav = prepare_audio(src)
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    from faster_whisper import WhisperModel

    # decode with ffmpeg ourselves (avoids PyAV version mismatches)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(wav), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True, check=True).stdout
    audio = np.frombuffer(raw, np.float32)
    model = WhisperModel(model_name or cfg["whisper_model"], device="cpu", compute_type="int8",
                         download_root=str(Path.home() / ".cache" / "whisper"))
    segs, info = model.transcribe(
        audio, language=cfg["language"], word_timestamps=True, vad_filter=True,
        beam_size=5, condition_on_previous_text=False,
        # optional spelling hint (names, places). Off by default: on unclear audio Whisper
        # can "hear" the prompt itself, so keep it short and check the start of the transcript.
        initial_prompt=cfg.get("whisper_prompt") or None,
    )
    out = {"duration": ffprobe_duration(wav), "language": info.language, "segments": []}
    lines = []
    for s in segs:
        words = [{"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word.strip()}
                 for w in (s.words or []) if w.word.strip()]
        seg = {"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip(), "words": words}
        out["segments"].append(seg)
        lines.append(f"[{_ts(s.start)} - {_ts(s.end)}] {seg['text']}")
        print(lines[-1], flush=True)
    write_json(WORK / "transcript.json", out)
    (WORK / "transcript.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out


def _ts(t: float) -> str:
    return f"{int(t // 60):02d}:{t % 60:05.2f}"
