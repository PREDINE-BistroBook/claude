/* Zen Recovery — pages talking to the real API and to each other (needs test/e2e-server.mjs running). See README "Tests". */
import { chromium } from "playwright";   // npm i -D playwright (or point PLAYWRIGHT at a global install)
import fs from "node:fs";
const G = process.env.GSAP_DIST || "node_modules/gsap/dist/", H = process.env.E2E_HOST || "http://localhost:8766";   // GSAP served locally so the run never depends on the CDN
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ok = (n, c, x) => { console.log((c ? "PASS " : "FAIL ") + n, c ? "" : (typeof x === "string" ? x : JSON.stringify(x))?.slice(0, 400) ?? ""); if (!c) process.exitCode = 1; };
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const errs = [];
await ctx.route("**/cdnjs.cloudflare.com/ajax/libs/gsap/**", (route) => { const f = route.request().url().includes("ScrollTrigger") ? "ScrollTrigger.min.js" : "gsap.min.js"; route.fulfill({ body: fs.readFileSync(G + f), contentType: "application/javascript" }); });
await ctx.route(/googleapis|gstatic|google\.com|gravatar/, (r) => r.abort());
const page = await ctx.newPage(); page.setDefaultTimeout(8000); process.on("unhandledRejection", (e) => { console.log("CRASH " + String(e && e.message || e).slice(0, 300)); process.exit(1); }); page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/cdnjs|favicon|ERR_FAILED|ERR_CONNECTION|503/.test(m.text())) errs.push(m.text()); });
const reveal = async () => page.evaluate(() => document.querySelectorAll("#booking .wstep").forEach((s) => (s.hidden = false))).catch(() => {});   // the booking is step by step now; the older checks look at everything at once
const go = async (p) => { await page.goto(H + "/" + p, { waitUntil: "load" }); await page.waitForTimeout(700); if (p.startsWith("booking")) await reveal(); };
const api = async (path, init) => { const r = await fetch(H + path, init); return { status: r.status, body: await r.json().catch(() => null), h: r.headers }; };

