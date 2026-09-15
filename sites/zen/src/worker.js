// Zen Recovery — Cloudflare Worker
//
// Serves the static site from ./public and runs the API:
//   Booking + payments   POST /api/checkout · POST /api/stripe-webhook · GET /api/status
//   Client accounts      POST /api/auth/request-link (email link or SMS) · GET /api/auth/verify · POST /api/auth/logout
//                        GET /api/auth/google(+/callback) · GET /api/auth/apple (+ POST /callback)
//                        GET|PUT /api/me · GET /api/me/bookings · GET|POST /api/me/checkins · POST /api/me/bookings/:id/feedback
//   Features (src/features.js)  /api/slots · /api/team · /api/packages(+/checkout) · /api/gift/* · /api/waitlist ·
//                        /api/me/packages · /api/me/photos · /api/me/export · /api/photo/:id
//   Admin                POST /api/admin/login · POST /api/admin/logout · GET /api/admin/me
//                        GET /api/admin/stats · GET|POST /api/admin/bookings · PATCH /api/admin/bookings/:id
//                        GET /api/admin/clients · GET /api/admin/clients/:id · GET|PUT /api/admin/settings
//                        GET|POST|DELETE /api/admin/admins · POST /api/admin/password
//                        + availability, blocked, therapists, packages, partners, gifts, review, photos, leaderboard,
//                          messages, waitlist (src/features.js)
//   Cron (src/cron.js)   hourly: reminders, follow-ups, birthday credits, waitlist alerts
//
// Money flow (Stripe Connect, direct charge):
//   client card ──► Zen's connected Stripe account (merchant of record)
//                      └─ application_fee_amount (10%) ──► platform account (AmicoMioFlorence)
//
// Roles: an admin with role "all" sees every city; role "cairo" | "dahab" | "florence" is locked to that city —
// every admin query is filtered by scope() on the server, never by the browser.
//
// Bindings (wrangler.toml): DB (D1), ASSETS, PHOTOS (R2, optional).  Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// RESEND_API_KEY, SESSION_SECRET, ADMIN_BOOTSTRAP_EMAIL + ADMIN_BOOTSTRAP_PASSWORD (first owner login, only while the
// admins table is empty), GOOGLE_CLIENT_SECRET, APPLE_PRIVATE_KEY, WA_TOKEN, TWILIO_SID, TWILIO_TOKEN.
// Vars: ZEN_STRIPE_ACCOUNT, ZEN_NOTIFY_EMAIL, FROM_EMAIL, SITE_URL, GOOGLE_CLIENT_ID, APPLE_*, WA_*, TWILIO_FROM,
// DEV_MAGIC_LINK ("1" returns the sign-in link in the response — local testing only).

import { CITIES, SLOTS, PLATFORM_FEE_BPS } from "./catalog.js";
import { tooMany, noteAttempt, ipOf, LANGS_OPEN, DEFAULT_LANG } from "./lib.js";
import { randomId, signPayload, verifyPayload, getCookie, setCookie, clearCookie, hashPassword, verifyPassword } from "./auth.js";
import { cityNameIn, therapistOffering, offersService, nameIn, hoursUntil, cancelTerms, stripeRefund, fillFromWaitlist, payProvider, fawryOn, fawryCheckout, fawryStatus, fawryNotificationValid, CITY_KEYS, USER_COOKIE, ADMIN_COOKIE, json, clean, normEmail, isDate, isTime, fmt, now, today, feeOn, body, isLive, parseIntake, healthFlags, settings, currentUser, currentAdmin, scope, sendEmail, sendSms, stripeCheckout, slotsFor, createUser, sessionCookieFor, welcomeEmail, catalog, serviceOf, notifyList, validPhoto, localNow, maybeRewardReferrer, maybeRewardLoyalty, isPlatform, isOwner, seesAll, therapistOf, visibleWhere, canSeeBooking, isPartner, isEmployee, managesCity, pickLang, userLang } from "./lib.js";
import { M, paidLineFor } from "./mail.js";
import { featureRoute, adminFeatureRoute, giftPaid, packagePaid, authFlags } from "./features.js";
import { runCron } from "./cron.js";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      const res = await route(req, env, url, ctx);
      return res || json({ error: "Not found" }, 404);
    } catch (e) {
      if (e && e.status) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong on our side. Try again in a minute." }, 500);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env)); },
};

async function route(req, env, url, ctx) {
  const p = url.pathname, m = req.method;
  if (p === "/api/status") return status(env, req);
  if (p === "/api/health") return health(env);
  if (p === "/api/log" && m === "POST") return clientLog(req, env);
  if (p === "/api/reviews" && m === "GET") return publicReviews(env);
  if (p === "/api/fawry/return" && m === "GET") return fawryReturn(env, url);
  if (p === "/api/fawry/notify" && m === "POST") return fawryNotify(req, env);
  if (p === "/api/catalog" && m === "GET") return publicCatalog(env);
  if (p === "/api/auth/google" && m === "GET") return googleStart(env, url);
  if (p === "/api/auth/google/callback" && m === "GET") return googleCallback(req, env, url);
  if (p === "/api/me/checkins" && m === "GET") return myCheckins(req, env);
  if (p === "/api/me/checkins" && m === "POST") return saveCheckin(req, env);
  { const fb = p.match(/^\/api\/me\/bookings\/([a-z0-9]+)\/feedback$/); if (fb && m === "POST") return bookingFeedback(req, env, fb[1]); }
  { const cb = p.match(/^\/api\/me\/bookings\/([a-z0-9]+)\/cancel$/); if (cb && m === "POST") return cancelMyBooking(req, env, cb[1]); if (cb && m === "GET") return cancelPreview(req, env, cb[1]); }
  if (p === "/api/checkout" && m === "POST") return checkout(req, env);
  if (p === "/api/stripe-webhook" && m === "POST") return webhook(req, env);

  if (p === "/api/auth/request-link" && m === "POST") return requestLink(req, env);
  if (p === "/api/auth/verify" && m === "GET") return verifyLink(req, env, url);
  if (p === "/api/auth/logout" && m === "POST") return new Response(null, { status: 204, headers: { "set-cookie": clearCookie(USER_COOKIE) } });
  if (p === "/api/me" && m === "GET") return me(req, env);
  if (p === "/api/me" && m === "PUT") return updateMe(req, env);
  if (p === "/api/me/bookings" && m === "GET") return myBookings(req, env);

  if (p === "/api/admin/login" && m === "POST") return adminLogin(req, env);
  if (p === "/api/admin/logout" && m === "POST") return new Response(null, { status: 204, headers: { "set-cookie": clearCookie(ADMIN_COOKIE) } });
  if (p.startsWith("/api/admin/")) {
    const admin = await currentAdmin(req, env);
    if (!admin) return json({ error: "Sign in first." }, 401);
    // Platform account (Ash): numbers only. Everything operational belongs to Zen's owner and the city teams.
    if (isPlatform(admin) && !["/api/admin/me", "/api/admin/stats", "/api/admin/platform", "/api/admin/profile", "/api/admin/password", "/api/admin/statements", "/api/admin/errors"].includes(p) && !/^\/api\/admin\/admins\/[a-z0-9]+\/switch$/.test(p)) return json({ error: "Your account sees the numbers, not the operations. Ask Zen's owner for anything else." }, 403);
    if (p === "/api/admin/platform" && m === "GET") return isPlatform(admin) ? platformReport(env, admin) : json({ error: "Only the Amico Mio account sees the platform report." }, 403);
    if (p === "/api/admin/me") return json({ admin: pub(admin), therapist: await env.DB.prepare("SELECT id, name, city, photo, active FROM therapists WHERE admin_id = ?").bind(admin.id).first(), cities: await cityMeta(env), settings: await settings(env), photos: authFlags(env).photos, live: isLive(env), pay: { live: isLive(env), stripe_key: Boolean(env.STRIPE_SECRET_KEY), stripe_account: Boolean(env.ZEN_STRIPE_ACCOUNT), stripe_webhook: Boolean(env.STRIPE_WEBHOOK_SECRET), fawry: fawryOn(env) } });
    if (p === "/api/admin/profile" && m === "PUT") return adminProfile(req, env, admin);
    if (p === "/api/admin/errors" && m === "GET") return admin.role === "all" || isPlatform(admin) ? json({ rows: (await env.DB.prepare("SELECT id, at, page, msg, ua, n FROM client_errors ORDER BY at DESC LIMIT 40").all()).results }) : json({ error: "The owner and the platform account see site errors." }, 403);
    if (p === "/api/admin/stats" && m === "GET") return adminStats(env, admin, url);
    if (p === "/api/admin/bookings" && m === "GET") return adminBookings(env, admin, url);
    if (p === "/api/admin/bookings" && m === "POST") return adminCreateBooking(req, env, admin);
    const acc = p.match(/^\/api\/admin\/bookings\/([a-z0-9]+)\/accept$/); if (acc && m === "POST") return acceptBooking(env, admin, acc[1]);
    let mm = p.match(/^\/api\/admin\/bookings\/([a-z0-9]+)$/);
    if (mm && m === "PATCH") return adminUpdateBooking(req, env, admin, mm[1]);
    if (p === "/api/admin/clients" && m === "GET") return adminClients(env, admin, url);
    mm = p.match(/^\/api\/admin\/clients\/([a-z0-9]+)$/);
    if (mm && m === "GET") return adminClient(env, admin, mm[1]);
    if (p === "/api/admin/settings" && m === "GET") return json(await settings(env));
    if (p === "/api/admin/settings" && m === "PUT") return adminSaveSettings(req, env, admin);
    if (p === "/api/admin/admins" && m === "GET") return adminList(env, admin);
    if (p === "/api/admin/admins" && m === "POST") return adminCreate(req, env, admin);
    const inv = p.match(/^\/api\/admin\/admins\/([a-z0-9]+)\/invite$/); if (inv && m === "POST") return adminInvite(req, env, admin, inv[1]);
    const sw = p.match(/^\/api\/admin\/admins\/([a-z0-9]+)\/switch$/); if (sw && m === "PATCH") return adminSwitch(req, env, admin, sw[1]);   // 2026-09-15 (Ash): only the platform account switches sign-ins on or off
    mm = p.match(/^\/api\/admin\/admins\/([a-z0-9]+)$/);
    if (mm && m === "DELETE") return adminDelete(env, admin, mm[1]);
    if (mm && m === "PATCH") return adminEdit(req, env, admin, mm[1]);
    if (p === "/api/admin/password" && m === "POST") return adminPassword(req, env, admin);
    return adminFeatureRoute(req, env, url, admin);
  }
  return featureRoute(req, env, url, ctx);
}

