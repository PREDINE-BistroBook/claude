"""Setup check: tools present + Arabic renders right-to-left with connected letters."""
from __future__ import annotations

import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont, features

from .common import OUTPUT, font_display, font_path, font_text, run

SAMPLE = "عدالة زمان — يوم الغسيل بالطشت والنيلة"


def check() -> bool:
    ok = True
    for tool in ("ffmpeg", "ffprobe", "fc-match"):
        found = shutil.which(tool)
        print(f"  {'✓' if found else '✗'} {tool}")
        ok &= bool(found)
    filters = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    for f in ("ass", "sidechaincompress", "noise", "vignette"):
        has = f" {f} " in filters
        print(f"  {'✓' if has else '✗'} ffmpeg filter: {f}")
        ok &= has
    raqm = features.check("raqm")
    print(f"  {'✓' if raqm else '✗'} Pillow Arabic shaping (libraqm)")
    ok &= raqm
    for name, path in (("Noto Naskh Arabic", font_text()), ("Amiri", font_display())):
        good = name.split()[0].lower() in path.lower()
        print(f"  {'✓' if good else '✗'} font {name}: {path}")
        ok &= good
    try:
        import faster_whisper  # noqa: F401
        print("  ✓ faster-whisper")
    except ImportError:
        print("  ✗ faster-whisper (pip install -r requirements.txt)")
        ok = False
    # render the sample both ways so a human can eyeball it
    OUTPUT.mkdir(exist_ok=True)
    out = OUTPUT / "setup_check.png"
    img = Image.new("RGB", (1400, 360), (236, 222, 196))
    d = ImageDraw.Draw(img)
    d.text((700, 70), "Pillow:", font=ImageFont.truetype(font_path("DejaVu Sans"), 30), fill=(120, 88, 60), anchor="mm")
    d.text((700, 130), SAMPLE, font=ImageFont.truetype(font_display(), 64, layout_engine=ImageFont.Layout.RAQM),
           fill=(74, 50, 32), anchor="mm")
    img.save(out)
    ass = OUTPUT / ".setup_check.ass"
    ass.write_text("[Script Info]\nPlayResX: 1400\nPlayResY: 360\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, "
                   "PrimaryColour, OutlineColour, BorderStyle, Outline, Shadow, Alignment, MarginV, Bold\n"
                   "Style: A,Noto Naskh Arabic,60,&H00DCF0FA,&H00101A28,1,4,0,2,40,-1\n\n[Events]\n"
                   "Format: Layer, Start, End, Style, Text\nDialogue: 0,0:00:00.00,0:00:05.00,A,ffmpeg/libass: "
                   + SAMPLE + "\n", encoding="utf-8")
    run(["ffmpeg", "-y", "-v", "error", "-i", out, "-vf", f"ass={ass}", out.with_name("setup_check_tmp.png")])
    out.with_name("setup_check_tmp.png").replace(out)
    ass.unlink()
    print(f"  → sample render: {out}  (check: letters joined, reads right-to-left)")
    print("SETUP OK" if ok else "SETUP INCOMPLETE - see ✗ above")
    return ok
