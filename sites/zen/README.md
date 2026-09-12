# Zen Recovery — cupping therapy site (Cairo · Dahab · Florence)

A Locali & Ordinazioni build for Ash's friend's team, **Zen Recovery** (Instagram `@zen_recovery10`; brand: italic ZEN, wide-set RECOVERY in electric blue, on black or off-white). Cairo and Dahab are run by Shaarawy (`@recoverywithshaarawy`, bio phone 01145638166, used as the Egypt WhatsApp on the site).. One page: a scroll-driven explanation of what cupping does, then "which city are you in?", then a booking form that takes card payment. **Every booking pays a 2% platform fee to us automatically**, inside Stripe, with no invoicing.

Status (2026-09-12): **preview build**. Prices, addresses and team lines are placeholders. Photos are real (from Zen's Instagram, supplied by Ash) but which photo belongs to which city is a guess — see `public/img/README.md`. Payments are off until Zen's Stripe account is connected (see below). Nothing here is deployed yet.

```
sites/zen/
  public/index.html     the public site (scroll explainer, cities, rewards, booking)
  public/account.html   client area: rewards + invite link, session history, profile with photo
  public/admin.html     team area: overview + statistics, bookings, clients, settings, admins (role-scoped)
  public/app.css        shared styles for the two areas
  public/demo.js        API client; answers from sample data when no API is present (preview builds)
  public/success.html   "Reserved" page Stripe sends the client back to
  public/img/           real photos — see img/README.md
  src/worker.js         Cloudflare Worker: static site + the whole API (checkout, webhook, accounts, admin)
  src/auth.js           signed cookies, magic-link tokens, PBKDF2 passwords (WebCrypto)
  src/catalog.js        server-side prices (the browser never sets a price)
  schema.sql            D1 tables: users, bookings, credits, admins, settings
  wrangler.toml         deploy config
```

## Accounts, rewards, admin (added 2026-09-12)

**Clients** sign in with a magic link (email, no password). Their account keeps: profile (photo, phone, home city, birthday, notes for the therapist), every session with status and what was paid, rewards, and an invite code.

**Rewards** — both rules are numbers in Settings (owner only), defaults 10 and 40:
- *Loyalty*: when a session is marked **Done** in the admin, the client's completed count goes up; every Nth one issues a "free session" credit. Sessions in any city count. A free session goes through the booking form without a card step.
- *Invite*: every client has a code and a share link (`/account.html?ref=CODE`). A friend who signs up with it gets a 40% credit immediately, usable on their first session. The inviter gets their 40% the moment the friend's first booking is paid (so nobody can farm discounts by inviting themselves). One credit per invited friend.
- Credits are applied at checkout: the Worker recomputes the price server-side and takes the 2% platform fee on the discounted amount. A cancelled booking hands the credit back.
- Sessions added by hand in the admin (cash, walk-in) count toward loyalty if the email matches an account. They carry **no platform fee** — see the note under Ideas.

**Admins** — two kinds, one page (`/admin.html`):
- *Owner* (`role = all`): sees every city, can switch the overview between All / Cairo / Dahab / Florence, changes the reward rules, adds and removes admins.
- *City admin* (`role = florence` etc.): sees only that city's bookings, clients (only people who've had a session there) and money. Cannot see the platform fee, other cities, the rules, or other admins. This is enforced in the Worker (`scope()`), not by hiding buttons.
- Everyone can change their own password. Passwords are PBKDF2-hashed; sessions are signed HttpOnly cookies (12 h for admins, 30 days for clients).
- First owner: set `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` as secrets, sign in once with them, then add the real admins from Settings. The bootstrap only works while the admins table is empty.

**Statistics** (Overview tab): sessions this month with change vs last month, revenue per currency (EUR and EGP are never summed), clients and new clients, upcoming, sessions per month for 12 months, revenue per month per currency, sessions by type, sessions by city (owner, all-cities view), today's list, rewards issued/used. Every chart has a hover tooltip and a table view.

**Preview mode**: without a deployed API, `demo.js` answers from generated sample data so all three areas can be reviewed. The banners at the top say so. Nothing in it runs once `/api` is live.

## How the 2% works

Stripe Connect, **direct charges with an application fee**:

1. Our Stripe account (`AmicoMioFlorence`, `acct_1U0OjLFtLAIrKWhD`) becomes a **Connect platform**. One-time switch in the Stripe Dashboard: Connect → Get started → "Platform or marketplace". No code.
2. Zen gets a **connected account** under our platform. We send them a Stripe onboarding link; they fill in their business details and bank account (10 minutes, done once). Zen sees their own dashboard, payouts, refunds. We never hold their money.
3. When a client books, the Worker creates a Checkout Session **on Zen's account** (`Stripe-Account` header) with `application_fee_amount = round(price × 2%)`. Stripe splits the payment at settlement: 98% (minus Stripe's processing fee) to Zen, **2% to us**, automatically, on every single booking.
4. The fee shows up in our Dashboard under Connect → Collected fees. Refund a booking and the fee is refunded proportionally (Stripe handles this).

