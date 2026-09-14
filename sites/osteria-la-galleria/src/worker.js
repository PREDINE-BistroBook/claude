// Osteria La Galleria — Cloudflare Worker: the static site plus the reservation / pre-order API and the admin API.
//
//   Guests     GET  /api/status                       what is open: hours, party size, whether pre-ordering is on
//              GET  /api/availability?date=&party=    free slots that day
//              POST /api/reserve                      book a table → email to the guest (with their link) and to the staff
//              GET  /api/reservation?id=&t=           the guest's own reservation + pre-orders (t = token from the email)
//              POST /api/reservation/cancel           the guest cancels (up to 2 h before)
//              POST /api/preorder                     choose dishes for that reservation → Stripe Checkout (paid online)
//              POST /api/stripe-webhook               Stripe tells us the pre-order was paid
//              GET  /api/menu                         the live menu (owner-edited), contact details, which photos exist
//              GET  /media/<id>?v=                    room covers and dish photos uploaded from the admin
//              GET  /t/7A  (or /7A)                   table QR codes → menu.html?t=7A
//   Staff      POST /api/admin/login · /logout · GET /api/admin/me · POST /api/admin/password
//              GET  /api/admin/reservations?from=&to=&status=&q=   · POST (manual) · PATCH /api/admin/reservations/:id
//              GET  /api/admin/orders?from=&to=       · PATCH /api/admin/orders/:id
//              GET  /api/admin/stats · GET/PUT /api/admin/settings (owner) · GET/POST /api/admin/admins (owner)
//              GET  /api/admin/menu · PATCH /api/admin/menu/item (sold out: any staff; price, hidden: owner)
//              PUT  /api/admin/menu · PUT /api/admin/site · PUT/DELETE /api/admin/media/:id   (owner)
//
// Money: Stripe Connect, direct charge on the osteria's connected account (OSTERIA_STRIPE_ACCOUNT) with a
// PLATFORM_FEE_BPS (2%) application fee to Amico Mio. Until STRIPE_SECRET_KEY + OSTERIA_STRIPE_ACCOUNT are set, the
// site takes reservations but pre-ordering is switched off ("preview" in /api/status).
//
// Secrets (wrangler secret put): SESSION_SECRET, RESEND_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// ADMIN_BOOTSTRAP_EMAIL + ADMIN_BOOTSTRAP_PASSWORD (first owner login, only while the admins table is empty).

import { randomId, hashPassword, verifyPassword, setCookie, clearCookie } from "./auth.js";
import { ADMIN_COOKIE, json, clean, normEmail, isDate, isTime, now, body, fmtEur, feeOn, isLive, localNow, toMin, addDays, settings, saveSettings, availability, currentAdmin, pubAdmin, isOwner, isPlatform, adminSession, notifyList, sendEmail, stripeCheckout, verifyStripeSignature, slug, menuDoc, saveMenu, sanitizeMenu, publicRooms, findDish, siteDoc, saveSite, sanitizeSite, happyHourPrice, mediaMap } from "./lib.js";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // Table QR codes point at /t/7A (or just /7A): land on the menu with the table remembered.
    const tc = /^\/(?:t\/)?(\d{1,2}[A-Za-z])\/?$/.exec(url.pathname);
    if (tc) return Response.redirect(url.origin + "/menu.html?t=" + tc[1].toUpperCase(), 302);
    if (url.pathname.startsWith("/media/")) return media(env, url.pathname.slice(7));
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: "Qualcosa è andato storto. Riprova, o chiamaci." }, 500);
    }
  },
};

