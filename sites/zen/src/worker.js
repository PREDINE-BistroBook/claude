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
//                      └─ application_fee_amount (2%) ──► platform account (AmicoMioFlorence)
//
// Roles: an admin with role "all" sees every city; role "cairo" | "dahab" | "florence" is locked to that city —
// every admin query is filtered by scope() on the server, never by the browser.
//
// Bindings (wrangler.toml): DB (D1), ASSETS, PHOTOS (R2, optional).  Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// RESEND_API_KEY, SESSION_SECRET, ADMIN_BOOTSTRAP_EMAIL + ADMIN_BOOTSTRAP_PASSWORD (first owner login, only while the
// admins table is empty), GOOGLE_CLIENT_SECRET, APPLE_PRIVATE_KEY, WA_TOKEN, TWILIO_SID, TWILIO_TOKEN.
// Vars: ZEN_STRIPE_ACCOUNT, ZEN_NOTIFY_EMAIL, FROM_EMAIL, SITE_URL, GOOGLE_CLIENT_ID, APPLE_*, WA_*, TWILIO_FROM,
// DEV_MAGIC_LINK ("1" returns the sign-in link in the response — local testing only).

import { CITIES, SLOTS } from "./catalog.js";
import { randomId, signPayload, verifyPayload, getCookie, setCookie, clearCookie, hashPassword, verifyPassword } from "./auth.js";
import { CITY_KEYS, USER_COOKIE, ADMIN_COOKIE, json, clean, normEmail, isDate, isTime, fmt, now, today, feeOn, body, isLive, parseIntake, healthFlags, settings, currentUser, currentAdmin, scope, sendEmail, sendSms, stripeCheckout, slotsFor, createUser, sessionCookieFor, welcomeEmail, catalog, serviceOf, notifyList } from "./lib.js";
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
      console.error(e);
      return json({ error: "Something went wrong on our side. Try again in a minute." }, 500);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env)); },
};

async function route(req, env, url, ctx) {
  const p = url.pathname, m = req.method;
  if (p === "/api/status") return status(env);
  if (p === "/api/catalog" && m === "GET") return publicCatalog(env);
  if (p === "/api/auth/google" && m === "GET") return googleStart(env, url);
  if (p === "/api/auth/google/callback" && m === "GET") return googleCallback(req, env, url);
  if (p === "/api/me/checkins" && m === "GET") return myCheckins(req, env);
  if (p === "/api/me/checkins" && m === "POST") return saveCheckin(req, env);
  { const fb = p.match(/^\/api\/me\/bookings\/([a-z0-9]+)\/feedback$/); if (fb && m === "POST") return bookingFeedback(req, env, fb[1]); }
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
    if (p === "/api/admin/me") return json({ admin: pub(admin), cities: await cityMeta(env), settings: await settings(env), photos: authFlags(env).photos, live: isLive(env) });
    if (p === "/api/admin/profile" && m === "PUT") return adminProfile(req, env, admin);
    if (p === "/api/admin/stats" && m === "GET") return adminStats(env, admin, url);
    if (p === "/api/admin/bookings" && m === "GET") return adminBookings(env, admin, url);
    if (p === "/api/admin/bookings" && m === "POST") return adminCreateBooking(req, env, admin);
    let mm = p.match(/^\/api\/admin\/bookings\/([a-z0-9]+)$/);
    if (mm && m === "PATCH") return adminUpdateBooking(req, env, admin, mm[1]);
    if (p === "/api/admin/clients" && m === "GET") return adminClients(env, admin, url);
    mm = p.match(/^\/api\/admin\/clients\/([a-z0-9]+)$/);
    if (mm && m === "GET") return adminClient(env, admin, mm[1]);
    if (p === "/api/admin/settings" && m === "GET") return json(await settings(env));
    if (p === "/api/admin/settings" && m === "PUT") return adminSaveSettings(req, env, admin);
    if (p === "/api/admin/admins" && m === "GET") return adminList(env, admin);
    if (p === "/api/admin/admins" && m === "POST") return adminCreate(req, env, admin);
    mm = p.match(/^\/api\/admin\/admins\/([a-z0-9]+)$/);
    if (mm && m === "DELETE") return adminDelete(env, admin, mm[1]);
    if (mm && m === "PATCH") return adminEdit(req, env, admin, mm[1]);
    if (p === "/api/admin/password" && m === "POST") return adminPassword(req, env, admin);
    return adminFeatureRoute(req, env, url, admin);
  }
  return featureRoute(req, env, url, ctx);
}

