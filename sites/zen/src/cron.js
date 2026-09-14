// Scheduled work (wrangler.toml [triggers] crons, hourly):
//   · reminders the day before a session (WhatsApp template if configured, else email)
//   · "how do you feel?" two days after a done session
//   · birthday reward once a year, in the birthday month
//   · waitlist: tell people when a slot opens on the day they asked for
import { M } from "./mail.js";
import { CITIES, SLOTS } from "./catalog.js";
import { settings, sendEmail, sendWhatsApp, logMessage, slotsFor, today, addDays, now , pickLang, translateProfile, translateService, localNow, fmt } from "./lib.js";
import { statements } from "./features.js";

export async function runCron(env) {
  const results = {};
  for (const [name, fn] of Object.entries({ reminders, followups, birthdays, waitlist, translations, monthly })) {
    try { results[name] = await fn(env); } catch (e) { console.error(name, e); results[name] = "error: " + e.message; }
  }
  console.log("cron", JSON.stringify(results));
  return results;
}

// 2026-09-14: on the 1st, everyone with an email gets last month by email: a therapist their own line, the owner / partner / platform the
// totals per city (the same privacy rule as the Money tab). One email per person per month, recorded in `messages` (kind "statement").
async function monthly(env) {
  const ln = localNow("Africa/Cairo");
  if (ln.date.slice(8) !== "01" || ln.minutes < 8 * 60 || ln.minutes >= 9 * 60) return 0;
  const d = new Date(ln.date + "T12:00:00Z"); d.setUTCDate(0);   // last day of the previous month
  return sendStatements(env, d.toISOString().slice(0, 7));
}
export async function sendStatements(env, month) {
  const admins = (await env.DB.prepare("SELECT * FROM admins WHERE email LIKE '%@%' AND (notify IS NULL OR notify = 1)").all()).results;
  let n = 0;
  for (const a of admins) {
    const key = month + ":" + a.id;
    if (await env.DB.prepare("SELECT 1 FROM messages WHERE kind = 'statement' AND detail = ? LIMIT 1").bind(key).first()) continue;
    let d; try { d = await (await statements(env, a, new URL(`https://zen/api/admin/statements?month=${month}`))).json(); } catch (e) { console.error("statement", a.email, e.message); continue; }
    if (!d.rows || !d.rows.length) { await logMessage(env, { user_id: null, kind: "statement", channel: "email", status: "skipped", detail: key }); continue; }
    const mine = Boolean(d.mine);
    const lines = d.rows.map((r) => `${r.therapist || r.city} · ${r.sessions} session${r.sessions === 1 ? "" : "s"} (${r.done} done, ${r.upcoming} to come${r.kept ? ", " + r.kept + " fee kept" : ""})\n  gross ${fmt(r.gross, r.currency)} · site takings ${fmt(r.site_takings, r.currency)} · platform fee ${fmt(r.fee, r.currency)} · ${mine ? "coming to you" : "to pay the team"} ${fmt(r.to_therapist, r.currency)}${r.cash_amount ? ` · collected in cash ${fmt(r.cash_amount, r.currency)}` : ""}`);
    const ok = await sendEmail(env, { to: a.email, subject: `Zen Recovery · ${mine ? "your earnings" : "statements"} · ${month}`, text: [`Hi ${(a.name || "").split(" ")[0] || "there"},`, ``, mine ? `Here is your month at Zen Recovery (${month}):` : `Here are last month's totals per city (${month}). Each therapist gets their own line by email; nobody else sees individual earnings.`, ``, ...lines, ``, `Details and the CSV: ${env.SITE_URL}/admin.html (Money tab).`].join("\n") }).catch(() => false);
    await logMessage(env, { user_id: null, kind: "statement", channel: "email", status: ok ? "sent" : "failed", detail: key });
    n++;
  }
  return n;
}
async function reminders(env) {
  const date = addDays(today(), 1);
  const rows = (await env.DB.prepare("SELECT b.*, b.lang AS blang, u.lang FROM bookings b LEFT JOIN users u ON u.id = b.user_id WHERE b.date = ? AND b.status IN ('paid','confirmed') AND b.reminded_at IS NULL LIMIT 50").bind(date).all()).results;
  let n = 0;
  for (const b of rows) {
    const city = CITIES[b.city]; const when = SLOTS[b.slot] || b.slot; const svc = b.service_name.split(" · ")[0];
    let ok = await sendWhatsApp(env, { to: b.phone, template: env.WA_TEMPLATE_REMINDER, params: [b.name.split(" ")[0], svc, city.name, when], lang: b.lang });
    let channel = "whatsapp";
    if (!ok) { channel = "email"; ok = await sendEmail(env, { to: b.email, ...M("reminder", pickLang(b.blang, b.lang), { first: b.name.split(" ")[0], service: svc, city: city.name, date, slot: when, site: env.SITE_URL }) }); }
    await env.DB.prepare("UPDATE bookings SET reminded_at = ? WHERE id = ?").bind(now(), b.id).run();
    await logMessage(env, { user_id: b.user_id, booking_id: b.id, kind: "reminder", channel, status: ok ? "sent" : "failed" });
    n++;
  }
  return n;
}

