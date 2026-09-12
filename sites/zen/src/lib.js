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
// Services come from the D1 `services` table (editable in the admin); src/catalog.js is only the seed/fallback.
// Shape matches the old static catalog: { cairo: { name, currency, tz, services: { id: { name, amount, minutes, description } } } }
// Names are built as "Dry cupping · 45 min · Cairo" so bookings keep the same service_name convention.
export async function catalog(env, { all = false } = {}) {
  const out = {}; for (const k of CITY_KEYS) out[k] = { ...CITIES[k], services: {} };
  let rows = [];
  try { rows = (await env.DB.prepare("SELECT * FROM services" + (all ? "" : " WHERE active = 1") + " ORDER BY city, sort, name").all()).results; } catch (e) { console.error("services table missing, using static catalog", e.message); }
  if (!rows.length) { for (const k of CITY_KEYS) for (const [id, s] of Object.entries(CITIES[k].services)) out[k].services[id] = { id, name: s.name, amount: s.amount, minutes: 60, description: "", active: 1, sort: 0, short: s.name.split(" · ")[0] }; return out; }
  for (const r of rows) { if (!out[r.city]) continue; out[r.city].services[r.id] = { id: r.id, name: `${r.name} · ${r.minutes} min · ${CITIES[r.city].name}`, short: r.name, amount: r.amount, minutes: r.minutes, description: r.description || "", active: r.active, sort: r.sort, photo: r.photo || null, updated_at: r.updated_at || "" }; }
  return out;
}
export async function serviceOf(env, city, id) { if (!CITY_KEYS.includes(city) || !id) return null; const c = await catalog(env); return c[city].services[id] || null; }
// Who hears about a new booking / gift / pack in a city: ZEN_NOTIFY_EMAIL plus every admin who asked for it (owner: everything).
export async function notifyList(env, city) {
  const rows = (await env.DB.prepare("SELECT email FROM admins WHERE notify = 1 AND email LIKE '%@%' AND (role IN ('all','platform') OR role = ?)").bind(city || "").all()).results;
  return [...new Set([env.ZEN_NOTIFY_EMAIL, ...rows.map((r) => r.email)].filter(Boolean))];
}
// Photos are stored as data URLs. Only a clean base64 image is accepted, so nothing can break out of an <img src="…"> in the admin.
export function validPhoto(v, max = 160000) { return typeof v === "string" && v.length < max && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(v) ? v : null; }
// "Now" in a city's own time zone: the local date and minutes since midnight (slots for today, "that day has passed").
export function localNow(tz) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t)?.value || "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: (Number(g("hour")) % 24) * 60 + Number(g("minute")) };
}
export const FLAGS = ["pregnant", "anticoagulant", "bleeding", "heart", "diabetes", "skin", "surgery"];
export function parseIntake(t) { try { return t ? JSON.parse(t) : null; } catch { return null; } }
export function healthFlags(intakeText) { const i = parseIntake(intakeText); return i?.health ? i.health.filter((h) => FLAGS.includes(h)) : []; }

export async function settings(env) {
  const rows = (await env.DB.prepare("SELECT key, value FROM settings").all()).results;
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { loyalty_every: Number(s.loyalty_every || 10), referral_pct: Number(s.referral_pct || 40), birthday_pct: Number(s.birthday_pct || 50), package_pct: Number(s.package_pct || 15),
    platform_fee_pct: PLATFORM_FEE_BPS / 100, gmaps: { cairo: s.gmaps_cairo || "", dahab: s.gmaps_dahab || "", florence: s.gmaps_florence || "" }, whatsapp: { cairo: s.wa_cairo || "", dahab: s.wa_dahab || "", florence: s.wa_florence || "" },
    review: { cairo: s.review_cairo || "", dahab: s.review_dahab || "", florence: s.review_florence || "" },
    address: { cairo: s.addr_cairo || "", dahab: s.addr_dahab || "", florence: s.addr_florence || "" }, team: { cairo: s.team_cairo || "", dahab: s.team_dahab || "", florence: s.team_florence || "" } };
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
// First sign-in through Google/Apple: no magic link was sent, so this is the client's first email from us.
export async function welcomeEmail(env, user) {
  const first = (user.name || "").split(" ")[0] || "there";
  return sendEmail(env, { to: user.email, subject: "Welcome to Zen Recovery", text: [`Hi ${first},`, ``, `Your Zen Recovery account is ready. Cupping, manual therapy and recovery in Cairo, Dahab and Florence.`, ``, `What's in your account: ${env.SITE_URL}/account`, `· two minutes of questions so we know which room is nearest and how to work with your body`, `· your sessions, before/after advice, and a progress check-in`, `· rewards: every few sessions one is free, and your friends get a discount through your invite link`, ``, `Book a session: ${env.SITE_URL}/booking`, ``, `See you on the table,`, `Zen Recovery`].join("\n") });
}
export async function sessionCookieFor(env, userId) {
  await env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(now(), userId).run();
  return setCookie(USER_COOKIE, await signPayload(env.SESSION_SECRET, { uid: userId, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }), 30 * 86400);
}
// Roles: "platform" = Locali & Ordinazioni (Ash): numbers, payments, the 2%, who's signed in — nothing operational.
//        "all"      = Zen's owner: everything, every city.   "cairo" | "dahab" | "florence" = one city's team.
export const isPlatform = (a) => a.role === "platform";
export const isOwner = (a) => a.role === "all";
export const seesAll = (a) => a.role === "all" || a.role === "platform";
// The one place city access is decided for admins. Returns the city an admin may see (null = all).
export function scope(admin, requested) { if (!seesAll(admin)) return admin.role; return CITY_KEYS.includes(requested) ? requested : null; }

// Every email goes out as plain text plus a simple HTML version with the logo on top (same words, links clickable).
const escHtml = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function emailHtml(env, text) {
  const body = text.split("\n").map((l) => escHtml(l).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#2F7BEA">$1</a>') || "&nbsp;").join("<br>");
  return `<!doctype html><html><body style="margin:0;background:#EDEEEA;padding:24px 12px;font-family:Figtree,Segoe UI,Helvetica,Arial,sans-serif;color:#1B1E1D">
<div style="max-width:560px;margin:0 auto;background:#F7F7F5;border:1px solid #d9dbd6;border-radius:18px;overflow:hidden">
<div style="background:#000;padding:22px;text-align:center"><a href="${env.SITE_URL}"><img src="${env.SITE_URL}/img/logo-email.png" alt="Zen Recovery" width="120" height="120" style="display:inline-block;border:0"></a></div>
<div style="padding:24px 26px;font-size:16px;line-height:1.55">${body}</div>
<div style="padding:14px 26px 22px;font-size:12px;color:#8B928F;border-top:1px solid #e3e5e0">Zen Recovery · Cairo · Dahab · Florence · <a href="${env.SITE_URL}" style="color:#8B928F">zenrecovery.club</a></div>
</div></body></html>`;
}
export async function sendEmail(env, { to, subject, text }) {
  const list = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean))];
  if (!env.RESEND_API_KEY || !list.length) return false;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: env.FROM_EMAIL, to: list, subject, text, html: emailHtml(env, text) }) });
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