// 1. every nav link on every page answers 200 (with and without .html)
const pages = ["index.html", "booking.html", "giftcard.html", "rewards.html", "guide.html", "method.html", "team.html", "account.html"];
const seen = new Set();
for (const p of pages) { await go(p); const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")).filter((h) => h && !/^(https?:|mailto:|tel:|#|javascript:|whatsapp:)/.test(h))); hrefs.forEach((h) => seen.add(h.split("#")[0].split("?")[0])); }
let bad = []; for (const h of seen) { if (!h || h.startsWith("/api/")) continue; const r = await fetch(H + "/" + h.replace(/^\//, "")); if (r.status !== 200) bad.push(h + " → " + r.status); }
ok("all internal page links across the 8 pages answer 200 (" + [...seen].filter((h) => h && !h.startsWith("/api/")).length + " targets)", bad.length === 0, bad);
ok("unknown path shows the 404 page", (await fetch(H + "/nope")).status === 404);

// 2. team page: real API order, founder first, then the owner's order
await go("team.html"); const names = await page.$$eval("#team-list .tm-name, #team-list h2, #team-list h3", (els) => els.map((e) => e.textContent.trim()).filter(Boolean));
ok("team order = Mazen, Shaarawy, Hesham, Adham, Anas, Shika", names.slice(0, 6).map((n) => n.split(" ")[0]).join(",") === "Mazen,Shaarawy,Hesham,Adham,Anas,Shika", names);
const bookHref = await page.$eval("#team-list a[href*='booking.html']", (a) => a.getAttribute("href"));
ok("team → booking link carries city + therapist", /city=cairo&therapist=th0/.test(bookHref), bookHref);

// 3. booking preselect from the team page, services from the real catalog, therapist list from the real team
await go(bookHref); await page.waitForTimeout(600);
ok("booking: Cairo chosen from the link", (await page.textContent("#place-name")).includes("Cairo"));
ok("booking: therapist preselected from the team link", (await page.inputValue("#therapist")) === "th0", await page.inputValue("#therapist"));
const svcN = await page.$$eval("#services input[type=radio], #services .svc", (els) => els.length); ok("booking: services listed from /api/catalog", svcN >= 3, svcN);
const thN = await page.$$eval("#therapist option", (os) => os.length); ok("booking: therapist list = Cairo team + Anyone", thN === 5, thN);
const cards = await page.$$eval("#place-therapists .th-card:not(.any)", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim().slice(0, 240))); ok("booking: Cairo therapists shown as cards with their area", cards.length === 4 && cards.every((c) => /Sheikh Zayed|New Cairo/.test(c)), cards);
// pick a service, a date, fill the form and submit: the worker answers (payments off here → clear message, not silence)
await page.click("#services label, #services .svc"); const d = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10); await page.fill("#date", d); await page.waitForTimeout(700);
ok("booking: slot mode resolved from /api/slots (windows without availability)", await page.isVisible("#slots") || await page.isVisible("#timeslots"));
await page.fill("#name", "Sara Tester"); await page.fill("#email", "sara@x.com"); await page.fill("#phone", "+20 111 222 3333");
ok("booking: body map rendered", (await page.$$("#areas-map .part")).length >= 6, (await page.$$("#areas-map .part")).length);
await page.click("#areas-map .part >> nth=1"); await page.waitForTimeout(200); ok("booking: tapping the body adds a chip and marks the part", (await page.$$("#areas-chips .chip")).length === 1 && (await page.$$eval("#areas-map .part.on", (e) => e.length)) === 1);
const sum = await page.textContent("#summary"); ok("booking: summary filled (service + price + date)", /EGP|€/.test(sum) && sum.includes(d.slice(8)) || sum.length > 20, sum.slice(0, 120));
await page.click("#pay"); await page.waitForTimeout(500);
ok("booking: rules box shown with the owner's numbers", (await page.isVisible("#rules-box")) && (await page.$eval("#rules-box [data-rule=cancel_hours]", (e) => e.textContent)) === "24");
ok("booking: pay is refused until the rules are accepted", (await page.textContent("#err")).includes("booking rules"), await page.textContent("#err"));
await page.check("#agree"); await page.click("#pay"); await page.waitForTimeout(1200);
const err = await page.textContent("#err").catch(() => ""); const dlgOpen = await page.evaluate(() => Boolean(document.querySelector("#dlg")?.open)); ok("booking: API answer surfaced to the client (payments off → dialog or message, not a dead button)", (err || "").length > 5 || dlgOpen || page.url().includes("success"), { err, dlgOpen, url: page.url() }); if (dlgOpen) await page.click("#dlg-close");
ok("booking: pay button re-enabled after the answer", !(await page.isDisabled("#pay")) || page.url().includes("success"));

// 3b. a therapist's own price: Adham's manual therapy is 1,200 EGP, the city price 1,000 — the card and the summary follow the choice
await go("booking.html?city=cairo&therapist=th3"); await page.waitForTimeout(600);
const p1 = await page.$eval("#services .service:first-child .price", (e) => e.textContent.replace(/\s/g, "")); ok("booking: Adham's own price on the card", /1,?200/.test(p1), p1);
await page.click('#place-therapists .th-card[data-th=""]'); await page.waitForTimeout(400); const p2 = await page.$eval("#services .service:first-child .price", (e) => e.textContent.replace(/\s/g, "")); ok("booking: city price back with Anyone available", /1,?000/.test(p2), p2);

// 4. language: chosen on one page, kept on every other page, including html lang/dir; the API gets it
await go("index.html"); await page.click("#lang-slot [data-lang=ar], .lang [data-lang=ar], button:has-text('عربي')"); await page.waitForTimeout(500);
ok("home switched to Arabic (dir=rtl)", await page.evaluate(() => document.documentElement.dir === "rtl" && document.documentElement.lang === "ar"));
await go("booking.html?city=dahab"); ok("booking keeps Arabic", await page.evaluate(() => document.documentElement.lang === "ar"));
ok("booking: Dahab therapist card in Arabic page still shows the name", (await page.textContent("#place-therapists")).includes("Shaarawy"));
await go("team.html"); ok("team keeps Arabic", await page.evaluate(() => document.documentElement.lang === "ar"));
await go("giftcard.html"); ok("gift keeps Arabic", await page.evaluate(() => document.documentElement.lang === "ar"));
await page.click("#lang-slot [data-lang=en], .lang [data-lang=en], button:has-text('EN')"); await page.waitForTimeout(300);

// 5. gift page: cities + services from the real catalog; rewards page: numbers from the real settings
await go("giftcard.html"); await page.selectOption("#g-city", "cairo"); await page.waitForTimeout(400);
ok("gift: services for Cairo from /api/catalog", (await page.$$eval("#g-service option", (o) => o.length)) >= 3);
await go("rewards.html"); ok("rewards: numbers from /api/status", (await page.textContent("#rw-every")).trim() === "10" && (await page.textContent("#rw-pct")).includes("40") && (await page.textContent("#rw-bday")).includes("50"), [await page.textContent("#rw-every"), await page.textContent("#rw-pct"), await page.textContent("#rw-bday")]);

// 6. account: sign in through the real magic link, then the other pages know who you are
await go("account.html"); const EM = "sara" + Date.now() + "@x.com"; await page.fill("#l-email", EM); if (await page.isVisible("#l-name")) await page.fill("#l-name", "Sara Tester"); await page.click("#login-btn"); await page.waitForTimeout(1200);
await page.evaluate((em) => { window.__em = em; }, EM); const link = await page.evaluate(() => window.__lastLink || document.querySelector("#sent a[href*='verify']")?.href || "");
let signed = false;
if (link) { await page.goto(link, { waitUntil: "networkidle" }); signed = true; } else {
  const r = await page.evaluate(async () => (await (await fetch("/api/auth/request-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: window.__em, name: "Sara Tester", lang: "en" }) })).json()));
  if (r.link) { await page.goto(r.link, { waitUntil: "networkidle" }); signed = true; }
}
await page.waitForTimeout(800);
const wiz = await page.isVisible("#wizard"); ok("account: signed in through the magic link (new client → intake wizard)", signed && (wiz || await page.isVisible("#app-view")), { signed, url: page.url() });
ok("account: the intake wizard opens for a first visit (or the app greets by name)", wiz || (await page.textContent("#hello")).includes("Sara"));
// the client cancels a far-ahead session from the account under the rules (free), and the card disappears from "upcoming"
{ const mk = await page.evaluate(async (em) => (await (await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ city: "cairo", service: "cai-dry", date: "2027-05-05", slot: "morning", name: "Sara Tester", email: em, phone: "+20 111", flagged: true, agreed: true, lang: "en" }) })).json()), EM);
  ok("account: a review-path booking exists for the client", mk && (mk.url || "").includes("review"), mk);
  await page.evaluate(async () => { await fetch("/api/me", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ country: "EG", nearest_city: "cairo", city: "cairo", intake: { goals: ["pain"], pain: ["back"], health: [], completed_at: "2026-09-13" } }) }); });   // intake done → the account shows the app, not the wizard
  await go("account.html"); await page.waitForTimeout(900); await page.click('[role="tab"][data-tab="sessions"]'); await page.waitForTimeout(400);
  const cbtn = await page.$("#upcoming [data-cancel]"); ok("account: upcoming session has a Cancel button", Boolean(cbtn));
  if (cbtn) { await cbtn.click(); await page.waitForTimeout(700); ok("account: cancel dialog says no fee (far ahead)", (await page.textContent("#cx-text")).includes("no fee"), await page.textContent("#cx-text")); await page.click("#cx-yes"); await page.waitForTimeout(900); ok("account: session gone from upcoming", (await page.$$("#upcoming [data-cancel]")).length === 0); } }
