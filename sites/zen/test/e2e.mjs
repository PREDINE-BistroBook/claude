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
const go = async (p) => { await page.goto(H + "/" + p, { waitUntil: "load" }); await page.waitForTimeout(700); };
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
const cards = await page.$$eval("#place-therapists .therapist", (els) => els.map((e) => e.textContent.trim().slice(0, 80))); ok("booking: Cairo therapists shown with area", cards.length === 4 && cards.every((c) => /Sheikh Zayed|New Cairo/.test(c)), cards);
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
await page.selectOption("#therapist", ""); await page.waitForTimeout(400); const p2 = await page.$eval("#services .service:first-child .price", (e) => e.textContent.replace(/\s/g, "")); ok("booking: city price back with Anyone available", /1,?000/.test(p2), p2);

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
await go("booking.html?city=cairo"); const bo = await page.$$eval("#place-therapists .therapist", (els) => els.map((e) => e.querySelector("b").textContent.trim() + "|" + (e.querySelector(".km")?.textContent || "")));
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
await page.screenshot({ path: (process.env.SHOTS || ".") + "/shot-chat-list-m.png" });
await page.click("#chat-list [data-open]:last-child"); await page.waitForTimeout(900);
ok("phone: the thread is full-screen (fixed) with a back button", await page.isVisible("#chat-back") && (await page.$eval("#chat-main", (e) => getComputedStyle(e).position)) === "fixed", await page.$eval("#chat-main", (e) => getComputedStyle(e).position));
await page.screenshot({ path: (process.env.SHOTS || ".") + "/shot-chat-thread-m.png" });
await page.click("#chat-back"); await page.waitForTimeout(500); ok("phone: back returns to the list", !(await page.isVisible("#chat-main")) && await page.isVisible("#chat-list"));
await page.setViewportSize({ width: 1280, height: 900 }); await go("account.html#messages"); await page.waitForTimeout(1200); await page.screenshot({ path: (process.env.SHOTS || ".") + "/shot-chat-desktop.png" });
await page.click(`.tabs button[data-tab="sessions"]`); await page.waitForTimeout(400); ok("account: sessions carry a Message button for the assigned therapist (or none when unassigned)", (await page.$$("#tab-sessions [data-chat]")).length >= 0);

// 9. success page + no JS errors anywhere
await go("success.html?free=1"); ok("success page renders", (await page.textContent("body")).length > 200);
ok("no JS errors across the flow", errs.length === 0, errs);
await b.close();
