// Shared helpers for worker.js, features.js and cron.js.
import { CITIES, PLATFORM_FEE_BPS } from "./catalog.js";
import { randomId, referralCode, signPayload, verifyPayload, getCookie, setCookie } from "./auth.js";

export const CITY_KEYS = Object.keys(CITIES);
export const USER_COOKIE = "zen_s", ADMIN_COOKIE = "zen_a";
export const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
export const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
export const normEmail = (e) => clean(e, 120).toLowerCase();
export const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
export const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || "");
export const fmt = (minor, cur) => new Intl.NumberFormat("en", { style: "currency", currency: cur.toUpperCase(), maximumFractionDigits: cur === "egp" ? 0 : 2 }).format(minor / 100);
export const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const feeOn = (amount) => Math.round((amount * PLATFORM_FEE_BPS) / 10000);
export const body = async (req) => (await req.json().catch(() => null)) || {};
export const isLive = (env) => Boolean(env.STRIPE_SECRET_KEY && env.ZEN_STRIPE_ACCOUNT);
export const FLAGS = ["pregnant", "anticoagulant", "bleeding", "heart", "diabetes", "skin", "surgery"];
export function parseIntake(t) { try { return t ? JSON.parse(t) : null; } catch { return null; } }
export function healthFlags(intakeText) { const i = parseIntake(intakeText); return i?.health ? i.health.filter((h) => FLAGS.includes(h)) : []; }

