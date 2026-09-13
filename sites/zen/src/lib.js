// Shared helpers for worker.js, features.js and cron.js.
import { M } from "./mail.js";
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
/* ---------- Fawry (2026-09-13): card / wallet / Fawry-reference payments in Egypt, settled to an Egyptian bank account.
   Hosted checkout: we POST an init request, Fawry answers with the URL of its payment page; the client comes back on returnUrl and
   Fawry also POSTs a server notification. We never trust either alone: every settlement re-reads the order with Get Payment Status V2. ---------- */
export const fawryOn = (env) => Boolean(env.FAWRY_MERCHANT_CODE && env.FAWRY_SECURE_KEY);
export const fawryBase = (env) => (env.FAWRY_ENV === "production" ? "https://atfawry.com" : "https://atfawry.fawrystaging.com");
// which provider takes a payment in this currency: Fawry for EGP when it is set up, else Stripe when live, else nothing (preview)
export const payProvider = (env, currency) => (String(currency).toLowerCase() === "egp" && fawryOn(env) ? "fawry" : isLive(env) ? "stripe" : null);
export async function sha256hex(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const two = (minor) => (minor / 100).toFixed(2);
export async function fawryCheckout(env, { ref, amount, name, description, email, phone, customerName, returnUrl, lang }) {
  const price = two(amount), item = { itemId: ref, description: (description ? `${name} — ${description}` : name).slice(0, 200), price: Number(price), quantity: 1 };
  const signature = await sha256hex(env.FAWRY_MERCHANT_CODE + ref + "" + returnUrl + item.itemId + "1" + price + env.FAWRY_SECURE_KEY);
  const payload = { merchantCode: env.FAWRY_MERCHANT_CODE, merchantRefNum: ref, customerMobile: String(phone || "").replace(/[^\d+]/g, "") || "01000000000", customerEmail: email || undefined, customerName: customerName || undefined, customerProfileId: "", paymentExpiry: Date.now() + 30 * 60 * 1000, language: lang === "ar" ? "ar-eg" : "en-gb", chargeItems: [item], returnUrl, authCaptureModePayment: false, signature };
  const r = await fetch(`${fawryBase(env)}/fawrypay-api/api/payments/init`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/plain" }, body: JSON.stringify(payload) });
  const text = await r.text();
  let url = text.trim(); try { const j = JSON.parse(text); url = j.url || j.paymentUrl || j.redirectUrl || url; } catch {}
  if (!r.ok || !/^https?:\/\//.test(url)) { console.error("fawry init", r.status, text.slice(0, 300)); throw new Error("Fawry couldn't start the payment. Please try again or message Zen on WhatsApp."); }
  return { url, id: ref };
}
export async function fawryStatus(env, ref) {
  const signature = await sha256hex(env.FAWRY_MERCHANT_CODE + ref + env.FAWRY_SECURE_KEY);
  const r = await fetch(`${fawryBase(env)}/ECommerceWeb/Fawry/payments/status/v2?merchantCode=${encodeURIComponent(env.FAWRY_MERCHANT_CODE)}&merchantRefNumber=${encodeURIComponent(ref)}&signature=${signature}`, { headers: { accept: "application/json" } });
  const j = await r.json().catch(() => ({}));
  return { paid: r.ok && String(j.orderStatus || "").toUpperCase() === "PAID", status: j.orderStatus || null, fawryRef: j.fawryRefNumber || j.referenceNumber || null, amount: j.paymentAmount ?? j.orderAmount ?? null, method: j.paymentMethod || null, raw: j };
}
// server notification (V2, with the V1 shape accepted too): true when the message signature matches our secure key
export async function fawryNotificationValid(env, n) {
  const p = (v) => (v === undefined || v === null || v === "" ? "" : Number(v).toFixed(2));
  const v2 = await sha256hex(String(n.fawryRefNumber || "") + String(n.merchantRefNumber || "") + p(n.paymentAmount) + p(n.orderAmount) + String(n.orderStatus || "") + String(n.paymentMethod || "") + String(n.paymentRefrenceNumber || n.paymentReferenceNumber || "") + env.FAWRY_SECURE_KEY);
  const v1 = await sha256hex(String(n.fawryRefNumber || "") + String(n.merchantRefNumber || "") + p(n.paymentAmount) + String(n.orderStatus || "") + env.FAWRY_SECURE_KEY);
  const given = String(n.messageSignature || n.signature || "").toLowerCase();
  return given === v2 || given === v1;
}
// Services come from the D1 `services` table (editable in the admin); src/catalog.js is only the seed/fallback.
// Shape matches the old static catalog: { cairo: { name, currency, tz, services: { id: { name, amount, minutes, description } } } }
// Names are built as "Dry cupping · 45 min · Cairo" so bookings keep the same service_name convention.
export async function catalog(env, { all = false } = {}) {
  const out = {}; for (const k of CITY_KEYS) out[k] = { ...CITIES[k], services: {} };
  let rows = [];
  try { rows = (await env.DB.prepare("SELECT * FROM services" + (all ? "" : " WHERE active = 1") + " ORDER BY city, sort, name").all()).results; } catch (e) { console.error("services table missing, using static catalog", e.message); }
  if (!rows.length) { for (const k of CITY_KEYS) for (const [id, s] of Object.entries(CITIES[k].services)) out[k].services[id] = { id, name: s.name, amount: s.amount, minutes: 60, description: "", active: 1, sort: 0, short: s.name.split(" · ")[0] }; return out; }
  for (const r of rows) { if (!out[r.city]) continue; out[r.city].services[r.id] = { id: r.id, name: `${r.name} · ${r.minutes} min · ${CITIES[r.city].name}`, short: r.name, amount: r.amount, minutes: r.minutes, description: r.description || "", active: r.active, sort: r.sort, photo: r.photo || null, i18n: parseI18n(r.i18n), updated_at: r.updated_at || "" }; }
  return out;
}
// { service_id: { therapist_id: amount } } for a city's active therapists — a therapist's own price beats the city price when the client chose them
export async function therapistPrices(env, city) {
  const out = {}; let rows = [];
  try { rows = (await env.DB.prepare("SELECT p.therapist_id, p.service_id, p.amount FROM therapist_prices p JOIN therapists t ON t.id = p.therapist_id WHERE t.active = 1" + (city ? " AND t.city = ?" : "")).bind(...(city ? [city] : [])).all()).results; } catch (e) { console.error("therapist_prices", e.message); }
  for (const r of rows) (out[r.service_id] ||= {})[r.therapist_id] = r.amount;
  return out;
}
export const nameIn = (svc, lang, cityName) => { const n = (lang !== "en" && svc?.i18n?.[lang]?.name) || svc?.short || ""; return n ? `${n} · ${svc.minutes} min · ${cityName}` : svc?.name || ""; };
export async function serviceOf(env, city, id) { if (!CITY_KEYS.includes(city) || !id) return null; const c = await catalog(env); return c[city].services[id] || null; }
// Who hears about a new booking / gift / pack in a city: ZEN_NOTIFY_EMAIL (if set) plus every admin with a real email who asked for it
// (owner: every city; city admin: their city). The platform account (Amico Mio) never gets operational mail.
// With a therapistId: the owner(s) plus the account linked to that therapist only — the client chose them, the rest of the city needn't know.
// Without: every admin of the city, so someone can accept the unassigned booking.
export async function notifyList(env, city, therapistId) {
  const rows = therapistId
    ? (await env.DB.prepare("SELECT a.email FROM admins a LEFT JOIN therapists t ON t.admin_id = a.id WHERE a.notify = 1 AND a.email LIKE '%@%' AND a.role != 'platform' AND (a.role = 'all' OR t.id = ?)").bind(therapistId).all()).results
    : (await env.DB.prepare("SELECT email FROM admins WHERE notify = 1 AND email LIKE '%@%' AND role != 'platform' AND (role = 'all' OR role = ?)").bind(city || "").all()).results;
  return [...new Set([env.ZEN_NOTIFY_EMAIL, ...rows.map((r) => r.email)].filter(Boolean))];
}
// Profile texts in Italian and Arabic, by Workers AI (m2m100). Called after a therapist is saved and hourly for anything missing.
// Returns { it: {...}, ar: {...} } or null when the binding is missing / the model fails; the site then falls back to the original text.
const PROFILE_FIELDS = ["title", "bio", "story", "certs", "languages", "area"];
export const translateProfile = (env, row) => translateFields(env, row, PROFILE_FIELDS);
export const translateService = (env, row) => translateFields(env, row, ["name", "description"]);
export async function translateFields(env, row, fields) {
  if (!env.AI) return null;
  const out = { it: {}, ar: {} };
  for (const lang of ["it", "ar"]) for (const k of fields) {
    const src = String(row[k] || "").trim(); if (!src) { out[lang][k] = ""; continue; }
    const parts = src.split("\n"), done = [];
    for (const p of parts) { if (!p.trim()) { done.push(""); continue; } const r = await env.AI.run("@cf/meta/m2m100-1.2b", { text: p, source_lang: "english", target_lang: lang === "it" ? "italian" : "arabic" }); done.push(String(r?.translated_text || p).trim()); }
    out[lang][k] = done.join("\n");
  }
  return out;
}
export const parseI18n = (v) => { try { const o = typeof v === "string" ? JSON.parse(v) : v; return o && typeof o === "object" ? o : null; } catch { return null; } };
// The therapist profile an admin account is linked to (null for the owner unless linked, and for unlinked city accounts).
export async function therapistOf(env, admin) { return env.DB.prepare("SELECT id, name, city FROM therapists WHERE admin_id = ?").bind(admin.id).first(); }
// Which bookings a signed-in admin may see: the owner everything; anyone else only the ones assigned to them or not assigned to anyone yet.
export function visibleWhere(admin, th, col = "therapist_id") {
  if (managesCity(admin)) return { sql: "", args: [] };
  return th ? { sql: ` AND (${col} IS NULL OR ${col} = ?)`, args: [th.id] } : { sql: ` AND ${col} IS NULL`, args: [] };
}
export const canSeeBooking = (admin, th, bk) => managesCity(admin) || bk.therapist_id === null || bk.therapist_id === undefined || (th && bk.therapist_id === th.id);
// Photos are stored as data URLs. Only a clean base64 image is accepted, so nothing can break out of an <img src="…"> in the admin.
export function validPhoto(v, max = 160000) { return typeof v === "string" && v.length < max && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(v) ? v : null; }
// "Now" in a city's own time zone: the local date and minutes since midnight (slots for today, "that day has passed").
export function localNow(tz) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t)?.value || "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: (Number(g("hour")) % 24) * 60 + Number(g("minute")) };
}
// hours from now (city time) to the start of a booking: an exact HH:MM slot, or the start of the window (morning 9, afternoon 12, evening 17)
export function hoursUntil(bk) {
  const tz = CITIES[bk.city]?.tz || "UTC", nowL = localNow(tz);
  const start = /^\d\d:\d\d$/.test(bk.slot || "") ? Number(bk.slot.slice(0, 2)) * 60 + Number(bk.slot.slice(3)) : ({ morning: 9 * 60, afternoon: 12 * 60, evening: 17 * 60 }[bk.slot] ?? 9 * 60);
  const days = Math.round((Date.UTC(...bk.date.split("-").map(Number).map((v, i) => (i === 1 ? v - 1 : v))) - Date.UTC(...nowL.date.split("-").map(Number).map((v, i) => (i === 1 ? v - 1 : v)))) / 864e5);
  return (days * 1440 + start - nowL.minutes) / 60;
}
// what a cancellation costs now: { late, fee, refund } in minor units, from the owner's rules
export function cancelTerms(bk, rules, opts = {}) {
  const hrs = hoursUntil(bk), late = hrs < rules.cancel_hours;
  const pct = opts.noShow ? rules.noshow_pct : opts.feePct !== undefined ? opts.feePct : late ? rules.late_pct : 0;
  const paid = ["paid", "confirmed", "done"].includes(bk.status) ? Number(bk.amount) || 0 : 0;
  const fee = Math.min(paid, Math.round((paid * pct) / 100));
  return { hours: hrs, late, pct, fee, refund: paid - fee, paid };
}
// refund (part of) an online payment on Zen's connected account; the platform fee is refunded proportionally. Returns "done" | "manual" (nothing online to refund, or Stripe not live)
export async function stripeRefund(env, bk, amount) {
  if (!amount || amount <= 0) return "none";
  if (bk.provider === "fawry" || !isLive(env) || !bk.payment_intent) return "manual";
  const params = new URLSearchParams({ payment_intent: bk.payment_intent, amount: String(amount), refund_application_fee: "true" });
  const r = await fetch("https://api.stripe.com/v1/refunds", { method: "POST", headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Stripe-Account": env.ZEN_STRIPE_ACCOUNT, "content-type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20" }, body: params });
  if (!r.ok) { console.error("stripe refund", await r.text()); return "manual"; }
  return "done";
}
// a freed day: tell the first people waiting for that city/day (once each)
export async function fillFromWaitlist(env, city, date, slotLabelText, M) {
  const rows = (await env.DB.prepare("SELECT w.*, u.email, u.name, u.lang FROM waitlist w JOIN users u ON u.id = w.user_id WHERE w.city = ? AND w.date = ? AND w.notified_at IS NULL ORDER BY w.created_at LIMIT 3").bind(city, date).all()).results;
  let n = 0;
  for (const w of rows) {
    const ok = await sendEmail(env, { to: w.email, ...M("waitlist", w.lang && ["en", "it", "ar"].includes(w.lang) ? w.lang : "en", { first: (w.name || "").split(" ")[0], city: CITIES[city].name, date, times: slotLabelText, link: `${env.SITE_URL}/booking?city=${city}&date=${date}` }) });
    await env.DB.prepare("UPDATE waitlist SET notified_at = ? WHERE id = ?").bind(now(), w.id).run();
    await logMessage(env, { user_id: w.user_id, kind: "waitlist", channel: "email", status: ok ? "sent" : "failed", detail: `${city} ${date} (freed by a cancellation)` }).catch(() => {});
    n++;
  }
  return n;
}
export const FLAGS = ["pregnant", "anticoagulant", "bleeding", "heart", "diabetes", "skin", "surgery"];
export function parseIntake(t) { try { return t ? JSON.parse(t) : null; } catch { return null; } }
export function healthFlags(intakeText) { const i = parseIntake(intakeText); return i?.health ? i.health.filter((h) => FLAGS.includes(h)) : []; }

export async function settings(env) {
  const rows = (await env.DB.prepare("SELECT key, value FROM settings").all()).results;
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { loyalty_every: Number(s.loyalty_every || 10), referral_pct: Number(s.referral_pct || 40), birthday_pct: Number(s.birthday_pct || 50), package_pct: Number(s.package_pct || 15),
    rules: { cancel_hours: Number(s.cancel_hours ?? 24), late_pct: Number(s.late_pct ?? 100), noshow_pct: Number(s.noshow_pct ?? 100) },
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
// The language a client hears from us in: what they chose on the site for this booking/gift, else their profile, else English.
export const LANGS = ["en", "it", "ar"];
export const pickLang = (...cands) => cands.find((l) => LANGS.includes(l)) || "en";
export async function userLang(env, userId) { if (!userId) return "en"; const u = await env.DB.prepare("SELECT lang FROM users WHERE id = ?").bind(userId).first(); return pickLang(u?.lang); }
// First sign-in through Google/Apple: no magic link was sent, so this is the client's first email from us.
export async function welcomeEmail(env, user) {
  const first = (user.name || "").split(" ")[0] || "";
  return sendEmail(env, { to: user.email, ...M("welcome", pickLang(user.lang), { first, site: env.SITE_URL }) });
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
// Levels (2026-09-12, Ash): owner (role "all") runs everything; a partner runs one city (all its bookings, team, hours, assignments);
// an employee is one therapist (own bookings + unassigned, own schedule, own profile). Nobody but the owner sees the levels.
export const isPartner = (a) => a.level === "partner" && a.role !== "all" && a.role !== "platform";
export const isEmployee = (a) => !isOwner(a) && !isPlatform(a) && !isPartner(a);
export const managesCity = (a) => isOwner(a) || isPartner(a);
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
  const ref = await env.DB.prepare("SELECT email, name, lang FROM users WHERE id = ?").bind(u.referred_by).first();
  await sendEmail(env, { to: ref.email, ...M("referral_reward", pickLang(ref.lang), { name: ref.name, who: u.name, pct: s.referral_pct, site: env.SITE_URL }) });
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
  const u = await env.DB.prepare("SELECT email, name, lang FROM users WHERE id = ?").bind(userId).first();
  await sendEmail(env, { to: u.email, ...M("loyalty_reward", pickLang(u.lang), { name: u.name, n: done.n, site: env.SITE_URL }) });
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
