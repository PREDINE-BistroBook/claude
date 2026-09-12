/* Zen Recovery — booking page: city choice, services, live slots, rewards/codes, checkout. Needs site.js first. */
Zen.on("catalog", () => { if (city) { renderServices(); if (SVC_PRE) preselectService(SVC_PRE); updateSummary(); renderPrep(); } });
Zen.on("status", () => { if (city) placeLinks(); });
Zen.on("lang", () => { if (city) { renderServices(); updateSummary(); renderPrep(); $("#chosen-text").textContent = t("You're booking in {city}.", { city: t(CITIES[city].name) }); } });
Zen.on("me", (d) => {
  $("#name").value = d.user.name || ""; $("#email").value = d.user.email || ""; $("#phone").value = d.user.phone || "";
  $("#rewards-guest").hidden = true; $("#rewards-user").hidden = false;
  const cr = d.credits.filter(c => c.status === "available");
  $("#rewards-who").textContent = cr.length ? t("Signed in as {name}. Pick a reward to use on this session:", { name: d.user.name }) : t("Signed in as {name}. {n}/{every} toward your free session.", { name: d.user.name, n: d.stats.done % d.settings.loyalty_every, every: d.settings.loyalty_every });
  if (d.user.nearest_city && !city) choose(d.user.nearest_city, true);
  renderDiscounts();
  $("#health-box").hidden = Boolean(d.user.intake?.completed_at);
  $("#review-note").hidden = !(d.user.flags?.length && !d.user.approved);
  updateSummary();
});
// reward credits + session packs as one radio group (name=discount): "" | credit:ID | package:ID
function renderDiscounts() {
  if (!ME) return;
  const cr = ME.credits.filter(c => c.status === "available"), packs = (ME.packages || []).filter(p => !city || p.city === city);
  const opts = [];
  if (cr.length || packs.length) opts.push(`<span class="slot"><input type="radio" name="discount" id="cr-none" value=""><label for="cr-none">${t("No reward")}</label></span>`);
  cr.forEach(c => opts.push(`<span class="slot"><input type="radio" name="discount" id="cr-${c.id}" value="credit:${c.id}" data-pct="${c.pct}"><label for="cr-${c.id}">${c.pct === 100 ? t("Free session") : t("{pct}% off", { pct: c.pct })}</label></span>`));
  packs.forEach(p => opts.push(`<span class="slot"><input type="radio" name="discount" id="pk-${p.id}" value="package:${p.id}" data-pct="100"><label for="pk-${p.id}">${t("Use my pack · {n} left", { n: p.remaining })}</label></span>`));
  $("#credit-options").innerHTML = opts.join("");
  const first = $("input[name=discount][value^='package:']") || $("input[name=discount][value^='credit:']") || $("#cr-none"); if (first) first.checked = true;
}

/* ---------- city choice + booking ---------- */
let city = null;
const panels = $("#panels");
panels.addEventListener("click", (e) => {
  const btn = e.target.closest(".panel"); if (!btn) return;
  choose(btn.dataset.city);
});
function choose(key, quiet) {
  if (panels.classList.contains("has-choice") && city === key) return; // tapping the chosen card again does nothing
  city = key;
  const c = CITIES[key];
  $$(".panel").forEach(p => p.setAttribute("aria-pressed", String(p.dataset.city === key)));
  panels.classList.add("has-choice");
  $("#chosen-line").hidden = false; $("#chosen-text").textContent = t("You're booking in {city}.", { city: t(c.name) });
  $("#book-empty").hidden = true;
  const pl = $("#book-place"); pl.hidden = false;
  placeLinks();
  const form = $("#booking"); form.hidden = false;
  renderServices();
  const d = $("#date"); const tm = new Date(); // same-day booking is allowed: past times are filtered, and in window mode Zen confirms by WhatsApp
  d.min = tm.toISOString().slice(0, 10); if (!d.value || d.value < d.min) d.value = d.min;
  $("#phone").placeholder = c.currency === "EUR" ? "+39 …" : "+20 …";
  renderDiscounts(); loadTeam(); loadSlots(); loadPackHint();
  updateSummary();
  if (!reduced) window.gsap?.from("#booking > *", { y: 18, opacity: 0, duration: .7, stagger: .07, ease: "power2.out", clearProps: "all" });
  if (!quiet) setTimeout(() => $("#book").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }), 120);
  renderPrep();
}
// bring the three cities back; the form stays as it is until a new city is picked
function changeCity() {
  panels.classList.remove("has-choice"); $$(".panel").forEach(p => p.setAttribute("aria-pressed", "false"));
  $("#chosen-line").hidden = true;
  $("#places").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}
