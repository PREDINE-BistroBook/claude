// Second batch of features (2026-09-12): live time slots + therapists, packages, gift vouchers, partner codes,
// waitlist, data export, before/after photos, Apple sign-in, message log, referral leaderboard, health-flag review.
// Public routes come through featureRoute(); admin routes through adminFeatureRoute() (the caller has already
// checked the admin cookie). Everything money-related goes through stripeCheckout() in lib.js (2% platform fee).
import { CITIES } from "./catalog.js";
import { randomId, referralCode, signPayload, verifyPayload, getCookie, clearCookie, hashPassword } from "./auth.js";
import { CITY_KEYS, json, clean, normEmail, isDate, isTime, fmt, now, today, addDays, feeOn, body, isLive, currentUser, scope, sendEmail, stripeCheckout, slotsFor, healthFlags, parseIntake, createUser, sessionCookieFor, welcomeEmail, catalog, serviceOf, notifyList, validPhoto, localNow, maybeRewardReferrer, isOwner, therapistOf, visibleWhere, isPartner, isEmployee, managesCity, pickLang, translateProfile, parseI18n } from "./lib.js";
import { M } from "./mail.js";
import { translateService, therapistPrices, payProvider, fawryCheckout, cityNameIn } from "./lib.js";

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
  if (p === "/api/providers" && m === "GET") return providers(env, url);
  if (p === "/api/apply" && m === "POST") return applyToJoin(req, env);
  { const sp = p.match(/^\/api\/service-photo\/([a-z0-9-]+)$/); if (sp && m === "GET") return servicePhoto(env, sp[1]); }
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
  if (date < localNow(CITIES[city].tz).date) return json({ mode: "slots", slots: [] });
  const th = clean(url.searchParams.get("therapist"), 40) || null;
  const r = await slotsFor(env, city, date, th);
  return json(r, 200, { "cache-control": "no-store" });
}
// Cover pictures are served as images (cached a day) instead of inline in the catalog, which kept every page load light.
async function servicePhoto(env, id) {
  const r = await env.DB.prepare("SELECT photo, updated_at FROM services WHERE id = ?").bind(id).first();
  if (!r?.photo) return json({ error: "Not found" }, 404);
  const [meta, b64] = r.photo.split(","); const ct = meta.slice(5, meta.indexOf(";")) || "image/jpeg";
  return new Response(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), { headers: { "content-type": ct, "cache-control": "public, max-age=86400", etag: `"${(r.updated_at || "").replace(/\D/g, "")}"` } });
}
/* ---------- providers near a place (2026-09-13: the site is the connection between therapists and clients) ---------- */
// city centres, for "nearest city" when nobody is pinned close by
export const CITY_CENTRES = { cairo: [30.0444, 31.2357], dahab: [28.5091, 34.5136], florence: [43.7696, 11.2558] };
export const distanceKm = (a, b, c, d) => { const R = 6371, toR = (x) => (x * Math.PI) / 180, dLat = toR(c - a), dLng = toR(d - b), h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const coord = (v, max) => { if (v === null || v === undefined || String(v).trim() === "") return null; const n = Number(v); return Number.isFinite(n) && Math.abs(n) <= max ? Math.round(n * 1e6) / 1e6 : null; };
// "…/@30.01,31.2,15z" or "?q=30.01,31.2" or "…!3d30.01!4d31.2" in a Google Maps link
export const coordsFromMaps = (url) => { const s = String(url || ""); const m = s.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) || s.match(/[?&]q=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) || s.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/); return m ? [coord(m[1], 90), coord(m[2], 180)] : null; };
async function providers(env, url) {
  const lat = coord(url.searchParams.get("lat"), 90), lng = coord(url.searchParams.get("lng"), 180), q = clean(url.searchParams.get("q") || "", 60).toLowerCase();
  const r = await env.DB.prepare("SELECT id, city, name, bio, photo, languages, area, maps_url, title, instagram, i18n, sort, lat, lng, radius_km FROM therapists WHERE active = 1 ORDER BY city, sort, name").all();
  const pr = await env.DB.prepare("SELECT city, MIN(amount) amount, currency, COUNT(*) n FROM services WHERE active = 1 GROUP BY city").all().catch(() => ({ results: [] }));
  const price = Object.fromEntries(pr.results.map((x) => [x.city, { from: x.amount, currency: x.currency, services: x.n }]));
  const tp = await therapistPrices(env, null);
  const svcRows = (await env.DB.prepare("SELECT id, city, amount FROM services WHERE active = 1").all()).results;
  const fromFor = (t) => { const mine = svcRows.filter((s) => s.city === t.city).map((s) => tp[s.id]?.[t.id] ?? s.amount); return mine.length ? Math.min(...mine) : price[t.city]?.from; };
  const has = lat !== null && lng !== null;
  const cities = Object.entries(CITY_CENTRES).map(([k, [a, b]]) => ({ city: k, km: has ? Math.round(distanceKm(lat, lng, a, b)) : null, ...(price[k] || {}) }));
  let list = r.results.map((t) => {
    const i18n = parseI18n(t.i18n), pinned = t.lat !== null && t.lng !== null;
    const km = has && pinned ? Math.round(distanceKm(lat, lng, t.lat, t.lng) * 10) / 10 : null;
    const hay = [t.name, t.area, t.title, t.city, ...(i18n ? Object.values(i18n).flatMap((v) => [v.area, v.title]) : [])].filter(Boolean).join(" ").toLowerCase();
    return { ...t, i18n, pinned, km, comes_to_you: km !== null && Number(t.radius_km) > 0 && km <= Number(t.radius_km), match: !q || hay.includes(q), ...(price[t.city] || {}), from: fromFor(t) };
  });
  if (q) list = list.filter((t) => t.match);
  if (has) list.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9) || a.sort - b.sort); // nearest first; unpinned last
  const nearest = has ? cities.slice().sort((a, b) => a.km - b.km)[0] : null;
  return json({ providers: list.map(({ match, ...t }) => t), cities, nearest, located: has });
}
async function team(env, url) {
  const city = cityOf(url.searchParams.get("city"));
  const r = await env.DB.prepare("SELECT id, city, name, bio, photo, languages, area, maps_url, title, story, certs, instagram, i18n, sort, lat, lng, radius_km FROM therapists WHERE active = 1" + (city ? " AND city = ?" : "") + " ORDER BY city, sort, name").bind(...(city ? [city] : [])).all();
  return json({ therapists: r.results.map((t) => ({ ...t, i18n: parseI18n(t.i18n) })) });
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
  const provider = payProvider(env, pk.currency); if (!provider) return json({ preview: true, error: "Payments are not switched on yet." }, 503);
  const id = randomId();
  const { url, id: sid } = provider === "fawry" ? await fawryCheckout(env, { ref: "pk" + id, amount: pk.amount, name: `${pk.name} · ${pk.sessions} sessions`, description: CITIES[pk.city].name, email: u.email, phone: u.phone, customerName: u.name, returnUrl: `${env.SITE_URL}/api/fawry/return`, lang: u.lang }) : await stripeCheckout(env, { amount: pk.amount, currency: pk.currency, name: `${pk.name} · ${pk.sessions} sessions · ${CITIES[pk.city].name}`, description: `Valid ${pk.months_valid} months from purchase`, email: u.email,
    success: `${env.SITE_URL}/account?package=1#packages`, cancel: `${env.SITE_URL}/account#packages`, metadata: { kind: "package", package_row: id } });
  await env.DB.prepare("INSERT INTO client_packages (id, user_id, package_id, name, city, sessions, remaining, amount, currency, platform_fee, status, stripe_session, provider) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, u.id, pk.id, pk.name, pk.city, pk.sessions, pk.sessions, pk.amount, pk.currency, feeOn(pk.amount), "pending", sid, provider).run();
  return json({ url });
}
// Called from the Stripe webhook (worker.js) when metadata.kind === "package".
export async function packagePaid(env, rowId, paymentIntent) {
  const cp = await env.DB.prepare("SELECT * FROM client_packages WHERE id = ?").bind(rowId).first();
  if (!cp || cp.status !== "pending") return;
  const pk = await env.DB.prepare("SELECT months_valid FROM packages WHERE id = ?").bind(cp.package_id).first();
  const exp = new Date(); exp.setUTCMonth(exp.getUTCMonth() + (pk?.months_valid || 6));
  await env.DB.prepare("UPDATE client_packages SET status = 'paid', paid_at = ?, expires_at = ? WHERE id = ?").bind(now(), exp.toISOString().slice(0, 10), rowId).run();
  const u = await env.DB.prepare("SELECT email, name, lang FROM users WHERE id = ?").bind(cp.user_id).first();
  await sendEmail(env, { to: u.email, ...M("package_ready", pickLang(u.lang), { first: u.name.split(" ")[0], pack: cp.name, sessions: cp.sessions, city: CITIES[cp.city].name, until: exp.toISOString().slice(0, 10), link: `${env.SITE_URL}/booking?city=${cp.city}` }) });
  await sendEmail(env, { to: await notifyList(env, cp.city), subject: `Package sold · ${CITIES[cp.city].name} · ${cp.name} · ${fmt(cp.amount, cp.currency)}`, text: `${u.name} (${u.email}) bought ${cp.name} (${cp.sessions} sessions) in ${CITIES[cp.city].name} for ${fmt(cp.amount, cp.currency)}.` });
}
async function myPackages(req, env) {
  const u = await currentUser(req, env); if (!u) return need(u);
  const r = await env.DB.prepare("SELECT id, name, city, sessions, remaining, amount, currency, status, expires_at, paid_at FROM client_packages WHERE user_id = ? AND status = 'paid' ORDER BY paid_at DESC").bind(u.id).all();
  return json({ packages: r.results.map((p) => ({ ...p, usable: p.remaining > 0 && (!p.expires_at || p.expires_at >= today()) })) });
}

// ---------- gift vouchers ----------
async function giftCheckout(req, env) {
  const b = await body(req);
  const city = CITIES[b.city], svc = city ? await serviceOf(env, b.city, clean(b.service, 40)) : null;
  if (!city || !svc) return json({ error: "Pick a city and a session." }, 400);
  const buyer_name = clean(b.buyer_name, 80), buyer_email = normEmail(b.buyer_email), recipient_name = clean(b.recipient_name, 80), recipient_email = normEmail(b.recipient_email), message = clean(b.message, 300);
  if (!buyer_name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer_email) || !recipient_name) return json({ error: "Your name and email, and who the gift is for." }, 400);
  const provider = payProvider(env, city.currency); if (!provider) return json({ preview: true, error: "Payments are not switched on yet." }, 503);
  const id = randomId(), code = "GIFT-" + referralCode();
  const { url, id: sid } = provider === "fawry" ? await fawryCheckout(env, { ref: "gf" + id, amount: svc.amount, name: `Gift: ${svc.short || svc.name}`, description: `For ${recipient_name}`, email: buyer_email, phone: "", customerName: buyer_name, returnUrl: `${env.SITE_URL}/api/fawry/return`, lang: pickLang(b.lang) }) : await stripeCheckout(env, { amount: svc.amount, currency: city.currency, name: `Gift: ${svc.name}`, description: `For ${recipient_name}. Sent by email as a code after payment.`, email: buyer_email,
    success: `${env.SITE_URL}/success.html?gift=1`, cancel: `${env.SITE_URL}/giftcard`, metadata: { kind: "gift", gift_id: id } });
  await env.DB.prepare("INSERT INTO gifts (id, code, city, service_id, service_name, amount, currency, platform_fee, buyer_name, buyer_email, recipient_name, recipient_email, message, status, stripe_session, lang, provider) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, code, b.city, svc.id, svc.name, svc.amount, city.currency, feeOn(svc.amount), buyer_name, buyer_email, recipient_name, recipient_email || null, message, "pending", sid, pickLang(b.lang), provider).run();
  return json({ url });
}
export async function giftPaid(env, giftId) {
  const g = await env.DB.prepare("SELECT * FROM gifts WHERE id = ?").bind(giftId).first();
  if (!g || g.status !== "pending") return;
  await env.DB.prepare("UPDATE gifts SET status = 'paid', paid_at = ? WHERE id = ?").bind(now(), giftId).run();
  const cityName = CITIES[g.city].name, link = `${env.SITE_URL}/booking?city=${g.city}&gift=${g.code}`;
  const lang = pickLang(g.lang);
  await sendEmail(env, { to: g.buyer_email, ...M("gift_buyer", lang, { first: g.buyer_name.split(" ")[0], recipient: g.recipient_name, code: g.code, service: g.service_name, city: cityName, link, emailed: Boolean(g.recipient_email) }) });
  if (g.recipient_email) await sendEmail(env, { to: g.recipient_email, ...M("gift_recipient", lang, { buyer: g.buyer_name, service: g.service_name.split(" · ")[0], city: cityName, message: g.message, code: g.code, link }) });
  await sendEmail(env, { to: await notifyList(env, g.city), subject: `Gift sold · ${cityName} · ${g.service_name} · ${fmt(g.amount, g.currency)}`, text: `${g.buyer_name} (${g.buyer_email}) bought a gift for ${g.recipient_name}. Code ${g.code}.` });
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
  const fail = (why) => { console.error("apple sign-in failed:", why); return new Response(null, { status: 302, headers: { location: `${env.SITE_URL}/account?error=apple`, "set-cookie": clearCookie(APPLE_COOKIE) } }); };
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
  if (!user) { user = await createUser(env, { email, name: name || email.split("@")[0], ref: st.ref, lang: st.lang, apple_sub: claims.sub }); await welcomeEmail(env, user); }
  else if (!user.apple_sub) await env.DB.prepare("UPDATE users SET apple_sub = ? WHERE id = ?").bind(claims.sub, user.id).run();
  const headers = new Headers({ location: `${env.SITE_URL}/account` });
  headers.append("set-cookie", await sessionCookieFor(env, user.id)); headers.append("set-cookie", clearCookie(APPLE_COOKIE));
  return new Response(null, { status: 302, headers });
}
export const authFlags = (env) => ({ apple: appleReady(env), sms: Boolean(env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM), photos: Boolean(env.PHOTOS) ? "r2" : "d1" });

// =====================================================================================
// ADMIN  (caller has verified the admin cookie; `admin` is the admins row)
// =====================================================================================
export async function adminFeatureRoute(req, env, url, admin) {
  const p = url.pathname, m = req.method;
  const owner = () => (isOwner(admin) ? null : json({ error: "Only the owner can do this." }, 403));
  let mm;
  if (p === "/api/admin/services" && m === "GET") return listServices(env, admin, url);
  if (p === "/api/admin/services" && m === "POST") return saveService(req, env, admin, null);
  if ((mm = p.match(/^\/api\/admin\/services\/([a-z0-9-]+)$/)) && m === "PATCH") return saveService(req, env, admin, mm[1]);
  if (mm && m === "DELETE") return deleteService(env, admin, mm[1]);
  if (p === "/api/admin/applications" && m === "GET") return owner() || listApplications(env, url);
  { const ap = p.match(/^\/api\/admin\/applications\/([a-z0-9]+)\/(approve|decline)$/); if (ap && m === "POST") return owner() || decideApplication(req, env, admin, ap[1], ap[2]); }
  { const pr = p.match(/^\/api\/admin\/therapists\/([a-z0-9]+)\/prices$/); if (pr && m === "GET") return therapistPriceList(env, admin, pr[1]); if (pr && m === "PUT") return therapistPriceSave(req, env, admin, pr[1]); }
  if (p === "/api/admin/availability" && m === "GET") return listRows(env, admin, url, "availability", "ORDER BY city, weekday, start");
  if (p === "/api/admin/availability" && m === "POST") return addAvailability(req, env, admin);
  if ((mm = p.match(/^\/api\/admin\/availability\/([a-z0-9]+)$/)) && m === "DELETE") return deleteRow(env, admin, "availability", mm[1]);
  if (p === "/api/admin/blocked" && m === "GET") return listRows(env, admin, url, "blocked", "ORDER BY date, start", "AND date >= date('now','-7 days')");
  if (p === "/api/admin/blocked" && m === "POST") return addBlocked(req, env, admin);
  if (p === "/api/admin/blocked/remove" && m === "POST") return deleteRows(req, env, admin, "blocked");
  if (p === "/api/admin/availability/remove" && m === "POST") return deleteRows(req, env, admin, "availability");
  if ((mm = p.match(/^\/api\/admin\/blocked\/([a-z0-9]+)$/)) && m === "DELETE") return deleteRow(env, admin, "blocked", mm[1]);
  if (p === "/api/admin/therapists" && m === "GET") return listTherapists(env, admin, url);
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

// ---------- services and prices (what the website sells) ----------
async function listServices(env, admin, url) {
  const city = cityFilter(admin, url);
  const r = await env.DB.prepare("SELECT s.*, (SELECT COUNT(*) FROM bookings b WHERE b.service_id = s.id AND b.status IN ('paid','confirmed','done','review')) bookings FROM services s WHERE 1=1" + (city ? " AND s.city = ?" : "") + " ORDER BY s.city, s.sort, s.name").bind(...(city ? [city] : [])).all();
  return json({ rows: r.results, city });
}
async function saveService(req, env, admin, id) {
  const b = await body(req);
  const cur = id ? await env.DB.prepare("SELECT * FROM services WHERE id = ?").bind(id).first() : null;
  if (id && !cur) return json({ error: "Not found" }, 404);
  if (!isOwner(admin)) return json({ error: "Only the owner changes services and prices." }, 403);
  const city = cur ? cur.city : cityFor(admin, b.city);
  const name = clean(b.name, 60) || cur?.name;
  const minutes = Number.isInteger(b.minutes) && b.minutes >= 10 && b.minutes <= 240 ? b.minutes : cur?.minutes || 60;
  const amount = Number.isInteger(b.amount) && b.amount >= 0 && b.amount < 100000000 ? b.amount : cur?.amount;
  if (!city || !name || amount === undefined || amount === null) return json({ error: "City, a name and a price." }, 400);
  const photo = b.photo === undefined ? cur?.photo || null : b.photo === null ? null : validPhoto(b.photo, 260000) || cur?.photo || null;
  const vals = [name, minutes, amount, CITIES[city].currency, b.description === undefined ? cur?.description || "" : clean(b.description, 160), b.active === undefined ? cur?.active ?? 1 : b.active ? 1 : 0, Number.isInteger(b.sort) ? b.sort : cur?.sort || 0, now()];
  let nid = null;
  if (cur) await env.DB.prepare("UPDATE services SET name = ?, minutes = ?, amount = ?, currency = ?, description = ?, active = ?, sort = ?, updated_at = ?, photo = ? WHERE id = ?").bind(...vals, photo, id).run();
  else {
    const base = city.slice(0, 3) + "-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);
    nid = base; let n = 2; while (await env.DB.prepare("SELECT 1 FROM services WHERE id = ?").bind(nid).first()) nid = `${base}-${n++}`;
    const maxSort = (await env.DB.prepare("SELECT MAX(sort) m FROM services WHERE city = ?").bind(city).first()).m;
    if (!Number.isInteger(b.sort)) vals[6] = (maxSort ?? -1) + 1;
    await env.DB.prepare("INSERT INTO services (id, city, name, minutes, amount, currency, description, active, sort, updated_at, photo) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(nid, city, ...vals, photo).run();
    id = nid;
  }
  { const sid = cur ? id : nid, textsChanged = !cur || [["name", vals[0]], ["description", vals[4]]].some(([kk, v]) => String(v || "").trim() !== String(cur[kk] || "").trim());
    if (textsChanged) { let i18n = null; try { i18n = await translateService(env, { name: vals[0], description: vals[4] }); } catch (e) { console.error("translate service", e.message); } await env.DB.prepare("UPDATE services SET i18n = ? WHERE id = ?").bind(i18n ? JSON.stringify(i18n) : null, sid).run(); } }

  return json({ ok: true, id });
}
// Remove a service: gone for good if nobody ever booked it, otherwise just taken off the website (bookings keep their history).
async function deleteService(env, admin, id) {
  const cur = await env.DB.prepare("SELECT * FROM services WHERE id = ?").bind(id).first();
  if (!cur) return json({ error: "Not found" }, 404);
  if (!isOwner(admin)) return json({ error: "Only the owner changes services and prices." }, 403);
  const used = (await env.DB.prepare("SELECT COUNT(*) n FROM bookings WHERE service_id = ?").bind(id).first()).n;
  if (used) { await env.DB.prepare("UPDATE services SET active = 0, updated_at = ? WHERE id = ?").bind(now(), id).run(); return json({ ok: true, hidden: true }); }
  await env.DB.prepare("DELETE FROM services WHERE id = ?").bind(id).run();
  return json({ ok: true, deleted: true });
}
async function listRows(env, admin, url, table, order, extra = "") {
  const city = cityFilter(admin, url);
  const r = await env.DB.prepare(`SELECT * FROM ${table} WHERE 1=1 ${extra}` + (city ? " AND city = ?" : "") + " " + order).bind(...(city ? [city] : [])).all();
  return json({ rows: r.results, city });
}
// Remove several rows at once (a whole holiday range, all hours of one room): each row must be in the admin's city.
async function deleteRows(req, env, admin, table) {
  const b = await body(req);
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map((x) => clean(x, 40)).filter(Boolean))].slice(0, 200);
  if (!ids.length) return json({ error: "Nothing to remove." }, 400);
  const marks = ids.map(() => "?").join(",");
  const rows = (await env.DB.prepare(`SELECT id, city, therapist_id FROM ${table} WHERE id IN (${marks})`).bind(...ids).all()).results;
  const me = isEmployee(admin) ? await therapistOf(env, admin) : null;
  const mine = rows.filter((r) => isOwner(admin) || ((!r.city || r.city === admin.role) && (!me || r.therapist_id === me.id))).map((r) => r.id);
  if (mine.length) await env.DB.prepare(`DELETE FROM ${table} WHERE id IN (${mine.map(() => "?").join(",")})`).bind(...mine).run();
  return json({ ok: true, removed: mine.length });
}
async function deleteRow(env, admin, table, id) {
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) return json({ error: "Not found" }, 404);
  if (!isOwner(admin) && row.city && row.city !== admin.role) return json({ error: "Not your city." }, 403);
  if (table === "therapists" && isEmployee(admin)) return json({ error: "Only the owner or your city's partner removes a team member." }, 403);
  if (["availability", "blocked"].includes(table) && isEmployee(admin)) { const me = await therapistOf(env, admin); if (me && row.therapist_id !== me.id) return json({ error: "Only your own hours and days off. The room's are the owner's." }, 403); }
  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}
