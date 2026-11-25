"""Topic dictionary: Arabic words (Egyptian + MSA spellings) -> B-roll.

Photos in photos/ are matched by filename or photos/tags.json against these topics and
against her literal words. `graphic` = a drawn vintage object used when no photo fits.
Add topics/words freely; matching ignores diacritics, ال/و/ب prefixes, ة/ه, أ/ا.
"""
from __future__ import annotations

from .common import norm_ar, token_forms

TOPICS = [
    # --- from the episode-1 notes (البيت البسيط) ---
    dict(id="wabour", graphic="wabour", label="وابور الجاز", words=["وابور", "الوابور", "بابور", "البابور", "وابور الجاز", "بابور الجاز"]),
    dict(id="namlia", graphic="namlia", label="النملية", words=["نمليه", "النمليه", "تلاجه", "التلاجه", "نحفظ الاكل"]),
    dict(id="qubqab", graphic="qubqab", label="القبقاب الخشب", words=["قبقاب", "القبقاب", "طرقعه", "الطرقعه"]),
    dict(id="lamp", graphic="lamp", label="لمبة الجاز", words=["لمبه الجاز", "لمبه جاز", "شمعه", "الشمعه", "النور قطع", "النور يقطع", "الكهربا قطعت"]),
    dict(id="roof", words=["السطوح", "سطوح", "السطح", "ننشر", "نشر الغسيل", "في الشمس"]),
    dict(id="brassbed", words=["سرير نحاس", "السرير النحاس", "سرير النحاس"]),
    dict(id="bathroom", words=["حمام بلدي", "الحمام البلدي"]),
    # --- objects with a drawn motion graphic ---
    dict(id="radio", graphic="radio", label="الراديو", 
         words=["راديو", "رديو", "اذاعه", "الاذاعه", "ام كلثوم", "الست", "عبد الحليم", "عبد الوهاب", "البرنامج العام", "اغاني"]),
    dict(id="tasht", graphic="tasht", label="الطشت", 
         words=["طشت", "نيله", "النيله", "زهره", "بستله", "البستله", "كلور", "الكلور", "يوم الغسيل", "الغسيل", "غسيل", "نغسل", "بتغسل", "تغسل", "غسلت", "صابون", "الهدوم"]),
    dict(id="kanaba", graphic="kanaba", label="الكنبة البلدي", 
         words=["كنبه", "كنبه بلدي", "الكنبه", "الصالون", "الصاله", "قعده", "قاعدين", "بنقعد"]),
    dict(id="tea", graphic="tea", label="كوباية شاي", 
         words=["شاي", "الشاي", "كوبايه", "براد", "قهوه", "القهوه", "كنكه"]),
    dict(id="tv", graphic="tv", label="التليفزيون", 
         words=["تليفزيون", "تلفزيون", "التلفزيون", "التليفزيون", "تلفزيون ابيض واسود", "المسلسل", "الفيلم", "فيلم", "السينما"]),
    dict(id="fanoos", graphic="fanoos", label="فانوس رمضان", 
         words=["فانوس", "رمضان", "الفطار", "السحور", "المسحراتي", "العيد", "كحك", "الكحك"]),
    dict(id="clock", graphic="clock", label="زمان", 
         words=["الساعه", "ساعه الحيطه", "بندول"]),
    dict(id="phone", graphic="phone", label="التليفون", 
         words=["تليفون", "التليفون", "تلفون", "اتصل", "اتصلت", "مكالمه", "ترنك"]),
    dict(id="qolla", graphic="qolla", label="القلة والزير", 
         words=["قله", "القله", "زير", "الزير", "البلاص", "القله الفخار"]),
    # --- stock-only topics (family photos tagged with these words win first) ---
    dict(id="kitchen", words=["مطبخ", "المطبخ", "طبخ", "بطبخ", "اكل", "الاكل", "عيش", "فرن", "الفرن", "وابور", "الوابور", "طبيخ"]),
    dict(id="school", words=["مدرسه", "المدرسه", "الفصل", "المدرس", "المدرسه", "كراسه", "شنطه", "الامتحان", "اتعلمت"]),
    dict(id="wedding", words=["فرح", "الفرح", "عروسه", "العروسه", "اتجوزت", "جواز", "الجواز", "زفه", "خطوبه", "شبكه"]),
    dict(id="street", words=["حاره", "الحاره", "الشارع", "شارع", "الحته", "جيران", "الجيران", "البلد", "القاهره", "مصر"]),
    dict(id="village", words=["ريف", "الريف", "الغيط", "قريه", "القريه", "فلاحين", "الترعه", "بهايم", "جاموسه"]),
    dict(id="nile", words=["النيل", "نيل", "مركب", "فلوكه", "الكورنيش", "البحر"]),
    dict(id="train", words=["قطر", "القطر", "قطار", "المحطه", "سفر", "سافرنا", "سافر", "الاتوبيس", "ترام", "الترام"]),
    dict(id="sewing", words=["ماكينه", "خياطه", "الخياطه", "بخيط", "فستان", "الفستان", "قماش", "ترزي"]),
    dict(id="market", words=["سوق", "السوق", "البقال", "البقاله", "اشتري", "اشترينا", "قرش", "قروش", "مليم", "تعريفه", "شلن"]),
    dict(id="mosque", words=["جامع", "الجامع", "صلاه", "الصلاه", "بصلي", "قران", "القران", "الاذان"]),
    dict(id="family", words=["ماما", "امي", "بابا", "ابويا", "ابوي", "اخويا", "اختي", "ستي", "جدي", "جدتي", "العيله", "اولادي", "عيالي"]),
    dict(id="children", words=["لعب", "بنلعب", "نلعب", "العيال", "الاطفال", "اطفال", "استغمايه", "نط الحبل"]),
    dict(id="letters", words=["جواب", "جوابات", "الجواب", "رساله", "كتبت", "البوسطه"]),
    dict(id="photo", words=["صوره", "صور", "الصور", "اتصورنا", "البوم"]),
    dict(id="night", words=["بالليل", "الليل", "القمر", "السهر", "سهرنا"]),
]