// ---------- small helpers ----------
const pub = (a) => ({ id: a.id, email: a.email, name: a.name, role: a.role, photo: a.photo || null, phone: a.phone || "", notify: a.notify ?? 1 });
async function cityMeta(env) { const c = await catalog(env); return Object.fromEntries(CITY_KEYS.map((k) => [k, { name: c[k].name, currency: c[k].currency, services: Object.values(c[k].services).map(({ photo, ...s }) => ({ ...s, has_photo: Boolean(photo) })) }])); }
// What the website reads on load: services and prices per city (from the admin), address/team/WhatsApp/Maps per city (settings)
async function publicCatalog(env) {
  const [c, st] = await Promise.all([catalog(env), settings(env)]);
  return json({ cities: Object.fromEntries(CITY_KEYS.map((k) => [k, { name: c[k].name, currency: c[k].currency.toUpperCase(), address: st.address[k] ? st.address[k].split("\n").map((l) => l.trim()).filter(Boolean) : null, team: st.team[k] || null, whatsapp: st.whatsapp[k] || null, gmaps: st.gmaps[k] || null,
    services: Object.values(c[k].services).map((s) => ({ id: s.id, name: s.short, dur: s.minutes, price: s.amount, desc: s.description, photo: s.photo })) }])) }, 200, { "cache-control": "no-store" });
}
const INTAKE_LISTS = ["goals", "pain", "health"], INTAKE_STR = ["activity", "sport", "experience", "health_notes", "contact", "time_pref", "completed_at"];
function cleanIntake(v) { // whitelist keys, cap sizes; stored as JSON text
  if (!v || typeof v !== "object") return null;
  const o = {};
  for (const k of INTAKE_LISTS) if (Array.isArray(v[k])) o[k] = v[k].slice(0, 20).map((x) => clean(x, 30));
  for (const k of INTAKE_STR) if (v[k] != null) o[k] = clean(v[k], k === "health_notes" ? 600 : 60);
  return JSON.stringify(o).slice(0, 4000);
}
const slotLabel = (s) => SLOTS[s] || s;

async function status(env) {
  const st = await settings(env);
  const f = authFlags(env);
  return json({ live: isLive(env), preview: !isLive(env), google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), apple: f.apple, sms: f.sms,
    settings: { loyalty_every: st.loyalty_every, referral_pct: st.referral_pct, birthday_pct: st.birthday_pct, package_pct: st.package_pct }, gmaps: st.gmaps, whatsapp: st.whatsapp, review: st.review });
}

// ---------- client auth ----------
async function requestLink(req, env) {
  const b = await body(req);
  if (b.via === "sms") return requestSms(env, b);
  const email = normEmail(b.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "That email doesn't look right." }, 400);
  let user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  let created = false;
  if (!user) {
    const name = clean(b.name, 80);
    if (!name) return json({ error: "Tell us your name so we know who's coming.", needName: true }, 400);
    user = await createUser(env, { email, name, ref: b.ref, city: b.city, lang: b.lang });
    created = true;
  }
  const link = await loginLink(env, user.id);
  await sendEmail(env, {
    to: email,
    subject: created ? "Welcome to Zen Recovery — your sign-in link" : "Your Zen Recovery sign-in link",
    text: [`Hi ${user.name},`, ``, `Tap to sign in (the link works for 20 minutes):`, link, ``, `If you didn't ask for this, ignore it.`, ``, `Zen Recovery`].join("\n"),
  });
  return json({ ok: true, created, ...(env.DEV_MAGIC_LINK === "1" ? { link } : {}) });
}
async function loginLink(env, userId) {
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
  const link = await loginLink(env, user.id);
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
  return { user, credits: credits.results, packages: packages.results, stats: { done: stats.done || 0, upcoming: stats.upcoming || 0 }, settings: s, referrer: referrer?.name || null, invited: invited.results, share_url: `${env.SITE_URL}/account?ref=${u.referral_code}` };
}

