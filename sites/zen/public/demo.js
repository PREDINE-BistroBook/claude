/* Zen Recovery — API client with a built-in demo mode.
   ZenAPI(method, path, body) calls the Worker. If the API isn't there (this preview build, or a static host),
   it answers from a generated sample dataset so the client area and the admin can be reviewed before anything is deployed.
   Nothing in this file runs on the live site once /api answers. */
(function () {
  let demo = null; // null = unknown, true/false once probed
  const isJson = (r) => (r.headers.get("content-type") || "").includes("application/json");

  window.ZenAPI = async function (method, path, body) {
    if (demo !== true) {
      try {
        const r = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
        if (isJson(r)) { demo = false; const data = r.status === 204 ? {} : await r.json(); if (!r.ok) throw Object.assign(new Error(data.error || "Request failed"), { status: r.status, data }); return data; }
        if (r.status === 204) { demo = false; return {}; }
      } catch (e) { if (e.status) throw e; }
      demo = true;
    }
    return Demo.handle(method, path, body || {});
  };
  window.ZenAPI.isDemo = () => demo === true;

  /* ---------------- sample data ---------------- */
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const CITY = {
    cairo: { name: "Cairo", currency: "egp", services: [["cai-man", "Manual therapy · 60 min · Cairo", 100000], ["cai-dry", "Dry cupping · 45 min · Cairo", 90000], ["cai-slide", "Sliding cupping · 60 min · Cairo", 120000], ["cai-fire", "Fire cupping · 45 min · Cairo", 100000], ["cai-hij", "Hijama · 60 min · Cairo", 110000], ["cai-face", "Facial cupping · 30 min · Cairo", 70000]] },
    dahab: { name: "Dahab", currency: "egp", services: [["dah-man", "Manual therapy · 60 min · Dahab", 100000], ["dah-dry", "Dry cupping · 45 min · Dahab", 90000], ["dah-slide", "Sliding cupping · 60 min · Dahab", 120000], ["dah-fire", "Fire cupping · 45 min · Dahab", 100000], ["dah-face", "Facial cupping · 30 min · Dahab", 70000]] },
    florence: { name: "Florence", currency: "eur", services: [["flo-man", "Manual therapy · 60 min · Florence", 6000], ["flo-dry", "Dry cupping · 45 min · Florence", 5500], ["flo-slide", "Sliding cupping · 60 min · Florence", 7000], ["flo-fire", "Fire cupping · 45 min · Florence", 6500], ["flo-face", "Facial cupping · 30 min · Florence", 4500]] },
  };
  const NAMES = ["Omar Hassan", "Sara Mansour", "Luca Bianchi", "Giulia Rossi", "Youssef Adel", "Nour El Din", "Marco Conti", "Chiara Ferri", "Ahmed Samir", "Laila Fathy", "Francesco Neri", "Elena Galli", "Karim Nabil", "Mariam Aziz", "Tommaso Ricci", "Sofia Marchetti", "Hana Tarek", "Davide Moretti", "Mostafa Kamal", "Alice Fontana", "Ziad Emad", "Beatrice Romano", "Hossam Farid", "Valentina Greco", "Tarek Lotfy", "Federico Costa", "Dina Wael", "Camilla Bruno", "Amr Selim", "Matteo Villa"];
  const users = NAMES.map((n, i) => {
    const city = i % 3 === 0 ? "cairo" : i % 3 === 1 ? "dahab" : "florence";
    const created = new Date(today); created.setDate(created.getDate() - Math.floor(rnd() * 330));
    const intake = i % 5 === 4 ? null : { goals: pick([["recovery"], ["pain", "posture"], ["stress"], ["recovery", "injury"], ["curious"]]), pain: pick([["lower_back"], ["neck", "shoulder_r"], ["upper_back", "mid_back"], [], ["calf_l", "thigh_l"]]), activity: pick(["low", "moderate", "high", "athlete"]), sport: pick(["Gym", "Football", "Diving", "", "Running"]), experience: pick(["first", "some", "regular"]), health: i % 6 === 0 ? ["anticoagulant"] : i % 9 === 0 ? ["pregnant"] : ["none"], health_notes: i % 6 === 0 ? "Daily aspirin 100mg" : "", contact: "whatsapp", time_pref: pick(["morning", "evening", "any"]), completed_at: iso(created) + "T10:05:00Z" };
    return { id: "u" + (i + 1), name: n, email: n.toLowerCase().replace(/ /g, ".") + "@example.com", phone: city === "florence" ? "+39 3" + Math.floor(10000000 + rnd() * 89999999) : "+20 1" + Math.floor(100000000 + rnd() * 899999999), city, photo: null, notes: i % 7 === 0 ? "Lower back — old disc issue, go light" : "", birthday: null, referral_code: "ZEN" + (100 + i), referred_by: i > 4 && rnd() < .3 ? "u" + (1 + Math.floor(rnd() * 4)) : null, created_at: iso(created) + " 10:00:00", last_login: iso(today), country: city === "florence" ? "IT" : "EG", city_text: city === "florence" ? "Firenze" : city === "dahab" ? "Sharm El Sheikh" : "Maadi", nearest_city: city, intake };
  });
  const bookings = []; let bid = 1;
  for (const u of users) {
    const n = 1 + Math.floor(rnd() * 11);
    for (let k = 0; k < n; k++) {
      const city = rnd() < .8 ? u.city : pick(Object.keys(CITY));
      const svc = pick(CITY[city].services);
      const d = new Date(today); d.setDate(d.getDate() - Math.floor(rnd() * 320) + (k === n - 1 && rnd() < .35 ? 20 : 0));
      const future = d > today;
      const status = future ? pick(["paid", "confirmed", "confirmed"]) : rnd() < .9 ? "done" : pick(["cancelled", "no_show"]);
      const disc = rnd() < .12 ? pick(["loyalty", "referral"]) : null;
      const amount = disc === "loyalty" ? 0 : disc === "referral" ? Math.round(svc[2] * .6) : svc[2];
      bookings.push({ id: "b" + bid++, user_id: u.id, name: u.name, email: u.email, phone: u.phone, city, service_id: svc[0], service_name: svc[1], date: iso(d), slot: pick(["morning", "afternoon", "evening", "10:30", "17:00"]), note: "", list_amount: svc[2], amount, currency: CITY[city].currency, discount_kind: disc, platform_fee: Math.round(amount * .02), status, source: rnd() < .15 ? "manual" : "web", created_at: iso(d) + " 09:12:00" });
    }
  }
  bookings.forEach((b, i) => { if (b.status === "done" && i % 4 === 0) { b.therapist_note = "Worked the upper back and right shoulder. At home: doorway stretch morning and evening, and no heavy pressing this week."; } if (b.status === "done" && i % 3 === 0) { b.rating = 4 + (i % 2); b.feedback = i % 2 ? "Slept like a baby." : ""; } });
  bookings.sort((a, b) => (a.date < b.date ? 1 : -1));
  const credits = [];
  users.forEach((u, i) => { if (i % 4 === 1) credits.push({ id: "c" + i, user_id: u.id, kind: "referral", pct: 40, status: "available", reason: "Invited by " + NAMES[(i + 3) % NAMES.length], created_at: iso(today) }); if (i % 9 === 2) credits.push({ id: "cl" + i, user_id: u.id, kind: "loyalty", pct: 100, status: "available", reason: "Session 10 — every 10th is free", created_at: iso(today) }); });
  const admins = [{ id: "a1", email: "owner@zenrecovery.com", name: "Owner", role: "all", created_at: "2026-09-01", last_login: iso(today) }, { id: "a2", email: "shaarawy@zenrecovery.com", name: "Shaarawy", role: "cairo", created_at: "2026-09-01", last_login: iso(today) }, { id: "a3", email: "florence@zenrecovery.com", name: "Zen Florence", role: "florence", created_at: "2026-09-01", last_login: null }, { id: "a4", email: "amicomio", name: "Amico Mio", role: "platform", created_at: "2026-09-12", last_login: iso(today) }];
  const settings = { loyalty_every: 10, referral_pct: 40, birthday_pct: 50, package_pct: 15, platform_fee_pct: 2, gmaps: { cairo: "", dahab: "", florence: "" }, whatsapp: { cairo: "", dahab: "", florence: "" }, review: { cairo: "", dahab: "", florence: "" } };
  const therapists = [{ id: "t0", city: "cairo", name: "Mazen Emad", title: "Founder · Sports recovery specialist", bio: "Cupping, deep sports massage and dry needling.", story: "Born in Cairo in 2002, Mazen graduated from the Faculty of Physical Education and moved fast into one of the most precise corners of sports medicine: therapeutic recovery.\n\nHe works at Gold's Gym Beverly Hills in Sheikh Zayed and has treated football stars, bodybuilding champions and business people; visitors from the Gulf come back to him on every trip to Egypt.", certs: "Professional Program in Sports Massage — AUPS Academy, 2025, grade Excellent\nICO authentication no. 2539033\nFaculty of Physical Education", instagram: "mazen_emad10", photo: null, languages: "Arabic, English", active: 1, sort: 0, admin_id: null, area: "Sheikh Zayed · Gold's Gym Beverly Hills", address: "Gate 9, Beverly Hills, El Sheikh Zayed", maps_url: "https://www.google.com/maps/search/?api=1&query=Gold%27s+Gym+Beverly+Hills+Sheikh+Zayed" }, { id: "t1", city: "cairo", name: "Hesham Khaled", bio: "Cupping and sports massage", photo: null, languages: "Arabic, English", active: 1, sort: 1, admin_id: "a2", area: "Maadi", address: "Road 9, Maadi", maps_url: "https://maps.app.goo.gl/demo" }, { id: "t2", city: "dahab", name: "Shaarawy", title: "Cupping & manual therapy · Dahab", bio: "Cupping, manual therapy and recovery in Dahab.", story: "Shaarawy is the one who does the cupping in Dahab: manual therapy, cupping and recovery for divers, climbers and anyone who trains hard by the sea.\n\nMessage the Dahab WhatsApp before your first visit and it's Shaarawy who answers.", instagram: "recoverywithshaarawy", photo: "img/team/shaarawy.jpg", languages: "Arabic, English", active: 1, sort: 0, admin_id: null, area: "Dahab", address: "", maps_url: "" }, { id: "t3", city: "florence", name: "Zen Florence", bio: "Cupping and sports recovery", photo: null, languages: "Italian, English", active: 1, sort: 0 }];
  const packs = [{ id: "p1", city: "cairo", name: "5 sessions", sessions: 5, amount: 400000, currency: "egp", months_valid: 6, active: 1, sort: 0 }, { id: "p2", city: "dahab", name: "5 sessions", sessions: 5, amount: 400000, currency: "egp", months_valid: 6, active: 1, sort: 0 }, { id: "p3", city: "florence", name: "5 sessions", sessions: 5, amount: 25000, currency: "eur", months_valid: 6, active: 1, sort: 0 }];
  const partners = [{ id: "pa1", code: "DIVERS10", name: "Dahab Divers", city: "dahab", pct: 10, active: 1, bookings: 4, this_month: 1, revenue: 360000, last_booking: iso(today) }];
  // Florence: Shika Mon–Sat 10–18; Cairo: whole room Sun–Thu 11–20, Shaarawy Fri 14–20. Days off: Christmas in Florence, one afternoon in Cairo.
  const availability = [...[1, 2, 3, 4, 5, 6].map((d) => ({ id: "avf" + d, city: "florence", therapist_id: "t3", weekday: d, start: "10:00", end: "18:00", slot_minutes: 60 })), ...[0, 1, 2, 3, 4].map((d) => ({ id: "avc" + d, city: "cairo", therapist_id: null, weekday: d, start: "11:00", end: "20:00", slot_minutes: 60 })), { id: "avc5", city: "cairo", therapist_id: "t1", weekday: 5, start: "14:00", end: "20:00", slot_minutes: 60 }];
  const blocked = [...Array.from({ length: 11 }, (_, i) => { const d = new Date(today.getFullYear(), 11, 23 + i); return { id: "blx" + i, city: "florence", therapist_id: null, date: iso(d), start: null, end: null, reason: "Christmas" }; }), { id: "bly", city: "cairo", therapist_id: "t1", date: iso(new Date(today.getTime() + 9 * 86400e3)), start: "14:00", end: "17:00", reason: "Dentist" }];
  const DESC = { man: "Deep tissue and sports massage, hands only.", dry: "Cups placed and left still. The classic session.", slide: "Oiled skin, gliding cups. Massage with the lift built in.", fire: "Glass cups, a flash of flame, deeper warmth.", hij: "Wet cupping with sterile single-use equipment.", face: "Light, gliding, no marks." };
  const services = Object.entries(CITY).flatMap(([city, c]) => c.services.map(([id, name, amount], i) => ({ id, city, name: name.split(" · ")[0], minutes: Number(name.split(" · ")[1]), amount, currency: c.currency, description: DESC[id.split("-")[1]] || "", active: 1, sort: i })));
  const svcMeta = (k) => services.filter((x) => x.city === k && x.active).map((x) => ({ id: x.id, name: `${x.name} · ${x.minutes} min · ${CITY[k].name}`, short: x.name, amount: x.amount, minutes: x.minutes, description: x.description }));

  // demo "sessions"
  const S = { get user() { try { return sessionStorage.getItem("zen_demo_user"); } catch { return null; } }, set user(v) { try { v ? sessionStorage.setItem("zen_demo_user", v) : sessionStorage.removeItem("zen_demo_user"); } catch {} },
              get admin() { try { return sessionStorage.getItem("zen_demo_admin"); } catch { return null; } }, set admin(v) { try { v ? sessionStorage.setItem("zen_demo_admin", v) : sessionStorage.removeItem("zen_demo_admin"); } catch {} } };
  const live = (b) => ["paid", "confirmed", "done"].includes(b.status);
  const err = (msg, status = 400) => { throw Object.assign(new Error(msg), { status, data: { error: msg } }); };
  const cityMeta = () => Object.fromEntries(Object.entries(CITY).map(([k, c]) => [k, { name: c.name, currency: c.currency, services: svcMeta(k) }]));

  function bundle(u) {
    const mine = bookings.filter((b) => b.user_id === u.id && live(b));
    return { user: u, credits: credits.filter((c) => c.user_id === u.id && c.status !== "used"), stats: { done: mine.filter((b) => b.status === "done").length, upcoming: mine.filter((b) => b.status !== "done").length }, settings, referrer: u.referred_by ? users.find((x) => x.id === u.referred_by)?.name : null, invited: users.filter((x) => x.referred_by === u.id).map((x) => ({ name: x.name, created_at: x.created_at, sessions: bookings.filter((b) => b.user_id === x.id && live(b)).length })), share_url: location.origin + location.pathname.replace(/[^/]*$/, "") + "account.html?ref=" + u.referral_code, demo: true };
  }
  const scopeOf = (a, req) => (a.role !== "all" && a.role !== "platform" ? a.role : CITY[req] ? req : null);
  const month = (d) => d.slice(0, 7);
  const ym = (offset) => { const d = new Date(today.getFullYear(), today.getMonth() + offset, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

  const Demo = {
    handle(method, path, body) {
      const url = new URL(path, location.origin); path = url.pathname; const qp = url.searchParams;
      // ----- client -----
      if (path === "/api/status") return { live: false, preview: true, google: false, apple: false, sms: false, demo: true, settings: { loyalty_every: settings.loyalty_every, referral_pct: settings.referral_pct, birthday_pct: settings.birthday_pct, package_pct: settings.package_pct }, gmaps: settings.gmaps, whatsapp: settings.whatsapp, review: settings.review };
      if (path === "/api/catalog") return { cities: Object.fromEntries(Object.entries(CITY).map(([k, c]) => [k, { name: c.name, currency: c.currency.toUpperCase(), address: null, team: null, whatsapp: null, gmaps: null, services: svcMeta(k).map((x) => ({ id: x.id, name: x.short, dur: x.minutes, price: x.amount, desc: x.description })) }])) };
      if (path === "/api/slots") return { mode: "windows", slots: [] };
      if (path === "/api/team") { const c = qp.get("city"); return { therapists: therapists.filter((t) => t.active && (!c || t.city === c)) }; }
      if (path === "/api/packages") { const c = qp.get("city"); return { packages: packs.filter((p) => p.active && (!c || p.city === c)).map((p) => ({ ...p, per_session: Math.round(p.amount / p.sessions) })) }; }
      if (path === "/api/packages/checkout" || path === "/api/gift/checkout") err("Payments are not switched on yet.", 503);
      if (path.startsWith("/api/gift/")) err("We don't know that gift code.", 404);
      if (path.startsWith("/api/partner/")) { const pr = partners.find((x) => x.code === path.split("/").pop().toUpperCase()); if (!pr) err("We don't know that code.", 404); return { partner: pr }; }
      if (path === "/api/waitlist") { if (!S.user) err("Sign in first.", 401); return { ok: true }; }
      if (path === "/api/me/waitlist") return { waitlist: [] };
      if (path === "/api/me/packages") { const u = users.find((x) => x.id === S.user); if (!u) err("Sign in first.", 401); return { packages: u.id === "u4" ? [{ id: "cp1", name: "5 sessions", city: u.city, sessions: 5, remaining: 3, amount: 400000, currency: "egp", status: "paid", expires_at: iso(new Date(today.getTime() + 120 * 86400e3)), paid_at: iso(today), usable: true }] : [] }; }
      if (path === "/api/me/photos") return { photos: [] };
      if (path === "/api/me/export") { const u = users.find((x) => x.id === S.user); if (!u) err("Sign in first.", 401); return { exported_at: iso(today), user: u, bookings: bookings.filter((b) => b.user_id === u.id), checkins: u.checkins || [], credits: credits.filter((c) => c.user_id === u.id), packages: [], photos: [], messages: [] }; }
      if (path === "/api/me/checkins") { const u = users.find((x) => x.id === S.user); if (!u) err("Sign in first.", 401); u.checkins ||= [{ date: iso(new Date(today - 21 * 86400e3)), pain: 7, energy: 2, sleep: 2, note: "" }, { date: iso(new Date(today - 14 * 86400e3)), pain: 5, energy: 3, sleep: 3, note: "after first session" }, { date: iso(new Date(today - 7 * 86400e3)), pain: 4, energy: 3, sleep: 4, note: "" }];
        if (method === "POST") { const d = iso(today); u.checkins = u.checkins.filter((c) => c.date !== d); u.checkins.push({ date: d, pain: body.pain, energy: body.energy, sleep: body.sleep, note: body.note || "" }); u.checkins.sort((a, b) => (a.date > b.date ? 1 : -1)); }
        return { checkins: u.checkins }; }
      { const fb = path.match(/^\/api\/me\/bookings\/(\w+)\/feedback$/); if (fb) { const b = bookings.find((x) => x.id === fb[1] && x.user_id === S.user); if (!b || b.status !== "done") err("You can rate a session once it's marked as done."); b.rating = body.rating; b.feedback = body.feedback || ""; return { ok: true }; } }
      if (path === "/api/auth/request-link") { if (!body.email) err("That email doesn't look right."); if (!body.name && !users.find((u) => u.email === body.email)) err("Tell us your name so we know who's coming."); return { ok: true, demo: true }; }
      if (path === "/api/auth/demo-login") { if (body.fresh) { const u = users.find((x) => !x.intake) || users[4]; u.intake = null; S.user = u.id; return bundle(u); } S.user = "u4"; return bundle(users[3]); }
      if (path === "/api/auth/logout") { S.user = null; return {}; }
      if (path === "/api/me") { const u = users.find((x) => x.id === S.user); if (!u) return { user: null, demo: true }; if (method === "PUT") Object.assign(u, { name: body.name || u.name, phone: body.phone ?? u.phone, city: body.city || u.city, notes: body.notes ?? u.notes, birthday: body.birthday === undefined ? u.birthday : body.birthday, photo: body.photo === undefined ? u.photo : body.photo, country: body.country || u.country, city_text: body.city_text ?? u.city_text, nearest_city: body.nearest_city === undefined ? u.nearest_city : body.nearest_city, intake: body.intake === undefined ? u.intake : body.intake }); return bundle(u); }
      if (path === "/api/me/bookings") { return { bookings: bookings.filter((b) => b.user_id === S.user && b.status !== "pending") }; }
      if (path === "/api/checkout") return { preview: true, error: "Payments are not switched on yet." };
      // ----- admin -----
      if (path === "/api/admin/login") { const a = admins.find((x) => x.email === (body.email || "").toLowerCase()) || admins[0]; if (!body.password) err("Wrong email or password.", 401); S.admin = a.id; return { admin: a, demo: true }; }
      if (path === "/api/admin/demo-login") { S.admin = body.role === "florence" ? "a3" : body.role === "cairo" ? "a2" : body.role === "platform" ? "a4" : "a1"; return { admin: admins.find((a) => a.id === S.admin) }; }
      if (path === "/api/admin/logout") { S.admin = null; return {}; }
      const a = admins.find((x) => x.id === S.admin);
      if (path.startsWith("/api/admin/")) {
        if (!a) err("Sign in first.", 401);
        const city = scopeOf(a, qp.get("city") || body.city);
        const inScope = (b) => !city || b.city === city;
        const withLink = (t) => { const la = admins.find((x) => x.id === t.admin_id); return { ...t, admin_email: la ? (a.role === "all" ? la.email : "linked") : null, admin_name: la?.name || null, admin_role: la?.role || null }; };
        if (path === "/api/admin/me") { const t = therapists.find((x) => x.admin_id === a.id); return { admin: a, therapist: t ? { id: t.id, name: t.name, city: t.city, photo: t.photo, active: t.active } : null, cities: cityMeta(), settings, photos: "d1", live: false, demo: true }; }
        let created = null; const linkFor = (t) => { created = null; if (a.role !== "all") return; if (body.new_account) { if (!body.new_account.email || (body.new_account.password || "").length < 10) err("The new sign-in needs an email or username and a password of at least 10 characters."); if (admins.some((x) => x.email === body.new_account.email.toLowerCase())) err("That email or username already has admin access. Pick it from the list instead."); const na = { id: "a" + (admins.length + 1), email: body.new_account.email.toLowerCase(), name: t.name, role: t.city, created_at: iso(today), last_login: null }; admins.push(na); body.admin_id = na.id; created = na.email; }
          if (body.admin_id === undefined) return; if (!body.admin_id) { t.admin_id = null; return; } const la = admins.find((x) => x.id === body.admin_id); if (!la || la.role === "platform") err("That sign-in account doesn't exist."); if (la.role !== "all" && la.role !== t.city) err(`That account only sees ${CITY[la.role].name}. Change what it sees under Settings first, or pick another.`); therapists.forEach((o) => { if (o.admin_id === la.id) o.admin_id = null; }); t.admin_id = la.id; };
        if (a.role === "platform" && !["/api/admin/stats", "/api/admin/platform", "/api/admin/profile", "/api/admin/password"].includes(path)) err("Your account sees the numbers, not the operations. Ask Zen's owner for anything else.", 403);
        if (path === "/api/admin/platform") {
          const rows = bookings.filter((b) => live(b)); const t = iso(today);
          const agg = (list, key) => { const m = {}; list.forEach((b) => { const k = key(b); (m[k] ||= { n: 0, rev: 0, fee: 0, manual: 0, last: "" }); m[k].n++; m[k].rev += b.amount; m[k].fee += b.platform_fee; m[k].manual += b.source === "manual" ? 1 : 0; if (b.date > m[k].last) m[k].last = b.date; }); return m; };
          const months = []; for (let i = -11; i <= 0; i++) { const mm = ym(i); Object.entries(agg(rows.filter((b) => month(b.date) === mm), (b) => b.currency)).forEach(([currency, v]) => months.push({ m: mm, currency, ...v })); }
          const by_city = Object.entries(agg(rows, (b) => b.city + "|" + b.currency)).map(([k, v]) => ({ city: k.split("|")[0], currency: k.split("|")[1], n: v.n, rev: v.rev, fee: v.fee, manual: v.manual, last_date: v.last }));
          const totals = Object.entries(agg(rows, (b) => b.currency)).map(([currency, v]) => ({ currency, n: v.n, rev: v.rev, fee: v.fee, manual: v.manual, free: 0 }));
          return { fee_bps: 200, live: false, stripe_account: null, months, by_city, totals, packages: [], gifts: [], admins: admins.map(({ name, role, last_login, created_at }) => ({ name, role, last_login, created_at })), users: { total: users.length, new_this_month: users.filter((u) => u.created_at >= ym(0)).length, new_7d: 2 }, messages_7d: { n: 14, at: t + "T09:15:00" }, pending_review: 0, rules: { loyalty_every: settings.loyalty_every, referral_pct: settings.referral_pct, birthday_pct: settings.birthday_pct ?? 50, package_pct: settings.package_pct ?? 0 } };
        }
        if (path === "/api/admin/services" && method === "GET") return { rows: services.filter((x) => !city || x.city === city).map((x) => ({ ...x, bookings: bookings.filter((b) => b.service_id === x.id).length })) };
        if (path === "/api/admin/services" && method === "POST") { const ck = city || body.city; const id = ck.slice(0, 3) + "-" + body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"); services.push({ id, city: ck, name: body.name, minutes: body.minutes || 60, amount: body.amount, currency: CITY[ck].currency, description: body.description || "", active: body.active === false ? 0 : 1, sort: services.length, photo: body.photo || null }); return { ok: true, id }; }
        { const sm = path.match(/^\/api\/admin\/services\/([a-z0-9-]+)$/); if (sm) { const i = services.findIndex((x) => x.id === sm[1]); if (i < 0) err("Not found", 404); if (method === "DELETE") { if (bookings.some((b) => b.service_id === sm[1])) { services[i].active = 0; return { ok: true, hidden: true }; } services.splice(i, 1); return { ok: true, deleted: true }; } if (method === "PATCH") { const x = services[i]; if (body.name) x.name = body.name; if (body.minutes) x.minutes = body.minutes; if (Number.isInteger(body.amount)) x.amount = body.amount; if (body.description !== undefined) x.description = body.description; if (body.active !== undefined) x.active = body.active ? 1 : 0; if (body.photo !== undefined) x.photo = body.photo; return { ok: true }; } } }
        if (path === "/api/admin/profile") { Object.assign(a, { name: body.name || a.name, phone: body.phone ?? a.phone, photo: body.photo === undefined ? a.photo : body.photo, notify: body.notify === undefined ? (a.notify ?? 1) : body.notify ? 1 : 0 }); return { admin: a }; }
        if (path === "/api/admin/availability" && method === "GET") return { rows: availability.filter((r) => !city || r.city === city) };
        if (path === "/api/admin/availability" && method === "POST") { (body.weekdays || []).forEach((d) => availability.push({ id: "av" + availability.length, city: body.city, therapist_id: body.therapist_id || null, weekday: d, start: body.start, end: body.end, slot_minutes: body.slot_minutes || 60 })); return { ok: true }; }
        if (path === "/api/admin/blocked" && method === "GET") return { rows: blocked.filter((r) => !city || r.city === city) };
        if (path === "/api/admin/blocked" && method === "POST") { let d = body.date, n = 0; const to = body.to || body.date; while (d <= to && n++ < 60) { blocked.push({ id: "bl" + (blocked.length + Math.random().toString(36).slice(2, 6)), city: body.city, therapist_id: body.therapist_id || null, date: d, start: body.start || null, end: body.end || null, reason: body.reason || "" }); const nd = new Date(d + "T12:00:00"); nd.setDate(nd.getDate() + 1); d = iso(nd); } return { ok: true, days: n }; }
        { const rm = path.match(/^\/api\/admin\/(blocked|availability)\/remove$/); if (rm && method === "POST") { const list = rm[1] === "blocked" ? blocked : availability; let removed = 0; (body.ids || []).forEach((id) => { const i = list.findIndex((x) => x.id === id && (!city || x.city === city)); if (i >= 0) { list.splice(i, 1); removed++; } }); return { ok: true, removed }; } }
        { const dm = path.match(/^\/api\/admin\/(availability|blocked|therapists|packages|partners|photos)\/(\w+)$/); if (dm && method === "DELETE") { const list = { availability, blocked, therapists, packages: packs, partners }[dm[1]]; if (list) { const i = list.findIndex((x) => x.id === dm[2]); if (i >= 0) list.splice(i, 1); } return { ok: true }; }
          if (dm && method === "PATCH") { const list = { therapists, packages: packs, partners }[dm[1]]; const row = list?.find((x) => x.id === dm[2]); if (row && dm[1] === "therapists") { linkFor(row); delete body.admin_id; delete body.new_account; } if (row) Object.assign(row, body.active === undefined ? body : { ...body, active: body.active ? 1 : 0 }); return { ok: true, created }; } }
        if (path === "/api/admin/therapists" && method === "GET") return { rows: therapists.filter((t) => !city || t.city === city).map(withLink) };
        if (path === "/api/admin/therapists" && method === "POST") { const nt = { id: "t" + (therapists.length + 1), city: city || body.city, name: body.name, bio: body.bio || "", photo: body.photo || null, languages: body.languages || "", active: body.active === false ? 0 : 1, sort: body.sort || 0 }; linkFor(nt); therapists.push(nt); return { ok: true, id: nt.id, created }; }
        if (path === "/api/admin/packages" && method === "GET") return { rows: packs.filter((p) => !city || p.city === city) };
        if (path === "/api/admin/packages" && method === "POST") { packs.push({ id: "p" + (packs.length + 1), city: body.city, name: body.name, sessions: body.sessions, amount: body.amount, currency: CITY[body.city].currency, months_valid: body.months_valid || 6, active: body.active === false ? 0 : 1, sort: body.sort || 0 }); return { ok: true }; }
        if (path === "/api/admin/packages/sold") return { rows: [] };
        if (path === "/api/admin/partners" && method === "GET") return { rows: partners };
        if (path === "/api/admin/partners" && method === "POST") { partners.push({ id: "pa" + (partners.length + 1), code: (body.code || "ZEN" + partners.length).toUpperCase(), name: body.name, city: body.city || null, pct: body.pct, active: 1, bookings: 0, this_month: 0, revenue: 0, last_booking: null }); return { ok: true }; }
        if (path === "/api/admin/gifts") return { rows: [] };
        if (path === "/api/admin/review") { const FL = ["pregnant", "anticoagulant", "bleeding", "heart", "diabetes", "skin", "surgery"]; return { bookings: [], clients: users.filter((u) => !u.approved && (u.intake?.health || []).some((h) => FL.includes(h)) && (!city || u.city === city)).map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, nearest_city: u.nearest_city, flags: (u.intake.health || []).filter((h) => FL.includes(h)), health_notes: u.intake.health_notes || "" })) }; }
        { const ap = path.match(/^\/api\/admin\/clients\/(\w+)\/approve$/); if (ap) { const u = users.find((x) => x.id === ap[1]); if (u) u.approved = 1; return { ok: true, confirmed: 0 }; } }
        if (path === "/api/admin/photos" && method === "GET") return { photos: [] };
        if (path === "/api/admin/photos" && method === "POST") return { ok: true, id: "ph1" };
        if (path === "/api/admin/leaderboard") { const rows = users.filter((u) => users.some((f) => f.referred_by === u.id)).map((u) => { const inv = users.filter((f) => f.referred_by === u.id); return { id: u.id, name: u.name, email: u.email, city: u.city, referral_code: u.referral_code, invited: inv.length, converted: inv.filter((f) => bookings.some((b) => b.user_id === f.id && live(b))).length, rewards: 0 }; }).sort((x, y) => y.converted - x.converted); return { rows }; }
        if (path === "/api/admin/messages") return { rows: [] };
        if (path === "/api/admin/waitlist") return { rows: [] };
        if (path === "/api/admin/slots") return { mode: "windows", slots: [] };
        if (path === "/api/admin/stats") {
          const ratingsRows = bookings.filter((b) => inScope(b) && b.rating); const ratings = { n: ratingsRows.length, avg: ratingsRows.reduce((s, b) => s + b.rating, 0) / (ratingsRows.length || 1), five: ratingsRows.filter((b) => b.rating === 5).length };
          const rows = bookings.filter((b) => inScope(b) && live(b));
          const agg = (list, key) => { const m = {}; list.forEach((b) => { const k = key(b); (m[k] ||= { n: 0, rev: 0, fee: 0, done: 0, clients: new Set() }); m[k].n++; m[k].rev += b.amount; m[k].fee += b.platform_fee; m[k].done += b.status === "done"; m[k].clients.add(b.user_id); }); return m; };
          const months = []; for (let i = -11; i <= 0; i++) { const mm = ym(i); const per = agg(rows.filter((b) => month(b.date) === mm), (b) => b.currency); Object.entries(per).forEach(([currency, v]) => months.push({ m: mm, currency, n: v.n, rev: v.rev, fee: v.fee, done: v.done, clients: v.clients.size })); }
          const tm = Object.entries(agg(rows.filter((b) => month(b.date) === ym(0)), (b) => b.currency)).map(([currency, v]) => ({ currency, n: v.n, rev: v.rev, fee: v.fee, done: v.done }));
          const lm = Object.entries(agg(rows.filter((b) => month(b.date) === ym(-1)), (b) => b.currency)).map(([currency, v]) => ({ currency, n: v.n, rev: v.rev }));
          const bs = Object.entries(agg(rows, (b) => b.service_name + "|" + b.currency)).map(([k, v]) => ({ name: k.split("|")[0], currency: k.split("|")[1], n: v.n, rev: v.rev })).sort((x, y) => y.n - x.n).slice(0, 8);
          const st = {}; bookings.filter((b) => inScope(b) && b.status !== "pending").forEach((b) => (st[b.status] = (st[b.status] || 0) + 1));
          const cl = new Set(rows.map((b) => b.user_id)); const newC = new Set(rows.filter((b) => users.find((u) => u.id === b.user_id)?.created_at >= ym(0)).map((b) => b.user_id));
          const t = iso(today);
          const byCity = (a.role === "all" || a.role === "platform") && !city ? Object.entries(agg(rows.filter((b) => month(b.date) === ym(0)), (b) => b.city + "|" + b.currency)).map(([k, v]) => ({ city: k.split("|")[0], currency: k.split("|")[1], n: v.n, rev: v.rev, fee: v.fee })) : [];
          const rw = {}; credits.filter((c) => !city || users.find((u) => u.id === c.user_id)?.city === city).forEach((c) => { const k = c.kind + "|" + c.status; rw[k] = (rw[k] || 0) + 1; });
          return { city, months, this_month: tm, last_month: lm, by_service: bs, by_status: Object.entries(st).map(([status, n]) => ({ status, n })), clients: { total: cl.size, new_this_month: newC.size }, upcoming: rows.filter((b) => b.status !== "done" && b.date >= t).length, today: rows.filter((b) => b.date === t && b.status !== "done"), by_city: byCity, rewards: Object.entries(rw).map(([k, n]) => ({ kind: k.split("|")[0], status: k.split("|")[1], n })), review: 0, ratings, packages: [], gifts: [], show_fee: a.role === "platform" };
        }
        if (path === "/api/admin/bookings" && method === "GET") {
          let list = bookings.filter((b) => inScope(b) && b.status !== "pending");
          const status = qp.get("status"), from = qp.get("from"), to = qp.get("to"), q = (qp.get("q") || "").toLowerCase();
          if (status) list = list.filter((b) => b.status === status); if (from) list = list.filter((b) => b.date >= from); if (to) list = list.filter((b) => b.date <= to);
          if (q) list = list.filter((b) => (b.name + b.email + b.phone).toLowerCase().includes(q));
          const FL = ["pregnant", "anticoagulant", "bleeding", "heart", "diabetes", "skin", "surgery"];
          return { bookings: list.slice(0, 300).map((b) => { const u = users.find((x) => x.id === b.user_id); const i = u?.intake || {}; return { ...b, therapist: null, platform_fee: a.role === "all" ? b.platform_fee : undefined, health: i.health || [], flags: (i.health || []).filter((h) => FL.includes(h)), pain: i.pain || [], goals: i.goals || [], experience: i.experience || null, user_notes: u?.notes || "", user_nearest: u?.nearest_city || null }; }), city };
        }
        if (path === "/api/admin/bookings" && method === "POST") {
          const ck = city || body.city; const svc = CITY[ck]?.services.find((s) => s[0] === body.service); if (!svc) err("Pick a city and a session."); if (!body.name || !body.date) err("Name and day are required.");
          const u = users.find((x) => x.email === (body.email || "").toLowerCase());
          bookings.unshift({ id: "b" + bid++, user_id: u?.id || null, name: body.name, email: body.email || "", phone: body.phone || "", city: ck, service_id: svc[0], service_name: svc[1], date: body.date, slot: body.slot || "morning", note: body.note || "", list_amount: svc[2], amount: Number.isInteger(body.amount) ? body.amount : svc[2], currency: CITY[ck].currency, discount_kind: null, platform_fee: 0, status: body.status || "confirmed", source: "manual", created_at: iso(today) + " 12:00:00" });
          return { ok: true };
        }
        let mm = path.match(/^\/api\/admin\/bookings\/(\w+)$/);
        if (mm && method === "PATCH") { const b = bookings.find((x) => x.id === mm[1] && inScope(x)); if (!b) err("Not found", 404); if (body.status) b.status = body.status; if (body.slot !== undefined) b.slot = body.slot; if (body.note !== undefined) b.note = body.note; if (body.therapist_note !== undefined) b.therapist_note = body.therapist_note; return { ok: true }; }
        if (path === "/api/admin/clients") {
          const q = (qp.get("q") || "").toLowerCase();
          const list = users.filter((u) => (!city || bookings.some((b) => b.user_id === u.id && b.city === city)) && (!q || (u.name + u.email + u.phone).toLowerCase().includes(q))).map((u) => { const mine = bookings.filter((b) => b.user_id === u.id && live(b) && inScope(b)); return { ...u, referrer_name: users.find((x) => x.id === u.referred_by)?.name || null, sessions: mine.length, done: mine.filter((b) => b.status === "done").length, last_visit: mine[0]?.date || null, credits: credits.filter((c) => c.user_id === u.id && c.status === "available").length }; }).sort((x, y) => ((y.last_visit || "") > (x.last_visit || "") ? 1 : -1));
          const FL2 = ["pregnant", "anticoagulant", "bleeding", "heart", "diabetes", "skin", "surgery"];
          list.forEach((c) => { c.flags = (c.intake?.health || []).filter((h) => FL2.includes(h)); c.has_intake = Boolean(c.intake); delete c.intake; });
          return { clients: list, city };
        }
        mm = path.match(/^\/api\/admin\/clients\/(\w+)$/);
        if (mm) { const u = users.find((x) => x.id === mm[1]); const bl = bookings.filter((b) => b.user_id === u?.id && inScope(b)); if (!u || (city && !bl.length)) err("Not found", 404); return { packages: [], photos: [], messages: [], checkins: (u.checkins || []).slice().reverse(), client: { ...u, flags: (u.intake?.health || []).filter((h) => ["pregnant", "anticoagulant", "bleeding", "heart", "diabetes", "skin", "surgery"].includes(h)), referrer_name: users.find((x) => x.id === u.referred_by)?.name || null }, bookings: bl, credits: credits.filter((c) => c.user_id === u.id) }; }
        if (path === "/api/admin/settings") { if (method === "PUT") { if (a.role !== "all") err("Only the owner can change this.", 403); if (body.loyalty_every) settings.loyalty_every = Number(body.loyalty_every); if (body.referral_pct !== undefined) settings.referral_pct = Number(body.referral_pct); if (body.birthday_pct !== undefined) settings.birthday_pct = Number(body.birthday_pct); ["gmaps", "review", "whatsapp"].forEach((k) => { if (body[k]) Object.assign(settings[k], body[k]); }); } return settings; }
        if (path === "/api/admin/admins" && method === "GET") { if (a.role !== "all") err("Only the owner can see this.", 403); return { admins: admins.map((x) => { const t = therapists.find((y) => y.admin_id === x.id); return { ...x, therapist_id: t?.id || null, therapist_name: t?.name || null, therapist_city: t?.city || null }; }) }; }
        if (path === "/api/admin/admins" && method === "POST") { if (a.role !== "all") err("Only the owner can add admins.", 403); if (!body.email || !body.name || (body.password || "").length < 10) err("Name, email, role and a password of at least 10 characters."); admins.push({ id: "a" + (admins.length + 1), email: body.email, name: body.name, role: body.role, created_at: iso(today), last_login: null }); return { ok: true }; }
        mm = path.match(/^\/api\/admin\/admins\/(\w+)$/);
        if (mm && method === "PATCH") { if (a.role !== "all") err("Only the owner can change admins.", 403); const x = admins.find((y) => y.id === mm[1]); if (!x) err("Not found", 404); if (body.role) x.role = body.role; if (body.name) x.name = body.name; return { ok: true }; }
        if (mm && method === "DELETE") { if (mm[1] === a.id) err("You can't remove yourself."); const i = admins.findIndex((x) => x.id === mm[1]); if (i >= 0) admins.splice(i, 1); therapists.forEach((t) => { if (t.admin_id === mm[1]) t.admin_id = null; }); return { ok: true }; }
        if (path === "/api/admin/password") { if ((body.password || "").length < 10) err("Use at least 10 characters."); return { ok: true }; }
      }
      err("Not found", 404);
    },
  };
})();
