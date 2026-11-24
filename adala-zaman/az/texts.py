"""Step 5 - titles, descriptions, hashtags and pinned comments in Egyptian Arabic.

With Claude API credentials: written by Claude from the edited transcript + her notes,
including YouTube chapters. Without: a filled-in template (clearly marked) to polish by hand.
Writes texts.md (copy-paste ready) and texts.json.
"""
from __future__ import annotations

from pathlib import Path

from . import ai
from .common import ts, write_json
from .keywords import match_topics

ITEM = {
    "type": "object",
    "properties": {
        "titles": {"type": "array", "items": {"type": "string"}, "description": "exactly 3 options"},
        "description": {"type": "string"},
        "hashtags": {"type": "array", "items": {"type": "string"}},
        "pinned_comment": {"type": "string"},
    },
    "required": ["titles", "description", "hashtags", "pinned_comment"], "additionalProperties": False,
}
SCHEMA = {
    "type": "object",
    "properties": {
        "long": {"type": "object", "properties": {
            **ITEM["properties"],
            "chapters": {"type": "array", "items": {"type": "object", "properties": {
                "seconds": {"type": "number"}, "title": {"type": "string"}},
                "required": ["seconds", "title"], "additionalProperties": False}},
        }, "required": ITEM["required"] + ["chapters"], "additionalProperties": False},
        "shorts": {"type": "array", "items": ITEM},
    },
    "required": ["long", "shorts"], "additionalProperties": False,
}
SYSTEM = """You write for "عدالة زمان", a warm nostalgia YouTube channel: an Egyptian mother, عدالة, tells
stories in Egyptian Arabic (عامية مصرية) about life in the old days, filmed by her son/daughter. Write
everything in natural Egyptian Arabic, warm and respectful, the way Egyptians talk - not Modern Standard
Arabic, no clickbait lies, no ALL CAPS, emojis only sparingly. Titles under 70 characters. Hashtags in
Arabic and English mixed, without spaces inside a tag."""


def write(ep: Path, ep_name: str, ep_title: str, transcript_text: str, chapters_src: list, shorts: list[dict],
          notes: list, cfg: dict, intro: float, notes_txt: str = "") -> dict:
    res = None
    if ai.available():
        listing = "\n".join(f"({t:.0f}s) {txt}" for t, txt in chapters_src)
        sh = "\n".join(f"Short {n}: \"{m['title']}\" - {m['transcript']}" for n, m in enumerate(shorts, 1))
        content = [*[ai.image_block(p) for p in notes[:6]], {"type": "text", "text":
                   f"{'Above: her handwritten notes for this episode. ' if notes else ''}"
                   f"{('Typed reading of the notes:' + chr(10) + notes_txt + chr(10) + chr(10)) if notes_txt else ''}"
                   f"Episode: {ep_name} - working title: {ep_title or '(none yet)'}\n\n"
                   f"Edited long-video transcript, each line with its start time in seconds (the intro card adds "
                   f"{intro:.0f}s; chapter times must include that offset and the first chapter must be 0):\n{listing}\n\n"
                   f"Shorts cut from it:\n{sh or '(none)'}\n\n"
                   "Write, for the long video and for each Short in order: 3 title options, a description "
                   "(long video: 3 short paragraphs + an invitation to subscribe; Shorts: 1-2 lines), 8-15 hashtags, "
                   "and a pinned comment that asks viewers to share their own memories of the topic (end it with a "
                   "question). For the long video also give 4-8 YouTube chapters."}]
        res = ai.ask_json(SYSTEM, content, SCHEMA, cfg["claude_model"])
        if res:
            res["written_by"] = "claude"
    if not res:
        res = template(ep_title, transcript_text, shorts)
    md = to_markdown(ep_name, res, shorts)
    (ep / "texts.md").write_text(md, encoding="utf-8")
    write_json(ep / "work" / "texts.json", res)
    return res


def template(ep_title: str, text: str, shorts: list[dict]) -> dict:
    labels = [t["label"] for t, _ in match_topics(text)[:3] if t.get("label")]
    main = labels[0] if labels else "أيام زمان"
    about = (" و".join(labels[:-1]) + " و" + labels[-1]) if len(labels) > 1 else main
    head = ep_title or f"حكاية {main}"
    base_tags = ["#عدالة_زمان", "#زمان", "#ذكريات", "#أيام_زمان", "#مصر_زمان", "#حكايات_زمان", "#nostalgia", "#egypt"]
    base_tags += ["#" + l.replace(" ", "_") for l in labels]
    long = {
        "titles": [f"{head} | عدالة زمان", f"فاكرين {main}؟ ماما عدالة بتحكيلكم", f"{head}.. ذكريات من البيت المصري زمان"],
        "description": (f"في الحلقة دي ماما عدالة بتحكيلنا عن {about}، وعن أيام زمان الحلوة: "
                        "البيت البسيط والناس الطيبة والتفاصيل الصغيرة اللي كانت بتفرّحنا.\n\n"
                        "لو الحكاية فكرتك بحد من عيلتك، ابعتهاله واكتبلنا ذكرياتك في التعليقات.\n\n"
                        "اشترك في القناة وفعّل الجرس عشان توصلك كل حكاية جديدة من حكايات عدالة زمان."),
        "hashtags": base_tags, "chapters": [],
        "pinned_comment": f"إنتوا كمان فاكرين {main}؟ احكولنا أحلى ذكرى عندكم من أيام زمان 👇",
    }
    shs = [{"titles": [m["hook"], f"{m['title']}..", f"{m['hook']} | عدالة زمان"],
            "description": "حكاية صغيرة من حكايات ماما عدالة عن أيام زمان. الحكاية كاملة على القناة.",
            "hashtags": base_tags + ["#shorts", "#reels"],
            "pinned_comment": "حصلت معاكم حاجة زي كده زمان؟ احكولنا 👇"} for m in shorts]
    return {"long": long, "shorts": shs, "written_by": "template"}


def to_markdown(ep_name: str, res: dict, shorts: list[dict]) -> str:
    out = [f"# {ep_name} - texts", ""]
    if res.get("written_by") == "template":
        out += ["> ⚠️ Template text (no Claude API key was available) - polish before posting.", ""]

    def block(title, item, chapters=None):
        out.extend([f"## {title}", "", "**Title options**", ""])
        out.extend(f"{n}. {t}" for n, t in enumerate(item["titles"], 1))
        out.extend(["", "**Description**", "", item["description"]])
        if chapters:
            out.extend(["", "**Chapters** (paste into the description)", ""])
            out.extend(f"{ts(c['seconds'])[3:8] if c['seconds'] < 3600 else ts(c['seconds'])[:8]} {c['title']}"
                       for c in chapters)
        out.extend(["", "**Hashtags**", "", " ".join(item["hashtags"]), "", "**Pinned comment**", "",
                    item["pinned_comment"], ""])

    block("Long video (YouTube + Facebook)", res["long"], res["long"].get("chapters"))
    for n, item in enumerate(res.get("shorts", []), 1):
        block(f"Short {n} - {shorts[n - 1]['title'] if n <= len(shorts) else ''}", item)
    return "\n".join(out)
