# عدالة زمان: episode pipeline

One command per episode turns her phone video into:

| File (in `output/episode_XX/`) | What |
|---|---|
| `episode_XX_long_16x9.mp4` | YouTube/Facebook, 1080p. Intro card «عدالة زمان» + episode title → her story (silences, false starts and repeated takes cut; alternate jump cuts get a gentle punch-in) → outro «اشترك وتابعنا». Warm vintage grade, light grain, burnt-in Arabic captions, B-roll photos with slow zoom, soft music ducked under her voice. |
| `episode_XX_long_captions.srt` | The same captions as a file, to upload as YouTube subtitles. |
| `episode_XX_short_N_9x16.mp4` | 3–5 Shorts/Reels/TikToks (1080×1920, 30–60 s). Her face kept centred, big word-by-word captions, hook text for the first 2 s. |
| `episode_XX_thumbnail_1..3.jpg` | 3 YouTube thumbnails (1280×720) for YouTube's "Test & compare": her best face frames (or the episode's main object), 2–4 big words, channel badge. |
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

## What makes it built for reach
- **Cold open:** the long video opens on her strongest 4–8 s line, then the title card. Picked automatically, or by the Claude API, or set it by hand with `"cold_open_id"`.
- **End screen:** the outro lasts 12 s, with the title at the top and the middle left clear for YouTube's end-screen boxes.
- **Safe zones:** Shorts captions and the call-to-action stay clear of the TikTok/Reels/Shorts buttons (bottom fifth, right edge).
- **Loudness:** mastered to −14 LUFS, YouTube's playback level.
- **No face on camera?** With audio-only input, or no face found, the whole picture becomes motion graphics: chapter cards, drawn objects with camera moves, and her handwriting now and then.

## Per-episode options (`output/episode_XX/episode.json`)
```json
{
  "title": "البيت البسيط زمان",
  "keep_ids": [17],
  "whisper_prompt": "النملية، وابور الجاز، الزير، القبقاب",
  "chapters": [{"start_id": 24, "title": "يوم الغسيل"}],
  "cold_open_id": 72,
  "thumb_texts": ["البيت البسيط زمان", "من غير غسالة", "زير قدام كل بيت"],
  "visual_mode": "auto"
}
```
`visual_mode` can be `auto`, `face` or `graphics`. `chapters` and `cold_open_id` use sentence numbers from `transcript.txt`.

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