async function route(req, env, url, ctx) {
  const p = url.pathname, m = req.method;
  if (p === "/api/status" && m === "GET") return status(env);
  if (p === "/api/menu" && m === "GET") return publicMenu(env);
  if (p === "/api/availability" && m === "GET") return json(await availability(env, await settings(env), url.searchParams.get("date"), Math.max(1, Number(url.searchParams.get("party") || 2))));
  if (p === "/api/reserve" && m === "POST") return reserve(req, env, ctx);
  if (p === "/api/reservation" && m === "GET") return guestView(env, url.searchParams.get("id"), url.searchParams.get("t"));
  if (p === "/api/reservation/cancel" && m === "POST") return guestCancel(req, env, ctx);
  if (p === "/api/preorder" && m === "POST") return preorder(req, env);
  if (p === "/api/stripe-webhook" && m === "POST") return webhook(req, env, ctx);

  if (p === "/api/admin/login" && m === "POST") return adminLogin(req, env);
  if (p === "/api/admin/logout" && m === "POST") return json({ ok: true }, 200, { "set-cookie": clearCookie(ADMIN_COOKIE) });
  if (p.startsWith("/api/admin/")) {
    const admin = await currentAdmin(req, env);
    if (!admin) return json({ error: "Accedi per continuare." }, 401);
    if (p === "/api/admin/me" && m === "GET") return json({ admin: pubAdmin(admin), live: isLive(env) });
    if (p === "/api/admin/password" && m === "POST") return changePassword(req, env, admin);
    if (p === "/api/admin/stats" && m === "GET") return stats(env, admin);
    if (isPlatform(admin)) return json({ error: "Questo account vede solo i numeri." }, 403);
    if (p === "/api/admin/reservations" && m === "GET") return listReservations(env, url);
    if (p === "/api/admin/reservations" && m === "POST") return manualReservation(req, env, admin);
    if (p.startsWith("/api/admin/reservations/") && m === "PATCH") return patchReservation(req, env, admin, p.split("/")[4]);
    if (p === "/api/admin/orders" && m === "GET") return listOrders(env, url);
    if (p.startsWith("/api/admin/orders/") && m === "PATCH") return patchOrder(req, env, p.split("/")[4]);
    if (p === "/api/admin/settings" && m === "GET") return json({ settings: await settings(env), live: isLive(env) });
    if (p === "/api/admin/menu" && m === "GET") return adminMenu(env);
    if (p === "/api/admin/menu/item" && m === "PATCH") return patchDish(req, env, admin);
    if (!isOwner(admin)) return json({ error: "Solo il titolare può farlo." }, 403);
    if (p === "/api/admin/settings" && m === "PUT") return putSettings(req, env);
    if (p === "/api/admin/menu" && m === "PUT") return putMenu(req, env);
    if (p === "/api/admin/site" && m === "PUT") return putSite(req, env);
    if (p.startsWith("/api/admin/media/") && m === "PUT") return putMedia(req, env, p.split("/")[4]);
    if (p.startsWith("/api/admin/media/") && m === "DELETE") return delMedia(env, p.split("/")[4]);
    if (p === "/api/admin/admins" && m === "GET") return json({ admins: (await env.DB.prepare("SELECT * FROM admins ORDER BY created_at").all()).results.map(pubAdmin) });
    if (p === "/api/admin/admins" && m === "POST") return addAdmin(req, env);
    if (p.startsWith("/api/admin/admins/") && m === "DELETE") return removeAdmin(env, admin, p.split("/")[4]);
  }
  return json({ error: "not found" }, 404);
}

// ---------- public ----------
// The menu the site renders: the owner's live document (hidden dishes stripped), contact details, and which photos exist.
async function publicMenu(env) {
  const [menu, site, media] = await Promise.all([menuDoc(env), siteDoc(env), mediaMap(env)]);
  const { tables, wifi, ...pub } = site;
  return json({ ver: menu.ver, rooms: publicRooms(menu.rooms), site: { ...pub, wifi }, media }, 200, { "cache-control": "public, max-age=30" });
}
// Photos: /media/<id>?v=<ver>. The version in the URL changes on every upload, so the file itself can be cached for a year.
async function media(env, id) {
  const r = await env.DB.prepare("SELECT mime, data, ver FROM media WHERE id = ?").bind(clean(id, 80)).first();
  if (!r) return new Response("not found", { status: 404 });
  const bin = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
  return new Response(bin, { headers: { "content-type": r.mime, "cache-control": "public, max-age=31536000, immutable", etag: `"${id}-${r.ver}"` } });
}
async function status(env) {
  const s = await settings(env);
  return json({ live: isLive(env), preorder: s.preorder && isLive(env), services: s.services, days: s.days, closed: s.closed, slot_minutes: s.slot_minutes, max_party: s.max_party, horizon_days: s.horizon_days, today: localNow().date, phone: (await siteDoc(env)).phone || "" });
}

async function reserve(req, env, ctx) {
  const b = await body(req), s = await settings(env);
  const name = clean(b.name, 80), email = normEmail(b.email), phone = clean(b.phone, 40), note = clean(b.note, 500), lang = b.lang === "en" ? "en" : "it";
  const date = clean(b.date, 10), time = clean(b.time, 5), party = Math.floor(Number(b.party));
  const T = lang === "en";
  if (!name || (!email && !phone)) return json({ error: T ? "Please leave a name and an email or phone number." : "Lascia un nome e un'email o un telefono." }, 400);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: T ? "That email doesn't look right." : "Quell'email non sembra giusta." }, 400);
  if (!isDate(date) || !isTime(time) || !(party >= 1)) return json({ error: T ? "Pick a date, a time and how many you are." : "Scegli data, ora e quanti siete." }, 400);
  if (party > s.max_party) return json({ error: T ? `For more than ${s.max_party} people, please call us.` : `Per più di ${s.max_party} persone chiamateci.` }, 400);
  const av = await availability(env, s, date, party);
  const slot = av.slots.find((x) => x.time === time);
  if (!av.open) return json({ error: av.reason === "closed" ? (T ? "We're closed that day." : "Quel giorno siamo chiusi.") : (T ? "Pick a date from today on, within the next two months." : "Scegli una data da oggi in poi, entro due mesi.") }, 400);
  if (!slot || !slot.ok) return json({ error: T ? "That time has just filled up. Pick another slot." : "Quell'orario si è appena riempito. Scegli un altro orario." }, 409);
  const id = randomId(8), token = randomId(12), st = s.auto_confirm ? "confirmed" : "requested";
  await env.DB.prepare("INSERT INTO reservations (id, token, name, email, phone, date, time, party, note, lang, status, confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, token, name, email || null, phone || null, date, time, party, note || null, lang, st, st === "confirmed" ? now() : null).run();
  const r = { id, token, name, email, phone, date, time, party, note, lang, status: st };
  ctx.waitUntil(Promise.all([guestEmail(env, s, r), staffEmail(env, s, r)]));
  return json({ ok: true, id, token, status: st, preorder: s.preorder && isLive(env) });
}

