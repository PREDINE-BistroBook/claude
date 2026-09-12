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
  bookings.sort((a, b) => (a.date < b.date ? 1 : -1));
  const credits = [];
  users.forEach((u, i) => { if (i % 4 === 1) credits.push({ id: "c" + i, user_id: u.id, kind: "referral", pct: 40, status: "available", reason: "Invited by " + NAMES[(i + 3) % NAMES.length], created_at: iso(today) }); if (i % 9 === 2) credits.push({ id: "cl" + i, user_id: u.id, kind: "loyalty", pct: 100, status: "available", reason: "Session 10 — every 10th is free", created_at: iso(today) }); });
  const admins = [{ id: "a1", email: "owner@zenrecovery.com", name: "Owner", role: "all", created_at: "2026-09-01", last_login: iso(today) }, { id: "a2", email: "shaarawy@zenrecovery.com", name: "Shaarawy", role: "cairo", created_at: "2026-09-01", last_login: iso(today) }, { id: "a3", email: "florence@zenrecovery.com", name: "Zen Florence", role: "florence", created_at: "2026-09-01", last_login: null }];
  const settings = { loyalty_every: 10, referral_pct: 40, platform_fee_pct: 2 };

  // demo "sessions"
  const S = { get user() { try { return sessionStorage.getItem("zen_demo_user"); } catch { return null; } }, set user(v) { try { v ? sessionStorage.setItem("zen_demo_user", v) : sessionStorage.removeItem("zen_demo_user"); } catch {} },
              get admin() { try { return sessionStorage.getItem("zen_demo_admin"); } catch { return null; } }, set admin(v) { try { v ? sessionStorage.setItem("zen_demo_admin", v) : sessionStorage.removeItem("zen_demo_admin"); } catch {} } };
  const live = (b) => ["paid", "confirmed", "done"].includes(b.status);
  const err = (msg, status = 400) => { throw Object.assign(new Error(msg), { status, data: { error: msg } }); };
  const cityMeta = () => Object.fromEntries(Object.entries(CITY).map(([k, c]) => [k, { name: c.name, currency: c.currency, services: c.services.map(([id, name, amount]) => ({ id, name, amount })) }]));

  function bundle(u) {
    const mine = bookings.filter((b) => b.user_id === u.id && live(b));
    return { user: u, credits: credits.filter((c) => c.user_id === u.id && c.status !== "used"), stats: { done: mine.filter((b) => b.status === "done").length, upcoming: mine.filter((b) => b.status !== "done").length }, settings, referrer: u.referred_by ? users.find((x) => x.id === u.referred_by)?.name : null, invited: users.filter((x) => x.referred_by === u.id).map((x) => ({ name: x.name, created_at: x.created_at, sessions: bookings.filter((b) => b.user_id === x.id && live(b)).length })), share_url: location.origin + location.pathname.replace(/[^/]*$/, "") + "account.html?ref=" + u.referral_code, demo: true };
  }
  const scopeOf = (a, req) => (a.role !== "all" ? a.role : CITY[req] ? req : null);
  const month = (d) => d.slice(0, 7);
  const ym = (offset) => { const d = new Date(today.getFullYear(), today.getMonth() + offset, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

  const Demo = {
    handle(method, path, body) {
      const url = new URL(path, location.origin); path = url.pathname; const qp = url.searchParams;
      // ----- client -----
      if (path === "/api/status") return { live: false, preview: true, demo: true };
      if (path === "/api/auth/request-link") { if (!body.email) err("That email doesn't look right."); if (!body.name && !users.find((u) => u.email === body.email)) err("Tell us your name so we know who's coming."); return { ok: true, demo: true }; }
      if (path === "/api/auth/demo-login") { if (body.fresh) { const u = users.find((x) => !x.intake) || users[4]; u.intake = null; S.user = u.id; return bundle(u); } S.user = "u4"; return bundle(users[3]); }
      if (path === "/api/auth/logout") { S.user = null; return {}; }
      if (path === "/api/me") { const u = users.find((x) => x.id === S.user); if (!u) return { user: null, demo: true }; if (method === "PUT") Object.assign(u, { name: body.name || u.name, phone: body.phone ?? u.phone, city: body.city || u.city, notes: body.notes ?? u.notes, birthday: body.birthday === undefined ? u.birthday : body.birthday, photo: body.photo === undefined ? u.photo : body.photo, country: body.country || u.country, city_text: body.city_text ?? u.city_text, nearest_city: body.nearest_city === undefined ? u.nearest_city : body.nearest_city, intake: body.intake === undefined ? u.intake : body.intake }); return bundle(u); }
      if (path === "/api/me/bookings") { return { bookings: bookings.filter((b) => b.user_id === S.user && b.status !== "pending") }; }
      if (path === "/api/checkout") return { preview: true, error: "Payments are not switched on yet." };
      // ----- admin -----
      if (path === "/api/admin/login") { const a = admins.find((x) => x.email === (body.email || "").toLowerCase()) || admins[0]; if (!body.password) err("Wrong email or password.", 401); S.admin = a.id; return { admin: a, demo: true }; }
      if (path === "/api/admin/demo-login") { S.admin = body.role === "florence" ? "a3" : body.role === "cairo" ? "a2" : "a1"; return { admin: admins.find((a) => a.id === S.admin) }; }
      if (path === "/api/admin/logout") { S.admin = null; return {}; }
      const a = admins.find((x) => x.id === S.admin);
      if (path.startsWith("/api/admin/")) {
        if (!a) err("Sign in first.", 401);
        const city = scopeOf(a, qp.get("city") || body.city);
        const inScope = (b) => !city || b.city === city;
        if (path === "/api/admin/me") return { admin: a, cities: cityMeta(), settings, demo: true };
        if (path === "/api/admin/stats") {
          const rows = bookings.filter((b) => inScope(b) && live(b));
          const agg = (list, key) => { const m = {}; list.forEach((b) => { const k = key(b); (m[k] ||= { n: 0, rev: 0, fee: 0, done: 0, clients: new Set() }); m[k].n++; m[k].rev += b.amount; m[k].fee += b.platform_fee; m[k].done += b.status === "done"; m[k].clients.add(b.user_id); }); return m; };
          const months = []; for (let i = -11; i <= 0; i++) { const mm = ym(i); const per = agg(rows.filter((b) => month(b.date) === mm), (b) => b.currency); Object.entries(per).forEach(([currency, v]) => months.push({ m: mm, currency, n: v.n, rev: v.rev, fee: v.fee, done: v.done, clients: v.clients.size })); }
          const tm = Object.entries(agg(rows.filter((b) => month(b.date) === ym(0)), (b) => b.currency)).map(([currency, v]) => ({ currency, n: v.n, rev: v.rev, fee: v.fee, done: v.done }));
          const lm = Object.entries(agg(rows.filter((b) => month(b.date) === ym(-1)), (b) => b.currency)).map(([currency, v]) => ({ currency, n: v.n, rev: v.rev }));
          const bs = Object.entries(agg(rows, (b) => b.service_name + "|" + b.currency)).map(([k, v]) => ({ name: k.split("|")[0], currency: k.split("|")[1], n: v.n, rev: v.rev })).sort((x, y) => y.n - x.n).slice(0, 8);
          const st = {}; bookings.filter((b) => inScope(b) && b.status !== "pending").forEach((b) => (st[b.status] = (st[b.status] || 0) + 1));
          const cl = new Set(rows.map((b) => b.user_id)); const newC = new Set(rows.filter((b) => users.find((u) => u.id === b.user_id)?.created_at >= ym(0)).map((b) => b.user_id));
          const t = iso(today);
          const byCity = a.role === "all" && !city ? Object.entries(agg(rows.filter((b) => month(b.date) === ym(0)), (b) => b.city + "|" + b.currency)).map(([k, v]) => ({ city: k.split("|")[0], currency: k.split("|")[1], n: v.n, rev: v.rev, fee: v.fee })) : [];
          const rw = {}; credits.filter((c) => !city || users.find((u) => u.id === c.user_id)?.city === city).forEach((c) => { const k = c.kind + "|" + c.status; rw[k] = (rw[k] || 0) + 1; });
          return { city, months, this_month: tm, last_month: lm, by_service: bs, by_status: Object.entries(st).map(([status, n]) => ({ status, n })), clients: { total: cl.size, new_this_month: newC.size }, upcoming: rows.filter((b) => b.status !== "done" && b.date >= t).length, today: rows.filter((b) => b.date === t && b.status !== "done"), by_city: byCity, rewards: Object.entries(rw).map(([k, n]) => ({ kind: k.split("|")[0], status: k.split("|")[1], n })), show_fee: a.role === "all" };
        }
        if (path === "/api/admin/bookings" && method === "GET") {
          let list = bookings.filter((b) => inScope(b) && b.status !== "pending");
          const status = qp.get("status"), from = qp.get("from"), to = qp.get("to"), q = (qp.get("q") || "").toLowerCase();
          if (status) list = list.filter((b) => b.status === status); if (from) list = list.filter((b) => b.date >= from); if (to) list = list.filter((b) => b.date <= to);
          if (q) list = list.filter((b) => (b.name + b.email + b.phone).toLowerCase().includes(q));
          const FL = ["pregnant", "anticoagulant", "bleeding", "heart", "diabetes", "skin", "surgery"];
          return { bookings: list.slice(0, 300).map((b) => { const u = users.find((x) => x.id === b.user_id); const i = u?.intake || {}; return { ...b, platform_fee: a.role === "all" ? b.platform_fee : undefined, health: i.health || [], flags: (i.health || []).filter((h) => FL.includes(h)), pain: i.pain || [], goals: i.goals || [], experience: i.experience || null, user_notes: u?.notes || "", user_nearest: u?.nearest_city || null }; }), city };
        }
        if (path === "/api/admin/bookings" && method === "POST") {
          const ck = city || body.city; const svc = CITY[ck]?.services.find((s) => s[0] === body.service); if (!svc) err("Pick a city and a session."); if (!body.name || !body.date) err("Name and day are required.");
          const u = users.find((x) => x.email === (body.email || "").toLowerCase());
          bookings.unshift({ id: "b" + bid++, user_id: u?.id || null, name: body.name, email: body.email || "", phone: body.phone || "", city: ck, service_id: svc[0], service_name: svc[1], date: body.date, slot: body.slot || "morning", note: body.note || "", list_amount: svc[2], amount: Number.isInteger(body.amount) ? body.amount : svc[2], currency: CITY[ck].currency, discount_kind: null, platform_fee: 0, status: body.status || "confirmed", source: "manual", created_at: iso(today) + " 12:00:00" });
          return { ok: true };
        }
        let mm = path.match(/^\/api\/admin\/bookings\/(\w+)$/);
        if (mm && method === "PATCH") { const b = bookings.find((x) => x.id === mm[1] && inScope(x)); if (!b) err("Not found", 404); if (body.status) b.status = body.status; if (body.slot !== undefined) b.slot = body.slot; if (body.note !== undefined) b.note = body.note; return { ok: true }; }
        if (path === "/api/admin/clients") {
          const q = (qp.get("q") || "").toLowerCase();
          const list = users.filter((u) => (!city || bookings.some((b) => b.user_id === u.id && b.city === city)) && (!q || (u.name + u.email + u.phone).toLowerCase().includes(q))).map((u) => { const mine = bookings.filter((b) => b.user_id === u.id && live(b) && inScope(b)); return { ...u, referrer_name: users.find((x) => x.id === u.referred_by)?.name || null, sessions: mine.length, done: mine.filter((b) => b.status === "done").length, last_visit: mine[0]?.date || null, credits: credits.filter((c) => c.user_id === u.id && c.status === "available").length }; }).sort((x, y) => ((y.last_visit || "") > (x.last_visit || "") ? 1 : -1));
          const FL2 = ["pregnant", "anticoagulant", "bleeding", "heart", "diabetes", "skin", "surgery"];
          list.forEach((c) => { c.flags = (c.intake?.health || []).filter((h) => FL2.includes(h)); c.has_intake = Boolean(c.intake); delete c.intake; });
          return { clients: list, city };
        }
        mm = path.match(/^\/api\/admin\/clients\/(\w+)$/);
        if (mm) { const u = users.find((x) => x.id === mm[1]); const bl = bookings.filter((b) => b.user_id === u?.id && inScope(b)); if (!u || (city && !bl.length)) err("Not found", 404); return { client: { ...u, flags: (u.intake?.health || []).filter((h) => ["pregnant", "anticoagulant", "bleeding", "heart", "diabetes", "skin", "surgery"].includes(h)), referrer_name: users.find((x) => x.id === u.referred_by)?.name || null }, bookings: bl, credits: credits.filter((c) => c.user_id === u.id) }; }
        if (path === "/api/admin/settings") { if (method === "PUT") { if (a.role !== "all") err("Only the owner can change this.", 403); settings.loyalty_every = Number(body.loyalty_every) || 10; settings.referral_pct = Number(body.referral_pct) || 40; } return settings; }
        if (path === "/api/admin/admins" && method === "GET") { if (a.role !== "all") err("Only the owner can see this.", 403); return { admins }; }
        if (path === "/api/admin/admins" && method === "POST") { if (a.role !== "all") err("Only the owner can add admins.", 403); if (!body.email || !body.name || (body.password || "").length < 10) err("Name, email, role and a password of at least 10 characters."); admins.push({ id: "a" + (admins.length + 1), email: body.email, name: body.name, role: body.role, created_at: iso(today), last_login: null }); return { ok: true }; }
        mm = path.match(/^\/api\/admin\/admins\/(\w+)$/);
        if (mm && method === "DELETE") { if (mm[1] === a.id) err("You can't remove yourself."); const i = admins.findIndex((x) => x.id === mm[1]); if (i >= 0) admins.splice(i, 1); return { ok: true }; }
        if (path === "/api/admin/password") { if ((body.password || "").length < 10) err("Use at least 10 characters."); return { ok: true }; }
      }
      err("Not found", 404);
    },
  };
})();
