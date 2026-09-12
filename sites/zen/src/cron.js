// Scheduled work (wrangler.toml [triggers] crons, hourly):
//   · reminders the day before a session (WhatsApp template if configured, else email)
//   · "how do you feel?" two days after a done session
//   · birthday reward once a year, in the birthday month
//   · waitlist: tell people when a slot opens on the day they asked for
import { CITIES, SLOTS } from "./catalog.js";
import { settings, sendEmail, sendWhatsApp, logMessage, slotsFor, today, addDays, now } from "./lib.js";

export async function runCron(env) {
  const results = {};
  for (const [name, fn] of Object.entries({ reminders, followups, birthdays, waitlist })) {
    try { results[name] = await fn(env); } catch (e) { console.error(name, e); results[name] = "error: " + e.message; }
  }
  console.log("cron", JSON.stringify(results));
  return results;
}

async function reminders(env) {
  const date = addDays(today(), 1);
  const rows = (await env.DB.prepare("SELECT b.*, u.lang FROM bookings b LEFT JOIN users u ON u.id = b.user_id WHERE b.date = ? AND b.status IN ('paid','confirmed') AND b.reminded_at IS NULL LIMIT 50").bind(date).all()).results;
  let n = 0;
  for (const b of rows) {
    const city = CITIES[b.city]; const when = SLOTS[b.slot] || b.slot; const svc = b.service_name.split(" · ")[0];
    let ok = await sendWhatsApp(env, { to: b.phone, template: env.WA_TEMPLATE_REMINDER, params: [b.name.split(" ")[0], svc, city.name, when], lang: b.lang });
    let channel = "whatsapp";
    if (!ok) { channel = "email"; ok = await sendEmail(env, { to: b.email, subject: `Tomorrow: your ${svc} session in ${city.name}`, text: [`Hi ${b.name.split(" ")[0]},`, ``, `A reminder that your ${svc} session in ${city.name} is tomorrow, ${date}, ${when}.`, ``, `Before you come: eat something light 1–2 hours before, drink water, no alcohol or hard training today, clean skin with no lotion.`, ``, `Need to move it? Reply to Zen on WhatsApp as early as you can.`, ``, `Your account: ${env.SITE_URL}/account`, ``, `Zen Recovery`].join("\n") }); }
    await env.DB.prepare("UPDATE bookings SET reminded_at = ? WHERE id = ?").bind(now(), b.id).run();
    await logMessage(env, { user_id: b.user_id, booking_id: b.id, kind: "reminder", channel, status: ok ? "sent" : "failed" });
    n++;
  }
  return n;
}

async function followups(env) {
  const date = addDays(today(), -2);
  const rows = (await env.DB.prepare("SELECT b.*, u.lang FROM bookings b LEFT JOIN users u ON u.id = b.user_id WHERE b.date = ? AND b.status = 'done' AND b.followup_at IS NULL AND b.user_id IS NOT NULL LIMIT 50").bind(date).all()).results;
  let n = 0;
  for (const b of rows) {
    const svc = b.service_name.split(" · ")[0];
    let ok = await sendWhatsApp(env, { to: b.phone, template: env.WA_TEMPLATE_FOLLOWUP, params: [b.name.split(" ")[0], svc], lang: b.lang });
    let channel = "whatsapp";
    if (!ok) { channel = "email"; ok = await sendEmail(env, { to: b.email, subject: `How do you feel after your ${svc} session?`, text: [`Hi ${b.name.split(" ")[0]},`, ``, `Two days on from your ${svc} session. How's the body?`, ``, `Thirty seconds in your account tells your therapist what changed, and shows you your own progress over time:`, `${env.SITE_URL}/account#progress`, ``, `And if the session was good, rating it there helps the room a lot.`, ``, `Zen Recovery`].join("\n") }); }
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
  const rows = (await env.DB.prepare("SELECT id, name, email, birthday, birthday_reward_year FROM users WHERE birthday IS NOT NULL AND length(birthday) = 10 LIMIT 2000").all()).results;
  let n = 0;
  for (const u of rows) {
    const w = birthdayWindow(u.birthday, t);
    if (!w || (u.birthday_reward_year && u.birthday_reward_year >= w.year)) continue;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO credits (id, user_id, kind, pct, reason, expires_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID().replace(/-/g, "").slice(0, 24), u.id, "birthday", s.birthday_pct, `Birthday ${w.year}`, w.end),
      env.DB.prepare("UPDATE users SET birthday_reward_year = ? WHERE id = ?").bind(w.year, u.id),
    ]);
    const ok = await sendEmail(env, { to: u.email, subject: `Happy birthday — ${s.birthday_pct}% off a session, until ${w.end}`, text: [`Hi ${u.name.split(" ")[0]},`, ``, `Your birthday is close. There's ${s.birthday_pct}% off one session in your account, any city, valid until ${w.end} (five days after your birthday). After that it's gone until next year.`, ``, `Book it: ${env.SITE_URL}/booking`, ``, `Zen Recovery`].join("\n") });
    await logMessage(env, { user_id: u.id, kind: "birthday", channel: "email", status: ok ? "sent" : "failed" });
    n++;
  }
  return n;
}

async function waitlist(env) {
  const rows = (await env.DB.prepare("SELECT w.*, u.email, u.name, u.phone FROM waitlist w JOIN users u ON u.id = w.user_id WHERE w.notified_at IS NULL AND w.date >= ? LIMIT 50").bind(today()).all()).results;
  let n = 0;
  for (const w of rows) {
    const { mode, slots } = await slotsFor(env, w.city, w.date, null);
    const match = mode === "slots" ? slots.filter((s) => !w.slot_pref || w.slot_pref === "any" || ({ morning: [0, 12], afternoon: [12, 17], evening: [17, 24] }[w.slot_pref] || [0, 24]).every((_, i, r) => (i === 0 ? Number(s.time.slice(0, 2)) >= r[0] : Number(s.time.slice(0, 2)) < r[1]))) : [];
    if (!match.length) continue;
    const ok = await sendEmail(env, { to: w.email, subject: `A slot opened in ${CITIES[w.city].name} on ${w.date}`, text: [`Hi ${w.name.split(" ")[0]},`, ``, `Free times in ${CITIES[w.city].name} on ${w.date}: ${match.slice(0, 6).map((s) => s.time).join(", ")}.`, ``, `Book it before someone else does: ${env.SITE_URL}/booking?city=${w.city}&date=${w.date}`, ``, `Zen Recovery`].join("\n") });
    await env.DB.prepare("UPDATE waitlist SET notified_at = ? WHERE id = ?").bind(now(), w.id).run();
    await logMessage(env, { user_id: w.user_id, kind: "waitlist", channel: "email", status: ok ? "sent" : "failed", detail: `${w.city} ${w.date}` });
    n++;
  }
  return n;
}