const manageUrl = (env, r) => `${env.SITE_URL}/prenota.html?id=${r.id}&t=${r.token}`;
const dateIt = (d, lang) => new Date(d + "T12:00:00Z").toLocaleDateString(lang === "en" ? "en-GB" : "it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

async function guestEmail(env, s, r) {
  if (!r.email) return;
  const en = r.lang === "en";
  const lines = en
    ? [`Hi ${r.name},`, ``, r.status === "confirmed" ? `Your table is booked.` : `We've received your request and will confirm it shortly.`, ``, `When:   ${dateIt(r.date, "en")} at ${r.time}`, `Who:    ${r.party} ${r.party === 1 ? "person" : "people"}`, r.note ? `Note:   ${r.note}` : null, ``, `See, change or cancel your reservation here: ${manageUrl(env, r)}`, s.preorder && isLive(env) ? `On the same page you can pre-order your dishes and pay online, so they're ready when you sit down.` : null, ``, `Osteria La Galleria · in front of Palazzo Pitti, Florence`]
    : [`Ciao ${r.name},`, ``, r.status === "confirmed" ? `Il tavolo è prenotato.` : `Abbiamo ricevuto la richiesta e la confermiamo a breve.`, ``, `Quando:  ${dateIt(r.date, "it")} alle ${r.time}`, `Persone: ${r.party}`, r.note ? `Nota:    ${r.note}` : null, ``, `Vedi, modifica o disdici la prenotazione qui: ${manageUrl(env, r)}`, s.preorder && isLive(env) ? `Dalla stessa pagina puoi pre-ordinare i piatti e pagare online, così li trovi pronti quando ti siedi.` : null, ``, `Osteria La Galleria · di fronte a Palazzo Pitti, Firenze`];
  await sendEmail(env, { to: r.email, subject: en ? `Your table at Osteria La Galleria — ${r.date} ${r.time}` : `Il tuo tavolo all'Osteria La Galleria — ${r.date} ${r.time}`, text: lines.filter((l) => l !== null).join("\n") });
}
async function staffEmail(env, s, r, extra) {
  const to = await notifyList(env, s);
  if (!to.length) return;
  const lines = [`${r.status === "confirmed" ? "Nuova prenotazione" : "Richiesta di prenotazione"}: ${r.name}, ${r.party} persone, ${dateIt(r.date, "it")} alle ${r.time}.`, r.phone ? `Telefono: ${r.phone}` : null, r.email ? `Email: ${r.email}` : null, r.note ? `Nota del cliente: ${r.note}` : null, extra || null, ``, `Gestisci: ${env.SITE_URL}/admin.html`];
  await sendEmail(env, { to, subject: `${r.status === "confirmed" ? "Prenotazione" : "Richiesta"} ${r.date} ${r.time} · ${r.party} p · ${r.name}`, text: lines.filter((l) => l !== null).join("\n") });
}

async function findGuest(env, id, t) {
  if (!id || !t) return null;
  const r = await env.DB.prepare("SELECT * FROM reservations WHERE id = ? AND token = ?").bind(clean(id, 32), clean(t, 40)).first();
  return r || null;
}
const pubRes = (r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, date: r.date, time: r.time, party: r.party, note: r.note, lang: r.lang, status: r.status, table_no: r.table_no, source: r.source, created_at: r.created_at });
const pubOrder = (o) => ({ id: o.id, reservation_id: o.reservation_id, items: JSON.parse(o.items), amount: o.amount, currency: o.currency, status: o.status, note: o.note, paid_at: o.paid_at, created_at: o.created_at });

