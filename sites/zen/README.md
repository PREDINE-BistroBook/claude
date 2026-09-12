# Zen Recovery — cupping therapy site (Cairo · Dahab · Florence)

A Locali & Ordinazioni build for Ash's friend's team, **Zen Recovery** (brand: bold red italic ZEN + wide-set RECOVERY, as on the studio banner). One page: a scroll-driven explanation of what cupping does, then "which city are you in?", then a booking form that takes card payment. **Every booking pays a 2% platform fee to us automatically**, inside Stripe, with no invoicing.

Status (2026-09-12): **preview build**. Prices, addresses and team lines are placeholders. Photos are real (from Zen's Instagram, supplied by Ash) but which photo belongs to which city is a guess — see `public/img/README.md`. Payments are off until Zen's Stripe account is connected (see below). Nothing here is deployed yet.

```
sites/zen/
  public/index.html     the whole site (inline CSS/JS; GSAP from cdnjs for the scroll animation)
  public/success.html   "Reserved" page Stripe sends the client back to
  public/img/           drop cairo.jpg / dahab.jpg / florence.jpg here — see img/README.md
  src/worker.js         Cloudflare Worker: serves the site, creates Stripe Checkout, handles the webhook
  src/catalog.js        server-side prices (the browser never sets a price)
  wrangler.toml         deploy config
```

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
- [ ] Add a **Connect webhook** (Dashboard → Developers → Webhooks → "Listen to events on connected accounts") for `checkout.session.completed`, URL `https://<site>/api/stripe-webhook`. Copy the signing secret.
- [ ] Set the Platform Pricing / fee defaults if wanted (the Worker sets the fee explicitly, so optional).

Zen's side:
- [ ] Finish Stripe onboarding (ID + bank account).
- [ ] Confirm prices, durations, which methods each room offers (Hijama is currently listed only for Cairo).
- [ ] Confirm addresses / meeting points, opening hours per room, team lines.
- [ ] Send photos (three portrait shots) + Instagram handle + WhatsApp number.
- [ ] Domain: buy `zen…` or point a subdomain. Until then the workers.dev URL works.

Deploy:
```bash
cd sites/zen
npx wrangler secret put STRIPE_SECRET_KEY      # platform (AmicoMioFlorence) secret key
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # from the Connect webhook above
npx wrangler secret put RESEND_API_KEY
# fill ZEN_STRIPE_ACCOUNT, ZEN_NOTIFY_EMAIL, FROM_EMAIL, SITE_URL in wrangler.toml
npx wrangler deploy
```
Then set `PREVIEW = false` in `public/index.html` to drop the banner, and redeploy.

Test before real money: create Zen's connected account in **test mode** first, deploy with test keys, book with card `4242 4242 4242 4242`, and check that Connect → Collected fees shows 2% of the amount.

## Things to know about the build

- **No D1, no KV.** Bookings live in Stripe (metadata on the Checkout Session + PaymentIntent) and in the emails. This deliberately avoids the D1 free-tier daily read quota that Sergio Bar / Carrozze already compete for with amicomiotour.com.
- **Prices are enforced server-side** (`src/catalog.js`). The browser sends a service id; if someone edits the page they still pay the catalog price.
- **Emails go through Resend.** `FROM_EMAIL` must be on a verified domain. Today the only verified domain on the account is `amicomioflorence.com`, which is the Tours agency's brand. Either accept that for now or verify a Zen domain.
- **Availability is not live.** The client picks a day and a morning/afternoon/evening window; Zen confirms the exact hour on WhatsApp. This matches how the team already works via Instagram DMs and avoids building a calendar nobody maintains. A real calendar (Cal.com embed, or a small KV-backed slot table) is a follow-up if Zen wants it.
- **Motion**: one scroll-scrubbed illustration (GSAP ScrollTrigger), a breathing ring in the hero, soft reveals. Everything respects `prefers-reduced-motion`.
- **Photos**: real ones are in `public/img/`. Replace any file with the same name and the page picks it up; if a city photo is missing the page falls back to a drawn skyline.
