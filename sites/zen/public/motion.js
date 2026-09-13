/* Zen Recovery — the motion layer shared by every public page.
   Needs GSAP + ScrollTrigger (loaded by the page). Without them, or with "reduce motion" on, nothing here runs and the page is simply static.
   What it does: a short curtain when a page opens and when you leave through a link; the nav slides in; every heading, paragraph,
   card, list item and image rises into place as it scrolls into view (headings word by word); photos drift a little (parallax);
   buttons lean toward the pointer; numbers count up; a soft blue aura follows the pointer on desktop; marquees roll. */
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const html = document.documentElement;
  if (!window.gsap || !window.ScrollTrigger || reduced) return;
  gsap.registerPlugin(ScrollTrigger);
  html.classList.add("motion");
  const RTL = () => html.dir === "rtl";
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- curtain: in on load, out on internal links ---------- */
  const veil = document.createElement("div"); veil.className = "mveil"; veil.setAttribute("aria-hidden", "true");
  veil.innerHTML = `<div class="mveil-p"></div><div class="mveil-p"></div><img src="img/logo-round.png" alt="" width="64" height="64">`;
  document.body.prepend(veil);
  const panels = $$(".mveil-p", veil), mark = veil.querySelector("img");
  const open = () => gsap.timeline({ onComplete: () => veil.remove() })
    .to(mark, { opacity: 0, scale: .7, duration: .35, ease: "power2.in" }, 0)
    .to(panels[0], { yPercent: -101, duration: .7, ease: "power4.inOut" }, .1)
    .to(panels[1], { yPercent: 101, duration: .7, ease: "power4.inOut" }, .1);
  gsap.set(mark, { scale: .6, opacity: 0 });
  gsap.timeline().to(mark, { scale: 1, opacity: 1, duration: .45, ease: "back.out(2)" }).add(open, "+=.15");
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]"); if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank" || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href); if (url.origin !== location.origin || (url.pathname === location.pathname && url.hash)) return;
    if (!/\.html$|\/[a-z-]*$/.test(url.pathname)) return;
    e.preventDefault();
    const v = document.createElement("div"); v.className = "mveil out"; v.innerHTML = `<div class="mveil-p"></div><div class="mveil-p"></div>`; document.body.append(v);
    const ps = $$(".mveil-p", v); gsap.set(ps[0], { yPercent: -101 }); gsap.set(ps[1], { yPercent: 101 });
    gsap.timeline({ onComplete: () => { location.href = url.href; } }).to(ps, { yPercent: 0, duration: .5, ease: "power4.inOut" });
  });
  addEventListener("pageshow", (e) => { if (e.persisted) $$(".mveil.out").forEach((v) => v.remove()); });

  /* ---------- nav ---------- */
  const nav = document.querySelector(".nav, .top");
  if (nav) { gsap.from(nav, { y: -24, opacity: 0, duration: .8, ease: "power3.out", delay: .5 }); ScrollTrigger.create({ start: 40, onUpdate: (s) => nav.classList.toggle("scrolled", s.scroll() > 40) }); }

  /* ---------- reveals ---------- */
  const words = (el) => { if (el.dataset.split) return; el.dataset.split = "1"; const walk = (n) => { [...n.childNodes].forEach((c) => { if (c.nodeType === 3 && c.textContent.trim()) { const f = document.createDocumentFragment(); c.textContent.split(/(\s+)/).forEach((w) => { if (!w) return; if (/^\s+$/.test(w)) f.append(document.createTextNode(w)); else { const s = document.createElement("span"); s.className = "w"; s.innerHTML = `<span>${w.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]))}</span>`; f.append(s); } }); c.replaceWith(f); } else if (c.nodeType === 1 && !c.classList.contains("w")) walk(c); }); }; walk(el); };
  const HEAD = "h1, h2", ITEMS = "p, li, .card, .btn, dt, dd, .method, .therapist, .svc, .step, .kpi, .reward, .place, .tm-feature, .field, .row, blockquote, figure, table, img, svg.cupfig, .links-grid a, .hero-visual, details";
  const seen = new WeakSet();
  function scan(root = document) {
    let found = 0;
    // headings: word by word; everything else: rise in, staggered per section
    $$(`main ${HEAD}, .page-head ${HEAD}`, root).forEach((h) => { if (seen.has(h) || h.closest(".tm-feature, .team-hero, .no-motion, [hidden]")) return; seen.add(h); found++; words(h); const ws = $$(".w > span", h); gsap.set(ws, { yPercent: 110, rotate: 3 }); ScrollTrigger.create({ trigger: h, start: "top 88%", once: true, onEnter: () => gsap.to(ws, { yPercent: 0, rotate: 0, duration: .9, ease: "power4.out", stagger: .05 }) }); });
    const groups = new Map();
    $$(`main ${ITEMS}`, root).forEach((el) => {
      if (seen.has(el) || el.closest(".tm-feature, .team-hero, .no-motion, #steps, dialog, .mveil, .nav, .top, [hidden]") || el.closest(ITEMS) !== el && el.parentElement?.closest(ITEMS)) return;
      if (el.matches("p, li") && el.closest(".card, .method, .svc, .step, .place, .kpi, .reward, details, .links-grid a, .therapist")) return;   // the container animates, not each line inside it
      const rv = el.closest(".reveal"); if (rv && (rv === el || rv.matches(ITEMS))) return;   // the site's own CSS reveal already does this one (its transition would fight the tween); items inside a .reveal section wrapper still animate
      seen.add(el); found++; el.classList.add("rv");
      const key = el.closest("section, .card, main") || document.body; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(el);
    });
    groups.forEach((els) => { gsap.set(els, { opacity: 0, y: 26 }); ScrollTrigger.batch(els, { start: "top 90%", once: true, onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: .9, ease: "power3.out", stagger: .07, overwrite: true }) }); });
    // photos drift while they cross the screen
    $$("main img", root).forEach((img) => { if (img.dataset.par || img.closest(".tm-photo, .therapist, .nav, .top, .mveil, .logo, #steps") || img.width < 120) return; img.dataset.par = "1"; found++; const wrap = img.parentElement; if (getComputedStyle(wrap).overflow === "visible") wrap.style.overflow = "hidden"; gsap.fromTo(img, { yPercent: -5, scale: 1.08 }, { yPercent: 5, scale: 1.08, ease: "none", scrollTrigger: { trigger: wrap, start: "top bottom", end: "bottom top", scrub: true } }); });
    // numbers count up
    $$("[data-count]", root).forEach((el) => { if (el.dataset.counted) return; el.dataset.counted = "1"; found++; const to = Number(el.dataset.count), o = { v: 0 }; ScrollTrigger.create({ trigger: el, start: "top 90%", once: true, onEnter: () => gsap.to(o, { v: to, duration: 1.4, ease: "power2.out", onUpdate: () => { el.textContent = Math.round(o.v).toLocaleString(); } }) }); });
    if (found) ScrollTrigger.refresh();   // only when something new was tagged: a refresh cancels any smooth scroll in progress (anchor links, the cup story)
    return found;
  }
  scan();
  // safety net: anything tagged but still invisible while on screen (shown later by the page, so its trigger never fired) fades in
  setInterval(() => { const late = $$("main .rv").filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < innerHeight && r.bottom > 0 && gsap.getProperty(e, "opacity") < .05 && !gsap.isTweening(e); }); if (late.length) gsap.to(late, { opacity: 1, y: 0, duration: .7, ease: "power3.out", stagger: .05, overwrite: true }); }, 500);
  // pages render cards later (catalog, team, language switch): pick them up
  // (only real new elements count: text updates, the curtain and the aura are ignored, so a rescan never interrupts scrolling)
  let t; new MutationObserver((muts) => {
    const real = muts.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && !n.closest(".mveil, .aura") && !n.classList.contains("w")));
    if (!real) return; clearTimeout(t); t = setTimeout(() => scan(), 80);
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("zen:lang", () => setTimeout(scan, 120));

  /* ---------- buttons lean toward the pointer ---------- */
  if (matchMedia("(pointer: fine)").matches) {
    document.addEventListener("pointermove", (e) => { const b = e.target.closest(".btn"); if (!b || b.dataset.noMag) return; const r = b.getBoundingClientRect(); gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * .18, y: (e.clientY - r.top - r.height / 2) * .3, duration: .4, ease: "power2.out" }); });
    document.addEventListener("pointerout", (e) => { const b = e.target.closest(".btn"); if (b) gsap.to(b, { x: 0, y: 0, duration: .7, ease: "elastic.out(1, .5)" }); });
    // a soft aura that follows the pointer
    const aura = document.createElement("div"); aura.className = "aura"; aura.setAttribute("aria-hidden", "true"); document.body.append(aura);
    const ax = gsap.quickTo(aura, "x", { duration: .9, ease: "power3" }), ay = gsap.quickTo(aura, "y", { duration: .9, ease: "power3" });
    addEventListener("pointermove", (e) => { ax(e.clientX); ay(e.clientY); aura.style.opacity = 1; }, { passive: true });
    document.addEventListener("pointerleave", () => { aura.style.opacity = 0; });
  }

  /* ---------- marquees ---------- */
  $$(".marquee").forEach((m) => { const track = m.querySelector(".track"); if (!track) return; track.innerHTML += track.innerHTML; const w = track.scrollWidth / 2; gsap.to(track, { x: RTL() ? w : -w, duration: Math.max(18, w / 60), ease: "none", repeat: -1 }); });

  /* ---------- floating cups behind the hero ---------- */
  $$(".float").forEach((f, i) => { gsap.to(f, { y: () => 14 + i * 6, x: () => (i % 2 ? -1 : 1) * (8 + i * 3), rotate: i % 2 ? 6 : -6, duration: 4 + i, ease: "sine.inOut", yoyo: true, repeat: -1 }); });
  window.Motion = { scan };
})();
