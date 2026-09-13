/* Admin sweep against the REAL worker (e2e-server.mjs on 8766): every tab, every dialog, the calendar pills, hours/off, team, settings; owner then an employee. */
import { chromium } from "playwright";
const H = process.env.E2E_HOST || "http://localhost:8766";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ok = (n, c, x) => { console.log((c ? "PASS " : "FAIL ") + n, c ? "" : (typeof x === "string" ? x : JSON.stringify(x))?.slice(0, 300) ?? ""); if (!c) process.exitCode = 1; };
process.on("unhandledRejection", (e) => { console.log("CRASH " + String(e && e.message || e).slice(0, 300)); process.exit(1); });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.route(/googleapis|gstatic/, (r) => r.abort());
const page = await ctx.newPage(); page.setDefaultTimeout(8000); const errs = [], native = [];
page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/40[13]|ERR_FAILED|favicon/.test(m.text())) errs.push(m.text()); }); page.on("dialog", (d) => { native.push(d.message()); d.dismiss(); });
const tab = async (k) => { await page.click(`.tabs button[data-tab="${k}"]`); await page.waitForTimeout(600); };
const openDlg = async (id) => page.evaluate((id) => Boolean(document.querySelector(id)?.open), id);

// owner sign-in through the form (bootstrap account)
await page.goto(H + "/admin.html", { waitUntil: "load" }); await page.waitForTimeout(600);
await page.fill("#a-email", "owner@x.com"); await page.fill("#a-pass", "Owner-pass-12345"); await page.click("#login-btn"); await page.waitForTimeout(1500);
ok("owner: signed in (tabs shown)", (await page.$$(".tabs button")).length >= 6, (await page.$$(".tabs button")).length);
const tabs = await page.$$eval(".tabs button", (bs) => bs.filter((x) => !x.hidden).map((x) => x.dataset.tab)); ok("owner: tabs = overview, bookings, calendar, services, team, offers, review, clients, settings", ["overview", "bookings", "calendar", "services", "team", "settings"].every((t) => tabs.includes(t)), tabs);
for (const k of tabs) { await tab(k); ok(`tab ${k} opens`, await page.$eval(`[data-tab="${k}"]`, (x) => x.getAttribute("aria-selected") === "true" || x.classList.contains("on") || x.classList.contains("active")) || (await page.isVisible(`#tab-${k}, #${k}`)).valueOf(), k); }

