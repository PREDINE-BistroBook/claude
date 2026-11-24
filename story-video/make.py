#!/usr/bin/env python3
"""Story-video pipeline: one voice recording -> a long 16:9 film + 3-5 vertical Shorts.

  python make.py transcribe input/her_voice.m4a   # 1. clean audio + Arabic word timestamps
  python make.py plan                             # 2. scene plans (editable JSON) + Shorts picks
  python make.py stock                            # 3. download stock footage the plans ask for
  python make.py preview                          #    contact sheets to eyeball every scene
  python make.py long                             # 4. render output/long.mp4
  python make.py shorts [short_2 ...]             # 5. render output/short_N.mp4
  python make.py all input/her_voice.m4a          #    everything, in order
"""
from __future__ import annotations

import argparse
import sys
import time

from sv.common import OUT, WORK, load_config, read_json, write_json


def cmd_transcribe(a):
    from sv.transcribe import transcribe
    transcribe(a.audio, a.model)


def cmd_plan(a):
    from sv.plan import make_plans, summary
    lp, sp = make_plans((a.min_shorts, a.max_shorts))
    print(summary(lp))
    for sh in sp["shorts"]:
        print(f"\n== {sh['id']}  voice {sh['voice_in']:.1f}-{sh['voice_out']:.1f}s  ({sh['duration']:.0f}s)  hook: {sh['hook']}")
    print(f"\nPlans written to {WORK/'plan_long.json'} and {WORK/'plan_shorts.json'} - edit freely, then render.")


def cmd_stock(a):
    from sv.stock import have_keys, resolve_plan
    if not have_keys():
        print("No PEXELS_API_KEY / PIXABAY_API_KEY found (env or .env). Stock scenes will fall back to quote cards.")
        return
    lp = read_json(WORK / "plan_long.json")
    m = resolve_plan(lp)
    write_json(WORK / "plan_long.json", lp)
    sp = read_json(WORK / "plan_shorts.json")
    for sh in sp["shorts"]:
        m += resolve_plan(sh)
    write_json(WORK / "plan_shorts.json", sp)
    print(f"stock resolved ({m} unresolved -> will fall back to quote cards)")


def cmd_preview(a):
    from sv.render import preview_sheet
    lp = read_json(WORK / "plan_long.json")
    print(preview_sheet(lp, WORK / "preview_long.png"))
    for sh in read_json(WORK / "plan_shorts.json")["shorts"]:
        print(preview_sheet(sh, WORK / f"preview_{sh['id']}.png", cols=8))


def cmd_long(a):
    from sv.captions import write_long
    from sv.render import render_plan
    cfg = load_config()
    lp = read_json(WORK / "plan_long.json")
    lp["waveform"] = cfg["waveform"]
    ass = write_long(lp, WORK / "long.ass")
    t = time.time()
    render_plan(lp, "long", ass, waveform=cfg["waveform"])
    print(f"long video rendered in {time.time() - t:.0f}s")


def cmd_shorts(a):
    from sv.captions import write_short
    from sv.render import render_plan
    for sh in read_json(WORK / "plan_shorts.json")["shorts"]:
        if a.ids and sh["id"] not in a.ids:
            continue
        ass = write_short(sh, WORK / f"{sh['id']}.ass")
        render_plan(sh, sh["id"], ass, waveform=False)


def cmd_all(a):
    cmd_transcribe(a)
    cmd_plan(a)
    cmd_stock(a)
    cmd_long(a)
    a.ids = []
    cmd_shorts(a)
    print(f"\nAll done -> {OUT}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("transcribe"); p.add_argument("audio"); p.add_argument("--model"); p.set_defaults(fn=cmd_transcribe)
    p = sub.add_parser("plan"); p.add_argument("--min-shorts", type=int, default=3); p.add_argument("--max-shorts", type=int, default=5); p.set_defaults(fn=cmd_plan)
    sub.add_parser("stock").set_defaults(fn=cmd_stock)
    sub.add_parser("preview").set_defaults(fn=cmd_preview)
    sub.add_parser("long").set_defaults(fn=cmd_long)
    p = sub.add_parser("shorts"); p.add_argument("ids", nargs="*"); p.set_defaults(fn=cmd_shorts)
    p = sub.add_parser("all"); p.add_argument("audio"); p.add_argument("--model")
    p.add_argument("--min-shorts", type=int, default=3); p.add_argument("--max-shorts", type=int, default=5)
    p.set_defaults(fn=cmd_all)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