async function updateMe(req, env) {
  const u = await currentUser(req, env);
  if (!u) return json({ error: "Sign in first." }, 401);
  const b = await body(req);
  const photo = typeof b.photo === "string" && b.photo.startsWith("data:image/") && b.photo.length < 160000 ? b.photo : b.photo === null ? null : u.photo;
  const country = ["EG", "IT", "other"].includes(b.country) ? b.country : u.country;
  const nearest = CITY_KEYS.includes(b.nearest_city) ? b.nearest_city : b.nearest_city === null ? null : u.nearest_city;
  const intake = b.intake === undefined ? u.intake : cleanIntake(b.intake);
  const lang = ["en", "it", "ar"].includes(b.lang) ? b.lang : u.lang;
  const therapist = b.preferred_therapist === undefined ? u.preferred_therapist : clean(b.preferred_therapist, 40) || null;
  await env.DB.prepare("UPDATE users SET name = ?, phone = ?, city = ?, notes = ?, birthday = ?, photo = ?, country = ?, city_text = ?, nearest_city = ?, intake = ?, lang = ?, preferred_therapist = ? WHERE id = ?")
    .bind(clean(b.name, 80) || u.name, b.phone === undefined ? u.phone : clean(b.phone, 40), CITY_KEYS.includes(b.city) ? b.city : (nearest || u.city), b.notes === undefined ? u.notes : clean(b.notes, 1000), b.birthday === undefined ? u.birthday : (isDate(b.birthday || "") ? b.birthday : null), photo, country, b.city_text === undefined ? u.city_text : clean(b.city_text, 80), nearest, intake, lang, therapist, u.id).run();
  return json(await userBundle(env, await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first()));
}

