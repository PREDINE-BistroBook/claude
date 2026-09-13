/* Zen Recovery — "Near you": every therapist is a provider with a pinned place; the client starts from where they are.
   /api/providers?lat&lng&q answers with everyone (active), distance in km when we know the client's position, nearest first,
   plus the nearest city. Position: browser geolocation (never sent anywhere but this API call) or a typed area/city.
   The position is kept in localStorage ("zen:loc") so booking and the team page can sort by distance too. */
(() => {
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const I = window.ZenI18n, t = I.t;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CITY = { cairo: "Cairo", dahab: "Dahab", florence: "Florence" };
const cityName = (k) => t(CITY[k] || k);
const LF = (th, k) => (I.lang !== "en" && th.i18n && th.i18n[I.lang] && th.i18n[I.lang][k]) || th[k] || "";
const money = (minor, cur) => { const v = minor / 100, c = (cur || "").toUpperCase(); return c === "EUR" ? `€${v.toLocaleString(I.lang === "ar" ? "ar-EG" : I.lang === "it" ? "it-IT" : "en-GB", { maximumFractionDigits: 0 })}` : `${c} ${v.toLocaleString(I.lang === "ar" ? "ar-EG" : "en-GB", { maximumFractionDigits: 0 })}`; };
const km = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)).toString();
let LOC = null, Q = "", CITYF = "", DATA = null, inflight = 0;
try { const s = JSON.parse(localStorage.getItem("zen:loc") || "null"); if (s && Number.isFinite(s.lat) && Number.isFinite(s.lng) && Date.now() - (s.at || 0) < 7 * 864e5) LOC = s; } catch (_) {}

async function load() {
  const my = ++inflight, qs = new URLSearchParams(); if (LOC) { qs.set("lat", LOC.lat); qs.set("lng", LOC.lng); } if (Q) qs.set("q", Q);
  $("#find-list").setAttribute("aria-busy", "true");
  try { const r = await fetch("/api/providers?" + qs); if (my !== inflight) return; DATA = (r.headers.get("content-type") || "").includes("json") ? await r.json() : { providers: [], cities: [] }; }
  catch (_) { if (my !== inflight) return; DATA = { providers: [], cities: [] }; }
  $("#find-list").removeAttribute("aria-busy"); render();
}
function status(msg, kind) { const s = $("#find-status"); s.textContent = msg || ""; s.className = "find-status" + (kind ? " " + kind : ""); s.hidden = !msg; }
function render() {
  const all = DATA?.providers || [], cities = Object.keys(CITY).filter((k) => all.some((p) => p.city === k) || (DATA?.cities || []).some((c) => c.city === k));
  $("#find-cities").innerHTML = cities.length > 1 ? [["", t("Everyone")], ...cities.map((k) => [k, cityName(k)])].map(([k, n]) => `<button type="button" class="chip ${k === CITYF ? "on" : ""}" data-city="${k}" aria-pressed="${k === CITYF}">${n}</button>`).join("") : "";
  $$("#find-cities .chip").forEach((c) => (c.onclick = () => { CITYF = c.dataset.city; render(); }));
  const list = all.filter((p) => !CITYF || p.city === CITYF);
  if (DATA?.located && DATA.nearest) status(t("Nearest city: {city}, {km} km", { city: cityName(DATA.nearest.city), km: DATA.nearest.km }), "ok");
  else if (!LOC && !Q) status(t("Showing everyone. Share your position or type an area to sort by distance."));
  else if (Q && !list.length) status(t('No one matches "{q}". Try a city name.', { q: Q }), "warn");
  else if (Q) status("");
  $("#find-list").innerHTML = list.length ? list.map(card).join("") : `<p class="lede">${t("No therapists listed yet.")}</p>`;
  if (window.Motion) window.Motion.scan();
}
function card(p) {
  const book = `booking.html?city=${encodeURIComponent(p.city)}&therapist=${encodeURIComponent(p.id)}`;
  const dist = p.km !== null && p.km !== undefined ? `<span class="find-km"><b>${t("{km} km away", { km: km(p.km) })}</b>${p.comes_to_you ? ` · ${t("Comes to you")}` : ""}</span>` : p.pinned ? "" : `<span class="find-km mute">${t("Not pinned on the map yet")}</span>`;
  const price = p.from ? `<span>${t("From {price}", { price: money(p.from, p.currency) })}${p.services ? ` · ${t("{n} sessions", { n: p.services })}` : ""}</span>` : "";
  return `<article class="find-card" data-city="${esc(p.city)}">
    <span class="ph">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" width="72" height="72">` : esc(p.name.slice(0, 1))}</span>
    <div class="find-body">
      <p class="eyebrow">${esc(LF(p, "title") || t("Therapist"))} · <i class="dot ${esc(p.city)}"></i>${cityName(p.city)}</p>
      <h2 dir="auto">${esc(p.name)}</h2>
      ${dist}
      <p class="find-meta">${LF(p, "area") ? `<span>${t("Works in {area}", { area: esc(LF(p, "area")) })}${p.maps_url ? ` · <a href="${esc(p.maps_url)}" target="_blank" rel="noopener">${t("Map")}</a>` : ""}</span>` : ""}${LF(p, "languages") ? `<span>${t("Speaks {langs}", { langs: esc(LF(p, "languages")) })}</span>` : ""}${price}</p>
      ${LF(p, "bio") ? `<p class="find-bio">${esc(LF(p, "bio"))}</p>` : ""}
      <div class="row"><a class="btn small" href="${book}">${t("Book with {name}", { name: esc(p.name.split(" ")[0]) })}</a><a class="plain" href="account.html?chat=${esc(p.id)}#messages">${t("Message")}</a><a class="plain" href="team.html#${esc(p.id)}">${t("Their story")}</a></div>
    </div></article>`;
}
/* ---------- position ---------- */
function locate() {
  if (!navigator.geolocation) { status(t("We couldn't get your position. Type where you are instead."), "warn"); return; }
  const b = $("#find-locate"); b.disabled = true; b.setAttribute("aria-busy", "true"); status(t("Finding you…"));
  navigator.geolocation.getCurrentPosition((pos) => {
    LOC = { lat: Math.round(pos.coords.latitude * 1e4) / 1e4, lng: Math.round(pos.coords.longitude * 1e4) / 1e4, at: Date.now() }; // ~10 m, enough to sort by distance
    try { localStorage.setItem("zen:loc", JSON.stringify(LOC)); } catch (_) {}
    b.disabled = false; b.removeAttribute("aria-busy"); b.classList.add("on"); load();
  }, () => { b.disabled = false; b.removeAttribute("aria-busy"); status(t("We couldn't get your position. Type where you are instead."), "warn"); $("#find-q").focus(); }, { enableHighAccuracy: false, timeout: 9000, maximumAge: 600000 });
}
$("#find-locate").addEventListener("click", locate);
if (LOC) $("#find-locate").classList.add("on");
let tq; $("#find-q").addEventListener("input", () => { clearTimeout(tq); tq = setTimeout(() => { Q = $("#find-q").value.trim(); load(); }, 250); });
$("#find-form").addEventListener("submit", (e) => { e.preventDefault(); Q = $("#find-q").value.trim(); load(); });
const q0 = new URLSearchParams(location.search).get("q"); if (q0) { $("#find-q").value = q0; Q = q0; }
document.addEventListener("zen:lang", render);
load();
})();
