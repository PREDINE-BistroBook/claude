/* Zen Recovery — shared by every public page: config, helpers, status/catalog/me fetches, nav, reveal, dialog.
   Page scripts (home.js, booking.js, gift.js) subscribe with Zen.on("status" | "catalog" | "me" | "lang", fn). */
/* ---------- site config (fallback for the preview; the live list comes from /api/catalog) ---------- */
/* Keep the service ids and prices in sync with src/catalog.js (the Worker never trusts the browser's price). */
const PREVIEW = false;
const CITIES = {
  cairo: {
    name: "Cairo", currency: "EGP", locale: "en-EG", tz: "Africa/Cairo",
    address: ["Zen Recovery · Cairo", "Studio address to confirm", "Cairo, Egypt"],
    team: "Shaarawy — manual therapy & cupping",
    whatsapp: "201145638166",
    services: [
      { id: "cai-man",   name: "Manual therapy",    dur: 60, price: 100000, desc: "Deep tissue and sports massage, hands only." },
      { id: "cai-dry",   name: "Dry cupping",       dur: 45, price: 90000,  desc: "Cups placed and left still. The classic session." },
      { id: "cai-slide", name: "Sliding cupping",   dur: 60, price: 120000, desc: "Oiled skin, gliding cups. Massage with the lift built in." },
      { id: "cai-fire",  name: "Fire cupping",      dur: 45, price: 100000, desc: "Glass cups, a flash of flame, deeper warmth." },
      { id: "cai-hij",   name: "Hijama",            dur: 60, price: 110000, desc: "Wet cupping with sterile single-use equipment." },
      { id: "cai-face",  name: "Facial cupping",    dur: 30, price: 70000,  desc: "Light, gliding, no marks." }
    ]
  },
  dahab: {
    name: "Dahab", currency: "EGP", locale: "en-EG", tz: "Africa/Cairo",
    address: ["Zen Recovery · Dahab", "Exact spot to confirm", "Dahab, South Sinai"],
    team: "Shaarawy — manual therapy & cupping",
    whatsapp: "201145638166",
    services: [
      { id: "dah-man",   name: "Manual therapy",    dur: 60, price: 100000, desc: "Deep tissue and sports massage, hands only." },
      { id: "dah-dry",   name: "Dry cupping",       dur: 45, price: 90000,  desc: "Cups placed and left still. The classic session." },
      { id: "dah-slide", name: "Sliding cupping",   dur: 60, price: 120000, desc: "Oiled skin, gliding cups. Good after a day of diving or climbing." },
      { id: "dah-fire",  name: "Fire cupping",      dur: 45, price: 100000, desc: "Glass cups, a flash of flame, deeper warmth." },
      { id: "dah-face",  name: "Facial cupping",    dur: 30, price: 70000,  desc: "Light, gliding, no marks." }
    ]
  },
  florence: {
    name: "Florence", currency: "EUR", locale: "it-IT", tz: "Europe/Rome",
    address: ["Zen Recovery · Florence", "Street and number to confirm", "Firenze"],
    team: "Zen Recovery Florence — name to confirm",
    whatsapp: "",
    services: [
      { id: "flo-man",   name: "Manual therapy",    dur: 60, price: 6000, desc: "Deep tissue and sports massage, hands only." },
      { id: "flo-dry",   name: "Dry cupping",       dur: 45, price: 5500, desc: "Cups placed and left still. The classic session." },
      { id: "flo-slide", name: "Sliding cupping",   dur: 60, price: 7000, desc: "Oiled skin, gliding cups. Massage with the lift built in." },
      { id: "flo-fire",  name: "Fire cupping",      dur: 45, price: 6500, desc: "Glass cups, a flash of flame, deeper warmth." },
      { id: "flo-face",  name: "Facial cupping",    dur: 30, price: 4500, desc: "Light, gliding, no marks." }
    ]
  }
};
const SLOT_LABEL = { morning: "Morning (9–12)", afternoon: "Afternoon (12–17)", evening: "Evening (17–20)" };