// calendar: city pills, therapist pills (the report: "won't let me click the names"), month navigation, day view, block dialogs
await tab("calendar");
const cities = await page.$$("#cal-cities [data-calcity]"); ok("calendar: 3 city pills for the owner", cities.length === 3, cities.length);
await page.click('#cal-cities [data-calcity="cairo"]'); await page.waitForTimeout(800);
const pills = await page.$$eval("#cal-th [data-calth]", (ps) => ps.map((p) => [p.textContent.trim(), p.getAttribute("aria-pressed")]));
ok("calendar: Everyone + 4 Cairo therapists as pills, Everyone pressed", pills.length === 5 && pills[0][0] === "Everyone" && pills[0][1] === "true", pills);
await page.click('#cal-th [data-calth]:nth-child(3)'); await page.waitForTimeout(400);
const after = await page.$$eval("#cal-th [data-calth]", (ps) => ps.map((p) => p.getAttribute("aria-pressed")));
ok("calendar: clicking a therapist pill moves the pressed state to it", after[2] === "true" && after[0] === "false", after);
const title0 = await page.textContent("#cal-title"); await page.click("#cal-next"); await page.waitForTimeout(700); const title1 = await page.textContent("#cal-title"); await page.click("#cal-prev"); await page.waitForTimeout(700);
ok("calendar: next / prev month change the title", title0 !== title1 && (await page.textContent("#cal-title")) === title0, [title0, title1]);
await page.click("#cal-today"); await page.waitForTimeout(500);
await page.click('#cal-grid [data-date]:nth-child(10)'); await page.waitForTimeout(500); ok("calendar: a day opens the day view", await page.isVisible("#cal-day"));
await page.click("#cd-block-day"); await page.waitForTimeout(400); ok("calendar: block-day asks in-page", await openDlg("#dlg-ask")); await page.click("#ask-no"); await page.waitForTimeout(300);
await page.click("#cd-block-hours"); await page.waitForTimeout(400); ok("calendar: block-hours opens the days-off dialog", await openDlg("#dlg-off")); await page.click("#bl-cancel"); await page.waitForTimeout(300);
await page.click('[data-calsub="rules"]'); await page.waitForTimeout(400); ok("calendar: rules view shows hours + days off", await page.isVisible("#add-hours") && await page.isVisible("#add-off"));
await page.click("#add-hours"); await page.waitForTimeout(400); ok("calendar: opening hours dialog", await openDlg("#dlg-hours")); await page.click("#av-cancel"); await page.waitForTimeout(300);
await page.click("#add-off"); await page.waitForTimeout(400); ok("calendar: days-off dialog", await openDlg("#dlg-off")); await page.click("#bl-cancel"); await page.waitForTimeout(300);
await page.click('[data-calsub="month"]'); await page.waitForTimeout(400);
await page.click("#cd-add"); await page.waitForTimeout(500); ok("calendar: add booking from the day view, city + date prefilled", await openDlg("#dlg-add") && (await page.inputValue("#ad-city")) === "cairo" && (await page.inputValue("#ad-date")).length === 10, [await page.inputValue("#ad-city"), await page.inputValue("#ad-date")]);
await page.click("#add-cancel"); await page.waitForTimeout(300);

// team: add dialog has the pin controls; existing card opens prefilled with its pin; cancel
await tab("team");
const cards = await page.$$("#team-list .team-card"); ok("team: the seeded cards", cards.length >= 6, cards.length);
await page.click("#add-therapist"); await page.waitForTimeout(400); ok("team: add dialog with pin controls + radius", await openDlg("#dlg-th") && await page.isVisible("#th-locate") && await page.isVisible("#th-lat") && await page.isVisible("#th-radius"));
await page.click("#th-cancel"); await page.waitForTimeout(300);
await page.locator("#team-list .team-card", { hasText: "Adham" }).click(); await page.waitForTimeout(400);
ok("team: Adham's dialog prefilled with his pin (New Cairo)", (await page.inputValue("#th-name")) === "Adham" && (await page.inputValue("#th-lat")).startsWith("30.01") && (await page.textContent("#th-pin-status")).includes("Pinned"), [await page.inputValue("#th-lat"), await page.textContent("#th-pin-status")]);
await page.fill("#th-radius", "12"); await page.click("#th-save"); await page.waitForTimeout(900); ok("team: radius saved, dialog closed", !(await openDlg("#dlg-th")));
const t = await (await fetch(H + "/api/team?city=cairo")).json(); ok("team: API carries the saved radius", t.therapists.find((x) => x.name === "Adham").radius_km === 12, t.therapists.find((x) => x.name === "Adham"));