export async function settings(env) {
  const rows = (await env.DB.prepare("SELECT key, value FROM settings").all()).results;
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { loyalty_every: Number(s.loyalty_every || 10), referral_pct: Number(s.referral_pct || 40), birthday_pct: Number(s.birthday_pct || 20), package_pct: Number(s.package_pct || 15),
    platform_fee_pct: PLATFORM_FEE_BPS / 100, gmaps: { cairo: s.gmaps_cairo || "", dahab: s.gmaps_dahab || "", florence: s.gmaps_florence || "" }, whatsapp: { cairo: s.wa_cairo || "", dahab: s.wa_dahab || "", florence: s.wa_florence || "" },
    review: { cairo: s.review_cairo || "", dahab: s.review_dahab || "", florence: s.review_florence || "" } };
}
export async function currentUser(req, env) {
  const t = await verifyPayload(env.SESSION_SECRET, getCookie(req, USER_COOKIE));
  if (!t?.uid) return null;
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(t.uid).first();
}
export async function currentAdmin(req, env) {
  const t = await verifyPayload(env.SESSION_SECRET, getCookie(req, ADMIN_COOKIE));
  if (!t?.aid) return null;
  return env.DB.prepare("SELECT * FROM admins WHERE id = ?").bind(t.aid).first();
}
// New account: referral credit for the invitee, adopt guest bookings made with the same email.
export async function createUser(env, { email, name, ref, city, lang, google_sub, apple_sub, photo }) {
  let referrer = null;
  if (ref) referrer = await env.DB.prepare("SELECT id, name FROM users WHERE referral_code = ?").bind(clean(ref, 12).toUpperCase()).first();
  const id = randomId();
  await env.DB.prepare("INSERT INTO users (id, email, name, city, referral_code, referred_by, lang, google_sub, apple_sub, photo) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(id, email, name, CITY_KEYS.includes(city) ? city : null, referralCode(), referrer?.id || null, ["en", "it", "ar"].includes(lang) ? lang : null, google_sub || null, apple_sub || null, photo || null).run();
  await env.DB.prepare("UPDATE bookings SET user_id = ? WHERE user_id IS NULL AND email = ?").bind(id, email).run();
  if (referrer) {
    const s = await settings(env);
    await env.DB.prepare("INSERT INTO credits (id, user_id, kind, pct, reason) VALUES (?,?,?,?,?)").bind(randomId(), id, "referral", s.referral_pct, `Invited by ${referrer.name}`).run();
  }
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
}
export async function sessionCookieFor(env, userId) {
  await env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(now(), userId).run();
  return setCookie(USER_COOKIE, await signPayload(env.SESSION_SECRET, { uid: userId, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }), 30 * 86400);
}
// The one place city access is decided for admins. Returns the city an admin may see (null = all).
export function scope(admin, requested) { if (admin.role !== "all") return admin.role; return CITY_KEYS.includes(requested) ? requested : null; }

export async function sendEmail(env, { to, subject, text }) {
  if (!env.RESEND_API_KEY || !to) return false;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, text }) });
  if (!r.ok) console.error("resend error", await r.text());
  return r.ok;
}
// WhatsApp Cloud API (Meta). Needs WA_TOKEN + WA_PHONE_ID and approved templates; otherwise returns false and callers fall back to email.
export async function sendWhatsApp(env, { to, template, params = [], lang = "en" }) {
  if (!env.WA_TOKEN || !env.WA_PHONE_ID || !to || !template) return false;
  const phone = String(to).replace(/\D/g, "");
  const r = await fetch(`https://graph.facebook.com/v20.0/${env.WA_PHONE_ID}/messages`, { method: "POST", headers: { authorization: `Bearer ${env.WA_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "template", template: { name: template, language: { code: lang === "ar" ? "ar" : lang === "it" ? "it" : "en" }, components: params.length ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p) })) }] : [] } }) });
  if (!r.ok) console.error("whatsapp error", await r.text());
  return r.ok;
}
// Twilio SMS. Needs TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM.
export async function sendSms(env, { to, text }) {
  if (!env.TWILIO_SID || !env.TWILIO_TOKEN || !env.TWILIO_FROM || !to) return false;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`, { method: "POST", headers: { authorization: "Basic " + btoa(`${env.TWILIO_SID}:${env.TWILIO_TOKEN}`), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ To: "+" + String(to).replace(/\D/g, ""), From: env.TWILIO_FROM, Body: text }) });
  if (!r.ok) console.error("twilio error", await r.text());
  return r.ok;
}
export async function logMessage(env, { user_id, booking_id, kind, channel, status, detail }) {
  await env.DB.prepare("INSERT INTO messages (id, user_id, booking_id, kind, channel, status, detail) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID().replace(/-/g, "").slice(0, 24), user_id || null, booking_id || null, kind, channel, status || "sent", clean(detail, 300)).run();
}

// Stripe Checkout Session on Zen's connected account with the platform fee. Returns { url, id } or throws.
export async function stripeCheckout(env, { amount, currency, name, description, email, success, cancel, metadata = {} }) {
  const params = new URLSearchParams();
  params.set("mode", "payment"); if (email) params.set("customer_email", email);
  params.set("success_url", success); params.set("cancel_url", cancel);
  params.set("expires_at", String(Math.floor(Date.now() / 1000) + 30 * 60));
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", currency);
  params.set("line_items[0][price_data][unit_amount]", String(amount));
  params.set("line_items[0][price_data][product_data][name]", name);
  if (description) params.set("line_items[0][price_data][product_data][description]", description);
  params.set("payment_intent_data[application_fee_amount]", String(feeOn(amount)));
  params.set("payment_intent_data[description]", name);
  for (const [k, v] of Object.entries(metadata)) { params.set(`metadata[${k}]`, String(v)); params.set(`payment_intent_data[metadata][${k}]`, String(v)); }
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Stripe-Account": env.ZEN_STRIPE_ACCOUNT, "content-type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20" }, body: params });
  const s = await r.json();
  if (!r.ok) { console.error("stripe error", s); throw new Error("Stripe couldn't start the payment. Please try again or message Zen on WhatsApp."); }
  return { url: s.url, id: s.id };
}

// ---------- availability → free slots ----------
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
export async function slotsFor(env, city, date, therapistId) {
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();
  const rules = (await env.DB.prepare("SELECT * FROM availability WHERE city = ? AND weekday = ?" + (therapistId ? " AND (therapist_id = ? OR therapist_id IS NULL)" : "")).bind(...[city, weekday, ...(therapistId ? [therapistId] : [])]).all()).results;
  const configured = (await env.DB.prepare("SELECT COUNT(*) n FROM availability WHERE city = ?").bind(city).first()).n > 0;
  if (!configured) return { mode: "windows", slots: [] };
  const blocked = (await env.DB.prepare("SELECT * FROM blocked WHERE city = ? AND date = ?").bind(city, date).all()).results;
  const taken = (await env.DB.prepare("SELECT slot, therapist_id FROM bookings WHERE city = ? AND date = ? AND status IN ('paid','confirmed','done','review')").bind(city, date).all()).results;
  const therapists = (await env.DB.prepare("SELECT id FROM therapists WHERE city = ? AND active = 1").bind(city).all()).results.map((t) => t.id);
  const out = new Map();
  for (const r of rules) {
    const who = r.therapist_id ? [r.therapist_id] : therapists.length ? therapists : [null];
    for (let m = toMin(r.start); m + (r.slot_minutes || 60) <= toMin(r.end); m += r.slot_minutes || 60) {
      const t = toHHMM(m);
      const isBlocked = blocked.some((b) => (!b.therapist_id || who.includes(b.therapist_id)) && (!b.start || (m >= toMin(b.start) && m < toMin(b.end || "23:59"))));
      if (isBlocked && blocked.some((b) => !b.therapist_id && (!b.start || (m >= toMin(b.start) && m < toMin(b.end || "23:59"))))) continue;
      const free = who.filter((th) => !taken.some((k) => k.slot === t && (!k.therapist_id || !th || k.therapist_id === th)) && !blocked.some((b) => b.therapist_id === th && (!b.start || (m >= toMin(b.start) && m < toMin(b.end || "23:59")))));
      if (free.length && (!therapistId || free.includes(therapistId))) out.set(t, [...new Set([...(out.get(t) || []), ...free])]);
    }
  }
  if (date === today()) { const nowMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes() + 60; for (const t of [...out.keys()]) if (toMin(t) < nowMin) out.delete(t); }
  return { mode: "slots", slots: [...out.entries()].sort().map(([time, th]) => ({ time, therapists: th.filter(Boolean) })) };
}