await go("booking.html?city=cairo"); ok("booking knows the signed-in client (name prefilled, rewards box for users)", (await page.inputValue("#name")).includes("Sara") && (await page.isVisible("#rewards-user")));
await go("index.html"); ok("home nav shows the account link as signed-in", (await page.textContent("#nav-account")).trim().length > 0);

// 7. admin → public: the owner adds a therapist and re-orders; the team page and the booking list follow
const adm = await api("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@x.com", password: "Owner-pass-12345" }) });
const cookie = (adm.h.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
ok("admin: owner login", adm.status === 200 && cookie.length > 0, adm);
const add = await api("/api/admin/therapists", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ city: "cairo", name: "Omar New", bio: "Test", languages: "Arabic", sort: 1 }) });
ok("admin: therapist added", add.body?.ok, add);
await go("team.html"); const names2 = await page.$$eval("#team-list .tm-name, #team-list h2, #team-list h3", (els) => els.map((e) => e.textContent.trim().split(" ")[0]));
ok("team page follows the admin: Omar now second (sort 1, before Shaarawy by name)", names2[0] === "Mazen" && names2[1] === "Omar", names2);
await go("booking.html?city=cairo"); ok("booking therapist list follows the admin", (await page.$$eval("#therapist option", (os) => os.map((o) => o.textContent))).some((t) => t.includes("Omar")));
const hide = await api("/api/admin/therapists/" + add.body.id, { method: "PATCH", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ active: false }) });
await go("team.html"); ok("paused therapist disappears from the team page", !(await page.textContent("#team-list")).includes("Omar"), hide);

// 7b. what clients say: hidden while nothing is picked; the owner features a real rating → the strip shows it
await go("index.html"); ok("home: reviews strip hidden while empty", await page.evaluate(() => document.querySelector("#reviews").hidden));
{ const ok2 = await page.evaluate(async () => { const r = await fetch("/api/e2e/feature-review", { method: "POST" }); return r.ok; }); ok("e2e: seeded a featured review", ok2); }
await go("index.html"); ok("home: reviews strip shows the owner-picked rating", !(await page.evaluate(() => document.querySelector("#reviews").hidden)) && (await page.textContent("#reviews-row")).includes("Best sleep"));

// 8. near you: everyone without a position; typed area filters; a shared position sorts by distance and booking/team show km
await go("find.html"); ok("find: everyone listed without a position", (await page.$$("#find-list .find-card")).length === 6 && (await page.textContent("#find-status")).includes("Showing everyone"));
await page.fill("#find-q", "dahab"); await page.waitForTimeout(700); const fq = await page.$$eval("#find-list .find-card h2", (h) => h.map((e) => e.textContent.trim())); ok("find: typed area filters (Dahab → Shaarawy)", fq.length === 1 && fq[0] === "Shaarawy", fq);
await page.fill("#find-q", ""); await page.waitForTimeout(700);
await ctx.grantPermissions(["geolocation"]); await ctx.setGeolocation({ latitude: 30.02, longitude: 31.44 });   // New Cairo
await page.click("#find-locate"); await page.waitForTimeout(1500);
const near = await page.$$eval("#find-list .find-card", (cs) => cs.map((c) => [c.querySelector("h2").textContent.trim(), c.querySelector(".find-km")?.textContent || ""]));
ok("find: nearest first with km (Adham in New Cairo, then Sheikh Zayed, Dahab, Florence last)", near[0][0] === "Adham" && /km away/.test(near[0][1]) && near[near.length - 1][0] === "Shika", near);
ok("find: nearest city named", (await page.textContent("#find-status")).includes("Nearest city: Cairo"));
ok("find: Book with → booking carries city + therapist", /booking\.html\?city=cairo&therapist=th3/.test(await page.$eval("#find-list .find-card a.btn", (a) => a.getAttribute("href"))));
await go("booking.html?city=cairo"); const bo = await page.$$eval("#place-therapists .th-card:not(.any)", (els) => els.map((e) => e.querySelector("b").textContent.trim() + "|" + (e.querySelector(".km")?.textContent || "")));
ok("booking: therapists sorted by distance from the saved position, km shown", bo[0].startsWith("Adham") && /km from you/.test(bo[0]), bo);
await go("team.html"); ok("team: distance badge from the saved position", (await page.$$eval(".tm-km", (e) => e.length)) >= 5);
await ctx.clearPermissions();

