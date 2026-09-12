/* Zen Recovery — one scroll-driven explainer per method (method.html?m=dry|sliding|fire|hijama|manual|facial).
   Each method has: copy (title, tagline, lead, who it's for, five steps), an SVG scene, a GSAP timeline that
   runs from 0 to 5 (one unit per step, scrubbed by scroll) and a `still` frame for reduced motion.
   Text is English; i18n.js translates it on the page. */
window.ZenMethods = (function () {
  const DEFS = `<defs>
    <linearGradient id="skinG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9D6C5"/><stop offset="1" stop-color="#D5BBA6"/></linearGradient>
    <radialGradient id="bloomG" cx=".5" cy=".9" r=".7"><stop offset="0" stop-color="#B8433A" stop-opacity=".95"/><stop offset=".55" stop-color="#D98079" stop-opacity=".55"/><stop offset="1" stop-color="#D98079" stop-opacity="0"/></radialGradient>
    <radialGradient id="warmG" cx=".5" cy=".9" r=".7"><stop offset="0" stop-color="#E2703A" stop-opacity=".85"/><stop offset=".6" stop-color="#E8A07A" stop-opacity=".4"/><stop offset="1" stop-color="#E8A07A" stop-opacity="0"/></radialGradient>
    <linearGradient id="glassG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity=".25"/></linearGradient>
    <linearGradient id="oilG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="trailG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E08A7A" stop-opacity="0"/><stop offset=".5" stop-color="#D4614F" stop-opacity=".75"/><stop offset="1" stop-color="#E08A7A" stop-opacity="0"/></linearGradient>
    <clipPath id="cupClip"><path d="M150 380 C150 250 190 175 260 175 C330 175 370 250 370 380 Z"/></clipPath>
    <clipPath id="skinClip"><rect x="20" y="380" width="480" height="120" rx="28"/></clipPath>
  </defs>`;
  const SKIN = `<rect id="skin" x="20" y="380" width="480" height="120" rx="28" fill="url(#skinG)"/>`;
  const MARKS = `<g id="marks" opacity="0"><circle cx="110" cy="420" r="30" fill="#8E2F3A" opacity=".55"/><circle cx="410" cy="420" r="30" fill="#8E2F3A" opacity=".55"/></g>`;
  const TIMER = `<g id="timer" opacity="0" transform="translate(440,110)"><circle r="34" fill="none" stroke="#E7EDE8" stroke-opacity=".25" stroke-width="2"/><circle id="timerArc" r="34" fill="none" stroke="#8FB8F5" stroke-width="3" stroke-linecap="round" stroke-dasharray="213.6" stroke-dashoffset="213.6" transform="rotate(-90)"/><text id="timerText" y="6" text-anchor="middle" font-family="DM Mono, monospace" font-size="15" fill="#E7EDE8">5′</text></g>`;
  // the cup, with the skin bulge, blood droplets and vacuum haze inside; `extra` goes inside the glass before the body
  const CUP = (extra = "", warm = false) => `<g id="cup" transform="translate(0,-140)">
      <g clip-path="url(#cupClip)">
        <ellipse id="dome" cx="260" cy="470" rx="112" ry="90" fill="url(#skinG)"/>
        <ellipse id="bloom" cx="260" cy="470" rx="112" ry="90" fill="url(#${warm ? "warmG" : "bloomG"})" opacity="0"/>
        <g id="blood" fill="#9E2A2B"><circle cx="220" cy="404" r="6.5" opacity="0"/><circle cx="246" cy="411" r="8" opacity="0"/><circle cx="271" cy="402" r="7" opacity="0"/><circle cx="298" cy="409" r="7.5" opacity="0"/><circle cx="234" cy="420" r="5.5" opacity="0"/><circle cx="286" cy="421" r="6" opacity="0"/><circle cx="260" cy="425" r="9" opacity="0"/></g>
        ${extra}
      </g>
      <path id="vac" d="M150 380 C150 250 190 175 260 175 C330 175 370 250 370 380 Z" fill="#2F7BEA" opacity="0"/>
      <g id="arrows" opacity="0" stroke="#E7EDE8" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M260 330 V270 M248 282 L260 270 L272 282"/><path d="M215 345 V300 M205 310 L215 300 L225 310" opacity=".6"/><path d="M305 345 V300 M295 310 L305 300 L315 310" opacity=".6"/></g>
      <path d="M150 380 C150 250 190 175 260 175 C330 175 370 250 370 380 Z" fill="url(#glassG)" stroke="#E7EDE8" stroke-opacity=".85" stroke-width="2"/>
      <rect x="140" y="374" width="240" height="12" rx="6" fill="#E7EDE8" opacity=".9"/>
      <path d="M188 330 C186 270 205 215 240 197" stroke="#fff" stroke-opacity=".7" stroke-width="5" stroke-linecap="round" fill="none"/>
    </g>`;
  const scene = (inner) => `<svg viewBox="0 0 520 520" xmlns="http://www.w3.org/2000/svg" id="cupfig">${DEFS}${inner}</svg>`;
  const timerTick = (tl, at, dur) => tl.to("#timerArc", { strokeDashoffset: 0, duration: dur, onUpdate() { const p = this.progress(); const t = document.getElementById("timerText"); if (t) t.textContent = Math.round(5 + p * 10) + "′"; } }, at);

  const METHODS = {
    dry: {
      key: "cupping", title: "Dry cupping", tagline: "Cups placed and left still.", minutes: "45 min",
      lead: "The classic session, and the one to start with if you've never tried cupping. Nothing moves once the cups are on. You lie still, the cups do the lifting.",
      forWho: "Tight back, stiff shoulders, a first visit.",
      steps: [
        { h: "The cup rests on the skin.", p: "Glass or soft silicone, warmed in the hand first. Your therapist chooses the spot: the length of a tight back, the top of a shoulder, the outside of a thigh." },
        { h: "Air is drawn out.", p: "With a pump, or a flash of flame that's gone before the cup lands. The pressure inside drops. Instead of pressing down into a muscle, the cup pulls upward. You feel a firm, spreading tug." },
        { h: "The skin lifts a little. Blood comes up.", p: "The tissue under the cup rises a few millimetres. Fresh blood moves toward the surface and the area warms. The tug settles into something close to a deep stretch that's being held for you." },
        { h: "Five to fifteen minutes.", p: "The cups stay exactly where they are. Most people go very quiet here. The room is warm, the breathing slows, and you're not asked to do anything at all." },
        { h: "The marks tell the story.", p: "Round, plum-coloured, sometimes surprising. They're not bruises: nothing struck you. They're the trace of blood the cup drew up, and they fade on their own in three to ten days." },
      ],
      scene: scene(SKIN + MARKS + CUP() + TIMER),
      animate(gsap, tl) {
        tl.to("#cup", { y: 0, duration: 1, ease: "power2.out" }, 0);
        tl.to("#vac", { opacity: .28, duration: .6 }, 1.1); tl.to("#arrows", { opacity: 1, duration: .4 }, 1.2); tl.fromTo("#arrows", { y: 18 }, { y: -10, duration: .8 }, 1.2); tl.to("#arrows", { opacity: 0, duration: .4 }, 2.1);
        tl.to("#dome", { attr: { cy: 452, ry: 96 }, duration: 1, ease: "power1.inOut" }, 2); tl.to("#bloom", { attr: { cy: 452, ry: 96 }, opacity: .75, duration: 1 }, 2);
        tl.to("#blood circle", { y: -46, opacity: .92, duration: .9, stagger: .07 }, 2.2); tl.to("#vac", { opacity: .12, duration: 1 }, 2);
        tl.to("#timer", { opacity: 1, duration: .3 }, 3); timerTick(tl, 3.1, 1);
        tl.to("#timer", { opacity: 0, duration: .3 }, 4); tl.to("#dome", { attr: { cy: 470, ry: 90 }, duration: .7 }, 4); tl.to("#bloom", { attr: { cy: 470, ry: 90 }, opacity: 0, duration: .7 }, 4);
        tl.to("#blood circle", { y: -190, opacity: 0, duration: .9, ease: "power2.in", stagger: .04 }, 4); tl.to("#cup", { y: -160, opacity: 0, duration: .9, ease: "power2.in" }, 4.1);
        tl.to("#marks", { opacity: 1, duration: .3 }, 4.4); tl.fromTo("#marks circle", { attr: { r: 30 }, opacity: .6 }, { attr: { r: 26 }, opacity: .18, duration: .9, stagger: .05 }, 4.6); tl.to({}, { duration: .4 }, 5.4);
      },
      still(gsap) { gsap.set("#cup", { y: 0 }); gsap.set("#dome", { attr: { cy: 452, ry: 96 } }); gsap.set("#bloom", { opacity: .75, attr: { cy: 452, ry: 96 } }); gsap.set("#blood circle", { opacity: .85, y: -46 }); },
    },

    sliding: {
      key: "cupping", title: "Sliding cupping", tagline: "Oil on the skin, and the cup glides.", minutes: "60 min",
      lead: "Closer to a massage, with the lift built in. The cup grips, then travels slowly along the muscle. Good for long muscles, athletes and desk days.",
      forWho: "Athletes, long desk days, recovery between training sessions.",
      steps: [
        { h: "Oil first.", p: "A thin layer of warm oil, so the cup can move without dragging the skin. It smells of very little and wipes off at the end." },
        { h: "The cup grips.", p: "Light suction, less than in a still session. Enough to lift the tissue a few millimetres, not enough to hold the cup in one place." },
        { h: "It glides along the muscle.", p: "Slowly, the length of the back or the thigh, following the fibres. Where it feels tight the therapist slows down and goes again. It feels like a deep stroke that pulls instead of pushes." },
        { h: "Warmth spreads.", p: "Blood follows the cup. The whole strip of skin goes pink and warm, not just one round spot. Muscles that were guarding start to let go." },
        { h: "No round marks.", p: "Because the cup keeps moving, you get a soft flush along the path instead of circles. It fades in a day or two. Drink water and keep warm afterwards." },
      ],
      scene: scene(SKIN + `<path id="trail" d="M130 404 H390" stroke="url(#trailG)" stroke-width="44" stroke-linecap="round" opacity="0" clip-path="url(#skinClip)"/><rect id="oil" x="40" y="382" width="440" height="30" rx="14" fill="url(#oilG)" opacity="0"/>` + CUP()),
      animate(gsap, tl) {
        tl.to("#oil", { opacity: 1, duration: .8 }, 0); tl.fromTo("#oil", { x: -140 }, { x: 140, duration: 1, ease: "power1.inOut" }, 0);
        tl.to("#cup", { y: 0, duration: .8, ease: "power2.out" }, 1); tl.to("#vac", { opacity: .2, duration: .5 }, 1.5); tl.to("#dome", { attr: { cy: 458, ry: 94 }, duration: .5 }, 1.6);
        tl.to("#cup", { x: -110, duration: .8, ease: "power1.inOut" }, 2); tl.to("#cup", { x: 110, duration: 1.2, ease: "power1.inOut" }, 2.8); tl.to("#cup", { x: 0, duration: .8, ease: "power1.inOut" }, 4);
        tl.to("#trail", { opacity: .9, duration: 1.4 }, 2.4); tl.to("#bloom", { attr: { cy: 458, ry: 94 }, opacity: .55, duration: 1 }, 3);
        tl.to("#cup", { y: -170, opacity: 0, duration: .9, ease: "power2.in" }, 4.3); tl.to("#dome", { attr: { cy: 470, ry: 90 }, duration: .5 }, 4.3); tl.to("#bloom", { opacity: 0, duration: .5 }, 4.3);
        tl.to("#trail", { opacity: .35, duration: 1 }, 4.6); tl.to("#oil", { opacity: 0, duration: .8 }, 4.6); tl.to({}, { duration: .4 }, 5.4);
      },
      still(gsap) { gsap.set("#oil", { opacity: 1 }); gsap.set("#cup", { y: 0, x: 60 }); gsap.set("#dome", { attr: { cy: 458, ry: 94 } }); gsap.set("#trail", { opacity: .8 }); gsap.set("#bloom", { opacity: .5, attr: { cy: 458, ry: 94 } }); },
    },

    fire: {
      key: "fire", title: "Fire cupping", tagline: "A flash of flame, deeper warmth.", minutes: "45 min",
      lead: "The traditional way. A flame heats the air inside a glass cup for a second, the cup lands, and as the air cools it pulls. Warmer and deeper than a pump.",
      forWho: "Deep, chronic tension. People who want the traditional session.",
      steps: [
        { h: "A flame heats the air.", p: "A cotton ball soaked in alcohol, lit and passed inside the glass cup for a second. The air inside expands. The flame never touches you." },
        { h: "The flame is gone before the cup lands.", p: "The cotton is pulled out, the cup is placed on the skin in the same movement. What you feel is the glass, warm like a mug of tea." },
        { h: "As the air cools, it pulls.", p: "Cooling air takes up less room, so the cup grips by itself, gently and then more. The skin lifts, warmth spreads under the glass." },
        { h: "Five to fifteen minutes.", p: "Same as a dry session from here: the cups stay put, the breathing slows. The heat makes the pull feel softer than it is." },
        { h: "Marks, and a deep warmth that lasts.", p: "Round marks like any cupping. Most people say the warmth stays in the muscle for hours. Keep the area covered on the way home." },
      ],
      scene: scene(SKIN + MARKS + CUP(`<g id="flame" opacity="0" transform="translate(260,300)"><path d="M0 40 C-22 20 -18 -6 0 -34 C18 -6 22 20 0 40 Z" fill="#F3A34F"/><path d="M0 34 C-12 20 -10 6 0 -12 C10 6 12 20 0 34 Z" fill="#FFE29A"/></g>`, true) + TIMER),
      animate(gsap, tl) {
        tl.set("#cup", { y: -140 }); tl.to("#flame", { opacity: 1, duration: .4 }, 0); tl.to("#flame", { scaleY: 1.15, scaleX: .9, transformOrigin: "50% 100%", duration: .25, yoyo: true, repeat: 3 }, .2); tl.to("#vac", { opacity: .18, duration: .6 }, .3);
        tl.to("#flame", { opacity: 0, scale: .4, transformOrigin: "50% 100%", duration: .35 }, 1); tl.to("#cup", { y: 0, duration: .7, ease: "power2.out" }, 1.15);
        tl.to("#dome", { attr: { cy: 452, ry: 96 }, duration: 1 }, 2); tl.to("#bloom", { attr: { cy: 452, ry: 96 }, opacity: .85, duration: 1 }, 2); tl.to("#blood circle", { y: -46, opacity: .8, duration: .9, stagger: .07 }, 2.3); tl.to("#vac", { opacity: .08, duration: 1 }, 2);
        tl.to("#timer", { opacity: 1, duration: .3 }, 3); timerTick(tl, 3.1, 1);
        tl.to("#timer", { opacity: 0, duration: .3 }, 4); tl.to("#dome", { attr: { cy: 470, ry: 90 }, duration: .7 }, 4); tl.to("#bloom", { attr: { cy: 470, ry: 90 }, opacity: 0, duration: .7 }, 4); tl.to("#blood circle", { y: -190, opacity: 0, duration: .9, ease: "power2.in", stagger: .04 }, 4);
        tl.to("#cup", { y: -160, opacity: 0, duration: .9, ease: "power2.in" }, 4.1); tl.to("#marks", { opacity: 1, duration: .3 }, 4.4); tl.fromTo("#marks circle", { attr: { r: 30 }, opacity: .6 }, { attr: { r: 26 }, opacity: .22, duration: .9, stagger: .05 }, 4.6); tl.to({}, { duration: .4 }, 5.4);
      },
      still(gsap) { gsap.set("#cup", { y: 0 }); gsap.set("#dome", { attr: { cy: 452, ry: 96 } }); gsap.set("#bloom", { opacity: .85, attr: { cy: 452, ry: 96 } }); gsap.set("#blood circle", { opacity: .8, y: -46 }); },
    },

    hijama: {
      key: "hijama", title: "Hijama (wet cupping)", tagline: "A little blood is drawn out.", minutes: "60 min",
      lead: "Rooted in prophetic medicine and widely practised in Egypt. Cupping first, then tiny shallow incisions, then the cup again so a small amount of blood leaves the body. Single-use, sterile equipment only.",
      forWho: "Those who ask for it specifically. Not for pregnancy, blood thinners or bleeding conditions.",
      steps: [
        { h: "Cupping first, a few minutes.", p: "A normal cup on the chosen spot, most often the upper back or the neck. It lifts the skin and brings blood to the surface, the same as a dry session." },
        { h: "Tiny, shallow incisions.", p: "The cup comes off. With a fresh sterile blade, your therapist makes a few very shallow scratches, about the depth of a paper cut. Most people describe it as light scratching, not pain." },
        { h: "The cup goes back on.", p: "The suction now draws a small amount of blood out through the incisions into the cup. It's slow and controlled. This is the part hijama is for." },
        { h: "Off, and cleaned.", p: "The cup is removed with the blood inside and disposed of. The area is cleaned with antiseptic. Everything that touched you was opened in front of you and is thrown away after." },
        { h: "A small dressing, and rest.", p: "A light dressing for the day. No shower on the area for 24 hours, no heavy training, eat something and drink water. Marks fade like any cupping." },
      ],
      scene: scene(SKIN + MARKS + `<g id="cuts" opacity="0" stroke="#7A1F17" stroke-width="2.2" stroke-linecap="round"><path d="M236 392 v10"/><path d="M252 390 v11"/><path d="M268 392 v10"/><path d="M284 390 v11"/></g><rect id="patch" x="205" y="379" width="110" height="26" rx="10" fill="#F4EEE6" opacity="0"/>` + CUP(`<ellipse id="pool" cx="260" cy="392" rx="58" ry="12" fill="#8E1F22" opacity="0"/>`)),
      animate(gsap, tl) {
        tl.to("#cup", { y: 0, duration: .7, ease: "power2.out" }, 0); tl.to("#vac", { opacity: .2, duration: .4 }, .6); tl.to("#dome", { attr: { cy: 455, ry: 95 }, duration: .6 }, .5); tl.to("#bloom", { attr: { cy: 455, ry: 95 }, opacity: .6, duration: .6 }, .5);
        tl.to("#cup", { y: -150, duration: .6, ease: "power2.in" }, 1); tl.to("#dome", { attr: { cy: 470, ry: 90 }, duration: .4 }, 1); tl.to("#bloom", { opacity: 0, duration: .4 }, 1); tl.to("#cuts path", { opacity: 1, duration: .25, stagger: .12 }, 1.5); tl.set("#cuts", { opacity: 1 }, 1.4);
        tl.to("#cup", { y: 0, duration: .6, ease: "power2.out" }, 2); tl.to("#vac", { opacity: .25, duration: .4 }, 2.4); tl.to("#dome", { attr: { cy: 455, ry: 95 }, duration: .5 }, 2.4);
        tl.to("#blood circle", { y: -30, opacity: .9, duration: .8, stagger: .08 }, 2.5); tl.to("#pool", { opacity: .95, attr: { ry: 26, cy: 386 }, duration: .8 }, 2.8);
        tl.to("#blood circle", { y: -120, opacity: 0, duration: .6, ease: "power2.in", stagger: .03 }, 4); tl.to("#cup", { y: -170, opacity: 0, duration: .8, ease: "power2.in" }, 4); tl.to("#dome", { attr: { cy: 470, ry: 90 }, duration: .4 }, 4); tl.to("#cuts", { opacity: .35, duration: .6 }, 4.3);
        tl.to("#patch", { opacity: 1, duration: .4 }, 5); tl.to("#cuts", { opacity: 0, duration: .3 }, 5); tl.to("#marks", { opacity: 1, duration: .5 }, 5.1); tl.fromTo("#marks circle", { opacity: .5 }, { opacity: .18, duration: .6 }, 5.3); tl.to({}, { duration: .3 }, 5.6);
      },
      still(gsap) { gsap.set("#cup", { y: 0 }); gsap.set("#cuts", { opacity: 1 }); gsap.set("#cuts path", { opacity: 1 }); gsap.set("#dome", { attr: { cy: 455, ry: 95 } }); gsap.set("#blood circle", { opacity: .9, y: -30 }); gsap.set("#pool", { opacity: .95, attr: { ry: 26, cy: 386 } }); },
    },

    manual: {
      key: "manual", title: "Manual therapy", tagline: "Hands only. Deep tissue and sports massage.", minutes: "60 min",
      lead: "Where every Zen session starts. Warm-up strokes, then slow pressure into the places that hold, until the muscle lets go. Often before the cups go on.",
      forWho: "Recovery between training days, anything that needs hands first.",
      steps: [
        { h: "Long, warm strokes.", p: "The first minutes are slow and broad, with oil: the whole length of the back or the leg. The tissue warms up and your therapist reads where it's holding." },
        { h: "Finding the knot.", p: "A spot that's denser than the rest, often tender, often not where you thought. Your therapist stays there and asks you to breathe out." },
        { h: "Pressure that stays.", p: "Not rubbing: a steady, deep pressure held for a while, with a thumb, a knuckle or an elbow. It's the kind of discomfort that feels right. Say if it's too much; it should never be." },
        { h: "The fibres lengthen.", p: "Under sustained pressure the muscle stops guarding. You feel it soften, and the pressure that was a lot a minute ago becomes easy. That's the release." },
        { h: "Long strokes to finish.", p: "Back to broad, slow movements to flush the area, then the cups if it's a combined session. Expect a little soreness the next day, like after training." },
      ],
      scene: scene(SKIN + `<g id="fibresTight" stroke="#C9A98F" stroke-width="3" fill="none" stroke-linecap="round" opacity=".9"><path d="M60 420 q30 -16 60 0 t60 0 t60 0 t60 0 t60 0 t60 0"/><path d="M60 445 q30 14 60 0 t60 0 t60 0 t60 0 t60 0 t60 0"/><path d="M60 470 q30 -12 60 0 t60 0 t60 0 t60 0 t60 0 t60 0"/></g><g id="fibresLoose" stroke="#D9B79E" stroke-width="3" fill="none" stroke-linecap="round" opacity="0"><path d="M60 420 h360"/><path d="M60 445 h360"/><path d="M60 470 h360"/></g><circle id="knot" cx="300" cy="440" r="22" fill="#B07C68" opacity="0"/><ellipse id="glow" cx="260" cy="445" rx="150" ry="40" fill="url(#warmG)" opacity="0"/><g id="hand" opacity="0"><rect x="-38" y="-10" width="76" height="60" rx="22" fill="#E7C7B0"/><rect x="-40" y="-40" width="16" height="44" rx="8" fill="#E7C7B0"/><rect x="-20" y="-52" width="16" height="56" rx="8" fill="#E7C7B0"/><rect x="0" y="-52" width="16" height="56" rx="8" fill="#E7C7B0"/><rect x="20" y="-44" width="16" height="48" rx="8" fill="#E7C7B0"/><rect x="34" y="-6" width="16" height="40" rx="8" fill="#E7C7B0" transform="rotate(-30 42 14)"/></g>`),
      animate(gsap, tl) {
        tl.set("#hand", { x: 140, y: 300 }, 0);
        tl.to("#hand", { opacity: 1, y: 368, duration: .5 }, 0); tl.to("#hand", { x: 380, duration: .9, ease: "power1.inOut" }, .3); tl.to("#hand", { x: 140, duration: .8, ease: "power1.inOut" }, 1.2); tl.to("#glow", { opacity: .35, duration: 1 }, .4);
        tl.to("#hand", { x: 300, duration: .8, ease: "power1.inOut" }, 2); tl.to("#knot", { opacity: .8, duration: .5 }, 2.2);
        tl.to("#hand", { y: 380, duration: .5, ease: "power2.out" }, 3); tl.to("#knot", { attr: { r: 14 }, opacity: .5, duration: 1 }, 3);
        tl.to("#fibresTight", { opacity: 0, duration: .8 }, 4); tl.to("#fibresLoose", { opacity: .9, duration: .8 }, 4); tl.to("#knot", { opacity: 0, attr: { r: 6 }, duration: .6 }, 4); tl.to("#glow", { opacity: .6, duration: .8 }, 4); tl.to("#hand", { y: 368, duration: .5 }, 4.2);
        tl.to("#hand", { x: 400, duration: .8, ease: "power1.inOut" }, 5); tl.to("#hand", { x: 180, y: 340, opacity: 0, duration: .7 }, 5.6); tl.to({}, { duration: .3 }, 6);
      },
      still(gsap) { gsap.set("#hand", { opacity: 1, x: 300, y: 380 }); gsap.set("#knot", { opacity: .6, attr: { r: 14 } }); gsap.set("#glow", { opacity: .4 }); },
      units: 6,
    },

    facial: {
      key: "facial", title: "Facial cupping", tagline: "Tiny cups, very light, always gliding.", minutes: "30 min",
      lead: "Small silicone cups, a fraction of the suction, never left in one place. Moves fluid toward the lymph nodes, warms the skin, loosens the jaw. No marks.",
      forWho: "Puffiness, jaw tension, a lighter session.",
      steps: [
        { h: "A light oil on the face.", p: "Face cleaned, a few drops of a plain oil so the cups slide. Your therapist checks for anything to avoid: active acne, a recent filler, broken skin." },
        { h: "Tiny cups, tiny suction.", p: "Cups the size of a thimble, soft silicone, squeezed and placed. The pull is gentle enough that you could do it yourself; the difference is the direction." },
        { h: "Gliding, never still.", p: "Along the jaw, up the cheek, out from the nose, up the forehead. Always moving, always outward and up. A still cup would leave a mark; these don't stay long enough." },
        { h: "Fluid moves toward the ear and neck.", p: "The strokes follow the lymph pathways, so puffiness drains toward the nodes in front of the ear and down the neck. Jaw muscles that clench all day get the same release as a back." },
        { h: "No marks. A warm, awake face.", p: "The skin is flushed for an hour, then calm. Drink water. Many people book it before an event; it works well on its own or after a back session." },
      ],
      scene: scene(`<path id="face" d="M150 470 C120 430 118 360 140 300 C158 250 175 210 215 190 C255 170 290 175 310 200 C330 225 332 250 322 275 C316 290 322 300 334 305 C342 308 344 318 336 326 C330 332 332 340 336 348 C340 356 334 364 322 366 C312 368 314 378 322 388 C332 402 322 420 300 428 C270 440 250 445 230 455 C205 468 185 480 150 470 Z" fill="url(#skinG)"/><path id="ear" d="M128 330 C108 320 104 350 116 368 C124 380 138 372 138 356" fill="#E3C8B4" stroke="#CDAE96" stroke-width="2"/><path id="neck" d="M150 470 C170 500 220 505 260 520 L100 520 C100 500 130 490 150 470 Z" fill="url(#skinG)"/><ellipse id="flush" cx="235" cy="360" rx="70" ry="45" fill="url(#bloomG)" opacity="0"/><path id="sheen" d="M180 250 C200 300 210 360 200 420" stroke="#fff" stroke-opacity=".6" stroke-width="10" stroke-linecap="round" fill="none" opacity="0"/><g id="lymph" opacity="0" stroke="#8FB8F5" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M300 400 C260 395 210 380 160 350 M175 348 L158 348 L166 362"/><path d="M280 300 C240 305 200 320 160 340 M172 330 L158 342 L174 348"/><path d="M150 372 C145 400 140 430 132 470 M124 458 L132 472 L142 460"/></g><g id="mini" opacity="0"><path d="M150 380 C150 250 190 175 260 175 C330 175 370 250 370 380 Z" fill="url(#glassG)" stroke="#E7EDE8" stroke-opacity=".9" stroke-width="5" transform="translate(-260,-380)"/><rect x="-125" y="-8" width="250" height="14" rx="7" fill="#E7EDE8"/></g>`),
      animate(gsap, tl) {
        tl.to("#sheen", { opacity: 1, duration: .6 }, .2); tl.fromTo("#sheen", { y: -30 }, { y: 30, duration: 1, ease: "power1.inOut" }, .2); tl.to("#sheen", { opacity: 0, duration: .5 }, 1.2);
        tl.set("#mini", { x: 300, y: 405, scale: .5, transformOrigin: "50% 100%" }, 0);
        tl.to("#mini", { opacity: 1, duration: .5 }, 1); tl.to("#mini", { scale: .34, duration: .5, ease: "power2.out" }, 1);
        tl.to("#mini", { x: 180, y: 345, duration: 1, ease: "power1.inOut" }, 2); tl.to("#mini", { x: 300, y: 405, duration: .01 }, 3); tl.to("#mini", { x: 190, y: 315, duration: .9, ease: "power1.inOut" }, 3.05); tl.to("#flush", { opacity: .5, duration: 1 }, 2.4);
        tl.to("#lymph", { opacity: 1, duration: .6 }, 3.2); tl.fromTo("#lymph path", { strokeDasharray: 300, strokeDashoffset: 300 }, { strokeDashoffset: 0, duration: 1, stagger: .15 }, 3.2);
        tl.to("#mini", { opacity: 0, y: 265, duration: .6 }, 4.3); tl.to("#lymph", { opacity: 0, duration: .6 }, 4.6); tl.to("#flush", { opacity: .3, duration: .8 }, 4.6); tl.to({}, { duration: .4 }, 5.4);
      },
      still(gsap) { gsap.set("#mini", { opacity: 1, x: 240, y: 365, scale: .34, transformOrigin: "50% 100%" }); gsap.set("#flush", { opacity: .5 }); gsap.set("#lymph", { opacity: 1 }); },
    },
  };
  const ORDER = ["dry", "sliding", "fire", "hijama", "manual", "facial"];
  // which method page a service name belongs to (used by the booking cards and by ?svc=)
  function methodOf(serviceName = "") {
    const n = serviceName.toLowerCase();
    if (n.includes("hijama") || n.includes("wet")) return "hijama";
    if (n.includes("fire")) return "fire";
    if (n.includes("facial") || n.includes("face")) return "facial";
    if (n.includes("manual") || n.includes("massage")) return "manual";
    if (n.includes("slid") || n.includes("glid") || n.includes("dynamic") || n.includes("moving")) return "sliding";
    return "dry";
  }
  return { METHODS, ORDER, methodOf };
})();