Why this rather than the alternatives:

| Option | Why not |
|---|---|
| Money comes to us, we pay Zen monthly | We'd be merchant of record for a therapy service in two countries: tax, liability, disputes all ours. |
| Zen pays us a monthly invoice for 2% | Depends on Zen's honesty and our bookkeeping. The Connect fee is enforced by Stripe. |
| Deposit only (say 20%) online, rest in cash | Fine if Zen prefers. The fee can still be **2% of the full price** taken from the deposit charge (Stripe only requires fee < charge). Just change `catalog.js`. |

### The Egypt question (needs Ash + Zen)

Stripe **does not open accounts for businesses based in Egypt**. Options, best first:

1. **One connected account, Zen's Italian entity (Florence).** All three cities bill through it, in EUR or EGP. Simplest, one fee stream. Zen must be comfortable declaring Cairo/Dahab income through the Italian business.
2. **Egypt cities take "request to book" instead of payment.** Cairo/Dahab bookings are logged and paid in cash on site; we'd take no 2% there (or a small fixed booking fee charged by card in EUR).
3. **Egyptian payment provider (Paymob/Fawry) for the two Egyptian rooms.** Real work, separate integration, and our fee would have to be invoiced, not automatic.

The site as built supports option 1 out of the box (prices in EGP for Cairo/Dahab; Stripe converts to EUR at payout with a small FX fee), and option 2 with a small change to the form.

## Going live: checklist

Ash's side (Stripe dashboard, one-time):
- [ ] Enable Connect on AmicoMioFlorence, platform type "marketplace".
- [ ] Create Zen's connected account (Dashboard → Connect → Accounts → Create, type **Express** so Zen gets a simple dashboard) and send them the onboarding link. Note the `acct_…` id.
- [ ] Add a **Connect webhook** (Dashboard → Developers → Webhooks → "Listen to events on connected accounts") for `checkout.session.completed` and `checkout.session.expired`, URL `https://<site>/api/stripe-webhook`. Copy the signing secret.
- [ ] Set the Platform Pricing / fee defaults if wanted (the Worker sets the fee explicitly, so optional).

Zen's side:
- [ ] Finish Stripe onboarding (ID + bank account).
- [ ] Confirm prices, durations, which methods each room offers (Hijama is currently listed only for Cairo; Manual therapy is listed everywhere because both Instagram bios lead with it).
- [ ] Florence WhatsApp number + the Florence therapist's name (Egypt uses Shaarawy's public number).
- [ ] Confirm addresses / meeting points, opening hours per room, team lines.
- [ ] Send photos (three portrait shots) + Instagram handle + WhatsApp number.
- [ ] Domain: **zenrecovery.com** (Ash, 2026-09-12: buying it). See "Domain" below.

Deploy:
```bash
cd sites/zen
npx wrangler d1 create zen-recovery                      # paste the id into wrangler.toml
npx wrangler d1 execute zen-recovery --remote --file=schema.sql
npx wrangler secret put STRIPE_SECRET_KEY      # platform (AmicoMioFlorence) secret key
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # from the Connect webhook above (add checkout.session.expired too)
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put SESSION_SECRET         # any long random string
npx wrangler secret put ADMIN_BOOTSTRAP_EMAIL
npx wrangler secret put ADMIN_BOOTSTRAP_PASSWORD
# fill ZEN_STRIPE_ACCOUNT, ZEN_NOTIFY_EMAIL, FROM_EMAIL, SITE_URL in wrangler.toml
npx wrangler deploy
```
Local run: `npx wrangler dev` with `DEV_MAGIC_LINK = "1"` returns the sign-in link in the API response, so accounts can be tested without email.
Then set `PREVIEW = false` in `public/index.html` to drop the banner, and redeploy.

Test before real money: create Zen's connected account in **test mode** first, deploy with test keys, book with card `4242 4242 4242 4242`, and check that Connect → Collected fees shows 2% of the amount.

## Domain: zenrecovery.com

Workers custom domains need the zone in the same Cloudflare account as the Worker, so:

