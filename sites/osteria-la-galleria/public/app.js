/* Osteria La Galleria — shared shell (header, tab bar, footer), language, the drawn plates, and the four page
   modules: home, menu (picture against plaque, one room at a time), steak (the dial), visit. Data lives in menu.js,
   the drawings in art.js, the owner's own dish photos in img/dishes/ (listed by photos.js). */
(function () {
  "use strict";

  /* ============================== strings ============================== */
  const T = {
    "nav.home":     { it: "Galleria", en: "Gallery" },
    "nav.menu":     { it: "Il menu", en: "The menu" },
    "nav.steak":    { it: "La bistecca", en: "The steak" },
    "nav.visit":    { it: "Visita", en: "Visit" },
    "nav.reserve":  { it: "Prenota", en: "Reserve" },
    "nav.book":     { it: "Prenota", en: "Book" },
    /* booking */
    "book.title":     { it: "Prenota — Osteria La Galleria", en: "Book — Osteria La Galleria" },
    "book.eyebrow":   { it: "Prenota un tavolo", en: "Book a table" },
    "book.h1":        { it: "Il tuo tavolo davanti a Palazzo Pitti", en: "Your table in front of Palazzo Pitti" },
    "book.lede":      { it: "Scegli giorno, ora e quanti siete. Se vuoi, dopo puoi pre-ordinare i piatti e pagare online: li trovi pronti quando ti siedi.", en: "Pick a day, a time and how many you are. Afterwards, if you like, pre-order your dishes and pay online: they'll be ready when you sit down." },
    "book.party":     { it: "Quante persone", en: "How many people" },
    "book.party.hint": { it: "Oltre {n} persone, chiamateci.", en: "For more than {n}, please call us." },
    "book.date":      { it: "Quando", en: "When" },
    "book.time":      { it: "A che ora", en: "What time" },
    "book.name":      { it: "Nome", en: "Name" },
    "book.phone":     { it: "Telefono", en: "Phone" },
    "book.email":     { it: "Email", en: "Email" },
    "book.email.hint": { it: "Per la conferma e per gestire la prenotazione.", en: "For the confirmation and to manage the booking." },
    "book.note":      { it: "Note per noi", en: "Notes for us" },
    "book.note.hint": { it: "Allergie, un seggiolone, un compleanno…", en: "Allergies, a high chair, a birthday…" },
    "book.submit":    { it: "Prenota il tavolo", en: "Book the table" },
    "book.sending":   { it: "Un attimo…", en: "One moment…" },
    "book.pick":      { it: "Scegli prima giorno e persone.", en: "Pick a day and how many you are first." },
    "book.closed":    { it: "Quel giorno siamo chiusi.", en: "We're closed that day." },
    "book.full":      { it: "Nessun orario libero per {n} persone quel giorno.", en: "No free time for {n} that day." },
    "book.past":      { it: "Scegli una data da oggi in poi.", en: "Pick today or a later date." },
    "book.offline":   { it: "In questa anteprima la prenotazione online non è attiva. Chiamaci, o scrivici su WhatsApp.", en: "Online booking isn't active in this preview. Call us, or message us on WhatsApp." },
    "book.call":      { it: "Preferisci il telefono?", en: "Prefer to call?" },
    "res.confirmed":  { it: "Tavolo confermato", en: "Table confirmed" },
    "res.requested":  { it: "Richiesta ricevuta, la confermiamo a breve", en: "Request received, we'll confirm shortly" },
    "res.seated":     { it: "Al tavolo", en: "At the table" },
    "res.done":       { it: "Conclusa", en: "Done" },
    "res.cancelled":  { it: "Prenotazione disdetta", en: "Reservation cancelled" },
    "res.no_show":    { it: "Non presentati", en: "No show" },
    "res.when":       { it: "Quando", en: "When" },
    "res.who":        { it: "Persone", en: "People" },
    "res.name":       { it: "A nome di", en: "Under the name" },
    "res.note":       { it: "Le tue note", en: "Your notes" },
    "res.keep":       { it: "Tieni questa pagina: è il tuo link per vedere o disdire la prenotazione. Se hai lasciato l'email, l'hai anche lì.", en: "Keep this page: it's your link to see or cancel the booking. If you left an email, it's there too." },
    "res.cancel":     { it: "Disdici la prenotazione", en: "Cancel the reservation" },
    "res.cancel.ask": { it: "Disdire davvero la prenotazione?", en: "Really cancel the reservation?" },
    "res.cancel.late": { it: "Per disdire a meno di due ore dal tavolo, chiamaci.", en: "To cancel less than two hours before, please call us." },
    "res.notfound":   { it: "Prenotazione non trovata. Controlla il link nell'email.", en: "Reservation not found. Check the link in your email." },
    "res.new":        { it: "Prenota un altro tavolo", en: "Book another table" },
    "pre.eyebrow":    { it: "Pre-ordina e paga online", en: "Pre-order and pay online" },
    "pre.title":      { it: "Trova i piatti pronti quando ti siedi", en: "Find your dishes ready when you sit down" },
    "pre.text":       { it: "Scegli dal menu, paga con carta, e la cucina sa cosa preparare per il tuo tavolo. La fiorentina no: quella si pesa al momento.", en: "Choose from the menu, pay by card, and the kitchen knows what to prepare for your table. Not the fiorentina: that one is weighed on the spot." },
    "pre.note":       { it: "Note per la cucina", en: "Notes for the kitchen" },
    "pre.pay":        { it: "Paga con carta", en: "Pay by card" },
    "pre.hint":       { it: "Pagamento sicuro con carta tramite Stripe. I piatti pre-ordinati risultano già pagati al tavolo.", en: "Secure card payment through Stripe. Pre-ordered dishes show as already paid at the table." },
    "pre.table":      { it: "si pesa al tavolo", en: "weighed at the table" },
    "pre.count":      { it: "{n} piatti", en: "{n} dishes" },
    "pre.paid":       { it: "Pre-ordine pagato", en: "Pre-order paid" },
    "pre.pending":    { it: "Pagamento in corso", en: "Payment in progress" },
    "pre.thanks":     { it: "Grazie, il pagamento è andato a buon fine. I piatti saranno pronti al tavolo.", en: "Thank you, the payment went through. Your dishes will be ready at the table." },
    "pre.canceled":   { it: "Pagamento non completato. Puoi riprovare quando vuoi.", en: "Payment not completed. You can try again whenever you like." },
    "pre.min":        { it: "Pre-ordine minimo: {x}", en: "Minimum pre-order: {x}" },
    "pre.more":       { it: "Aggiungi altro", en: "Add more" },
    "pre.soon":       { it: "Il pre-ordine online arriva presto. Intanto ordini al tavolo.", en: "Online pre-ordering is coming soon. For now, order at the table." },
    "nav.findus":   { it: "Dove siamo", en: "Find us" },
    "skip":         { it: "Vai al contenuto", en: "Skip to content" },
    "footer.prices": { it: "Prezzi in euro.", en: "Prices in euro." },
    "footer.credit": { it: "un sito Locali & Ordinazioni", en: "a Locali & Ordinazioni site" },
    "footer.where": { it: "Di fronte a Palazzo Pitti, Firenze", en: "Opposite Palazzo Pitti, Florence" },
    "footer.art":   { it: "I piatti disegnati sono illustrazioni, non fotografie dei piatti serviti.", en: "The drawn plates are illustrations, not photographs of the dishes served." },
    "star.note":    { it: "* Prodotto che può essere surgelato all'origine.", en: "* Product may be frozen at origin." },
    "v.note":       { it: "piatto vegetariano.", en: "vegetarian dish." },
    "legend.title": { it: "Allergeni", en: "Allergens" },
    "per2":         { it: "per due", en: "for two" },
    "perkg":        { it: "al kg", en: "per kg" },
    "hh":           { it: "Happy hour · Spritz e Hugo · 7 €", en: "Happy hour · Spritz & Hugo · €7" },

    /* home */
    "home.title":     { it: "Osteria La Galleria — Firenze", en: "Osteria La Galleria — Florence" },
    "hero.eyebrow":   { it: "Firenze · Di fronte a Palazzo Pitti", en: "Florence · Opposite Palazzo Pitti" },
    "hero.lede":      { it: "Una galleria dove le opere si mangiano. Dieci sale in ordine di portata, ogni piatto appeso con la sua targhetta, e una bilancia per la fiorentina. La visita comincia dalla finestrella sulla facciata.",
                        en: "A gallery where the works are eaten. Ten rooms in course order, every dish hung with its own plaque, and a scale for the fiorentina. The visit begins at the little window in the façade." },
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
    "salas.eyebrow":  { it: "Le sale", en: "The rooms" },
    "salas.title":    { it: "Dieci sale, in ordine di portata", en: "Ten rooms, in course order" },
    "salas.text":     { it: "Ogni sala è una portata. Dentro, ogni piatto è appeso con la sua targhetta: nome, cosa c'è dentro, allergeni, prezzo. Entra in una sala.",
                        en: "Each room is a course. Inside, every dish hangs with its own plaque: name, what's in it, allergens, price. Step into a room." },
    "salas.count":    { it: "{n} opere", en: "{n} works" },
    "teaser.eyebrow": { it: "Sala VI", en: "Room VI" },
    "teaser.title":   { it: "Una bistecca non si ordina. Si pesa.", en: "You don't order a steak here. You weigh it." },
    "teaser.text":    { it: "La fiorentina si paga al chilo. Sposta l'ago e sai cosa spendi, per quante persone, prima ancora di sederti.",
                        en: "The fiorentina is priced by the kilo. Move the needle and you know what you'll pay, and for how many, before you sit down." },
    "teaser.cta":     { it: "Vai alla bilancia", en: "Go to the scale" },
    "rooms.eyebrow":  { it: "Da noi", en: "Our place" },
    "rooms.title":    { it: "Dove si mangia", en: "Where you eat" },
    "rooms.cta":      { it: "Orari, indirizzo, recensioni", en: "Hours, address, reviews" },

    /* menu */
    "menu.title":     { it: "Il menu — Osteria La Galleria", en: "The menu — Osteria La Galleria" },
    "menu.eyebrow":   { it: "Il menu, sala per sala", en: "The menu, room by room" },
    "menu.h1":        { it: "Il menu", en: "The menu" },
    "menu.intro":     { it: "Da una parte il piatto, dall'altra la sua targhetta. Scegli una sala qui sotto e scorri.", en: "The dish on one side, its plaque on the other. Pick a room below and scroll." },
    "menu.tabs":      { it: "Le sale", en: "The rooms" },
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
    "plan.exit":      { it: "Uscita", en: "Exit" },
    "room.prev":      { it: "Sala precedente", en: "Previous room" },
    "room.next":      { it: "Sala successiva", en: "Next room" },
    "room.toStart":   { it: "Torna all'ingresso", en: "Back to the entrance" },
    "room.exit":      { it: "Fine della visita: vieni a trovarci", en: "End of the visit: come and find us" },
    "room.scaleCard": { it: "La bilancia", en: "The scale" },
    "room.scaleText": { it: "Fiorentina e costola si pagano al chilo. Pesa la tua su una pagina tutta sua.", en: "Fiorentina and costola are priced by the kilo. Weigh yours on a page of its own." },
    "room.scaleCta":  { it: "Apri la bilancia", en: "Open the scale" },
    "work.n":         { it: "Opera {n} di {t}", en: "Work {n} of {t}" },
    "work.drawn":     { it: "Disegno", en: "Drawing" },
    "work.photo":     { it: "Fotografia", en: "Photograph" },
    "work.video":     { it: "Video", en: "Video" },
    "work.from":      { it: "Dagli ingredienti al piatto", en: "From the ingredients to the dish" },
    "work.replay":    { it: "Rivedi", en: "Play again" },

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
    "steak.for":      { it: "indicativamente per", en: "roughly for" },
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
    home: '<path d="M4 21V10l8-6 8 6v11"/><path d="M10 21v-6h4v6"/>',
    menu: '<rect x="3" y="4" width="18" height="16" rx="1"/><rect x="6" y="7" width="12" height="10"/><path d="M8 15h8"/>',
    steak: '<path d="M6 5c4-1 8 0 11 2 2 2 2 5 0 7-1 2-4 3-7 4-3 1-5 0-6-2-1-3-1-8 2-11z"/><path d="M8 5v7l5 4"/>',
    visit: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    book: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><path d="M3 12h1M20 12h1"/>',
    filter: '<path d="M3 5h18M6 12h12M10 19h4"/>',
  };
  const icon = (id, cls) => '<svg class="ic ' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[id] || "") + "</svg>";

  /* ============================== state + helpers ============================== */
  const ROOMS = window.ROOMS, ALLERGENS = window.ALLERGENS, SITE = window.SITE, ART = window.ART || {}, PHOTOS = new Set(window.DISH_PHOTOS || []);
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
  const slug = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  /* The picture of a dish: the owner's clip or photo when one exists in img/dishes/ (listed in photos.js), else the
     drawing, built in steps so it can assemble itself from the ingredients to the finished plate. */
  function mediaFor(d) {
    if (d.video) return { kind: "video", src: d.video };
    if (d.img) return { kind: "photo", src: d.img };
    const s = slug(d.it);
    for (const ext of ["mp4", "webm"]) if (PHOTOS.has(s + "." + ext)) return { kind: "video", src: "img/dishes/" + s + "." + ext };
    for (const ext of ["webp", "jpg", "jpeg", "png"]) if (PHOTOS.has(s + "." + ext)) return { kind: "photo", src: "img/dishes/" + s + "." + ext };
    return null;
  }
  function pictureHtml(d, room, mode) {
    const m = mediaFor(d);
    if (m && m.kind === "video") return '<video class="dish-video" src="' + esc(m.src) + '" autoplay muted loop playsinline' + (mode === "card" ? "" : ' preload="metadata"') + "></video>";
    if (m) return '<img class="dish-photo" src="' + esc(m.src) + '" alt="" loading="' + (mode === "stage" ? "eager" : "lazy") + '">';
    const base = (ART.BASE && ART.BASE[d.base]) || (ART.BASE && ART.BASE.plate);
    const parts = [base ? base.svg : ""].concat((d.steps || []).map(k => (ART.ING[k] || { svg: "" }).svg));
    return '<svg class="dish-art' + (mode === "card" ? " still" : "") + '" viewBox="0 0 400 300" aria-hidden="true"><rect width="400" height="300" fill="' + room.wall + '"/>' +
      parts.map((part, i) => '<g class="step" style="--i:' + i + '">' + part + "</g>").join("") + "</svg>";
  }
  /* The ingredient names, in the order they land: the base first, then each step. */
  function ingredients(d) {
    const base = ART.BASE && ART.BASE[d.base] || ART.BASE.plate;
    return [base ? base[lang] : ""].concat((d.steps || []).map(k => (ART.ING[k] || {})[lang] || k));
  }
  const ingsHtml = (d, cls) => '<span class="ings ' + (cls || "") + '">' + ingredients(d).map((x, i) => '<span class="ing" style="--i:' + i + '">' + esc(x) + "</span>").join("") + "</span>";

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
    { href: "prenota.html", key: "nav.book", id: "book", ic: "book" },
  ];
  function ctaHtml(cls) {
    return '<a class="btn small ' + cls + '" href="prenota.html">' + esc(t("nav.reserve")) + "</a>";
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
      '<nav class="tabbar" aria-label="Sito">' + NAV.filter(n => n.id !== "visit" || page === "visit").map(n => '<a href="' + n.href + '"' + (n.id === page ? ' aria-current="page"' : "") + ">" + icon(n.ic) + "<span>" + esc(t(n.key)) + "</span></a>").join("") + "</nav>";
    document.querySelectorAll(".lang button").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.lang === lang) return;
      lang = b.dataset.lang;
      try { localStorage.setItem("galleria.lang", lang); } catch (e) {}
      render();
    }));

    const legend = page === "menu" || page === "steak"
      ? '<div class="legend"><span class="legend-title">' + esc(t("legend.title")) + "</span>" + Object.keys(ALLERGENS).map(n => "<span><b>" + n + "</b>" + esc(ALLERGENS[n][lang]) + "</span>").join("") + "</div>" +
        '<p class="foot-line">' + esc(t("footer.prices")) + " " + esc(t("star.note")) + ' <span class="vmark">V</span> ' + esc(t("v.note")) + (page === "menu" ? " " + esc(t("footer.art")) : "") + "</p>"
      : "";
    document.getElementById("shell-foot").innerHTML = '<footer class="foot">' + legend +
      '<p class="foot-credit"><span class="brand-foot">Osteria La Galleria</span> · ' + esc(t("footer.where")) + " · " + esc(t("footer.credit")) + "</p></footer>";
  }
  function applyStrings(root) {
    (root || document).querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
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
    const works = document.querySelectorAll("#entries .entry");
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
    document.getElementById("hh").hidden = !(SITE.happyHour && SITE.happyHour.price);
    document.getElementById("salas").innerHTML = ROOMS.map(r => {
      const items = r.groups.flatMap(g => g.items);
      const pick = items.find(d => d.feature) || items[0];
      return '<a class="sala-card" href="menu.html#' + r.id + '" style="--room:' + r.wall + '">' +
        '<div class="sala-pic">' + pictureHtml(pick, r, "card") + "</div>" +
        '<div class="sala-plaque plaque"><span class="sala-n">' + r.numeral + '</span><h3 lang="' + lang + '">' + esc(r.title[lang]) + "</h3><p>" + esc(t("salas.count", { n: items.length })) + "</p></div></a>";
    }).join("");
    document.getElementById("teaser-dial").innerHTML = dialSvg(0.45, true);
  };

  /* ---------- the menu: picture against plaque ---------- */
  let current = null, stageObs = null;
  pages.menu = function () {
    document.title = t("menu.title");
    applyStrings();
    document.getElementById("rooms-tabs").innerHTML = ROOMS.map(r =>
      '<a class="tab" href="#' + r.id + '" data-room="' + r.id + '" style="--room:' + r.wall + '">' + icon(r.id, "sm") + "<b>" + r.numeral + "</b><span>" + esc(SHORT[r.id][lang]) + "</span></a>").join("");
    document.querySelectorAll("#rooms-tabs .tab").forEach(a => a.addEventListener("click", e => { e.preventDefault(); showRoom(a.dataset.room, true); }));
    const f = document.getElementById("filters");
    f.innerHTML = "<summary>" + icon("filter", "sm") + "<span>" + esc(t("filter.title")) + '</span><span class="filter-count" id="filter-count" hidden></span></summary>' +
      '<div class="chips" id="chips">' + chipsHtml() + "</div>" + '<p class="filters-note">' + esc(t("filter.note")) + "</p>";
    document.querySelectorAll("#chips input").forEach(cb => cb.addEventListener("change", () => { cb.checked ? active.add(cb.value) : active.delete(cb.value); applyFilters(); }));

    const fromHash = location.hash.replace("#", "");
    showRoom(ROOMS.some(r => r.id === fromHash) ? fromHash : ROOMS[0].id, false);
    window.onhashchange = () => { const h = location.hash.replace("#", ""); if (ROOMS.some(r => r.id === h) && h !== current) showRoom(h, true); };
    document.onkeydown = e => {
      if (e.target.matches("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = ROOMS.findIndex(r => r.id === current);
      if (e.key === "ArrowRight" && i < ROOMS.length - 1) { showRoom(ROOMS[i + 1].id, true); e.preventDefault(); }
      if (e.key === "ArrowLeft" && i > 0) { showRoom(ROOMS[i - 1].id, true); e.preventDefault(); }
    };
  };

  function entryHtml(d, room, n, total) {
    const marks = d.v ? ' <span class="vmark" title="' + esc(t("v.note")) + '">V</span>' : "";
    const star = d.star ? "<sup>*</sup>" : "";
    let desc = lang === "it" ? (d.dit || "") : (d.en || "");
    if (desc.trim().toLowerCase() === d.it.trim().toLowerCase()) desc = "";
    const al = (d.a || []).slice().sort((a, b) => a - b);
    const alHtml = al.length
      ? '<span class="allergens" title="' + esc(al.map(x => ALLERGENS[x][lang]).join(", ")) + '">' + al.join(" · ") + "</span>"
      : '<span class="allergens none">—</span>';
    const unit = d.perKg ? "perkg" : (d.per2 ? "per2" : null);
    return '<article class="entry' + (d.feature ? " feature" : "") + '" id="d-' + slug(d.it) + '" data-n="' + n + '" data-a="' + al.join(",") + '" data-v="' + (d.v ? 1 : 0) + '">' +
      '<div class="entry-pic veduta">' + pictureHtml(d, room, "entry") + "</div>" +
      '<div class="plaque entry-plaque">' +
        '<p class="entry-n">' + esc(t("work.n", { n: n, t: total })) + "</p>" +
        (mediaFor(d) ? "" : ingsHtml(d, "entry-ings")) +
        '<h3 class="work-title" lang="it">' + esc(d.it) + star + marks + "</h3>" +
        '<p class="work-desc">' + esc(desc) + "</p>" +
        '<div class="work-meta">' + alHtml + '<span class="price">' + money(d.price, unit) + "</span></div>" +
      "</div></article>";
  }

  function showRoom(id, user) {
    const i = ROOMS.findIndex(r => r.id === id); const room = ROOMS[i];
    current = id;
    setWall(room.wall, room.ink, room.id === "pinsa" ? "#F6EBDA" : HERO.gold);
    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
    document.querySelectorAll("#rooms-tabs .tab").forEach(a => { const on = a.dataset.room === id; a.classList.toggle("active", on); if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); if (on) a.scrollIntoView({ block: "nearest", inline: "center", behavior: reduced ? "auto" : "smooth" }); });

    const all = room.groups.flatMap(g => g.items); let n = 0;
    const groups = room.groups.map(g =>
      '<div class="group">' + (g.title ? '<h3 class="group-title">' + esc(g.title[lang]) + "</h3>" : "") +
      g.items.map(d => entryHtml(d, room, ++n, all.length)).join("") + "</div>").join("");
    const scaleCard = room.scale ? '<a class="scale-card" href="bistecca.html">' + dialSvg(0.6, true) + "<div><h3>" + esc(t("room.scaleCard")) + "</h3><p>" + esc(t("room.scaleText")) + '</p><span class="btn small">' + esc(t("room.scaleCta")) + "</span></div></a>" : "";
    const prev = i > 0 ? ROOMS[i - 1] : null, next = i < ROOMS.length - 1 ? ROOMS[i + 1] : null;
    const nav = '<nav class="room-nav" aria-label="' + esc(t("nav.menu")) + '">' +
      (prev ? '<a class="room-link prev" href="#' + prev.id + '" data-room="' + prev.id + '"><small>' + esc(t("room.prev")) + "</small><b>" + prev.numeral + " · " + esc(prev.title[lang]) + "</b></a>" : '<a class="room-link prev" href="index.html#prologo"><small>' + esc(t("room.toStart")) + "</small><b>" + esc(t("atrio.title")) + "</b></a>") +
      (next ? '<a class="room-link next" href="#' + next.id + '" data-room="' + next.id + '"><small>' + esc(t("room.next")) + "</small><b>" + next.numeral + " · " + esc(next.title[lang]) + "</b></a>" : '<a class="room-link next" href="visita.html"><small>' + esc(t("plan.exit")) + "</small><b>" + esc(t("room.exit")) + "</b></a>") +
      "</nav>";

    const view = document.getElementById("entries");
    view.innerHTML =
      '<header class="room-head"><span class="numeral" aria-hidden="true">' + room.numeral + "</span>" +
        '<p class="eyebrow">' + icon(room.id, "sm") + esc(t("room.of", { n: room.numeral })) + "</p>" +
        '<h2 id="room-title" tabindex="-1">' + esc(room.title[lang]) + "</h2>" +
        '<p class="blurb">' + esc(room.blurb[lang]) + "</p></header>" +
      '<p class="filters-tally" id="tally" aria-live="polite" aria-atomic="true"></p>' +
      scaleCard + groups + nav;
    view.querySelectorAll(".room-link[data-room]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); showRoom(a.dataset.room, true); }));
    applyFilters();
    wireStage(room, all);
    if (user) {
      const top = document.getElementById("split").getBoundingClientRect().top + window.scrollY - 120;
      window.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
      document.getElementById("room-title").focus({ preventScroll: true });
    }
  }

  /* The stage: the picture side. It shows whichever entry is in the middle of the screen, and drifts the other way. */
  function wireStage(room, all) {
    const stage = document.getElementById("stage");
    let shown = -1;
    const show = n => {
      if (n === shown) return; shown = n;
      const d = all[n - 1];
      const photo = mediaFor(d);
      const ings = ingredients(d);
      const kind = photo ? (photo.kind === "video" ? t("work.video") : t("work.photo")) : t("work.from");
      const html = '<figure class="stage-fig play' + (photo ? " has-photo" : "") + '">' +
        '<div class="stage-pic veduta">' + pictureHtml(d, room, "stage") + "</div>" +
        '<figcaption><span class="stage-n">' + esc(t("work.n", { n: n, t: all.length })) + " · " + esc(kind) + "</span>" +
        (photo ? "" : ingsHtml(d)) +
        '<span class="stage-title" lang="it" style="--i:' + (photo ? 0 : (d.steps || []).length + 1) + '">' + esc(d.it) + "</span>" +
        (photo ? "" : '<button type="button" class="replay" id="replay">' + icon("filter", "sm").replace(ICONS.filter, '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>') + esc(t("work.replay")) + "</button>") +
        "</figcaption></figure>";
      const put = () => { stage.innerHTML = html; const b = document.getElementById("replay"); if (b) b.addEventListener("click", () => { shown = -1; show(n); }); };
      if (reduced) { put(); return; }
      stage.classList.add("swap");
      setTimeout(() => { put(); stage.classList.remove("swap"); }, 160);
    };
    if (stageObs) stageObs.disconnect();
    stageObs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) show(Number(e.target.dataset.n)); });
    }, { rootMargin: "-40% 0px -45% 0px", threshold: 0 });
    document.querySelectorAll("#entries .entry").forEach(el => stageObs.observe(el));
    const picObs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("play"); picObs.unobserve(e.target); } });
    }, { threshold: 0.25 });
    document.querySelectorAll("#entries .entry").forEach(el => picObs.observe(el));
    show(1);
    if (!reduced) {
      const split = document.getElementById("split");
      const drift = () => {
        const r = split.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - window.innerHeight)));
        stage.style.setProperty("--drift", (p * -60).toFixed(1) + "px");
      };
      window.removeEventListener("scroll", window.__drift);
      window.__drift = drift; window.addEventListener("scroll", drift, { passive: true }); drift();
    }
  }

  /* ============================== the dial ============================== */
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
        '<div><dt>' + esc(t("steak.for")) + '</dt><dd class="big" id="ro-people"></dd><dd class="sub">' + esc(t("steak.etti.note")) + "</dd></div>" +
      "</dl>";
    const range = document.getElementById("scale-range");
    const update = () => {
      const g = Number(range.value), perKg = Number(host.querySelector('input[name="cut"]:checked').value);
      const kg = g / 1000, price = Math.round(kg * perKg), people = Math.max(1, Math.round(kg / 0.55));
      const who = people === 1 ? t("steak.one") : t("steak.many", { n: people });
      document.getElementById("ro-kg").textContent = kgFmt(kg) + " kg";
      document.getElementById("ro-etti").textContent = t("steak.etti", { n: (g / 100) % 1 ? (g / 100).toFixed(1).replace(".", lang === "it" ? "," : ".") : g / 100 });
      document.getElementById("ro-eur").textContent = eur(price);
      document.getElementById("ro-each").textContent = eur(Math.round(price / people)) + " " + t("steak.each");
      document.getElementById("ro-people").textContent = who;
      range.setAttribute("aria-valuetext", t("steak.valuetext", { kg: kgFmt(kg), eur: price, for: t("steak.for") + " " + who }));
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

  /* ============================== booking + pre-order ============================== */
  const api = async (path, opts) => { const r = await fetch(path, { headers: { "content-type": "application/json" }, ...opts }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "error"); return j; };
  const eurM = m => eur(m / 100);
  pages.book = async function () {
    document.title = t("book.title");
    setWall(HERO.wall, HERO.ink, HERO.gold);
    applyStrings();
    const q = new URLSearchParams(location.search);
    let st = null;
    try { st = await api("/api/status"); } catch (e) { st = null; }
    if (q.get("id") && q.get("t")) return showReservation(q.get("id"), q.get("t"), q.get("paid"), st);
    bookingForm(st);
  };

  function bookingForm(st) {
    const form = document.getElementById("reserve"), err = document.getElementById("form-error");
    const callHint = document.getElementById("call-hint");
    if (SITE.phone) callHint.innerHTML = esc(t("book.call")) + ' <a href="tel:' + esc(SITE.phone.replace(/\s+/g, "")) + '">' + esc(SITE.phone) + "</a>";
    if (!st) { err.hidden = false; err.textContent = t("book.offline"); form.querySelector("#submit").disabled = true; return; }
    const party = document.getElementById("party"), date = document.getElementById("date"), slots = document.getElementById("slots"), sHint = document.getElementById("slots-hint");
    party.max = st.max_party; document.getElementById("party-hint").textContent = t("book.party.hint", { n: st.max_party });
    date.min = st.today; date.max = addDaysISO(st.today, st.horizon_days);
    document.querySelectorAll(".stepper button").forEach(b => b.addEventListener("click", () => { party.value = Math.min(st.max_party, Math.max(1, Number(party.value || 1) + Number(b.dataset.step))); loadSlots(); }));
    party.addEventListener("change", loadSlots); date.addEventListener("change", loadSlots);
    let chosen = null;
    async function loadSlots() {
      chosen = null; slots.innerHTML = ""; sHint.textContent = "";
      if (!date.value || !party.value) { sHint.textContent = t("book.pick"); return; }
      if (date.value < st.today) { sHint.textContent = t("book.past"); return; }
      const av = await api("/api/availability?date=" + date.value + "&party=" + party.value).catch(() => null);
      if (!av || !av.open) { sHint.textContent = av && av.reason === "closed" ? t("book.closed") : t("book.past"); return; }
      const bySvc = {}; av.slots.forEach(x => (bySvc[x.service] ||= []).push(x));
      slots.innerHTML = st.services.filter(sv => bySvc[sv.id]).map(sv => '<div class="slot-group"><span class="slot-name">' + esc(sv.name[lang]) + "</span>" +
        bySvc[sv.id].map(x => '<label class="slot' + (x.ok ? "" : " off") + '"><input type="radio" name="time" value="' + x.time + '"' + (x.ok ? "" : " disabled") + ">" + x.time + "</label>").join("") + "</div>").join("");
      if (!av.slots.some(x => x.ok)) sHint.textContent = t("book.full", { n: party.value });
      slots.querySelectorAll("input").forEach(i => i.addEventListener("change", () => { chosen = i.value; }));
    }
    sHint.textContent = t("book.pick");
    form.addEventListener("submit", async e => {
      e.preventDefault(); err.hidden = true;
      const btn = document.getElementById("submit"); btn.disabled = true; btn.textContent = t("book.sending");
      try {
        const j = await api("/api/reserve", { method: "POST", body: JSON.stringify({ name: form.name.value, email: form.email.value, phone: form.phone.value, note: form.note.value, date: date.value, time: chosen, party: party.value, lang }) });
        location.replace("prenota.html?id=" + j.id + "&t=" + j.token);
      } catch (ex) { err.hidden = false; err.textContent = ex.message === "error" ? t("book.offline") : ex.message; btn.disabled = false; btn.textContent = t("book.submit"); if (/orario|time/i.test(ex.message)) loadSlots(); }
    });
  }
  const addDaysISO = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const longDate = d => new Date(d + "T12:00:00Z").toLocaleDateString(lang === "en" ? "en-GB" : "it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  async function showReservation(id, tok, paid, st) {
    document.getElementById("book-form").hidden = true;
    const done = document.getElementById("book-done"); done.hidden = false;
    const card = document.getElementById("res-card");
    document.getElementById("book-lede").textContent = "";
    let j; try { j = await api("/api/reservation?id=" + encodeURIComponent(id) + "&t=" + encodeURIComponent(tok)); } catch (e) { card.innerHTML = "<p>" + esc(t("res.notfound")) + '</p><p><a class="btn ghost" href="prenota.html">' + esc(t("res.new")) + "</a></p>"; return; }
    const r = j.reservation;
    document.getElementById("book-title").textContent = t("res." + r.status);
    const paidOrders = j.orders.filter(o => o.status === "paid" || o.status === "served"), pending = j.orders.filter(o => o.status === "pending");
    card.innerHTML =
      '<span class="status ' + r.status + '">' + esc(t("res." + r.status)) + "</span>" +
      '<dl class="res-dl"><div><dt>' + esc(t("res.when")) + "</dt><dd>" + esc(longDate(r.date)) + " · " + r.time + "</dd></div><div><dt>" + esc(t("res.who")) + "</dt><dd>" + r.party + "</dd></div><div><dt>" + esc(t("res.name")) + "</dt><dd>" + esc(r.name) + "</dd></div>" + (r.note ? "<div><dt>" + esc(t("res.note")) + "</dt><dd>" + esc(r.note) + "</dd></div>" : "") + "</dl>" +
      (paid === "1" ? '<p class="okline">' + esc(t("pre.thanks")) + "</p>" : paid === "0" ? '<p class="form-error" style="display:block">' + esc(t("pre.canceled")) + "</p>" : "") +
      (paidOrders.length ? paidOrders.map(o => '<div class="order"><b>' + esc(t("pre.paid")) + " · " + eurM(o.amount) + '</b><ul>' + o.items.map(i => "<li>" + i.qty + " × <span lang=\"it\">" + esc(i.name) + "</span><span>" + eurM(i.line) + "</span></li>").join("") + "</ul></div>").join("") : "") +
      (pending.length && paid !== "0" ? '<p class="hint">' + esc(t("pre.pending")) + "</p>" : "") +
      '<p class="hint">' + esc(t("res.keep")) + "</p>" +
      '<div class="res-actions">' + (j.can_cancel ? '<button class="btn ghost" type="button" id="cancel">' + esc(t("res.cancel")) + "</button>" : "") + '<a class="btn ghost" href="prenota.html">' + esc(t("res.new")) + "</a></div>";
    const c = document.getElementById("cancel");
    if (c) c.addEventListener("click", async () => { if (!confirm(t("res.cancel.ask"))) return; try { await api("/api/reservation/cancel", { method: "POST", body: JSON.stringify({ id, t: tok }) }); location.reload(); } catch (e) { alert(t("res.cancel.late")); } });
    const pre = document.getElementById("preorder");
    if (j.preorder) { pre.hidden = false; picker(id, tok, j.preorder_min); }
    else if (st && !st.live && ["requested", "confirmed"].includes(r.status)) { pre.hidden = false; document.getElementById("picker").innerHTML = '<p class="hint">' + esc(t("pre.soon")) + "</p>"; }
  }

  function picker(id, tok, min) {
    const host = document.getElementById("picker"), cart = new Map();
    host.innerHTML = ROOMS.map((room, i) => '<details class="pick-room"' + (i === 0 ? " open" : "") + "><summary>" + icon(room.id, "sm") + "<b>" + room.numeral + "</b><span>" + esc(room.title[lang]) + "</span></summary>" +
      room.groups.map(g => (g.title ? '<p class="pick-group">' + esc(g.title[lang]) + "</p>" : "") + g.items.map(d => {
        const sl = slug(d.it), desc = lang === "it" ? (d.dit || "") : (d.en || "");
        return '<div class="pick-item" data-slug="' + sl + '"><div class="pick-txt"><span class="pick-name" lang="it">' + esc(d.it) + (d.v ? ' <span class="vmark">V</span>' : "") + "</span>" + (desc && desc.toLowerCase() !== d.it.toLowerCase() ? '<span class="pick-desc">' + esc(desc) + "</span>" : "") + "</div>" +
          '<span class="pick-price">' + (d.perKg ? esc(t("pre.table")) : eur(d.price) + (d.per2 ? "<small>" + esc(t("per2")) + "</small>" : "")) + "</span>" +
          (d.perKg ? "" : '<div class="stepper sm"><button type="button" data-d="-1" aria-label="−">−</button><output>0</output><button type="button" data-d="1" aria-label="+">+</button></div>') + "</div>";
      }).join("")).join("") + "</details>").join("");
    const total = () => { let n = 0, sum = 0; cart.forEach((qty, sl) => { const d = dishBy(sl); n += qty; sum += Math.round(d.price * 100) * qty; }); return { n, sum }; };
    const render = () => { const { n, sum } = total(); const bar = document.getElementById("cart"); bar.hidden = n === 0; document.getElementById("cart-count").textContent = t("pre.count", { n }); document.getElementById("cart-total").textContent = eurM(sum) + (min && sum < min ? " · " + t("pre.min", { x: eurM(min) }) : ""); document.getElementById("pay").disabled = min ? sum < min : false; };
    host.querySelectorAll(".pick-item").forEach(el => {
      const out = el.querySelector("output"); if (!out) return;
      el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { const sl = el.dataset.slug, q = Math.max(0, Math.min(20, (cart.get(sl) || 0) + Number(b.dataset.d))); q ? cart.set(sl, q) : cart.delete(sl); out.textContent = q; el.classList.toggle("in", q > 0); render(); }));
    });
    document.getElementById("pay").addEventListener("click", async () => {
      const btn = document.getElementById("pay"), err = document.getElementById("pre-error"); btn.disabled = true; err.hidden = true;
      try { const j = await api("/api/preorder", { method: "POST", body: JSON.stringify({ id, t: tok, items: [...cart].map(([slug, qty]) => ({ slug, qty })), note: document.getElementById("pre-note").value, lang }) }); location.href = j.url; }
      catch (e) { err.hidden = false; err.textContent = e.message; btn.disabled = false; }
    });
  }
  function dishBy(sl) { for (const r of ROOMS) for (const g of r.groups) for (const d of g.items) if (slug(d.it) === sl) return d; return null; }

  /* ============================== boot ============================== */
  function render() {
    renderShell();
    if (pages[page]) pages[page]();
  }
  render();
})();
