# عدالة زمان: episode pipeline

One command per episode turns her phone video into:

| File (in `output/episode_XX/`) | What |
|---|---|
| `episode_XX_long_16x9.mp4` | YouTube/Facebook, 1080p. Intro card «عدالة زمان» + episode title → her story (silences, false starts and repeated takes cut; alternate jump cuts get a gentle punch-in) → outro «اشترك وتابعنا». Warm vintage grade, light grain, burnt-in Arabic captions, B-roll photos with slow zoom, soft music ducked under her voice. |
| `episode_XX_long_captions.srt` | The same captions as a file, to upload as YouTube subtitles. |
| `episode_XX_short_N_9x16.mp4` | 3–5 Shorts/Reels/TikToks (1080×1920, 30–60 s). Her face kept centred, big word-by-word captions, hook text for the first 2 s. |
| `texts.md` | For every video: 3 title options, description (long video: with chapters), hashtags, pinned comment. Egyptian Arabic. |
| `01_transcript/transcript.txt` · `.srt` | The transcript you review. |
| `02_edit/cuts.txt` · `shorts.md` · `broll.json` · `previews.jpg` | What was cut and why, why each Short was picked, the B-roll plan, preview frames. |

## Setup (once)

```bash
./setup.sh                      # ffmpeg, Arabic fonts, Python packages, then a setup check
python make_episode.py --check  # re-run the check: writes output/setup_check.png to eyeball the Arabic
```

Optional, for the best Shorts picks and texts: put `ANTHROPIC_API_KEY=...` in a `.env` file here (git-ignored).
Without it, Shorts are picked by a scoring heuristic and `texts.md` is a filled-in template to polish.

## Each episode

1. Put the video(s) in `raw/` (e.g. `raw/ep2.mp4`; several clips for one episode are fine). Photos of her notes go in `notes/`. Old photos and props go in `photos/`. Name them by what they show (`طشت.jpg`, `radio_1970.jpg`) or list words in `photos/tags.json`: `{"wedding.jpg": ["الفرح", "ماما"]}`.
2. `python make_episode.py raw/ep2.mp4 --title "يوم الغسيل"` **transcribes, then stops.**
   Fix words in `output/episode_02/01_transcript/transcript.txt`. Put `x ` at the start of a line to cut it.
   Words Whisper wasn't sure about are listed after `# ؟` on each line.
3. Run the same command again. It **plans the cuts, B-roll and Shorts, writes preview frames, then stops.**
   Check `02_edit/previews.jpg`, `cuts.txt`, `shorts.md`. To keep a sentence that was cut, add its number to
   `"keep_ids"` in `output/episode_02/episode.json`. To change a Short, edit `02_edit/shorts.json`.
4. `python make_episode.py raw/ep2.mp4 --render` renders everything and writes `texts.md`.

Once you trust it: `python make_episode.py raw/ep2.mp4 --all` runs straight through.
Nothing is ever deleted. Intermediate files live in `output/episode_XX/work/` (safe to remove when an episode is published).

## Music

No music file needed: a soft original oud-style bed is generated, so it's royalty-free by construction. To use your own
royalty-free track instead (e.g. from the YouTube Audio Library), drop it in `music/`.

## Tuning (`channel.json`, copy from `channel.example.json`)
`grade` (0 = natural colour … 1 = full sepia), `grain`, `music_db`, `punch_in` (1.0 = off), `broll_every` (seconds),
`broll_graphics` (drawn vintage objects when no photo matches), `n_shorts`. Per-episode overrides go in `episode.json`.

## Filming tips that make the edit better
- Film **landscape at 4K** if the phone allows: the 9:16 Shorts are cropped from it, and 4K keeps them sharp.
- Put the phone at her eye level, with her slightly off-centre and a window light on her face.
- If she restarts a sentence, let her say it in full again. The pipeline keeps the last take.