// applications (owner): a form submission shows up under Team → Applications; approve → credentials dialog → a new team card + sign-in
await fetch(H + "/api/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Nour Selim", email: "nour.adm@x.com", phone: "+20 100 000 0000", city: "cairo", title: "Sports massage therapist", area: "Maadi", bio: "Sports massage and cupping.", languages: "Arabic, English", lat: 29.9602, lng: 31.2569, radius_km: 8, agree: true }) });
await fetch(H + "/api/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Omar Declined", email: "omar.adm@x.com", phone: "+20 1", city: "dahab", agree: true }) });
await tab("team"); ok("apps: the owner sees the Applications box with 2 waiting", await page.isVisible("#apps-box") && (await page.textContent("#apps-count")).trim() === "2" && (await page.$$("#apps-list .app-card")).length === 2, await page.textContent("#apps-count"));
await page.locator("#apps-list .app-card", { hasText: "Omar" }).locator("[data-decline]").click(); await page.waitForTimeout(300); ok("apps: decline asks first", await openDlg("#dlg-ask") && (await page.textContent("#ask-title")).includes("Decline Omar"));
await page.fill("#ask-input", "Not adding in Dahab right now."); await page.click("#ask-yes"); await page.waitForTimeout(900); ok("apps: declined one gone from the waiting list", (await page.$$("#apps-list .app-card")).length === 1 && (await page.textContent("#apps-count")).trim() === "1");
await page.locator("#apps-list .app-card", { hasText: "Nour" }).locator("[data-approve]").click(); await page.waitForTimeout(300); ok("apps: approve asks first", await openDlg("#dlg-ask") && (await page.textContent("#ask-title")).includes("Approve Nour"));
await page.click("#ask-yes"); await page.waitForTimeout(1500); ok("apps: credentials dialog with the sign-in + a password (no mail here)", await openDlg("#dlg-ask") && (await page.textContent("#ask-title")).includes("Sign-in for Nour") && /nour\.adm@x\.com/.test(await page.textContent("#ask-text")), await page.textContent("#ask-title"));
const nourPw = (await page.textContent("#ask-text")).trim().split("\n").pop().trim(); await page.click("#ask-yes"); await page.waitForTimeout(900);
ok("apps: Nour is now a team card in Cairo with a sign-in", (await page.locator("#team-list .team-card", { hasText: "Nour Selim" }).count()) === 1 && (await page.locator("#team-list .team-card", { hasText: "Nour Selim" }).textContent()).includes("nour.adm@x.com") && (await page.$$("#apps-list .app-card")).length === 0);
{ const t2 = await (await fetch(H + "/api/team?city=cairo")).json(); const n = t2.therapists.find((x) => x.name === "Nour Selim"); ok("apps: public team API has her, pinned in Maadi, at the end of the order", n && n.area === "Maadi" && n.radius_km === 8 && n.sort === Math.max(...t2.therapists.map((x) => x.sort)), n);
  const li = await fetch(H + "/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nour.adm@x.com", password: nourPw }) }); ok("apps: she can sign in with the password shown", li.status === 200, [li.status, nourPw]); }
await page.selectOption("#apps-filter", "declined"); await page.waitForTimeout(600); ok("apps: declined filter shows Omar with the note", (await page.textContent("#apps-list")).includes("Omar") && (await page.textContent("#apps-list")).includes("Not adding in Dahab"));
await page.selectOption("#apps-filter", "new"); await page.waitForTimeout(400);

// services: add dialog opens, cancel; settings: profile, admins table with role + level selects
await tab("services"); await page.click("#add-service"); await page.waitForTimeout(400); ok("services: add dialog", await openDlg("#dlg-svc")); await page.click("#sv-cancel"); await page.waitForTimeout(300);
await tab("settings"); ok("settings: profile form + admins table", await page.isVisible("#admins-table") && (await page.$$("#admins-table tbody tr")).length >= 1);
ok("no native pop-ups so far", native.length === 0, native);

