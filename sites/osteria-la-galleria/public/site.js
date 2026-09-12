/* Osteria La Galleria — renders the rooms from menu.js, handles the language switch, the diet filters,
   the wall-colour walk and the steak scale. No framework, no build step. */
(function () {
  "use strict";

  const T = {
    "skip":                { it: "Vai al menu", en: "Skip to the menu" },
    "nav.reserve":         { it: "Prenota", en: "Reserve" },
    "hero.eyebrow":        { it: "Firenze · Di fronte a Palazzo Pitti", en: "Florence · Opposite Palazzo Pitti" },
    "hero.plaque.medium":  { it: "Cucina toscana · Chianina IGP · Tartufo fresco · Pinsa · Buchetta del vino", en: "Tuscan kitchen · Chianina IGP beef · Fresh truffle · Pinsa · Wine window" },
    "atrio.eyebrow":       { it: "Prima di entrare", en: "Before you come in" },
    "atrio.title":         { it: "La buchetta del vino", en: "The wine window" },
    "atrio.text":          { it: "Sulla facciata c'è una buchetta: la finestrella da cui, dal Cinquecento, i fiorentini si facevano passare un bicchiere di vino senza entrare. La nostra è ancora aperta. Un bicchiere in piedi, davanti a Palazzo Pitti, e poi si comincia la visita.",
                             en: "There is a little window in the façade: the hatch through which, since the 1500s, Florentines have been handed a glass of wine without coming in. Ours is still open. A glass standing up, in front of Palazzo Pitti, and then the visit begins." },
    "atrio.facts":         { it: "Vino al bicchiere da 7 € · Happy hour: Spritz e Hugo 7 €", en: "Wine by the glass from €7 · Happy hour: Spritz & Hugo €7" },
    "atrio.cta":           { it: "La cantina, sala X", en: "The cellar, room X" },
    "hero.plaque.line":    { it: "Dieci sale. Una cucina.", en: "Ten rooms. One kitchen." },
    "hero.lede":           { it: "Un menu da visitare come una galleria: dieci sale, ognuna col suo colore, ogni piatto con la sua targhetta. Scegli la lingua, spegni la luce sui piatti che non fanno per te, e pesa la tua fiorentina prima ancora di sederti.",
                             en: "A menu you visit like a gallery: ten rooms, each with its own colour, every dish with its own plaque. Pick your language, turn the light off on the dishes that aren't for you, and weigh your fiorentina before you even sit down." },
    "hero.cta":            { it: "Inizia la visita", en: "Start the visit" },
    "hero.cta2":           { it: "Dritto alla bistecca", en: "Straight to the steak" },
    "hh":                  { it: "Happy hour · Spritz e Hugo · 7 €", en: "Happy hour · Spritz & Hugo · €7" },
    "route.label":         { it: "Percorso", en: "Route" },
    "filter.button":       { it: "Cosa non mangi?", en: "What don't you eat?" },
    "filter.note":         { it: "I piatti che non fanno per te restano appesi, ma con la luce spenta. Per gli allergeni chiedi sempre in sala: la cucina è una sola.",
                             en: "Dishes that aren't for you stay on the wall, with the light off. Always ask the staff about allergens: there is only one kitchen." },
    "filter.veg":          { it: "Vegetariano", en: "Vegetarian" },
    "filter.gluten":       { it: "Senza glutine", en: "No gluten" },
    "filter.milk":         { it: "Senza latte", en: "No milk" },
    "filter.egg":          { it: "Senza uova", en: "No eggs" },
    "filter.nuts":         { it: "Senza frutta a guscio", en: "No nuts" },
    "filter.sea":          { it: "Senza pesce e frutti di mare", en: "No fish or seafood" },
    "filter.tally":        { it: "{n} opere in mostra su {t}", en: "{n} of {t} works on view" },
    "per2":                { it: "per due", en: "for two" },
    "perkg":               { it: "al kg", en: "per kg" },
    "star.note":           { it: "* Prodotto che può essere surgelato all'origine.", en: "* Product may be frozen at origin." },
    "v.note":              { it: "piatto vegetariano.", en: "vegetarian dish." },
    "scale.title":         { it: "La bilancia", en: "The scale" },
    "scale.text":          { it: "Le bistecche si pesano crude, con l'osso, e si pagano al chilo. Sposta il cursore e sai cosa spendi prima di ordinare.",
                             en: "Steaks are weighed raw, on the bone, and priced by the kilo. Slide to see what you'll pay before you order." },
    "scale.for":           { it: "indicativamente per {p}", en: "roughly for {p}" },
    "scale.one":           { it: "una persona", en: "one person" },
    "scale.many":          { it: "{n} persone", en: "{n} people" },
    "scale.kg":            { it: "kg", en: "kg" },
    "visit.eyebrow":       { it: "Fine della visita", en: "End of the visit" },
    "visit.title":         { it: "Vieni a trovarci", en: "Come and find us" },
    "visit.hours":         { it: "Orari", en: "Hours" },
    "visit.address":       { it: "Indirizzo", en: "Address" },
    "visit.where":         { it: "Di fronte a Palazzo Pitti", en: "Opposite Palazzo Pitti" },
    "visit.phone":         { it: "Telefono", en: "Phone" },
    "visit.wa":            { it: "Scrivici su WhatsApp", en: "Message us on WhatsApp" },
    "visit.maps":          { it: "Apri in Google Maps", en: "Open in Google Maps" },
    "visit.ig":            { it: "Instagram", en: "Instagram" },
    "visit.hh":            { it: "Happy hour", en: "Happy hour" },
    "visit.tbd":           { it: "In arrivo", en: "Coming soon" },
    "review.title":        { it: "Lasciaci una recensione", en: "Leave us a review" },
    "review.text":         { it: "Ti è piaciuto? Due righe su Google ci aiutano più di quanto pensi. Grazie.", en: "Enjoyed it? Two lines on Google help us more than you'd think. Thank you." },
    "review.cta":          { it: "Scrivi su Google", en: "Write on Google" },
    "legend.title":        { it: "Allergeni", en: "Allergens" },
    "footer.prices":       { it: "Prezzi in euro.", en: "Prices in euro." },
    "footer.credit":       { it: "un sito Locali & Ordinazioni", en: "a Locali & Ordinazioni site" },
    "title":               { it: "Osteria La Galleria — Firenze", en: "Osteria La Galleria — Florence" },
  };

  const FILTERS = [
    { id: "veg",    key: "filter.veg",    test: d => !!d.v },
    { id: "gluten", key: "filter.gluten", avoid: [1] },
    { id: "milk",   key: "filter.milk",   avoid: [7] },
    { id: "egg",    key: "filter.egg",    avoid: [3] },
    { id: "nuts",   key: "filter.nuts",   avoid: [5, 8] },
    { id: "sea",    key: "filter.sea",    avoid: [2, 4, 14] },
  ];

  const ROOMS = window.ROOMS, ALLERGENS = window.ALLERGENS, SITE = window.SITE;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let lang = (() => {
    const q = new URLSearchParams(location.search).get("lang");
    if (q === "it" || q === "en") return q;
    try { const s = localStorage.getItem("galleria.lang"); if (s === "it" || s === "en") return s; } catch (e) {}
    return (navigator.language || "en").toLowerCase().startsWith("it") ? "it" : "en";
  })();
  const active = new Set();

  const t = (k, vars) => {
    let s = (T[k] && T[k][lang]) || (T[k] && T[k].it) || k;
    if (vars) for (const [key, v] of Object.entries(vars)) s = s.replace("{" + key + "}", v);
    return s;
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = (n, unit) => {
    const num = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
    const s = lang === "it" ? num.replace(".", ",") + " €" : "€" + num;
    return unit ? s + "<small>" + esc(t(unit)) + "</small>" : s;
  };

  /* ---------- static strings ---------- */
  function applyStrings() {
    document.documentElement.lang = lang;
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll(".lang button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    document.getElementById("hh").hidden = !(SITE.happyHour && SITE.happyHour.price);
  }

  /* ---------- rooms ---------- */
  function dishHtml(d, room) {
    const marks = d.v ? ' <span class="vmark" title="' + esc(t("v.note")) + '">V</span>' : "";
    const star = d.star ? "<sup>*</sup>" : "";
    let desc = lang === "it" ? (d.dit || "") : (d.en || "");
    if (desc.trim().toLowerCase() === d.it.trim().toLowerCase()) desc = "";
    const al = (d.a || []).slice().sort((a, b) => a - b);
    const alHtml = al.length
      ? '<span class="allergens" title="' + esc(al.map(n => ALLERGENS[n][lang]).join(", ")) + '">' + al.join(" · ") + "</span>"
      : '<span class="allergens none">—</span>';
    const unit = d.perKg ? "perkg" : (d.per2 ? "per2" : null);
    const cls = ["work", d.feature ? "feature" : ""].join(" ").trim();
    return '<li class="' + cls + '" data-a="' + al.join(",") + '" data-v="' + (d.v ? 1 : 0) + '">' +
      '<article class="plaque">' +
        '<h4 class="work-title">' + esc(d.it) + star + marks + "</h4>" +
        (desc ? '<p class="work-desc">' + esc(desc) + "</p>" : '<p class="work-desc"></p>') +
        '<div class="work-meta">' + alHtml + '<span class="price">' + money(d.price, unit) + "</span></div>" +
      "</article></li>";
  }

  function scaleHtml(room) {
    const cuts = room.groups.flatMap(g => g.items).filter(d => d.perKg);
    return '<div class="scale" id="scale">' +
      '<div><h3>' + esc(t("scale.title")) + "</h3><p>" + esc(t("scale.text")) + "</p></div>" +
      '<div>' +
        '<div class="scale-cuts" role="radiogroup">' + cuts.map((c, i) =>
          '<label><input type="radio" name="cut" value="' + c.price + '"' + (i === 0 ? " checked" : "") + ">" + esc(c.it) + " · " + money(c.price, "perkg") + "</label>").join("") + "</div>" +
        '<div class="scale-readout"><span class="scale-kg" id="scale-kg"></span><span class="scale-eur" id="scale-eur"></span></div>' +
        '<input type="range" id="scale-range" min="600" max="2000" step="50" value="1000" aria-label="' + esc(t("scale.kg")) + '">' +
        '<div class="scale-for"><span>600 g</span><span id="scale-for"></span><span>2 kg</span></div>' +
      "</div></div>";
  }

  function renderRooms() {
    const host = document.getElementById("rooms");
    host.innerHTML = ROOMS.map(room => {
      const groups = room.groups.map(g =>
        '<div class="group">' + (g.title ? '<h3 class="group-title">' + esc(g.title[lang]) + "</h3>" : "") +
        '<ol class="works">' + g.items.map(d => dishHtml(d, room)).join("") + "</ol></div>").join("");
      return '<section class="room' + (room.compact ? " compact" : "") + '" id="room-' + room.id + '" data-wall="' + room.wall + '" data-ink="' + room.ink + '" aria-labelledby="h-' + room.id + '">' +
        '<div class="rail" aria-hidden="true"></div>' +
        '<header class="room-head"><span class="numeral" aria-hidden="true">' + room.numeral + "</span>" +
          '<h2 id="h-' + room.id + '">' + esc(room.title[lang]) + "</h2>" +
          '<p class="blurb">' + esc(room.blurb[lang]) + "</p></header>" +
        (room.scale ? scaleHtml(room) : "") +
        '<div class="groups">' + groups + "</div>" +
      "</section>";
    }).join("");

    document.getElementById("route-pills").innerHTML = ROOMS.map(r =>
      '<a class="route-pill" href="#room-' + r.id + '" data-room="' + r.id + '"><b>' + r.numeral + "</b>" + esc(r.title[lang]) + "</a>").join("");

    if (document.getElementById("scale")) wireScale();
    applyFilters();
    observeRooms();
  }

  /* ---------- the scale ---------- */
  function wireScale() {
    const range = document.getElementById("scale-range");
    const update = () => {
      const g = Number(range.value);
      const perKg = Number(document.querySelector('input[name="cut"]:checked').value);
      const kg = g / 1000;
      const eur = Math.round(kg * perKg);
      const people = Math.max(1, Math.round(kg / 0.55));
      document.getElementById("scale-kg").innerHTML = (lang === "it" ? kg.toFixed(2).replace(".", ",") : kg.toFixed(2)) + "<small>" + t("scale.kg") + "</small>";
      document.getElementById("scale-eur").textContent = lang === "it" ? eur + " €" : "€" + eur;
      document.getElementById("scale-for").textContent = t("scale.for", { p: people === 1 ? t("scale.one") : t("scale.many", { n: people }) });
    };
    range.addEventListener("input", update);
    document.querySelectorAll('input[name="cut"]').forEach(r => r.addEventListener("change", update));
    update();
  }

  /* ---------- filters ---------- */
  function renderChips() {
    document.getElementById("chips").innerHTML = FILTERS.map(f =>
      '<label class="chip"><input type="checkbox" value="' + f.id + '"' + (active.has(f.id) ? " checked" : "") + "><i></i>" + esc(t(f.key)) + "</label>").join("");
    document.querySelectorAll("#chips input").forEach(cb => cb.addEventListener("change", () => {
      cb.checked ? active.add(cb.value) : active.delete(cb.value);
      applyFilters();
    }));
  }

  function applyFilters() {
    const works = document.querySelectorAll(".work");
    let on = 0;
    works.forEach(w => {
      const al = w.dataset.a ? w.dataset.a.split(",").map(Number) : [];
      const v = w.dataset.v === "1";
      let ok = true;
      active.forEach(id => {
        const f = FILTERS.find(x => x.id === id);
        if (f.test) ok = ok && v;
        else ok = ok && !f.avoid.some(n => al.includes(n));
      });
      w.classList.toggle("off", !ok);
      if (ok) on++;
    });
    const tally = document.getElementById("tally");
    tally.textContent = active.size ? t("filter.tally", { n: on, t: works.length }) : "";
    const count = document.getElementById("filter-count");
    count.hidden = !active.size;
    count.textContent = active.size;
  }

  /* ---------- walk: wall colour + active pill ---------- */
  let roomObs;
  function observeRooms() {
    if (roomObs) roomObs.disconnect();
    const root = document.documentElement;
    const setWall = (wall, ink, gold, id) => {
      root.style.setProperty("--wall", wall);
      root.style.setProperty("--ink", ink);
      root.style.setProperty("--gold", gold);
      root.style.setProperty("--gold-soft", "color-mix(in srgb, " + gold + " 45%, transparent)");
      root.style.setProperty("--muted", "color-mix(in srgb, " + ink + " 64%, transparent)");
      document.querySelector('meta[name="theme-color"]').setAttribute("content", wall);
      document.querySelectorAll(".route-pill").forEach(p => p.classList.toggle("active", p.dataset.room === id));
      const pill = document.querySelector(".route-pill.active");
      if (pill) pill.scrollIntoView({ block: "nearest", inline: "center", behavior: reduced ? "auto" : "smooth" });
    };
    const HERO = { wall: "#3E1219", ink: "#F2E8D5", gold: "#C9A55C" };
    roomObs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const el = e.target;
        if (el.dataset.wall) setWall(el.dataset.wall, el.dataset.ink, el.dataset.gold || HERO.gold, el.id.replace("room-", ""));
        else setWall(HERO.wall, HERO.ink, HERO.gold, null);
      });
    }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });
    document.querySelectorAll(".hero, .atrio, .room, .visit").forEach(s => roomObs.observe(s));
  }


  /* ---------- visit info ---------- */
  function renderVisit() {
    const cell = (key, html, tbd) => '<div class="vi"><h3>' + esc(t(key)) + "</h3>" + (html ? "<p>" + html + "</p>" : '<p class="tbd">' + esc(t("visit.tbd")) + "</p>") + "</div>";
    const hours = SITE.hours && SITE.hours[lang];
    const tel = SITE.phone ? '<a href="tel:' + esc(SITE.phone.replace(/\s+/g, "")) + '">' + esc(SITE.phone) + "</a>" : "";
    const wa = SITE.whatsapp ? '<a href="https://wa.me/' + esc(SITE.whatsapp) + '" rel="noopener">' + esc(t("visit.wa")) + "</a>" : "";
    const addr = esc(t("visit.where")) + (SITE.address ? "<br>" + esc(SITE.address) : "") + (SITE.mapsUrl ? '<br><a href="' + esc(SITE.mapsUrl) + '" rel="noopener" target="_blank">' + esc(t("visit.maps")) + "</a>" : "");
    const ig = SITE.instagram ? '<a href="https://instagram.com/' + esc(SITE.instagram) + '" rel="noopener" target="_blank">@' + esc(SITE.instagram) + "</a>" : "";
    const hh = SITE.happyHour && SITE.happyHour.price ? esc(SITE.happyHour.drinks) + " · " + (lang === "it" ? SITE.happyHour.price + " €" : "€" + SITE.happyHour.price) + (SITE.happyHour.when[lang] ? "<br>" + esc(SITE.happyHour.when[lang]) : "") : "";
    document.getElementById("visit-grid").innerHTML =
      cell("visit.hours", hours) + cell("visit.address", addr) + cell("visit.phone", tel + (tel && wa ? "<br>" : "") + wa) +
      (ig ? cell("visit.ig", ig) : "") + (hh ? cell("visit.hh", hh) : "");

    const qr = '<div class="qr" aria-hidden="true"><svg viewBox="0 0 21 21" fill="#1E1A17"><path d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2zM9 0h1v2H9zM11 0h1v1h-1zM9 3h3v1H9zM8 5h1v3H8zM10 5h2v1h-2zM12 4h1v3h-1zM0 8h2v1H0zM3 8h1v2H3zM5 8h3v1H5zM9 8h2v2H9zM12 8h2v1h-2zM15 8h1v1h-1zM17 8h4v1h-4zM0 10h1v2H0zM2 10h1v1H2zM4 11h3v1H4zM8 10h1v2H8zM10 11h3v1h-3zM14 10h2v2h-2zM17 10h1v2h-1zM19 10h2v1h-2zM1 12h2v1H1zM9 12h1v1H9zM11 13h2v1h-2zM16 12h1v1h-1zM18 12h3v1h-3zM8 14h1v3H8zM10 14h2v1h-2zM13 14h1v2h-1zM15 14h1v1h-1zM17 14h1v2h-1zM19 14h2v2h-2zM9 16h3v1H9zM14 16h2v1h-2zM8 18h1v3H8zM10 18h1v1h-1zM12 17h1v4h-1zM14 18h3v1h-3zM18 17h1v1h-1zM20 17h1v2h-1zM10 20h2v1h-2zM14 20h1v1h-1zM16 19h2v2h-2zM19 20h2v1h-2z"/></svg></div>';
    const link = SITE.reviewUrl ? '<a class="btn small" href="' + esc(SITE.reviewUrl) + '" rel="noopener" target="_blank">' + esc(t("review.cta")) + "</a>" : "";
    document.getElementById("review").innerHTML = qr + "<div><h3>" + esc(t("review.title")) + "</h3><p>" + esc(t("review.text")) + "</p>" + link + "</div>";

    document.getElementById("legend").innerHTML = '<span class="legend-title">' + esc(t("legend.title")) + "</span>" +
      Object.keys(ALLERGENS).map(n => "<span><b>" + n + "</b>" + esc(ALLERGENS[n][lang]) + "</span>").join("");
  }

  /* ---------- boot ---------- */
  function render() {
    applyStrings();
    renderChips();
    renderRooms();
    renderVisit();
  }

  document.querySelectorAll(".lang button").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    try { localStorage.setItem("galleria.lang", lang); } catch (e) {}
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }));

  const ft = document.getElementById("filter-toggle"), fp = document.getElementById("filters");
  ft.addEventListener("click", () => {
    const open = ft.getAttribute("aria-expanded") === "true";
    ft.setAttribute("aria-expanded", String(!open));
    fp.hidden = open;
  });

  render();
})();