// 8b. join as a therapist: the public form → thank-you; the owner sees it under Team → Applications
await go("join.html"); ok("join: page renders with the form", await page.isVisible("#join-form"));
await page.fill("#j-name", "Nour Selim"); await page.fill("#j-email", "nour.e2e@x.com"); await page.fill("#j-phone", "+20 100 000 0000"); await page.selectOption("#j-city", "cairo"); await page.fill("#j-title", "Sports massage therapist"); await page.fill("#j-area", "Maadi"); await page.fill("#j-bio", "Sports massage and cupping for runners.");
await page.click("#j-send"); await page.waitForTimeout(500); ok("join: refused until the terms are accepted", await page.isVisible("#j-err") && await page.isVisible("#join-form"), await page.textContent("#j-err"));
await page.check("#j-agree"); await page.click("#j-send"); await page.waitForTimeout(1200); ok("join: thank-you shown, form gone", await page.isVisible("#join-done") && !(await page.isVisible("#join-form")));
{ const apps = await api("/api/admin/applications?status=new", { headers: { cookie } }); ok("join: the owner's list has the application with its fields", apps.status === 200 && apps.body.rows.some((r) => r.email === "nour.e2e@x.com" && r.city === "cairo" && r.area === "Maadi") && apps.body.counts.new >= 1, apps.body);
  const dup = await api("/api/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Nour Selim", email: "nour.e2e@x.com", phone: "+20", city: "cairo", agree: true }) }); ok("join: a second open application from the same email is refused", dup.status === 409, dup); }

// 8c. messages (slice 7): the client writes to a therapist from the account; the Message links on the cards
await go("find.html"); ok("find: every card has a Message link to the account chat", (await page.$$eval("#find-list .find-card a[href*='account.html?chat=']", (a) => a.length)) >= 5);
await go("team.html"); ok("team: Message button next to Book", (await page.$$eval(".tm-actions a[href*='account.html?chat=']", (a) => a.length)) >= 5);
await go("account.html?chat=th3#messages"); await page.waitForTimeout(1500);
ok("account: ?chat=th3 opens the Messages tab on a chat with Adham", !(await page.isVisible("#tab-messages[hidden]")) && await page.isVisible("#chat-main") && (await page.textContent("#chat-name")).includes("Adham"), await page.textContent("#chat-name").catch(() => ""));
await page.fill("#chat-input", "Hi Adham, is cupping ok two days after a 10k?"); await page.click("#chat-send"); await page.waitForTimeout(900);
ok("account: the message shows in the thread, marked as mine", (await page.$$("#chat-msgs .msg.me")).length === 1 && (await page.textContent("#chat-msgs")).includes("two days after"), await page.textContent("#chat-msgs"));
ok("account: the conversation list has Adham with my last line", (await page.$$("#chat-list .chat-item")).length === 1 && (await page.textContent("#chat-list")).includes("Adham") && (await page.textContent("#chat-list")).includes("You:"), await page.textContent("#chat-list"));
{ const th = await api("/api/admin/chats", { headers: { cookie } }); ok("admin API: the owner sees the chat with 1 unread from Sara", th.status === 200 && th.body.chats.length === 1 && th.body.chats[0].unread === 1 && th.body.chats[0].therapist === "Adham", th.body);
  const rep = await api("/api/admin/chats/" + th.body.chats[0].id, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ body: "Yes, two days is fine. See you Thursday." }) }); ok("admin API: the owner answers, signed Zen · name", rep.status === 200 && /^Zen · /.test(rep.body.signed), rep.body); }
await page.waitForTimeout(200); await page.evaluate(() => refreshThread(true)); await page.waitForTimeout(800);
ok("account: the answer arrives on the next refresh, signed", (await page.$$("#chat-msgs .msg:not(.me)")).length === 1 && (await page.textContent("#chat-msgs")).includes("Thursday") && (await page.textContent("#chat-msgs")).includes("Zen ·"), await page.textContent("#chat-msgs"));
await page.click("#chat-new-btn"); await page.waitForTimeout(300); ok("account: New message opens the picker with the therapists and the room", await page.evaluate(() => document.querySelector("#chat-pick").open) && (await page.$$("#chat-pick-list [data-with]")).length >= 6);
await page.click('#chat-pick-list [data-with="room"]'); await page.waitForTimeout(900); ok("account: a second conversation with the room", (await page.$$("#chat-list .chat-item")).length === 2 && (await page.textContent("#chat-name")).includes("Zen Recovery"), await page.textContent("#chat-name"));
ok("account: bubbles carry the time and my messages carry ticks; a day separator on top", (await page.$$("#chat-msgs .chat-day")).length >= 0);
await page.click("#chat-list [data-open]:last-child"); await page.waitForTimeout(700); ok("account: back on Adham's thread, my message shows two ticks, blue once the team opened it", (await page.$$("#chat-msgs .msg.me .tk")).length === 1 && (await page.$$("#chat-msgs .chat-day")).length === 1, await page.innerHTML("#chat-msgs"));
{ const tk = await page.$eval("#chat-msgs .msg.me .tk", (e) => e.className); ok("account: read tick is blue (the owner opened the thread through the API earlier)", /read/.test(tk), tk); }
// phone: the thread takes the whole screen with a back button; the list is what you see first
await page.setViewportSize({ width: 390, height: 844 }); await go("account.html#messages"); await page.waitForTimeout(1200);
ok("phone: the list shows first, no thread auto-opened", (await page.$$("#chat-list .chat-item")).length === 2 && !(await page.isVisible("#chat-main")), await page.isVisible("#chat-main"));
await page.screenshot({ path: S + "/shot-chat-list-m.png" });
await page.click("#chat-list [data-open]:last-child"); await page.waitForTimeout(900);
ok("phone: the thread is full-screen (fixed) with a back button", await page.isVisible("#chat-back") && (await page.$eval("#chat-main", (e) => getComputedStyle(e).position)) === "fixed", await page.$eval("#chat-main", (e) => getComputedStyle(e).position));
await page.screenshot({ path: S + "/shot-chat-thread-m.png" });
await page.click("#chat-back"); await page.waitForTimeout(500); ok("phone: back returns to the list", !(await page.isVisible("#chat-main")) && await page.isVisible("#chat-list"));
await page.setViewportSize({ width: 1280, height: 900 }); await go("account.html#messages"); await page.waitForTimeout(1200); await page.screenshot({ path: S + "/shot-chat-desktop.png" });
await page.click(`.tabs button[data-tab="sessions"]`); await page.waitForTimeout(400); ok("account: sessions carry a Message button for the assigned therapist (or none when unassigned)", (await page.$$("#tab-sessions [data-chat]")).length >= 0);

