# Story video pipeline (voice → long film + Shorts)

Turns one audio recording of her telling her story (Arabic, .m4a/.mp3) into:

- **`output/long.mp4`**: 16:9, 1080p, 25 fps. Title card → story → outro card. The visual changes every 4–8 s, following the transcript. Slow Ken Burns zooms on photos, sepia stock footage, hand-drawn animated objects, burnt-in Arabic captions, soft music that ducks under her voice, and an optional waveform.
- **`output/short_N.mp4`**: 3–5 vertical 1080×1920 clips, each 30–60 s. Each has a hook line for the first 2 s, big centred word-by-word captions (the current word in gold), visuals matched to the moment, and a call-to-action line at the end.

## Inputs

| Folder | What goes in |
|---|---|
| `input/` | her recording (`.m4a`, `.mp3`, `.wav`…) |
| `photos/` | old family photos + photos of props. **Filenames act as tags** (`radio.jpg` or `راديو_جدي.jpg` shows up when she mentions the radio). For finer control, add `photos/tags.json`: `{"wedding_1972.jpg": ["الفرح", "ماما"]}` |
| `music/` | *(optional)* your own music track. Without one, a soft original oud-style bed is generated. |
| `.env` | *(optional)* `PEXELS_API_KEY=…` and/or `PIXABAY_API_KEY=…` for stock footage. Git-ignored. |
| `project.json` | titles and settings; copy `project.example.json` |

Media, `work/` and `output/` are git-ignored. Only the code is versioned.

## Run

```bash
pip install -r requirements.txt          # + ffmpeg with libass; Arabic fonts: apt install fonts-hosny-amiri fonts-noto-core
python make.py transcribe input/her.m4a  # Whisper large-v3, word timestamps → work/transcript.json/.txt
python make.py plan                      # → work/plan_long.json + work/plan_shorts.json (editable!)
python make.py stock                     # download the stock clips the plans ask for
python make.py preview                   # contact sheets of every scene (work/preview_*.png)
python make.py long                      # → output/long.mp4
python make.py shorts                    # → output/short_*.mp4   (or: python make.py shorts short_2)
# or all at once:  python make.py all input/her.m4a
```

### Review points (where a human — or Claude — should look)
1. **`work/transcript.txt`**: fix misheard words directly in `transcript.json` (word text only; keep the timings).
2. **`work/plan_long.json`**: one entry per scene: `photo` / `graphic` / `stock` / `quote` / `year` / `card`, each with a `why`. Swap a file, change a graphic, or move a cut.
3. **`work/plan_shorts.json`**: the picked moments (`voice_in`/`voice_out`) and the `hook` text. Auto-picked by a heuristic (emotion words + topic density + clean sentence ends); worth hand-tuning.

## How visuals are chosen (per scene)
year mentioned → year card · photo whose tags match the words → drawn object graphic (radio, طشت, كنبة بلدي, tea glass, TV, فانوس, clock, phone, قلة) → stock footage for the topic → her own line as a quote card (rarely) → least-used family photo. The topic dictionary is `sv/keywords.py`; add words and topics freely.

## Code map
`sv/transcribe.py` · `sv/plan.py` · `sv/keywords.py` · `sv/graphics.py` (all drawn art + cards) · `sv/stock.py` · `sv/render.py` (parallel compositor + ffmpeg finishing: grain, vignette, flicker, waveform, captions, ducking) · `sv/captions.py` (ASS) · `sv/music.py`

Speed on 4 CPU cores: transcription ≈ 0.85× audio length; rendering ≈ 1.7× video length.
