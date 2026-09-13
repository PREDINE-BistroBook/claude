/* Team page. Everyone gets a full card: the founder first, then the order the owner set (Team → "Order on the site"),
   then by name. GSAP + ScrollTrigger animate the hero words, each photo (curtain reveal + slow parallax), the name,
   the story paragraphs and the certificate list as they scroll in. Without GSAP or with reduced motion, everything is simply visible. */
const paras = (s) => String(s || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
const lines = (s) => String(s || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
const cityName = (k) => t((CITIES[k] || {}).name || k);
const words = (s) => String(s).split(/\s+/).filter(Boolean).map((w) => `<span class="w"><span>${esc(w)}</span></span>`).join(" ");
const RTL = () => document.documentElement.dir === "rtl";
// A profile field in the language the visitor is reading (Italian / Arabic from the translated copy), else the original.
const LF = (th, k) => (I.lang !== "en" && th.i18n && th.i18n[I.lang] && th.i18n[I.lang][k]) || th[k] || "";
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
let LIST = [], cityFilter = "";

const rank = (th) => (/founder|fondat|مؤسس/i.test(th.title || "") ? -1 : 0);
const order = (list) => list.slice().sort((a, b) => rank(a) - rank(b) || (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));

let LOC = null; try { const s = JSON.parse(localStorage.getItem("zen:loc") || "null"); if (s && Number.isFinite(s.lat) && Number.isFinite(s.lng)) LOC = s; } catch (_) {}
const kmOf = (th) => (LOC && Number.isFinite(th.lat) && Number.isFinite(th.lng)) ? (() => { const R = 6371, toR = (x) => (x * Math.PI) / 180, dLat = toR(th.lat - LOC.lat), dLng = toR(th.lng - LOC.lng), h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(LOC.lat)) * Math.cos(toR(th.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); })() : null;
function card(th, i) {
  const book = `booking.html?city=${encodeURIComponent(th.city)}&therapist=${encodeURIComponent(th.id)}`;
  const first = th.name.split(" ")[0];
  const photo = th.photo ? `<img src="${esc(th.photo)}" alt="${esc(th.name)}" loading="${i < 2 ? "eager" : "lazy"}">` : `<span class="ph-init">${esc(th.name.slice(0, 1))}</span>`;
  const text = paras(LF(th, "story")).length ? paras(LF(th, "story")) : LF(th, "bio") ? [LF(th, "bio")] : [];
  return `<article class="tm-feature ${i % 2 ? "flip" : ""}" data-city="${esc(th.city)}" data-id="${esc(th.id)}">
    <div class="tm-photo"><div class="tm-photo-in">${photo}</div><span class="tm-num">${String(i + 1).padStart(2, "0")}</span><span class="tm-citytag"><i class="dot ${esc(th.city)}"></i>${cityName(th.city)}</span></div>
    <div class="tm-body">
      <p class="eyebrow tm-role">${esc(LF(th, "title") || t("Therapist"))}</p>
      <h2 class="tm-name" dir="auto">${words(th.name)}</h2>
      <svg class="tm-line" viewBox="0 0 160 14" aria-hidden="true"><path d="M2 9 C 30 2, 60 13, 90 7 S 140 3, 158 8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      ${kmOf(th) !== null ? `<p class="tm-km"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>${t("{km} km from you", { km: kmOf(th) < 10 ? kmOf(th).toFixed(1) : Math.round(kmOf(th)) })}</p>` : ""}
      <p class="tm-meta">${LF(th, "languages") ? `<span>${t("Speaks {langs}", { langs: esc(LF(th, "languages")) })}</span>` : ""}${LF(th, "area") ? `<span>${t("Works in {area}", { area: esc(LF(th, "area")) })}${th.maps_url ? ` · <a href="${esc(th.maps_url)}" target="_blank" rel="noopener">${t("Map")}</a>` : ""}</span>` : ""}</p>
      <div class="tm-text">${text.map((p) => `<p class="tm-story">${esc(p)}</p>`).join("")}</div>
      ${LF(th, "certs") ? `<h3 class="tm-h">${t("Certifications")}</h3><ul class="tm-certs">${lines(LF(th, "certs")).map((c) => `<li><i></i><span>${esc(c)}</span></li>`).join("")}</ul>` : ""}
      <div class="tm-actions"><a class="btn" href="${book}">${t("Book with {name}", { name: esc(first) })}</a>${th.instagram ? `<a class="btn ghost" href="https://instagram.com/${esc(th.instagram)}" target="_blank" rel="noopener">${t("Follow on Instagram")} · @${esc(th.instagram)}</a>` : ""}</div>
    </div>
  </article>`;
}

function render() {
  const all = order(LIST), keys = Object.keys(CITIES).filter((k) => all.some((th) => th.city === k));
  $("#team-filter").innerHTML = keys.length > 1 ? [["", t("Everyone")], ...keys.map((k) => [k, cityName(k)])].map(([k, n]) => `<button type="button" class="chip ${k === cityFilter ? "on" : ""}" data-city="${k}" aria-pressed="${k === cityFilter}">${n}</button>`).join("") : "";
  $$("#team-filter .chip").forEach((c) => (c.onclick = () => { cityFilter = c.dataset.city; render(); }));
  const shown = all.filter((th) => !cityFilter || th.city === cityFilter);
  $("#team-list").innerHTML = shown.length ? shown.map(card).join("") : `<p class="lede">${t("No therapists listed yet.")}</p>`;
  $("#team-title").innerHTML = words(t("The people behind Zen Recovery."));
  animate();
}

/* ---------- motion ---------- */
let triggers = [];
function animate() {
  triggers.forEach((s) => s.kill()); triggers = [];
  if (!window.gsap || !window.ScrollTrigger || REDUCED) { document.documentElement.classList.remove("tm-anim"); return; }
  gsap.registerPlugin(ScrollTrigger); document.documentElement.classList.add("tm-anim");
  const dir = RTL() ? -1 : 1;
  // hero: words rise one by one, lede and filter follow
  gsap.fromTo(".tm-h1 .w > span", { yPercent: 110, rotate: 4 }, { yPercent: 0, rotate: 0, duration: 1.1, ease: "power4.out", stagger: 0.07, overwrite: true });
  gsap.fromTo([".tm-eyebrow", ".tm-lede", ".tm-filter"], { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .9, ease: "power3.out", stagger: .12, delay: .25, overwrite: true });
  $$(".tm-feature").forEach((card, i) => {
    const photo = card.querySelector(".tm-photo"), img = card.querySelector(".tm-photo-in"), flip = card.classList.contains("flip");
    const from = (flip ? -1 : 1) * dir;   // curtain opens from the side the photo sits on
    gsap.set(photo, { clipPath: from > 0 ? "inset(0 100% 0 0 round 24px)" : "inset(0 0 0 100% round 24px)" });
    gsap.set(img, { scale: 1.18, xPercent: from * 6 });
    gsap.set([card.querySelector(".tm-role"), card.querySelector(".tm-meta"), ...card.querySelectorAll(".tm-story"), card.querySelector(".tm-h"), ...card.querySelectorAll(".tm-certs li"), card.querySelector(".tm-actions"), card.querySelector(".tm-num"), card.querySelector(".tm-citytag")].filter(Boolean), { opacity: 0, y: 18 });
    gsap.set(card.querySelectorAll(".tm-name .w > span"), { yPercent: 110 });
    const line = card.querySelector(".tm-line path"), len = line.getTotalLength(); gsap.set(line, { strokeDasharray: len, strokeDashoffset: len });
    const tl = gsap.timeline({ scrollTrigger: { trigger: card, start: "top 78%", once: true } });
    tl.to(photo, { clipPath: "inset(0 0% 0 0% round 24px)", duration: 1.2, ease: "power4.inOut" }, 0)
      .to(img, { scale: 1, xPercent: 0, duration: 1.6, ease: "power3.out" }, 0)
      .to([card.querySelector(".tm-num"), card.querySelector(".tm-citytag")], { opacity: 1, y: 0, duration: .6, stagger: .1 }, .7)
      .to(card.querySelector(".tm-role"), { opacity: 1, y: 0, duration: .6 }, .3)
      .to(card.querySelectorAll(".tm-name .w > span"), { yPercent: 0, duration: .9, ease: "power4.out", stagger: .08 }, .4)
      .to(line, { strokeDashoffset: 0, duration: .9, ease: "power2.inOut" }, .9)
      .to(card.querySelector(".tm-meta"), { opacity: 1, y: 0, duration: .6 }, .8)
      .to(card.querySelectorAll(".tm-story"), { opacity: 1, y: 0, duration: .8, ease: "power3.out", stagger: .16 }, .9)
      .to(card.querySelector(".tm-h"), { opacity: 1, y: 0, duration: .5 }, 1.2)
      .to(card.querySelectorAll(".tm-certs li"), { opacity: 1, y: 0, duration: .55, ease: "back.out(1.6)", stagger: .1 }, 1.3)
      .to(card.querySelector(".tm-actions"), { opacity: 1, y: 0, duration: .6 }, 1.5);
    triggers.push(tl.scrollTrigger);
    // slow parallax while the card crosses the screen
    const par = gsap.fromTo(img.querySelector("img") || img, { yPercent: -6 }, { yPercent: 6, ease: "none", scrollTrigger: { trigger: card, start: "top bottom", end: "bottom top", scrub: true } });
    triggers.push(par.scrollTrigger);
    // a little life on hover: the photo leans toward the pointer
    photo.addEventListener("pointermove", (e) => { const r = photo.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; gsap.to(photo, { rotateY: x * 8, rotateX: -y * 8, transformPerspective: 900, duration: .5, ease: "power2.out" }); });
    photo.addEventListener("pointerleave", () => gsap.to(photo, { rotateY: 0, rotateX: 0, duration: .8, ease: "power3.out" }));
  });
  ScrollTrigger.refresh();
}

(async () => {
  try { const r = await fetch("/api/team"); LIST = (r.headers.get("content-type") || "").includes("json") ? (await r.json()).therapists || [] : []; } catch { LIST = []; }
  render();
})();
Zen.on("lang", render);
