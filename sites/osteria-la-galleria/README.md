# Osteria La Galleria — the menu as a gallery

A Locali & Ordinazioni build for **Osteria La Galleria**, Florence. Started 2026-09-12 from ten photos Ash took on site: seven pages of the paper menu, the happy-hour board, the chalk steak board, and the "leave us a review" sticker on the door. Downscaled copies are in `reference/` so any future edit can check a price or an allergen against the original.

Status: **built, not deployed, not yet shown to the owner.** Location known (in front of Palazzo Pitti, per Ash 2026-09-12); street number, phone, hours and domain still missing — see "Before it goes live".

## The pages (restructured 2026-09-13)

Ash asked for the site to be organised and easy to interact with rather than one long scroll, with The Fat Duck's storytelling as the reference (the meal as a journey, an illustrated map of the stops, chapters, a narrator's voice). Four pages, one shell (`app.js` renders the header, the phone tab bar and the footer on every page):

| Page | File | What it does |
|---|---|---|
| Galleria | `index.html` | The palace view, the wine window as *Prologo*, the illustrated floor plan (ten rooms around a courtyard, clockwise from the entrance), the steak teaser with a small dial, the two room photos |
| Il menu | `menu.html` | One room at a time. The floor plan is the navigator with a "Sei qui" pin; filters are always visible beside it; previous/next room at the bottom; arrow keys work; `#antipasti` … `#cantina` deep-link a room |
| La bistecca | `bistecca.html` | The scale as a butcher's dial with a swinging needle: cut, weight (kilos and Tuscan *etti*), price, people, price a head; a drawn T-bone cutaway; three tradition plaques |
| Visita | `visita.html` | Photos, hours, address, phone, review card |

On phones the top nav collapses to a four-tab bar at the bottom (Galleria · Il menu · La bistecca · Visita) with the paper menu's engraved-style icons redrawn as line icons.

## The idea

"Galleria" in Florence means the Palatina, the Uffizi, the Accademia. So the menu is a museum visit:

- **The entrance is the wine window.** Ash confirmed (2026-09-12) the osteria has a working *buchetta del vino* in the façade. It gets its own section between the hero and room I, on the ochre street wall with the window drawn in it, before the dark rooms begin. It links to the cellar for wine by the glass.
- **Ten rooms** in course order (Antipasti & Zuppe → Primi → Tartufo → Secondi → Pesce → Bistecche & Carne → Insalatone & Contorni → Pinsa → Dolci → La Cantina). The wall colour changes as you scroll from one room to the next; the paper menu already colour-codes meat burgundy and fish blue, the site extends that to every room.
- **Every dish is a work with a museum plaque**: Italian name, description in the chosen language, allergen numbers as small catalogue numbers, price. House specialities get a gold frame.
- **The scale** in the Bistecche room: the fiorentina and the costola are priced per kilo, so a slider shows what a 600 g to 2 kg cut costs and roughly how many people it feeds.
- **"Cosa non mangi?"**: vegetarian / no gluten / no milk / no eggs / no nuts / no fish-or-seafood toggles, computed from the allergen numbers. Dishes that don't fit stay on the wall with the light off, so the reader can still see everything the kitchen does.
- **Italian / English**, picked from the browser, remembered, forceable with `?lang=en`.

Fonts: Bodoni Moda (titles, numerals), Cormorant Garamond (dish names, blurbs), Work Sans (plaques, labels). Loaded from Google Fonts with real fallbacks.

Quality floor (checked 2026-09-12 with a scripted audit at 1440 px and 375 px): no text under 12 px, every tap target at least 36 px tall with 8 px between them, heading levels never skip, no horizontal scroll, sticky bars accounted for in `scroll-padding-top` so keyboard focus is never hidden, the steak slider announces "1,05 kg, 71 €, per 2 persone" to screen readers, the filter tally is a live region with an empty state, and Italian dish names carry `lang="it"` inside the English page. Photos ship as WebP with JPEG fallback. The nav button reads "Dove siamo / Find us" until a phone or WhatsApp number is set in `SITE`, then becomes "Prenota / Reserve" and dials or opens WhatsApp directly.