// money (slice 5): the owner's Statements tab for this month, per therapist, with a CSV link; partner/gym/company codes with a kind
{ const ym = new Date().toISOString().slice(0, 7), day = ym + "-15";
  const mk = (o) => page.request.post(H + "/api/admin/bookings", { data: o });   // page.request shares the browser's (httpOnly) admin cookie
  await mk({ city: "cairo", service: "cai-dry", name: "Cash One", date: day, status: "done", therapist_id: "th3", amount: 90000 });
  await mk({ city: "cairo", service: "cai-dry", name: "Cash Two", date: day, status: "done", therapist_id: "th3", amount: 90000 });
  await tab("money"); await page.waitForTimeout(600);
  ok("money: Statements tab with the month picker set to this month", (await page.textContent("#money-title")).trim() === "Statements" && (await page.inputValue("#st-month")) === ym && await page.isVisible("#st-city-pills"));
  const card = page.locator("#st-list .statement", { hasText: "Adham" }); ok("money: Adham's card: 2 sessions, cash EGP 1,800, nothing to pay from the site", (await card.count()) === 1 && /Cash[\s\S]*1,800/.test(await card.textContent()) && /To pay the therapist[\s\S]*EGP.0\b/.test(await card.textContent()) && /Sessions[\s\S]*2/.test(await card.textContent()), await card.textContent().catch(() => ""));
  ok("money: the session table lists both, paid in cash", (await page.$$("#st-table tbody tr")).length >= 2 && (await page.textContent("#st-table")).includes("Cash"));
  const csv = await page.request.get(H + (await page.getAttribute("#st-csv", "href"))); ok("money: CSV link answers a CSV with the two lines", csv.status() === 200 && (csv.headers()["content-type"] || "").startsWith("text/csv") && (await csv.text()).split("\n").filter(Boolean).length === 3, [csv.status(), (await csv.text()).slice(0, 200)]);
  await page.click('#st-city-pills [data-stcity="florence"]'); await page.waitForTimeout(600); ok("money: city pill filters (Florence empty)", (await page.textContent("#st-list")).includes("No sessions"));
  await page.click('#st-city-pills [data-stcity=""]'); await page.waitForTimeout(400);
  await tab("offers"); await page.click('.subtabs [data-sub="partners"]'); await page.waitForTimeout(300);
  ok("codes: the form has a kind and a contact", await page.isVisible("#pa-kind") && await page.isVisible("#pa-contact"));
  await page.fill("#pa-name", "Gold's Gym"); await page.fill("#pa-code", "GOLDS15"); await page.selectOption("#pa-kind", "gym"); await page.fill("#pa-contact", "front desk"); await page.selectOption("#pa-city", "cairo"); await page.fill("#pa-pct", "15"); await page.click("#partner-form button[type=submit]"); await page.waitForTimeout(900);
  const prow = page.locator("#partners-table tbody tr", { hasText: "GOLDS15" }); ok("codes: the gym code is in the table with its kind and contact", (await prow.count()) === 1 && (await prow.textContent()).includes("Gym") && (await prow.textContent()).includes("front desk"), await page.textContent("#partners-table"));
  const look = await (await fetch(H + "/api/partner/GOLDS15?city=cairo")).json(); ok("codes: clients can use it at once", look.partner?.pct === 15 && look.partner.kind === "gym", look); }