async function guestView(env, id, t) {
  const r = await findGuest(env, id, t);
  if (!r) return json({ error: "not found" }, 404);
  const s = await settings(env);
  const orders = (await env.DB.prepare("SELECT * FROM orders WHERE reservation_id = ? AND status != 'cancelled' ORDER BY created_at").bind(r.id).all()).results.map(pubOrder);
  const ln = localNow();
  const canCancel = ["requested", "confirmed"].includes(r.status) && (r.date > ln.date || (r.date === ln.date && toMin(r.time) - ln.minutes >= 120));
  return json({ reservation: pubRes(r), orders, can_cancel: canCancel, preorder: s.preorder && isLive(env) && ["requested", "confirmed"].includes(r.status) && (r.date > ln.date || (r.date === ln.date && toMin(r.time) - ln.minutes >= 120)), preorder_min: s.preorder_min });
}
async function guestCancel(req, env, ctx) {
  const b = await body(req);
  const r = await findGuest(env, b.id, b.t);
  if (!r) return json({ error: "not found" }, 404);
  const ln = localNow();
  if (!["requested", "confirmed"].includes(r.status) || !(r.date > ln.date || (r.date === ln.date && toMin(r.time) - ln.minutes >= 120))) return json({ error: r.lang === "en" ? "Too late to cancel online — please call us." : "Troppo tardi per disdire online: chiamaci." }, 409);
  await env.DB.prepare("UPDATE reservations SET status = 'cancelled', cancelled_at = ? WHERE id = ?").bind(now(), r.id).run();
  const paid = await env.DB.prepare("SELECT COUNT(*) n, SUM(amount) a FROM orders WHERE reservation_id = ? AND status = 'paid'").bind(r.id).first();
  const s = await settings(env);
  ctx.waitUntil(staffEmail(env, s, { ...r, status: "cancelled" }, paid.n ? `ATTENZIONE: aveva un pre-ordine pagato di ${fmtEur(paid.a)} — valutare il rimborso su Stripe.` : null).then(() =>
    sendEmail(env, { to: r.email, subject: r.lang === "en" ? "Reservation cancelled — Osteria La Galleria" : "Prenotazione disdetta — Osteria La Galleria", text: r.lang === "en" ? `Hi ${r.name},\n\nYour reservation for ${dateIt(r.date, "en")} at ${r.time} is cancelled.${paid.n ? " We'll be in touch about your pre-order payment." : ""}\n\nWe hope to see you another time.\nOsteria La Galleria` : `Ciao ${r.name},\n\nLa prenotazione per ${dateIt(r.date, "it")} alle ${r.time} è disdetta.${paid.n ? " Ti contattiamo per il pagamento del pre-ordine." : ""}\n\nA presto.\nOsteria La Galleria` })));
  return json({ ok: true });
}