/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const I = window.ZenI18n, t = (s, v) => I.t(s, v);
const LOCALE = () => ({ en: "en-GB", it: "it-IT", ar: "ar-EG" }[I.lang]);
const money = (minor, cur) => new Intl.NumberFormat(LOCALE(), { style: "currency", currency: cur, maximumFractionDigits: cur === "EGP" ? 0 : 2 }).format(minor / 100);
const H = {};
window.Zen = { on(ev, fn) { (H[ev] ||= []).push(fn); }, emit(ev, d) { (H[ev] || []).forEach((f) => { try { f(d); } catch (e) { console.error(e); } }); } };
$("#lang-slot").innerHTML = I.switcher();
// rewards numbers (home + rewards page); harmless where the elements don't exist
function applySettings(st) {
  if (st) Object.assign(ZenGuide.SETTINGS, st);
  const n = ZenGuide.SETTINGS.loyalty_every, pct = ZenGuide.SETTINGS.referral_pct, bd = ZenGuide.SETTINGS.birthday_pct || 50;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("#rw-every", n); set("#rw-suffix", I.ordSuffix(n)); set("#rw-pct", pct); set("#rw-bday", bd);
  set("#rw-loyalty-title", t("Every {nth} session is free.", { nth: I.ordinal(n) }));
  set("#rw-invite-title", t("Invite a friend: {pct}% off, for both of you.", { pct }));
  set("#rw-bday-title", t("Your birthday: {pct}% off one session.", { pct: bd }));
}
let ST = { settings: {}, gmaps: {}, whatsapp: {}, review: {} };
// Services, prices, addresses and team lines come from the admin (D1). The CITIES above is the fallback for the preview build.
fetch("/api/catalog").then(r => (r.headers.get("content-type") || "").includes("json") ? r.json() : null).then(d => {
  if (!d?.cities) return;
  for (const [k, c] of Object.entries(d.cities)) { if (!CITIES[k]) continue; if (c.services?.length) CITIES[k].services = c.services; if (c.address?.length) CITIES[k].address = c.address; if (c.team) CITIES[k].team = c.team; if (c.whatsapp) CITIES[k].whatsapp = c.whatsapp; }
  Zen.emit("catalog", d);
}).catch(() => {});
fetch("/api/status").then(r => (r.headers.get("content-type") || "").includes("json") ? r.json() : {}).then(s => { ST = { ...ST, ...s }; applySettings(s.settings); Zen.emit("status", ST); }).catch(() => applySettings());
document.addEventListener("zen:lang", () => { applySettings(); Zen.emit("lang", I.lang); });
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
document.documentElement.classList.add("js");
$("#year").textContent = new Date().getFullYear();
$("#preview").hidden = !PREVIEW;
const setBanner = () => document.documentElement.style.setProperty("--banner-h", (PREVIEW ? $("#preview").offsetHeight : 0) + "px");
setBanner(); addEventListener("resize", setBanner);

/* ---------- nav shadow ---------- */
addEventListener("scroll", () => $("#nav").classList.toggle("scrolled", scrollY > 8), { passive: true });

/* ---------- reveal on enter ---------- */
const io = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .15, rootMargin: "0px 0px -8% 0px" });
$$(".reveal").forEach((el, i) => { el.style.transitionDelay = (i % 5) * 60 + "ms"; io.observe(el); });

/* ---------- signed-in client: name in the nav, preferred language ---------- */
let ME = null;
fetch("/api/me", { credentials: "same-origin" }).then(r => (r.headers.get("content-type") || "").includes("json") ? r.json() : { user: null }).then(d => {
  if (!d.user) return; ME = d;
  const first = d.user.name.split(" ")[0];
  $("#nav-account").classList.add("user"); $("#nav-account").innerHTML = `<span class="av">${d.user.photo ? `<img src="${d.user.photo}" alt="">` : first.slice(0, 2).toUpperCase()}</span><span>${first}</span>`; $("#nav-account").title = t("Your sessions, rewards and guide");
  if (d.user.lang && d.user.lang !== I.lang && !new URLSearchParams(location.search).get("lang")) I.set(d.user.lang);
  applySettings({ loyalty_every: d.settings.loyalty_every, referral_pct: d.settings.referral_pct, birthday_pct: d.settings.birthday_pct });
  Zen.emit("me", d);
}).catch(() => {});

/* ---------- small dialog ---------- */
const dlg = $("#dlg");
$("#dlg-close").addEventListener("click", () => dlg.close());
function tell(title, body) { $("#dlg-title").textContent = title; $("#dlg-body").textContent = body; dlg.showModal(); }