const cityFor = (admin, k) => (isOwner(admin) ? cityOf(k) : admin.role);

async function addAvailability(req, env, admin) {
  const b = await body(req);
  const city = cityFor(admin, b.city);
  const days = Array.isArray(b.weekdays) ? b.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : Number.isInteger(b.weekday) ? [b.weekday] : [];
  const start = clean(b.start, 5), end = clean(b.end, 5), mins = [30, 45, 60, 90].includes(b.slot_minutes) ? b.slot_minutes : 60;
  if (!city || !days.length || !isTime(start) || !isTime(end) || start >= end) return json({ error: "City, at least one weekday, and a start time before the end time." }, 400);
  const mine = isEmployee(admin) ? await therapistOf(env, admin) : null;   // an employee sets their own hours only; owner and partner set anyone's in the city
  const th = mine ? mine.id : clean(b.therapist_id, 40) || null;
  if (th && !(await env.DB.prepare("SELECT 1 FROM therapists WHERE id = ? AND city = ?").bind(th, city).first())) return json({ error: "That therapist isn't in this city." }, 400);
  await env.DB.batch(days.map((d) => env.DB.prepare("INSERT INTO availability (id, city, therapist_id, weekday, start, end, slot_minutes) VALUES (?,?,?,?,?,?,?)").bind(randomId(), city, th, d, start, end, mins)));
  return json({ ok: true });
}
async function addBlocked(req, env, admin) {
  const b = await body(req);
  const city = cityFor(admin, b.city), from = clean(b.date, 10), to = clean(b.to, 10) || from;
  if (!city || !isDate(from) || !isDate(to) || to < from) return json({ error: "City and a day (or a range)." }, 400);
  const start = isTime(b.start) ? b.start : null, end = isTime(b.end) ? b.end : null;
  const mine = isEmployee(admin) ? await therapistOf(env, admin) : null;   // an employee blocks their own days only
  if (mine && mine.city !== city) return json({ error: "Your profile is in another city." }, 400);
  const th = mine ? mine.id : clean(b.therapist_id, 40) || null;
  const stmts = []; let d = from, n = 0;
  while (d <= to && n++ < 60) { stmts.push(env.DB.prepare("INSERT INTO blocked (id, city, therapist_id, date, start, end, reason) VALUES (?,?,?,?,?,?,?)").bind(randomId(), city, th, d, start, end, clean(b.reason, 100))); d = addDays(d, 1); }
  await env.DB.batch(stmts);
  return json({ ok: true, days: stmts.length });
}
// Team list with the sign-in account each person is linked to (email/username shown to the owner only).
async function listTherapists(env, admin, url) {
  const city = cityFilter(admin, url);
  const r = await env.DB.prepare("SELECT t.*, a.email admin_email, a.name admin_name, a.role admin_role FROM therapists t LEFT JOIN admins a ON a.id = t.admin_id WHERE 1=1" + (city ? " AND t.city = ?" : "") + " ORDER BY t.city, t.sort, t.name").bind(...(city ? [city] : [])).all();
  return json({ rows: r.results.map((t) => (isOwner(admin) ? t : { ...t, admin_email: t.admin_id ? "linked" : null })), city });
}
// Owner links a therapist to the account they sign in with: an existing admin (role "all" or this city), a brand-new
// account created here (name = therapist, role = city), or null to unlink. One account per therapist and vice versa.
async function linkAccount(env, admin, b, city, name, curAdminId) {
  if (!isOwner(admin)) return { admin_id: curAdminId };
  if (b.new_account) {
    const email = normEmail(b.new_account.email), password = String(b.new_account.password || "");
    if (!email || password.length < 10) return { error: "The new sign-in needs an email or username and a password of at least 10 characters." };
    const id = randomId(), { hash, salt } = await hashPassword(password);
    try { await env.DB.prepare("INSERT INTO admins (id, email, name, role, pass_hash, salt) VALUES (?,?,?,?,?,?)").bind(id, email, name, city, hash, salt).run(); }
    catch { return { error: "That email or username already has admin access. Pick it from the list instead." }; }
    return { admin_id: id, created: email };
  }
  if (b.admin_id === undefined) return { admin_id: curAdminId };
  if (b.admin_id === null || b.admin_id === "") return { admin_id: null };
  const a = await env.DB.prepare("SELECT id, role FROM admins WHERE id = ?").bind(String(b.admin_id)).first();
  if (!a || a.role === "platform") return { error: "That sign-in account doesn't exist." };
  if (a.role !== "all" && a.role !== city) return { error: `That account only sees ${CITIES[a.role]?.name || a.role}. Change what it sees under Settings first, or pick another.` };
  return { admin_id: a.id };
}
async function saveTherapist(req, env, admin, id) {
  const b = await body(req);
  const cur = id ? await env.DB.prepare("SELECT * FROM therapists WHERE id = ?").bind(id).first() : null;
  if (id && !cur) return json({ error: "Not found" }, 404);
  if (cur && !isOwner(admin) && cur.city !== admin.role) return json({ error: "Not your city." }, 403);
  if (isEmployee(admin)) { if (!cur || cur.admin_id !== admin.id) return json({ error: "You can edit your own profile only. The owner or your city's partner edits the rest." }, 403); delete b.active; delete b.sort; }
  const city = cur ? cur.city : cityFor(admin, b.city), name = clean(b.name, 80) || cur?.name;
  if (!city || !name) return json({ error: "City and name." }, 400);
  const photo = b.photo === undefined ? cur?.photo || null : b.photo === null ? null : validPhoto(b.photo) || cur?.photo || null;
  const link = await linkAccount(env, admin, b, city, name, cur?.admin_id || null);
  if (link.error) return json({ error: link.error }, 400);
  const tid = id || randomId();
  if (link.admin_id) await env.DB.prepare("UPDATE therapists SET admin_id = NULL WHERE admin_id = ? AND id != ?").bind(link.admin_id, tid).run();
  const keep = (k, max) => (b[k] === undefined ? cur?.[k] || "" : clean(b[k], max));
  const keepML = (k, max) => (b[k] === undefined ? cur?.[k] || "" : String(b[k] ?? "").replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max)); // story and certificates keep their line breaks
  const maps = b.maps_url === undefined ? cur?.maps_url || "" : /^https:\/\/[^\s"<>]{6,300}$/.test(String(b.maps_url || "").trim()) ? String(b.maps_url).trim() : "";
  const insta = (b.instagram === undefined ? cur?.instagram || "" : String(b.instagram || "")).trim().replace(/^@|^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").slice(0, 40);
  // the pin: explicit lat/lng win; a Google Maps link with coordinates in it fills them in; null clears; radius_km = how far they travel to clients
  let lat = b.lat === undefined ? cur?.lat ?? null : b.lat === null ? null : coord(b.lat, 90), lng = b.lng === undefined ? cur?.lng ?? null : b.lng === null ? null : coord(b.lng, 180);
  if ((lat === null || lng === null) && b.lat === undefined && b.lng === undefined) { const c = coordsFromMaps(maps); if (c && c[0] !== null && c[1] !== null && maps !== (cur?.maps_url || "")) [lat, lng] = c; }
  if (lat === null || lng === null) lat = lng = null;
  const radius = b.radius_km === undefined ? Number(cur?.radius_km) || 0 : Math.min(100, Math.max(0, Number(b.radius_km) || 0));
  const vals = [name, keep("bio", 400), photo, keep("languages", 60), b.active === undefined ? cur?.active ?? 1 : b.active ? 1 : 0, Number.isInteger(b.sort) ? b.sort : cur?.sort || 0, link.admin_id, keep("area", 80), keep("address", 200), maps, keep("title", 80), keepML("story", 2000), keepML("certs", 1200), /^[A-Za-z0-9._]*$/.test(insta) ? insta : ""];
  if (cur) await env.DB.prepare("UPDATE therapists SET name = ?, bio = ?, photo = ?, languages = ?, active = ?, sort = ?, admin_id = ?, area = ?, address = ?, maps_url = ?, title = ?, story = ?, certs = ?, instagram = ? WHERE id = ?").bind(...vals, id).run();
  else await env.DB.prepare("INSERT INTO therapists (id, city, name, bio, photo, languages, active, sort, admin_id, area, address, maps_url, title, story, certs, instagram) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(tid, city, ...vals).run();
  await env.DB.prepare("UPDATE therapists SET lat = ?, lng = ?, radius_km = ? WHERE id = ?").bind(lat, lng, radius, tid).run();
  // texts changed → Italian and Arabic versions again (Workers AI); if it fails now, the hourly cron fills them in
  const textsChanged = !cur || ["title", "bio", "story", "certs", "languages", "area"].some((k) => (b[k] !== undefined && String(b[k] ?? "").trim() !== String(cur[k] || "").trim()));
  if (textsChanged) { let i18n = null; try { i18n = await translateProfile(env, { title: vals[10], bio: vals[1], story: vals[11], certs: vals[12], languages: vals[3], area: vals[7] }); } catch (e) { console.error("translate", e.message); } await env.DB.prepare("UPDATE therapists SET i18n = ? WHERE id = ?").bind(i18n ? JSON.stringify(i18n) : null, tid).run(); }
  return json({ ok: true, id: tid, created: link.created || null, admin_id: link.admin_id || null });
}
/* ---------- therapists apply to join (2026-09-13): public form → the owner approves (profile + sign-in created, emailed) or declines ---------- */
const WORDS_APP = ["calm", "cup", "river", "sand", "reef", "olive", "tide", "moon", "lotus", "pine", "salt", "stone"];
const appPassword = () => { const a = new Uint32Array(3); crypto.getRandomValues(a); return `${WORDS_APP[a[0] % 12]}-${WORDS_APP[a[1] % 12]}-${WORDS_APP[a[2] % 12]}-${(a[0] % 90) + 10}`; };
async function applyToJoin(req, env) {
  const b = await body(req);
  const name = clean(b.name, 80), email = normEmail(b.email), phone = clean(b.phone, 40), city = cityOf(b.city);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || "") || !phone || !city) return json({ error: "Your name, a real email, a WhatsApp number and the city." }, 400);
  if (!b.agree) return json({ error: "Please accept the terms first." }, 400);
  const open = await env.DB.prepare("SELECT id FROM applications WHERE email = ? AND status = 'new'").bind(email).first();
  if (open) return json({ error: "We already have an open application from this email. The owner will answer soon." }, 409);
  const ml = (k, max) => String(b[k] ?? "").replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
  const num = (v, max) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) && Math.abs(n) <= max ? n : null; };
  const lat = num(b.lat, 90), lng = num(b.lng, 180);
  const id = randomId();
  await env.DB.prepare("INSERT INTO applications (id, name, email, phone, city, area, address, maps_url, title, bio, story, certs, instagram, languages, photo, lat, lng, radius_km, lang) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, name, email, phone, city, clean(b.area, 80), clean(b.address, 200), /^https:\/\/[^\s"<>]{6,300}$/.test(String(b.maps_url || "")) ? String(b.maps_url).trim() : "", clean(b.title, 80), clean(b.bio, 400), ml("story", 2000), ml("certs", 1200), String(b.instagram || "").trim().replace(/^@|^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").slice(0, 40), clean(b.languages, 60), validPhoto(b.photo) || null, lat !== null && lng !== null ? lat : null, lat !== null && lng !== null ? lng : null, Math.min(100, Math.max(0, Number(b.radius_km) || 0)), pickLang(b.lang)).run();
  const lang = pickLang(b.lang);
  sendEmail(env, { to: email, ...M("application_received", lang, { first: name.split(" ")[0], city: cityNameIn(city, lang) }) }).catch(() => {});
  const owners = (await env.DB.prepare("SELECT email FROM admins WHERE role = 'all' AND email LIKE '%@%'").all()).results.map((r) => r.email);
  if (owners.length) sendEmail(env, { to: owners, subject: `New therapist application · ${CITIES[city].name} · ${name}`, text: [`${name} applied to join Zen Recovery in ${CITIES[city].name}.`, ``, `Title:     ${clean(b.title, 80)}`, `Area:      ${clean(b.area, 80)}`, `Phone:     ${phone}`, `Email:     ${email}`, `Instagram: ${clean(b.instagram, 40)}`, ``, `Bio: ${clean(b.bio, 400)}`, ``, `Approve or decline under Team → Applications: ${env.SITE_URL}/admin`].join("\n") }).catch(() => {});
  return json({ ok: true, id });
}
async function listApplications(env, url) {
  const status = ["new", "approved", "declined"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "new";
  const r = await env.DB.prepare("SELECT id, name, email, phone, city, area, address, maps_url, title, bio, story, certs, instagram, languages, photo, lat, lng, radius_km, lang, status, note, therapist_id, created_at, decided_at FROM applications WHERE status = ? ORDER BY created_at DESC LIMIT 100").bind(status).all();
  const counts = Object.fromEntries((await env.DB.prepare("SELECT status, COUNT(*) n FROM applications GROUP BY status").all()).results.map((x) => [x.status, x.n]));
  return json({ rows: r.results, counts });
}
async function decideApplication(req, env, admin, id, verdict) {
  const a = await env.DB.prepare("SELECT * FROM applications WHERE id = ?").bind(id).first();
  if (!a) return json({ error: "Not found" }, 404);
  if (a.status !== "new") return json({ error: "Already decided." }, 400);
  const b = await body(req).catch(() => ({})), note = clean(b?.note, 300), lang = pickLang(a.lang), first = a.name.split(" ")[0];
  if (verdict === "decline") {
    await env.DB.prepare("UPDATE applications SET status = 'declined', note = ?, decided_at = ? WHERE id = ?").bind(note, now(), id).run();
    sendEmail(env, { to: a.email, ...M("application_declined", lang, { first, city: cityNameIn(a.city, lang), note }) }).catch(() => {});
    return json({ ok: true });
  }
  // approve: a sign-in (unless that email already has one), then the public profile linked to it, pinned and priced at the city price
  let adminId = null, password = null;
  const existing = await env.DB.prepare("SELECT id, role FROM admins WHERE email = ?").bind(a.email).first();
  if (existing && existing.role !== "platform") adminId = existing.id;
  else if (!existing) { password = appPassword(); const { hash, salt } = await hashPassword(password); adminId = randomId(); await env.DB.prepare("INSERT INTO admins (id, email, name, role, pass_hash, salt, level, notify) VALUES (?,?,?,?,?,?,?,1)").bind(adminId, a.email, a.name, a.city, hash, salt, "employee").run(); }
  const maxSort = (await env.DB.prepare("SELECT MAX(sort) m FROM therapists").first()).m, tid = randomId();
  await env.DB.prepare("INSERT INTO therapists (id, city, name, bio, photo, languages, active, sort, admin_id, area, address, maps_url, title, story, certs, instagram, lat, lng, radius_km) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(tid, a.city, a.name, a.bio || "", a.photo || null, a.languages || "", (maxSort ?? -1) + 1, adminId, a.area || "", a.address || "", a.maps_url || "", a.title || "", a.story || "", a.certs || "", a.instagram || "", a.lat, a.lng, a.radius_km || 0).run();
  let i18n = null; try { i18n = await translateProfile(env, { title: a.title, bio: a.bio, story: a.story, certs: a.certs, languages: a.languages, area: a.area }); } catch (e) { console.error("translate", e.message); }
  if (i18n) await env.DB.prepare("UPDATE therapists SET i18n = ? WHERE id = ?").bind(JSON.stringify(i18n), tid).run();
  await env.DB.prepare("UPDATE applications SET status = 'approved', note = ?, decided_at = ?, therapist_id = ? WHERE id = ?").bind(note, now(), tid, id).run();
  const sent = await sendEmail(env, { to: a.email, ...M("application_approved", lang, { first, city: cityNameIn(a.city, lang), site: env.SITE_URL, signin: a.email, password: password || "(your existing password)" }) }).catch(() => false);
  return json({ ok: true, therapist_id: tid, admin_id: adminId, sent: Boolean(sent), password: sent ? undefined : password });
}
/* ---------- a therapist's own prices (2026-09-13): owner or the city's partner set them; the therapist sees theirs ---------- */
async function therapistPriceList(env, admin, id) {
  const th = await env.DB.prepare("SELECT id, city, name FROM therapists WHERE id = ?").bind(id).first();
  if (!th || (!isOwner(admin) && th.city !== admin.role)) return json({ error: "Not found" }, 404);
  if (isEmployee(admin)) { const me = await therapistOf(env, admin); if (!me || me.id !== id) return json({ error: "Not found" }, 404); }
  const services = (await env.DB.prepare("SELECT id, name, minutes, amount, currency FROM services WHERE city = ? AND active = 1 ORDER BY sort, name").bind(th.city).all()).results;
  const own = Object.fromEntries((await env.DB.prepare("SELECT service_id, amount FROM therapist_prices WHERE therapist_id = ?").bind(id).all()).results.map((r) => [r.service_id, r.amount]));
  return json({ therapist: th, can_edit: managesCity(admin), rows: services.map((s) => ({ ...s, own: own[s.id] ?? null })) });
}
async function therapistPriceSave(req, env, admin, id) {
  const th = await env.DB.prepare("SELECT id, city FROM therapists WHERE id = ?").bind(id).first();
  if (!th || (!isOwner(admin) && th.city !== admin.role)) return json({ error: "Not found" }, 404);
  if (!managesCity(admin)) return json({ error: "The owner or your city's partner sets prices." }, 403);
  const b = await body(req), prices = b && typeof b.prices === "object" && b.prices ? b.prices : {};
  const ids = new Set((await env.DB.prepare("SELECT id FROM services WHERE city = ?").bind(th.city).all()).results.map((r) => r.id));
  for (const [sid, v] of Object.entries(prices)) {
    if (!ids.has(sid)) continue;
    if (v === null || v === "" || v === undefined) await env.DB.prepare("DELETE FROM therapist_prices WHERE therapist_id = ? AND service_id = ?").bind(id, sid).run();
    else { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 100000000) return json({ error: "Prices are whole numbers in minor units (piastres / cents)." }, 400); await env.DB.prepare("INSERT INTO therapist_prices (therapist_id, service_id, amount) VALUES (?,?,?) ON CONFLICT(therapist_id, service_id) DO UPDATE SET amount = excluded.amount").bind(id, sid, n).run(); }
  }
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
  r.results.forEach((x) => { if (!isOwner(admin)) delete x.platform_fee; });
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
  const city = isOwner(admin) ? null : admin.role;
  const v = visibleWhere(admin, isOwner(admin) ? null : await therapistOf(env, admin), "b.therapist_id");
  const bookings = await env.DB.prepare("SELECT b.id, b.user_id, b.name, b.email, b.phone, b.city, b.service_name, b.date, b.slot, b.amount, b.currency, b.note, b.created_at, b.therapist_id, u.intake FROM bookings b LEFT JOIN users u ON u.id = b.user_id WHERE b.status = 'review'" + (city ? " AND b.city = ?" : "") + v.sql + " ORDER BY b.date").bind(...(city ? [city] : []), ...v.args).all();
  bookings.results.forEach((b) => { const i = parseIntake(b.intake); b.flags = healthFlags(b.intake); b.health_notes = i?.health_notes || ""; delete b.intake; });
  const users = await env.DB.prepare("SELECT id, name, email, phone, nearest_city, intake, created_at FROM users WHERE approved = 0 AND intake IS NOT NULL" + (city ? " AND (nearest_city = ? OR city = ?)" : "") + " ORDER BY created_at DESC LIMIT 200").bind(...(city ? [city, city] : [])).all();
  const flagged = users.results.map((u) => { const i = parseIntake(u.intake); return { ...u, intake: undefined, flags: healthFlags(u.intake), health_notes: i?.health_notes || "" }; }).filter((u) => u.flags.length);
  return json({ bookings: bookings.results, clients: flagged });
}
async function approveClient(env, admin, id) {
  const u = await env.DB.prepare("SELECT id, name, email FROM users WHERE id = ?").bind(id).first();
  if (!u) return json({ error: "Not found" }, 404);
  const city = isOwner(admin) ? null : admin.role;
  await env.DB.prepare("UPDATE users SET approved = 1 WHERE id = ?").bind(id).run();
  const r = await env.DB.prepare("UPDATE bookings SET status = 'confirmed' WHERE user_id = ? AND status = 'review'" + (city ? " AND city = ?" : "")).bind(id, ...(city ? [city] : [])).run();
  if (r.meta.changes) await maybeRewardReferrer(env, id);
  await sendEmail(env, { to: u.email, ...M("cleared", pickLang(u.lang), { first: u.name.split(" ")[0], confirmed: Boolean(r.meta.changes), site: env.SITE_URL }) });
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
  const uid = clean(b.user_id, 40), data = validPhoto(b.data, 900000);
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
