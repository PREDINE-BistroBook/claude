# Osteria La Galleria — the menu as a gallery

A Locali & Ordinazioni build for **Osteria La Galleria**, Florence. Started 2026-09-12 from ten photos Ash took on site: seven pages of the paper menu, the happy-hour board, the chalk steak board, and the "leave us a review" sticker on the door. Downscaled copies are in `reference/` so any future edit can check a price or an allergen against the original.

Status: **built and tested locally, not deployed, not yet shown to the owner.** Location known (in front of Palazzo Pitti, per Ash 2026-09-12); street number, phone, hours and domain still missing — see "Before it goes live". Since 2026-09-14 it is a Cloudflare Worker with a D1 database: reservations, pre-orders paid through Stripe, and a staff admin.

## The pages (restructured 2026-09-13, menu redone 2026-09-14)

Four pages, one shell (`app.js` renders the header, the phone tab bar and the footer on every page):

| Page | File | What it does |
|---|---|---|
| Galleria | `index.html` | The palace view, the wine window as *Prologo*, the ten rooms as picture cards, the steak teaser with a small dial, the two room photos |
| Il menu | `menu.html` | **Picture against plaque.** One room at a time, chosen from a row of room tabs. On desktop the page is split in two: the dish's picture on the left, held in place and drifting the other way as you scroll; its plaque (name, what's in it, allergens, price) on the right. On phones every dish is picture first, plaque under it. Filters sit above; previous/next room at the bottom; arrow keys; `#antipasti` … `#cantina` deep-link a room |
| La bistecca | `bistecca.html` | The scale as a butcher's dial with a swinging needle: cut, weight (kilos and Tuscan *etti*), price, people, price a head; a drawn T-bone cutaway; three tradition plaques |
| Visita | `visita.html` | Photos, hours, address, phone, review card |

The floor-plan map from 2026-09-13 was dropped at Ash's request the next day.

### Every dish has a picture: a recipe that draws itself, until the owner's photos arrive

