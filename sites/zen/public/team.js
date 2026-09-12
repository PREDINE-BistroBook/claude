/* Team page: everyone from /api/team. People with a story get a large card first; the rest are grouped by city. */
const paras = (s) => String(s || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
const lines = (s) => String(s || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
const cityName = (k) => t((CITIES[k] || {}).name || k);
function card(th, big) {
  const book = `booking.html?city=${encodeURIComponent(th.city)}&therapist=${encodeURIComponent(th.id)}`;
  const photo = th.photo ? `<img src="${esc(th.photo)}" alt="${esc(th.name)}" loading="lazy">` : `<span class="ph-init">${esc(th.name.slice(0, 1))}</span>`;
  const where = th.area ? `<p class="tm-where">${t("Works in {area}", { area: esc(th.area) })}${th.maps_url ? ` · <a href="${esc(th.maps_url)}" target="_blank" rel="noopener">${t("Map")}</a>` : ""}</p>` : "";
  const meta = [`<span class="tm-city"><i class="dot ${esc(th.city)}"></i>${cityName(th.city)}</span>`, th.languages ? `<span>${t("Speaks {langs}", { langs: esc(th.languages) })}</span>` : ""].filter(Boolean).join("");
  if (!big) return `<article class="tm-card"><div class="tm-photo">${photo}</div><div class="tm-body"><h3>${esc(th.name)}</h3>${th.title ? `<p class="tm-title">${esc(th.title)}</p>` : ""}<p class="tm-meta">${meta}</p>${th.bio ? `<p class="tm-bio">${esc(th.bio)}</p>` : ""}${where}<div class="tm-actions"><a class="btn small" href="${book}">${t("Book with {name}", { name: esc(th.name.split(" ")[0]) })}</a>${th.instagram ? `<a class="btn small ghost" href="https://instagram.com/${esc(th.instagram)}" target="_blank" rel="noopener">@${esc(th.instagram)}</a>` : ""}</div></div></article>`;
  return `<article class="tm-feature reveal"><div class="tm-photo lg">${photo}</div><div class="tm-body">
    <p class="eyebrow">${esc(th.title || t("Therapist"))}</p><h2>${esc(th.name)}</h2><p class="tm-meta">${meta}</p>
    ${paras(th.story).map((p) => `<p class="tm-story">${esc(p)}</p>`).join("")}
    ${th.certs ? `<h3 class="tm-h">${t("Certifications")}</h3><ul class="tm-certs">${lines(th.certs).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    ${where}
    <div class="tm-actions"><a class="btn" href="${book}">${t("Book with {name}", { name: esc(th.name.split(" ")[0]) })}</a>${th.instagram ? `<a class="btn ghost" href="https://instagram.com/${esc(th.instagram)}" target="_blank" rel="noopener">${t("Follow on Instagram")} · @${esc(th.instagram)}</a>` : ""}</div>
  </div></article>`;
}
let LIST = [];
function render() {
  const featured = LIST.filter((th) => th.story), rest = LIST.filter((th) => !th.story);
  $("#team-featured").innerHTML = featured.map((th) => card(th, true)).join("");
  const keys = Object.keys(CITIES).filter((k) => rest.some((th) => th.city === k));
  $("#team-cities").innerHTML = keys.length ? keys.map((k) => `<div class="tm-city-block"><h2 class="tm-h2">${t("In {city}", { city: cityName(k) })}</h2><div class="tm-grid">${rest.filter((th) => th.city === k).map((th) => card(th, false)).join("")}</div></div>`).join("") : featured.length ? "" : `<p class="lede">${t("No therapists listed yet.")}</p>`;
  document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
}
(async () => {
  try { const r = await fetch("/api/team"); LIST = (r.headers.get("content-type") || "").includes("json") ? (await r.json()).therapists || [] : []; } catch { LIST = []; }
  render();
})();
Zen.on("lang", render);