// ---------- pre-order ----------
async function preorder(req, env) {
  const b = await body(req), s = await settings(env);
  const r = await findGuest(env, b.id, b.t);
  const en = (r?.lang || b.lang) === "en";
  if (!r) return json({ error: "not found" }, 404);
  if (!s.preorder || !isLive(env)) return json({ error: en ? "Online pre-ordering isn't active yet." : "Il pre-ordine online non è ancora attivo." }, 503);
  const ln = localNow();
  if (!["requested", "confirmed"].includes(r.status) || !(r.date > ln.date || (r.date === ln.date && toMin(r.time) - ln.minutes >= 120))) return json({ error: en ? "Pre-orders close two hours before the table." : "I pre-ordini chiudono due ore prima del tavolo." }, 409);
  const items = Array.isArray(b.items) ? b.items.slice(0, 40) : [];
  const [menu, site] = await Promise.all([menuDoc(env), siteDoc(env)]);
  const rooms = publicRooms(menu.rooms);
  const lines = [];
  for (const it of items) {
    const d = findDish(rooms, clean(it.slug || it.id, 120)); const qty = Math.floor(Number(it.qty));
    if (!d || d.perKg || d.out || !(qty >= 1 && qty <= 20)) continue;
    const hh = happyHourPrice(site, d, toMin(r.time));
    const unit = Math.round((hh ?? d.price) * 100);
    lines.push({ slug: d.id, name: d.it, qty, unit, line: unit * qty });
  }
  if (!lines.length) return json({ error: en ? "Choose at least one dish." : "Scegli almeno un piatto." }, 400);
  const amount = lines.reduce((a, l) => a + l.line, 0);
  if (amount < s.preorder_min) return json({ error: en ? `Minimum pre-order is ${fmtEur(s.preorder_min)}.` : `Il pre-ordine minimo è ${fmtEur(s.preorder_min)}.` }, 400);
  const id = randomId(8);
  const note = clean(b.note, 300);
  const base = `${env.SITE_URL}/prenota.html?id=${r.id}&t=${r.token}`;
  let session;
  try {
    session = await stripeCheckout(env, { lines, email: r.email || undefined, success: base + "&paid=1", cancel: base + "&paid=0", metadata: { order_id: id, reservation_id: r.id }, description: `Pre-ordine ${r.date} ${r.time} · ${r.name} · ${r.party} p` });
  } catch (e) {
    return json({ error: en ? "The payment couldn't start. Try again or order at the table." : "Il pagamento non è partito. Riprova, o ordina al tavolo." }, 502);
  }
  await env.DB.prepare("INSERT INTO orders (id, reservation_id, items, amount, currency, platform_fee, status, note, stripe_session) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, r.id, JSON.stringify(lines), amount, "eur", feeOn(env, amount), "pending", note || null, session.id).run();
  return json({ ok: true, url: session.url, amount });
}

async function webhook(req, env, ctx) {
  const raw = await req.text();
  if (!(await verifyStripeSignature(raw, req.headers.get("stripe-signature") || "", env.STRIPE_WEBHOOK_SECRET))) return new Response("bad signature", { status: 400 });
  const ev = JSON.parse(raw); const sess = ev.data?.object; const oid = sess?.metadata?.order_id;
  if (!oid) return new Response("ok");
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(oid).first();
  if (!o) return new Response("ok");
  if (ev.type === "checkout.session.completed" && o.status === "pending") {
    await env.DB.prepare("UPDATE orders SET status = 'paid', paid_at = ?, payment_intent = ? WHERE id = ?").bind(now(), sess.payment_intent || null, oid).run();
    const r = await env.DB.prepare("SELECT * FROM reservations WHERE id = ?").bind(o.reservation_id).first();
    const s = await settings(env);
    const items = JSON.parse(o.items);
    const list = items.map((l) => `${l.qty} × ${l.name} — ${fmtEur(l.line)}`).join("\n");
    ctx.waitUntil(Promise.all([
      r?.email ? sendEmail(env, { to: r.email, subject: r.lang === "en" ? `Pre-order paid — ${r.date} ${r.time}` : `Pre-ordine pagato — ${r.date} ${r.time}`, text: (r.lang === "en" ? `Thank you ${r.name}, your pre-order is paid.\n\n${list}\n\nTotal: ${fmtEur(o.amount)}\n\nIt will be ready for your table on ${dateIt(r.date, "en")} at ${r.time}.\n${manageUrl(env, r)}` : `Grazie ${r.name}, il pre-ordine è pagato.\n\n${list}\n\nTotale: ${fmtEur(o.amount)}\n\nLo trovi pronto al tavolo ${dateIt(r.date, "it")} alle ${r.time}.\n${manageUrl(env, r)}`) }) : null,
      sendEmail(env, { to: await notifyList(env, s), subject: `Pre-ordine pagato ${fmtEur(o.amount)} · ${r?.date} ${r?.time} · ${r?.name}`, text: `${r?.name}, ${r?.party} persone, ${r?.date} alle ${r?.time}.\n\n${list}\n\nTotale ${fmtEur(o.amount)}${o.note ? `\nNota: ${o.note}` : ""}\n\nCucina: ${env.SITE_URL}/admin.html#ordini` }),
    ]));
  } else if (ev.type === "checkout.session.expired" && o.status === "pending") {
    await env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").bind(oid).run();
  }
  return new Response("ok");
}

// ---------- admin ----------
async function adminLogin(req, env) {
  const b = await body(req);
  const who = normEmail(b.email), password = String(b.password || "");
  let a = (await env.DB.prepare("SELECT * FROM admins WHERE email = ?").bind(who).first()) || (await env.DB.prepare("SELECT * FROM admins WHERE username = ?").bind(who).first());
  if (!a) {
    const count = await env.DB.prepare("SELECT COUNT(*) n FROM admins").first();
    if (count.n === 0 && env.ADMIN_BOOTSTRAP_EMAIL && who === normEmail(env.ADMIN_BOOTSTRAP_EMAIL) && password && password === env.ADMIN_BOOTSTRAP_PASSWORD) {
      const { hash, salt } = await hashPassword(password);
      await env.DB.prepare("INSERT INTO admins (id, email, name, role, pass_hash, salt) VALUES (?,?,?,?,?,?)").bind(randomId(), who, "Titolare", "owner", hash, salt).run();
      a = await env.DB.prepare("SELECT * FROM admins WHERE email = ?").bind(who).first();
    }
  }
  if (!a || !(await verifyPassword(password, a.pass_hash, a.salt))) return json({ error: "Email o password sbagliate." }, 401);
  await env.DB.prepare("UPDATE admins SET last_login = ? WHERE id = ?").bind(now(), a.id).run();
  return json({ admin: pubAdmin(a), live: isLive(env) }, 200, { "set-cookie": setCookie(ADMIN_COOKIE, await adminSession(env, a), 12 * 3600) });
}
async function changePassword(req, env, admin) {
  const b = await body(req);
  if (!(await verifyPassword(String(b.current || ""), admin.pass_hash, admin.salt))) return json({ error: "La password attuale non è giusta." }, 400);
  if (String(b.next || "").length < 8) return json({ error: "Almeno 8 caratteri." }, 400);
  const { hash, salt } = await hashPassword(String(b.next));
  await env.DB.prepare("UPDATE admins SET pass_hash = ?, salt = ? WHERE id = ?").bind(hash, salt, admin.id).run();
  return json({ ok: true });
}
async function addAdmin(req, env) {
  const b = await body(req);
  const email = normEmail(b.email), username = clean(b.username, 40).toLowerCase() || null, name = clean(b.name, 80), role = ["owner", "staff", "platform"].includes(b.role) ? b.role : "staff";
  if (!email && !username) return json({ error: "Serve un'email o un nome utente." }, 400);
  if (String(b.password || "").length < 8) return json({ error: "Password: almeno 8 caratteri." }, 400);
  const { hash, salt } = await hashPassword(String(b.password));
  try {
    await env.DB.prepare("INSERT INTO admins (id, email, username, name, role, pass_hash, salt, notify) VALUES (?,?,?,?,?,?,?,?)").bind(randomId(), email || null, username, name || null, role, hash, salt, b.notify === false ? 0 : 1).run();
  } catch (e) { return json({ error: "Esiste già un accesso con quell'email o nome utente." }, 409); }
  return json({ ok: true });
}
async function removeAdmin(env, admin, id) {
  if (id === admin.id) return json({ error: "Non puoi rimuovere te stesso." }, 400);
  await env.DB.prepare("DELETE FROM admins WHERE id = ? AND role != 'platform'").bind(id).run();
  return json({ ok: true });
}

async function listReservations(env, url) {
  const ln = localNow();
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from") : ln.date;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to") : addDays(from, 6);
  const st = clean(url.searchParams.get("status"), 20), q = clean(url.searchParams.get("q"), 60);
  let sql = "SELECT * FROM reservations WHERE date BETWEEN ? AND ?", args = [from, to];
  if (st && st !== "all") { sql += " AND status = ?"; args.push(st); }
  if (q) { sql += " AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)"; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += " ORDER BY date, time, created_at";
  const rows = (await env.DB.prepare(sql).bind(...args).all()).results;
  const ids = rows.map((r) => r.id);
  const orders = ids.length ? (await env.DB.prepare(`SELECT reservation_id, status, amount, items FROM orders WHERE reservation_id IN (${ids.map(() => "?").join(",")}) AND status IN ('paid','served')`).bind(...ids).all()).results : [];
  const byRes = {}; for (const o of orders) (byRes[o.reservation_id] ||= []).push({ status: o.status, amount: o.amount, items: JSON.parse(o.items) });
  return json({ from, to, reservations: rows.map((r) => ({ ...pubRes(r), admin_note: r.admin_note, orders: byRes[r.id] || [] })) });
}
async function manualReservation(req, env, admin) {
  const b = await body(req);
  const name = clean(b.name, 80), phone = clean(b.phone, 40), email = normEmail(b.email), date = clean(b.date, 10), time = clean(b.time, 5), party = Math.floor(Number(b.party)), note = clean(b.note, 500), table_no = clean(b.table_no, 10);
  if (!name || !isDate(date) || !isTime(time) || !(party >= 1)) return json({ error: "Nome, data, ora e persone." }, 400);
  const id = randomId(8), token = randomId(12);
  await env.DB.prepare("INSERT INTO reservations (id, token, name, email, phone, date, time, party, note, lang, status, source, table_no, confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, token, name, email || null, phone || null, date, time, party, note || null, "it", "confirmed", "manual", table_no || null, now()).run();
  return json({ ok: true, id });
}
const STATUSES = ["requested", "confirmed", "seated", "done", "cancelled", "no_show"];
async function patchReservation(req, env, admin, id) {
  const b = await body(req);
  const r = await env.DB.prepare("SELECT * FROM reservations WHERE id = ?").bind(clean(id, 32)).first();
  if (!r) return json({ error: "not found" }, 404);
  const sets = [], args = [];
  const put = (col, v) => { sets.push(`${col} = ?`); args.push(v); };
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return json({ error: "stato non valido" }, 400); put("status", b.status); if (b.status === "confirmed" && !r.confirmed_at) put("confirmed_at", now()); if (b.status === "cancelled") put("cancelled_at", now()); }
  if (b.date !== undefined) { if (!isDate(b.date)) return json({ error: "data" }, 400); put("date", b.date); }
  if (b.time !== undefined) { if (!isTime(b.time)) return json({ error: "ora" }, 400); put("time", b.time); }
  if (b.party !== undefined) { const p = Math.floor(Number(b.party)); if (!(p >= 1 && p <= 60)) return json({ error: "persone" }, 400); put("party", p); }
  if (b.name !== undefined) put("name", clean(b.name, 80) || r.name);
  if (b.phone !== undefined) put("phone", clean(b.phone, 40) || null);
  if (b.email !== undefined) put("email", normEmail(b.email) || null);
  if (b.note !== undefined) put("note", clean(b.note, 500) || null);
  if (b.table_no !== undefined) put("table_no", clean(b.table_no, 10) || null);
  if (b.admin_note !== undefined) put("admin_note", clean(b.admin_note, 500) || null);
  if (!sets.length) return json({ error: "niente da cambiare" }, 400);
  args.push(r.id);
  await env.DB.prepare(`UPDATE reservations SET ${sets.join(", ")} WHERE id = ?`).bind(...args).run();
  const updated = await env.DB.prepare("SELECT * FROM reservations WHERE id = ?").bind(r.id).first();
  // tell the guest when the staff confirms a request, or moves / cancels the table
  if (updated.email && ((b.status === "confirmed" && r.status === "requested") || (b.status === "cancelled" && r.status !== "cancelled") || ((b.date !== undefined || b.time !== undefined) && (updated.date !== r.date || updated.time !== r.time)))) {
    const en = updated.lang === "en";
    const what = b.status === "cancelled" ? (en ? "we had to cancel your reservation. Please call us and we'll find another time." : "abbiamo dovuto disdire la prenotazione. Chiamaci e troviamo un altro momento.")
      : (en ? `your table is confirmed for ${dateIt(updated.date, "en")} at ${updated.time}, ${updated.party} ${updated.party === 1 ? "person" : "people"}.` : `il tavolo è confermato per ${dateIt(updated.date, "it")} alle ${updated.time}, ${updated.party} persone.`);
    await sendEmail(env, { to: updated.email, subject: en ? "Your reservation — Osteria La Galleria" : "La tua prenotazione — Osteria La Galleria", text: (en ? `Hi ${updated.name}, ` : `Ciao ${updated.name}, `) + what + `\n\n${manageUrl(env, updated)}\n\nOsteria La Galleria` });
  }
  return json({ ok: true, reservation: { ...pubRes(updated), admin_note: updated.admin_note } });
}

async function listOrders(env, url) {
  const ln = localNow();
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from") : ln.date;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to") : addDays(from, 6);
  const rows = (await env.DB.prepare("SELECT o.*, r.name r_name, r.date r_date, r.time r_time, r.party r_party, r.table_no r_table, r.status r_status, r.phone r_phone FROM orders o JOIN reservations r ON r.id = o.reservation_id WHERE r.date BETWEEN ? AND ? AND o.status IN ('paid','served') ORDER BY r.date, r.time").bind(from, to).all()).results;
  return json({ from, to, orders: rows.map((o) => ({ ...pubOrder(o), reservation: { name: o.r_name, date: o.r_date, time: o.r_time, party: o.r_party, table_no: o.r_table, status: o.r_status, phone: o.r_phone } })) });
}
async function patchOrder(req, env, id) {
  const b = await body(req);
  if (!["paid", "served"].includes(b.status)) return json({ error: "stato" }, 400);
  await env.DB.prepare("UPDATE orders SET status = ? WHERE id = ? AND status IN ('paid','served')").bind(b.status, clean(id, 32)).run();
  return json({ ok: true });
}

