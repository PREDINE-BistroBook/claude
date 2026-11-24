"""Arabic keyword -> visual dictionary.

Each topic: Arabic trigger words (Egyptian colloquial + MSA spellings), an optional
drawn motion-graphic, and an English stock-search query (Pexels/Pixabay search
English best). Add your own topics freely - matching is prefix/diacritic tolerant.
"""
from __future__ import annotations

from .common import norm_ar, token_forms

TOPICS = [
    # --- objects with a drawn motion graphic ---
    dict(id="radio", graphic="radio", label="الراديو", stock="vintage radio",
         words=["راديو", "رديو", "اذاعه", "الاذاعه", "ام كلثوم", "الست", "عبد الحليم", "عبد الوهاب", "البرنامج العام", "اغاني"]),
    dict(id="tasht", graphic="tasht", label="الطشت", stock="washing clothes by hand basin",
         words=["طشت", "الغسيل", "غسيل", "نغسل", "بتغسل", "تغسل", "غسلت", "صابون", "الهدوم"]),
    dict(id="kanaba", graphic="kanaba", label="الكنبة البلدي", stock="old wooden sofa living room",
         words=["كنبه", "كنبه بلدي", "الكنبه", "الصالون", "الصاله", "قعده", "قاعدين", "بنقعد"]),
    dict(id="tea", graphic="tea", label="كوباية شاي", stock="tea glass steam",
         words=["شاي", "الشاي", "كوبايه", "براد", "قهوه", "القهوه", "كنكه"]),
    dict(id="tv", graphic="tv", label="التليفزيون", stock="vintage television",
         words=["تليفزيون", "تلفزيون", "التلفزيون", "التليفزيون", "تلفزيون ابيض واسود", "المسلسل", "الفيلم", "فيلم", "السينما"]),
    dict(id="fanoos", graphic="fanoos", label="فانوس رمضان", stock="ramadan lantern",
         words=["فانوس", "رمضان", "الفطار", "السحور", "المسحراتي", "العيد", "كحك", "الكحك"]),
    dict(id="clock", graphic="clock", label="زمان", stock="antique clock",
         words=["الساعه", "ساعه", "زمان", "ايام زمان", "سنين", "الوقت", "كبرت", "صغيره", "وانا صغيره", "وانا صغير"]),
    dict(id="phone", graphic="phone", label="التليفون", stock="rotary telephone vintage",
         words=["تليفون", "التليفون", "تلفون", "اتصل", "اتصلت", "مكالمه", "ترنك"]),
    dict(id="qolla", graphic="qolla", label="القلة", stock="clay water jug",
         words=["قله", "القله", "زير", "الزير", "ميه", "المية", "البلاص"]),
    # --- stock-only topics (family photos tagged with these words win first) ---
    dict(id="kitchen", stock="old kitchen cooking pot", words=["مطبخ", "المطبخ", "طبخ", "بطبخ", "اكل", "الاكل", "عيش", "فرن", "الفرن", "وابور", "الوابور", "طبيخ"]),
    dict(id="school", stock="old school classroom", words=["مدرسه", "المدرسه", "الفصل", "المدرس", "المدرسه", "كراسه", "شنطه", "الامتحان", "اتعلمت"]),
    dict(id="wedding", stock="vintage wedding", words=["فرح", "الفرح", "عروسه", "العروسه", "اتجوزت", "جواز", "الجواز", "زفه", "خطوبه", "شبكه"]),
    dict(id="street", stock="old cairo street", words=["حاره", "الحاره", "الشارع", "شارع", "الحته", "جيران", "الجيران", "البلد", "القاهره", "مصر"]),
    dict(id="village", stock="egypt village countryside", words=["ريف", "الريف", "الغيط", "قريه", "القريه", "فلاحين", "الترعه", "بهايم", "جاموسه"]),
    dict(id="nile", stock="nile river felucca", words=["النيل", "نيل", "مركب", "فلوكه", "الكورنيش", "البحر"]),
    dict(id="train", stock="old train station", words=["قطر", "القطر", "قطار", "المحطه", "سفر", "سافرنا", "سافر", "الاتوبيس", "ترام", "الترام"]),
    dict(id="sewing", stock="vintage sewing machine", words=["ماكينه", "خياطه", "الخياطه", "بخيط", "فستان", "الفستان", "قماش", "ترزي"]),
    dict(id="market", stock="traditional market spices", words=["سوق", "السوق", "البقال", "البقاله", "اشتري", "اشترينا", "قرش", "قروش", "مليم", "تعريفه", "شلن"]),
    dict(id="mosque", stock="mosque minaret", words=["جامع", "الجامع", "صلاه", "الصلاه", "بصلي", "قران", "القران", "الاذان"]),
    dict(id="family", stock="vintage family photo", words=["ماما", "امي", "بابا", "ابويا", "ابوي", "اخويا", "اختي", "ستي", "جدي", "جدتي", "العيله", "اولادي", "عيالي"]),
    dict(id="children", stock="children playing street", words=["لعب", "بنلعب", "نلعب", "العيال", "الاطفال", "اطفال", "استغمايه", "نط الحبل"]),
    dict(id="letters", stock="old letters handwriting", words=["جواب", "جوابات", "الجواب", "رساله", "كتبت", "البوسطه"]),
    dict(id="photo", stock="old photographs album", words=["صوره", "صور", "الصور", "اتصورنا", "البوم"]),
    dict(id="night", stock="night moon old city", words=["بالليل", "الليل", "القمر", "السهر", "سهرنا"]),
]

# Emotional / story-beat words used to score Shorts moments.
EMOTION_WORDS = [norm_ar(w) for w in [
    "الله يرحمه", "الله يرحمها", "ربنا", "بكيت", "عيطت", "ضحكنا", "ضحكت", "فرحت", "زعلت", "خفت", "اتخضيت",
    "حبيت", "بحبه", "بحبها", "اول مره", "عمري ما", "مش ناسيه", "مش هنسى", "فاكره", "افتكر", "تصدق", "تصدقي",
    "والله", "ياه", "يا سلام", "يا خبر", "حلوه", "جميله", "زمان", "كانت ايام", "اتعلمت", "نصيحه",
]]


def _compile():
    out = []
    for t in TOPICS:
        phrases = []
        for w in t["words"]:
            toks = norm_ar(w).split()
            if toks:
                phrases.append(toks)
        out.append((t, phrases))
    return out


_COMPILED = _compile()


def tokens_with_forms(text: str) -> list[set[str]]:
    return [token_forms(tok) for tok in norm_ar(text).split()]


def match_topics(text: str) -> list[tuple[dict, int]]:
    """Return [(topic, hits)] for topics mentioned in text, most hits first."""
    toks = tokens_with_forms(text)
    res = []
    for topic, phrases in _COMPILED:
        hits = 0
        for ph in phrases:
            n = len(ph)
            for i in range(len(toks) - n + 1):
                if all(ph[k] in toks[i + k] for k in range(n)):
                    hits += n  # multi-word phrases count more
        if hits:
            res.append((topic, hits))
    res.sort(key=lambda x: -x[1])
    return res


def emotion_score(text: str) -> int:
    t = " " + norm_ar(text) + " "
    return sum(t.count(" " + w + " ") + (1 if (" " + w) in t and len(w) > 4 else 0) for w in EMOTION_WORDS)