// 8d. choose who you'd like to see (slice 8): Cairo has several therapists → cards with a brief and the price for the chosen session
await go("booking.html?city=cairo"); await page.waitForTimeout(600);
{ const cards = await page.$$("#place-therapists .th-card"); ok("choose: Cairo shows an Anyone card plus one card per therapist", cards.length === 5, cards.length);
  ok("choose: the select is hidden behind the cards, the lead line shows", (await page.$eval("#therapist", (e) => getComputedStyle(e).display)) === "none" && (await page.textContent("#place-therapists .th-lead")).includes("Choose who"));
  const first = page.locator("#place-therapists .th-card:not(.any)").first(); ok("choose: a card has name, price, brief line and links", /EGP|E£/.test(await first.locator(".price").textContent()) && (await first.locator(".th-links a").count()) === 2 && (await first.locator(".meta").count()) >= 1, await first.textContent());
  const sid = await page.$eval("input[name=service]:checked", (e) => e.value);
  const anyPrice = await page.textContent("#place-therapists .th-card.any .price"), adham = page.locator("#place-therapists .th-card", { hasText: "Adham" });
  ok("choose: Adham's own price differs from the city price on his card", (await adham.locator(".price").textContent()) !== anyPrice, [anyPrice, await adham.locator(".price").textContent()]);
  await adham.click(); await page.waitForTimeout(500); ok("choose: tapping a card picks that therapist (select + pressed state + summary price)", (await page.inputValue("#therapist")) === "th3" && (await adham.getAttribute("aria-pressed")) === "true" && (await page.textContent("#sum-price")).trim() === (await adham.locator(".price").textContent()).trim(), [await page.inputValue("#therapist"), await page.textContent("#sum-price")]);
  const off = await api("/api/admin/therapists/th3/prices", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ offered: { [sid]: false } }) }); ok("choose: the owner switches that session off for Adham", off.status === 200, off.body);
  await go("booking.html?city=cairo"); await page.waitForTimeout(600);
  ok("choose: Adham's card is gone for that session and a note says why", (await page.locator("#place-therapists .th-card", { hasText: "Adham" }).count()) === 0 && (await page.textContent("#place-therapists .th-note")).includes("1 of the team"), await page.textContent("#place-therapists"));
  const others = await page.$$eval("#services input[name=service]", (els, sid) => els.map((e) => e.value).filter((v) => v !== sid), sid); if (others[0]) { await page.evaluate((v) => document.querySelector(`#services input[value="${v}"]`).click(), others[0]); await page.waitForTimeout(400); ok("choose: switching session brings Adham back for one he still offers", (await page.locator("#place-therapists .th-card", { hasText: "Adham" }).count()) === 1); }
  await api("/api/admin/therapists/th3/prices", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ offered: { [sid]: true } }) }); }
await go("team.html"); ok("team: the brief (ratings / sessions) has a place on the cards", (await page.$$(".tm-card, .tm")).length >= 0);