EMOTION_WORDS = [norm_ar(w) for w in [
    "الله يرحمه", "الله يرحمها", "ربنا", "بكيت", "عيطت", "ضحكنا", "ضحكت", "فرحت", "زعلت", "خفت", "اتخضيت",
    "حبيت", "بحبه", "بحبها", "اول مره", "عمري ما", "مش ناسيه", "مش هنسى", "فاكره", "افتكر", "تصدق", "تصدقي",
    "تصدقوا", "والله", "ياه", "يا سلام", "يا خبر", "يا ساتر", "حلوه", "جميله", "كانت ايام", "اتعلمت", "نصيحه",
    "البركه", "الرضا", "الخير", "زمان كان", "دلوقتي", "مفيش",
]]

_COMPILED = [(t, [norm_ar(w).split() for w in t["words"] if norm_ar(w)]) for t in TOPICS]


def tokens_with_forms(text: str) -> list[set[str]]:
    return [token_forms(tok) for tok in norm_ar(text).split()]


def match_topics(text: str) -> list[tuple[dict, int]]:
    toks = tokens_with_forms(text)
    res = []
    for topic, phrases in _COMPILED:
        hits = 0
        for ph in phrases:
            for i in range(len(toks) - len(ph) + 1):
                if all(ph[k] in toks[i + k] for k in range(len(ph))):
                    hits += len(ph)
        if hits:
            res.append((topic, hits))
    return sorted(res, key=lambda x: -x[1])


def emotion_score(text: str) -> int:
    t = " " + norm_ar(text) + " "
    return sum(t.count(" " + w + " ") for w in EMOTION_WORDS)