```
sites/osteria-la-galleria/
  public/index.html     Galleria (home)
  public/menu.html      Il menu, one room at a time
  public/bistecca.html  La bistecca: the dial
  public/visita.html    Visita: photos + contacts
  public/app.js         shared shell, language, floor plan, icons, dial, the four page modules
  public/site.css       the gallery: shell, plan, plaques, dial, responsive + reduced-motion
  public/menu.js        THE MENU. Every dish, price, allergen list, and the contact details (SITE)
  reference/            downscaled photos of the paper menu and the boards (the source of truth for prices)
  wrangler.toml         Cloudflare static-assets deploy, no Worker code yet
```

## Editing the menu

Everything lives in `public/menu.js`. A dish is one line:

```js
{ it: "Tagliatelle al tartufo fresco", en: "Home-made pasta with fresh truffle", dit: "Pasta fatta in casa e tartufo fresco", price: 24, a: [1,3,7], v: true, feature: true },
```

`it` is the name (always shown), `en` the English description, `dit` the Italian description, `a` the allergen numbers, `v` vegetarian, `star` the menu's asterisk (may be frozen), `per2` for-two dishes, `perKg` priced by weight, `feature` gold frame. Rooms have a `wall` colour and an `ink` text colour.

## Transcription notes — check with the kitchen

Everything is transcribed exactly as printed, including a few things that look like misprints on the paper menu. They are on the site as printed until the owner confirms:

- **Insalata dello chef** lists allergen 2 (crustaceans) for a rocket-avocado-parmesan salad. Probably meant 7 (milk).
- **Tiramisù** lists 4 (fish). Probably meant 1 (gluten).
- **Pinsa Pitti** (mortadella, burrata, pistachio) lists only 1 and 7. Pistachio is a tree nut (8).
- **Soufflè di carciofi**: the Italian says pecorino fondue, the English says gorgonzola cream. The site follows the Italian.
- **Torta al cioccolato** lists only 6 (soy). A chocolate cake usually also carries 1, 3, 7.
- Wine descriptions on the site (e.g. "Chianti Classico Gallo Nero", "Brunello di Montalcino") expand the menu's one-word labels; confirm they are right.

## Before it goes live

1. **Contact details** — fill `SITE` at the bottom of `menu.js`: street number, phone, WhatsApp number, hours, the real Google Maps share link, the Google review link behind the door QR sticker, Instagram, and when happy hour runs. Empty fields show "In arrivo / Coming soon" on the page.
   Known: it is in front of Palazzo Pitti, so the address line reads "Piazza de' Pitti, Firenze" and the map link is a search query, not the listing. A web listing for an "Osteria della Galleria" gives Piazza de' Pitti 20; not assumed until the owner confirms.
2. **Domain** — pick one, add it as a zone on the Amico Mio Cloudflare account, uncomment `routes` in `wrangler.toml`.
3. **Deploy** — `.github/workflows/deploy-osteria.yml` deploys on push to the default branch touching this folder (same token as Zen). Until a domain exists it deploys to `osteria-la-galleria.<account>.workers.dev`.
4. **Photos** — three from Ash (2026-09-12), hung as numbered *vedute* in gold frames with caption plaques: the terrace facing Palazzo Pitti (the hero; cropped to the palace and the umbrellas so no guest's face is published without consent), the dining room and the corridor to the counter (both at the end, by the contact details). Originals were 2.5 MB each; `public/img/` holds resized copies. A photo of the buchetta del vino itself would go in the entrance section. Dish photos are still deliberately absent: they would fight the plaque idea.
5. **Ordering / reservations** — not built. The "Prenota" button scrolls to the contact block. A booking form or a table-ordering flow is the Locali & Ordinazioni upsell, on top of this.