// ---------- small helpers ----------
const pub = (a) => ({ id: a.id, email: a.email, username: a.username || null, name: a.name, role: a.role, level: a.role === "all" ? "owner" : a.role === "platform" ? null : a.level === "partner" ? "partner" : "employee", photo: a.photo || null, phone: a.phone || "", notify: a.notify ?? 1 });
const levelFor = (role, wanted, current) => (role === "all" ? "owner" : role === "platform" ? null : ["partner", "employee"].includes(wanted) ? wanted : current === "partner" ? "partner" : "employee");
// A username: 3–24 of a-z 0-9 . _ - (lowercased). Returns null to clear, false when invalid.
const validUsername = (v) => { if (v === null || v === "") return null; const u = String(v).trim().toLowerCase(); return /^[a-z0-9._-]{3,24}$/.test(u) && !u.includes("@") ? u : false; };
const validEmail = (v) => { const e = normEmail(v); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : false; };
// A sign-in name (email or username) must be unique across both columns, so "shika" can't be one account's username and another's sign-in.
async function signinTaken(env, names, exceptId) { for (const n of names.filter(Boolean)) { const r = await env.DB.prepare("SELECT id FROM admins WHERE (email = ? OR username = ?) AND id != ?").bind(n, n, exceptId || "").first(); if (r) return n; } return null; }
async function cityMeta(env) { const c = await catalog(env); return Object.fromEntries(CITY_KEYS.map((k) => [k, { name: c[k].name, currency: c[k].currency, services: Object.values(c[k].services).map(({ photo, ...s }) => ({ ...s, has_photo: Boolean(photo) })) }])); }
// What the website reads on load: services and prices per city (from the admin), address/team/WhatsApp/Maps per city (settings)
async function publicCatalog(env) {
  const [c, st, off] = await Promise.all([catalog(env), settings(env), therapistOffering(env, null)]); const tp = off.prices;
  return json({ cities: Object.fromEntries(st.cities_open.map((k) => [k, { name: c[k].name, currency: c[k].currency.toUpperCase(), address: st.address[k] ? st.address[k].split("\n").map((l) => l.trim()).filter(Boolean) : null, team: st.team[k] || null, whatsapp: st.whatsapp[k] || null, gmaps: st.gmaps[k] || null,
    services: Object.values(c[k].services).map((s) => ({ id: s.id, name: s.short, dur: s.minutes, price: s.amount, desc: s.description, i18n: s.i18n || null, prices: tp[s.id] || null, not_offered: off.off[s.id] || null, therapist_id: s.therapist_id || null, photo: s.photo ? `/api/service-photo/${s.id}?v=${encodeURIComponent((s.updated_at || "").replace(/\D/g, ""))}` : null })) }])) }, 200, { "cache-control": "no-store" });
}
const INTAKE_LISTS = ["goals", "pain", "health"], INTAKE_STR = ["activity", "sport", "experience", "health_notes", "contact", "time_pref", "completed_at"];
// where it hurts, over time (2026-09-14): one row per change, from the intake, a booking or the client's own update; the profile map is always the latest
const painRow = (r) => { let areas = []; try { areas = JSON.parse(r.areas || "[]"); } catch (_) {} return { at: r.at, areas, source: r.source, booking_id: r.booking_id || null }; };
async function logPain(env, userId, areas, source, bookingId) {
  const list = [...new Set((areas || []).map((a) => String(a).toLowerCase()))].sort();
  const last = await env.DB.prepare("SELECT areas FROM pain_log WHERE user_id = ? ORDER BY at DESC, rowid DESC LIMIT 1").bind(userId).first().catch(() => null);
  if (last && JSON.stringify(painRow(last).areas.slice().sort()) === JSON.stringify(list)) return false;   // nothing changed: no new entry
  await env.DB.prepare("INSERT INTO pain_log (id, user_id, at, areas, source, booking_id) VALUES (?,?,?,?,?,?)").bind(randomId(), userId, now(), JSON.stringify(list), source, bookingId || null).run();
  return true;
}
async function painFromBooking(env, userId, areas, bookingId) {
  try { await logPain(env, userId, areas, "booking", bookingId);
    const u = await env.DB.prepare("SELECT intake FROM users WHERE id = ?").bind(userId).first(); const it = parseIntake(u?.intake) || {}; it.pain = [...new Set(areas)];
    await env.DB.prepare("UPDATE users SET intake = ? WHERE id = ?").bind(JSON.stringify(it), userId).run(); } catch (e) { console.error("pain log", e.message); }
}
function cleanIntake(v) { // whitelist keys, cap sizes; stored as JSON text
  if (!v || typeof v !== "object") return null;
  const o = {};
  for (const k of INTAKE_LISTS) if (Array.isArray(v[k])) o[k] = v[k].slice(0, 20).map((x) => clean(x, 30));
  for (const k of INTAKE_STR) if (v[k] != null) o[k] = clean(v[k], k === "health_notes" ? 600 : 60);
  return JSON.stringify(o).slice(0, 4000);
}
const slotLabel = (s) => SLOTS[s] || s;
const AREAS = ["neck", "shoulder_l", "shoulder_r", "upper_back", "mid_back", "lower_back", "arm_l", "arm_r", "hips", "thigh_l", "thigh_r", "calf_l", "calf_r", "face"];   // the body map's part keys (public/guide.js)
const AREA_LABELS = {"neck": "Neck", "shoulder_l": "Left shoulder", "shoulder_r": "Right shoulder", "upper_back": "Upper back", "mid_back": "Mid back", "lower_back": "Lower back", "arm_l": "Left arm", "arm_r": "Right arm", "hips": "Hips / glutes", "thigh_l": "Left thigh", "thigh_r": "Right thigh", "calf_l": "Left calf", "calf_r": "Right calf", "face": "Face / jaw"};
const AREA_LABEL = (a) => AREA_LABELS[a] || a.replace(/_/g, " ");

// 2026-09-14: for uptime checks (Guardiano, the deploy's live check): the database answers or it doesn't
async function health(env) {
  try { await env.DB.prepare("SELECT 1").first(); return json({ ok: true, db: true, live: isLive(env), at: now() }, 200, { "cache-control": "no-store" }); }
  catch (e) { return json({ ok: false, db: false, error: e.message }, 503, { "cache-control": "no-store" }); }
}
// 2026-09-14: pages report a broken script here (site.js); the same message on the same page is counted once a day
async function clientLog(req, env) {
  const ip = ipOf(req); if (await tooMany(env, "log:" + ip, 20, 60)) return json({ ok: false }, 429); await noteAttempt(env, "log:" + ip);
  const b = await body(req); const msg = clean(b.msg, 500), page = clean(b.page, 200); if (!msg) return json({ error: "Nothing to log." }, 400);
  const ua = clean(req.headers.get("user-agent") || "", 200), since = new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace("T", " ");
  const same = await env.DB.prepare("SELECT id FROM client_errors WHERE msg = ? AND page = ? AND at > ?").bind(msg, page, since).first();
  if (same) await env.DB.prepare("UPDATE client_errors SET n = n + 1, at = ? WHERE id = ?").bind(now(), same.id).run();
  else await env.DB.prepare("INSERT INTO client_errors (id, at, page, msg, ua) VALUES (?,?,?,?,?)").bind(randomId(), now(), page, msg, ua).run();
  return json({ ok: true });
}
async function status(env, req) {
  const st = await settings(env);
  const f = authFlags(env);
  return json({ geo: { country: req?.cf?.country || null, city: req?.cf?.city || null }, cities: st.cities_open, langs: LANGS_OPEN, lang: DEFAULT_LANG,   // 2026-09-15: the rooms open to clients   // 2026-09-14: the booking page keeps a visitor in their own country's rooms
    live: isLive(env) || fawryOn(env), preview: !isLive(env) && !fawryOn(env), fawry: fawryOn(env), pay: { egp: payProvider(env, "egp"), eur: payProvider(env, "eur") }, google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), apple: f.apple, sms: f.sms,
    settings: { loyalty_every: st.loyalty_every, referral_pct: st.referral_pct, birthday_pct: st.birthday_pct, package_pct: st.package_pct }, rules: st.rules, gmaps: st.gmaps, whatsapp: st.whatsapp, review: st.review });
}

// ---------- client auth ----------
async function requestLink(req, env) {
  const b = await body(req);
  if (b.via === "sms") return requestSms(env, b);
  const email = normEmail(b.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "That email doesn't look right." }, 400);
  if (await tooMany(env, "link:" + email, 6, 60) || await tooMany(env, "link:" + ipOf(req), 60, 60)) return json({ error: "Too many sign-in links asked for. Check your inbox (and spam), or try again in an hour." }, 429);
  await noteAttempt(env, "link:" + email); await noteAttempt(env, "link:" + ipOf(req));
  let user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  let created = false;
  if (!user) {
    const name = clean(b.name, 80);
    if (!name) return json({ error: "Tell us your name so we know who's coming.", needName: true }, 400);
    user = await createUser(env, { email, name, ref: b.ref, city: b.city, lang: pickLang(b.lang) });
    created = true;
  }
  let link; try { link = await loginLink(env, user.id); } catch (e) { if (e.status) return json({ error: e.message }, e.status); throw e; }
  await sendEmail(env, { to: email, ...M("magic_link", pickLang(b.lang, user.lang), { name: user.name, link, created }) });
  return json({ ok: true, created, ...(env.DEV_MAGIC_LINK === "1" ? { link } : {}) });
}
async function loginLink(env, userId) {
  // at most 3 links per account per ~15 minutes (tokens live 20 min, so "expires in more than 5 min" = issued in the last 15)
  const recent = (await env.DB.prepare("SELECT COUNT(*) n FROM login_tokens WHERE user_id = ? AND expires_at > ?").bind(userId, Math.floor(Date.now() / 1000) + 300).first()).n;
  if (recent >= 3) throw Object.assign(new Error("Too many sign-in links. Check your inbox (and spam), or try again in 15 minutes."), { status: 429 });
  const token = randomId(24);
  await env.DB.prepare("INSERT INTO login_tokens (token, user_id, expires_at) VALUES (?,?,?)").bind(token, userId, Math.floor(Date.now() / 1000) + 20 * 60).run();
  return `${env.SITE_URL}/api/auth/verify?t=${token}`;
}
// "Text me the link": only for people who already have an account with that number.
async function requestSms(env, b) {
  if (!authFlags(env).sms) return json({ error: "SMS sign-in isn't switched on yet — use your email." }, 404);
  const digits = String(b.phone || "").replace(/\D/g, "");
  if (digits.length < 8) return json({ error: "That number doesn't look right." }, 400);
  const user = await env.DB.prepare("SELECT id, name, phone FROM users WHERE phone IS NOT NULL AND replace(replace(replace(replace(phone,' ',''),'+',''),'-',''),'(','') LIKE ?").bind(`%${digits.slice(-9)}`).first();
  if (!user) return json({ error: "No account has that number yet. Sign up with your email first, then add your number in your profile." }, 404);
  let link; try { link = await loginLink(env, user.id); } catch (e) { if (e.status) return json({ error: e.message }, e.status); throw e; }
  const ok = await sendSms(env, { to: digits, text: `Zen Recovery: tap to sign in (20 min): ${link}` });
  return ok ? json({ ok: true, sms: true }) : json({ error: "We couldn't send the text — try your email instead." }, 502);
}