async function putSettings(req, env) {
  const b = await body(req), cur = await settings(env);
  const next = { ...cur };
  if (Array.isArray(b.services)) next.services = b.services.slice(0, 4).map((x, i) => ({ id: clean(x.id, 20) || `s${i}`, name: { it: clean(x.name?.it, 30) || "Servizio", en: clean(x.name?.en, 30) || "Service" }, from: isTime(x.from) ? x.from : "12:00", to: isTime(x.to) ? x.to : "14:30" }));
  if (Array.isArray(b.days)) next.days = b.days.map(Number).filter((d) => d >= 0 && d <= 6);
  if (Array.isArray(b.closed)) next.closed = b.closed.filter(isDate).slice(0, 200);
  for (const k of ["slot_minutes", "covers_per_slot", "max_party", "lead_minutes", "horizon_days", "preorder_min"]) if (b[k] !== undefined) { const v = Math.floor(Number(b[k])); if (v >= 0 && v <= 100000) next[k] = v; }
  if (next.slot_minutes < 15) next.slot_minutes = 15;
  for (const k of ["auto_confirm", "preorder"]) if (b[k] !== undefined) next[k] = Boolean(b[k]);
  if (b.notify_email !== undefined) next.notify_email = normEmail(b.notify_email);
  await saveSettings(env, next);
  return json({ settings: next });
}

