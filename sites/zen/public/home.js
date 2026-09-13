/* Zen Recovery — home page: the scroll-driven cupping illustration (needs GSAP + ScrollTrigger; static otherwise) */
/* ---------- scroll-driven cup ---------- */
(function cup() {
  const steps = $$(".step");
  if (!window.gsap || !window.ScrollTrigger) return; // no library: steps stay fully visible, illustration static
  gsap.registerPlugin(ScrollTrigger);
  document.documentElement.classList.add("has-gsap");
  steps[0].classList.add("active");

  // which text step is in view
  steps.forEach(st => ScrollTrigger.create({
    trigger: st, start: "top 60%", end: "bottom 40%",
    onToggle: self => { if (self.isActive) { steps.forEach(s => s.classList.remove("active")); st.classList.add("active"); } }
  }));

  if (reduced) { // static frame: cup on, skin lifted a little, blood at the surface
    gsap.set("#cup", { y: 0 }); gsap.set("#dome", { attr: { cy: 452, ry: 96 } }); gsap.set("#bloom", { opacity: .75, attr: { cy: 452, ry: 96 } }); gsap.set("#blood circle", { opacity: .85, y: -46 }); return;
  }

  const tl = gsap.timeline({
    scrollTrigger: { trigger: "#steps", start: "top 70%", end: "bottom 70%", scrub: 1.2 },
    defaults: { ease: "none" }
  });
  // step 1: cup lands (0 → 1)
  tl.to("#cup", { y: 0, duration: 1, ease: "power2.out" }, 0);
  // step 2: vacuum + arrows (1 → 2)
  tl.to("#vac", { opacity: .28, duration: .6 }, 1.1);
  tl.to("#arrows", { opacity: 1, duration: .4 }, 1.2);
  tl.fromTo("#arrows", { y: 18 }, { y: -10, duration: .8 }, 1.2);
  tl.to("#arrows", { opacity: 0, duration: .4 }, 2.1);
  // step 3: the skin lifts a little (a few millimetres, not a mound) and blood comes up out of the tissue (2 → 3)
  tl.to("#dome", { attr: { cy: 452, ry: 96 }, duration: 1, ease: "power1.inOut" }, 2);
  tl.to("#bloom", { attr: { cy: 452, ry: 96 }, opacity: .75, duration: 1, ease: "power1.inOut" }, 2);
  tl.to("#blood circle", { y: -46, opacity: .92, duration: .9, ease: "power1.out", stagger: .07 }, 2.2);
  tl.to("#vac", { opacity: .12, duration: 1 }, 2);
  // step 4: timer (3 → 4)
  tl.to("#timer", { opacity: 1, duration: .3 }, 3);
  tl.to("#timerArc", { strokeDashoffset: 0, duration: 1, onUpdate() { const p = this.progress(); $("#timerText").textContent = Math.round(5 + p * 10) + "′"; } }, 3.1);
  // step 5: the cup lifts and takes the blood with it; the skin settles back flat; the marks remain and fade (4 → 5)
  tl.to("#timer", { opacity: 0, duration: .3 }, 4);
  tl.to("#dome", { attr: { cy: 470, ry: 90 }, duration: .7, ease: "power2.out" }, 4);
  tl.to("#bloom", { attr: { cy: 470, ry: 90 }, opacity: 0, duration: .7 }, 4);
  tl.to("#blood circle", { y: -190, opacity: 0, duration: .9, ease: "power2.in", stagger: .04 }, 4);
  tl.to("#cup", { y: -160, opacity: 0, duration: .9, ease: "power2.in" }, 4.1);
  tl.to("#marks", { opacity: 1, duration: .3 }, 4.4);
  tl.fromTo("#marks circle", { attr: { r: 30 }, opacity: .6 }, { attr: { r: 26 }, opacity: .18, duration: .9, stagger: .05 }, 4.5);
  tl.to({}, { duration: .4 }, 5.4);
})();

/* ---------- what clients say: real, owner-picked ratings ---------- */
(async function reviews() {
  const sec = document.getElementById("reviews"), row = document.getElementById("reviews-row"); if (!sec) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const I = window.ZenI18n, t = I ? I.t : (s) => s, CITY = { cairo: "Cairo", dahab: "Dahab", florence: "Florence" };
  let list = []; try { const r = await fetch("/api/reviews"); if ((r.headers.get("content-type") || "").includes("json")) list = (await r.json()).reviews || []; } catch (_) {}
  if (!list.length) return;
  row.innerHTML = list.map((v) => `<figure class="review" role="listitem" dir="auto"><div class="stars" aria-label="${v.rating} / 5">${"★".repeat(v.rating)}<span>${"☆".repeat(5 - v.rating)}</span></div><blockquote>${esc(v.text)}</blockquote><figcaption>${esc(v.first)} · ${t(CITY[v.city] || v.city)} · ${esc(t(v.service))}</figcaption></figure>`).join("");
  sec.hidden = false; if (window.Motion) window.Motion.scan();
})();