1. **Buy on Cloudflare Registrar** (Dashboard → Domain Registration → Register) — lands in the account already, wholesale price, done. Or, if bought on GoDaddy: Cloudflare Dashboard → Add a site → `zenrecovery.com` (Free plan) → copy the two nameservers → GoDaddy → Domain → Nameservers → Change → paste. Propagates in minutes to a few hours.
2. Uncomment the `routes` block in `wrangler.toml`, set `SITE_URL = "https://zenrecovery.com"`, run `npx wrangler deploy`. Cloudflare creates the DNS records and the TLS certificate itself. Add a redirect rule from `www` to the apex if wanted (Rules → Redirect Rules, or leave both routes serving the site).
3. **Email from the same domain**: Resend → Domains → Add `zenrecovery.com` → it lists DKIM/SPF (and MX for receiving) records → add them in Cloudflare DNS → Verify. Then `FROM_EMAIL = "Zen Recovery <booking@zenrecovery.com>"`. Until then booking emails go out from `booking@amicomioflorence.com`, which works but shows the Tours brand.
4. Update the Stripe Connect webhook URL and the Instagram bio link to the new domain.

Keep the domain in Ash's Cloudflare account, not Zen's: it's the one piece of the deal that keeps the site (and the 2%) under Locali & Ordinazioni's control.

## Things to know about the build

- **D1 is now used** (accounts, bookings, rewards, admins). It shares the account's free-tier daily read quota with amicomiotour.com and the two demo sites; a booking site this size uses a few thousand reads a day, far from the 5M limit, but if the demo sites ever exhaust the quota this site's admin would fail too. Deleting Sergio Bar / Carrozze's databases, or moving Zen to its own Cloudflare account, removes that risk.
- **Prices are enforced server-side** (`src/catalog.js`). The browser sends a service id; if someone edits the page they still pay the catalog price.
- **Emails go through Resend.** `FROM_EMAIL` must be on a verified domain. Today the only verified domain on the account is `amicomioflorence.com`, which is the Tours agency's brand. Either accept that for now or verify a Zen domain.
- **Availability is not live.** The client picks a day and a morning/afternoon/evening window; Zen confirms the exact hour on WhatsApp. This matches how the team already works via Instagram DMs and avoids building a calendar nobody maintains. A real calendar (Cal.com embed, or a small KV-backed slot table) is a follow-up if Zen wants it.
- **Motion**: one scroll-scrubbed illustration (GSAP ScrollTrigger), a breathing ring in the hero, soft reveals. Everything respects `prefers-reduced-motion`.
- **Photos**: real ones are in `public/img/`. Replace any file with the same name and the page picks it up; if a city photo is missing the page falls back to a drawn skyline.

## Ideas for later (not built — Ash decides)

1. **Live availability.** Today the client picks a day and a window and Zen confirms by WhatsApp. A real slot table per therapist (open hours per city, session length, buffers) would let clients pick an exact time and would stop double-bookings. Medium effort; the schema already has a slot column.
2. **WhatsApp reminders** the day before (and "how was it?" the day after) via the WhatsApp Business API or Twilio. Missed sessions are the biggest silent cost for a one-person room.
3. **Gift sessions.** A "buy a session for someone" flow: same checkout, produces a code. Recovery is an easy gift, and it brings in a new client every time.
4. **Packages.** 5 sessions at a discount, paid up front. Better cash flow for Zen, and the platform fee is taken once on the package.
5. **Deposit instead of full payment** for Egypt if Stripe stays Italy-only: card deposit in EUR, rest in cash. Already supported by `catalog.js`.
6. **Platform fee on hand-added bookings.** Sessions Zen enters manually carry no 2%. If most Egyptian sessions end up entered by hand, Locali & Ordinazioni's cut disappears. Options: a monthly invoice for 2% of manual sessions (the admin already counts them), or a flat monthly fee for the software instead of/alongside the 2%. Worth deciding with Zen before launch.
7. **Therapist accounts** (a third role) so each therapist sees only their own day, and clients can pick a therapist they liked.
8. **Before/after photos** in the client's profile, uploaded by the therapist with consent, so progress is visible over months. Needs R2 storage (small).
9. **Review request** email or WhatsApp after the 2nd session, linking to Google Maps / Instagram, with the invite link in the same message. Mirrors what the Tours concierge already does with Template C.
10. **Body map** in the booking form: tap where it hurts (back, shoulder, calf) instead of typing a note. Therapist sees it on the booking.
11. **Multi-language** (Arabic for Cairo/Dahab, Italian for Florence). The copy is short; a JSON of strings per language would do.
12. **Instagram link-in-bio page** at `/ig` with the three cities and "book now", so the profile link goes straight to booking.
13. **Corporate / gym partnerships**: a code per gym (Gold's Gym in the photos) giving members a fixed discount, with a per-gym report in the admin. Same mechanism as the invite codes.
14. **Head Chef digest line** for Zen: once live, the daily rundown can include "Zen: N bookings, X platform fee" from the admin stats endpoint, so Ash never has to open the admin to know how the 2% is doing.