async function stats(env, admin) {
  const ln = localNow();
  const week = addDays(ln.date, 6), month0 = ln.date.slice(0, 7) + "-01";
  const [todayRows, weekRows, requested, month, upcoming] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) n, SUM(party) covers FROM reservations WHERE date = ? AND status IN ('confirmed','seated','requested')").bind(ln.date).first(),
    env.DB.prepare("SELECT COUNT(*) n, SUM(party) covers FROM reservations WHERE date BETWEEN ? AND ? AND status IN ('confirmed','seated','requested')").bind(ln.date, week).first(),
    env.DB.prepare("SELECT COUNT(*) n FROM reservations WHERE status = 'requested' AND date >= ?").bind(ln.date).first(),
    env.DB.prepare("SELECT COUNT(*) n, SUM(amount) a, SUM(platform_fee) fee FROM orders WHERE status IN ('paid','served') AND paid_at >= ?").bind(month0).first(),
    env.DB.prepare("SELECT COUNT(*) n, SUM(o.amount) a FROM orders o JOIN reservations r ON r.id = o.reservation_id WHERE o.status = 'paid' AND r.date >= ?").bind(ln.date).first(),
  ]);
  const out = { today: { reservations: todayRows.n || 0, covers: todayRows.covers || 0 }, week: { reservations: weekRows.n || 0, covers: weekRows.covers || 0 }, requested: requested.n || 0, preorders_month: { n: month.n || 0, amount: month.a || 0 }, preorders_upcoming: { n: upcoming.n || 0, amount: upcoming.a || 0 }, live: isLive(env), date: ln.date };
  if (isPlatform(admin)) out.platform_fee_month = month.fee || 0;
  return json(out);
}

