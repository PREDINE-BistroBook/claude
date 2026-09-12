// Second batch of features (2026-09-12): live time slots + therapists, packages, gift vouchers, partner codes,
// waitlist, data export, before/after photos, Apple sign-in, message log, referral leaderboard, health-flag review.
// Public routes come through featureRoute(); admin routes through adminFeatureRoute() (the caller has already
// checked the admin cookie). Everything money-related goes through stripeCheckout() in lib.js (2% platform fee).
import { CITIES } from "./catalog.js";
import { randomId, referralCode, signPayload, verifyPayload, getCookie, clearCookie } from "./auth.js";
import { CITY_KEYS, json, clean, normEmail, isDate, isTime, fmt, now, today, addDays, feeOn, body, isLive, currentUser, scope, sendEmail, stripeCheckout, slotsFor, healthFlags, parseIntake, createUser, sessionCookieFor } from "./lib.js";

const b64u = (s) => btoa(typeof s === "string" ? unescape(encodeURIComponent(s)) : String.fromCharCode(...new Uint8Array(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const cityOf = (k) => (CITY_KEYS.includes(k) ? k : null);
const need = (u) => (u ? null : json({ error: "Sign in first." }, 401));

// =====================================================================================
// PUBLIC
// =====================================================================================
export async function featureRoute(req, env, url, ctx) {
  const p = url.pathname, m = req.method;
  if (p === "/api/slots" && m === "GET") return slots(env, url);
  if (p === "/api/team" && m === "GET") return team(env, url);
  if (p === "/api/packages" && m === "GET") return packages(env, url);
  if (p === "/api/packages/checkout" && m === "POST") return packageCheckout(req, env);
  if (p === "/api/gift/checkout" && m === "POST") return giftCheckout(req, env);
  { const g = p.match(/^\/api\/gift\/([A-Z0-9-]{4,20})$/i); if (g && m === "GET") return giftLookup(env, g[1]); }
  { const pc = p.match(/^\/api\/partner\/([A-Z0-9-]{3,16})$/i); if (pc && m === "GET") return partnerLookup(env, pc[1], url); }
  if (p === "/api/waitlist" && m === "POST") return joinWaitlist(req, env);
  if (p === "/api/me/waitlist" && m === "GET") return myWaitlist(req, env);
  if (p === "/api/me/packages" && m === "GET") return myPackages(req, env);
  if (p === "/api/me/photos" && m === "GET") return myPhotos(req, env);
  if (p === "/api/me/export" && m === "GET") return exportMe(req, env);
  { const ph = p.match(/^\/api\/photo\/([a-z0-9]+)$/); if (ph && m === "GET") return servePhoto(req, env, ph[1]); }
  if (p === "/api/auth/apple" && m === "GET") return appleStart(env, url);
  if (p === "/api/auth/apple/callback" && m === "POST") return appleCallback(req, env);
  return null;
}

// ---------- live slots + team + packages ----------
async function slots(env, url) {
  const city = cityOf(url.searchParams.get("city")), date = clean(url.searchParams.get("date"), 10);
  if (!city || !isDate(date)) return json({ error: "city and date" }, 400);
  if (date < today()) return json({ mode: "slots", slots: [] });
  const th = clean(url.searchParams.get("therapist"), 40) || null;
  const r = await slotsFor(env, city, date, th);
  return json(r, 200, { "cache-control": "no-store" });
}
async function team(env, url) {
  const city = cityOf(url.searchParams.get("city"));
  const r = await env.DB.prepare("SELECT id, city, name, bio, photo, languages FROM therapists WHERE active = 1" + (city ? " AND city = ?" : "") + " ORDER BY city, sort, name").bind(...(city ? [city] : [])).all();
  return json({ therapists: r.results });
}
async function packages(env, url) {
  const city = cityOf(url.searchParams.get("city"));
  const r = await env.DB.prepare("SELECT id, city, name, sessions, amount, currency, months_valid FROM packages WHERE active = 1" + (city ? " AND city = ?" : "") + " ORDER BY city, sort, sessions").bind(...(city ? [city] : [])).all();
  return json({ packages: r.results.map((p) => ({ ...p, per_session: Math.round(p.amount / p.sessions) })) });
}
async function packageCheckout(req, env) {
  const u = await currentUser(req, env); if (!u) return need(u);
  const b = await body(req);
  const pk = await env.DB.prepare("SELECT * FROM packages WHERE id = ? AND active = 1").bind(clean(b.package_id, 40)).first();
  if (!pk) return json({ error: "That package isn't available." }, 400);
  if (!isLive(env)) return json({ preview: true, error: "Payments are not switched on yet." }, 503);
  const id = randomId();
  const { url, id: sid } = await stripeCheckout(env, { amount: pk.amount, currency: pk.currency, name: `${pk.name} · ${pk.sessions} sessions · ${CITIES[pk.city].name}`, description: `Valid ${pk.months_valid} months from purchase`, email: u.email,
    success: `${env.SITE_URL}/account.html?package=1#packages`, cancel: `${env.SITE_URL}/account.html#packages`, metadata: { kind: "package", package_row: id } });
  await env.DB.prepare("INSERT INTO client_packages (id, user_id, package_id, name, city, sessions, remaining, amount, currency, platform_fee, status, stripe_session) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, u.id, pk.id, pk.name, pk.city, pk.sessions, pk.sessions, pk.amount, pk.currency, feeOn(pk.amount), "pending", sid).run();
  return json({ url });
}
// Called from the Stripe webhook (worker.js) when metadata.kind === "package".
export async function packagePaid(env, rowId, paymentIntent) {
  const cp = await env.DB.prepare("SELECT * FROM client_packages WHERE id = ?").bind(rowId).first();
  if (!cp || cp.status !== "pending") return;
  const pk = await env.DB.prepare("SELECT months_valid FROM packages WHERE id = ?").bind(cp.package_id).first();
  const exp = new Date(); exp.setUTCMonth(exp.getUTCMonth() + (pk?.months_valid || 6));
  await env.DB.prepare("UPDATE client_packages SET status = 'paid', paid_at = ?, expires_at = ? WHERE id = ?").bind(now(), exp.toISOString().slice(0, 10), rowId).run();
  const u = await env.DB.prepare("SELECT email, name FROM users WHERE id = ?").bind(cp.user_id).first();
  await sendEmail(env, { to: u.email, subject: `Your ${cp.name} is ready — ${cp.sessions} sessions in ${CITIES[cp.city].name}`, text: [`Hi ${u.name.split(" ")[0]},`, ``, `${cp.sessions} sessions are waiting in your account, valid until ${exp.toISOString().slice(0, 10)}. When you book, pick "Use my package" and there's nothing to pay.`, ``, `${env.SITE_URL}/?city=${cp.city}#book`, ``, `Zen Recovery`].join("\n") });
  await sendEmail(env, { to: env.ZEN_NOTIFY_EMAIL, subject: `Package sold · ${CITIES[cp.city].name} · ${cp.name} · ${fmt(cp.amount, cp.currency)}`, text: `${u.name} (${u.email}) bought ${cp.name} (${cp.sessions} sessions) in ${CITIES[cp.city].name} for ${fmt(cp.amount, cp.currency)}.` });
}
async function myPackages(req, env) {
  const u = await currentUser(req, env); if (!u) return need(u);
  const r = await env.DB.prepare("SELECT id, name, city, sessions, remaining, amount, currency, status, expires_at, paid_at FROM client_packages WHERE user_id = ? AND status = 'paid' ORDER BY paid_at DESC").bind(u.id).all();
  return json({ packages: r.results.map((p) => ({ ...p, usable: p.remaining > 0 && (!p.expires_at || p.expires_at >= today()) })) });
}

// ---------- gift vouchers ----------
async function giftCheckout(req, env) {
  const b = await body(req);
  const city = CITIES[b.city], svc = city?.services[b.service];
  if (!city || !svc) return json({ error: "Pick a city and a session." }, 400);
  const buyer_name = clean(b.buyer_name, 80), buyer_email = normEmail(b.buyer_email), recipient_name = clean(b.recipient_name, 80), recipient_email = normEmail(b.recipient_email), message = clean(b.message, 300);
  if (!buyer_name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer_email) || !recipient_name) return json({ error: "Your name and email, and who the gift is for." }, 400);
  if (!isLive(env)) return json({ preview: true, error: "Payments are not switched on yet." }, 503);
  const id = randomId(), code = "GIFT-" + referralCode();
  const { url, id: sid } = await stripeCheckout(env, { amount: svc.amount, currency: city.currency, name: `Gift: ${svc.name}`, description: `For ${recipient_name}. Sent by email as a code after payment.`, email: buyer_email,
    success: `${env.SITE_URL}/success.html?gift=1`, cancel: `${env.SITE_URL}/#gift`, metadata: { kind: "gift", gift_id: id } });
  await env.DB.prepare("INSERT INTO gifts (id, code, city, service_id, service_name, amount, currency, platform_fee, buyer_name, buyer_email, recipient_name, recipient_email, message, status, stripe_session) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, code, b.city, b.service, svc.name, svc.amount, city.currency, feeOn(svc.amount), buyer_name, buyer_email, recipient_name, recipient_email || null, message, "pending", sid).run();
  return json({ url });
}
export async function giftPaid(env, giftId) {
  const g = await env.DB.prepare("SELECT * FROM gifts WHERE id = ?").bind(giftId).first();
  if (!g || g.status !== "pending") return;
  await env.DB.prepare("UPDATE gifts SET status = 'paid', paid_at = ? WHERE id = ?").bind(now(), giftId).run();
  const cityName = CITIES[g.city].name, link = `${env.SITE_URL}/?city=${g.city}&gift=${g.code}#book`;
  const lines = [`${g.buyer_name} has given you a ${g.service_name.split(" · ")[0]} session with Zen Recovery in ${cityName}.`, ``, g.message ? `"${g.message}"` : null, g.message ? `` : null, `Your gift code: ${g.code}`, ``, `Book your session here (the code fills itself in): ${link}`, ``, `Zen Recovery`].filter((l) => l !== null);
  await sendEmail(env, { to: g.buyer_email, subject: `Your gift for ${g.recipient_name} — code ${g.code}`, text: [`Hi ${g.buyer_name.split(" ")[0]},`, ``, `Thank you. The gift is paid: ${g.service_name} in ${cityName}.`, ``, `Code: ${g.code}`, `Booking link: ${link}`, ``, g.recipient_email ? `We've emailed ${g.recipient_name} too.` : `Forward the code or the link to ${g.recipient_name}.`, ``, `Zen Recovery`].join("\n") });
  if (g.recipient_email) await sendEmail(env, { to: g.recipient_email, subject: `A gift from ${g.buyer_name}: a Zen Recovery session`, text: lines.join("\n") });
  await sendEmail(env, { to: env.ZEN_NOTIFY_EMAIL, subject: `Gift sold · ${cityName} · ${g.service_name} · ${fmt(g.amount, g.currency)}`, text: `${g.buyer_name} (${g.buyer_email}) bought a gift for ${g.recipient_name}. Code ${g.code}.` });
}
async function giftLookup(env, code) {
  const g = await env.DB.prepare("SELECT code, city, service_id, service_name, amount, currency, status, recipient_name FROM gifts WHERE code = ?").bind(code.toUpperCase()).first();
  if (!g) return json({ error: "We don't know that gift code." }, 404);
  if (g.status !== "paid") return json({ error: g.status === "redeemed" ? "This gift has already been used." : "This gift isn't active." }, 400);
  return json({ gift: g });
}

async function partnerLookup(env, code, url) {
  const city = cityOf(url.searchParams.get("city"));
  const pr = await env.DB.prepare("SELECT code, name, pct, city FROM partners WHERE code = ? AND active = 1").bind(code.toUpperCase()).first();
  if (!pr) return json({ error: "We don't know that code." }, 404);
  if (pr.city && city && pr.city !== city) return json({ error: `That code is for ${CITIES[pr.city].name}.` }, 400);
  return json({ partner: pr });
}

// ---------- waitlist ----------
async function joinWaitlist(req, env) {
  const u = await currentUser(req, env); if (!u) return need(u);
  const b = await body(req);
  const city = cityOf(b.city), date = clean(b.date, 10), pref = ["any", "morning", "afternoon", "evening"].includes(b.slot_pref) ? b.slot_pref : "any";
  if (!city || !isDate(date) || date < today()) return json({ error: "Pick a city and a day." }, 400);
  await env.DB.prepare("DELETE FROM waitlist WHERE user_id = ? AND city = ? AND date = ?").bind(u.id, city, date).run();
  await env.DB.prepare("INSERT INTO waitlist (id, user_id, city, date, slot_pref) VALUES (?,?,?,?,?)").bind(randomId(), u.id, city, date, pref).run();
  return json({ ok: true });
}
async function myWaitlist(req, env) {
  const u = await currentUser(req, env); if (!u) return need(u);
  const r = await env.DB.prepare("SELECT id, city, date, slot_pref, notified_at FROM waitlist WHERE user_id = ? AND date >= ? ORDER BY date").bind(u.id, today()).all();
  return json({ waitlist: r.results });
}

// ---------- export (GDPR-style copy of everything we hold) ----------
async function exportMe(req, env) {
  const u = await currentUser(req, env); if (!u) return need(u);
  const [bookings, checkins, credits, packs, photos, msgs] = await Promise.all([
    env.DB.prepare("SELECT city, service_name, date, slot, amount, currency, discount_kind, status, rating, feedback, therapist_note, created_at FROM bookings WHERE user_id = ? AND status != 'pending' ORDER BY date").bind(u.id).all(),
    env.DB.prepare("SELECT date, pain, energy, sleep, note FROM checkins WHERE user_id = ? ORDER BY date").bind(u.id).all(),
    env.DB.prepare("SELECT kind, pct, status, reason, created_at, used_at FROM credits WHERE user_id = ? ORDER BY created_at").bind(u.id).all(),
    env.DB.prepare("SELECT name, city, sessions, remaining, amount, currency, status, expires_at, paid_at FROM client_packages WHERE user_id = ? AND status = 'paid'").bind(u.id).all(),
    env.DB.prepare("SELECT id, kind, note, created_at FROM photos WHERE user_id = ? ORDER BY created_at").bind(u.id).all(),
    env.DB.prepare("SELECT kind, channel, status, created_at FROM messages WHERE user_id = ? ORDER BY created_at").bind(u.id).all(),
  ]);
  const { pass_hash, google_sub, apple_sub, ...user } = u;
  user.intake = parseIntake(user.intake);
  return json({ exported_at: now(), user, bookings: bookings.results, checkins: checkins.results, credits: credits.results, packages: packs.results, photos: photos.results.map((p) => ({ ...p, url: `${env.SITE_URL}/api/photo/${p.id}` })), messages: msgs.results }, 200, { "content-disposition": `attachment; filename="zen-recovery-${today()}.json"` });
}

// ---------- photos (before/after, uploaded by a therapist; the client sees their own) ----------
async function myPhotos(req, env) {
  const u = await currentUser(req, env); if (!u) return need(u);
  const r = await env.DB.prepare("SELECT id, booking_id, kind, note, created_at FROM photos WHERE user_id = ? ORDER BY created_at DESC").bind(u.id).all();
  return json({ photos: r.results });
}
async function servePhoto(req, env, id) {
  const ph = await env.DB.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first();
  if (!ph) return json({ error: "Not found" }, 404);
  const u = await currentUser(req, env);
  let ok = u && u.id === ph.user_id;
  if (!ok) { const t = await verifyPayload(env.SESSION_SECRET, getCookie(req, "zen_a")); ok = Boolean(t?.aid); }
  if (!ok) return json({ error: "Sign in first." }, 401);
  const headers = { "content-type": ph.content_type || "image/jpeg", "cache-control": "private, max-age=3600" };
  if (ph.r2_key !== "d1" && env.PHOTOS) { const o = await env.PHOTOS.get(ph.r2_key); if (o) return new Response(o.body, { headers }); }
  if (ph.data) { const b64 = ph.data.split(",")[1] || ph.data; return new Response(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), { headers }); }
  return json({ error: "Photo file is missing." }, 404);
}

// ---------- Apple sign-in (OAuth code flow, response_mode=form_post) ----------
const APPLE_COOKIE = "zen_ap";
const appleReady = (env) => Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);
async function appleClientSecret(env) {
  const pem = env.APPLE_PRIVATE_KEY.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const t = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "ES256", kid: env.APPLE_KEY_ID })), claims = b64u(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: t, exp: t + 3600, aud: "https://appleid.apple.com", sub: env.APPLE_CLIENT_ID }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64u(sig)}`;
}
async function appleStart(env, url) {
  if (!appleReady(env)) return json({ error: "Apple sign-in isn't set up yet." }, 404);
  const state = randomId(16);
  const cookie = await signPayload(env.SESSION_SECRET, { state, ref: clean(url.searchParams.get("ref"), 12), lang: clean(url.searchParams.get("lang"), 2), exp: Math.floor(Date.now() / 1000) + 600 });
  const q = new URLSearchParams({ client_id: env.APPLE_CLIENT_ID, redirect_uri: `${env.SITE_URL}/api/auth/apple/callback`, response_type: "code id_token", scope: "name email", response_mode: "form_post", state });
  // SameSite=None: Apple POSTs the result back cross-site, so a Lax cookie wouldn't be sent.
  return new Response(null, { status: 302, headers: { location: `https://appleid.apple.com/auth/authorize?${q}`, "set-cookie": `${APPLE_COOKIE}=${encodeURIComponent(cookie)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=600` } });
}
async function appleCallback(req, env) {
  const fail = (why) => { console.error("apple sign-in failed:", why); return new Response(null, { status: 302, headers: { location: `${env.SITE_URL}/account.html?error=apple`, "set-cookie": clearCookie(APPLE_COOKIE) } }); };
  if (!appleReady(env)) return fail("not configured");
  const fd = await req.formData().catch(() => null);
  const st = await verifyPayload(env.SESSION_SECRET, getCookie(req, APPLE_COOKIE));
  const code = fd?.get("code");
  if (!fd || !st || !code || fd.get("state") !== st.state) return fail("state mismatch");
  const r = await fetch("https://appleid.apple.com/auth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.APPLE_CLIENT_ID, client_secret: await appleClientSecret(env), code, grant_type: "authorization_code", redirect_uri: `${env.SITE_URL}/api/auth/apple/callback` }) });
  const tok = await r.json();
  if (!r.ok || !tok.id_token) return fail(tok.error || "token exchange");
  let claims; try { claims = JSON.parse(atob(tok.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return fail("bad id_token"); }
  // The token came straight from Apple over TLS in exchange for our signed client secret, so its claims are trustworthy.
  if (claims.aud !== env.APPLE_CLIENT_ID || claims.iss !== "https://appleid.apple.com" || !claims.email) return fail("claims");
  const email = normEmail(claims.email);
  let name = "";
  try { const uj = JSON.parse(fd.get("user") || "null"); name = clean([uj?.name?.firstName, uj?.name?.lastName].filter(Boolean).join(" "), 80); } catch {}
  let user = await env.DB.prepare("SELECT * FROM users WHERE apple_sub = ? OR email = ?").bind(claims.sub, email).first();
  if (!user) user = await createUser(env, { email, name: name || email.split("@")[0], ref: st.ref, lang: st.lang, apple_sub: claims.sub });
  else if (!user.apple_sub) await env.DB.prepare("UPDATE users SET apple_sub = ? WHERE id = ?").bind(claims.sub, user.id).run();
  const headers = new Headers({ location: `${env.SITE_URL}/account.html` });
  headers.append("set-cookie", await sessionCookieFor(env, user.id)); headers.append("set-cookie", clearCookie(APPLE_COOKIE));
  return new Response(null, { status: 302, headers });
}
export const authFlags = (env) => ({ apple: appleReady(env), sms: Boolean(env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM), photos: Boolean(env.PHOTOS) ? "r2" : "d1" });

// =====================================================================================
// ADMIN  (caller has verified the admin cookie; `admin` is the admins row)
// =====================================================================================
export async function adminFeatureRoute(req, env, url, admin) {
  const p = url.pathname, m = req.method;
  const owner = () => (admin.role === "all" ? null : json({ error: "Only the owner can do this." }, 403));
  let mm;
  if (p === "/api/admin/availability" && m === "GET") return listRows(env, admin, url, "availability", "ORDER BY city, weekday, start");
  if (p === "/api/admin/availability" && m === "POST") return addAvailability(req, env, admin);
  if ((mm = p.match(/^\/api\/admin\/availability\/([a-z0-9]+)$/)) && m === "DELETE") return deleteRow(env, admin, "availability", mm[1]);
  if (p === "/api/admin/blocked" && m === "GET") return listRows(env, admin, url, "blocked", "ORDER BY date, start", "AND date >= date('now','-7 days')");
  if (p === "/api/admin/blocked" && m === "POST") return addBlocked(req, env, admin);
  if ((mm = p.match(/^\/api\/admin\/blocked\/([a-z0-9]+)$/)) && m === "DELETE") return deleteRow(env, admin, "blocked", mm[1]);
  if (p === "/api/admin/therapists" && m === "GET") return listRows(env, admin, url, "therapists", "ORDER BY city, sort, name");
  if (p === "/api/admin/therapists" && m === "POST") return saveTherapist(req, env, admin, null);
  if ((mm = p.match(/^\/api\/admin\/therapists\/([a-z0-9]+)$/)) && m === "PATCH") return saveTherapist(req, env, admin, mm[1]);
  if (mm && m === "DELETE") return deleteRow(env, admin, "therapists", mm[1]);
  if (p === "/api/admin/packages" && m === "GET") return listRows(env, admin, url, "packages", "ORDER BY city, sort, sessions");
  if (p === "/api/admin/packages" && m === "POST") return owner() || savePackage(req, env, null);
  if ((mm = p.match(/^\/api\/admin\/packages\/([a-z0-9]+)$/)) && m === "PATCH") return owner() || savePackage(req, env, mm[1]);
  if (mm && m === "DELETE") return owner() || deleteRow(env, admin, "packages", mm[1]);
  if (p === "/api/admin/packages/sold" && m === "GET") return soldPackages(env, admin, url);
  if (p === "/api/admin/partners" && m === "GET") return owner() || partnersReport(env);
  if (p === "/api/admin/partners" && m === "POST") return owner() || savePartner(req, env, null);
  if ((mm = p.match(/^\/api\/admin\/partners\/([a-z0-9]+)$/)) && m === "PATCH") return owner() || savePartner(req, env, mm[1]);
  if (mm && m === "DELETE") return owner() || deleteRow(env, admin, "partners", mm[1]);
  if (p === "/api/admin/gifts" && m === "GET") return listGifts(env, admin, url);
  if (p === "/api/admin/review" && m === "GET") return reviewList(env, admin);
  if ((mm = p.match(/^\/api\/admin\/clients\/([a-z0-9]+)\/approve$/)) && m === "POST") return approveClient(env, admin, mm[1]);
  if (p === "/api/admin/photos" && m === "GET") return adminPhotos(env, admin, url);
  if (p === "/api/admin/photos" && m === "POST") return uploadPhoto(req, env, admin);
  if ((mm = p.match(/^\/api\/admin\/photos\/([a-z0-9]+)$/)) && m === "DELETE") return deletePhoto(env, admin, mm[1]);
  if (p === "/api/admin/leaderboard" && m === "GET") return leaderboard(env, admin);
  if (p === "/api/admin/messages" && m === "GET") return listMessages(env, admin, url);
  if (p === "/api/admin/waitlist" && m === "GET") return adminWaitlist(env, admin, url);
  if (p === "/api/admin/slots" && m === "GET") return slots(env, url);
  return null;
}

const cityFilter = (admin, url) => scope(admin, url.searchParams.get("city"));
async function listRows(env, admin, url, table, order, extra = "") {
  const city = cityFilter(admin, url);
  const r = await env.DB.prepare(`SELECT * FROM ${table} WHERE 1=1 ${extra}` + (city ? " AND city = ?" : "") + " " + order).bind(...(city ? [city] : [])).all();
  return json({ rows: r.results, city });
}
async function deleteRow(env, admin, table, id) {
  const row = await env.DB.prepare(`SELECT city FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) return json({ error: "Not found" }, 404);
  if (admin.role !== "all" && row.city && row.city !== admin.role) return json({ error: "Not your city." }, 403);
  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}
const cityFor = (admin, k) => (admin.role === "all" ? cityOf(k) : admin.role);

async function addAvailability(req, env, admin) {
  const b = await body(req);
  const city = cityFor(admin, b.city);
  const days = Array.isArray(b.weekdays) ? b.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : Number.isInteger(b.weekday) ? [b.weekday] : [];
  const start = clean(b.start, 5), end = clean(b.end, 5), mins = [30, 45, 60, 90].includes(b.slot_minutes) ? b.slot_minutes : 60;
  if (!city || !days.length || !isTime(start) || !isTime(end) || start >= end) return json({ error: "City, at least one weekday, and a start time before the end time." }, 400);
  const th = clean(b.therapist_id, 40) || null;
  if (th && !(await env.DB.prepare("SELECT 1 FROM therapists WHERE id = ? AND city = ?").bind(th, city).first())) return json({ error: "That therapist isn't in this city." }, 400);
  await env.DB.batch(days.map((d) => env.DB.prepare("INSERT INTO availability (id, city, therapist_id, weekday, start, end, slot_minutes) VALUES (?,?,?,?,?,?,?)").bind(randomId(), city, th, d, start, end, mins)));
  return json({ ok: true });
}
async function addBlocked(req, env, admin) {
  const b = await body(req);
  const city = cityFor(admin, b.city), from = clean(b.date, 10), to = clean(b.to, 10) || from;
  if (!city || !isDate(from) || !isDate(to) || to < from) return json({ error: "City and a day (or a range)." }, 400);
  const start = isTime(b.start) ? b.start : null, end = isTime(b.end) ? b.end : null;
  const stmts = []; let d = from, n = 0;
  while (d <= to && n++ < 60) { stmts.push(env.DB.prepare("INSERT INTO blocked (id, city, therapist_id, date, start, end, reason) VALUES (?,?,?,?,?,?,?)").bind(randomId(), city, clean(b.therapist_id, 40) || null, d, start, end, clean(b.reason, 100))); d = addDays(d, 1); }
  await env.DB.batch(stmts);
  return json({ ok: true, days: stmts.length });
}
async function saveTherapist(req, env, admin, id) {
  const b = await body(req);
  const cur = id ? await env.DB.prepare("SELECT * FROM therapists WHERE id = ?").bind(id).first() : null;
  if (id && !cur) return json({ error: "Not found" }, 404);
  if (cur && admin.role !== "all" && cur.city !== admin.role) return json({ error: "Not your city." }, 403);
  const city = cur ? cur.city : cityFor(admin, b.city), name = clean(b.name, 80) || cur?.name;
  if (!city || !name) return json({ error: "City and name." }, 400);
  const photo = typeof b.photo === "string" && b.photo.startsWith("data:image/") && b.photo.length < 160000 ? b.photo : b.photo === null ? null : cur?.photo || null;
  const vals = [name, b.bio === undefined ? cur?.bio || "" : clean(b.bio, 400), photo, b.languages === undefined ? cur?.languages || "" : clean(b.languages, 60), b.active === undefined ? cur?.active ?? 1 : b.active ? 1 : 0, Number.isInteger(b.sort) ? b.sort : cur?.sort || 0];
  if (cur) await env.DB.prepare("UPDATE therapists SET name = ?, bio = ?, photo = ?, languages = ?, active = ?, sort = ? WHERE id = ?").bind(...vals, id).run();
  else await env.DB.prepare("INSERT INTO therapists (id, city, name, bio, photo, languages, active, sort) VALUES (?,?,?,?,?,?,?,?)").bind(randomId(), city, ...vals).run();
  return json({ ok: true });
}
async function savePackage(req, env, id) {
  const b = await body(req);
  const cur = id ? await env.DB.prepare("SELECT * FROM packages WHERE id = ?").bind(id).first() : null;
  if (id && !cur) return json({ error: "Not found" }, 404);
  const city = cur ? cur.city : cityOf(b.city);
  const name = clean(b.name, 80) || cur?.name, sessions = Number.isInteger(b.sessions) && b.sessions >= 2 && b.sessions <= 50 ? b.sessions : cur?.sessions;
  const amount = Number.isInteger(b.amount) && b.amount > 0 ? b.amount : cur?.amount, months = Number.isInteger(b.months_valid) && b.months_valid >= 1 ? b.months_valid : cur?.months_valid || 6;
  if (!city || !name || !sessions || !amount) return json({ error: "City, name, number of sessions (2–50) and total price." }, 400);
  const vals = [name, sessions, amount, CITIES[city].currency, months, b.active === undefined ? cur?.active ?? 1 : b.active ? 1 : 0, Number.isInteger(b.sort) ? b.sort : cur?.sort || 0];
  if (cur) await env.DB.prepare("UPDATE packages SET name = ?, sessions = ?, amount = ?, currency = ?, months_valid = ?, active = ?, sort = ? WHERE id = ?").bind(...vals, id).run();
  else await env.DB.prepare("INSERT INTO packages (id, city, name, sessions, amount, currency, months_valid, active, sort) VALUES (?,?,?,?,?,?,?,?,?)").bind(randomId(), city, ...vals).run();
  return json({ ok: true });
}
async function soldPackages(env, admin, url) {
  const city = cityFilter(admin, url);
  const r = await env.DB.prepare("SELECT cp.*, u.name user_name, u.email user_email FROM client_packages cp JOIN users u ON u.id = cp.user_id WHERE cp.status = 'paid'" + (city ? " AND cp.city = ?" : "") + " ORDER BY cp.paid_at DESC LIMIT 200").bind(...(city ? [city] : [])).all();
  r.results.forEach((x) => { if (admin.role !== "all") delete x.platform_fee; });
  return json({ rows: r.results, city });
}
async function savePartner(req, env, id) {
  const b = await body(req);
  const cur = id ? await env.DB.prepare("SELECT * FROM partners WHERE id = ?").bind(id).first() : null;
  if (id && !cur) return json({ error: "Not found" }, 404);
  const name = clean(b.name, 80) || cur?.name, pct = Number.isInteger(b.pct) && b.pct >= 1 && b.pct <= 50 ? b.pct : cur?.pct;
  const code = (clean(b.code, 16) || cur?.code || referralCode()).toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const city = b.city === null || b.city === "" ? null : cityOf(b.city) || cur?.city || null;
  if (!name || !pct || code.length < 3) return json({ error: "Name, a code of 3+ letters, and a discount of 1–50%." }, 400);
  try {
    if (cur) await env.DB.prepare("UPDATE partners SET code = ?, name = ?, city = ?, pct = ?, active = ? WHERE id = ?").bind(code, name, city, pct, b.active === undefined ? cur.active : b.active ? 1 : 0, id).run();
    else await env.DB.prepare("INSERT INTO partners (id, code, name, city, pct, active) VALUES (?,?,?,?,?,1)").bind(randomId(), code, name, city, pct).run();
  } catch { return json({ error: "That code is already taken." }, 409); }
  return json({ ok: true, code });
}
async function partnersReport(env) {
  const r = await env.DB.prepare(`SELECT p.*, (SELECT COUNT(*) FROM bookings b WHERE b.partner_code = p.code AND b.status IN ('paid','confirmed','done')) bookings,
      (SELECT SUM(b.amount) FROM bookings b WHERE b.partner_code = p.code AND b.status IN ('paid','confirmed','done')) revenue,
      (SELECT MAX(b.date) FROM bookings b WHERE b.partner_code = p.code AND b.status IN ('paid','confirmed','done')) last_booking,
      (SELECT COUNT(*) FROM bookings b WHERE b.partner_code = p.code AND b.status IN ('paid','confirmed','done') AND b.date >= date('now','start of month')) this_month
    FROM partners p ORDER BY bookings DESC, p.name`).all();
  return json({ rows: r.results });
}
async function listGifts(env, admin, url) {
  const city = cityFilter(admin, url);
  const r = await env.DB.prepare("SELECT id, code, city, service_name, amount, currency, buyer_name, buyer_email, recipient_name, recipient_email, status, created_at, paid_at, redeemed_at, booking_id FROM gifts WHERE status != 'pending'" + (city ? " AND city = ?" : "") + " ORDER BY created_at DESC LIMIT 200").bind(...(city ? [city] : [])).all();
  return json({ rows: r.results, city });
}

// ---------- health-flag review: clients who ticked a red flag book "for review" instead of paying ----------
async function reviewList(env, admin) {
  const city = admin.role === "all" ? null : admin.role;
  const bookings = await env.DB.prepare("SELECT b.id, b.user_id, b.name, b.email, b.phone, b.city, b.service_name, b.date, b.slot, b.amount, b.currency, b.note, b.created_at, u.intake FROM bookings b LEFT JOIN users u ON u.id = b.user_id WHERE b.status = 'review'" + (city ? " AND b.city = ?" : "") + " ORDER BY b.date").bind(...(city ? [city] : [])).all();
  bookings.results.forEach((b) => { const i = parseIntake(b.intake); b.flags = healthFlags(b.intake); b.health_notes = i?.health_notes || ""; delete b.intake; });
  const users = await env.DB.prepare("SELECT id, name, email, phone, nearest_city, intake, created_at FROM users WHERE approved = 0 AND intake IS NOT NULL" + (city ? " AND (nearest_city = ? OR city = ?)" : "") + " ORDER BY created_at DESC LIMIT 200").bind(...(city ? [city, city] : [])).all();
  const flagged = users.results.map((u) => { const i = parseIntake(u.intake); return { ...u, intake: undefined, flags: healthFlags(u.intake), health_notes: i?.health_notes || "" }; }).filter((u) => u.flags.length);
  return json({ bookings: bookings.results, clients: flagged });
}
async function approveClient(env, admin, id) {
  const u = await env.DB.prepare("SELECT id, name, email FROM users WHERE id = ?").bind(id).first();
  if (!u) return json({ error: "Not found" }, 404);
  const city = admin.role === "all" ? null : admin.role;
  await env.DB.prepare("UPDATE users SET approved = 1 WHERE id = ?").bind(id).run();
  const r = await env.DB.prepare("UPDATE bookings SET status = 'confirmed' WHERE user_id = ? AND status = 'review'" + (city ? " AND city = ?" : "")).bind(id, ...(city ? [city] : [])).run();
  await sendEmail(env, { to: u.email, subject: "Zen Recovery — you're cleared to book", text: [`Hi ${u.name.split(" ")[0]},`, ``, `A therapist looked at what you told us about your health and you're good to go.`, r.meta.changes ? `Your pending session is now confirmed — Zen will message you on WhatsApp about the exact hour, and you pay at the session.` : `You can now book online like anyone else.`, ``, `${env.SITE_URL}/account.html`, ``, `Zen Recovery`].join("\n") });
  return json({ ok: true, confirmed: r.meta.changes });
}

// ---------- photos: uploaded from the admin (therapist), stored in R2 when bound, else in D1 ----------
async function adminPhotos(env, admin, url) {
  const uid = clean(url.searchParams.get("user_id"), 40);
  if (!uid) return json({ error: "user_id" }, 400);
  const r = await env.DB.prepare("SELECT id, booking_id, kind, note, consent, uploaded_by, created_at FROM photos WHERE user_id = ? ORDER BY created_at DESC").bind(uid).all();
  return json({ photos: r.results });
}
async function uploadPhoto(req, env, admin) {
  const b = await body(req);
  const uid = clean(b.user_id, 40), data = typeof b.data === "string" && b.data.startsWith("data:image/") ? b.data : null;
  if (!uid || !data || data.length > 900000) return json({ error: "A client and an image under ~650 KB (the page resizes it for you)." }, 400);
  if (!(await env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(uid).first())) return json({ error: "Unknown client." }, 404);
  const id = randomId(), ct = data.slice(5, data.indexOf(";")) || "image/jpeg";
  let key = "d1";
  if (env.PHOTOS) { key = `${uid}/${id}.${ct.includes("png") ? "png" : "jpg"}`; await env.PHOTOS.put(key, Uint8Array.from(atob(data.split(",")[1]), (c) => c.charCodeAt(0)), { httpMetadata: { contentType: ct } }); }
  await env.DB.prepare("INSERT INTO photos (id, user_id, booking_id, kind, r2_key, content_type, note, consent, uploaded_by, data) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(id, uid, clean(b.booking_id, 40) || null, ["before", "after", "other"].includes(b.kind) ? b.kind : "other", key, ct, clean(b.note, 200), b.consent ? 1 : 0, admin.id, key === "d1" ? data : null).run();
  return json({ ok: true, id });
}
async function deletePhoto(env, admin, id) {
  const ph = await env.DB.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first();
  if (!ph) return json({ error: "Not found" }, 404);
  if (ph.r2_key !== "d1" && env.PHOTOS) await env.PHOTOS.delete(ph.r2_key).catch(() => {});
  await env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function leaderboard(env, admin) {
  const r = await env.DB.prepare(`SELECT u.id, u.name, u.email, u.city, u.referral_code,
      COUNT(f.id) invited, SUM(EXISTS (SELECT 1 FROM bookings b WHERE b.user_id = f.id AND b.status IN ('paid','confirmed','done'))) converted,
      (SELECT COUNT(*) FROM credits c WHERE c.user_id = u.id AND c.kind = 'referral' AND c.reason LIKE 'ref:%') rewards
    FROM users u JOIN users f ON f.referred_by = u.id GROUP BY u.id ORDER BY converted DESC, invited DESC LIMIT 50`).all();
  return json({ rows: r.results });
}
async function listMessages(env, admin, url) {
  const uid = clean(url.searchParams.get("user_id"), 40);
  const r = await env.DB.prepare("SELECT m.*, u.name user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id" + (uid ? " WHERE m.user_id = ?" : "") + " ORDER BY m.created_at DESC LIMIT 200").bind(...(uid ? [uid] : [])).all();
  return json({ rows: r.results });
}
async function adminWaitlist(env, admin, url) {
  const city = cityFilter(admin, url);
  const r = await env.DB.prepare("SELECT w.*, u.name, u.email, u.phone FROM waitlist w JOIN users u ON u.id = w.user_id WHERE w.date >= date('now')" + (city ? " AND w.city = ?" : "") + " ORDER BY w.date").bind(...(city ? [city] : [])).all();
  return json({ rows: r.results, city });
}