async function myBookings(req, env) {
  const u = await currentUser(req, env);
  if (!u) return json({ error: "Sign in first." }, 401);
  const r = await env.DB.prepare("SELECT b.id, b.city, b.service_name, b.date, b.slot, b.amount, b.list_amount, b.currency, b.discount_kind, b.status, b.source, b.created_at, b.rating, b.feedback, b.therapist_note, b.therapist_id, t.name therapist FROM bookings b LEFT JOIN therapists t ON t.id = b.therapist_id WHERE b.user_id = ? AND b.status != 'pending' ORDER BY b.date DESC, b.created_at DESC").bind(u.id).all();
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
  const name = clean(b.name, 80), email = normEmail(b.email), phone = clean(b.phone, 40), note = clean(b.note, 500), date = clean(b.date, 10);
  if (!name || !email || !phone || !isDate(date)) return json({ error: "Please fill in your name, WhatsApp number, email and a day." }, 400);
  if (date < today()) return json({ error: "That day has already passed." }, 400);

  // time: exact slot when the city has an availability calendar, otherwise a morning/afternoon/evening window
  const avail = await slotsFor(env, cityKey, date, null);
  let slot, therapist_id = null;
  if (avail.mode === "slots") {
    slot = clean(b.slot, 5);
    const s = avail.slots.find((x) => x.time === slot);
    if (!s) return json({ error: "That time isn't free any more — pick another one.", slots: avail.slots }, 409);
    const want = clean(b.therapist_id, 40) || null;
    if (want && !s.therapists.includes(want)) return json({ error: "That therapist isn't free at that time.", slots: avail.slots }, 409);
    therapist_id = want || s.therapists[0] || null;
  } else slot = SLOTS[b.slot] ? b.slot : "morning";

  const user = await currentUser(req, env);
  const list = svc.amount;
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
  const base = { id, user_id: user?.id || null, email, name, phone, city: cityKey, service_id: svc.id, service_name: svc.name, date, slot, note, list_amount: list, amount, currency: city.currency, discount_kind, credit_id: credit?.id || null, platform_fee: feeOn(amount), therapist_id, package_id: pack?.id || null, gift_code: gift?.code || null, partner_code: partner?.code || null };

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
  if (!isLive(env)) return json({ preview: true, error: "Payments are not switched on yet." }, 503);

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

async function insertBooking(env, o) {
  const cols = ["id", "user_id", "email", "name", "phone", "city", "service_id", "service_name", "date", "slot", "note", "list_amount", "amount", "currency", "discount_kind", "credit_id", "platform_fee", "status", "source", "stripe_session", "payment_intent", "paid_at", "done_at", "therapist_id", "package_id", "gift_code", "partner_code"];
  await env.DB.prepare(`INSERT INTO bookings (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...cols.map((c) => o[c] ?? (c === "source" ? "web" : null))).run();
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

// After a booking is paid (card, free reward, or manual): referral reward for the inviter, emails to Zen and the client.
async function afterPaid(env, bk) {
  if (bk.user_id) await maybeRewardReferrer(env, bk.user_id);
  const city = CITIES[bk.city], exact = isTime(bk.slot), th = await therapistName(env, bk.therapist_id);
  await Promise.all([
    sendEmail(env, {
      to: await notifyList(env, bk.city),
      subject: `New booking · ${city.name} · ${bk.service_name} · ${bk.date} ${slotLabel(bk.slot)}`,
      text: [`New booking through the website.`, ``, `City:     ${city.name}`, `Session:  ${bk.service_name}`, `Day:      ${bk.date}`, `Time:     ${slotLabel(bk.slot)}`, th ? `Therapist: ${th}` : null, ``,
        `Client:   ${bk.name}`, `WhatsApp: ${bk.phone}`, `Email:    ${bk.email}`, `Note:     ${bk.note || "—"}`, bk.partner_code ? `Partner:  ${bk.partner_code}` : null, ``, `Paid:     ${paidLine(bk)}`, ``,
        exact ? `The time is fixed. Mark it "Confirmed" in the admin once you've said hello on WhatsApp: ${env.SITE_URL}/admin` : `Confirm the exact hour with the client on WhatsApp, then mark it "Confirmed" in the admin: ${env.SITE_URL}/admin`].filter((l) => l !== null).join("\n"),
    }),
    sendEmail(env, {
      to: bk.email,
      subject: `Your Zen Recovery session in ${city.name} — ${bk.date}`,
      text: [`Hi ${bk.name},`, ``, `Your session is reserved: ${bk.service_name}, ${bk.date}, ${slotLabel(bk.slot)}${th ? ` with ${th}` : ""}. ${paidLine(bk)}.`, ``,
        exact ? `Zen will message you on WhatsApp (${bk.phone}) with the address and anything to bring.` : `Zen will message you on WhatsApp (${bk.phone}) to confirm the exact hour.`, ``,
        `Before: eat something light, drink water. After: keep warm, no cold showers or swimming for about six hours.`, ``,
        `Your sessions, rewards and invite link: ${env.SITE_URL}/account`, ``, `See you soon,`, `Zen Recovery`].join("\n"),
    }),
  ]);
}
async function afterReview(env, bk) {
  const city = CITIES[bk.city];
  await Promise.all([
    sendEmail(env, { to: await notifyList(env, bk.city), subject: `Needs a therapist's OK · ${city.name} · ${bk.name} · ${bk.date}`, text: [`${bk.name} booked ${bk.service_name} for ${bk.date} ${slotLabel(bk.slot)} but ticked a health red flag (pregnancy, blood thinners, bleeding/heart condition, recent surgery…).`, ``, `Nothing was charged. Read their answers and approve or cancel in the admin → Needs review: ${env.SITE_URL}/admin`, ``, `WhatsApp: ${bk.phone} · Email: ${bk.email}`, `Note: ${bk.note || "—"}`].join("\n") }),
    sendEmail(env, { to: bk.email, subject: `Zen Recovery — one quick check before ${bk.date}`, text: [`Hi ${bk.name},`, ``, `Thanks for booking ${bk.service_name} in ${city.name} on ${bk.date} (${slotLabel(bk.slot)}).`, ``, `Because of what you told us about your health, a therapist looks at your answers first — that's normal and usually quick. Nothing has been charged. You'll get a confirmation (and a WhatsApp) once it's approved, and you pay at the session.`, ``, `Zen Recovery`].join("\n") }),
  ]);
}