// ---------- Google sign-in (OAuth 2.0 authorization code, server side) ----------
const GOOGLE_COOKIE = "zen_g";
async function googleStart(env, url) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ error: "Google sign-in isn't set up yet." }, 404);
  const state = randomId(16);
  const ref = clean(url.searchParams.get("ref"), 12), lang = clean(url.searchParams.get("lang"), 2);
  const cookie = await signPayload(env.SESSION_SECRET, { state, ref, lang, exp: Math.floor(Date.now() / 1000) + 600 });
  const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${env.SITE_URL}/api/auth/google/callback`, response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
  return new Response(null, { status: 302, headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, "set-cookie": setCookie(GOOGLE_COOKIE, cookie, 600) } });
}
async function googleCallback(req, env, url) {
  const fail = (why) => { console.error("google sign-in failed:", why); return new Response(null, { status: 302, headers: { location: `${env.SITE_URL}/account?error=google`, "set-cookie": clearCookie(GOOGLE_COOKIE) } }); };
  const st = await verifyPayload(env.SESSION_SECRET, getCookie(req, GOOGLE_COOKIE));
  const code = url.searchParams.get("code");
  if (!st || !code || url.searchParams.get("state") !== st.state) return fail("state mismatch");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${env.SITE_URL}/api/auth/google/callback`, grant_type: "authorization_code" }) });
  const tok = await r.json();
  if (!r.ok || !tok.id_token) return fail(tok.error_description || "token exchange");
  let claims; try { claims = JSON.parse(atob(tok.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return fail("bad id_token"); }
  // the token came straight from Google over TLS in exchange for our client secret, so its claims are trustworthy
  if (claims.aud !== env.GOOGLE_CLIENT_ID || !claims.email || claims.email_verified !== true) return fail("claims");
  const email = normEmail(claims.email);
  let user = await env.DB.prepare("SELECT * FROM users WHERE google_sub = ? OR email = ?").bind(claims.sub, email).first();
  if (!user) { user = await createUser(env, { email, name: clean(claims.name, 80) || email.split("@")[0], ref: st.ref, lang: st.lang, google_sub: claims.sub }); await welcomeEmail(env, user); }
  else if (!user.google_sub) await env.DB.prepare("UPDATE users SET google_sub = ? WHERE id = ?").bind(claims.sub, user.id).run();
  const headers = new Headers({ location: `${env.SITE_URL}/account` });
  headers.append("set-cookie", await sessionCookieFor(env, user.id)); headers.append("set-cookie", clearCookie(GOOGLE_COOKIE));
  return new Response(null, { status: 302, headers });
}

// ---------- check-ins (how the client feels between sessions) + session feedback ----------
async function myCheckins(req, env) {
  const u = await currentUser(req, env); if (!u) return json({ error: "Sign in first." }, 401);
  const r = await env.DB.prepare("SELECT id, date, pain, energy, sleep, note FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT 90").bind(u.id).all();
  return json({ checkins: r.results.reverse() });
}
async function saveCheckin(req, env) {
  const u = await currentUser(req, env); if (!u) return json({ error: "Sign in first." }, 401);
  const b = await body(req);
  const date = isDate(b.date || "") ? b.date : today();
  const num = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const pain = num(b.pain, 0, 10), energy = num(b.energy, 1, 5), sleep = num(b.sleep, 1, 5);
  if (pain === null) return json({ error: "Pick a pain level from 0 to 10." }, 400);
  await env.DB.prepare("DELETE FROM checkins WHERE user_id = ? AND date = ?").bind(u.id, date).run();
  await env.DB.prepare("INSERT INTO checkins (id, user_id, date, pain, energy, sleep, note) VALUES (?,?,?,?,?,?,?)").bind(randomId(), u.id, date, pain, energy, sleep, clean(b.note, 300)).run();
  return myCheckins(req, env);
}
async function bookingFeedback(req, env, id) {
  const u = await currentUser(req, env); if (!u) return json({ error: "Sign in first." }, 401);
  const b = await body(req);
  const rating = Number.isInteger(b.rating) && b.rating >= 1 && b.rating <= 5 ? b.rating : null;
  if (!rating) return json({ error: "Pick 1 to 5 stars." }, 400);
  const r = await env.DB.prepare("UPDATE bookings SET rating = ?, feedback = ? WHERE id = ? AND user_id = ? AND status = 'done'").bind(rating, clean(b.feedback, 500), id, u.id).run();
  if (!r.meta.changes) return json({ error: "You can rate a session once it's marked as done." }, 400);
  const bk = await env.DB.prepare("SELECT city FROM bookings WHERE id = ?").bind(id).first();
  const st = await settings(env);
  return json({ ok: true, review_url: rating === 5 ? st.review[bk.city] || null : null });
}

async function verifyLink(req, env, url) {
  const t = clean(url.searchParams.get("t"), 64);
  const row = await env.DB.prepare("SELECT * FROM login_tokens WHERE token = ? AND used = 0 AND expires_at > ?").bind(t, Math.floor(Date.now() / 1000)).first();
  if (!row) return Response.redirect(`${env.SITE_URL}/account?expired=1`, 302);
  await env.DB.prepare("UPDATE login_tokens SET used = 1 WHERE token = ?").bind(t).run();
  return new Response(null, { status: 302, headers: { location: `${env.SITE_URL}/account`, "set-cookie": await sessionCookieFor(env, row.user_id) } });
}

async function me(req, env) {
  const u = await currentUser(req, env);
  if (!u) return json({ user: null });
  return json(await userBundle(env, u));
}
async function userBundle(env, u) {
  const s = await settings(env);
  const [credits, stats, referrer, invited, packages] = await Promise.all([
    env.DB.prepare("SELECT id, kind, pct, status, reason, created_at, expires_at FROM credits WHERE user_id = ? AND status IN ('available','reserved') AND (expires_at IS NULL OR expires_at >= date('now')) ORDER BY created_at").bind(u.id).all(),
    env.DB.prepare("SELECT SUM(status='done') done, SUM(status IN ('paid','confirmed')) upcoming, COUNT(*) total FROM bookings WHERE user_id = ? AND status IN ('paid','confirmed','done')").bind(u.id).first(),
    u.referred_by ? env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(u.referred_by).first() : null,
    env.DB.prepare("SELECT name, created_at, (SELECT COUNT(*) FROM bookings b WHERE b.user_id = users.id AND b.status IN ('paid','confirmed','done')) sessions FROM users WHERE referred_by = ? ORDER BY created_at DESC").bind(u.id).all(),
    env.DB.prepare("SELECT id, name, city, sessions, remaining, currency, expires_at FROM client_packages WHERE user_id = ? AND status = 'paid' AND remaining > 0 AND (expires_at IS NULL OR expires_at >= date('now')) ORDER BY expires_at").bind(u.id).all(),
  ]);
  const { pass_hash, ...user } = u;
  user.intake = parseIntake(user.intake);
  user.flags = healthFlags(u.intake);
  const painLog = (await env.DB.prepare("SELECT at, areas, source, booking_id FROM pain_log WHERE user_id = ? ORDER BY at DESC, rowid DESC LIMIT 12").bind(u.id).all().catch(() => ({ results: [] }))).results.map(painRow);
  return { user, credits: credits.results, packages: packages.results, stats: { done: stats.done || 0, upcoming: stats.upcoming || 0 }, settings: s, referrer: referrer?.name || null, invited: invited.results, share_url: `${env.SITE_URL}/account?ref=${u.referral_code}`, pain_log: painLog };
}

async function updateMe(req, env) {
  const u = await currentUser(req, env);
  if (!u) return json({ error: "Sign in first." }, 401);
  const b = await body(req);
  const photo = b.photo === undefined ? u.photo : b.photo === null ? null : validPhoto(b.photo) || u.photo;
  const country = ["EG", "IT", "other"].includes(b.country) ? b.country : u.country;
  const nearest = CITY_KEYS.includes(b.nearest_city) ? b.nearest_city : b.nearest_city === null ? null : u.nearest_city;
  const intake = b.intake === undefined ? u.intake : cleanIntake(b.intake);
  if (b.intake !== undefined) { const np = parseIntake(intake)?.pain; if (Array.isArray(np)) await logPain(env, u.id, np, parseIntake(u.intake)?.pain === undefined ? "intake" : "client", null); }
  const lang = LANGS_OPEN.includes(b.lang) ? b.lang : pickLang(u.lang);
  const therapist = b.preferred_therapist === undefined ? u.preferred_therapist : clean(b.preferred_therapist, 40) || null;
  await env.DB.prepare("UPDATE users SET name = ?, phone = ?, city = ?, notes = ?, birthday = ?, photo = ?, country = ?, city_text = ?, nearest_city = ?, intake = ?, lang = ?, preferred_therapist = ? WHERE id = ?")
    .bind(clean(b.name, 80) || u.name, b.phone === undefined ? u.phone : clean(b.phone, 40), CITY_KEYS.includes(b.city) ? b.city : (nearest || u.city), b.notes === undefined ? u.notes : clean(b.notes, 1000), b.birthday === undefined ? u.birthday : (isDate(b.birthday || "") ? b.birthday : null), photo, country, b.city_text === undefined ? u.city_text : clean(b.city_text, 80), nearest, intake, lang, therapist, u.id).run();
  return json(await userBundle(env, await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first()));
}

async function myBookings(req, env) {
  const u = await currentUser(req, env);
  if (!u) return json({ error: "Sign in first." }, 401);
  const r = await env.DB.prepare("SELECT b.id, b.city, b.service_id, b.service_name, b.date, b.slot, b.amount, b.list_amount, b.currency, b.discount_kind, b.status, b.source, b.created_at, b.rating, b.feedback, b.therapist_note, b.therapist_id, t.name therapist FROM bookings b LEFT JOIN therapists t ON t.id = b.therapist_id WHERE b.user_id = ? AND b.status != 'pending' ORDER BY b.date DESC, b.created_at DESC").bind(u.id).all();
  return json({ bookings: r.results });
}

// ---------- checkout ----------
// Discount precedence (one at a time): package > gift > reward credit > partner code.
// Clients with a health red flag (from the questionnaire or the checkbox) aren't charged online:
// the booking is saved as "review", a therapist approves it in the admin, and they pay at the session.
async function checkout(req, env) {
  const b = await body(req);
  const cityKey = b.city, city = CITIES[cityKey];
  const svc = city ? await serviceOf(env, cityKey, clean(b.service, 40)) : null;
  if (!city || !svc) return json({ error: "Unknown city or session." }, 400);
  if (!(await settings(env)).cities_open.includes(cityKey)) return json({ error: `Zen isn't open in ${city.name} right now.` }, 400);
  const name = clean(b.name, 80), email = normEmail(b.email), phone = clean(b.phone, 40), note = clean(b.note, 500), date = clean(b.date, 10);
  if (!name || !email || !phone || !isDate(date)) return json({ error: "Please fill in your name, WhatsApp number, email and a day." }, 400);
  if (date < localNow(city.tz).date) return json({ error: "That day has already passed." }, 400);

  // time: exact slot when the city has an availability calendar, otherwise a morning/afternoon/evening window
  const avail = await slotsFor(env, cityKey, date, null, svc.id);
  let slot, therapist_id = null;
  { const want0 = clean(b.therapist_id, 40) || null; if (want0 && !(await offersService(env, want0, svc.id))) { const tn = await env.DB.prepare("SELECT name FROM therapists WHERE id = ?").bind(want0).first(); return json({ error: `${tn?.name || "That therapist"} doesn't offer this session. Pick another session or another therapist.` }, 400); } }
  if (avail.mode === "slots") {
    slot = clean(b.slot, 5);
    const s = avail.slots.find((x) => x.time === slot);
    if (!s) return json({ error: "That time isn't free any more — pick another one.", slots: avail.slots }, 409);
    const want = clean(b.therapist_id, 40) || null;
    if (want && !s.therapists.includes(want)) return json({ error: "That therapist isn't free at that time.", slots: avail.slots }, 409);
    therapist_id = want || s.therapists[0] || null;
  } else { slot = SLOTS[b.slot] ? b.slot : "morning"; const want = clean(b.therapist_id, 40) || svc.therapist_id || null; if (want && (await env.DB.prepare("SELECT 1 FROM therapists WHERE id = ? AND city = ? AND active = 1").bind(want, cityKey).first())) therapist_id = want; }
  const chosen = clean(b.therapist_id, 40) || null;   // the client's own choice (not an automatic assignment) → that therapist's price, if they set one
  const own = chosen && therapist_id === chosen ? await env.DB.prepare("SELECT amount FROM therapist_prices WHERE therapist_id = ? AND service_id = ? AND offered = 1").bind(chosen, svc.id).first() : null;

  const user = await currentUser(req, env);
  // 2026-09-13 (Ash): whoever books is registered, account or not — their sessions and rewards are kept under their email, and a magic link signs them in later
  let account = user;
  if (!account) {
    account = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!account) { try { account = await createUser(env, { email, name, city: cityKey, lang: pickLang(b.lang) }); } catch (e) { console.error("register guest", e.message); account = null; } }
    if (account && phone && !account.phone) await env.DB.prepare("UPDATE users SET phone = ?, name = COALESCE(name, ?) WHERE id = ?").bind(phone, name, account.id).run();
  }
  const list = own ? own.amount : svc.amount;
  let amount = list, discount_kind = null, credit = null, gift = null, partner = null, pack = null;
  if (b.package_id) {
    if (!user) return json({ error: "Sign in to use your package." }, 401);
    pack = await env.DB.prepare("SELECT * FROM client_packages WHERE id = ? AND user_id = ? AND status = 'paid' AND remaining > 0 AND city = ? AND (expires_at IS NULL OR expires_at >= date('now'))").bind(clean(b.package_id, 40), user.id, cityKey).first();
    if (!pack) return json({ error: "That package can't be used for this booking (wrong city, used up, or expired)." }, 400);
    amount = 0; discount_kind = "package";
  } else if (b.gift_code) {
    gift = await env.DB.prepare("SELECT * FROM gifts WHERE code = ? AND status = 'paid'").bind(clean(b.gift_code, 20).toUpperCase()).first();
    if (!gift) return json({ error: "That gift code isn't valid or was already used." }, 400);
    if (gift.city !== cityKey) return json({ error: `That gift is for ${CITIES[gift.city].name}.` }, 400);
    amount = Math.max(0, list - gift.amount); discount_kind = "gift";
  } else if (b.credit_id) {
    if (!user) return json({ error: "Sign in to use a reward." }, 401);
    credit = await env.DB.prepare("SELECT * FROM credits WHERE id = ? AND user_id = ? AND status = 'available' AND (expires_at IS NULL OR expires_at >= date('now'))").bind(clean(b.credit_id, 40), user.id).first();
    if (!credit) return json({ error: "That reward isn't available any more." }, 400);
    amount = Math.round((list * (100 - credit.pct)) / 100); discount_kind = credit.kind;
  } else if (b.partner_code) {
    partner = await env.DB.prepare("SELECT * FROM partners WHERE code = ? AND active = 1 AND (city IS NULL OR city = ?)").bind(clean(b.partner_code, 16).toUpperCase(), cityKey).first();
    if (!partner) return json({ error: "We don't know that partner code (or it's not valid in this city)." }, 400);
    amount = Math.round((list * (100 - partner.pct)) / 100); discount_kind = "partner";
  }
  const flagged = Boolean(b.flagged) || Boolean(user && !user.approved && healthFlags(user.intake).length);
  const id = randomId();
  { const dup = await env.DB.prepare("SELECT id FROM bookings WHERE email = ? AND city = ? AND date = ? AND slot = ? AND status IN ('paid','confirmed','review')").bind(email, cityKey, date, slot).first();
    if (dup) return json({ error: "You already have this session booked. It's under My account → Sessions." }, 409); }
  const areas = Array.isArray(b.areas) ? [...new Set(b.areas.map((a) => String(a).toLowerCase()).filter((a) => AREAS.includes(a)))].slice(0, 12) : [];
  const base = { lang: pickLang(b.lang, user?.lang), agreed_at: b.agreed ? now() : null, areas: areas.length ? JSON.stringify(areas) : null, id, user_id: account?.id || user?.id || null, email, name, phone, city: cityKey, service_id: svc.id, service_name: svc.name, date, slot, note, list_amount: list, amount, currency: city.currency, discount_kind, credit_id: credit?.id || null, platform_fee: feeOn(amount), therapist_id, package_id: pack?.id || null, gift_code: gift?.code || null, partner_code: partner?.code || null };

  if (areas.length && (account?.id || user?.id)) await painFromBooking(env, account?.id || user?.id, areas, id);   // the therapist's view of "where it hurts" stays current
  if (flagged) { // no card: a therapist checks the health answers first
    await insertBooking(env, { ...base, status: "review" });
    await consume(env, base);
    await afterReview(env, base);
    return json({ url: `${env.SITE_URL}/success.html?review=1` });
  }
  if (amount === 0) { // free session: no card, booking is reserved immediately
    await insertBooking(env, { ...base, status: "paid", paid_at: now() });
    await consume(env, base);
    await afterPaid(env, { ...base, status: "paid" });
    return json({ url: `${env.SITE_URL}/success.html?free=1` });
  }
  const provider = payProvider(env, city.currency);
  if (!provider) return json({ preview: true, error: "Payments are not switched on yet." }, 503);
  if (provider === "fawry") {   // Egypt: Fawry's hosted page (card, wallet or a Fawry reference number), settled to Zen's Egyptian account; the 10% is recorded for the monthly statement
    const ref = "bk" + id;
    let pay; try { pay = await fawryCheckout(env, { ref, amount, name: svc.short || svc.name, description: `${date} · ${slotLabel(slot)}`, email, phone, customerName: name, returnUrl: `${env.SITE_URL}/api/fawry/return`, lang: base.lang }); } catch (e) { return json({ error: e.message }, 502); }
    await insertBooking(env, { ...base, status: "pending", stripe_session: ref, provider: "fawry" });
    if (credit) await env.DB.prepare("UPDATE credits SET status = 'reserved', booking_id = ? WHERE id = ?").bind(id, credit.id).run();
    return json({ url: pay.url, provider: "fawry" });
  }

  const label = discount_kind ? ` · ${discount_kind === "gift" ? "gift applied" : discount_kind === "partner" ? `${partner.pct}% partner discount` : `${credit.pct}% reward applied`}` : "";
  let session;
  try {
    session = await stripeCheckout(env, { amount, currency: city.currency, name: svc.name + label, description: `${date} · ${slotLabel(slot)}${avail.mode === "slots" ? "" : " · Zen confirms the exact hour on WhatsApp"}`, email,
      success: `${env.SITE_URL}/success.html?s={CHECKOUT_SESSION_ID}`, cancel: `${env.SITE_URL}/booking`, metadata: { booking_id: id, city: city.name } });
  } catch (e) { return json({ error: e.message }, 502); }
  await insertBooking(env, { ...base, status: "pending", stripe_session: session.id });
  if (credit) await env.DB.prepare("UPDATE credits SET status = 'reserved', booking_id = ? WHERE id = ?").bind(id, credit.id).run();
  return json({ url: session.url });
}