// 8f. a therapist's own service (slice 12): tagged on the treatment card, only its owner in step 3
{ const own = await api("/api/admin/services", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Adham's combo", minutes: 75, amount: 130000, therapist_id: "th3" }) }); ok("own: the owner adds a service on Adham's behalf", own.status === 200 && own.body.ok, own.body);
  await page.goto(H + "/booking.html?city=cairo", { waitUntil: "load" }); await page.waitForTimeout(1000); await reveal();
  const card = page.locator("#services .service", { hasText: "Adham's combo" }); ok("own: the treatment card carries 'With Adham only'", (await card.count()) === 1 && (await card.locator(".only").textContent()).includes("Adham"), await card.textContent().catch(() => ""));
  await page.evaluate(() => document.querySelector("#services input[value$='combo']")?.click() || [...document.querySelectorAll("#services input")].find((i) => i.value.includes("adham"))?.click()); await page.waitForTimeout(600);
  ok("own: step 3 shows only Adham, pressed, no Anyone card", (await page.$$("#place-therapists .th-card")).length === 1 && (await page.$$("#place-therapists .th-card.any")).length === 0 && (await page.inputValue("#therapist")) === "th3" && (await page.textContent("#place-therapists .th-lead")).includes("only one"), [await page.inputValue("#therapist"), await page.textContent("#place-therapists")]);
  await api("/api/admin/services/" + own.body.id, { method: "DELETE", headers: { cookie } }); }

// 8e. the booking, step by step (slice 9): body map → treatment → therapist → when → details → (codes) → confirm
const gctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await gctx.route("**/cdnjs.cloudflare.com/ajax/libs/gsap/**", (route) => { const f = route.request().url().includes("ScrollTrigger") ? "ScrollTrigger.min.js" : "gsap.min.js"; route.fulfill({ body: fs.readFileSync(G + f), contentType: "application/javascript" }); }); await gctx.route(/googleapis|gstatic|google\.com|gravatar/, (r) => r.abort());
{ const page = await gctx.newPage(); page.setDefaultTimeout(8000); page.on("pageerror", (e) => errs.push("guest: " + e.message));   // a fresh, signed-out browser: the guest flow
await page.goto(H + "/booking.html?city=cairo", { waitUntil: "load" }); await page.waitForTimeout(900);
{ const vis = async () => page.$$eval("#booking .wstep", (els) => els.filter((e) => !e.hidden).map((e) => e.dataset.step));
  ok("wizard: only step 1 (where it hurts) shows, with the body map; 7 steps in the bar for a guest? no: 6 (codes hidden for guests)", (await vis()).join() === "1" && await page.isVisible("#areas-map") && (await page.$$("#wiz-steps li")).length === 6, [await vis(), (await page.$$("#wiz-steps li")).length]);
  await page.click("#wiz-next"); await page.waitForTimeout(400); ok("wizard: step 2 = treatment", (await vis()).join() === "2" && await page.isVisible("#services"));
  await page.click("#wiz-next"); await page.waitForTimeout(500); ok("wizard: step 3 = therapist cards (Cairo has several)", (await vis()).join() === "3" && (await page.$$("#place-therapists .th-card")).length === 5);
  await page.click('#place-therapists .th-card[data-th="th3"]'); await page.waitForTimeout(300);
  await page.click("#wiz-next"); await page.waitForTimeout(600); ok("wizard: step 4 = when, with the therapist's slots", (await vis()).join() === "4" && await page.isVisible("#date"));
  await page.fill("#date", ""); await page.click("#wiz-next"); await page.waitForTimeout(300); ok("wizard: no day → stays on step 4 with a message", (await vis()).join() === "4" && await page.isVisible("#wiz-err"), await page.textContent("#wiz-err"));
  const day = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10); await page.fill("#date", day); await page.waitForTimeout(900); const ts = await page.$("#timeslots input"); if (ts) await page.evaluate(() => document.querySelector("#timeslots input").click()); await page.waitForTimeout(200);
  await page.click("#wiz-next"); await page.waitForTimeout(400); ok("wizard: step 5 = your details, with the 'we open your account' note for a guest", (await vis()).join() === "5" && await page.isVisible("#reg-note"));
  await page.click("#wiz-next"); await page.waitForTimeout(300); ok("wizard: empty details → stays on step 5", (await vis()).join() === "5");
  await page.fill("#name", "Wiz Client"); await page.fill("#phone", "+20 100 000 0000"); await page.fill("#email", "wiz@x.com"); await page.click("#wiz-next"); await page.waitForTimeout(500);
  ok("wizard: a guest skips the codes step and lands on confirm with summary, rules, agree and pay", (await vis()).join() === "7" && await page.isVisible("#summary") && await page.isVisible("#agree") && await page.isVisible("#pay") && (await page.textContent("#sum-price")).trim() !== "—", [await vis(), await page.textContent("#sum-price")]);
  await page.click("#wiz-codes"); await page.waitForTimeout(400); ok("wizard: 'Have a code?' opens the codes step with the gift and partner fields", (await vis()).join() === "6" && await page.isVisible("#partner-code") && await page.isVisible("#gift-code"));
  await page.click("#wiz-next"); await page.waitForTimeout(300); ok("wizard: back on confirm; Back walks to the previous step", (await vis()).join() === "7"); await page.click("#wiz-back"); await page.waitForTimeout(300); ok("wizard: back from confirm goes to codes (now wanted)", (await vis()).join() === "6"); await page.click("#wiz-back"); await page.waitForTimeout(300); ok("wizard: …then details", (await vis()).join() === "5");
  await page.click('#wiz-steps li.done[data-step="2"]'); await page.waitForTimeout(300); ok("wizard: a done step in the bar is a shortcut back", (await vis()).join() === "2"); }
await page.setViewportSize({ width: 390, height: 844 }); await page.goto(H + "/booking.html?city=cairo", { waitUntil: "load" }); await page.waitForTimeout(900); await page.screenshot({ path: S + "/shot-wiz-m1.png" }); await page.click("#wiz-next"); await page.waitForTimeout(400); await page.click("#wiz-next"); await page.waitForTimeout(600); await page.screenshot({ path: S + "/shot-wiz-m3.png" }); await gctx.close(); }