// ---------- rewards: the inviter's discount on a friend's first booking, the free session every Nth done ----------
export async function maybeRewardReferrer(env, userId) {
  if (!userId) return;
  const u = await env.DB.prepare("SELECT id, name, referred_by FROM users WHERE id = ?").bind(userId).first();
  if (!u?.referred_by) return;
  const paidCount = await env.DB.prepare("SELECT COUNT(*) n FROM bookings WHERE user_id = ? AND status IN ('paid','confirmed','done')").bind(userId).first();
  if (paidCount.n !== 1) return; // only the friend's first booking rewards the inviter
  const already = await env.DB.prepare("SELECT 1 FROM credits WHERE user_id = ? AND reason = ?").bind(u.referred_by, `ref:${userId}`).first();
  if (already) return;
  const s = await settings(env);
  await env.DB.prepare("INSERT INTO credits (id, user_id, kind, pct, reason) VALUES (?,?,?,?,?)").bind(randomId(), u.referred_by, "referral", s.referral_pct, `ref:${userId}`).run();
  const ref = await env.DB.prepare("SELECT email, name FROM users WHERE id = ?").bind(u.referred_by).first();
  await sendEmail(env, { to: ref.email, subject: `${u.name} booked with Zen — your ${s.referral_pct}% is ready`, text: [`Hi ${ref.name},`, ``, `${u.name} just booked their first session with your invite. You've got ${s.referral_pct}% off your next session.`, ``, `Use it when you book: ${env.SITE_URL}/booking`, ``, `Zen Recovery`].join("\n") });
}
export async function maybeRewardLoyalty(env, userId) {
  if (!userId) return;
  const s = await settings(env);
  const done = await env.DB.prepare("SELECT COUNT(*) n FROM bookings WHERE user_id = ? AND status = 'done'").bind(userId).first();
  if (!done.n || done.n % s.loyalty_every !== 0) return;
  const reason = `Session ${done.n} — every ${s.loyalty_every}th is free`;
  const already = await env.DB.prepare("SELECT 1 FROM credits WHERE user_id = ? AND reason = ?").bind(userId, reason).first();
  if (already) return;
  await env.DB.prepare("INSERT INTO credits (id, user_id, kind, pct, reason) VALUES (?,?,?,?,?)").bind(randomId(), userId, "loyalty", 100, reason).run();
  const u = await env.DB.prepare("SELECT email, name FROM users WHERE id = ?").bind(userId).first();
  await sendEmail(env, { to: u.email, subject: "Your next Zen session is on us", text: [`Hi ${u.name},`, ``, `That was session number ${done.n}. The next one is free — pick a day whenever you like: ${env.SITE_URL}/booking`, ``, `Zen Recovery`].join("\n") });
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
  const ln = localNow(CITIES[city].tz); // in the city's own time, not UTC
  if (date < ln.date) return { mode: "slots", slots: [] };
  if (date === ln.date) { const cutoff = ln.minutes + 60; for (const t of [...out.keys()]) if (toMin(t) < cutoff) out.delete(t); }
  return { mode: "slots", slots: [...out.entries()].sort().map(([time, th]) => ({ time, therapists: th.filter(Boolean) })) };
}