- `art.js` is an **ingredient library**: 13 bases (plate, bowl, board, pinsa base, wine glass, flute, mug, cups, tumbler…) and 200 drawn ingredients, each with its name in Italian and English. Every dish in `menu.js` carries a `base` and a `steps` list, its recipe in cooking order, e.g. `["pici", "guanciale", "crema-uovo-pecorino", "pepe-nero"]`. The picture is built from that, so a Nizzarda shows tuna, onion, olives, mozzarella, eggs and tomato, and a Napoli pinsa shows oregano, capers and anchovies. A scripted check confirms every recipe key exists.
- **They assemble themselves (2026-09-14, Ash's idea; slowed and detailed the same day).** The base lands first, then each ingredient, 0.85 s apart, each one named as it lands, on the menu's picture side and under the picture on phones alike. The dish name arrives last. A "Rivedi / Play again" button replays it. With reduced motion the finished drawing and all the names show at once.
- To check all 110 plates at a glance, render a contact sheet: a throwaway page that loads `menu.js` + `art.js` and draws every recipe still (the 2026-09-14 session did this and fixed what didn't read: slice sizes, a bone, sauces landing after the pasta they should sit under).
- **Real clips work the same way.** An `.mp4` or `.webm` named after the dish in `img/dishes/` plays muted on loop in that dish's spot instead of the drawing, a photo (`.jpg` / `.webp` / `.png`) shows still. The video wins if both exist.
- **Real photos replace them file by file, with no code change.** Drop a photo into `public/img/dishes/` named after the dish (`img/dishes/README.md` lists the exact file name for all 110 dishes, e.g. `tagliatelle-al-tartufo-fresco.jpg`). The deploy workflow regenerates `photos.js` from the folder; the site then shows the photo instead of the drawing for that dish, on the menu and on the home page cards.
- AI-generated placeholder photos were the first idea (2026-09-14). The Higgsfield workspace on this account had 0 credits and no free allowance, so it was not possible in that session; each image costs 1 credit. With credits, one photo per plate type (about 50) or one per dish (110) can be generated in a single pass and dropped into the same folder.

## Reservations, pre-orders, admin (added 2026-09-14)

Same architecture as Zen: a Worker serves the static site and an `/api/`, D1 holds the data, Resend sends the emails, Stripe Connect takes the money as a **direct charge on the osteria's connected account with a 2% application fee to Amico Mio**. Nothing is charged until `STRIPE_SECRET_KEY` and `OSTERIA_STRIPE_ACCOUNT` are set; until then the site takes reservations and hides the pre-order.

**Guests — `prenota.html`** (IT/EN, the site's own look):
1. Party size, date, time. Times come from `/api/availability`: every slot of every service that day, greyed out when the covers left in that slot are fewer than the party, when the day is closed, or when the slot is inside the lead time. Over `max_party` → "call us".
2. Name, phone, email, notes → `/api/reserve`. Status is `confirmed` at once when the owner leaves auto-confirm on (default), otherwise `requested`. The guest gets an email with their private link (`prenota.html?id=…&t=…`), the staff get one too.
3. That link is the guest's page: status, details, **cancel** (until two hours before), and the **pre-order**: the whole menu as a picker with quantities (per-kilo steaks excluded, "weighed at the table"), a note for the kitchen, "Paga con carta" → Stripe Checkout with one line per dish, prices taken server-side from `menu.js`. The webhook marks the order paid and emails both sides; the guest page then shows the paid order.

**Staff — `admin.html`** (Italian, dark, phone-friendly, sign-in with email or username):
- *Oggi*: covers today and this week, requests waiting, paid pre-orders coming up and this month; today's tables by service with one-tap **Conferma / Rifiuta / Seduti / Non venuti / Concluso**.
- *Prenotazioni*: any date range, status filter, search; grouped by day with covers; a drawer to edit everything (date, time, party, table, notes, internal note, status); **Nuova** for phone bookings and walk-ins. Changing date, time or status emails the guest.
- *Pre-ordini*: paid orders as kitchen tickets by date, **Servito**, and a print view.
- *Menu* (ported from the Sergio Bar system, 2026-09-14): the live menu, room by room. The owner renames dishes and changes prices inline (autosaved), opens the full card of a dish (English text, description, allergens, V / frozen / featured / hidden, per-two or per-kilo, the photo, and the drawing's recipe — base plus ingredients picked from `art.js` with a live preview), adds and removes dishes, groups and rooms, reorders them, gives each room a cover photo, a wall colour and a short tab name. The floor staff see the same list with only the **Esaurito** switch: a sold-out dish is dimmed on the site and refused by the pre-order at once. Search filters the list.
- *Il locale* (owner): contact details (phone, WhatsApp, email, Instagram, Maps link, review link, hours), Wi-Fi for guests, the **happy hour** (a fixed price on chosen drinks in a time window: the site shows it with the normal price struck through, pre-orders for a table in that window charge it), and the **tables** for the QR codes (rooms with a letter and a count).
- *QR*: one code per table (`1A…12A`, `1T…`) plus one "MENU" code for the door and the counter, drawn as cream plaques with a gold frame; PNG per card, all PNGs, or a print sheet. A scanned code opens the menu with the table remembered (a pill in the header) and the Wi-Fi shown; the code is only a label, there is no ordering from the table.
- *Impostazioni* (owner): services (up to four windows), slot length, covers per slot, open days, closed dates, max party, lead time, horizon, auto-confirm, the notification address, pre-order on/off and minimum, and whether Stripe is connected.
- *Accessi*: roles **owner** (everything), **staff** (reservations and orders), **platform** (Amico Mio: numbers only, including the fee); add and remove logins, change password. First owner: `ADMIN_BOOTSTRAP_EMAIL` + `ADMIN_BOOTSTRAP_PASSWORD`, honoured only while the admins table is empty.

**Where the menu lives now.** `public/menu.js` is the seed and the offline fallback: the first time anyone asks for the menu the Worker copies it into D1 (`settings` key `menu`, one JSON document, each dish given a stable `id` = the slug of its Italian name), and from then on the admin edits that document. The site fetches `/api/menu` on every page (owner's menu with hidden dishes stripped, contact details, which photos exist) and falls back to `menu.js` when there is no Worker, which is why the artifact preview still works. Photos are stored base64 in the `media` table (resized in the browser to 1200×900 for dishes and 1400×1050 for room covers, WEBP, ≤ 900 KB), served at `/media/<id>?v=<ver>` with a year of caching; a dish photo from the admin wins over the drop-in file in `img/dishes/`, which still works. Saving sends the whole document with a version number: two people editing at once get "ricarica la pagina" instead of overwriting each other.

Code: `src/worker.js` (routes), `src/lib.js` (settings, availability, sessions, email, Stripe, the menu document, the site document, photos), `src/auth.js` (copied from Zen), `schema.sql`. Local run: `npx wrangler dev --local` with `--var SESSION_SECRET:… --var ADMIN_BOOTSTRAP_EMAIL:… --var ADMIN_BOOTSTRAP_PASSWORD:…`, then `wrangler d1 execute osteria-la-galleria --local --file=schema.sql`. Tested that way on 2026-09-14 end to end with curl and a headless browser: availability, reservation, capacity counting, guest cancel rules, admin login and roles, status changes, manual bookings, settings, the pre-order picker (with dummy Stripe keys, the payment call fails cleanly).

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
  public/app.js         shared shell, language, icons, dial, the four page modules
  public/art.js         the ingredient library: 13 bases + 200 drawn, named ingredients
  public/photos.js      list of the owner's photos in img/dishes (regenerated at deploy)
  public/img/dishes/    drop the real dish photos here, named as in its README.md
  public/site.css       the gallery: shell, tabs, split menu, plaques, dial, responsive + reduced-motion
  public/menu.js        THE MENU. Every dish, price, allergen list, and the contact details (SITE)
  reference/            downscaled photos of the paper menu and the boards (the source of truth for prices)
  public/prenota.html   book a table, then pre-order and pay
  public/admin.html     staff: today, reservations, pre-orders, settings, logins
  src/worker.js         the API (guests, Stripe webhook, staff)
  src/lib.js            settings, availability, sessions, email, Stripe, server-side menu
  src/auth.js           signed cookies + PBKDF2 passwords (WebCrypto)
  schema.sql            D1 tables: reservations, orders, admins, settings
  wrangler.toml         Worker + assets + D1 (id filled in at deploy)
```

## Editing the menu

Once deployed, the owner edits the menu in `admin.html` → *Menu* (see above); `public/menu.js` only seeds the database and serves the static preview. A dish in `menu.js` is one line:

```js
{ it: "Tagliatelle al tartufo fresco", en: "Home-made pasta with fresh truffle", dit: "Pasta fatta in casa e tartufo fresco", price: 24, a: [1,3,7], v: true, feature: true },
```

`it` is the name (always shown), `en` the English description, `dit` the Italian description, `a` the allergen numbers, `v` vegetarian, `star` the menu's asterisk (may be frozen), `per2` for-two dishes, `perKg` priced by weight, `feature` gold frame, `base` + `steps` the recipe the drawing builds from (keys from `art.js`), `out` sold out, `off` hidden. Rooms have a `wall` colour and an `ink` text colour. Changing `menu.js` after the first deploy does not change the live menu (the database copy wins); to re-seed, delete the `menu` row from `settings`.

## Transcription notes — check with the kitchen

Everything is transcribed exactly as printed, including a few things that look like misprints on the paper menu. They are on the site as printed until the owner confirms:

- **Insalata dello chef** lists allergen 2 (crustaceans) for a rocket-avocado-parmesan salad. Probably meant 7 (milk).
- **Tiramisù** lists 4 (fish). Probably meant 1 (gluten).
- **Pinsa Pitti** (mortadella, burrata, pistachio) lists only 1 and 7. Pistachio is a tree nut (8).
- **Soufflè di carciofi**: the Italian says pecorino fondue, the English says gorgonzola cream. The site follows the Italian.
- **Torta al cioccolato** lists only 6 (soy). A chocolate cake usually also carries 1, 3, 7.
- Wine descriptions on the site (e.g. "Chianti Classico Gallo Nero", "Brunello di Montalcino") expand the menu's one-word labels; confirm they are right.

## Before it goes live

1. **Contact details** — the owner can fill them in `admin.html` → *Il locale* after the first deploy (they override `SITE` in `menu.js`); or fill `SITE` at the bottom of `menu.js` for the static preview: street number, phone, WhatsApp number, hours, the real Google Maps share link, the Google review link behind the door QR sticker, Instagram, and when happy hour runs. Empty fields show "In arrivo / Coming soon" on the page.
   Known: it is in front of Palazzo Pitti, so the address line reads "Piazza de' Pitti, Firenze" and the map link is a search query, not the listing. A web listing for an "Osteria della Galleria" gives Piazza de' Pitti 20; not assumed until the owner confirms.
2. **Domain** — pick one, add it as a zone on the Amico Mio Cloudflare account, uncomment `routes` in `wrangler.toml`.
3. **Deploy** — `.github/workflows/deploy-osteria.yml` deploys on push to the default branch touching this folder (same token as Zen). Until a domain exists it deploys to `osteria-la-galleria.<account>.workers.dev`.
4. **Photos** — three from Ash (2026-09-12), hung as numbered *vedute* in gold frames with caption plaques: the terrace facing Palazzo Pitti (the hero; cropped to the palace and the umbrellas so no guest's face is published without consent), the dining room and the corridor to the counter. `public/img/` holds resized copies. A photo of the buchetta del vino itself would go in the prologue. Dish photos: see "Every dish has a picture" above.
5. **Stripe** — the osteria needs a connected account under the AmicoMioFlorence platform (same onboarding link flow as Zen); put its `acct_…` in `OSTERIA_STRIPE_ACCOUNT` in `wrangler.toml`, set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (webhook endpoint `/api/stripe-webhook`, events `checkout.session.completed` and `checkout.session.expired`, on the connected account). Until then pre-ordering stays hidden.
6. **Email sender** — `FROM_EMAIL` in `wrangler.toml` points at the Zen domain as a placeholder; switch it to the osteria's own verified Resend domain.
7. **Table QR codes** — in *Il locale* set the rooms of tables (name, letter, how many); *QR* draws the cards. Print them once the domain is final: the URL is baked into the code.
8. **First staff login** — set the `ADMIN_BOOTSTRAP_PASSWORD` repository secret before the first deploy; the deploy workflow passes `ADMIN_BOOTSTRAP_EMAIL` as Ash's address. Sign in once on `/admin.html`, add the owner's own login from *Accessi*, and optionally a *platform* login for Amico Mio.