// ---------- the menu, the locale, the photos (admin) ----------
async function adminMenu(env) {
  const [menu, site, media] = await Promise.all([menuDoc(env), siteDoc(env), mediaMap(env)]);
  return json({ ver: menu.ver, rooms: menu.rooms, site, media });
}
// The owner saves the whole document; the version guards against two people editing at once.
async function putMenu(req, env) {
  const b = await body(req);
  const cur = await menuDoc(env);
  if (b.ver !== undefined && Number(b.ver) !== cur.ver) return json({ error: "Qualcun altro ha modificato il menu nel frattempo: ricarica la pagina.", ver: cur.ver }, 409);
  const { rooms } = sanitizeMenu(b);
  const n = rooms.reduce((a, r) => a + r.groups.reduce((c, g) => c + g.items.length, 0), 0);
  if (!rooms.length || !n) return json({ error: "Un menu vuoto non si salva." }, 400);
  const ver = cur.ver + 1;
  await saveMenu(env, rooms, ver);
  return json({ ok: true, ver });
}
// Quick changes from the floor: sold out (any staff), price or hidden (owner only).
async function patchDish(req, env, admin) {
  const b = await body(req);
  const cur = await menuDoc(env);
  const id = clean(b.id, 120);
  let hit = null;
  for (const r of cur.rooms) for (const g of r.groups) for (const d of g.items) if (d.id === id) hit = d;
  if (!hit) return json({ error: "Piatto non trovato." }, 404);
  if (b.out !== undefined) { if (b.out) hit.out = true; else delete hit.out; }
  if (isOwner(admin)) {
    if (b.off !== undefined) { if (b.off) hit.off = true; else delete hit.off; }
    if (b.price !== undefined) { const p = Number(b.price); if (Number.isFinite(p) && p >= 0) hit.price = Math.round(p * 100) / 100; }
  } else if (b.off !== undefined || b.price !== undefined) return json({ error: "Solo il titolare cambia prezzi e visibilità." }, 403);
  const ver = cur.ver + 1;
  await saveMenu(env, cur.rooms, ver);
  return json({ ok: true, ver, dish: hit });
}
async function putSite(req, env) {
  const site = sanitizeSite(await body(req));
  await saveSite(env, site);
  return json({ ok: true, site });
}
// Photos come from the admin already resized (webp/jpeg, ≤ 900 KB). Ids: room_<roomId> or dish_<dishId>.
async function putMedia(req, env, id) {
  if (!/^(room|dish)_[a-z0-9-]{1,100}$/.test(id)) return json({ error: "id non valido" }, 400);
  const b = await body(req);
  const data = String(b.data || "").replace(/^data:[^,]*,/, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(data) || data.length < 100) return json({ error: "Immagine non valida." }, 400);
  const bytes = Math.round(data.length * 0.75);
  if (bytes > 900000) return json({ error: "Immagine troppo grande (max 900 KB)." }, 413);
  const head = atob(data.slice(0, 24));
  const mime = head.startsWith("\xff\xd8") ? "image/jpeg" : head.startsWith("\x89PNG") ? "image/png" : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP" ? "image/webp" : null;
  if (!mime) return json({ error: "Formato non riconosciuto: serve JPEG, PNG o WEBP." }, 400);
  const ver = Date.now();
  await env.DB.prepare("INSERT INTO media (id, mime, data, bytes, ver) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, data = excluded.data, bytes = excluded.bytes, ver = excluded.ver").bind(id, mime, data, bytes, ver).run();
  return json({ ok: true, id, ver, bytes, url: `/media/${id}?v=${ver}` });
}
async function delMedia(env, id) {
  await env.DB.prepare("DELETE FROM media WHERE id = ?").bind(clean(id, 80)).run();
  return json({ ok: true });
}