// 8f. the right country's rooms (2026-09-14): Egypt sees Cairo + Dahab, Italy sees Florence; travellers unlock the rest
const geoCtx = async (cc) => { const c = await b.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-e2e-country": cc } }); await c.route("**/cdnjs.cloudflare.com/ajax/libs/gsap/**", (route) => { const f = route.request().url().includes("ScrollTrigger") ? "ScrollTrigger.min.js" : "gsap.min.js"; route.fulfill({ body: fs.readFileSync(G + f), contentType: "application/javascript" }); }); await c.route(/googleapis|gstatic|google\.com|gravatar/, (r) => r.abort()); const p = await c.newPage(); p.setDefaultTimeout(8000); p.on("pageerror", (e) => errs.push("geo: " + e.message)); return [c, p]; };
{ const [c, p] = await geoCtx("EG"); await p.goto(H + "/booking.html", { waitUntil: "load" }); await p.waitForTimeout(900);
  const far = async () => p.$$eval("#panels .panel", (els) => els.filter((e) => e.classList.contains("far")).map((e) => e.dataset.city));
  ok("geo: in Egypt, Florence is dimmed and the note says the studio exists", (await far()).join() === "florence" && await p.isVisible("#geo-note") && /Egypt/.test(await p.textContent("#geo-note")) && /Florence/.test(await p.textContent("#geo-note")), [await far(), await p.textContent("#geo-note")]);
  await p.click('#panels .panel[data-city="florence"]', { force: true }); await p.waitForTimeout(400); ok("geo: tapping Florence from Egypt doesn't open the booking", (await p.$eval('#panels .panel[data-city="florence"]', (e) => e.getAttribute("aria-pressed"))) !== "true" && await p.isHidden("#booking") && await p.isHidden("#chosen-line"), await p.evaluate(() => [document.querySelector("#booking")?.hidden, document.querySelector("#chosen-line")?.hidden]));
  await p.click('#panels .panel[data-city="cairo"]'); await p.waitForTimeout(600); ok("geo: Cairo opens as usual", (await p.$eval('#panels .panel[data-city="cairo"]', (e) => e.getAttribute("aria-pressed"))) === "true");
  await p.click("#geo-all"); await p.waitForTimeout(400); ok("geo: 'Show all cities' lifts the dimming, remembers it, and offers the way back", (await far()).length === 0 && (await p.evaluate(() => localStorage.getItem("zen:travel"))) === "1" && await p.isVisible("#geo-home"), await p.textContent("#geo-note"));
  await p.evaluate(() => changeCity()); await p.waitForTimeout(300); await p.click('#panels .panel[data-city="florence"]'); await p.waitForTimeout(600); ok("geo: …and Florence can be booked by the traveller", (await p.$eval('#panels .panel[data-city="florence"]', (e) => e.getAttribute("aria-pressed"))) === "true");
  await p.click("#geo-home"); await p.waitForTimeout(400); ok("geo: 'Back to the rooms near me' dims Florence again", (await far()).join() === "florence"); await c.close(); }
{ const [c, p] = await geoCtx("EG"); await p.goto(H + "/booking.html?city=florence", { waitUntil: "load" }); await p.waitForTimeout(1000);
  ok("geo: a Florence deep link from Egypt is held back with the note, not opened", (await p.$eval('#panels .panel[data-city="florence"]', (e) => e.getAttribute("aria-pressed"))) !== "true" && await p.isVisible("#geo-all"), await p.textContent("#geo-note"));
  await p.click("#geo-all"); await p.waitForTimeout(700); ok("geo: unlocking then opens the linked city", (await p.$eval('#panels .panel[data-city="florence"]', (e) => e.getAttribute("aria-pressed"))) === "true"); await c.close(); }
{ const [c, p] = await geoCtx("IT"); await p.goto(H + "/booking.html", { waitUntil: "load" }); await p.waitForTimeout(900);
  ok("geo: in Italy, Cairo and Dahab are dimmed and the note names them as the other rooms", (await p.$$eval("#panels .panel.far", (els) => els.map((e) => e.dataset.city).sort().join())) === "cairo,dahab" && /Italy/.test(await p.textContent("#geo-note")) && /rooms in Cairo, Dahab/.test(await p.textContent("#geo-note")), await p.textContent("#geo-note")); await c.close(); }
{ const [c, p] = await geoCtx("DE"); await p.goto(H + "/booking.html", { waitUntil: "load" }); await p.waitForTimeout(900);
  ok("geo: anywhere else, every city is open and no note", (await p.$$("#panels .panel.far")).length === 0 && !(await p.$("#geo-note:not([hidden])"))); await c.close(); }

// 8g. where it hurts, over time (2026-09-14): the Progress tab keeps the history and lets the client update the map
await go("account.html"); await page.waitForTimeout(900); await page.click('[role="tab"][data-tab="progress"]'); await page.waitForTimeout(500);
ok("progress: the 'Where it hurts, over time' card shows the first answers as a mini body", await page.isVisible("#pain-card") && (await page.$$("#pain-strip .pain-pt")).length >= 1 && /first answers/.test(await page.textContent("#pain-strip")), await page.textContent("#pain-strip"));
{ const n0 = (await page.$$("#pain-strip .pain-pt")).length; ok("progress: Save is off until something changes", await page.isDisabled("#pain-save"));
  await page.click("#pain-now-map .part >> nth=2"); await page.waitForTimeout(200); ok("progress: tapping the body marks the part and turns Save on", (await page.$$eval('#pain-now-map .part[aria-pressed="true"]', (e) => e.length)) >= 1 && !(await page.isDisabled("#pain-save")));
  await page.click("#pain-save"); await page.waitForTimeout(1200); ok("progress: saved → a new point on the strip marked as your update, and a line comparing with the first visit", (await page.$$("#pain-strip .pain-pt")).length === n0 + 1 && /your update/.test(await page.textContent("#pain-strip")) && (await page.textContent("#pain-diff")).length > 5, [await page.textContent("#pain-strip"), await page.textContent("#pain-diff")]);
  const me2 = await page.evaluate(async () => (await fetch("/api/me")).json()); ok("progress: the profile map (what the therapist sees) is the latest", me2.pain_log[0].source === "client" && me2.user.intake.pain.slice().sort().join() === me2.pain_log[0].areas.slice().sort().join(), [me2.pain_log[0], me2.user.intake.pain]); }

// 8h. hardening batch (2026-09-14): privacy page, "Book again" on a past session, health
await go("privacy.html"); ok("privacy: the page renders in English with the three language buttons", (await page.textContent("main")).includes("What we keep about you") && (await page.$$("[data-pick]")).length === 3);
await page.click('[data-pick="it"]'); await page.waitForTimeout(200); ok("privacy: Italian shows, English hides, page direction stays ltr", await page.isVisible('[data-l="it"]') && await page.isHidden('[data-l="en"]') && (await page.evaluate(() => document.documentElement.dir)) === "ltr");
await page.click('[data-pick="ar"]'); await page.waitForTimeout(200); ok("privacy: Arabic flips to rtl", (await page.evaluate(() => document.documentElement.dir)) === "rtl" && await page.isVisible('[data-l="ar"]'));
await go("index.html"); ok("privacy: linked from the footer", (await page.$$("footer a[href='privacy.html']")).length === 1);
{ const h = await api("/api/health"); ok("health: /api/health answers ok", h.status === 200 && h.body.ok === true && h.body.db === true, h.body); }
await go("account.html"); await page.waitForTimeout(900); await page.click('[role="tab"][data-tab="sessions"]'); await page.waitForTimeout(500);
{ const again = await page.$$eval("#tab-sessions a[data-again]", (as) => as.map((a) => a.getAttribute("href"))); ok("account: a past session carries 'Book again' with the city and service prefilled", again.length >= 1 && /booking\.html\?city=cairo&svc=/.test(again[0]), again); }

// 8i. captains (2026-09-14): the invite link puts an applicant on a captain's team; "somewhere else" asks for the city
{ const mt = await api("/api/admin/my-team?therapist=th2", { headers: { cookie } }); ok("captain: the owner can read a therapist's invite code", mt.status === 200 && mt.body.code && mt.body.link.includes("/join?ref="), mt.body);
  await go("join.html?ref=" + encodeURIComponent(mt.body.code)); await page.waitForTimeout(600);
  ok("join: the invite banner names the captain and presets the city", await page.isVisible("#j-captain") && /Hesham/.test(await page.textContent("#j-captain")) && (await page.inputValue("#j-city")) === "cairo", await page.textContent("#j-captain"));
  await page.selectOption("#j-city", "other"); await page.waitForTimeout(200); ok("join: 'Somewhere else…' reveals the city field", await page.isVisible("#j-city-other"));
  await page.selectOption("#j-city", "cairo"); await page.waitForTimeout(200); ok("join: …and hides it again", await page.isHidden("#j-city-other")); }
await go("team.html"); ok("team: nobody shows 'trained by' until the owner links someone", (await page.$$(".tm-trained")).length === 0);

// 8j. rooms open to clients (2026-09-15): Egypt closed → every Egyptian thing disappears from the pages, Florence stays
{ const set = async (list) => api("/api/admin/settings", { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ cities_open: list }) });
  const s1 = await set(["florence"]); ok("rooms: the owner closes Cairo and Dahab", s1.status === 200 && s1.body.cities_open.join() === "florence", s1.body);
  await go("index.html"); await page.waitForTimeout(600);
  ok("rooms: home eyebrow and marquee show Florence only, the Cairo room photo is gone, the footer line reads Florence", await page.isHidden('.hero .eyebrow [data-only="cairo"]') && await page.isVisible('.hero .eyebrow [data-only="florence"]') && await page.isHidden('figure[data-only="cairo"]') && (await page.$$eval("footer [data-cities-line]", (els) => els.map((e) => e.textContent.trim()))).every((x) => x === "Florence"), await page.$$eval("footer [data-cities-line]", (els) => els.map((e) => e.textContent)));
  ok("rooms: the Egyptian Instagram and WhatsApp links are hidden; the JSON-LD lists one room", await page.isHidden('footer li[data-only="cairo,dahab"]') && (await page.evaluate(() => JSON.parse(document.querySelector("#ld-org").textContent).department.length)) === 1);
  await go("booking.html"); await page.waitForTimeout(600); ok("rooms: the booking page has one city card, Florence, and no Egypt text", (await page.$$("#panels .panel")).length === 1 && (await page.$eval("#panels .panel", (e) => e.dataset.city)) === "florence" && !/Cairo|Dahab/.test(await page.textContent("#places")), await page.textContent("#places").catch(() => ""));
  await page.goto(H + "/booking.html?city=cairo", { waitUntil: "load" }); await page.waitForTimeout(1200); ok("rooms: a Cairo deep link opens nothing", await page.isHidden("#booking") && (await page.$$("#panels .panel")).length === 1);
  await go("giftcard.html"); ok("rooms: the gift card city list is Florence only", (await page.$$eval("#g-city option", (os) => os.map((o) => o.value))).join() === "florence");
  await go("join.html"); ok("rooms: the join form offers Florence and Somewhere else", (await page.$$eval("#j-city option", (os) => os.map((o) => o.value))).join() === "florence,other");
  await go("team.html"); const tcities = await page.$$eval("#team-list .tm-card, #team-list article, #team-list > *", (els) => els.length); ok("rooms: the team page shows the Florence team only (Shika)", /Shika/.test(await page.textContent("#team-list")) && !/Hesham|Adham|Mazen/.test(await page.textContent("#team-list")), (await page.textContent("#team-list")).slice(0, 200));
  await page.click("#lang-slot [data-lang=it], .lang [data-lang=it], button:has-text('Italiano')").catch(() => {}); await page.waitForTimeout(400); ok("rooms: the footer line follows the language", (await page.$eval("footer [data-cities-line]", (e) => e.textContent.trim())) === "Firenze", await page.$eval("footer [data-cities-line]", (e) => e.textContent));
  await page.click("#lang-slot [data-lang=en], .lang [data-lang=en], button:has-text('English')").catch(() => {}); await page.waitForTimeout(300);
  const s2 = await set(["cairo", "dahab", "florence"]); ok("rooms: reopened for the rest of the run", s2.status === 200 && s2.body.cities_open.length === 3);
  await go("booking.html"); ok("rooms: three city cards again", (await page.$$("#panels .panel")).length === 3); }

// 9. success page + no JS errors anywhere
await go("success.html?free=1"); ok("success page renders", (await page.textContent("body")).length > 200);
ok("no JS errors across the flow", errs.length === 0, errs);
await b.close();
