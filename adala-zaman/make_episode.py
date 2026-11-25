#!/usr/bin/env python3
"""عدالة زمان - one command per episode.

    python make_episode.py raw/ep1.mp4                 # run 1: transcribe -> STOP (fix the transcript)
    python make_episode.py raw/ep1.mp4                 # run 2: plan cuts/B-roll/Shorts + preview frames -> STOP
    python make_episode.py raw/ep1.mp4 --render        # run 3: render long video + Shorts + texts
    python make_episode.py raw/ep1.mp4 --all           # everything, no stops (once you trust it)

Options: --ep 3 (episode number; default from the filename), --title "عنوان الحلقة",
         --redo-transcript, --check (setup check only).
Several raw files for one episode? Pass them all: they're joined in order.
Nothing is ever deleted: outputs are (re)written inside output/episode_XX/ only.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
import time
from pathlib import Path

from az.common import LONG, NOTES, OUTPUT, ROOT, SHORT, load_config, probe, read_json, run, ts, write_json


def say(msg):
    print(msg, flush=True)


def episode_dir(src: Path, ep: int | None) -> tuple[Path, str]:
    if ep is None:
        m = re.findall(r"\d+", src.stem)
        ep = int(m[-1]) if m else 1
    name = f"episode_{ep:02d}"
    return OUTPUT / name, name


def join_sources(srcs: list[Path], ep: Path) -> Path:
    if len(srcs) == 1:
        return srcs[0]
    out = ep / "work" / "joined.mp4"
    if not out.exists():
        say(f"  joining {len(srcs)} clips…")
        lst = ep / "work" / "join.txt"
        lst.parent.mkdir(parents=True, exist_ok=True)
        lst.write_text("".join(f"file '{p.resolve()}'\n" for p in srcs))
        run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c:v", "libx264", "-crf", "16",
             "-preset", "veryfast", "-c:a", "aac", "-b:a", "256k", out])
    return out


NOTES_EP: Path = NOTES   # set per episode in main()


def notes_images() -> list[Path]:
    """Photos of her notes: notes/ep01/ (or notes/episode_01/), else loose files in notes/."""
    return sorted(p for p in NOTES_EP.glob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".heic"})


def notes_text() -> str:
    """A typed version of the notes (notes/ep01/notes.md), if someone wrote one - sent to Claude with the photos."""
    f = NOTES_EP / "notes.md"
    return f.read_text(encoding="utf-8") if f.exists() else ""


# ------------------------------------------------------------------ stage 2: plan
def plan(src: Path, info: dict, ep: Path, name: str, cfg: dict) -> dict:
    from az import broll, captions, edit, face, shorts
    from az.transcribe import apply_txt_edits, write_srt
    tr, changed = apply_txt_edits(ep)
    if changed:
        say(f"  applied {changed} fix(es) from transcript.txt")
    d = ep / "02_edit"
    d.mkdir(parents=True, exist_ok=True)
    say("  tracking her face…")
    ftrack = face.track(src, ep / "work" / "face.json")
    ed = edit.build_edit(tr, info["duration"], cfg["max_pause"], cfg["pause_keep"], cfg.get("keep_ids", []))
    (d / "cuts.txt").write_text(edit.cuts_report(ed), encoding="utf-8")
    write_json(ep / "work" / "edit.json", ed)
    say("  " + edit.cuts_report(ed).splitlines()[0])

    rows = shorts.sentence_table(tr, ed)
    intro = cfg["intro_seconds"]
    mode = cfg["visual_mode"]
    graphics = mode == "graphics" or (mode == "auto" and (not info["has_video"] or ftrack["hits"] == 0))
    scenes = []
    if graphics:
        from az import mg
        say("  she's not on camera -> motion-graphics episode")
        scenes = mg.plan(edit.map_words(ed), ed["edited_duration"], cfg, broll.load_photos(), notes_images())
        write_json(d / "scenes.json", scenes)
        (d / "scenes.txt").write_text(mg.summary(scenes), encoding="utf-8")
    br = [] if graphics else broll.plan_broll(rows, cfg, ed["edited_duration"])
    write_json(d / "broll.json", br)

    # Shorts: reuse previous picks if the transcript is unchanged (saves API calls)
    th = hashlib.sha1((ep / "01_transcript" / "transcript.json").read_bytes()).hexdigest()
    sp = d / "shorts.json"
    prev = read_json(sp) if sp.exists() else {}
    if prev.get("transcript_hash") == th and prev.get("moments"):
        moments = shorts.validate(rows, prev["moments"])     # hand-edited picks get checked too
    else:
        say("  picking Shorts moments…")
        moments = shorts.pick(tr, ed, cfg, notes_images(), notes_text())
        write_json(sp, {"transcript_hash": th, "moments": moments})
    for m in moments:
        m["transcript"] = " ".join(r["text"] for r in rows if m["start_id"] <= r["id"] <= m["end_id"])
    (d / "shorts.md").write_text(shorts_md(moments), encoding="utf-8")

    # cold open: her strongest line plays before the title card
    teaser = pick_teaser(rows, moments, cfg)
    tt = (teaser[1] - teaser[0]) if teaser else 0.0
    if teaser:
        say(f"  cold open ({tt:.1f}s): «{teaser[2]}»")
    lead = tt + intro                                     # where the edited story starts in the final video
    all_w = edit.map_words(ed)
    words = ([{**w, "start": w["start"] - teaser[0], "end": w["end"] - teaser[0]} for w in all_w
              if teaser and teaser[0] <= w["start"] and w["end"] <= teaser[1]]
             + [{**w, "start": w["start"] + lead, "end": w["end"] + lead} for w in all_w])
    captions.write_long(words, LONG, ep / "work" / "long.ass", end_limit=lead + ed["edited_duration"])
    write_srt([], ep / f"{name}_long_captions.srt", words=words)
    for b in br:
        b["t_final"] = round(b["t"] + lead, 2)
    return {"tr": tr, "edit": ed, "face": ftrack, "broll": br, "moments": moments, "rows": rows, "words": words,
            "graphics": graphics, "scenes": scenes, "teaser": teaser, "lead": lead}


def thumbnails(ep: Path, name: str, P: dict, cfg: dict, src: Path, title: str) -> list[Path]:
    from az import thumbs
    exact = bool(cfg.get("thumb_texts"))          # 2-4 words per thumbnail, chosen by hand (episode.json)
    texts = cfg.get("thumb_texts") or ([title] + [m["hook"] for m in P["moments"][:2]])
    objs = []
    for s_ in P.get("scenes", []):
        if s_.get("type") == "graphic" and s_["name"] not in objs:
            objs.append(s_["name"])
    if not objs:
        from az.keywords import match_topics
        objs = [t["graphic"] for t, _ in match_topics(" ".join(r["text"] for r in P["rows"])) if t.get("graphic")]
    contexts = [" ".join(r["text"] for r in P["rows"][:12])] + [m.get("transcript", m["hook"]) for m in P["moments"]]
    return thumbs.make(ep, name, texts, None if P["graphics"] else src, None if P["graphics"] else P["face"], objs, exact,
                       contexts)


def pick_teaser(rows: list[dict], moments: list[dict], cfg: dict):
    """(start, end, text) on the edited timeline: 4-8 s, the most hook-like sentence(s).
    Override with "cold_open_id": <sentence number> in episode.json, or false to switch it off."""
    from az.keywords import emotion_score, match_topics
    if cfg.get("cold_open_id") is False or not rows:
        return None
    def score(r):
        t = r["text"]
        return (emotion_score(t) * 2 + sum(h for _, h in match_topics(t)) + 3 * bool(re.search(r"[؟?!]", t))
                + 2 * any(r["id"] == m["end_id"] for m in moments))      # a Short's payoff line
    cands = [r for r in rows if r["t0"] > 3] or rows
    pick_id = cfg.get("cold_open_id") or next((m.get("cold_open_id") for m in moments if m.get("cold_open_id")), None)
    if pick_id:
        cands = [r for r in rows if r["id"] == pick_id] or cands
    best = max(cands, key=score)
    i = rows.index(best)
    a, b, text = best["t0"] - 0.1, best["t1"] + 0.25, best["text"]
    while b - a < 4 and i + 1 < len(rows) and rows[i + 1]["t1"] - a <= 8.5:   # too short: add the next sentence
        i += 1
        b, text = rows[i]["t1"] + 0.25, text + " " + rows[i]["text"]
    if b - a < 2.5:
        return None
    return (max(0.0, round(a, 3)), round(min(b, a + 8.5), 3), text)


def short_scenes(P: dict, se: dict, cfg: dict) -> list[dict]:
    from az import broll, edit, mg
    # Shorts open straight on a drawn object (eye-catching), no notebook pages
    return mg.plan(edit.map_words(se), se["edited_duration"], {**cfg, "chapters": []}, broll.load_photos(), [], seed=7)


def mg_track(P: dict, scenes: list[dict], size, total: float, edited: Path, work: Path, tag: str, cfg: dict) -> Path:
    """Render the motion-graphics picture and put the edited voice under it."""
    import json as _json
    from az import mg
    key = hashlib.sha1((_json.dumps(scenes, ensure_ascii=False, sort_keys=True) + str(size)).encode()).hexdigest()[:10]
    pic = mg.render(scenes, size, total, work / f"mg_{tag}_{key}.mp4", cfg)
    out = work / f"mg_{tag}_{key}_with_voice.mkv"
    if not out.exists():
        run(["ffmpeg", "-y", "-v", "error", "-i", pic, "-i", edited, "-map", "0:v", "-map", "1:a", "-c", "copy", "-shortest", out])
    return out


def scene_still(scenes: list[dict], size, t: float, ass: Path | None, ass_t: float, cfg: dict, out: Path) -> Path:
    """One finished-looking frame of a motion-graphics scene (+ grade, grain, captions) for previews."""
    from az import mg, video
    i = max([k for k, s in enumerate(scenes) if s["start"] <= t] or [0])
    img = mg.build(scenes[i], size, i, cfg).frame(t - scenes[i]["start"] + 0.25)
    tmp = out.with_suffix(".raw.png")
    img.convert("RGB").save(tmp)
    video.still(tmp, {"width": size[0], "height": size[1], "vertical": size[1] > size[0]}, size, 0.0,
                f"scale={size[0]}:{size[1]}", cfg, ass, ass_t, out)
    tmp.unlink()
    return out


def short_edit(ed: dict, m: dict) -> dict:
    keep, t = [], 0.0
    for k in ed["keep"]:
        a, b = max(k["a"], m["raw_a"]), min(k["b"], m["raw_b"])
        if b - a > 0.1:
            keep.append({"a": round(a, 3), "b": round(b, 3), "out": round(t, 3), "jump": k["jump"] and bool(keep)})
            t += b - a
    words = [w for w in ed["words"] if m["raw_a"] <= w["start"] and w["end"] <= m["raw_b"]]
    return {"keep": keep, "words": words, "edited_duration": round(t, 3)}


def shorts_md(moments):
    out = ["# Shorts picks", ""]
    for n, m in enumerate(moments, 1):
        out += [f"## Short {n} - {m['title']}  ({m['duration']:.0f}s, sentences {m['start_id']}-{m['end_id']}, "
                f"picked by {m.get('picked_by', '?')})", "", f"- **Hook on screen:** {m['hook']}",
                f"- **Opens with:** {m['opening_line']}", f"- **Why:** {m['why']}", ""]
    out.append("Change a pick: edit 02_edit/shorts.json (start_id / end_id / hook), then run with --render.")
    return "\n".join(out)


# ------------------------------------------------------------------ previews
def previews(src: Path, info: dict, ep: Path, P: dict, cfg: dict, title: str) -> Path:
    from PIL import Image
    from az import captions, edit, video
    from az.broll import KenBurns
    from az.common import ROOT as R
    from az.graphics import CardScene, GraphicScene
    d = ep / "02_edit" / "previews"
    d.mkdir(parents=True, exist_ok=True)
    ed, intro = P["edit"], cfg["intro_seconds"]
    tiles = []
    CardScene("title", LONG, cfg["channel"], title, cfg["intro_seconds"]).frame(2.5).save(d / "01_intro.jpg", quality=90)
    tiles.append(d / "01_intro.jpg")
    filters = video.piece_filters(info, LONG, ed["keep"], P["face"], cfg)
    for n, frac in enumerate((0.2, 0.5, 0.8), 1):
        te = ed["edited_duration"] * frac
        # snap to a moment where she's speaking so a caption shows
        w = min(P["words"], key=lambda w: abs(w["start"] - intro - te)) if P["words"] else None
        te = (w["start"] - P["lead"] + 0.3) if w else te
        out = d / f"02_long_{n}.jpg"
        if P["graphics"]:
            scene_still(P["scenes"], LONG, te, ep / "work" / "long.ass", te + P["lead"], cfg, out)
        else:
            i = max(k for k in range(len(ed["keep"])) if ed["keep"][k]["out"] <= te)
            k = ed["keep"][i]
            video.still(src, info, LONG, k["a"] + te - k["out"], filters[i], cfg, ep / "work" / "long.ass", te + P["lead"], out)
        tiles.append(out)
    if P["graphics"]:   # a few more scenes, so the variety is visible
        for n, sc in enumerate([s for s in P["scenes"] if s["type"] in ("chapter", "graphic", "notes")][1::4][:3], 1):
            out = d / f"03_scene_{n}.jpg"
            scene_still(P["scenes"], LONG, (sc["start"] + sc["end"]) / 2, ep / "work" / "long.ass", (sc["start"] + sc["end"]) / 2 + P["lead"], cfg, out)
            tiles.append(out)
    for n, b in enumerate(P["broll"][:2], 1):
        im = (KenBurns(R / b["file"], LONG, b["dur"], n, 0.75) if b["type"] == "photo"
              else GraphicScene(b["name"], LONG, b.get("label"))).frame(b["dur"] / 2)
        im.save(d / f"03_broll_{n}.jpg", quality=90)
        tiles.append(d / f"03_broll_{n}.jpg")
    CardScene("endscreen", LONG, cfg["outro_title"], cfg["outro_sub"], cfg["outro_seconds"]).frame(3).save(d / "04_outro.jpg", quality=90)
    tiles.append(d / "04_outro.jpg")
    vtiles = []
    for n, m in enumerate(P["moments"], 1):
        se = short_edit(ed, m)
        words = edit.map_words(se)
        ass = captions.write_short(words, SHORT, ep / "work" / f"short_{n}.ass", m["hook"], cfg["shorts_cta"],
                                   se["edited_duration"])
        f = video.piece_filters(info, SHORT, se["keep"], P["face"], cfg)
        ss = short_scenes(P, se, cfg) if P["graphics"] else []
        for tag, te in (("a", 0.8), ("b", min(se["edited_duration"] - 1, (words[len(words) // 2]["start"] + 0.15) if words else 10))):
            i = max(k for k in range(len(se["keep"])) if se["keep"][k]["out"] <= te)
            k = se["keep"][i]
            out = d / f"05_short_{n}{tag}.jpg"
            if ss:
                scene_still(ss, SHORT, te, ass, te, cfg, out)
            else:
                video.still(src, info, SHORT, k["a"] + te - k["out"], f[i], cfg, ass, te, out)
            vtiles.append(out)
    # contact sheet
    tw, th = 640, 360
    rows_l = (len(tiles) + 2) // 3
    vw, vh = 216, 384
    rows_v = (len(vtiles) + 5) // 6
    sheet = Image.new("RGB", (3 * tw, rows_l * th + rows_v * vh), (24, 18, 12))
    for n, p in enumerate(tiles):
        sheet.paste(Image.open(p).resize((tw, th)), ((n % 3) * tw, (n // 3) * th))
    for n, p in enumerate(vtiles):
        sheet.paste(Image.open(p).resize((vw, vh)), (((n % 6) * (vw + 104)) + 52, rows_l * th + (n // 6) * vh))
    out = ep / "02_edit" / "previews.jpg"
    sheet.save(out, quality=88)
    return out


# ------------------------------------------------------------------ stage 3: render
def render(src: Path, info: dict, ep: Path, name: str, P: dict, cfg: dict, title: str):
    from az import broll, captions, edit, texts, video
    from az.music import make_music
    work = ep / "work"
    ed, intro = P["edit"], cfg["intro_seconds"]
    t0 = time.time()

    say("▶ texts (titles, descriptions, hashtags, pinned comments)…")
    chap_src = [(r["t0"] + P["lead"], r["text"]) for r in P["rows"]]
    full_text = " ".join(r["text"] for r in P["rows"])
    shorts_in = [{**m} for m in P["moments"]]
    tx = texts.write(ep, name, title, full_text, chap_src, shorts_in, notes_images(), cfg, P["lead"], notes_text())
    if not title and tx.get("written_by") == "claude":
        title = re.sub(r"\s*[|｜-]\s*عدالة زمان\s*$", "", tx["long"]["titles"][0]).strip()
    if not title:
        title = f"الحلقة {int(name.split('_')[-1])}"
    if title:
        say(f"  episode title: {title}")

    say("▶ thumbnails…")
    thumbnails(ep, name, P, cfg, src, title)
    say("▶ long video: cutting pieces…")
    edited = video.render_pieces(src, info, LONG, ed["keep"], P["face"], cfg, work / "pieces", "long")
    if P["graphics"]:
        say("▶ long video: motion graphics…")
        edited = mg_track(P, P["scenes"], LONG, ed["edited_duration"], edited, work, "long", cfg)
    say("▶ long video: cards, B-roll, music…")
    intro_mp4 = video.render_card("title", cfg["channel"], title, LONG, cfg["intro_seconds"],
                                  work / f"intro_{hashlib.sha1(title.encode()).hexdigest()[:8]}.mp4")
    outro_mp4 = video.render_card("endscreen", cfg["outro_title"], cfg["outro_sub"], LONG, cfg["outro_seconds"], work / f"outro_end_{int(cfg['outro_seconds'])}.mp4")
    clips = []
    for n, b in enumerate(P["broll"]):
        key = hashlib.sha1(repr(sorted(b.items())).encode()).hexdigest()[:10]
        clips.append((broll.render_clip(b, LONG, work / "broll" / f"broll_{key}.mp4", n + 1), b["t"], b["dur"]))
    total = P["lead"] + ed["edited_duration"] + cfg["outro_seconds"]
    music = make_music(total + 1, work / f"music_{int(total)}.wav")
    say("▶ long video: finishing (grade, grain, captions, mix)…")
    long_out = ep / f"{name}_long_16x9.mp4"
    video.finish_long(edited, intro_mp4, outro_mp4, clips, work / "long.ass", music, long_out, cfg, ed["edited_duration"],
                      teaser=P["teaser"][:2] if P["teaser"] else None)
    say(f"  ✓ {long_out.relative_to(ROOT)}")

    for n, m in enumerate(P["moments"], 1):
        say(f"▶ Short {n}/{len(P['moments'])}: {m['title']}")
        se = short_edit(ed, m)
        words = edit.map_words(se)
        ass = captions.write_short(words, SHORT, work / f"short_{n}.ass", m["hook"], cfg["shorts_cta"], se["edited_duration"])
        sedited = video.render_pieces(src, info, SHORT, se["keep"], P["face"], cfg, work / "pieces", f"short{n}")
        if P["graphics"]:
            sedited = mg_track(P, short_scenes(P, se, cfg), SHORT, se["edited_duration"], sedited, work, f"short{n}", cfg)
        smusic = make_music(se["edited_duration"] + 1, work / f"music_{int(se['edited_duration'])}.wav")
        out = ep / f"{name}_short_{n}_9x16.mp4"
        video.finish_short(sedited, ass, smusic, out, cfg, se["edited_duration"])
        say(f"  ✓ {out.relative_to(ROOT)}")
    say(f"Done in {(time.time() - t0) / 60:.1f} min. Everything is in {ep.relative_to(ROOT)}/")


# ------------------------------------------------------------------ main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("videos", nargs="*", type=Path)
    ap.add_argument("--ep", type=int)
    ap.add_argument("--title", default=None)
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--redo-transcript", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)

    from az.check import check
    if a.check or not a.videos:
        return 0 if check() else 1
    for v in a.videos:
        if not v.exists():
            say(f"✗ not found: {v}")
            return 1
    ep, name = episode_dir(a.videos[0], a.ep)
    ep.mkdir(parents=True, exist_ok=True)
    global NOTES_EP
    num = int(name.split("_")[-1])
    for cand in (NOTES / f"ep{num:02d}", NOTES / f"ep{num}", NOTES / name):
        if cand.is_dir():
            NOTES_EP = cand
            break
    meta_p = ep / "episode.json"
    meta = read_json(meta_p) if meta_p.exists() else {"title": "", "keep_ids": []}
    if a.title is not None:
        meta["title"] = a.title
    write_json(meta_p, meta)
    cfg = load_config(ep)
    src = join_sources(a.videos, ep)
    info = probe(src)
    if not info["has_video"]:
        av = ep / "work" / "audio_with_blank_video.mp4"
        if not av.exists():
            av.parent.mkdir(parents=True, exist_ok=True)
            run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x2a1e14:s=1280x720:r=25", "-i", src,
                 "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "192k", av])
        src = av
        info = {**probe(src), "has_video": False}
    say(f"■ {name}: {src.name}  {info['width']}x{info['height']}  {info['duration'] / 60:.1f} min"
        f"{'  (vertical phone video)' if info['vertical'] else ''}")

    tj = ep / "01_transcript" / "transcript.json"
    if a.redo_transcript or not tj.exists():
        say("▶ STEP 1 - transcribing…")
        from az.transcribe import transcribe
        transcribe(src, ep)
        if not a.all:
            say(f"\n⏸  Review {(ep / '01_transcript' / 'transcript.txt').relative_to(ROOT)} (fix words, 'x ' to cut a "
                f"sentence), then run the same command again.")
            return 0

    say("▶ STEP 2 - planning the edit…")
    P = plan(src, info, ep, name, cfg)
    if not (a.render or a.all):
        sheet = previews(src, info, ep, P, cfg, meta["title"] or "عنوان الحلقة")
        th = thumbnails(ep, name, P, cfg, src, meta["title"] or "عنوان الحلقة")
        say(f"  thumbnails: {', '.join(p.name for p in th)}")
        say(f"\n  cuts:     {(ep / '02_edit' / 'cuts.txt').relative_to(ROOT)}")
        say(f"  B-roll:   {len(P['broll'])} inserts  ({(ep / '02_edit' / 'broll.json').relative_to(ROOT)})")
        for n, m in enumerate(P["moments"], 1):
            say(f"  Short {n}: {m['duration']:.0f}s  hook «{m['hook']}»  - {m['why']}")
        say(f"  previews: {sheet.relative_to(ROOT)}  (+ single frames in 02_edit/previews/)")
        say("\n⏸  Look at the previews. Happy? Run again with --render.")
        return 0

    say("▶ STEP 3 - rendering…")
    render(src, info, ep, name, P, cfg, meta["title"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
