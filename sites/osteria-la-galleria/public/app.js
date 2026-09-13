/* Osteria La Galleria — shared shell (header, tab bar, footer), language, the floor plan, the icons, and the
   four page modules: home, menu (one room at a time), steak (the dial), visit. Data lives in menu.js. */
(function () {
  "use strict";

  /* ============================== strings ============================== */
  const T = {
    "nav.home":     { it: "Galleria", en: "Gallery" },
    "nav.menu":     { it: "Il menu", en: "The menu" },
    "nav.steak":    { it: "La bistecca", en: "The steak" },
    "nav.visit":    { it: "Visita", en: "Visit" },
    "nav.reserve":  { it: "Prenota", en: "Reserve" },
    "nav.findus":   { it: "Dove siamo", en: "Find us" },
    "skip":         { it: "Vai al contenuto", en: "Skip to content" },
    "footer.prices": { it: "Prezzi in euro.", en: "Prices in euro." },
    "footer.credit": { it: "un sito Locali & Ordinazioni", en: "a Locali & Ordinazioni site" },
    "footer.where": { it: "Di fronte a Palazzo Pitti, Firenze", en: "Opposite Palazzo Pitti, Florence" },
    "star.note":    { it: "* Prodotto che può essere surgelato all'origine.", en: "* Product may be frozen at origin." },
    "v.note":       { it: "piatto vegetariano.", en: "vegetarian dish." },
    "legend.title": { it: "Allergeni", en: "Allergens" },
    "per2":         { it: "per due", en: "for two" },
    "perkg":        { it: "al kg", en: "per kg" },
    "hh":           { it: "Happy hour · Spritz e Hugo · 7 €", en: "Happy hour · Spritz & Hugo · €7" },

    /* home */
    "home.title":     { it: "Osteria La Galleria — Firenze", en: "Osteria La Galleria — Florence" },
    "hero.eyebrow":   { it: "Firenze · Di fronte a Palazzo Pitti", en: "Florence · Opposite Palazzo Pitti" },
    "hero.lede":      { it: "Una galleria dove le opere si mangiano. Dieci sale in ordine di portata, ogni piatto con la sua targhetta, e una bilancia per la fiorentina. La visita comincia dalla finestrella sulla facciata.",
                        en: "A gallery where the works are eaten. Ten rooms in course order, every dish with its own plaque, and a scale for the fiorentina. The visit begins at the little window in the façade." },
    "hero.cta":       { it: "Visita il menu", en: "Visit the menu" },
    "hero.cta2":      { it: "Pesa la bistecca", en: "Weigh the steak" },
    "cap.pitti":      { it: "Veduta di Palazzo Pitti dai nostri tavoli", en: "Palazzo Pitti, seen from our tables" },
    "cap.sala":       { it: "La sala", en: "The dining room" },
    "cap.banco":      { it: "Verso il banco", en: "Towards the counter" },
    "atrio.eyebrow":  { it: "Prologo", en: "Prologue" },
    "atrio.title":    { it: "La buchetta del vino", en: "The wine window" },
    "atrio.text":     { it: "Sulla facciata c'è una buchetta: la finestrella da cui, dal Cinquecento, i fiorentini si facevano passare un bicchiere di vino senza entrare. La nostra è ancora aperta. Un bicchiere in piedi, davanti a Palazzo Pitti, e poi si entra.",
                        en: "There is a little window in the façade: the hatch through which, since the 1500s, Florentines have been handed a glass of wine without coming in. Ours is still open. A glass standing up, in front of Palazzo Pitti, and then you come in." },
    "atrio.facts":    { it: "Vino al bicchiere da 7 € · Happy hour: Spritz e Hugo 7 €", en: "Wine by the glass from €7 · Happy hour: Spritz & Hugo €7" },
    "plan.eyebrow":   { it: "Il percorso", en: "The route" },
    "plan.title":     { it: "Dieci sale intorno a un cortile", en: "Ten rooms around a courtyard" },
    "plan.text":      { it: "Si entra dalla buchetta e si gira in senso orario, in ordine di portata: dagli antipasti alla cantina. Tocca una sala per entrarci.",
                        en: "You come in through the wine window and walk clockwise, in course order: from the antipasti to the cellar. Tap a room to step inside." },
    "plan.courtyard": { it: "Cortile", en: "Courtyard" },
    "plan.entrance":  { it: "Ingresso", en: "Entrance" },
    "plan.exit":      { it: "Uscita", en: "Exit" },
    "plan.here":      { it: "Sei qui", en: "You are here" },
    "plan.aria":      { it: "Pianta della galleria: dieci sale, una per portata", en: "Floor plan of the gallery: ten rooms, one per course" },
    "plan.room":      { it: "Sala {n} · {name}", en: "Room {n} · {name}" },
    "teaser.eyebrow": { it: "Sala VI", en: "Room VI" },
    "teaser.title":   { it: "Una bistecca non si ordina. Si pesa.", en: "You don't order a steak here. You weigh it." },
    "teaser.text":    { it: "La fiorentina si paga al chilo. Sposta l'ago e sai cosa spendi, per quante persone, prima ancora di sederti.",
                        en: "The fiorentina is priced by the kilo. Move the needle and you know what you'll pay, and for how many, before you sit down." },
    "teaser.cta":     { it: "Vai alla bilancia", en: "Go to the scale" },
    "rooms.eyebrow":  { it: "Le sale", en: "The rooms" },
    "rooms.title":    { it: "Dove si mangia", en: "Where you eat" },
    "rooms.cta":      { it: "Orari, indirizzo, recensioni", en: "Hours, address, reviews" },

    /* menu */
    "menu.title":     { it: "Il menu — Osteria La Galleria", en: "The menu — Osteria La Galleria" },
    "menu.eyebrow":   { it: "Il menu, sala per sala", en: "The menu, room by room" },
    "menu.h1":        { it: "Il menu", en: "The menu" },
    "menu.intro":     { it: "Una sala alla volta. Scegli dalla pianta, oppure usa le frecce in fondo.", en: "One room at a time. Pick from the plan, or use the arrows at the bottom." },
    "filter.title":   { it: "Cosa non mangi?", en: "What don't you eat?" },
    "filter.note":    { it: "I piatti che non fanno per te restano appesi, ma con la luce spenta. Per gli allergeni chiedi sempre in sala: la cucina è una sola.",
                        en: "Dishes that aren't for you stay on the wall, with the light off. Always ask the staff about allergens: there is only one kitchen." },
    "filter.veg":     { it: "Vegetariano", en: "Vegetarian" },
    "filter.gluten":  { it: "Senza glutine", en: "No gluten" },
    "filter.milk":    { it: "Senza latte", en: "No milk" },
    "filter.egg":     { it: "Senza uova", en: "No eggs" },
    "filter.nuts":    { it: "Senza frutta a guscio", en: "No nuts" },
    "filter.sea":     { it: "Senza pesce e frutti di mare", en: "No fish or seafood" },
    "filter.tally":   { it: "In questa sala: {n} opere in mostra su {t}", en: "In this room: {n} of {t} works on view" },
    "filter.empty":   { it: "In questa sala niente fa per te. Prova la sala accanto, o chiedi in sala: la cucina adatta molti piatti.", en: "Nothing in this room is for you. Try the next room, or ask the staff: the kitchen adapts many dishes." },
    "room.of":        { it: "Sala {n} di 10", en: "Room {n} of 10" },
    "room.prev":      { it: "Sala precedente", en: "Previous room" },
    "room.next":      { it: "Sala successiva", en: "Next room" },
    "room.toStart":   { it: "Torna all'ingresso", en: "Back to the entrance" },
    "room.exit":      { it: "Fine della visita: vieni a trovarci", en: "End of the visit: come and find us" },
    "room.scaleCard": { it: "La bilancia", en: "The scale" },
    "room.scaleText": { it: "Fiorentina e costola si pagano al chilo. Pesa la tua su una pagina tutta sua.", en: "Fiorentina and costola are priced by the kilo. Weigh yours on a page of its own." },
    "room.scaleCta":  { it: "Apri la bilancia", en: "Open the scale" },

    /* steak */
    "steak.title":    { it: "La bilancia — Osteria La Galleria", en: "The scale — Osteria La Galleria" },
    "steak.eyebrow":  { it: "Sala VI · La bilancia", en: "Room VI · The scale" },
    "steak.h1":       { it: "Una bistecca non si ordina. Si pesa.", en: "You don't order a steak here. You weigh it." },
    "steak.lede":     { it: "A Firenze la bistecca arriva al tavolo cruda, sulla bilancia, prima di andare sulla brace. Il prezzo è al chilo, il taglio lo decidi tu. Qui puoi provare prima.",
                        en: "In Florence the steak comes to the table raw, on the scale, before it goes on the embers. The price is per kilo and the cut is your call. Here you can try it first." },
    "steak.cut":      { it: "Taglio", en: "Cut" },
    "steak.weight":   { it: "Peso della bistecca", en: "Steak weight" },
    "steak.kg":       { it: "chili", en: "kilos" },
    "steak.etti":     { it: "{n} etti", en: "{n} etti" },
    "steak.etti.note": { it: "un etto è 100 g: a Firenze la bistecca si conta così", en: "an etto is 100 g: that's how Florence counts a steak" },
    "steak.price":    { it: "Prezzo", en: "Price" },
    "steak.each":     { it: "a testa", en: "a head" },
    "steak.for":      { it: "indicativamente per {p}", en: "roughly for {p}" },
    "steak.one":      { it: "una persona", en: "one person" },
    "steak.many":     { it: "{n} persone", en: "{n} people" },
    "steak.valuetext": { it: "{kg} kg, {eur} €, {for}", en: "{kg} kg, €{eur}, {for}" },
    "steak.anatomy.eyebrow": { it: "Il taglio", en: "The cut" },
    "steak.anatomy.title":   { it: "Cosa c'è in una fiorentina", en: "What's in a fiorentina" },
    "steak.anatomy.text":    { it: "L'osso a T divide due muscoli diversi: il controfiletto, più grande e saporito, e il filetto, più piccolo e tenero. Un taglio solo, due bistecche.",
                               en: "The T-bone divides two different muscles: the striploin, larger and full of flavour, and the tenderloin, smaller and tender. One cut, two steaks." },
    "steak.part.loin":   { it: "Controfiletto", en: "Striploin" },
    "steak.part.fillet": { it: "Filetto", en: "Tenderloin" },
    "steak.part.bone":   { it: "L'osso a T", en: "The T-bone" },
    "steak.rule1.t":  { it: "Alta tre dita", en: "Three fingers thick" },
    "steak.rule1.d":  { it: "La tradizione la vuole spessa: sotto i 600 grammi non è una fiorentina, è una fettina.", en: "Tradition wants it thick: under 600 grams it isn't a fiorentina, it's a slice." },
    "steak.rule2.t":  { it: "Al sangue", en: "Rare" },
    "steak.rule2.d":  { it: "Crosta fuori, rossa dentro. Chiedila come vuoi, ma la tradizione non si discute.", en: "Crust outside, red inside. Ask for it as you like, but tradition doesn't argue." },
    "steak.rule3.t":  { it: "Sale grosso, dopo", en: "Coarse salt, after" },
    "steak.rule3.d":  { it: "Niente marinate. Sale, pepe e un filo d'olio arrivano quando esce dalla griglia.", en: "No marinades. Salt, pepper and a thread of oil come when it leaves the grill." },
    "steak.source":   { it: "Scottona italiana · Chianina IGP", en: "Italian scottona · Chianina IGP beef" },
    "steak.room":     { it: "Tutta la Sala VI: bistecche e specialità di carne", en: "The whole of Room VI: steaks and meat specialities" },

    /* visit */
    "visit.title":    { it: "Vieni a trovarci — Osteria La Galleria", en: "Come and find us — Osteria La Galleria" },
    "visit.eyebrow":  { it: "Fine della visita", en: "End of the visit" },
    "visit.h1":       { it: "Vieni a trovarci", en: "Come and find us" },
    "visit.hours":    { it: "Orari", en: "Hours" },
    "visit.address":  { it: "Indirizzo", en: "Address" },
    "visit.where":    { it: "Di fronte a Palazzo Pitti", en: "Opposite Palazzo Pitti" },
    "visit.phone":    { it: "Telefono", en: "Phone" },
    "visit.wa":       { it: "Scrivici su WhatsApp", en: "Message us on WhatsApp" },
    "visit.maps":     { it: "Apri in Google Maps", en: "Open in Google Maps" },
    "visit.ig":       { it: "Instagram", en: "Instagram" },
    "visit.hh":       { it: "Happy hour", en: "Happy hour" },
    "visit.tbd":      { it: "In arrivo", en: "Coming soon" },
    "review.title":   { it: "Lasciaci una recensione", en: "Leave us a review" },
    "review.text":    { it: "Ti è piaciuto? Due righe su Google ci aiutano più di quanto pensi. Grazie.", en: "Enjoyed it? Two lines on Google help us more than you'd think. Thank you." },
    "review.cta":     { it: "Scrivi su Google", en: "Write on Google" },
  };

  const SHORT = {
    antipasti: { it: "Antipasti", en: "Starters" }, primi: { it: "Primi", en: "Pasta" }, tartufo: { it: "Tartufo", en: "Truffle" },
    secondi: { it: "Secondi", en: "Mains" }, pesce: { it: "Pesce", en: "Fish" }, bistecche: { it: "Bistecche", en: "Steaks" },
    insalate: { it: "Insalate", en: "Salads" }, pinsa: { it: "Pinsa", en: "Pinsa" }, dolci: { it: "Dolci", en: "Desserts" }, cantina: { it: "Cantina", en: "Cellar" },
  };

  /* Line icons, one per room, drawn like the little engravings on the paper menu. 24×24, stroke 1.5. */
  const ICONS = {
    antipasti: '<path d="M4 9l8-4 8 4-8 4z"/><path d="M4 9v3l8 4 8-4V9"/><circle cx="12" cy="9" r="1.6"/>',
    primi: '<path d="M4 12c2-3 4-3 6 0s4 3 6 0 3-3 4 0"/><path d="M4 16c2-3 4-3 6 0s4 3 6 0 3-3 4 0"/><path d="M4 8c2-3 4-3 6 0s4 3 6 0 3-3 4 0"/>',
    tartufo: '<path d="M8 6l3-2 3 1 3 2 1 3-1 4-2 3-3 1-3-1-3-2-1-4z"/><path d="M9 9l2 1-1 2M13 8l2 2-2 1M11 14l2 1"/>',
    secondi: '<circle cx="6" cy="8" r="2.5"/><circle cx="18" cy="16" r="2.5"/><path d="M7.5 9.8l8.7 4.4M6.9 6l9.6 4.8"/><path d="M4 17c3-1 5 1 8 0"/>',
    pesce: '<path d="M3 12c3-4 7-6 11-6 3 0 5 2 7 6-2 4-4 6-7 6-4 0-8-2-11-6z"/><path d="M14 6l4-3M14 18l4 3"/><circle cx="7" cy="11" r=".9"/>',
    bistecche: '<path d="M6 5c4-1 8 0 11 2 2 2 2 5 0 7-1 2-4 3-7 4-3 1-5 0-6-2-1-3-1-8 2-11z"/><path d="M8 5v7l5 4"/><path d="M8 12h4"/>',
    insalate: '<path d="M12 21c-5-3-8-7-8-12 5 0 8 3 8 8 0-5 3-8 8-8 0 5-3 9-8 12z"/><path d="M12 21V9"/>',
    pinsa: '<path d="M4 4l16 6-14 10z"/><circle cx="9" cy="10" r="1.2"/><circle cx="8" cy="15" r="1.2"/><circle cx="13" cy="12" r="1.2"/>',
    dolci: '<path d="M4 19h16M5 19v-7l7-4 7 4v7"/><path d="M5 14c2-1 4 1 7 0s5-1 7 0"/><path d="M12 8V5"/>',
    cantina: '<path d="M9 3h4v3l1 2v12a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V8l1-2z"/><path d="M16 12h5l-1 5h-3zM18 17v4M16 21h4"/>',
    atrio: '<path d="M6 21V10a6 6 0 0 1 12 0v11"/><path d="M9 21v-9a3 3 0 0 1 6 0v9"/><path d="M4 21h16"/>',
    home: '<path d="M4 21V10l8-6 8 6v11"/><path d="M10 21v-6h4v6"/>',
    menu: '<rect x="3" y="4" width="18" height="16" rx="1"/><rect x="6" y="7" width="12" height="10"/><path d="M8 15h8"/>',
    steak: '<path d="M6 5c4-1 8 0 11 2 2 2 2 5 0 7-1 2-4 3-7 4-3 1-5 0-6-2-1-3-1-8 2-11z"/><path d="M8 5v7l5 4"/>',
    visit: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  };
  const icon = (id, cls) => '<svg class="ic ' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[id] || "") + "</svg>";

  /* ============================== state + helpers ============================== */
  const ROOMS = window.ROOMS, ALLERGENS = window.ALLERGENS, SITE = window.SITE;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const page = document.body.dataset.page;
  const HERO = { wall: "#3E1219", ink: "#F2E8D5", gold: "#C9A55C" };

  let lang = (() => {
    const q = new URLSearchParams(location.search).get("lang");
    if (q === "it" || q === "en") return q;
    try { const s = localStorage.getItem("galleria.lang"); if (s === "it" || s === "en") return s; } catch (e) {}
    return (navigator.language || "en").toLowerCase().startsWith("it") ? "it" : "en";
  })();

  const t = (k, vars) => {
    let s = (T[k] && T[k][lang]) || (T[k] && T[k].it) || k;
    if (vars) for (const [key, v] of Object.entries(vars)) s = s.split("{" + key + "}").join(v);
    return s;
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = n => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
  const eur = n => lang === "it" ? num(n).replace(".", ",") + " €" : "€" + num(n);
  const money = (n, unit) => eur(n) + (unit ? "<small>" + esc(t(unit)) + "</small>" : "");
  const kgFmt = kg => lang === "it" ? kg.toFixed(2).replace(".", ",") : kg.toFixed(2);

  function setWall(wall, ink, gold) {
    const root = document.documentElement;
    root.style.setProperty("--wall", wall);
    root.style.setProperty("--ink", ink);
    root.style.setProperty("--gold", gold);
    root.style.setProperty("--gold-soft", "color-mix(in srgb, " + gold + " 45%, transparent)");
    root.style.setProperty("--muted", "color-mix(in srgb, " + ink + " 74%, transparent)");
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", wall);
  }

  /* ============================== shell ============================== */
  const NAV = [
    { href: "index.html", key: "nav.home", id: "home", ic: "home" },
    { href: "menu.html", key: "nav.menu", id: "menu", ic: "menu" },
    { href: "bistecca.html", key: "nav.steak", id: "steak", ic: "steak" },
    { href: "visita.html", key: "nav.visit", id: "visit", ic: "visit" },
  ];
  function ctaHtml(cls) {
    if (SITE.whatsapp) return '<a class="btn small ' + cls + '" href="https://wa.me/' + esc(SITE.whatsapp) + '" rel="noopener">' + esc(t("nav.reserve")) + "</a>";
    if (SITE.phone) return '<a class="btn small ' + cls + '" href="tel:' + esc(SITE.phone.replace(/\s+/g, "")) + '">' + esc(t("nav.reserve")) + "</a>";
    return '<a class="btn small ' + cls + '" href="visita.html">' + esc(t("nav.findus")) + "</a>";
  }
  function renderShell() {
    document.documentElement.lang = lang;
    const links = NAV.map(n => '<a href="' + n.href + '"' + (n.id === page ? ' aria-current="page"' : "") + ">" + esc(t(n.key)) + "</a>").join("");
    document.getElementById("shell-top").innerHTML =
      '<a class="skip" href="#main">' + esc(t("skip")) + "</a>" +
      '<header class="nav"><a class="brand" href="index.html" aria-label="Osteria La Galleria"><span class="brand-a">Osteria</span><span class="brand-b">La Galleria</span></a>' +
      '<nav class="nav-links" aria-label="Sito">' + links + "</nav>" +
      '<div class="nav-right"><div class="lang" role="group" aria-label="Lingua / Language">' +
        '<button type="button" data-lang="it" aria-pressed="' + (lang === "it") + '">IT</button><button type="button" data-lang="en" aria-pressed="' + (lang === "en") + '">EN</button></div>' +
        ctaHtml("hide-sm") + "</div></header>" +
      '<nav class="tabbar" aria-label="Sito">' + NAV.map(n => '<a href="' + n.href + '"' + (n.id === page ? ' aria-current="page"' : "") + ">" + icon(n.ic) + "<span>" + esc(t(n.key)) + "</span></a>").join("") + "</nav>";
    document.querySelectorAll(".lang button").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.lang === lang) return;
      lang = b.dataset.lang;
      try { localStorage.setItem("galleria.lang", lang); } catch (e) {}
      render();
    }));

    const legend = page === "menu" || page === "steak"
      ? '<div class="legend"><span class="legend-title">' + esc(t("legend.title")) + "</span>" + Object.keys(ALLERGENS).map(n => "<span><b>" + n + "</b>" + esc(ALLERGENS[n][lang]) + "</span>").join("") + "</div>" +
        '<p class="foot-line">' + esc(t("footer.prices")) + " " + esc(t("star.note")) + ' <span class="vmark">V</span> ' + esc(t("v.note")) + "</p>"
      : "";
    document.getElementById("shell-foot").innerHTML = '<footer class="foot">' + legend +
      '<p class="foot-credit"><span class="brand-foot">Osteria La Galleria</span> · ' + esc(t("footer.where")) + " · " + esc(t("footer.credit")) + "</p></footer>";
  }
  function applyStrings(root) {
    (root || document).querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  }

  /* ============================== the floor plan ============================== */
  /* A ring of ten rooms around a courtyard, clockwise from the entrance: I and II up the left, III to VI across
     the top, VII and VIII down the right, IX and X back along the bottom, and out past the cellar. */
  const PLAN = {
    w: 640, h: 500,
    rooms: {
      antipasti: [0, 280, 150, 140], primi: [0, 130, 150, 140],
      tartufo: [0, 0, 150, 120], secondi: [160, 0, 150, 120], pesce: [320, 0, 150, 120], bistecche: [480, 0, 160, 120],
      insalate: [480, 130, 160, 140], pinsa: [480, 280, 160, 140],
      dolci: [320, 280, 150, 140], cantina: [160, 280, 150, 140],
    },
    court: [160, 130, 310, 140], atrio: [0, 430, 150, 60],
  };
  function planSvg(activeId, hrefFor) {
    const c = r => [r[0] + r[2] / 2, r[1] + r[3] / 2];
    const order = ROOMS.map(r => r.id);
    const pts = [[75, 460]].concat(order.map(id => c(PLAN.rooms[id]))).concat([[235, 470]]);
    const route = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
    const rooms = ROOMS.map(r => {
      const [x, y, w, h] = PLAN.rooms[r.id];
      const active = r.id === activeId;
      const label = t("plan.room", { n: r.numeral, name: SHORT[r.id][lang] });
      return '<a href="' + hrefFor(r.id) + '" class="pr' + (active ? " active" : "") + '" data-room="' + r.id + '" aria-label="' + esc(label) + '"' + (active ? ' aria-current="true"' : "") + ">" +
        '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + r.wall + '"/>' +
        '<text class="pn" x="' + (x + 12) + '" y="' + (y + 40) + '">' + r.numeral + "</text>" +
        '<text class="pt" x="' + (x + 12) + '" y="' + (y + h - 16) + '">' + esc(SHORT[r.id][lang]) + "</text>" +
        '<g transform="translate(' + (x + w - 40) + " " + (y + 12) + ')"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="' + r.ink + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity=".85">' + ICONS[r.id] + "</svg></g>" +
        "</a>";
    }).join("");
    const a = PLAN.atrio, ct = PLAN.court;
    const here = activeId && PLAN.rooms[activeId] ? (() => { const [cx, cy] = c(PLAN.rooms[activeId]); return '<g class="here" transform="translate(' + cx + " " + (cy - 4) + ')"><path d="M0 0c-9-10-12-16-12-22a12 12 0 0 1 24 0c0 6-3 12-12 22z" /><circle cx="0" cy="-22" r="4"/><text y="14">' + esc(t("plan.here")) + "</text></g>"; })() : "";
    return '<svg class="plan" viewBox="0 0 ' + PLAN.w + " " + PLAN.h + '" role="img" aria-label="' + esc(t("plan.aria")) + '">' +
      '<rect x="' + ct[0] + '" y="' + ct[1] + '" width="' + ct[2] + '" height="' + ct[3] + '" class="court"/>' +
      '<text class="pc" x="' + (ct[0] + ct[2] / 2) + '" y="' + (ct[1] + ct[3] / 2 + 5) + '" text-anchor="middle">' + esc(t("plan.courtyard")) + "</text>" +
      '<path class="route" d="' + route + '"/>' +
      rooms +
      '<path class="atrio-arch" d="M' + a[0] + " " + (a[1] + a[3]) + "V" + (a[1] + 20) + "a75 20 0 0 1 150 0V" + (a[1] + a[3]) + '"/>' +
      '<text class="pt" x="' + (a[0] + 12) + '" y="' + (a[1] + a[3] - 14) + '">' + esc(t("plan.entrance")) + "</text>" +
      '<path class="door" d="M235 425v70"/><text class="pt" x="245" y="488">' + esc(t("plan.exit")) + "</text>" +
      here + "</svg>";
  }

  /* ============================== dishes ============================== */
  function dishHtml(d, level) {
    const marks = d.v ? ' <span class="vmark" title="' + esc(t("v.note")) + '">V</span>' : "";
    const star = d.star ? "<sup>*</sup>" : "";
    let desc = lang === "it" ? (d.dit || "") : (d.en || "");
    if (desc.trim().toLowerCase() === d.it.trim().toLowerCase()) desc = "";
    const al = (d.a || []).slice().sort((a, b) => a - b);
    const alHtml = al.length
      ? '<span class="allergens" title="' + esc(al.map(n => ALLERGENS[n][lang]).join(", ")) + '">' + al.join(" · ") + "</span>"
      : '<span class="allergens none">—</span>';
    const unit = d.perKg ? "perkg" : (d.per2 ? "per2" : null);
    return '<li class="work' + (d.feature ? " feature" : "") + '" data-a="' + al.join(",") + '" data-v="' + (d.v ? 1 : 0) + '">' +
      '<article class="plaque">' +
        "<" + level + ' class="work-title" lang="it">' + esc(d.it) + star + marks + "</" + level + ">" +
        '<p class="work-desc">' + esc(desc) + "</p>" +
        '<div class="work-meta">' + alHtml + '<span class="price">' + money(d.price, unit) + "</span></div>" +
      "</article></li>";
  }

  /* ============================== filters ============================== */
  const FILTERS = [
    { id: "veg", key: "filter.veg", test: d => !!d.v },
    { id: "gluten", key: "filter.gluten", avoid: [1] },
    { id: "milk", key: "filter.milk", avoid: [7] },
    { id: "egg", key: "filter.egg", avoid: [3] },
    { id: "nuts", key: "filter.nuts", avoid: [5, 8] },
    { id: "sea", key: "filter.sea", avoid: [2, 4, 14] },
  ];
  const active = new Set();
  function chipsHtml() {
    return FILTERS.map(f => '<label class="chip"><input type="checkbox" value="' + f.id + '"' + (active.has(f.id) ? " checked" : "") + "><i></i>" + esc(t(f.key)) + "</label>").join("");
  }
  function applyFilters() {
    const works = document.querySelectorAll("#room-view .work");
    let on = 0;
    works.forEach(w => {
      const al = w.dataset.a ? w.dataset.a.split(",").map(Number) : [];
      const v = w.dataset.v === "1";
      let ok = true;
      active.forEach(id => { const f = FILTERS.find(x => x.id === id); ok = ok && (f.test ? v : !f.avoid.some(n => al.includes(n))); });
      w.classList.toggle("off", !ok);
      if (ok) on++;
    });
    const tally = document.getElementById("tally");
    if (tally) {
      tally.textContent = active.size ? (on ? t("filter.tally", { n: on, t: works.length }) : t("filter.empty")) : "";
      tally.classList.toggle("empty", active.size > 0 && on === 0);
    }
    const count = document.getElementById("filter-count");
    if (count) { count.hidden = !active.size; count.textContent = active.size; }
  }

  /* ============================== pages ============================== */
  const pages = {};

  pages.home = function () {
    document.title = t("home.title");
    setWall(HERO.wall, HERO.ink, HERO.gold);
    applyStrings();
    document.getElementById("plan-home").innerHTML = planSvg(null, id => "menu.html#" + id);
    document.getElementById("hh").hidden = !(SITE.happyHour && SITE.happyHour.price);
    document.getElementById("teaser-dial").innerHTML = dialSvg(0.45, true);
  };

  pages.menu = function () {
    document.title = t("menu.title");
    applyStrings();
    const side = document.getElementById("menu-side");
    side.innerHTML = '<div class="plan-wrap" id="plan"></div>' +
      '<details class="filters" id="filters"' + (window.innerWidth >= 900 ? " open" : "") + "><summary>" + icon("menu", "sm") + "<span>" + esc(t("filter.title")) + '</span><span class="filter-count" id="filter-count" hidden></span></summary>' +
      '<div class="chips" id="chips">' + chipsHtml() + "</div>" +
      '<p class="filters-note">' + esc(t("filter.note")) + "</p></details>";
    document.querySelectorAll("#chips input").forEach(cb => cb.addEventListener("change", () => { cb.checked ? active.add(cb.value) : active.delete(cb.value); applyFilters(); }));

    const fromHash = location.hash.replace("#", "");
    const id = ROOMS.some(r => r.id === fromHash) ? fromHash : ROOMS[0].id;
    showRoom(id, false);

    window.onhashchange = () => { const h = location.hash.replace("#", ""); if (ROOMS.some(r => r.id === h) && h !== current) showRoom(h, true); };
    document.onkeydown = e => {
      if (e.target.matches("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = ROOMS.findIndex(r => r.id === current);
      if (e.key === "ArrowRight" && i < ROOMS.length - 1) { showRoom(ROOMS[i + 1].id, true); e.preventDefault(); }
      if (e.key === "ArrowLeft" && i > 0) { showRoom(ROOMS[i - 1].id, true); e.preventDefault(); }
    };
  };

  let current = null;
  function showRoom(id, user) {
    const i = ROOMS.findIndex(r => r.id === id); const room = ROOMS[i];
    current = id;
    setWall(room.wall, room.ink, room.id === "pinsa" ? "#F6EBDA" : HERO.gold);
    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
    document.getElementById("plan").innerHTML = planSvg(id, r => "#" + r);
    document.querySelectorAll("#plan a.pr").forEach(a => a.addEventListener("click", e => { e.preventDefault(); showRoom(a.dataset.room, true); }));

    const groups = room.groups.map(g =>
      '<div class="group">' + (g.title ? '<h3 class="group-title">' + esc(g.title[lang]) + "</h3>" : "") +
      '<ol class="works">' + g.items.map(d => dishHtml(d, g.title ? "h4" : "h3")).join("") + "</ol></div>").join("");
    const scaleCard = room.scale ? '<a class="scale-card" href="bistecca.html">' + dialSvg(0.6, true) + "<div><h3>" + esc(t("room.scaleCard")) + "</h3><p>" + esc(t("room.scaleText")) + '</p><span class="btn small">' + esc(t("room.scaleCta")) + "</span></div></a>" : "";
    const prev = i > 0 ? ROOMS[i - 1] : null, next = i < ROOMS.length - 1 ? ROOMS[i + 1] : null;
    const nav = '<nav class="room-nav" aria-label="' + esc(t("nav.menu")) + '">' +
      (prev ? '<a class="room-link prev" href="#' + prev.id + '" data-room="' + prev.id + '"><small>' + esc(t("room.prev")) + "</small><b>" + prev.numeral + " · " + esc(prev.title[lang]) + "</b></a>" : '<a class="room-link prev" href="index.html#prologo"><small>' + esc(t("room.toStart")) + "</small><b>" + esc(t("atrio.title")) + "</b></a>") +
      (next ? '<a class="room-link next" href="#' + next.id + '" data-room="' + next.id + '"><small>' + esc(t("room.next")) + "</small><b>" + next.numeral + " · " + esc(next.title[lang]) + "</b></a>" : '<a class="room-link next" href="visita.html"><small>' + esc(t("plan.exit")) + "</small><b>" + esc(t("room.exit")) + "</b></a>") +
      "</nav>";
    const view = document.getElementById("room-view");
    view.className = "room-view" + (room.compact ? " compact" : "");
    view.innerHTML =
      '<header class="room-head"><span class="numeral" aria-hidden="true">' + room.numeral + "</span>" +
        '<p class="eyebrow">' + icon(room.id, "sm") + esc(t("room.of", { n: room.numeral })) + "</p>" +
        '<h2 id="room-title" tabindex="-1">' + esc(room.title[lang]) + "</h2>" +
        '<p class="blurb">' + esc(room.blurb[lang]) + "</p></header>" +
      '<p class="filters-tally" id="tally" aria-live="polite" aria-atomic="true"></p>' +
      scaleCard + '<div class="groups">' + groups + "</div>" + nav;
    view.querySelectorAll(".room-link[data-room]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); showRoom(a.dataset.room, true); }));
    applyFilters();
    if (user) {
      const top = view.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
      document.getElementById("room-title").focus({ preventScroll: true });
    }
  }

  /* ============================== the dial ============================== */
  /* A butcher's scale: a half dial from 0.6 to 2 kg, the needle swings to the weight. */
  function dialSvg(frac, mini) {
    const cx = 200, cy = 200, r = 160;
    const ang = a => [cx + r * Math.cos(Math.PI * (1 - a)), cy - r * Math.sin(Math.PI * (1 - a))];
    let ticks = "";
    for (let g = 600; g <= 2000; g += 50) {
      const f = (g - 600) / 1400, major = g % 500 === 0, mid = g % 100 === 0;
      const len = major ? 22 : mid ? 13 : 7;
      const [x1, y1] = ang(f); const x2 = cx + (r - len) * Math.cos(Math.PI * (1 - f)), y2 = cy - (r - len) * Math.sin(Math.PI * (1 - f));
      ticks += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" class="' + (major ? "tk major" : "tk") + '"/>';
      if (major && !mini) { const lx = cx + (r - 40) * Math.cos(Math.PI * (1 - f)), ly = cy - (r - 40) * Math.sin(Math.PI * (1 - f)); ticks += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 6).toFixed(1) + '" text-anchor="middle" class="tl">' + (g / 1000).toFixed(g % 1000 ? 1 : 0).replace(".", lang === "it" ? "," : ".") + "</text>"; }
    }
    const deg = -90 + frac * 180;
    return '<svg class="dial' + (mini ? " mini" : "") + '" viewBox="0 20 400 200" aria-hidden="true">' +
      '<path class="arc" d="M40 200A160 160 0 0 1 360 200"/>' +
      '<path class="arc-fill" d="M40 200A160 160 0 0 1 360 200" pathLength="100" style="stroke-dasharray:' + (frac * 100).toFixed(1) + ' 100"/>' +
      ticks +
      '<g class="needle" id="' + (mini ? "" : "needle") + '" style="transform: rotate(' + deg.toFixed(2) + 'deg)"><path d="M200 200L194 190 200 52 206 190z"/><circle cx="200" cy="200" r="9"/></g>' +
      "</svg>";
  }

  pages.steak = function () {
    document.title = t("steak.title");
    setWall("#5A1420", "#F2E8D5", HERO.gold);
    applyStrings();
    const room = ROOMS.find(r => r.id === "bistecche");
    const cuts = room.groups.flatMap(g => g.items).filter(d => d.perKg);
    const host = document.getElementById("scale");
    const keep = host.querySelector("#scale-range") ? Number(host.querySelector("#scale-range").value) : 1200;
    const keepCut = host.querySelector('input[name="cut"]:checked') ? Number(host.querySelector('input[name="cut"]:checked').value) : cuts[0].price;
    host.innerHTML =
      '<div class="dial-wrap" id="dial-wrap">' + dialSvg((keep - 600) / 1400, false) + "</div>" +
      '<div class="scale-controls">' +
        '<div class="scale-cuts" role="radiogroup" aria-label="' + esc(t("steak.cut")) + '">' + cuts.map(c =>
          '<label><input type="radio" name="cut" value="' + c.price + '"' + (c.price === keepCut ? " checked" : "") + ">" + icon("bistecche", "sm") + '<span lang="it">' + esc(c.it) + "</span><b>" + money(c.price, "perkg") + "</b></label>").join("") + "</div>" +
        '<label class="range-label" for="scale-range">' + esc(t("steak.weight")) + "</label>" +
        '<input type="range" id="scale-range" min="600" max="2000" step="50" value="' + keep + '">' +
        '<div class="scale-ends"><span>600 g</span><span>2 kg</span></div>' +
      "</div>" +
      '<dl class="readout">' +
        '<div><dt>' + esc(t("steak.weight")) + '</dt><dd class="big" id="ro-kg"></dd><dd class="sub" id="ro-etti"></dd></div>' +
        '<div><dt>' + esc(t("steak.price")) + '</dt><dd class="big gold" id="ro-eur"></dd><dd class="sub" id="ro-each"></dd></div>' +
        '<div><dt>' + esc(t("steak.for").replace("{p}", "").trim() || "") + '</dt><dd class="big" id="ro-people"></dd><dd class="sub" id="ro-note">' + esc(t("steak.etti.note")) + "</dd></div>" +
      "</dl>";
    const range = document.getElementById("scale-range");
    const update = () => {
      const g = Number(range.value), perKg = Number(host.querySelector('input[name="cut"]:checked').value);
      const kg = g / 1000, price = Math.round(kg * perKg), people = Math.max(1, Math.round(kg / 0.55));
      const forWho = t("steak.for", { p: people === 1 ? t("steak.one") : t("steak.many", { n: people }) });
      document.getElementById("ro-kg").textContent = kgFmt(kg) + " kg";
      document.getElementById("ro-etti").textContent = t("steak.etti", { n: (g / 100) % 1 ? (g / 100).toFixed(1).replace(".", lang === "it" ? "," : ".") : g / 100 });
      document.getElementById("ro-eur").textContent = eur(price);
      document.getElementById("ro-each").textContent = eur(Math.round(price / people)) + " " + t("steak.each");
      document.getElementById("ro-people").textContent = people === 1 ? t("steak.one") : t("steak.many", { n: people });
      range.setAttribute("aria-valuetext", t("steak.valuetext", { kg: kgFmt(kg), eur: price, for: forWho }));
      const frac = (g - 600) / 1400;
      document.getElementById("needle").style.transform = "rotate(" + (-90 + frac * 180).toFixed(2) + "deg)";
      host.querySelector(".arc-fill").style.strokeDasharray = (frac * 100).toFixed(1) + " 100";
    };
    range.addEventListener("input", update);
    host.querySelectorAll('input[name="cut"]').forEach(r => r.addEventListener("change", update));
    update();
  };

  pages.visit = function () {
    document.title = t("visit.title");
    setWall(HERO.wall, HERO.ink, HERO.gold);
    applyStrings();
    const cell = (key, html) => '<div class="vi"><h3>' + esc(t(key)) + "</h3>" + (html ? "<p>" + html + "</p>" : '<p class="tbd">' + esc(t("visit.tbd")) + "</p>") + "</div>";
    const hours = SITE.hours && SITE.hours[lang];
    const tel = SITE.phone ? '<a href="tel:' + esc(SITE.phone.replace(/\s+/g, "")) + '">' + esc(SITE.phone) + "</a>" : "";
    const wa = SITE.whatsapp ? '<a href="https://wa.me/' + esc(SITE.whatsapp) + '" rel="noopener">' + esc(t("visit.wa")) + "</a>" : "";
    const addr = esc(t("visit.where")) + (SITE.address ? "<br>" + esc(SITE.address) : "") + (SITE.mapsUrl ? '<br><a href="' + esc(SITE.mapsUrl) + '" rel="noopener" target="_blank">' + esc(t("visit.maps")) + "</a>" : "");
    const ig = SITE.instagram ? '<a href="https://instagram.com/' + esc(SITE.instagram) + '" rel="noopener" target="_blank">@' + esc(SITE.instagram) + "</a>" : "";
    const hh = SITE.happyHour && SITE.happyHour.price ? esc(SITE.happyHour.drinks) + " · " + eur(SITE.happyHour.price) + (SITE.happyHour.when[lang] ? "<br>" + esc(SITE.happyHour.when[lang]) : "") : "";
    document.getElementById("visit-grid").innerHTML =
      cell("visit.hours", hours) + cell("visit.address", addr) + cell("visit.phone", tel + (tel && wa ? "<br>" : "") + wa) +
      (ig ? cell("visit.ig", ig) : "") + (hh ? cell("visit.hh", hh) : "");
    const link = SITE.reviewUrl ? '<a class="btn small" href="' + esc(SITE.reviewUrl) + '" rel="noopener" target="_blank">' + esc(t("review.cta")) + "</a>" : "";
    document.getElementById("review").innerHTML = '<div class="qr" aria-hidden="true">' + icon("visit") + "</div><div><h3>" + esc(t("review.title")) + "</h3><p>" + esc(t("review.text")) + "</p>" + link + "</div>";
  };

  /* ============================== boot ============================== */
  function render() {
    renderShell();
    if (pages[page]) pages[page]();
  }
  render();
})();