async function maybeRewardReferrer(env, userId) {
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

async function maybeRewardLoyalty(env, userId) {
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

// ---------- admin ----------
const cityWhere = (city, col = "city") => (city ? { sql: ` AND ${col} = ?`, args: [city] } : { sql: "", args: [] });

async function adminLogin(req, env) {
  const b = await body(req);
  const email = normEmail(b.email), password = String(b.password || "");
  let a = await env.DB.prepare("SELECT * FROM admins WHERE email = ?").bind(email).first();
  if (!a) { // first owner: bootstrap from secrets while the table is empty
    const count = await env.DB.prepare("SELECT COUNT(*) n FROM admins").first();
    if (count.n === 0 && env.ADMIN_BOOTSTRAP_EMAIL && email === normEmail(env.ADMIN_BOOTSTRAP_EMAIL) && password && password === env.ADMIN_BOOTSTRAP_PASSWORD) {
      const { hash, salt } = await hashPassword(password);
      await env.DB.prepare("INSERT INTO admins (id, email, name, role, pass_hash, salt) VALUES (?,?,?,?,?,?)").bind(randomId(), email, "Owner", "all", hash, salt).run();
      a = await env.DB.prepare("SELECT * FROM admins WHERE email = ?").bind(email).first();
    }
  }
  if (!a || !(await verifyPassword(password, a.pass_hash, a.salt))) return json({ error: "Wrong email or password." }, 401);
  await env.DB.prepare("UPDATE admins SET last_login = ? WHERE id = ?").bind(now(), a.id).run();
  const cookie = await signPayload(env.SESSION_SECRET, { aid: a.id, exp: Math.floor(Date.now() / 1000) + 12 * 3600 });
  return json({ admin: pub(a) }, 200, { "set-cookie": setCookie(ADMIN_COOKIE, cookie, 12 * 3600) });
}

async function adminStats(env, admin, url) {
  const city = scope(admin, url.searchParams.get("city"));
  const w = cityWhere(city);
  const live = "status IN ('paid','confirmed','done')";
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args, ...w.args);
  const [months, thisMonth, lastMonth, byService, byStatus, clients, upcoming, todayRows, byCity, rewards, review, ratings, packs, gifts] = await Promise.all([
    q(`SELECT strftime('%Y-%m', date) m, currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee, SUM(status='done') done, COUNT(DISTINCT COALESCE(user_id, email)) clients
       FROM bookings WHERE ${live} AND date >= date('now','-11 months','start of month') AND date < date('now','+1 month','start of month')${w.sql} GROUP BY m, currency ORDER BY m`).all(),
    q(`SELECT currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee, SUM(status='done') done FROM bookings WHERE ${live} AND date >= date('now','start of month') AND date < date('now','+1 month','start of month')${w.sql} GROUP BY currency`).all(),
    q(`SELECT currency, COUNT(*) n, SUM(amount) rev FROM bookings WHERE ${live} AND date >= date('now','-1 month','start of month') AND date < date('now','start of month')${w.sql} GROUP BY currency`).all(),
    q(`SELECT service_name name, COUNT(*) n, SUM(amount) rev, currency FROM bookings WHERE ${live}${w.sql} GROUP BY service_name, currency ORDER BY n DESC LIMIT 8`).all(),
    q(`SELECT status, COUNT(*) n FROM bookings WHERE status != 'pending'${w.sql} GROUP BY status`).all(),
    q(`SELECT COUNT(DISTINCT COALESCE(user_id, email)) total, COUNT(DISTINCT CASE WHEN created_at >= date('now','start of month') THEN COALESCE(user_id, email) END) new_this_month FROM bookings WHERE ${live}${w.sql}`).first(),
    q(`SELECT COUNT(*) n FROM bookings WHERE status IN ('paid','confirmed') AND date >= date('now')${w.sql}`).first(),
    q(`SELECT b.id, b.name, b.service_name, b.slot, b.status, b.city, t.name therapist FROM bookings b LEFT JOIN therapists t ON t.id = b.therapist_id WHERE b.status IN ('paid','confirmed') AND b.date = date('now')${w.sql.replace(" city = ?", " b.city = ?")} ORDER BY b.slot`).all(),
    admin.role === "all" && !city ? env.DB.prepare(`SELECT city, currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee FROM bookings WHERE ${live} AND date >= date('now','start of month') GROUP BY city, currency`).all() : { results: [] },
    q(`SELECT kind, status, COUNT(*) n FROM credits WHERE user_id IN (SELECT DISTINCT user_id FROM bookings WHERE user_id IS NOT NULL${w.sql}) GROUP BY kind, status`).all(),
    q(`SELECT COUNT(*) n FROM bookings WHERE status = 'review'${w.sql}`).first(),
    q(`SELECT AVG(rating) avg, COUNT(rating) n, SUM(rating = 5) five FROM bookings WHERE rating IS NOT NULL${w.sql}`).first(),
    q(`SELECT currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee, SUM(remaining) remaining FROM client_packages WHERE status = 'paid'${w.sql} GROUP BY currency`).all(),
    q(`SELECT currency, COUNT(*) n, SUM(amount) rev, SUM(platform_fee) fee, SUM(status = 'paid') unused FROM gifts WHERE status IN ('paid','redeemed')${w.sql} GROUP BY currency`).all(),
  ]);
  return json({ city, months: months.results, this_month: thisMonth.results, last_month: lastMonth.results, by_service: byService.results, by_status: byStatus.results, clients, upcoming: upcoming.n, today: todayRows.results, by_city: byCity.results, rewards: rewards.results, review: review.n, ratings, packages: packs.results, gifts: gifts.results, show_fee: admin.role === "all" });
}

async function adminBookings(env, admin, url) {
  const city = scope(admin, url.searchParams.get("city"));
  const w = cityWhere(city);
  const status = clean(url.searchParams.get("status"), 20), from = clean(url.searchParams.get("from"), 10), to = clean(url.searchParams.get("to"), 10), qs = clean(url.searchParams.get("q"), 60);
  let sql = `SELECT b.id, b.user_id, b.name, b.email, b.phone, b.city, b.service_name, b.date, b.slot, b.amount, b.list_amount, b.currency, b.discount_kind, b.platform_fee, b.status, b.source, b.note, b.created_at, b.rating, b.feedback, b.therapist_note, b.therapist_id, b.gift_code, b.partner_code, b.package_id, t.name therapist, u.intake AS user_intake, u.notes AS user_notes, u.nearest_city AS user_nearest, u.lang AS user_lang, u.approved AS user_approved
    FROM bookings b LEFT JOIN users u ON u.id = b.user_id LEFT JOIN therapists t ON t.id = b.therapist_id WHERE b.status != 'pending'${w.sql.replace(" city = ?", " b.city = ?")}`;
  const args = [...w.args];
  if (status) { sql += " AND b.status = ?"; args.push(status); }
  if (isDate(from)) { sql += " AND b.date >= ?"; args.push(from); }
  if (isDate(to)) { sql += " AND b.date <= ?"; args.push(to); }
  if (qs) { sql += " AND (b.name LIKE ? OR b.email LIKE ? OR b.phone LIKE ?)"; args.push(`%${qs}%`, `%${qs}%`, `%${qs}%`); }
  sql += " ORDER BY b.date DESC, b.created_at DESC LIMIT 300";
  const r = await env.DB.prepare(sql).bind(...args).all();
  r.results.forEach((b) => { const i = parseIntake(b.user_intake); b.health = i?.health || []; b.flags = healthFlags(b.user_intake); b.pain = i?.pain || []; b.goals = i?.goals || []; b.experience = i?.experience || null; delete b.user_intake; if (admin.role !== "all") delete b.platform_fee; });
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
  if (!bk || (admin.role !== "all" && bk.city !== admin.role)) return json({ error: "Not found" }, 404);
  const status = ["paid", "confirmed", "done", "cancelled", "no_show"].includes(b.status) ? b.status : null;
  const slot = b.slot !== undefined ? clean(b.slot, 20) : bk.slot;
  const note = b.note !== undefined ? clean(b.note, 500) : bk.note;
  const tnote = b.therapist_note !== undefined ? clean(b.therapist_note, 800) : bk.therapist_note;
  const th = b.therapist_id !== undefined ? clean(b.therapist_id, 40) || null : bk.therapist_id;
  await env.DB.prepare("UPDATE bookings SET status = ?, slot = ?, note = ?, therapist_note = ?, therapist_id = ?, done_at = CASE WHEN ? = 'done' THEN COALESCE(done_at, ?) ELSE done_at END WHERE id = ?")
    .bind(status || bk.status, slot, note, tnote, th, status || bk.status, now(), id).run();
  if (bk.status === "review" && status && status !== "cancelled" && bk.user_id) await env.DB.prepare("UPDATE users SET approved = 1 WHERE id = ?").bind(bk.user_id).run();
  if (status === "done" && bk.status !== "done") await maybeRewardLoyalty(env, bk.user_id);
  if (status === "cancelled" && bk.status !== "cancelled") await restore(env, bk);
  return json({ ok: true });
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
    FROM users u LEFT JOIN bookings b ON b.user_id = u.id AND b.status IN ('paid','confirmed','done')${w.sql}
    WHERE 1=1`;
  const args = [...w.args];
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
  const city = admin.role === "all" ? null : admin.role;
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
  return json({ client: { ...u, intake: parseIntake(u.intake), flags: healthFlags(u.intake), referrer_name: referrer?.name || null }, bookings: bookings.results, credits: credits.results, checkins: checkins.results, packages: packages.results, photos: photos.results, messages: messages.results });
}

async function adminSaveSettings(req, env, admin) {
  if (admin.role !== "all") return json({ error: "Only the owner can change this." }, 403);
  const b = await body(req);
  const cur = await settings(env);
  const num = (v, lo, hi, d) => String(Math.min(hi, Math.max(lo, Number(v) || d)));
  const stmts = [
    env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('loyalty_every', ?)").bind(num(b.loyalty_every ?? cur.loyalty_every, 2, 50, 10)),
    env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('referral_pct', ?)").bind(num(b.referral_pct ?? cur.referral_pct, 0, 100, 40)),
    env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('birthday_pct', ?)").bind(num(b.birthday_pct ?? cur.birthday_pct, 0, 100, 20)),
    env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('package_pct', ?)").bind(num(b.package_pct ?? cur.package_pct, 0, 100, 15)),
  ];
  const link = (v) => { v = clean(v, 300); return /^https?:\/\//.test(v) ? v : ""; };
  for (const c of CITY_KEYS) {
    if (b.gmaps?.[c] !== undefined) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").bind(`gmaps_${c}`, link(b.gmaps[c])));
    if (b.review?.[c] !== undefined) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").bind(`review_${c}`, link(b.review[c])));
    if (b.whatsapp?.[c] !== undefined) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").bind(`wa_${c}`, clean(b.whatsapp[c], 20).replace(/[^\d+]/g, "")));
    if (b.address?.[c] !== undefined) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").bind(`addr_${c}`, String(b.address[c] ?? "").replace(/[^\S\n]+/g, " ").split("\n").map((l) => clean(l, 80)).filter(Boolean).slice(0, 4).join("\n")));
    if (b.team?.[c] !== undefined) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").bind(`team_${c}`, clean(b.team[c], 120)));
  }
  await env.DB.batch(stmts);
  return json(await settings(env));
}
async function adminList(env, admin) {
  if (admin.role !== "all") return json({ error: "Only the owner can see this." }, 403);
  const r = await env.DB.prepare("SELECT id, email, name, role, photo, phone, notify, created_at, last_login FROM admins ORDER BY created_at").all();
  return json({ admins: r.results });
}
async function adminCreate(req, env, admin) {
  if (admin.role !== "all") return json({ error: "Only the owner can add admins." }, 403);
  const b = await body(req);
  const email = normEmail(b.email), name = clean(b.name, 80), role = ["all", ...CITY_KEYS].includes(b.role) ? b.role : null, password = String(b.password || "");
  if (!email || !name || !role || password.length < 10) return json({ error: "Name, email, role and a password of at least 10 characters." }, 400);
  const { hash, salt } = await hashPassword(password);
  try { await env.DB.prepare("INSERT INTO admins (id, email, name, role, pass_hash, salt) VALUES (?,?,?,?,?,?)").bind(randomId(), email, name, role, hash, salt).run(); }
  catch { return json({ error: "That email already has admin access." }, 409); }
  return json({ ok: true });
}
async function adminDelete(env, admin, id) {
  if (admin.role !== "all") return json({ error: "Only the owner can remove admins." }, 403);
  if (id === admin.id) return json({ error: "You can't remove yourself." }, 400);
  await env.DB.prepare("DELETE FROM admins WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
// Any admin: own name, phone, photo, "email me about bookings"
async function adminProfile(req, env, admin) {
  const b = await body(req);
  const photo = typeof b.photo === "string" && b.photo.startsWith("data:image/") && b.photo.length < 160000 ? b.photo : b.photo === null ? null : admin.photo;
  await env.DB.prepare("UPDATE admins SET name = ?, phone = ?, photo = ?, notify = ? WHERE id = ?").bind(clean(b.name, 80) || admin.name, b.phone === undefined ? admin.phone : clean(b.phone, 40), photo, b.notify === undefined ? admin.notify ?? 1 : b.notify ? 1 : 0, admin.id).run();
  return json({ admin: pub(await env.DB.prepare("SELECT * FROM admins WHERE id = ?").bind(admin.id).first()) });
}
// Owner: change another admin's name, role or reset their password
async function adminEdit(req, env, admin, id) {
  if (admin.role !== "all") return json({ error: "Only the owner can change admins." }, 403);
  const a = await env.DB.prepare("SELECT * FROM admins WHERE id = ?").bind(id).first();
  if (!a) return json({ error: "Not found" }, 404);
  const b = await body(req);
  const role = ["all", ...CITY_KEYS].includes(b.role) ? b.role : a.role;
  if (id === admin.id && role !== "all") return json({ error: "You can't remove your own owner access." }, 400);
  let hash = a.pass_hash, salt = a.salt;
  if (b.password !== undefined) { if (String(b.password).length < 10) return json({ error: "Use at least 10 characters." }, 400); ({ hash, salt } = await hashPassword(String(b.password))); }
  await env.DB.prepare("UPDATE admins SET name = ?, role = ?, pass_hash = ?, salt = ? WHERE id = ?").bind(clean(b.name, 80) || a.name, role, hash, salt, id).run();
  return json({ ok: true });
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