async function followups(env) {
  const date = addDays(today(), -2);
  const rows = (await env.DB.prepare("SELECT b.*, b.lang AS blang, u.lang FROM bookings b LEFT JOIN users u ON u.id = b.user_id WHERE b.date = ? AND b.status = 'done' AND b.followup_at IS NULL AND b.user_id IS NOT NULL LIMIT 50").bind(date).all()).results;
  let n = 0;
  for (const b of rows) {
    const svc = b.service_name.split(" · ")[0];
    let ok = await sendWhatsApp(env, { to: b.phone, template: env.WA_TEMPLATE_FOLLOWUP, params: [b.name.split(" ")[0], svc], lang: b.lang });
    let channel = "whatsapp";
    if (!ok) { channel = "email"; ok = await sendEmail(env, { to: b.email, ...M("followup", pickLang(b.lang, b.blang), { first: b.name.split(" ")[0], service: svc, site: env.SITE_URL }) }); }
    await env.DB.prepare("UPDATE bookings SET followup_at = ? WHERE id = ?").bind(now(), b.id).run();
    await logMessage(env, { user_id: b.user_id, booking_id: b.id, kind: "followup", channel, status: ok ? "sent" : "failed" });
    n++;
  }
  return n;
}

// Birthday reward: issued once per year, in a window from 10 days before the birthday to 5 days after it; the credit expires when the window closes.
const BDAY_BEFORE = 10, BDAY_AFTER = 5;
export function birthdayWindow(birthday, onDate) { // → { year, start, end } of the occurrence whose window contains onDate, else null
  const mmdd = birthday.slice(5), y = Number(onDate.slice(0, 4));
  for (const year of [y - 1, y, y + 1]) {
    let bd = `${year}-${mmdd}`; if (mmdd === "02-29" && new Date(bd + "T12:00:00Z").getUTCDate() !== 29) bd = `${year}-02-28`;
    const start = addDays(bd, -BDAY_BEFORE), end = addDays(bd, BDAY_AFTER);
    if (onDate >= start && onDate <= end) return { year, start, end, birthday: bd };
  }
  return null;
}
async function birthdays(env) {
  const s = await settings(env);
  const t = today();
  await env.DB.prepare("UPDATE credits SET status = 'expired' WHERE status = 'available' AND expires_at IS NOT NULL AND expires_at < ?").bind(t).run();
  const rows = (await env.DB.prepare("SELECT id, name, email, lang, birthday, birthday_reward_year FROM users WHERE birthday IS NOT NULL AND length(birthday) = 10 LIMIT 2000").all()).results;
  let n = 0;
  for (const u of rows) {
    const w = birthdayWindow(u.birthday, t);
    if (!w || (u.birthday_reward_year && u.birthday_reward_year >= w.year)) continue;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO credits (id, user_id, kind, pct, reason, expires_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID().replace(/-/g, "").slice(0, 24), u.id, "birthday", s.birthday_pct, `Birthday ${w.year}`, w.end),
      env.DB.prepare("UPDATE users SET birthday_reward_year = ? WHERE id = ?").bind(w.year, u.id),
    ]);
    const ok = await sendEmail(env, { to: u.email, ...M("birthday", pickLang(u.lang), { first: u.name.split(" ")[0], pct: s.birthday_pct, until: w.end, site: env.SITE_URL }) });
    await logMessage(env, { user_id: u.id, kind: "birthday", channel: "email", status: ok ? "sent" : "failed" });
    n++;
  }
  return n;
}

// Team profiles without Italian/Arabic yet (new, or the AI failed at save time): a few per hour.
async function translations(env) {
  if (!env.AI) return 0;
  const rows = (await env.DB.prepare("SELECT id, title, bio, story, certs, languages, area FROM therapists WHERE i18n IS NULL AND (COALESCE(story,'') != '' OR COALESCE(bio,'') != '' OR COALESCE(title,'') != '') LIMIT 5").all()).results;
  let n = 0;
  for (const r of rows) { const i18n = await translateProfile(env, r); if (i18n) { await env.DB.prepare("UPDATE therapists SET i18n = ? WHERE id = ?").bind(JSON.stringify(i18n), r.id).run(); n++; } }
  const svcs = (await env.DB.prepare("SELECT id, name, description FROM services WHERE i18n IS NULL LIMIT 5").all()).results;
  for (const r of svcs) { const i18n = await translateService(env, r); if (i18n) { await env.DB.prepare("UPDATE services SET i18n = ? WHERE id = ?").bind(JSON.stringify(i18n), r.id).run(); n++; } }
  return n;
}
async function waitlist(env) {
  const rows = (await env.DB.prepare("SELECT w.*, u.email, u.name, u.phone, u.lang FROM waitlist w JOIN users u ON u.id = w.user_id WHERE w.notified_at IS NULL AND w.date >= ? LIMIT 50").bind(today()).all()).results;
  let n = 0;
  for (const w of rows) {
    const { mode, slots } = await slotsFor(env, w.city, w.date, null);
    const match = mode === "slots" ? slots.filter((s) => !w.slot_pref || w.slot_pref === "any" || ({ morning: [0, 12], afternoon: [12, 17], evening: [17, 24] }[w.slot_pref] || [0, 24]).every((_, i, r) => (i === 0 ? Number(s.time.slice(0, 2)) >= r[0] : Number(s.time.slice(0, 2)) < r[1]))) : [];
    if (!match.length) continue;
    const ok = await sendEmail(env, { to: w.email, ...M("waitlist", pickLang(w.lang), { first: w.name.split(" ")[0], city: CITIES[w.city].name, date: w.date, times: match.slice(0, 6).map((s) => s.time).join(", "), link: `${env.SITE_URL}/booking?city=${w.city}&date=${w.date}` }) });
    await env.DB.prepare("UPDATE waitlist SET notified_at = ? WHERE id = ?").bind(now(), w.id).run();
    await logMessage(env, { user_id: w.user_id, kind: "waitlist", channel: "email", status: ok ? "sent" : "failed", detail: `${w.city} ${w.date}` });
    n++;
  }
  return n;
}
