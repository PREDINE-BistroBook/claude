/* Zen Recovery — shared guidance: where to send a client, what to ask them, what to tell them before and after.
   Used by account.html (questionnaire + guide), index.html (booking hints), success.html (before-checklist) and admin.html (labels). */
window.ZenGuide = (function () {
  const CITY_NAME = { cairo: "Cairo", dahab: "Dahab", florence: "Florence" };

  /* ---------- where they live → nearest centre ---------- */
  const SINAI = ["dahab", "sharm", "sharm el sheikh", "sharm el-sheikh", "nuweiba", "taba", "saint catherine", "st catherine", "st. catherine", "nabq", "ras shitan", "ras sudr", "el tor", "tor sinai", "hurghada", "el gouna", "gouna", "safaga", "marsa alam", "soma bay"];
  const EGYPT_SUGGEST = ["Cairo", "Giza", "New Cairo", "6th of October", "Maadi", "Heliopolis", "Nasr City", "Sheikh Zayed", "Alexandria", "Mansoura", "Tanta", "Zagazig", "Ismailia", "Suez", "Port Said", "Fayoum", "Minya", "Assiut", "Luxor", "Aswan", "Dahab", "Sharm El Sheikh", "Nuweiba", "Taba", "Saint Catherine", "Hurghada", "El Gouna", "Marsa Alam"];
  const ITALY_SUGGEST = ["Firenze / Florence", "Prato", "Pistoia", "Pisa", "Lucca", "Siena", "Arezzo", "Bologna", "Roma", "Milano", "Torino", "Genova", "Napoli", "Venezia", "Verona", "Padova", "Perugia", "Livorno"];
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim(); }
  function recommend(country, cityText) {
    const c = norm(cityText);
    if (country === "IT") return { city: "florence", reason: c.includes("firenze") || c.includes("florence") ? "You're in Florence: the studio is in town." : `Florence is our only room in Italy${c ? ", a train ride from " + cityText.trim() : ""}.` };
    if (country === "EG") {
      if (SINAI.some((k) => c.includes(k))) return { city: "dahab", reason: c.includes("dahab") ? "You're in Dahab: Shaarawy's room is by the sea." : `Dahab is the closest room to ${cityText.trim()}: same coast, no need to go through Cairo.` };
      return { city: "cairo", reason: c.includes("cairo") || c.includes("giza") ? "You're in Greater Cairo: Shaarawy's Cairo room is the one for you." : `Cairo is the closest room to ${cityText.trim() || "you"}.` };
    }
    return { city: null, reason: "You're outside Egypt and Italy, so pick the room you'll be nearest to when you travel: Florence for Italy, Cairo or Dahab for Egypt." };
  }

  /* ---------- questionnaire options ---------- */
  const OPTIONS = {
    goals: [
      { id: "recovery", label: "Recover between training sessions", hint: "Gym, running, football, climbing, diving." },
      { id: "pain", label: "Ease a specific pain or tightness", hint: "Back, neck, shoulder, hip, knee." },
      { id: "posture", label: "Long hours sitting or standing", hint: "Desk work, driving, hospitality." },
      { id: "stress", label: "Sleep, stress, headaches", hint: "Tension that shows up in the neck and jaw." },
      { id: "injury", label: "Coming back from an injury", hint: "Tell us what and when in the notes." },
      { id: "curious", label: "Curious, first time", hint: "We'll take it gently." },
    ],
    pain: [
      { id: "neck", label: "Neck" }, { id: "shoulder_l", label: "Left shoulder" }, { id: "shoulder_r", label: "Right shoulder" },
      { id: "upper_back", label: "Upper back" }, { id: "mid_back", label: "Mid back" }, { id: "lower_back", label: "Lower back" },
      { id: "arm_l", label: "Left arm" }, { id: "arm_r", label: "Right arm" }, { id: "hips", label: "Hips / glutes" },
      { id: "thigh_l", label: "Left thigh" }, { id: "thigh_r", label: "Right thigh" }, { id: "calf_l", label: "Left calf" }, { id: "calf_r", label: "Right calf" },
      { id: "face", label: "Face / jaw" },
    ],
    activity: [
      { id: "low", label: "Not much right now" }, { id: "moderate", label: "1–2 times a week" }, { id: "high", label: "3–5 times a week" }, { id: "athlete", label: "Daily / competing" },
    ],
    experience: [
      { id: "first", label: "Never had cupping" }, { id: "some", label: "A few times" }, { id: "regular", label: "Regularly" },
    ],
    health: [
      { id: "pregnant", label: "Pregnant or trying", flag: true },
      { id: "anticoagulant", label: "Blood thinners (warfarin, aspirin daily, etc.)", flag: true },
      { id: "bleeding", label: "Bleeding or clotting disorder, anaemia", flag: true },
      { id: "heart", label: "Heart condition or pacemaker", flag: true },
      { id: "diabetes", label: "Diabetes", flag: true },
      { id: "skin", label: "Skin condition, eczema, open wounds where cups would go", flag: true },
      { id: "surgery", label: "Surgery or fracture in the last 6 months", flag: true },
      { id: "bp", label: "High or very low blood pressure", flag: false },
      { id: "meds", label: "Daily medication (tell us which)", flag: false },
      { id: "none", label: "None of these", flag: false },
    ],
    contact: [{ id: "whatsapp", label: "WhatsApp" }, { id: "email", label: "Email" }],
    time: [{ id: "morning", label: "Mornings" }, { id: "afternoon", label: "Afternoons" }, { id: "evening", label: "Evenings" }, { id: "any", label: "Any time" }],
  };
  const label = (group, id) => (OPTIONS[group].find((o) => o.id === id) || {}).label || id;
  const flagged = (health = []) => health.filter((h) => OPTIONS.health.find((o) => o.id === h && o.flag));

  /* ---------- body map (back view) ---------- */
  const PARTS = {
    neck: "M92 60 h16 v18 h-16z", shoulder_l: "M52 80 q20 -8 40 0 v16 h-40z", shoulder_r: "M108 80 q20 -8 40 0 v16 h-40z",
    upper_back: "M70 96 h60 v28 h-60z", mid_back: "M72 124 h56 v30 h-56z", lower_back: "M74 154 h52 v26 h-52z",
    arm_l: "M40 96 h18 v70 h-18z", arm_r: "M142 96 h18 v70 h-18z", hips: "M70 180 h60 v30 h-60z",
    thigh_l: "M72 210 h26 v60 h-26z", thigh_r: "M102 210 h26 v60 h-26z", calf_l: "M74 272 h22 v56 h-22z", calf_r: "M104 272 h22 v56 h-22z",
    face: "M84 18 a16 18 0 1 0 32 0 a16 18 0 1 0 -32 0",
  };
  function bodyMap(selected = [], interactive = false) {
    const s = new Set(selected);
    return `<svg class="bodymap${interactive ? " interactive" : ""}" viewBox="30 0 140 340" role="${interactive ? "group" : "img"}" aria-label="Body map, back view">
      <path d="M100 0 a16 18 0 1 0 0.1 0 M92 36 v24 M60 80 q40 -14 80 0 v100 h-80z" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.5"/>
      ${Object.entries(PARTS).map(([id, d]) => `<path data-part="${id}" class="part${s.has(id) ? " on" : ""}" d="${d}"><title>${label("pain", id)}</title></path>`).join("")}
      <text x="100" y="336" text-anchor="middle" class="bm-caption">back view · tap where it hurts</text>
    </svg>`;
  }

  /* ---------- advice ---------- */
  function serviceKey(serviceName = "") {
    const n = serviceName.toLowerCase();
    if (n.includes("hijama") || n.includes("wet")) return "hijama";
    if (n.includes("fire")) return "fire";
    if (n.includes("facial")) return "facial";
    if (n.includes("manual")) return "manual";
    return "cupping";
  }
  const ADVICE = {
    before: {
      general: [
        "Eat something light 1–2 hours before. Not on an empty stomach, not straight after a big meal.",
        "Drink water through the day. Hydrated tissue responds better and marks fade faster.",
        "No alcohol the evening before or the day of your session.",
        "Skip a hard workout on the day; a gentle walk is fine.",
        "Come with clean skin: no lotion, oil or sun cream where the cups will go.",
        "Wear something loose. For a back session you'll be face down with a towel; shorts are enough for legs.",
        "Tell your therapist about anything new: medication, pain, an injury, pregnancy, a bad night's sleep.",
        "Arrive five minutes early and use the bathroom first, so the session is unhurried.",
      ],
      hijama: [
        "Don't eat for 2–3 hours before. Water is fine, and encouraged.",
        "Mornings are best, ideally before heavy activity.",
        "No blood-thinning medication or aspirin that day unless your doctor says otherwise. Tell us if you take any.",
        "If you're fasting for religious reasons, talk to us first so we can time it well.",
        "Bring a small snack for after: dates, fruit, a sandwich.",
      ],
      fire: ["Fire cupping uses a flame for a second to warm the cup. Nothing touches your skin but the glass. Skip it if you have very sensitive skin or open wounds."],
      facial: ["Arrive with a clean face, no make-up. Contact lenses out if you find them uncomfortable lying down."],
      manual: ["Nothing special: come as you are, with clean skin and loose clothes."],
      cupping: [],
    },
    after: {
      general: [
        "Drink more water than usual for the rest of the day.",
        "Keep the treated area warm and covered. No cold showers, sauna, steam, swimming or ice for 24 hours. A warm shower after 3–4 hours is fine.",
        "Take it easy: no heavy training, alcohol or big meals for 24 hours. Rest, a light meal and an early night work best.",
        "Some tiredness, mild soreness or a light head in the first hours is normal. Sit down, drink water, eat something.",
        "Don't scratch the marks. Leave them uncovered by sun and don't put strong creams on them the first day.",
        "The marks are not bruises: nothing struck you. They fade in 3–10 days. Darker usually means the area needed it more.",
      ],
      hijama: [
        "Keep the small cuts clean and dry for 24 hours; don't swim or bathe them. A shower after 24 hours with warm water is fine.",
        "Eat well after: a proper meal within an hour, ideally with iron-rich food (eggs, meat, lentils, spinach).",
        "No sport, sauna or sun for 24–48 hours.",
        "A little oozing for a few hours is normal. Bleeding that doesn't stop, fever or spreading redness is not: message us and see a doctor.",
      ],
      fire: ["Warmth stays in the area for an hour or two. That's the point. Keep it covered."],
      facial: ["No marks expected. Skin will be flushed for an hour. Skip make-up until the evening; moisturise gently."],
      manual: ["Move gently through the day. Mild soreness the next morning is normal and passes by the afternoon."],
      cupping: [],
    },
    dayAfter: [
      "Gentle movement helps: a walk, easy mobility, a slow swim only after 24 hours.",
      "Back to training the day after, at 70%. Full intensity two days after.",
      "If the marks itch, a light unscented moisturiser after the first 24 hours is fine.",
      "Notice what changed: sleep, range of movement, the pain level. Tell your therapist next time; it decides where the cups go.",
    ],
    skip: [
      "Fever, flu, or an active infection.",
      "Open wounds, rashes, sunburn or eczema where the cups would go.",
      "Pregnancy: no cupping on the abdomen or lower back, and only with your doctor's okay.",
      "Blood thinners, haemophilia or serious anaemia: talk to your doctor first and tell us.",
      "Within 48 hours of surgery, a fracture, or a bad fall.",
      "You've had alcohol today.",
    ],
    between: [
      "While something is bothering you: once every 1–2 weeks.",
      "For maintenance and training recovery: every 3–4 weeks.",
      "Hijama: not more than once a month, and not in the same spots back to back.",
      "Every 10th session with us is free; your account keeps the tally.",
    ],
  };
  function list(kind, key) {
    const items = kind === "before" || kind === "after" ? [...ADVICE[kind].general, ...(ADVICE[kind][key] || [])] : ADVICE[kind];
    return `<ul class="advice">${items.map((t) => `<li>${t}</li>`).join("")}</ul>`;
  }
  const SERVICE_LABEL = { hijama: "Hijama", fire: "Fire cupping", facial: "Facial cupping", manual: "Manual therapy", cupping: "Cupping" };

  /* ---------- simple exercises per focus area (between sessions) ---------- */
  const EXERCISES = {
    neck: ["Chin tucks: sit tall, draw the chin straight back (make a double chin), hold 5 seconds. 10 times.", "Slow neck circles, half circles only, front side to side. 5 each way."],
    shoulder_l: ["Doorway chest stretch: forearms on the frame, step through until you feel the front of the shoulders. 30 seconds, 3 times.", "Shoulder rolls, backwards, slow and big. 10."],
    shoulder_r: ["Doorway chest stretch: forearms on the frame, step through until you feel the front of the shoulders. 30 seconds, 3 times.", "Shoulder rolls, backwards, slow and big. 10."],
    upper_back: ["Cat-cow on hands and knees: round the back, then let it sag, breathing with it. 10 slow rounds.", "Thread the needle: on all fours, slide one arm under the other and rest the shoulder down. 30 seconds each side."],
    mid_back: ["Cat-cow on hands and knees: round the back, then let it sag, breathing with it. 10 slow rounds.", "Thread the needle: on all fours, slide one arm under the other and rest the shoulder down. 30 seconds each side."],
    lower_back: ["Knees to chest, lying on your back, one at a time then both. 30 seconds each.", "Glute bridge: feet flat, lift the hips, squeeze at the top, lower slowly. 12, twice."],
    hips: ["Figure-four stretch: ankle on the opposite knee, pull the leg toward you. 30 seconds each side.", "Hip flexor lunge: back knee down, tuck the pelvis, lean forward gently. 30 seconds each side."],
    thigh_l: ["Standing quad stretch: heel to glute, knees together. 30 seconds each side.", "Hamstring stretch: heel on a low step, hinge forward with a flat back. 30 seconds each side."],
    thigh_r: ["Standing quad stretch: heel to glute, knees together. 30 seconds each side.", "Hamstring stretch: heel on a low step, hinge forward with a flat back. 30 seconds each side."],
    calf_l: ["Calf stretch against a wall, back leg straight then slightly bent. 30 seconds each, both legs.", "Slow calf raises on a step, pause at the top, lower below the step. 15, twice."],
    calf_r: ["Calf stretch against a wall, back leg straight then slightly bent. 30 seconds each, both legs.", "Slow calf raises on a step, pause at the top, lower below the step. 15, twice."],
    arm_l: ["Wrist and forearm stretch: arm straight, palm up, gently pull the fingers back. 20 seconds each."],
    arm_r: ["Wrist and forearm stretch: arm straight, palm up, gently pull the fingers back. 20 seconds each."],
    face: ["Jaw release: tongue on the roof of the mouth, let the jaw hang, breathe through the nose for a minute."],
  };
  function exercisesFor(pain = []) { const seen = new Set(); const out = []; pain.forEach((p) => (EXERCISES[p] || []).forEach((e) => { if (!seen.has(e)) { seen.add(e); out.push({ area: p, text: e }); } })); return out; }

  return { CITY_NAME, EGYPT_SUGGEST, ITALY_SUGGEST, recommend, OPTIONS, label, flagged, bodyMap, PARTS, serviceKey, SERVICE_LABEL, ADVICE, list, EXERCISES, exercisesFor };
})();