// messages (slice 7): a client writes to Adham and to the Cairo room; the owner answers from the Messages tab
let clientCookie = "";
{ const rl = await (await fetch(H + "/api/auth/request-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "chat.client@x.com", name: "Chat Client", lang: "en" }) })).json();
  const v = await fetch(rl.link, { redirect: "manual" }); clientCookie = (v.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const cj = (path, init = {}) => fetch(H + path, { ...init, headers: { cookie: clientCookie, "content-type": "application/json", ...(init.headers || {}) } }).then((r) => r.json());
  const c1 = await cj("/api/me/chats", { method: "POST", body: JSON.stringify({ therapist_id: "th3" }) }); await cj("/api/me/chats/" + c1.id, { method: "POST", body: JSON.stringify({ body: "Hi Adham, do you do dry needling?" }) });
  const c2 = await cj("/api/me/chats", { method: "POST", body: JSON.stringify({ city: "cairo" }) }); await cj("/api/me/chats/" + c2.id, { method: "POST", body: JSON.stringify({ body: "Room: who is free on Friday?" }) });
  ok("chat: two client conversations created through the API", Boolean(c1.id && c2.id && c1.id !== c2.id), [c1, c2]); }
await page.waitForTimeout(300); await page.evaluate(() => refreshChatCount()); await page.waitForTimeout(500);
ok("chat: the Messages tab badge shows 2 unread", (await page.textContent("#chat-count")).trim() === "2" && await page.isVisible("#chat-count"), await page.textContent("#chat-count"));
await tab("chat"); await page.waitForTimeout(500);
ok("chat: list shows both, the room one and Adham's, newest first", (await page.$$("#achat-list .chat-item")).length === 2 && (await page.textContent("#achat-list .chat-item")).includes("room"), await page.textContent("#achat-list"));
await page.locator("#achat-list .chat-item", { hasText: "Adham" }).click(); await page.waitForTimeout(600);
ok("chat: Adham's thread opens with the client's line and her email", (await page.textContent("#achat-msgs")).includes("dry needling") && (await page.textContent("#achat-sub")).includes("chat.client@x.com"), await page.textContent("#achat-sub"));
await page.fill("#achat-input", "Yes, Adham does. Book any evening."); await page.keyboard.press("Enter"); await page.waitForTimeout(900);
ok("chat: Enter sends; the answer shows as mine, signed Zen · Owner", (await page.$$("#achat-msgs .msg.me")).length === 1 && (await page.textContent("#achat-msgs .msg.me")).includes("Zen ·"), await page.textContent("#achat-msgs"));
await page.screenshot({ path: (process.env.SHOTS || ".") + "/shot-achat.png" }); await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400); await page.screenshot({ path: (process.env.SHOTS || ".") + "/shot-achat-m.png" }); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(300);
ok("chat: badge gone once both conversations were opened (the first opens by itself)", await page.isHidden("#chat-count"), await page.textContent("#chat-count"));
{ const mine = await (await fetch(H + "/api/me/chats", { headers: { cookie: clientCookie } })).json(); ok("chat: the client now has 1 unread from the team with the owner's line", mine.unread === 1 && mine.chats.find((c) => c.therapist === "Adham").last_body.includes("Book any evening"), mine.chats); }
{ const cid = await page.evaluate(() => AOPEN?.id); await page.goto(H + "/admin.html#chat=" + cid, { waitUntil: "load" }); await page.waitForTimeout(1500); ok("chat: the email's Respond link (#chat=<id>) lands on that conversation", await page.isVisible("#achat-main") && (await page.evaluate(() => AOPEN?.id)) === cid && (await page.textContent("#achat-msgs")).includes("dry needling"), [cid, await page.evaluate(() => AOPEN?.id)]); }
await page.click("#achat-client"); await page.waitForTimeout(600); ok("chat: Open client opens the client drawer", (await page.textContent("#drawer")).includes("Chat Client"), (await page.textContent("#drawer")).slice(0, 120)); await page.click("#dr-close").catch(() => {}); await page.waitForTimeout(300);

// search (slice 9): one box for clients, bookings, team and codes
await page.fill("#q", "chat cli"); await page.waitForTimeout(700); ok("search: typing finds the client and her bookings", await page.isVisible("#q-results") && (await page.textContent("#q-results")).includes("Chat Client") && (await page.$$("#q-results [data-client]")).length === 1, await page.textContent("#q-results"));
await page.click("#q-results [data-client]"); await page.waitForTimeout(600); ok("search: a client hit opens the client drawer", (await page.textContent("#drawer")).includes("Chat Client") && await page.isHidden("#q-results")); await page.click("#dr-close").catch(() => {}); await page.waitForTimeout(300);
await page.fill("#q", "GOLDS"); await page.waitForTimeout(700); ok("search: a code by its code", (await page.$$("#q-results [data-code]")).length === 1, await page.textContent("#q-results"));
await page.fill("#q", "Adham"); await page.waitForTimeout(700); ok("search: a therapist by name", (await page.$$("#q-results [data-therapist]")).length >= 1); await page.keyboard.press("Escape"); await page.waitForTimeout(200); ok("search: Escape clears", await page.isHidden("#q-results") && (await page.inputValue("#q")) === "");
await page.keyboard.press("/"); await page.waitForTimeout(200); ok("search: the / key focuses the box", await page.evaluate(() => document.activeElement?.id === "q")); await page.keyboard.press("Escape");
// an employee: create Hesham's account through the team dialog (owner), sign out, sign in as him → own calendar only, can't edit others
await tab("team"); await page.locator("#team-list .team-card", { hasText: "Hesham" }).click(); await page.waitForTimeout(400);
await page.selectOption("#th-admin", "new"); await page.waitForTimeout(200); await page.fill("#th-new-email", "hesham@x.com"); await page.fill("#th-new-pass", "Hesham-pass-12345"); await page.click("#th-save"); await page.waitForTimeout(1200);
ok("owner: created Hesham's sign-in, credentials dialog shows the typed password with Got it as the main button", await openDlg("#dlg-ask") && (await page.textContent("#ask-text")).includes("Hesham-pass-12345") && (await page.textContent("#ask-yes")) === "Got it" && (await page.textContent("#ask-alt")) === "Also email it to them", [await page.textContent("#ask-yes"), await page.textContent("#ask-alt")]);
await page.click("#ask-alt"); await page.waitForTimeout(900);   // no mail key here → "tell them in person", and the password must be unchanged
ok("owner: emailing keeps the typed password (no reset)", (await page.textContent("#ask-text")).includes("Hesham-pass-12345"), await page.textContent("#ask-text"));
await page.click("#ask-yes"); await page.waitForTimeout(300);
await page.evaluate(() => fetch("/api/admin/logout", { method: "POST" })); await page.goto(H + "/admin.html", { waitUntil: "load" }); await page.waitForTimeout(600);
await page.fill("#a-email", "hesham@x.com"); await page.fill("#a-pass", "Hesham-pass-12345"); await page.click("#login-btn"); await page.waitForTimeout(1500);
ok("employee: signs in with the password the owner typed", await page.isVisible(".tabs") && !(await page.isVisible("#login-form")), await page.textContent("#login-err").catch(() => ""));
await tab("calendar"); ok("employee: own calendar badge, no therapist pills", (await page.textContent("#cal-th")).includes("Your calendar") && (await page.$$("#cal-th [data-calth]")).length === 0, await page.textContent("#cal-th"));
await tab("team"); const editable = await page.$$eval("#team-list [data-edit]", (els) => [...new Set(els.map((e) => e.dataset.edit))]); ok("employee: can open only their own profile", editable.length === 1, editable);
ok("employee: no Applications box", !(await page.isVisible("#apps-box")));
await tab("team"); await page.locator("#team-list [data-edit]").first().click(); await page.waitForTimeout(700);
ok("employee: own dialog shows 'Your list and prices' with editable checkboxes", await page.isVisible("#th-prices-box") && (await page.textContent("#th-prices-title")).includes("Your list") && (await page.$$("#th-prices [data-offered]:not([disabled])")).length >= 2, await page.textContent("#th-prices-title"));
{ const cb = page.locator("#th-prices [data-offered]").first(); const sid = await cb.getAttribute("data-offered"); await cb.uncheck(); await page.fill(`#th-prices [data-price]:not([hidden])`, "777"); await page.click("#th-save"); await page.waitForTimeout(900);
  const mine = await (await page.request.get(H + "/api/admin/therapists/" + (await page.evaluate(() => T.id)) + "/prices")).json(); ok("employee: saving keeps the switched-off session and the own price", mine.rows.find((r) => r.id === sid).offered === false && mine.rows.some((r) => r.own === 77700), mine.rows); }
await tab("chat"); await page.waitForTimeout(500); ok("employee: Hesham sees only the room chat, not Adham's", (await page.$$("#achat-list .chat-item")).length === 1 && (await page.textContent("#achat-list")).includes("room"), await page.textContent("#achat-list"));
await tab("money"); ok("employee: the tab reads Your earnings and shows their own card only", (await page.textContent("#tab-money-btn")).trim() === "Your earnings" && (await page.textContent("#money-title")).trim() === "Your earnings" && !(await page.isVisible("#st-city-pills .pill")), await page.textContent("#money-title"));
ok("no JS errors across the admin sweep", errs.length === 0, errs); ok("no native pop-ups", native.length === 0, native);
await b.close();