$("#change-city").addEventListener("click", changeCity); $("#change-city-2").addEventListener("click", changeCity);
function placeLinks() {
  const c = CITIES[city]; const wa = (ST.whatsapp?.[city] || c.whatsapp || "").replace(/\D/g, "");
  $("#place-wa").hidden = !wa; if (wa) $("#place-wa-link").href = "https://wa.me/" + wa;
  const gm = ST.gmaps?.[city]; $("#place-maps").hidden = !gm; if (gm) $("#place-maps-link").href = gm;
}
/* ---------- team (therapists per city, from the admin) ---------- */
const TEAM = {};
async function loadTeam() {
  const k = city;
  if (!TEAM[k]) { try { const r = await fetch("/api/team?city=" + k); TEAM[k] = (r.headers.get("content-type") || "").includes("json") ? (await r.json()).therapists || [] : []; } catch { TEAM[k] = []; } }
  if (k !== city) return;
  // "near you": the client told us where they live (profile); a therapist whose area mentions it goes first
  const mine = (ME?.user?.city_text || "").trim().toLowerCase();
  const near = th => Boolean(mine && th.area && (th.area.toLowerCase().includes(mine) || mine.includes(th.area.toLowerCase().split(/[,·/]/)[0].trim())));
  const list = TEAM[k].slice().sort((a, b) => Number(near(b)) - Number(near(a))), box = $("#place-therapists");
  box.hidden = !list.length;
  box.innerHTML = list.map(th => `<div class="therapist${near(th) ? " near" : ""}"><span class="ph">${th.photo ? `<img src="${esc(th.photo)}" alt="">` : esc(th.name.slice(0, 1))}</span><div><b>${esc(th.name)}${near(th) ? ` <em class="near-tag">${t("near you")}</em>` : ""}</b><span>${esc([th.bio, th.languages ? t("Speaks {langs}", { langs: th.languages }) : ""].filter(Boolean).join(" · "))}</span>${th.area ? `<span class="where">${t("Works in {area}", { area: esc(th.area) })}${th.maps_url ? ` · <a href="${esc(th.maps_url)}" target="_blank" rel="noopener">${t("Map")}</a>` : ""}</span>` : ""}</div></div>`).join("");
  const sel = $("#therapist"); const keep = sel.value;
  sel.innerHTML = `<option value="">${t("Anyone available")}</option>` + list.map(th => `<option value="${esc(th.id)}">${esc(th.name)}${th.area ? ` · ${esc(th.area)}` : ""}${near(th) ? ` · ${t("near you")}` : ""}</option>`).join("");
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep; else if (ME?.user?.preferred_therapist && list.some(th => th.id === ME.user.preferred_therapist)) sel.value = ME.user.preferred_therapist;
  $("#therapist-wrap").hidden = list.length < 2 || SLOTMODE !== "slots";
}
/* ---------- live time slots (when the admin has set opening hours for the city) ---------- */
let SLOTMODE = "windows", SLOTREQ = 0;
async function loadSlots() {
  const k = city, date = $("#date").value, th = $("#therapist").value; if (!k || !date) return;
  const my = ++SLOTREQ;
  let data = { mode: "windows", slots: [] };
  try { const r = await fetch(`/api/slots?city=${k}&date=${date}${th ? "&therapist=" + th : ""}`); if ((r.headers.get("content-type") || "").includes("json")) data = await r.json(); } catch {}
  if (my !== SLOTREQ || k !== city) return;
  SLOTMODE = data.mode === "slots" ? "slots" : "windows";
  const windows = $("#slots"), grid = $("#timeslots"), empty = $("#slots-empty");
  if (SLOTMODE === "windows") { windows.hidden = false; grid.hidden = true; empty.hidden = true; $("#when-note").textContent = t("Zen confirms the exact hour with you on WhatsApp within a few hours of booking."); $("#time-label").textContent = t("Preferred time"); }
  else {
    windows.hidden = true; $("#time-label").textContent = t("Time");
    $("#when-note").textContent = t("Times are {city} local time. Your spot is held the moment you pay.", { city: t(CITIES[k].name) });
    const keep = $("input[name=slot]:checked")?.value;
    if (data.slots.length) {
      empty.hidden = true; grid.hidden = false;
      grid.innerHTML = data.slots.map((s, i) => `<span class="slot"><input type="radio" name="slot" id="ts-${s.time.replace(":", "")}" value="${s.time}" ${(keep ? keep === s.time : i === 0) ? "checked" : ""}><label for="ts-${s.time.replace(":", "")}">${s.time}${s.therapists.length > 1 && !th ? `<small>${t("{n} free", { n: s.therapists.length })}</small>` : ""}</label></span>`).join("");
      if (!$("input[name=slot]:checked")) grid.querySelector("input").checked = true;
    } else {
      grid.hidden = true; grid.innerHTML = ""; empty.hidden = false;
      empty.innerHTML = `<b>${t("Nothing free on that day.")}</b><span>${t("Try another day, or we'll tell you if a time opens up.")}</span><div class="slots"><button class="btn small ghost" type="button" id="waitlist-btn">${t("Tell me if a slot opens")}</button><span class="fine" id="waitlist-msg"></span></div>`;
      $("#waitlist-btn").addEventListener("click", async () => {
        if (!ME) { location.href = "account.html"; return; }
        try { const r = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ city: k, date, slot_pref: "any" }) }); $("#waitlist-msg").textContent = r.ok ? t("Done. We'll email you if a time opens on {date}.", { date }) : t("Couldn't save that. Try again."); } catch { $("#waitlist-msg").textContent = t("Couldn't save that. Try again."); }
      });
    }
  }
  $("#therapist-wrap").hidden = (TEAM[k] || []).length < 2 || SLOTMODE !== "slots";
  updateSummary();
}
$("#date").addEventListener("change", loadSlots); $("#therapist").addEventListener("change", loadSlots);
async function loadPackHint() {
  const k = city; const hint = $("#pack-hint"); hint.hidden = true;
  try { const r = await fetch("/api/packages?city=" + k); if (!(r.headers.get("content-type") || "").includes("json")) return; const { packages } = await r.json(); if (k !== city || !packages?.length) return;
    const best = packages[0]; hint.hidden = false; hint.innerHTML = t("Coming back regularly? A pack of {n} sessions is {price}, about {per} each.", { n: best.sessions, price: money(best.amount, best.currency.toUpperCase()), per: money(best.per_session, best.currency.toUpperCase()) }) + ` <a href="account.html#packages">${t("See packs")}</a>`; } catch {}
}
/* ---------- gift + partner codes ---------- */
let GIFT = null, PARTNER = null;
$("#gift-apply").addEventListener("click", applyGift);
$("#gift-code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyGift(); } });
async function applyGift() {
  const code = $("#gift-code").value.trim().toUpperCase(); const msg = $("#gift-msg"); GIFT = null; msg.textContent = "";
  if (!code) { updateSummary(); return; }
  try { const r = await fetch("/api/gift/" + encodeURIComponent(code)); const d = await r.json();
    if (!r.ok) { msg.textContent = d.error || t("We don't know that code."); }
    else if (city && d.gift.city !== city) { msg.textContent = t("That gift is for {city}.", { city: t(CITIES[d.gift.city].name) }); }
    else { GIFT = d.gift; PARTNER = null; $("#partner-msg").textContent = ""; $$("input[name=discount]").forEach(i => (i.checked = i.value === "")); msg.textContent = t("Gift code applied: {amount} off.", { amount: money(d.gift.amount, d.gift.currency.toUpperCase()) }); if (d.gift.service_id) { const svc = $("#svc-" + d.gift.service_id); if (svc) svc.checked = true; renderPrep(); } }
  } catch { msg.textContent = t("Couldn't check that code right now."); }
  updateSummary();
}
$("#partner-apply").addEventListener("click", applyPartner);
$("#partner-code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyPartner(); } });
async function applyPartner() {
  const code = $("#partner-code").value.trim().toUpperCase(); const msg = $("#partner-msg"); PARTNER = null; msg.textContent = "";
  if (!code) { updateSummary(); return; }
  try { const r = await fetch(`/api/partner/${encodeURIComponent(code)}?city=${city || ""}`); const d = await r.json();
    if (!r.ok) msg.textContent = d.error || t("We don't know that code.");
    else { PARTNER = d.partner; GIFT = null; $("#gift-msg").textContent = ""; $$("input[name=discount]").forEach(i => (i.checked = i.value === "")); msg.textContent = t("{name}: {pct}% off applied.", { name: d.partner.name, pct: d.partner.pct }); }
  } catch { msg.textContent = t("Couldn't check that code right now."); }
  updateSummary();
}
$("#credit-options").addEventListener("change", () => { if ($("input[name=discount]:checked")?.value) { GIFT = null; PARTNER = null; $("#gift-msg").textContent = ""; $("#partner-msg").textContent = ""; } });
// what's taking money off, in order of precedence: pack > gift > reward > partner
function discount(price) {
  const d = $("input[name=discount]:checked")?.value || "";
  if (d.startsWith("package:")) return { kind: "package", id: d.slice(8), off: price, label: t("Session pack") };
  if (GIFT) return { kind: "gift", code: GIFT.code, off: Math.min(price, GIFT.amount), label: t("Gift code") };
  if (d.startsWith("credit:")) { const pct = Number($("input[name=discount]:checked").dataset.pct); const off = Math.round(price * pct / 100); return { kind: "credit", id: d.slice(7), off, label: pct === 100 ? t("Free session reward") : t("Invite reward · {pct}% off", { pct }) }; }
  if (PARTNER) return { kind: "partner", code: PARTNER.code, off: Math.round(price * PARTNER.pct / 100), label: t("{name} · {pct}% off", { name: PARTNER.name, pct: PARTNER.pct }) };
  return null;
}
function renderPrep() {
  const cur = current(); if (!cur || !cur.s) return;
  const k = ZenGuide.serviceKey(cur.s.name);
  const items = [...ZenGuide.ADVICE.before.general.slice(0, 3), ...(ZenGuide.ADVICE.before[k] || []).slice(0, 2)];
  $("#prep-box").innerHTML = `<p class="fine"><b>${t("Before a {service} session", { service: t(ZenGuide.SERVICE_LABEL[k]).toLowerCase() })}</b></p><ul class="prep-list">${items.map((x) => `<li>${t(x)}</li>`).join("")}</ul><p class="fine">${t("Full guide, before and after, in")} <a href="account.html#guide">${t("your account")}</a>.</p>`;
}
// ?city=… from the account area preselects a room; ?date=, ?gift= come from emails
{ const q = new URLSearchParams(location.search); const pre = q.get("city");
  if (q.get("date") && /^\d{4}-\d{2}-\d{2}$/.test(q.get("date"))) $("#date").value = q.get("date");
  if (q.get("gift")) $("#gift-code").value = q.get("gift");
  if (pre && CITIES[pre]) setTimeout(() => { choose(pre, true); if (q.get("gift")) applyGift(); if (q.get("svc")) preselectService(q.get("svc")); }, 50); }
let SVC_PRE = null;
function preselectService(method) { SVC_PRE = method; const c = CITIES[city]; const hit = c?.services.find(s => methodOf(s.name) === method); if (hit) { const el = $("#svc-" + hit.id); if (el) { el.checked = true; updateSummary(); renderPrep(); } } }

// Cover art per service: a photo uploaded in the admin, otherwise a drawn glyph for the kind of treatment
const COVER_GLYPH = {
  cupping: `<svg viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 34c0-14 4-22 10-22s10 8 10 22z"/><line x1="10" y1="34" x2="34" y2="34"/></svg>`,
  sliding: `<svg viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 34c0-14 4-22 10-22s10 8 10 22z"/><path d="M28 22h8m-4-4 4 4-4 4"/><line x1="6" y1="34" x2="38" y2="34"/></svg>`,
  fire: `<svg viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 34c0-14 4-22 10-22s10 8 10 22z"/><path d="M22 12c-2-3-1-5 1-7 1 3 3 4 2 7"/><line x1="10" y1="34" x2="34" y2="34"/></svg>`,
  hijama: `<svg viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 34c0-14 4-22 10-22s10 8 10 22z"/><path d="M19 30v-6m6 6v-6"/><line x1="10" y1="34" x2="34" y2="34"/></svg>`,
  manual: `<svg viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 30c6-2 10-8 14-12s8-6 14-4"/><path d="M12 34c5-1 8-5 11-8"/><path d="M26 14l4 4"/></svg>`,
  facial: `<svg viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="22" cy="22" r="5"/><circle cx="12" cy="30" r="4"/><circle cx="32" cy="30" r="4"/><circle cx="22" cy="10" r="3"/></svg>`,
};
const methodOf = (name) => window.ZenMethods ? ZenMethods.methodOf(name) : "dry";
function coverKey(name) { const n = (name || "").toLowerCase(); if (n.includes("slid") || n.includes("glid") || n.includes("dynamic")) return "sliding"; const k = ZenGuide.serviceKey(name); return COVER_GLYPH[k] ? k : "cupping"; }
function renderServices() {
  const c = CITIES[city]; const kept = $("input[name=service]:checked")?.value?.split("-")[1];
  const keepIdx = Math.max(0, c.services.findIndex(s => s.id.split("-")[1] === kept)); // same session type when switching city
  $("#place-name").textContent = t(c.name);
  $("#place-addr").innerHTML = c.address.map((l, i) => i === 0 ? `<b>${esc(t(l))}</b>` : `<span>${esc(t(l))}</span>`).join("");
  $("#place-team").textContent = t(c.team);
  $("#services").innerHTML = c.services.map((s, i) => `
    <div class="service">
      <input type="radio" name="service" id="svc-${s.id}" value="${s.id}" ${i === keepIdx ? "checked" : ""}>
      <label for="svc-${s.id}">
        <span class="cover ${s.photo ? "" : "k-" + coverKey(s.name)}" aria-hidden="true">${s.photo ? `<img src="${esc(s.photo)}" alt="" loading="lazy">` : COVER_GLYPH[coverKey(s.name)]}</span>
        <span class="name">${esc(t(s.name))}</span>
        <span class="price num">${money(s.price, c.currency)}</span>
        <span class="desc">${esc(t(s.desc))}</span>
        <span class="dur">${s.dur} ${t("min")} · <a class="how" href="method.html?m=${methodOf(s.name)}">${t("How it works")}</a></span>
      </label>
    </div>`).join("");
  I.apply($("#book"));
}
function current() {
  if (!city) return null;
  const c = CITIES[city];
  const sid = $("input[name=service]:checked")?.value;
  return { c, s: c.services.find(x => x.id === sid) };
}
function updateSummary() {
  const cur = current(); if (!cur || !cur.s) return;
  const { c, s } = cur;
  const date = $("#date").value; const slot = $("input[name=slot]:checked")?.value || "";
  $("#sum-service").textContent = `${t(s.name)} · ${s.dur} ${t("min")} · ${t(c.name)}`;
  $("#sum-price").textContent = money(s.price, c.currency);
  const slotTxt = slot ? (SLOT_LABEL[slot] ? t(SLOT_LABEL[slot]) : slot) : t("no time picked");
  $("#sum-when").textContent = date ? new Date(date + "T12:00:00").toLocaleDateString(LOCALE(), { weekday: "long", day: "numeric", month: "long" }) + " · " + slotTxt : t("Pick a day");
  const dc = discount(s.price); const total = s.price - (dc ? dc.off : 0);
  $("#sum-discount-line").hidden = !dc; if (dc) { $("#sum-discount").textContent = dc.label; $("#sum-discount-amt").textContent = "− " + money(dc.off, c.currency); }
  const review = $("#flagged").checked || !$("#review-note").hidden;
  $("#sum-total").textContent = review ? t("Pay at the session") : total === 0 ? t("Nothing to pay") : money(total, c.currency);
  $("#pay").textContent = review ? t("Send for a therapist's OK") : total === 0 ? t("Reserve my free session") : t("Reserve and pay");
}
$("#booking").addEventListener("change", (e) => { updateSummary(); if (e.target.name === "service") renderPrep(); });
$("#flagged").addEventListener("change", updateSummary);
$("#booking").addEventListener("input", (e) => { if (e.target.id === "date") updateSummary(); });


$("#booking").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target; const err = $("#err"); err.hidden = true;
  if (!form.reportValidity()) return;
  const { c, s } = current();
  const slot = $("input[name=slot]:checked")?.value;
  if (!slot) { err.textContent = t("Pick a time first."); err.hidden = false; return; }
  const dc = discount(s.price);
  const payload = {
    city, service: s.id, date: $("#date").value, slot, therapist_id: $("#therapist").value || undefined,
    name: $("#name").value.trim(), phone: $("#phone").value.trim(), email: $("#email").value.trim(), note: $("#note").value.trim(),
    credit_id: dc?.kind === "credit" ? dc.id : undefined, package_id: dc?.kind === "package" ? dc.id : undefined, gift_code: dc?.kind === "gift" ? dc.code : undefined, partner_code: dc?.kind === "partner" ? dc.code : undefined,
    flagged: $("#flagged").checked || undefined
  };
  const btn = $("#pay"); btn.disabled = true; btn.textContent = t("One moment…");
  try {
    const r = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = (r.headers.get("content-type") || "").includes("json") ? await r.json().catch(() => ({})) : { preview: true };
    if (r.ok && data.url) { location.href = data.url; return; }
    if (r.status === 409 && data.slots) { loadSlots(); }
    if (data.preview) {
      tell(t("Payments aren't switched on yet"), t("This is the preview build. Once Zen's Stripe account is connected, this button takes you to a secure card page for {amount} and Zen Recovery gets your booking by email and WhatsApp.", { amount: money(s.price, c.currency) }));
    } else {
      err.textContent = data.error || t("Something went wrong creating the payment. Try again, or message Zen on WhatsApp.");
      err.hidden = false;
    }
  } catch (_) {
    tell(t("Preview only"), t("Nothing was charged. On the live site this takes you to a secure Stripe card page for {amount}, and Zen confirms the hour on WhatsApp.", { amount: money(s.price, c.currency) }));
  } finally {
    btn.disabled = false; updateSummary();
  }
});