// Google Calendar link for a booking with an exact time (2026-09-14); windows ("morning") get none
function calendarLink(env, bk) {
  if (!/^\d\d:\d\d$/.test(bk.slot || "")) return "";
  const [h, m] = bk.slot.split(":").map(Number), d = bk.date.replace(/-/g, ""), pad = (n) => String(n).padStart(2, "0");
  const end = h * 60 + m + 60, start = d + "T" + pad(h) + pad(m) + "00", fin = d + "T" + pad(Math.floor(end / 60) % 24) + pad(end % 60) + "00";
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent("Zen Recovery · " + (bk.service_name || "").split(" · ")[0]) + "&dates=" + start + "/" + fin + "&ctz=" + encodeURIComponent(CITIES[bk.city]?.tz || "UTC") + "&details=" + encodeURIComponent(env.SITE_URL + "/account");
}
async function insertBooking(env, o) {
  const cols = ["id", "user_id", "email", "name", "phone", "city", "service_id", "service_name", "date", "slot", "note", "list_amount", "amount", "currency", "discount_kind", "credit_id", "platform_fee", "status", "source", "stripe_session", "payment_intent", "paid_at", "done_at", "therapist_id", "package_id", "gift_code", "partner_code", "lang", "agreed_at", "provider", "areas"];
  try { await env.DB.prepare(`INSERT INTO bookings (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...cols.map((c) => o[c] ?? (c === "source" ? "web" : null))).run(); }
  catch (e) { if (/UNIQUE/i.test(e.message)) throw Object.assign(new Error("That time was just taken by someone else. Pick another one."), { status: 409 }); throw e; }   // bookings_one_per_slot
}
// Use up whatever paid for the booking (reward credit, gift, package session). restore() undoes it on cancel.
async function consume(env, bk) {
  if (bk.credit_id) await env.DB.prepare("UPDATE credits SET status = 'used', booking_id = ?, used_at = ? WHERE id = ?").bind(bk.id, now(), bk.credit_id).run();
  if (bk.gift_code) await env.DB.prepare("UPDATE gifts SET status = 'redeemed', redeemed_at = ?, booking_id = ? WHERE code = ? AND status = 'paid'").bind(now(), bk.id, bk.gift_code).run();
  if (bk.package_id) await env.DB.prepare("UPDATE client_packages SET remaining = remaining - 1 WHERE id = ? AND remaining > 0").bind(bk.package_id).run();
}
async function restore(env, bk) {
  if (bk.credit_id) await env.DB.prepare("UPDATE credits SET status = 'available', booking_id = NULL, used_at = NULL WHERE id = ?").bind(bk.credit_id).run();
  if (bk.gift_code) await env.DB.prepare("UPDATE gifts SET status = 'paid', redeemed_at = NULL, booking_id = NULL WHERE code = ? AND booking_id = ?").bind(bk.gift_code, bk.id).run();
  if (bk.package_id) await env.DB.prepare("UPDATE client_packages SET remaining = remaining + 1 WHERE id = ?").bind(bk.package_id).run();
}

// ---------- reviews the owner shows on the home page (2026-09-13): real ratings + words left by clients after a done session ----------
async function publicReviews(env) {
  const open = (await settings(env)).cities_open;
  const r = await env.DB.prepare(`SELECT b.name, b.city, b.service_name, b.rating, b.feedback, b.lang, b.date FROM bookings b WHERE b.featured = 1 AND b.rating >= 4 AND COALESCE(b.feedback, '') != '' AND b.city IN (${open.map(() => "?").join(",")}) ORDER BY b.done_at DESC, b.date DESC LIMIT 12`).bind(...open).all();
  return json({ reviews: r.results.map((x) => ({ first: (x.name || "").split(" ")[0], city: x.city, service: (x.service_name || "").split(" · ")[0], rating: x.rating, text: x.feedback, lang: x.lang || "en", when: x.date })) }, 200, { "cache-control": "public, max-age=300" });
}

// ---------- Fawry: the client comes back, and Fawry tells us server-to-server; both settle only after Get Payment Status says PAID ----------
async function fawrySettle(env, ref) {
  const st = await fawryStatus(env, ref);
  if (!st.paid) return { paid: false, status: st.status };
  const kind = ref.slice(0, 2), id = ref.slice(2);
  if (kind === "bk") {
    const bk = await env.DB.prepare("SELECT * FROM bookings WHERE id = ? AND stripe_session = ?").bind(id, ref).first();
    if (!bk) return { paid: true, missing: true };
    if (bk.status === "pending") {
      await env.DB.prepare("UPDATE bookings SET status = 'paid', paid_at = ?, payment_intent = ? WHERE id = ? AND status = 'pending'").bind(now(), st.fawryRef, id).run();
      await consume(env, bk); await afterPaid(env, { ...bk, status: "paid", payment_intent: st.fawryRef });
    }
    return { paid: true, kind, id };
  }
  if (kind === "gf") { await giftPaid(env, id); return { paid: true, kind, id }; }
  if (kind === "pk") { await packagePaid(env, id, st.fawryRef); return { paid: true, kind, id }; }
  return { paid: true, unknown: true };
}
const fawryLanding = (env, ref, ok) => { const kind = ref.slice(0, 2); if (kind === "gf") return `${env.SITE_URL}/${ok ? "success.html?gift=1" : "giftcard?pay=failed"}`; if (kind === "pk") return `${env.SITE_URL}/account${ok ? "?package=1" : "?pay=failed"}#packages`; return `${env.SITE_URL}/${ok ? "success.html?f=1" : "booking?pay=failed"}`; };
async function fawryReturn(env, url) {
  const ref = clean(url.searchParams.get("merchantRefNumber") || url.searchParams.get("merchantRefNum") || "", 40);
  if (!fawryOn(env) || !/^(bk|gf|pk)[a-z0-9]+$/.test(ref)) return Response.redirect(`${env.SITE_URL}/booking`, 302);
  let r; try { r = await fawrySettle(env, ref); } catch (e) { console.error("fawry return", e.message); r = { paid: false }; }
  return Response.redirect(fawryLanding(env, ref, r.paid), 302);
}
async function fawryNotify(req, env) {
  if (!fawryOn(env)) return new Response("off", { status: 404 });
  const n = await req.json().catch(() => null);
  if (!n || !(await fawryNotificationValid(env, n))) return new Response("bad signature", { status: 400 });
  const ref = String(n.merchantRefNumber || "");
  if (String(n.orderStatus || "").toUpperCase() === "PAID" && /^(bk|gf|pk)[a-z0-9]+$/.test(ref)) { try { await fawrySettle(env, ref); } catch (e) { console.error("fawry notify", e.message); } }
  else if (["EXPIRED", "CANCELED", "CANCELLED", "FAILED"].includes(String(n.orderStatus || "").toUpperCase()) && /^bk[a-z0-9]+$/.test(ref)) { await env.DB.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'pending'").bind(ref.slice(2)).run(); }
  return new Response("ok");
}

// ---------- webhook ----------
async function webhook(req, env) {
  const raw = await req.text();
  if (!(await verifyStripeSignature(raw, req.headers.get("stripe-signature") || "", env.STRIPE_WEBHOOK_SECRET))) return new Response("bad signature", { status: 400 });
  const event = JSON.parse(raw);
  const s = event.data?.object;
  const md = s?.metadata || {};
  if (md.kind === "gift" && md.gift_id) {
    if (event.type === "checkout.session.completed") await giftPaid(env, md.gift_id);
    else if (event.type === "checkout.session.expired") await env.DB.prepare("UPDATE gifts SET status = 'cancelled' WHERE id = ? AND status = 'pending'").bind(md.gift_id).run();
    return new Response("ok");
  }
  if (md.kind === "package" && md.package_row) {
    if (event.type === "checkout.session.completed") await packagePaid(env, md.package_row, s.payment_intent);
    else if (event.type === "checkout.session.expired") await env.DB.prepare("UPDATE client_packages SET status = 'cancelled' WHERE id = ? AND status = 'pending'").bind(md.package_row).run();
    return new Response("ok");
  }
  const bid = md.booking_id;
  if (!bid) return new Response("ok");
  const bk = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(bid).first();
  if (!bk) return new Response("ok");
  if (event.type === "checkout.session.completed" && bk.status === "pending") {
    await env.DB.prepare("UPDATE bookings SET status = 'paid', paid_at = ?, payment_intent = ? WHERE id = ?").bind(now(), s.payment_intent || null, bid).run();
    await consume(env, bk);
    await afterPaid(env, { ...bk, status: "paid" });
  } else if (event.type === "checkout.session.expired" && bk.status === "pending") {
    await env.DB.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").bind(bid).run();
    if (bk.credit_id) await env.DB.prepare("UPDATE credits SET status = 'available', booking_id = NULL WHERE id = ?").bind(bk.credit_id).run();
  }
  return new Response("ok");
}

const paidLine = (bk) => bk.amount === 0 ? (bk.discount_kind === "package" ? "Package session (no charge)" : bk.discount_kind === "gift" ? "Gift voucher (no charge)" : "Free session (reward)") : `${fmt(bk.amount, bk.currency)}${bk.discount_kind ? ` (${bk.discount_kind} applied, list ${fmt(bk.list_amount, bk.currency)})` : ""}`;
async function therapistName(env, id) { if (!id) return null; const t = await env.DB.prepare("SELECT name FROM therapists WHERE id = ?").bind(id).first(); return t?.name || null; }
// Where the session happens: the therapist's own place if set (Cairo therapists work in different neighbourhoods), else the city's address.
async function whereLine(env, bk) {
  const t = bk.therapist_id ? await env.DB.prepare("SELECT area, address, maps_url FROM therapists WHERE id = ?").bind(bk.therapist_id).first() : null;
  const st = await settings(env);
  const place = [t?.area, t?.address].filter(Boolean).join(" · ") || (st.address?.[bk.city] || "").replace(/\n+/g, ", ");
  const maps = t?.maps_url || st.gmaps?.[bk.city] || "";
  return place ? `Where:    ${place}${maps ? ` (${maps})` : ""}` : null;
}

// After a booking is paid (card, free reward, or manual): referral reward for the inviter, emails to Zen and the client.
async function afterPaid(env, bk) {
  if (bk.user_id) await maybeRewardReferrer(env, bk.user_id);
  const city = CITIES[bk.city], exact = isTime(bk.slot), th = await therapistName(env, bk.therapist_id), where = await whereLine(env, bk), lang = pickLang(bk.lang, await userLang(env, bk.user_id));
  await Promise.all([
    sendEmail(env, {
      to: await notifyList(env, bk.city, bk.therapist_id),
      subject: `New booking · ${city.name} · ${bk.service_name} · ${bk.date} ${slotLabel(bk.slot)}`,
      text: [`New booking through the website.`, ``, bk.areas ? `Where it hurts: ${JSON.parse(bk.areas).map(AREA_LABEL).join(", ")}` : null, `City:     ${city.name}`, `Session:  ${bk.service_name}`, `Day:      ${bk.date}`, `Time:     ${slotLabel(bk.slot)}`, th ? `Therapist: ${th}` : null, ``,
        `Client:   ${bk.name}`, `WhatsApp: ${bk.phone}`, `Email:    ${bk.email}`, `Note:     ${bk.note || "—"}`, bk.partner_code ? `Partner:  ${bk.partner_code}` : null, ``, `Paid:     ${paidLine(bk)}`, ``,
        exact ? `The time is fixed. Mark it "Confirmed" in the admin once you've said hello on WhatsApp: ${env.SITE_URL}/admin` : `Confirm the exact hour with the client on WhatsApp, then mark it "Confirmed" in the admin: ${env.SITE_URL}/admin`].filter((l) => l !== null).join("\n"),
    }),
    sendEmail(env, { to: bk.email, ...M("booking_confirmed", lang, { name: bk.name, city: cityNameIn(bk.city, lang), service: nameIn(await serviceOf(env, bk.city, bk.service_id), lang, cityNameIn(bk.city, lang)) || bk.service_name, date: bk.date, slot: slotLabel(bk.slot), therapist: th, paid: paidLineFor(lang, bk, fmt), where: where ? where.replace(/^Where:\s*/, "") : "", exact, phone: bk.phone, site: env.SITE_URL, cal: calendarLink(env, bk) }) }),
  ]);
}
async function afterReview(env, bk) {
  const city = CITIES[bk.city], lang = pickLang(bk.lang, await userLang(env, bk.user_id));
  await Promise.all([
    sendEmail(env, { to: await notifyList(env, bk.city, bk.therapist_id), subject: `Needs a therapist's OK · ${city.name} · ${bk.name} · ${bk.date}`, text: [`${bk.name} booked ${bk.service_name} for ${bk.date} ${slotLabel(bk.slot)} but ticked a health red flag (pregnancy, blood thinners, bleeding/heart condition, recent surgery…).`, ``, `Nothing was charged. Read their answers and approve or cancel in the admin → Needs review: ${env.SITE_URL}/admin`, ``, `WhatsApp: ${bk.phone} · Email: ${bk.email}`, `Note: ${bk.note || "—"}`].join("\n") }),
    sendEmail(env, { to: bk.email, ...M("booking_review", lang, { name: bk.name, city: cityNameIn(bk.city, lang), service: bk.service_name, date: bk.date, slot: slotLabel(bk.slot) }) }),
  ]);
}

// ---------- admin ----------
const cityWhere = (city, col = "city") => (city ? { sql: ` AND ${col} = ?`, args: [city] } : { sql: "", args: [] });

async function adminLogin(req, env) {
  const b = await body(req);
  const email = normEmail(b.email), password = String(b.password || "");
  let a = (await env.DB.prepare("SELECT * FROM admins WHERE email = ?").bind(email).first()) || (await env.DB.prepare("SELECT * FROM admins WHERE username = ?").bind(email).first());
  if (!a) { // first owner: bootstrap from secrets while the table is empty
    const count = await env.DB.prepare("SELECT COUNT(*) n FROM admins").first();
    if (count.n === 0 && env.ADMIN_BOOTSTRAP_EMAIL && email === normEmail(env.ADMIN_BOOTSTRAP_EMAIL) && password && password === env.ADMIN_BOOTSTRAP_PASSWORD) {
      const { hash, salt } = await hashPassword(password);
      await env.DB.prepare("INSERT INTO admins (id, email, name, role, pass_hash, salt) VALUES (?,?,?,?,?,?)").bind(randomId(), email, "Owner", "all", hash, salt).run();
      a = await env.DB.prepare("SELECT * FROM admins WHERE email = ?").bind(email).first();
    }
  }
  if (a && a.disabled) return json({ error: "This sign-in is switched off. Ask the owner." }, 403);
  const ip = ipOf(req);
  if (await tooMany(env, "login:" + email, 8, 15) || await tooMany(env, "login:" + ip, 40, 15)) return json({ error: "Too many tries. Wait 15 minutes, then try again." }, 429);
  if (!a || !(await verifyPassword(password, a.pass_hash, a.salt))) { await noteAttempt(env, "login:" + email); await noteAttempt(env, "login:" + ip); return json({ error: "Wrong email/username or password." }, 401); }
  await env.DB.prepare("UPDATE admins SET last_login = ? WHERE id = ?").bind(now(), a.id).run();
  const cookie = await signPayload(env.SESSION_SECRET, { aid: a.id, exp: Math.floor(Date.now() / 1000) + 12 * 3600 });
  const weak = password.length < 12 && (/^[a-z]+\d{1,6}$/i.test(password) || ["password", "passw0rd", "12345678", "123456789", "1234567890", "qwerty123", "admin1234", "zenrecovery"].includes(password.toLowerCase()));   // 2026-09-14: the page nudges them to change it
  return json({ admin: pub(a), weak }, 200, { "set-cookie": setCookie(ADMIN_COOKIE, cookie, 12 * 3600) });
}

async function adminStats(env, admin, url) {
  const city = scope(admin, url.searchParams.get("city"));
  const w = cityWhere(city);
  const live = "status IN ('paid','confirmed','done')";
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args, ...w.args);
  const v = visibleWhere(admin, isOwner(admin) ? null : await therapistOf(env, admin)), wb = { sql: w.sql + v.sql, args: [...w.args, ...v.args] };   // bookings only: what this account may see
  const qb = (sql, ...args) => env.DB.prepare(sql).bind(...args, ...wb.args);
  const [months, thisMonth, lastMonth, byService, byStatus, clients, upcoming, todayRows, byCity, rewards, review, ratings, packs, gifts] = await Promise.all([
    qb(`SELECT strftime('%Y-%m', date) m, currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee, SUM(status='done') done, COUNT(DISTINCT COALESCE(user_id, email)) clients
       FROM bookings WHERE ${live} AND date >= date('now','-11 months','start of month') AND date < date('now','+1 month','start of month')${wb.sql} GROUP BY m, currency ORDER BY m`).all(),
    qb(`SELECT currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee, SUM(status='done') done FROM bookings WHERE ${live} AND date >= date('now','start of month') AND date < date('now','+1 month','start of month')${wb.sql} GROUP BY currency`).all(),
    qb(`SELECT currency, COUNT(*) n, SUM(amount) rev FROM bookings WHERE ${live} AND date >= date('now','-1 month','start of month') AND date < date('now','start of month')${wb.sql} GROUP BY currency`).all(),
    qb(`SELECT service_name name, COUNT(*) n, SUM(amount) rev, currency FROM bookings WHERE ${live}${wb.sql} GROUP BY service_name, currency ORDER BY n DESC LIMIT 8`).all(),
    qb(`SELECT status, COUNT(*) n FROM bookings WHERE status != 'pending'${wb.sql} GROUP BY status`).all(),
    qb(`SELECT COUNT(DISTINCT COALESCE(user_id, email)) total, COUNT(DISTINCT CASE WHEN created_at >= date('now','start of month') THEN COALESCE(user_id, email) END) new_this_month FROM bookings WHERE ${live}${wb.sql}`).first(),
    qb(`SELECT COUNT(*) n FROM bookings WHERE status IN ('paid','confirmed') AND date >= date('now')${wb.sql}`).first(),
    qb(`SELECT b.id, b.name, b.service_name, b.slot, b.status, b.city, t.name therapist FROM bookings b LEFT JOIN therapists t ON t.id = b.therapist_id WHERE b.status IN ('paid','confirmed') AND b.date = date('now')${wb.sql.replace(" city = ?", " b.city = ?").replace(/\(therapist_id/g, "(b.therapist_id").replace(/OR therapist_id/g, "OR b.therapist_id").replace(/AND therapist_id/g, "AND b.therapist_id")} ORDER BY b.slot`).all(),
    seesAll(admin) && !city ? env.DB.prepare(`SELECT city, currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee FROM bookings WHERE ${live} AND date >= date('now','start of month') GROUP BY city, currency`).all() : { results: [] },
    qb(`SELECT kind, status, COUNT(*) n FROM credits WHERE user_id IN (SELECT DISTINCT user_id FROM bookings WHERE user_id IS NOT NULL${wb.sql}) GROUP BY kind, status`).all(),
    qb(`SELECT COUNT(*) n FROM bookings WHERE status = 'review'${wb.sql}`).first(),
    qb(`SELECT AVG(rating) avg, COUNT(rating) n, SUM(rating = 5) five FROM bookings WHERE rating IS NOT NULL${wb.sql}`).first(),
    q(`SELECT currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee, SUM(remaining) remaining FROM client_packages WHERE status = 'paid'${w.sql} GROUP BY currency`).all(),
    q(`SELECT currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee, SUM(status = 'paid') unused FROM gifts WHERE status IN ('paid','redeemed')${w.sql} GROUP BY currency`).all(),
  ]);
  return json({ city, months: months.results, this_month: thisMonth.results, last_month: lastMonth.results, by_service: byService.results, by_status: byStatus.results, clients, upcoming: upcoming.n, today: todayRows.results, by_city: byCity.results, rewards: rewards.results, review: review.n, ratings, packages: packs.results, gifts: gifts.results, show_fee: isPlatform(admin) });
}

// Ash's view: what the platform fee (10%) earned, per month and per city, plus a health snapshot of the site. No client data.
async function platformReport(env, admin) {
  const live = "status IN ('paid','confirmed','done')";
  const [months, byCity, totals, packs, gifts, admins, users, lastMsg, pendingReview] = await Promise.all([
    env.DB.prepare(`SELECT strftime('%Y-%m', date) m, currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee, SUM(source = 'manual') manual FROM bookings WHERE ${live} AND date >= date('now','-11 months','start of month') AND date < date('now','+1 month','start of month') GROUP BY m, currency ORDER BY m`).all(),
    env.DB.prepare(`SELECT city, currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee, SUM(source = 'manual') manual, MAX(date) last_date FROM bookings WHERE ${live} GROUP BY city, currency ORDER BY city`).all(),
    env.DB.prepare(`SELECT currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee, SUM(source = 'manual') manual, SUM(amount = 0) free FROM bookings WHERE ${live} GROUP BY currency`).all(),
    env.DB.prepare("SELECT currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee FROM client_packages WHERE status = 'paid' GROUP BY currency").all(),
    env.DB.prepare("SELECT currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee FROM gifts WHERE status IN ('paid','redeemed') GROUP BY currency").all(),
    env.DB.prepare("SELECT id, name, role, last_login, created_at, disabled FROM admins ORDER BY created_at").all(),
    env.DB.prepare("SELECT COUNT(*) total, SUM(created_at >= date('now','start of month')) new_this_month, SUM(created_at >= date('now','-7 days')) new_7d FROM users").first(),
    env.DB.prepare("SELECT MAX(created_at) at, COUNT(*) n FROM messages WHERE created_at >= date('now','-7 days')").first(),
    env.DB.prepare("SELECT COUNT(*) n FROM bookings WHERE status = 'review'").first(),
  ]);
  const st = await settings(env);
  return json({
    fee_bps: PLATFORM_FEE_BPS, live: isLive(env), stripe_account: env.ZEN_STRIPE_ACCOUNT || null,
    months: months.results, by_city: byCity.results, totals: totals.results, packages: packs.results, gifts: gifts.results,
    admins: admins.results, users, messages_7d: lastMsg, pending_review: pendingReview.n,
    rules: { loyalty_every: st.loyalty_every, referral_pct: st.referral_pct, birthday_pct: st.birthday_pct, package_pct: st.package_pct, captain_pct: st.captain_pct },
  });
}

async function adminBookings(env, admin, url) {
  const city = scope(admin, url.searchParams.get("city"));
  const w = cityWhere(city);
  const status = clean(url.searchParams.get("status"), 20), from = clean(url.searchParams.get("from"), 10), to = clean(url.searchParams.get("to"), 10), qs = clean(url.searchParams.get("q"), 60);
  let sql = `SELECT b.id, b.user_id, b.name, b.email, b.phone, b.city, b.service_name, b.date, b.slot, b.amount, b.list_amount, b.currency, b.discount_kind, b.platform_fee, b.status, b.source, b.note, b.created_at, b.cancel_fee, b.cancelled_at, b.cancelled_by, b.refund_amount, b.refund_status, b.areas, b.featured, b.rating, b.feedback, b.rating, b.feedback, b.therapist_note, b.therapist_id, b.gift_code, b.partner_code, b.package_id, t.name therapist, u.intake AS user_intake, u.notes AS user_notes, u.nearest_city AS user_nearest, u.lang AS user_lang, u.approved AS user_approved
    FROM bookings b LEFT JOIN users u ON u.id = b.user_id LEFT JOIN therapists t ON t.id = b.therapist_id WHERE b.status != 'pending'${w.sql.replace(" city = ?", " b.city = ?")}`;
  const args = [...w.args];
  const v = visibleWhere(admin, await therapistOf(env, admin), "b.therapist_id"); sql += v.sql; args.push(...v.args);
  if (status) { sql += " AND b.status = ?"; args.push(status); }
  if (isDate(from)) { sql += " AND b.date >= ?"; args.push(from); }
  if (isDate(to)) { sql += " AND b.date <= ?"; args.push(to); }
  if (qs) { sql += " AND (b.name LIKE ? OR b.email LIKE ? OR b.phone LIKE ?)"; args.push(`%${qs}%`, `%${qs}%`, `%${qs}%`); }
  sql += " ORDER BY b.date DESC, b.created_at DESC LIMIT 300";
  const r = await env.DB.prepare(sql).bind(...args).all();
  r.results.forEach((b) => { const i = parseIntake(b.user_intake); b.health = i?.health || []; b.flags = healthFlags(b.user_intake); b.pain = i?.pain || []; b.goals = i?.goals || []; b.experience = i?.experience || null; delete b.user_intake; delete b.platform_fee; });
  return json({ bookings: r.results, city });
}

async function adminCreateBooking(req, env, admin) {
  const b = await body(req);
  const cityKey = scope(admin, b.city) || b.city;
  const city = CITIES[cityKey];
  const svc = city ? await serviceOf(env, cityKey, clean(b.service, 40)) : null;
  if (!city || !svc) return json({ error: "Pick a city and a session." }, 400);
  const name = clean(b.name, 80), email = normEmail(b.email), phone = clean(b.phone, 40), date = clean(b.date, 10);
  if (!name || !isDate(date)) return json({ error: "Name and day are required." }, 400);
  const amount = Number.isInteger(b.amount) && b.amount >= 0 ? b.amount : svc.amount;
  const status = ["paid", "confirmed", "done"].includes(b.status) ? b.status : "confirmed";
  const user = email ? await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first() : null;
  const id = randomId();
  const slot = isTime(b.slot) || SLOTS[b.slot] ? b.slot : "morning";
  await insertBooking(env, { id, user_id: user?.id || null, email: email || null, name, phone, city: cityKey, service_id: svc.id, service_name: svc.name, date, slot, note: clean(b.note, 500), list_amount: svc.amount, amount, currency: city.currency, discount_kind: amount !== svc.amount ? "manual" : null, platform_fee: 0, status, source: "manual", paid_at: now(), done_at: status === "done" ? now() : null, therapist_id: clean(b.therapist_id, 40) || null });
  if (user) { await maybeRewardReferrer(env, user.id); if (status === "done") await maybeRewardLoyalty(env, user.id); }
  return json({ ok: true, id });
}

async function adminUpdateBooking(req, env, admin, id) {
  const b = await body(req);
  const bk = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first();
  if (!bk || (!isOwner(admin) && bk.city !== admin.role)) return json({ error: "Not found" }, 404);
  const mine = isOwner(admin) ? null : await therapistOf(env, admin);
  if (!canSeeBooking(admin, mine, bk)) return json({ error: "Not found" }, 404);
  // Only the owner assigns a booking to someone. A city account may take an unassigned one for itself (see acceptBooking) and nothing else.
  if (b.therapist_id !== undefined && !isOwner(admin)) { const want = clean(b.therapist_id, 40) || null;
    if (isPartner(admin)) { if (want && !(await env.DB.prepare("SELECT 1 FROM therapists WHERE id = ? AND city = ?").bind(want, bk.city).first())) return json({ error: "That therapist isn't in your city." }, 400); }
    else { const same = want === bk.therapist_id, accept = bk.therapist_id === null && mine && want === mine.id; if (!same && !accept) return json({ error: "Only the owner or your city's partner can assign a booking to someone else." }, 403); } }
  if (b.featured !== undefined) { if (!isOwner(admin)) return json({ error: "Only the owner picks the reviews shown on the site." }, 403); await env.DB.prepare("UPDATE bookings SET featured = ? WHERE id = ?").bind(b.featured ? 1 : 0, id).run(); if (Object.keys(b).length === 1) return json({ ok: true }); }
  const status = ["paid", "confirmed", "done", "cancelled", "no_show"].includes(b.status) ? b.status : null;
  const slot = b.slot !== undefined ? clean(b.slot, 20) : bk.slot;
  const note = b.note !== undefined ? clean(b.note, 500) : bk.note;
  const tnote = b.therapist_note !== undefined ? clean(b.therapist_note, 800) : bk.therapist_note;
  const th = b.therapist_id !== undefined ? clean(b.therapist_id, 40) || null : bk.therapist_id;
  await env.DB.prepare("UPDATE bookings SET status = ?, slot = ?, note = ?, therapist_note = ?, therapist_id = ?, done_at = CASE WHEN ? = 'done' THEN COALESCE(done_at, ?) ELSE done_at END WHERE id = ?")
    .bind(status || bk.status, slot, note, tnote, th, status || bk.status, now(), id).run();
  if (bk.status === "review" && status && status !== "cancelled" && bk.user_id) { await env.DB.prepare("UPDATE users SET approved = 1 WHERE id = ?").bind(bk.user_id).run(); await maybeRewardReferrer(env, bk.user_id); }
  if (status === "done" && bk.status !== "done") await maybeRewardLoyalty(env, bk.user_id);
  if (status === "cancelled" && bk.status !== "cancelled") await closeBooking(env, bk, { by: "admin", feePct: b.fee_pct === undefined ? undefined : Math.min(100, Math.max(0, Number(b.fee_pct) || 0)) });
  if (status === "no_show" && bk.status !== "no_show") await closeBooking(env, bk, { by: "admin", noShow: true });
  return json({ ok: true });
}

// ---------- cancellations (2026-09-13): the owner's rules decide the fee; online payments are refunded on Zen's account; the freed day goes to the waitlist ----------
async function closeBooking(env, bk, { by, feePct, noShow = false }) {
  const st = await settings(env), terms = cancelTerms(bk, st.rules, { noShow, feePct });
  const refund_status = noShow ? "none" : await stripeRefund(env, bk, terms.refund);
  await env.DB.prepare("UPDATE bookings SET cancel_fee = ?, cancelled_at = ?, cancelled_by = ?, refund_amount = ?, refund_status = ? WHERE id = ?").bind(terms.fee, now(), by, noShow ? 0 : terms.refund, refund_status, bk.id).run();
  if (!noShow && terms.fee === 0) await restore(env, bk);   // a free cancellation gives the reward / gift / package session back; a late one keeps it, like the fee
  const lang = pickLang(bk.lang), fmtM = (v) => fmt(v, bk.currency);
  if (!noShow && bk.email) sendEmail(env, { to: bk.email, ...M("booking_cancelled", lang, { name: bk.name, service: nameIn(await serviceOf(env, bk.city, bk.service_id), lang, cityNameIn(bk.city, lang)) || bk.service_name, date: bk.date, city: cityNameIn(bk.city, lang), by, hours: st.rules.cancel_hours, fee: terms.fee ? fmtM(terms.fee) : "", refund: terms.refund ? fmtM(terms.refund) : "", refund_status, site: env.SITE_URL }) }).catch(() => {});
  if (!noShow) fillFromWaitlist(env, bk.city, bk.date, slotLabel(bk.slot), M).catch((e) => console.error("waitlist fill", e.message));
  return { ...terms, refund_status };
}
async function cancelPreview(req, env, id) {
  const u = await currentUser(req, env); if (!u) return json({ error: "Sign in first." }, 401);
  const bk = await env.DB.prepare("SELECT * FROM bookings WHERE id = ? AND user_id = ?").bind(id, u.id).first();
  if (!bk) return json({ error: "Not found" }, 404);
  const st = await settings(env); return json({ ...cancelTerms(bk, st.rules), rules: st.rules, can_cancel: ["pending", "paid", "confirmed", "review"].includes(bk.status) });
}
async function cancelMyBooking(req, env, id) {
  const u = await currentUser(req, env); if (!u) return json({ error: "Sign in first." }, 401);
  const bk = await env.DB.prepare("SELECT * FROM bookings WHERE id = ? AND user_id = ?").bind(id, u.id).first();
  if (!bk) return json({ error: "Not found" }, 404);
  if (!["pending", "paid", "confirmed", "review"].includes(bk.status)) return json({ error: "This booking is already closed." }, 400);
  if (hoursUntil(bk) < 0) return json({ error: "The session has already started. Message the room instead." }, 400);
  await env.DB.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").bind(id).run();
  const r = await closeBooking(env, bk, { by: "client" });
  sendEmail(env, { to: await notifyList(env, bk.city, bk.therapist_id), subject: `Cancelled · ${CITIES[bk.city].name} · ${bk.name} · ${bk.date}`, text: [`${bk.name} cancelled their ${bk.service_name} on ${bk.date} ${slotLabel(bk.slot)}.`, r.late ? `Inside the ${r.hours < 0 ? 0 : Math.round(r.hours)}h mark: fee kept ${fmt(r.fee, bk.currency)}.` : `Outside the window: no fee.`, r.refund ? `Refund ${fmt(r.refund, bk.currency)}: ${r.refund_status === "done" ? "done through Stripe" : r.refund_status === "manual" ? "TO ARRANGE (no online payment to refund automatically)" : "none"}.` : ``, `The day was offered to the waitlist.`].join("\n") }).catch(() => {});
  return json({ ok: true, late: r.late, fee: r.fee, refund: r.refund, refund_status: r.refund_status });
}

// A therapist takes an unassigned booking in their city. First come, first served; the owner can still reassign.
async function acceptBooking(env, admin, id) {
  const th = await therapistOf(env, admin);
  if (!th) return json({ error: "Your account isn't linked to a therapist profile. Ask the owner to link it under Team." }, 400);
  const bk = await env.DB.prepare("SELECT id, city, therapist_id, status FROM bookings WHERE id = ?").bind(id).first();
  if (!bk || (!isOwner(admin) && bk.city !== admin.role) || !canSeeBooking(admin, th, bk)) return json({ error: "Not found" }, 404);
  if (bk.city !== th.city) return json({ error: `That booking is in ${CITIES[bk.city]?.name || bk.city}; your profile is in ${CITIES[th.city]?.name || th.city}.` }, 400);
  if (bk.therapist_id && bk.therapist_id !== th.id) return json({ error: "Someone else already took this booking." }, 409);
  if (["cancelled", "no_show"].includes(bk.status)) return json({ error: "This booking is closed." }, 400);
  await env.DB.prepare("UPDATE bookings SET therapist_id = ? WHERE id = ? AND (therapist_id IS NULL OR therapist_id = ?)").bind(th.id, id, th.id).run();
  return json({ ok: true, therapist: th.name });
}

async function adminClients(env, admin, url) {
  const city = scope(admin, url.searchParams.get("city"));
  const qs = clean(url.searchParams.get("q"), 60);
  const w = cityWhere(city, "b.city");
  let sql = `SELECT u.id, u.name, u.email, u.phone, u.city, u.photo, u.created_at, u.referred_by, u.nearest_city, u.city_text, u.intake, u.approved, u.birthday,
      (SELECT name FROM users r WHERE r.id = u.referred_by) referrer_name,
      COUNT(b.id) sessions, SUM(b.status='done') done, MAX(b.date) last_visit,
      (SELECT COUNT(*) FROM credits c WHERE c.user_id = u.id AND c.status = 'available') credits,
      (SELECT SUM(remaining) FROM client_packages cp WHERE cp.user_id = u.id AND cp.status = 'paid') package_left
    FROM users u LEFT JOIN bookings b ON b.user_id = u.id AND b.status IN ('paid','confirmed','done')${w.sql}${isEmployee(admin) ? " AND (b.therapist_id IS NULL OR b.therapist_id = ?)" : ""}
    WHERE 1=1`;
  const args = [...w.args]; if (isEmployee(admin)) args.push((await therapistOf(env, admin))?.id || "");
  // a city admin sees everyone who chose that room (questionnaire / profile) or has booked there, even before a first session
  if (city) sql += " AND (u.nearest_city = ? OR u.city = ? OR EXISTS (SELECT 1 FROM bookings x WHERE x.user_id = u.id AND x.city = ?))", args.push(city, city, city);
  if (qs) sql += " AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)", args.push(`%${qs}%`, `%${qs}%`, `%${qs}%`);
  sql += " GROUP BY u.id ORDER BY last_visit DESC NULLS LAST, u.created_at DESC LIMIT 300";
  const r = await env.DB.prepare(sql).bind(...args).all();
  r.results.forEach((c) => { c.flags = healthFlags(c.intake); c.has_intake = Boolean(c.intake); delete c.intake; });
  return json({ clients: r.results, city });
}

async function adminClient(env, admin, id) {
  const u = await env.DB.prepare("SELECT id, name, email, phone, city, photo, notes, birthday, referral_code, referred_by, created_at, last_login, country, city_text, nearest_city, intake, lang, google_sub, apple_sub, approved, preferred_therapist FROM users WHERE id = ?").bind(id).first();
  if (!u) return json({ error: "Not found" }, 404);
  const city = isOwner(admin) ? null : admin.role;
  const w = cityWhere(city);
  const [bookings, credits, referrer, checkins, packages, photos, messages] = await Promise.all([
    env.DB.prepare(`SELECT b.id, b.city, b.service_name, b.date, b.slot, b.amount, b.currency, b.discount_kind, b.status, b.source, b.rating, b.feedback, b.therapist_note, t.name therapist FROM bookings b LEFT JOIN therapists t ON t.id = b.therapist_id WHERE b.user_id = ? AND b.status != 'pending'${w.sql.replace(" city = ?", " b.city = ?")} ORDER BY b.date DESC`).bind(id, ...w.args).all(),
    env.DB.prepare("SELECT kind, pct, status, reason, created_at FROM credits WHERE user_id = ? ORDER BY created_at DESC").bind(id).all(),
    u.referred_by ? env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(u.referred_by).first() : null,
    env.DB.prepare("SELECT date, pain, energy, sleep, note FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT 12").bind(id).all(),
    env.DB.prepare("SELECT id, name, city, sessions, remaining, currency, status, expires_at, paid_at FROM client_packages WHERE user_id = ? AND status = 'paid' ORDER BY paid_at DESC").bind(id).all(),
    env.DB.prepare("SELECT id, booking_id, kind, note, consent, created_at FROM photos WHERE user_id = ? ORDER BY created_at DESC").bind(id).all(),
    env.DB.prepare("SELECT kind, channel, status, detail, created_at FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").bind(id).all(),
  ]);
  if (city && bookings.results.length === 0 && u.nearest_city !== city && u.city !== city) return json({ error: "Not found" }, 404); // nothing to do with this admin's city
  const painLog = (await env.DB.prepare("SELECT at, areas, source, booking_id FROM pain_log WHERE user_id = ? ORDER BY at DESC, rowid DESC LIMIT 12").bind(u.id).all().catch(() => ({ results: [] }))).results.map(painRow);
  return json({ pain_log: painLog, client: { ...u, intake: parseIntake(u.intake), flags: healthFlags(u.intake), referrer_name: referrer?.name || null }, bookings: bookings.results, credits: credits.results, checkins: checkins.results, packages: packages.results, photos: photos.results, messages: messages.results });
}

async function adminSaveSettings(req, env, admin) {
  if (!isOwner(admin)) return json({ error: "Only the owner can change this." }, 403);
  const b = await body(req);
  const cur = await settings(env);
  const num = (v, lo, hi, d) => String(Math.min(hi, Math.max(lo, Number(v) || d)));
  const stmts = [
    env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('loyalty_every', ?)").bind(num(b.loyalty_every ?? cur.loyalty_every, 2, 50, 10)),
    env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('captain_pct', ?)").bind(num(b.captain_pct ?? cur.captain_pct, 0, 50, 10)),
    env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('referral_pct', ?)").bind(num(b.referral_pct ?? cur.referral_pct, 0, 100, 40)),
    env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('birthday_pct', ?)").bind(num(b.birthday_pct ?? cur.birthday_pct, 0, 100, 20)),
    env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('package_pct', ?)").bind(num(b.package_pct ?? cur.package_pct, 0, 100, 15)),
    env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('cancel_hours', ?)").bind(num(b.cancel_hours ?? cur.rules.cancel_hours, 0, 168, 24)),
    env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('late_pct', ?)").bind(num(b.late_pct ?? cur.rules.late_pct, 0, 100, 100)),
    env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('noshow_pct', ?)").bind(num(b.noshow_pct ?? cur.rules.noshow_pct, 0, 100, 100)),
  ];
  const link = (v) => { v = clean(v, 300); return /^https?:\/\//.test(v) ? v : ""; };
  for (const c of CITY_KEYS) {
    if (b.gmaps?.[c] !== undefined) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").bind(`gmaps_${c}`, link(b.gmaps[c])));
    if (b.review?.[c] !== undefined) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").bind(`review_${c}`, link(b.review[c])));
    if (b.whatsapp?.[c] !== undefined) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").bind(`wa_${c}`, clean(b.whatsapp[c], 20).replace(/[^\d+]/g, "")));
    if (b.address?.[c] !== undefined) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").bind(`addr_${c}`, String(b.address[c] ?? "").replace(/[^\S\n]+/g, " ").split("\n").map((l) => clean(l, 80)).filter(Boolean).slice(0, 4).join("\n")));
    if (b.team?.[c] !== undefined) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").bind(`team_${c}`, clean(b.team[c], 120)));
  }
  if (Array.isArray(b.cities_open)) { const f = b.cities_open.filter((k) => CITY_KEYS.includes(k)); if (!f.length) return json({ error: "Keep at least one room open." }, 400); stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('cities_open', ?)").bind(JSON.stringify(f))); }
  await env.DB.batch(stmts);
  return json(await settings(env));
}
async function adminList(env, admin) {
  if (!isOwner(admin)) return json({ error: "Only the owner can see this." }, 403);
  const r = await env.DB.prepare("SELECT a.id, a.email, a.username, a.name, a.role, a.level, a.photo, a.phone, a.notify, a.disabled, a.created_at, a.last_login, t.id therapist_id, t.name therapist_name, t.city therapist_city FROM admins a LEFT JOIN therapists t ON t.admin_id = a.id ORDER BY a.created_at").all();
  return json({ admins: r.results });
}
async function adminCreate(req, env, admin) {
  if (!isOwner(admin)) return json({ error: "Only the owner can add admins." }, 403);
  const b = await body(req);
  const email = normEmail(b.email), name = clean(b.name, 80), role = ["all", ...CITY_KEYS].includes(b.role) ? b.role : null, password = String(b.password || "");
  if (!email || !name || !role || password.length < 10) return json({ error: "Name, email or username, role and a password of at least 10 characters." }, 400);
  const username = b.username === undefined ? null : validUsername(b.username); if (username === false) return json({ error: "A username is 3 to 24 letters, digits, dots, dashes or underscores." }, 400);
  const taken0 = await signinTaken(env, [email, username], null); if (taken0) return json({ error: `"${taken0}" is already another account's sign-in.` }, 409);
  const { hash, salt } = await hashPassword(password), id = randomId(), level = levelFor(role, b.level, null);
  try { await env.DB.prepare("INSERT INTO admins (id, email, name, role, pass_hash, salt, username, level) VALUES (?,?,?,?,?,?,?,?)").bind(id, email, name, role, hash, salt, username, level).run(); }
  catch { return json({ error: "That email or username already has admin access." }, 409); }
  return json({ ok: true, id });
}
async function adminDelete(env, admin, id) {
  if (!isOwner(admin)) return json({ error: "Only the owner can remove admins." }, 403);
  if (id === admin.id) return json({ error: "You can't remove yourself." }, 400);
  const a = await env.DB.prepare("SELECT role FROM admins WHERE id = ?").bind(id).first();
  if (a?.role === "platform") return json({ error: "The platform account is managed by Amico Mio, not from here." }, 403);
  await env.DB.batch([env.DB.prepare("UPDATE therapists SET admin_id = NULL WHERE admin_id = ?").bind(id), env.DB.prepare("DELETE FROM admins WHERE id = ?").bind(id)]);
  return json({ ok: true });
}
// Any admin: own name, phone, photo, "email me about bookings"
async function adminProfile(req, env, admin) {
  const b = await body(req);
  const photo = b.photo === undefined ? admin.photo : b.photo === null ? null : validPhoto(b.photo) || admin.photo;
  let username = admin.username || null, email = admin.email;
  if (b.username !== undefined) { username = validUsername(b.username); if (username === false) return json({ error: "A username is 3 to 24 letters, digits, dots, dashes or underscores." }, 400); }
  if (b.email !== undefined && b.email !== null && String(b.email).trim() !== "" && normEmail(b.email) !== admin.email) { email = validEmail(b.email); if (!email) return json({ error: "That doesn't look like an email address." }, 400); }
  if (!email.includes("@") && !username) return json({ error: "Keep a username until you've added an email." }, 400);
  const taken = await signinTaken(env, [username, email], admin.id); if (taken) return json({ error: `"${taken}" is already another account's sign-in.` }, 409);
  try { await env.DB.prepare("UPDATE admins SET name = ?, phone = ?, photo = ?, notify = ?, username = ?, email = ? WHERE id = ?").bind(clean(b.name, 80) || admin.name, b.phone === undefined ? admin.phone : clean(b.phone, 40), photo, b.notify === undefined ? admin.notify ?? 1 : b.notify ? 1 : 0, username, email, admin.id).run(); }
  catch { return json({ error: "That username or email is already used by another account." }, 409); }
  if (email.includes("@") && email !== admin.email) await sendEmail(env, { to: email, subject: "Your Zen Recovery notifications now come here", text: [`Hi ${clean(b.name, 80) || admin.name || "there"},`, ``, `This address now receives your Zen Recovery bookings and client messages, and it's your sign-in at ${env.SITE_URL}/admin (same password as before).`, ``, `If that wasn't you, sign in and change it under Settings → your profile.`].join("\n") }).catch(() => false);
  return json({ admin: pub(await env.DB.prepare("SELECT * FROM admins WHERE id = ?").bind(admin.id).first()) });
}
// Owner: change another admin's name, role or reset their password
async function adminEdit(req, env, admin, id) {
  if (!isOwner(admin)) return json({ error: "Only the owner can change admins." }, 403);
  const a = await env.DB.prepare("SELECT * FROM admins WHERE id = ?").bind(id).first();
  if (!a) return json({ error: "Not found" }, 404);
  if (a.role === "platform") return json({ error: "The platform account is managed by Amico Mio, not from here." }, 403);
  const b = await body(req);
  const role = ["all", ...CITY_KEYS].includes(b.role) ? b.role : a.role;
  if (id === admin.id && role !== "all") return json({ error: "You can't remove your own owner access." }, 400);
  let hash = a.pass_hash, salt = a.salt;
  if (b.password !== undefined) { if (String(b.password).length < 10) return json({ error: "Use at least 10 characters." }, 400); ({ hash, salt } = await hashPassword(String(b.password))); }
  let username = a.username || null; if (b.username !== undefined) { username = validUsername(b.username); if (username === false) return json({ error: "A username is 3 to 24 letters, digits, dots, dashes or underscores." }, 400); const t2 = await signinTaken(env, [username], id); if (t2) return json({ error: `"${t2}" is already another account's sign-in.` }, 409); }
  const level = levelFor(role, b.level, a.level);
  const disabled = a.disabled || 0;   // on/off is the platform account's call (adminSwitch), never the owner's
  try { await env.DB.prepare("UPDATE admins SET name = ?, role = ?, pass_hash = ?, salt = ?, username = ?, level = ?, disabled = ? WHERE id = ?").bind(clean(b.name, 80) || a.name, role, hash, salt, username, level, disabled, id).run(); }
  catch { return json({ error: "That username is already used by another account." }, 409); }
  // an account narrowed to one city can't stay linked to a therapist profile in another
  if (role !== "all") await env.DB.prepare("UPDATE therapists SET admin_id = NULL WHERE admin_id = ? AND city != ?").bind(id, role).run();
  return json({ ok: true });
}
// A temporary password nobody has to type by hand: three short words and two digits, e.g. "calm-cup-river-47". Easy to read out, hard to guess.
const WORDS = ["calm", "cup", "river", "sand", "palm", "wave", "stone", "reef", "dune", "salt", "moon", "olive", "fig", "lemon", "coral", "pearl", "sage", "mint", "cedar", "amber", "north", "delta", "nile", "arno", "sinai", "zayed", "maadi", "dahab"];
function tempPassword() { const a = new Uint32Array(4); crypto.getRandomValues(a); return `${WORDS[a[0] % WORDS.length]}-${WORDS[a[1] % WORDS.length]}-${WORDS[a[2] % WORDS.length]}-${10 + (a[3] % 90)}`; }
// Owner: give an account a fresh temporary password and deliver it. With a real email the password goes to the person by email and is
// never shown; for a username-only account it comes back once so the owner can pass it on in person.
// 2026-09-15 (Ash: "only I can put it back on or off"): the platform account switches any team sign-in off or on; the owner only sees the badge.
async function adminSwitch(req, env, admin, id) {
  if (!isPlatform(admin)) return json({ error: "Only the platform account (Amico Mio) switches sign-ins on or off." }, 403);
  const a = await env.DB.prepare("SELECT id, role, name FROM admins WHERE id = ?").bind(id).first();
  if (!a) return json({ error: "Not found" }, 404);
  if (a.role === "platform") return json({ error: "The platform account can't be switched." }, 400);
  const b = await body(req), disabled = b.disabled ? 1 : 0;
  await env.DB.prepare("UPDATE admins SET disabled = ? WHERE id = ?").bind(disabled, id).run();
  return json({ ok: true, id, name: a.name, disabled });
}
async function adminInvite(req, env, admin, id) {
  if (!isOwner(admin)) return json({ error: "Only the owner can send sign-ins." }, 403);
  const a = await env.DB.prepare("SELECT * FROM admins WHERE id = ?").bind(id).first();
  if (!a || a.role === "platform") return json({ error: "Not found" }, 404);
  // the owner just typed a password and may already have told the person: if it is sent along and matches, email that one and keep it; otherwise a fresh temporary one replaces the current
  const b = await body(req).catch(() => ({}));
  const keep = b && typeof b.password === "string" && b.password.length >= 10 && (await verifyPassword(b.password, a.pass_hash, a.salt));
  const password = keep ? b.password : tempPassword();
  if (!keep) { const { hash, salt } = await hashPassword(password); await env.DB.prepare("UPDATE admins SET pass_hash = ?, salt = ? WHERE id = ?").bind(hash, salt, id).run(); }
  const signin = a.username && a.email.includes("@") ? `${a.email} (or the username "${a.username}")` : a.email;
  let sent = false;
  if (a.email.includes("@")) sent = await sendEmail(env, { to: a.email, subject: "Your Zen Recovery admin sign-in", text: [`Hi ${a.name},`, ``, `Here is your sign-in for the Zen Recovery admin:`, ``, `Where:     ${env.SITE_URL}/admin`, `Sign in:   ${signin}`, `Password:  ${password}`, ``, `This password is temporary. After signing in, change it under Settings → Your password.`, ``, `Zen Recovery`].join("\n") });
  return json({ ok: true, sent, signin, kept: Boolean(keep), password: sent ? undefined : password });
}
async function adminPassword(req, env, admin) {
  const b = await body(req);
  if (!(await verifyPassword(String(b.current || ""), admin.pass_hash, admin.salt))) return json({ error: "Current password is wrong." }, 400);
  if (String(b.password || "").length < 10) return json({ error: "Use at least 10 characters." }, 400);
  const { hash, salt } = await hashPassword(String(b.password));
  await env.DB.prepare("UPDATE admins SET pass_hash = ?, salt = ? WHERE id = ?").bind(hash, salt, admin.id).run();
  return json({ ok: true });
}

// ---------- stripe signature ----------
async function verifyStripeSignature(payload, header, secret) {
  if (!secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts.t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== parts.v1.length) return false;
  let out = 0; for (let i = 0; i < hex.length; i++) out |= hex.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return out === 0;
}
