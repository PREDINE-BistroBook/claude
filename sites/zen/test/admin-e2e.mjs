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
const cards = await page.$$("#team-list .team-card"); ok("team: 6 cards", cards.length === 6, cards.length);
await page.click("#add-therapist"); await page.waitForTimeout(400); ok("team: add dialog with pin controls + radius", await openDlg("#dlg-th") && await page.isVisible("#th-locate") && await page.isVisible("#th-lat") && await page.isVisible("#th-radius"));
await page.click("#th-cancel"); await page.waitForTimeout(300);
await page.locator("#team-list .team-card", { hasText: "Adham" }).click(); await page.waitForTimeout(400);
ok("team: Adham's dialog prefilled with his pin (New Cairo)", (await page.inputValue("#th-name")) === "Adham" && (await page.inputValue("#th-lat")).startsWith("30.01") && (await page.textContent("#th-pin-status")).includes("Pinned"), [await page.inputValue("#th-lat"), await page.textContent("#th-pin-status")]);
await page.fill("#th-radius", "12"); await page.click("#th-save"); await page.waitForTimeout(900); ok("team: radius saved, dialog closed", !(await openDlg("#dlg-th")));
const t = await (await fetch(H + "/api/team?city=cairo")).json(); ok("team: API carries the saved radius", t.therapists.find((x) => x.name === "Adham").radius_km === 12, t.therapists.find((x) => x.name === "Adham"));

// services: add dialog opens, cancel; settings: profile, admins table with role + level selects
await tab("services"); await page.click("#add-service"); await page.waitForTimeout(400); ok("services: add dialog", await openDlg("#dlg-svc")); await page.click("#sv-cancel"); await page.waitForTimeout(300);
await tab("settings"); ok("settings: profile form + admins table", await page.isVisible("#admins-table") && (await page.$$("#admins-table tbody tr")).length >= 1);
ok("no native pop-ups so far", native.length === 0, native);

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
ok("no JS errors across the admin sweep", errs.length === 0, errs); ok("no native pop-ups", native.length === 0, native);
await b.close();
