# Acting School

Internal app for the team of an acting school that is also a talent agency (the "staff app" in this repository; on screen it always says **Team**, never Staff). Works in the browser on desktop and phone (installable to the home screen), in English and Arabic. Its address is `team.turquoisestudio.app`.

**Status:** phase 1 built — sign-in and first-run setup, team accounts and settings, students, workshops (weekly schedule, sessions, attendance), talent roster with headshots, castings with roles and submissions, the combined schedule and the home dashboard, in English and Arabic (right-to-left). Phase 2, step 1 built — editable positions and permissions. Phase 2, step 2 built — admissions: enquiries from every source with follow-up reminders, pre-written WhatsApp messages (wa.me links, English or Arabic), interviews scored on the criteria in Settings, decisions and enrolment into a workshop, with interviews on the schedule and follow-ups on the home screen. Phase 2, step 3 built — the app is split into three sections, **School**, **Casting** and **Website**, switched with tabs at the top, and the studio has a **public website** run from the Website section: workshops with an apply form, a casting call with photos, about & coaches, and a link-in-bio page. Its forms feed Admissions (enquiries with source "website") and Casting › Applications. The team pack built (2026-11-23) — one **Team** page for everyone (with *Manage the team* it is also where team members are added and edited), profile photos, pictures and files on workshops, castings and in chat, one-to-one messages between everyone on the team, "call to the office", and alerts (in the app, and pushed to phones once the VAPID keys are set). Usernames and temporary first passwords built (2026-11-23) — people sign in with a **username** (their email address works in the same field), and a password someone else set for them works once: the first sign-in asks them to choose their own (see "Signing in" below). Reception and Office helper positions and **cafeteria orders** built (2026-11-23) — everyone orders tea, coffee or food from the app and the Office helper brings it (see "The cafeteria" below). The **video pipeline** built in its first form (2026-11-23, the roadmap's step 11) — a coach adds the link to a class video on the session, the video editor works through his queue, and the reviewer (Moaty) is alerted the moment an edit is done and approves it or sends it back with a note (see "Class videos" below). **"Add" everywhere and casting opportunities** built (2026-11-23) — every list has the same big "+ Add …" (at the bottom of the phone screen, above the tab bar; in the page header on a computer), every block inside a record has its own, and Casting › Opportunities holds the casting calls the team spots on Instagram, Facebook, WhatsApp groups or websites, added by hand with up to three screenshots, a red warning when the post asks actors for money, and "Turn into a casting". The rest of phase 2 is in `ROADMAP.md`.

## Run it

Requires Node 22+.

```
cd acting-school
npm install
npm run dev        # open http://localhost:5173
```

The first visit asks you to set up the school (school name + the first account, which gets the CEO position). To start with demo data instead: `npm run seed` (or `npm run seed -- --reset` to wipe an existing `$DATA_DIR` first), then sign in with one of the demo usernames below, all with the password `demo1234`. (Each account also has the address `<username>@demo.school`, which signs in just the same.) The demo accounts are not asked to choose their own password — a demo is one shared password. The demo data is dated relative to today, so it always looks current.

| Username | Position(s) | Fictional person |
|---|---|---|
| `owner` | CEO | Karim Mansour |
| `cfo` | CFO | Hisham Mansour |
| `director` | Executive Director | Dalia Fathy |
| `head` | Head of Casting | Sherif Adel |
| `casting` | Casting team | Tarek Samir |
| `editor` | Video editor | Hany Nabil |
| `coach` | Acting coach (teaches workshops) | Layla Haddad |
| `coach2` | Acting coach + Finance + Video reviewer (teaches workshops, checks every video edit — like Moaty) | Daniel Price |
| `reception` | Reception (no section yet: Team, Messages, the cafeteria) | Nour Hassan |
| `helper` | Office helper (the cafeteria's orders board; his account is in Arabic) | Sayed Ramadan |

(`tom`, a former coach — `tom.wilkins@demo.school` — is deactivated.) The cafeteria has the usual menu, a few orders delivered on the days before (so the owners' monthly page has something to show) and one turned down, one order delivered this morning and one waiting on the Office helper's board. The demo also has 16 enquiries in every admissions stage — follow-ups overdue, due today and later, interviews coming up, recorded (with scores) and one no-show, one enquiry enrolled into Screen Acting I and two lost — taken by the director — plus a filled-in website: studio texts and contact lines, three coach profiles, four workshops shown (no prices: the school's decision), an open casting call, three custom links, four casting applications with photos (one a minor with guardian consent) and two enquiries sent through the website. Ten class videos are on their way through the pipeline: three waiting for the editor (one late), one being edited by `editor`, two waiting for `coach2`'s check, one sent back with changes, and three approved.

Locked out? `npm run owner -- ceo` (the account's username, or its email address: `npm run owner -- someone@example.com`) gives that existing account an owner position — CEO, or another owner position if CEO has been made an ordinary one — reactivates it and lifts the sign-in brakes on it. (Upgrading a database from phase 1 needs nothing: each fixed role becomes the matching position — owner → CEO, admin → Executive Director, teacher → Acting coach, agent → Head of Casting. The server warns at startup if no active account holds an owner position.)

### Signing in: usernames and first passwords

- **Username.** Everyone signs in with a username: 3–20 characters from `a–z 0–9 . _ -`, starting with a letter, lower-case, unique. The sign-in field also takes the account's email address, in any letter case. Accounts made before usernames existed get one at the first start after the upgrade, from the first part of their email address (`owner@…` → `owner`; a clash gets a number; an address with nothing usable gets `user<id>`) — nobody is locked out, and the email keeps working.
- **Adding a team member** (Team › Add team member, *Manage the team*): name, username (offered from the first name; `first.last` when that is taken), position(s) and a first password. The email isn't asked for: the account gets `<username>@<email domain>` — the domain is in **Settings › Team email addresses**, `turquoisestudio.app` by default — unless the manager types another address.
- **Changing a username:** your own in **My profile**, a member's on their page (managers). An address that was the automatic one follows the new username; one the person typed themself stays.
- **A first password is temporary.** Whenever someone else sets a person's password — a manager adding them, a manager's reset, the operator's tool — the person's next sign-in shows one screen and nothing else: **Choose your own password** (at least 8 characters, not the temporary one again). Until they do, the app refuses everything else for that sign-in; once they have, their other devices are signed out. That is what makes a simple first password safe to hand over: it stops working the first time it is used.

Production on a server of your own: `npm run build && npm start` — one Node process serves the API and the app on `$PORT` (default 3000). Data lives in `$DATA_DIR` (default `./data`): `app.db` (SQLite) and `uploads/` (photos). Back up that folder. Put it behind HTTPS (the session cookie is `Secure` in production; set `COOKIE_SECURE=false` only to try it over plain http on a private network). The school's time zone (the server's "today") is `SCHOOL_TIME_ZONE`, default `Africa/Cairo`.

## Cloudflare

The app also runs on Cloudflare as **one Worker named `claude`**: the built web app is served as static assets, and the whole API runs inside one SQLite-backed Durable Object (the school's database — no separate database service). The repository is connected to that Worker through **Workers Builds**, with root directory `acting-school/`, install `npm ci`, build command `npm run build` and deploy command `npx wrangler deploy` — a push deploys. The configuration is `wrangler.jsonc`.

| Setting | Where | What |
|---|---|---|
| `ADMIN_TOKEN` | Secret (dashboard → the Worker → Settings → Variables and Secrets) | Bearer token for the operator endpoints below, 24+ random characters, **and the setup code** first-run setup asks for. Leave it unset and those endpoints don't exist — and nobody can set the school up. |
| `SCHOOL_TIME_ZONE` | `vars` in `wrangler.jsonc` | `Africa/Cairo`. Workers run in UTC; "today" on the server comes from this. |
| `ALLOW_DEMO_RESET` | `vars` | `"false"`. `"true"` only on a demo deployment (enables the reset below). |
| `PUBLIC_SITE_HOSTS` | `vars` (both wrangler configs) | `"turquoisestudio.app,www.turquoisestudio.app"`: the hosts that serve the public website at their root (the first is the one `www` redirects to). Everywhere else the website is under `/site`. Unset on Node unless you set it. |
| `SESSION_DAYS`, `COOKIE_SECURE` | optional vars | as on Node (cookies are `Secure`, named `__Host-as_session`, by default on Cloudflare). |
| `VAPID_PUBLIC_KEY` | `vars` in `wrangler.jsonc` **and** `wrangler.embedded.jsonc` (added by the operator at deploy) | Web Push to phones (new messages, "call to the office"). See "Phone alerts (VAPID keys)" below. |
| `VAPID_PRIVATE_KEY` | Secret | The other half of that pair. Without both keys push is simply off; the in-app Alerts bell works either way. |

**Set `ADMIN_TOKEN` before (or right after) the first deploy.** The Worker is public on its workers.dev address as soon as a push lands, and an empty school offers first-run setup — so on Cloudflare the setup screen asks for a **setup code**: the `ADMIN_TOKEN`. Without it nobody (an attacker polling for a fresh deployment included) can create the first owner account. The same holds after a demo reset. Either open the app and enter the code on the setup screen, or load the demo with `seed-demo` below (it creates the owner itself). On Node, setup stays open (the server isn't public until you put it somewhere); `REQUIRE_SETUP_CODE=true` turns the code on there too.

There's no shell next to the database on Cloudflare, so these replace `npm run seed` and `npm run owner` (all need `Authorization: Bearer $ADMIN_TOKEN`; the token is never logged). Replacing the demo with the real team is its own section, "Clearing the demo and creating the real team", below:

```
# Demo data into an empty deployment (409 once anyone has an account). Choose the password; it's never demo1234 there.
curl -X POST https://<worker-url>/api/admin/seed-demo -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"password":"a-long-demo-password"}'

# The website demo alone (texts, coaches, workshops shown, casting call, links, applications), for a school seeded before
# the website existed. Only while the website is empty (nothing saved, no coaches); else 409. seed-demo includes it already.
# The demo website is never public by itself: see "Publishing the website" below.
curl -X POST https://<worker-url>/api/admin/seed-demo-website -H "Authorization: Bearer $ADMIN_TOKEN"

# Locked out: same as npm run owner -- ceo (also lifts the sign-in brakes on that account).
# Name the account by its username, or by its email address: -d '{"email":"someone@example.com"}'.
# Check "name" in the answer: a username names whoever holds it now (people can change theirs).
curl -X POST https://<worker-url>/api/admin/grant-owner -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"username":"ceo"}'

# Demo deployments only (ALLOW_DEMO_RESET=true): delete every row and file; the next visit asks for setup again (with the setup code).
curl -X POST https://<worker-url>/api/admin/reset -H "Authorization: Bearer $ADMIN_TOKEN"
```

Sign-in brakes (both runtimes, kept in the database): 10 failed sign-ins per account from one address in 15 minutes, 100 per account from anywhere, 30 per address whatever the account, and 30 a minute across the whole school. An account's username and its email address count together, so typing one and then the other gives no extra guesses — and the other name is stopped the same way whether or not the account exists, so the brakes don't tell which usernames there are. They're checked before the password is hashed, so a flood of bad sign-ins can't stall the one Durable Object (scrypt runs on its only thread); while the school-wide brake holds nobody can sign in, but everyone already signed in carries on. Request bodies over 1 MB are refused (413) before they're read (uploads: 8 MB).

The Durable Object speaks Workers RPC (`extends DurableObject`), so wrangler's local explorer can run SQL against the local database (`npm run cf:dev` prints its address).

Uploaded photos are stored in the Durable Object's SQLite (R2 isn't enabled on the account yet). Once it is: create a private bucket, uncomment the `r2_buckets` line in `wrangler.jsonc`, and new uploads go there (older ones are still read from SQLite). Durable Objects keep 30 days of point-in-time recovery for the database. (`GET /api/admin/restore-point` and `POST /api/admin/restore`: see "Clearing the demo and creating the real team" below.)

**Deploying without Workers Builds.** Until the Workers Builds settings above are filled in, the app is deployed by hand with `npm run cf:deploy-embedded` (needs Cloudflare credentials). It's the same Worker and the same Durable Object, but the web app is bundled into the Worker's code (`wrangler.embedded.jsonc`, entry written by `scripts/embed-assets.ts`) instead of uploaded as static assets, because the cloud container's network proxy breaks Cloudflare's asset upload. It answers the same way: the headers from `_headers`, ETags, the SPA fallback, a 404 for a missing hashed file. The embed script stops with an error rather than serve something differently from the real asset server: a `_redirects` file in `dist/web`, or `_headers` rules other than exact paths and a trailing `*`. A later Workers Builds deploy simply replaces it, data kept.

Locally, in the same runtime (workerd), with nothing sent to Cloudflare:

```
npm run cf:dev                  # the Worker on http://localhost:8787 (-- --port 8790 for another port); data in .wrangler/state
npm run cf:smoke                # builds, starts it on :8790 with throwaway data, seeds and checks every module end to end (public website, the studio-domain routing, the team pack and clearing the demo included); -- --port N, -- --state-dir <folder>
npm run cf:smoke -- --embedded  # the same against the bundled variant (wrangler.embedded.jsonc)
```

`cf:dev` creates a gitignored `.dev.vars` with a throwaway `ADMIN_TOKEN` and `ALLOW_DEMO_RESET=true` (see `.dev.vars.example`), so the seed command above works against `http://localhost:8787` (and that token is the local setup code). Both commands start wrangler so that the Worker sees the address you really use (`localhost:8787`) rather than the first custom domain in `routes`; to see what a domain serves, send its name as the Host header: `curl -H 'Host: turquoisestudio.app' localhost:8787/en/workshops` (the public website), `curl -i -H 'Host: staff.turquoisestudio.app' localhost:8787/students` (301 to `team.turquoisestudio.app`).

### Clearing the demo and creating the real team

One operator call replaces the demo with the real school: `POST /api/admin/clear-demo` (same `Authorization: Bearer $ADMIN_TOKEN` as the endpoints above). It

- **deletes every record** — students, workshops, sessions, attendance, talent, castings, casting opportunities, enquiries, interviews, casting applications, chats, calls to the office, alerts, cafeteria orders, class videos, stored files, sign-in sessions and counters;
- **deletes every account** that is not named under `keep` (normally all of them);
- **creates the accounts** under `create`, each with a **temporary** first password: the person's first sign-in shows only "Choose your own password";
- makes `owner` an **active owner** (given the CEO position unless it already holds an owner position);
- treats the **website's content** as `keepSiteContent` says, and deletes the coaches and the workshops shown in every case (the records they were about are gone);
- **keeps** the settings, the positions (the school's own included), the email domain, the public forms' secret, and the cafeteria's menu, places and on/off switch.

Write the request in a file, `team.json`. It holds passwords: keep it out of the repository and delete it afterwards.

```
{
  "create": [
    { "name": "Ahmed Tamam", "username": "ceo",   "password": "…", "positions": ["ceo"] },
    { "name": "Salma",       "username": "salma", "password": "…", "positions": ["executive_director"] },
    { "name": "Moaty",       "username": "moaty", "password": "…", "positions": ["acting_coach", "finance"] }
  ],
  "owner": "ceo",
  "keepSiteContent": "contact"
}
```

- `positions` are the built-in positions' keys: `ceo`, `cfo`, `executive_director`, `head_of_casting`, `casting_team`, `video_editor`, `acting_coach`, `finance`, `reception`, `office_helper`, `video_reviewer`.
- `password` may be short (it is temporary); `locale` (`"en"` / `"ar"`: the app and the "Choose your own password" screen are in that language from the first sign-in; default: the school's language) and `email` are optional — without `email` the account gets `<username>@<email domain>`. Give every account **a password of its own**: a temporary password works for whoever types it first, and the person who signs in with it chooses the account's password — two accounts with one password (an owner's above all) can be taken by the wrong person. The dry run warns about it.
- Usernames follow the app's rules (3–20 of `a–z 0–9 . _ -`, a letter first, a letter or digit last); the studio's own mail names (`admin`, `postmaster`, `info`, …) are refused.
- `keep` (optional): usernames or email addresses of accounts that stay as they are — name, positions, password, language, photo. They are signed out like everyone else.
- `keepSiteContent`: `"contact"` keeps the tagline, about text, address, map link, WhatsApp lines, phone, email and Instagram, removes the custom links, the main photo and the casting call's texts, closes the casting call and leaves the website **not public**; `"all"` leaves the content exactly as it is (links, main photo, casting call and the "Website is public" switch included); `"none"` empties it.
- Unknown fields are refused, so a misspelt `dryRun` can never become a real run.

**1. See that a restore point is there** (Cloudflare; see the limits below):

```
curl https://<worker-url>/api/admin/restore-point -H "Authorization: Bearer $ADMIN_TOKEN"
# → {"bookmark":"0000007b-0000b26e-00001538-0c3e87bb…","at":1795455945998}
```

**2. Dry run** — the default. It changes nothing and answers the plan: every account as it will be (`accounts`), every account that goes (`willDeleteAccounts`: id, username, email, name), a count of what goes for every table, what happens to the website, `warnings`, and a `confirm` code.

```
curl -X POST https://<worker-url>/api/admin/clear-demo -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d @team.json
# → {"dryRun":true,"confirm":"3ea9c9c0-c033903d","accounts":[…],"willDeleteAccounts":[…],"warnings":[…],
#    "willDelete":{"students":25,…,"users":9,"files":44},"siteContent":{…}}
```

Read `willDeleteAccounts` (is anyone there who should be under `keep`?) and every warning before going on:

- `shared_password` — these new accounts would share one temporary password (`owner: true` when an owner's account is one of them). Whoever signs in first with it takes the account. Give each its own password and run the dry run again.
- `replaces_account` — a new account takes the username or email of an account that is deleted: that person's password, photo and records go, and they start again from a temporary password. If they should keep their account, move them to `keep`.

Warnings don't stop the run: the request is yours.

**3. Real run** — the same request with `"dryRun": false` and the code. Do it right after reading the plan.

```
jq '. + {dryRun: false, confirm: "3ea9c9c0-c033903d"}' team.json | \
  curl -X POST https://<worker-url>/api/admin/clear-demo -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H 'Content-Type: application/json' -d @-
# → {"dryRun":false,…,"deleted":{…},"restorePoint":{"kind":"bookmark","bookmark":"0000007b-…","at":…}}
```

The code is for **this request on this data, once**. A different request (another account, password, owner, website choice) answers 409 `confirm_mismatch`; the same request after a record was added or deleted (even one deleted and another added), or the website's texts were edited, answers 409 `plan_changed` — run the dry run again and read the new plan. After a run the code is spent: the accounts it created have new ids, so the same command sent again (from the shell history, or a retry after a timeout) answers `plan_changed` and can't delete them and bring their temporary passwords back. The real run's answer has `deletedAccounts` and `warnings` as the dry run showed them. (Sign-in sessions, sign-in brakes, form counters and phone-alert subscriptions are counted but are not part of the code: someone signing in between the two calls is no reason to start over.) Everything happens in one transaction: a run that fails for any reason changes nothing. Keep the `restorePoint` from the answer; it is also in the Worker's log.

Other refusals, all before anything changes: 400 `validation` (a malformed body; a username that breaks the rules is named in `issues`), `unknown_position`, `unknown_account` (a `keep` name nobody has), `duplicate_username`, `duplicate_email`, `owner_not_listed`, `no_accounts`, `confirm_required`; 409 `no_owner_position` (run `grant-owner` first); 503 `restore_point_failed`.

**Taking it back (Cloudflare).** The Durable Object keeps 30 days of point-in-time recovery for its database:

```
# To the restore point of the run…
curl -X POST https://<worker-url>/api/admin/restore -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"bookmark":"0000007b-0000b26e-00001538-0c3e87bb…"}'
# …or to how the database was some minutes ago (1 to 43200 = 30 days; approximate)
curl -X POST https://<worker-url>/api/admin/restore -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"minutesAgo":30}'
# → 202 {"restoringTo":"…","undoBookmark":"…"}   then the app restarts on the restored database, within a second
```

Its limits — read them before relying on it:

- **It takes the whole database back**, not just what the run deleted: every account created, password chosen and record entered after that moment is gone again. `undoBookmark` in the answer (and in the log) restores to just before the restore, should that have been a mistake. There is no dry run for a restore.
- **Only the database.** Uploaded files come back with it because they are stored in the database today; once an R2 bucket is bound, a file the run deleted from R2 stays deleted.
- **Sign-ins go back too:** whoever was signed in at that moment is signed in again, everyone since is signed out.
- **A second of errors** for requests in flight while the app restarts.
- **Cloudflare only, and not in local `wrangler dev`** (workerd keeps no history there): locally both endpoints answer 501 `not_supported` whatever the body, and a real run has `"restorePoint": null`. So the restore itself has never run outside Cloudflare — that is what step 1 is for: a bookmark in its answer shows recovery is there on the deployment.
- **On Node** there is no recovery over HTTP (both endpoints answer 501). Instead a real run first copies the database to `$DATA_DIR/app.before-clear-demo.<UTC time>.db` and answers `{"kind":"file","file":"…"}`. To go back: stop the server, put that file in place of `app.db` (delete `app.db-wal` and `app.db-shm`), start it. The copy holds the database only — not the files in `uploads/` that the run deleted; copy that folder yourself first if they matter.

### Phone alerts (VAPID keys)

Push notifications to phones are free (they go through the browsers' own push services: Apple, Google, Mozilla), but the server needs one key pair, the **VAPID keys**, to sign them. Without them everything else works and the in-app **Alerts** bell still lists every message and call; phones just don't buzz.

1. **Make the pair once**, on any computer with this repository: `npm run vapid-keys`. It prints two lines, `VAPID_PUBLIC_KEY=…` and `VAPID_PRIVATE_KEY=…` (base64url, P-256). Nothing is stored or sent anywhere.
2. **Cloudflare:**
   - the **public** key goes in `vars` in `wrangler.jsonc` *and* `wrangler.embedded.jsonc` (keep the two files in step; the key isn't secret, so committing it is fine). Don't add it only in the dashboard: every `wrangler deploy` (each Workers Builds push runs one) replaces the dashboard's plain vars with the ones in the file;
   - the **private** key is a **secret** named `VAPID_PRIVATE_KEY`: dashboard → the Worker → Settings → Variables and Secrets → Add → type *Secret* (or `wrangler secret put VAPID_PRIVATE_KEY` from the operator's own session). Secrets survive deploys. Never commit it or paste it into chat.
3. **Node:** set both as environment variables (`VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… npm start`). **Locally in workerd:** put both lines in `.dev.vars`.
4. **Check:** sign in, open **Profile › Alerts on this phone**. With the keys it offers "Turn on alerts on this phone" (and "Send me a test" once on); without them it says phone alerts aren't set up on this server. If only one key is set, or the pair is not valid, the server logs one line saying so (never the key) and push stays off.

The pushes are signed as the studio: the website's contact email (`mailto:`) when one is set, otherwise `https://turquoisestudio.app`. **Keep the same pair for good:** a new pair (for example after the private key leaked) works at once, but every phone has to turn alerts on again. On iPhone, alerts only work once the app has been added to the Home Screen (Share → Add to Home Screen) and opened from there; the Profile card explains this step by step.

## Sections

The staff app has three sections, switched with the tabs under the header (on phones) or at the top of the page (desktop). Each has its own colour, home page and menu; Positions and Settings sit under "Administration" in every section, and **Team** and the profile are always in the account menu ("More" on a phone).

| Section | Home | What's in it | Who sees it |
|---|---|---|---|
| **School** (turquoise) | `/school` | today's sessions, follow-ups, new website enquiries; Schedule (workshops + interviews), Admissions, Students, Workshops | anyone with *See workshops*, *See students* or *See admissions* |
| **Casting** (gold) | `/casting` | upcoming auditions, castings closing soon, new casting applications, new opportunities; Talent, Castings, Applications, Opportunities, Audition schedule | anyone with *See actors* or *See castings* |
| **Website** (indigo) | `/website` | The "Website is public" switch, "Open the website" ("Preview the website" until it is public), the casting call switch, every public page with Open / Copy link; Studio & contact, Workshops on the website, Casting call, Coaches, Link-in-bio | *Edit the website* (`website.manage`): owners and the Executive Director |

People who see only one section get no tabs (a coach sees School only). `/` opens the section you were last in; each tab goes back to the last page you had open in that section. Old links (`/students/12`, `/classes/3`, …) still work.

## The public website

**Publishing the website.** The website is **not public until someone switches it on**: Website section → the card at the top, **"Website is public"** (needs *Edit the website*; it asks before turning on). The demo content is made up, so replace the texts, coaches and workshops with the studio's own first. While it is off:
- visitors to the studio's domain see one **"coming soon"** page: the studio's name and, if they were saved, the WhatsApp buttons for workshops and casting, Instagram and the address. Every other address on the domain leads back to that page, no photo is served, and a form sent to it anyway is refused (503) with nothing stored;
- the team still sees the whole site at `/site/en` and `/site/ar` on the staff app's address ("Preview the website"), with a "Preview — the website is not public yet" line at the top of every page. The forms work there, so they can be tried: what is sent lands in Admissions and Casting › Applications like any other.

A deployment made before this switch existed comes up **not public** after the update, whatever it showed before: switch it on when the content is ready. After switching it off, someone who had a page open in the last minute may still see it for up to a minute.

Server-rendered pages in English and Arabic (no JavaScript, no prices — workshop cards and pages have an **"Ask about fees on WhatsApp"** button instead):

| Page | On the studio's domain | Preview on any other address |
|---|---|---|
| Home (picks Arabic or English from the browser) | `https://turquoisestudio.app/` → `/ar` or `/en` | `/site` → `/site/ar` or `/site/en` |
| Workshops, one workshop + its apply form | `/en/workshops`, `/en/workshops/12` | `/site/en/workshops`, `/site/en/workshops/12` |
| "Not sure which workshop? Ask us" | `/en/apply` | `/site/en/apply` |
| Casting call (form with 1–3 photos when open) | `/en/casting-call` | `/site/en/casting-call` |
| Link-in-bio (for the Instagram bio) | `/en/links` | `/site/en/links` |

**The studio's domain:** the staff app lives on `team.turquoisestudio.app` (its first address, `staff.turquoisestudio.app`, forwards there: the `HOST_REDIRECTS` var, `src/worker/hostRedirect.ts`); the website at the root of `turquoisestudio.app`, and `www.turquoisestudio.app` redirects there. The hosts that serve the website at their root are listed in the `PUBLIC_SITE_HOSTS` var (both wrangler configs); nothing of the staff app answers on them (`/api`, `/login`, the service worker: the site's 404 page). The domains are attached to the Worker by the `routes` (with `custom_domain: true`) in both wrangler configs. With `PUBLIC_SITE_HOSTS` set, the Website section's Open / Copy link buttons — the link for the Instagram bio included — give addresses on the first host listed (`https://turquoisestudio.app/ar/links`); the same pages stay reachable under `/site/…` on the staff app's address as previews, which name the studio's domain as their canonical address. Without `PUBLIC_SITE_HOSTS` (a local run) the buttons give the `/site/…` addresses of the host you are on.

Enquiries become ordinary leads (source "website": Admissions › filter by source). When the same person enquires again from the same phone, their open lead gets a note instead of a duplicate and comes up under "Follow-up due" that day; someone else on that phone — a parent's second child — gets a lead of their own. Casting applications wait in Casting › Applications until someone adds them to the roster (that creates the talent profile with their photos; the guardian's phone and the links stay on the application, for people who may see contact details) or declines them. Deleting an application, a talent profile or a talent photo also deletes the image files nothing else uses, so "please delete my photos" can be honoured whichever is deleted first.

The forms are protected without anything for the visitor to solve: an Origin check, a hidden trap field, a signed form token (at least 3 seconds, at most 24 hours old), body limits (64 KB for enquiries; 20 MB for the casting form, each photo at most 6 MB and a real JPEG/PNG/WebP; text fields of bounded length) and rate limits. The limits count two things. *Attempts*, before anything is read: 20 an hour per address for enquiries, 12 for the casting form — a form that comes back with a mistake doesn't lock anyone out. *What is stored*: enquiries 5 an hour per address and 300 a day in total; casting applications 3 an hour per address, 100 a day and 300 MB of photos kept a day in total — counted only when something is actually stored, so junk can't use up the school's day. An IPv6 address counts by its /64. At most 40 MB of casting uploads are received at one moment (two full-size applications, or several ordinary ones); beyond that the visitor is asked to try again in a minute. The limits are per address, so a flood from many addresses at once should be met with a Cloudflare rate-limiting rule on POSTs to the public hosts (dashboard › Security › WAF) — an operator setting, not part of the app. Only the website's own pictures (main photo, shown coaches, shown workshops' covers) are public at `/site/media/:id`; applicants' photos never are, and a student's or talent's photo can't be put on the site.

## The team pack

Everyone on the team can **put pictures and files** in the app and **message** everyone else; the CEO, CFO and Executive Directors can also **call someone to the office**.

- **Pictures and files.** Uploads are JPEG/PNG/WebP photos (shrunk on the phone) or PDF, Word, Excel and PowerPoint files (`.docx`/`.xlsx`/`.pptx`), up to 8 MB, recognised from the file itself, never from its name. Photos open in the app; documents download under their own name. Everyone has a profile photo (their own on Profile; anyone's with *Manage the team*, on that team member's page). A workshop has "Photos & files" (whoever sees the workshop sees them; its coach or anyone who can edit workshops adds them), a casting has "Files" (*See castings* / *Work on castings*). A file is deleted when the last thing using it goes.
- **Team and messages.** There is one **Team** page (`/team`), for everyone: everyone active with photo and positions (owners appear as name and photo only to non-owners) and a **Message** button. With *Manage the team* (`staff.manage`) the same page is where the team is managed: **Add team member**, **Edit** on each row (opens that team member's page: photo, details, positions, the Active switch, password reset) and an **Active / Inactive** filter. There is no separate Staff list any more — the old address `/staff` opens Team — and the word on screen is always "team" / "team member" (Arabic: الفريق / عضو الفريق). Chats are one-to-one; photos and files can be attached; a message can be deleted by its sender in the first 15 minutes; at most 60 messages a minute per person.
- **Call to the office** (permission *Call someone to the office*, `staff.summon`: owners and the Executive Director out of the box). The person gets a can't-miss banner (and a push notification) and answers **On my way** or **Can't come now**; the caller sees the answer. One open call per person at a time, a call expires after two hours, at most 20 an hour.
- **Notifications.** The **Alerts** bell lists new messages (one per conversation), calls and answers. With the VAPID keys set ("Phone alerts (VAPID keys)" above), they also reach phones as push notifications — free, through the browsers' own push services. On iPhone the app must be added to the Home Screen and opened from there first.
- **Where it is in the app.** **Messages** (with its unread count) and the **Alerts** bell sit at the top of every screen (in the sidebar on a computer); **Team** is in the account menu (“More” on a phone). Message / Call to the office buttons also sit on a team member's page, beside a workshop's coach and an enquiry's assignee (and Call to the office at the top of a conversation). A call to the office shows as a big banner at the top of every screen within about 20 seconds; **Profile › Alerts on this phone** turns on push for that phone (the service worker's push handlers are in `src/web/public/push-sw.js`).
- **There is no COO position.** The school asked for the button for "the CFO, COO and Executive Directors"; the studio has no COO, so out of the box the CEO, the CFO and the Executive Director can call people to the office. To give it to someone else, give one of their positions *Call someone to the office* on the Positions screen.

## The cafeteria

Everyone on the team can **order tea, coffee or something to eat** from the app, and the **Office helper** brings it. There are no prices and no tabs (the school's choice).

- **Ordering** (everyone, no permission needed): **Cafeteria** (البوفيه) in the account menu ("More" on a phone) of every section, and an **Order a drink** button on each section's home. The menu is grouped (hot drinks, cold drinks, food) with big − / + buttons; once something is chosen you can say how you want it — on a hot drink, **Sugar and extras** has one-tap choices (سادة / على الريحة / مضبوط / سكر زيادة / باللبن — No sugar, A little sugar, Medium sugar, Sweet, With milk), which each reader sees in their own language — and "Another …, made differently" adds a second one with its own words. Then **where to bring it** — big buttons for the places, or "Somewhere else" with a short text; your last place is remembered and always shown above **Send order** ("Bring it to: Studio 1 · Change") — an optional note, and **Send order**.
- **What became of it** shows in large words at the top: **Sent — waiting**, **On the way**, **Delivered ✓**, or **Cancelled** with the reason. You can cancel your own order while it is still waiting. You get an alert (and a phone alert, when those are on) when it is on the way and when it is delivered. Recent orders have **Order again**. At most 10 orders an hour each, 10 lines an order.
- **The orders board** (permission *Serve cafeteria orders and manage the menu*, `cafeteria.serve`: the Office helper, the Executive Director and owners) is the Office helper's home screen. New orders are at the top as big cards — a coloured strip saying **New order** or **On the way**, who, where, what, how long ago — with one big button for what he does next: **I'm taking it now**, then (in green) **I've delivered it**. After any tap the buttons rest for two seconds, so a double tap can't mark an order delivered by mistake. **Can't do this one** cancels with a short reason the person reads (three ready-made reasons, read by each person in their own language, or his own words). Today's delivered and cancelled orders are listed below. The board refreshes every 10 seconds and keeps the screen on where the phone allows it; after the page has been tapped once, the phone rings and buzzes for a new order (browsers allow sound only after a tap), and rings again once a minute while an order waits and nobody has touched the screen. On any other screen a banner tells him orders are waiting. The board also offers to turn on **alerts on this phone**, so a new order rings even with the screen off.
- **The Menu tab** (the Office helper, or anyone with *School settings* such as the Executive Director): add an item, rename it in English and Arabic (one language is enough), move it up or down, switch **Available** off for today (it stays on the menu, greyed out, "Not available now"), remove it; and the list of **places**. On an empty menu, **Add the usual items** puts tea, coffee, Turkish coffee, Nescafé, green tea, water, juice, soft drink, sandwich and biscuits there in one tap. **A new school starts with an empty menu:** until someone taps that button, the Cafeteria page says the menu is not ready yet.
- **Monthly consumption** (permission *See monthly cafeteria consumption*, `cafeteria.report`: the owners — CEO, CFO — and nobody else out of the box): the **Monthly** tab of the Cafeteria pages (`/cafeteria/report`). Pick a month (it opens on this month); it lists everyone who had something delivered that month — photo, name, how many orders — with each item and how many, then the total of each item. Only delivered orders count (not cancelled ones); someone no longer on the team is still listed for the months they ordered in. No prices.
- **Switching it off:** *Settings › Cafeteria* ("Ordering from the cafeteria"). It is saved the moment it is turned; switching off asks first, because orders still waiting or on the way are cancelled ("The cafeteria is closed now") and the people who ordered are told. Off, nothing about the cafeteria shows anywhere and nobody can order; the menu and the places are kept for when it is switched on again.
- **Who is told about a new order** (the school's decision, 2026-11-23): only the **Office helper** — everyone active who holds *Serve cafeteria orders* and has no School, Casting or Website section. The owners and the Executive Director hold the permission too, but get no order alerts; they can open the board from **Cafeteria** when they want to. Once someone takes the order (or it is cancelled) it leaves the helpers' bells, and the phone notification is replaced quietly. The person who ordered is told when it is on the way, delivered, or can't be made.
- **When someone leaves:** switching an account off cancels that person's open orders ("No longer on the team").

## Class videos

The coaches record in class; the video editor edits; the reviewer checks every edit. **Videos are links** (Google Drive, WeTransfer, YouTube unlisted, …): the app stores no video, so it costs nothing and needs no storage.

- **The coach adds the link** — right after class, **+ Add video** at the top of the session's page (or at the top of the session's **Videos** block, or of the workshop's **Videos** tab — the same "+ Add …" button as everywhere in the app): the link to the raw footage, a title (offered as "<workshop> — 23/11/2026": the date in digits, which reads the same in Arabic and English), what it is (scene, monologue, exercise, showreel, performance, other), who is in it (big tick boxes from the session's students), notes for the editor, and the day it is needed (tomorrow unless chosen). Permission *Add class videos for the editor* (`videos.add`): the Acting coaches and the Executive Director, only on the sessions and workshops they can see. While nobody has started on it, the coach can change or delete it. The **Videos** page itself has no Add button: a video always belongs to the class it was filmed in, and the session's page knows the workshop, the date and the students — a coach whose Videos page is still empty gets **Open the schedule** there.
- **The editor's queue** — **Videos** in the School section (`/videos`; first in the Video editor's bottom bar, with a count): **To edit** (new videos, and the ones sent back with the reviewer's note on top, then by due date; late ones in red), **Editing**, **Being checked**, **Approved**. One big button at a time: **Start editing** (or **Start fixing**) — the video then shows on top of **Editing**, with **Open raw footage** — then **Done — send the edit** with the link to the edited video and notes for the reviewer. After every tap the cards stay where they are for two seconds and the buttons rest, so a second tap on the same spot does nothing. Permission *Edit videos* (`videos.edit`): the Video editor (the Executive Director holds it too, without the alerts). If the editor stops editing videos (account switched off, or the Video editor position taken away), another editor can take over what he was editing, and "needs changes" goes to the editors who still edit.
- **The reviewer checks** — every finished edit alerts the reviewer (and his phone, when alerts are on): **To check** shows each edit with a big **Watch the edit** button, the editor's message, and two big buttons, **Approved ✓** and **Needs changes** (with a note for the editor). An approved video can be **sent back for changes** with a note, from its page. Permission *Check finished edits* (`videos.review`), through the **Video reviewer** position (the Executive Director holds it too, without the alerts). Nobody checks their own edit: someone given both Video editor and Video reviewer can't approve or send back what they edited — another reviewer does (owners excepted).
- **Everyone sees that it worked:** after each step the screen says who got the alert — "Sent for checking — Moaty got an alert", "Approved — Layla got an alert". If nobody holds the Video reviewer position, the editor's **Done** sheet and its answer say so ("nobody is set to check edits yet — tell the office"), and whoever can give the position — the owners and the Executive Director — sees **Nobody checks finished edits yet** on the Videos page and the School home, with a button to **Team**.
- **Who is told what:** a new video → the editors; a finished edit → the reviewers; "needs changes" → the editor who did it; "approved" → the coach who added it. **Nobody who manages the team** (*Manage the team*: the owners and the Executive Director) is alerted as an editor or a reviewer, counted in "to edit" / "to check", or counted as someone who checks edits — even though they can press those buttons themselves (they see everything in the queue); if one of them did an edit that is sent back, the editors are told. Owners are told only about something they did themselves (a video they added was approved). Each video's page has its whole history and comments for the coach, the editors, the reviewers and the owners.
- **The School home** shows each person their part: "5 videos to edit (2 due today)", "2 videos to check", and the coach's "1 of your videos approved this week" or "3 of your videos are with the editor or the reviewer".
- **To do after this release (an owner, once):** open **Team › Moaty** and give him the **Video reviewer** position on top of Acting coach and Finance — until someone holds it, finished edits alert nobody (the owners and the Executive Director see a warning until then). For Moaty only an owner can (his Finance position is beyond the Executive Director's reach).
- **The Executive Director keeps managing the video team** (the school's decision): she manages the team, so she also holds *Edit videos* and *Check finished edits* (given once to the live database at the next start) — the **Video editor** and **Video reviewer** positions and the accounts of the people who hold them stay within her reach (reset Ali's password, switch his account off, change his positions, give a coach the Video reviewer position). She is **never alerted** as an editor or a reviewer and gets no "to edit" / "to check" counts; she can still start, finish, approve or send back a video if she chooses — never her own edit, which another reviewer checks.

## Positions

Access comes from **positions**. A person can hold several; their permissions add up (e.g. Acting coach + Finance). Owners (CEO, CFO) can change everything on the Positions screen; the Executive Director can manage the team and positions too, but only within her own access. The built-in positions as confirmed by the school:

| Position | Can see / do |
|---|---|
| **CEO**, **CFO** (owner positions) | Everything, including team accounts, positions, all money, and permissions added later. Owner accounts and owner positions are invisible to everyone else. |
| **Executive Director** | Everything except money totals (payment status only) and the monthly cafeteria page: team accounts and positions (never beyond her own access, never owners), settings, students with contacts, all workshops, attendance, actors, castings, sending actors to clients, admissions (enquiries, interviews, decisions, enrolling), the public website, calling people to the office, and the cafeteria's orders board and menu (without the order alerts, which go to the Office helper), adding class videos and the whole video pipeline — she holds the editor's and the reviewer's permissions so the video team stays within her reach, and can use their buttons, but gets no editor or reviewer alerts. |
| **Head of Casting** | Actor database with contacts, castings, sending actors to clients; sees students and all workshops (names, no student contacts). |
| **Casting team** | Adds and updates actors (with contacts), builds shortlists. Can't send to clients. Sees students (no contacts). |
| **Video editor** | Students, workshops and actors — names and photos only: no contact details, no money. The editor's queue of class videos (alerted about every new one). |
| **Acting coach** | Only their own students and workshops (as the workshop's teacher or a session's substitute): attendance for the sessions they teach; adding class videos for the editor. No contact details. |
| **Finance** | Payment status and money; students with guardian/emergency contacts; all workshops. |
| **Reception** | Nothing in the three sections yet — the school will say what Reception does. Like everyone: Team, Messages, Alerts, My profile, cafeteria ordering; can be called to the office. |
| **Office helper** | The cafeteria: the orders board (On the way, Delivered, Can't do this one) and the menu and places. Nothing in the three sections. |
| **Video reviewer** | Checks every finished video edit (alerted about each one): Approved, or Needs changes with a note; sees the whole video pipeline. Given on top of a person's other positions (Moaty: Acting coach + Finance + Video reviewer). |

Reception and Office helper were added on 2026-11-23: an existing database gets them once, the next time the app starts, and nothing else about its positions or people changes. The Executive Director serves the cafeteria too (given once to existing databases at the next start), so she can create the office helper's account, give him the **Office helper** position, reset his password and switch his account off when he leaves; she gets no order alerts from it.

Video reviewer was added with the video pipeline (2026-11-23): it appears once in an existing database at the next start, and at the same start the coaches get *Add class videos*, the Video editor *Edit videos*, and the Executive Director *Add class videos* and *See the class videos*, then *Edit videos* and *Check finished edits* (the school's decision: she keeps reach over the video team; once — a permission an owner removes afterwards stays removed). Nobody is given the Video reviewer position automatically.

Rules that always hold: nobody can give anyone (or themselves) access they don't have; nobody changes their own positions or deactivates themselves; someone who can do more than you is out of your reach (no editing, password reset or deactivation — and no changing a position they hold); there is always at least one active account in an owner position. Built-in positions can be renamed and changed, not deleted.

**Admissions** has three permissions: *See admissions* (enquiries with their contact details, interviews, history — not limited to anyone's workshops), *Work on admissions* (add/edit enquiries, log calls and messages, follow-ups, schedule interviews, close/reopen) and *Admissions decisions* (interview assessments, accept/decline, choose the workshop, enrol — enrolling creates the student and the enrollment even without "Edit students"/"Edit workshops"). Only the Executive Director (and owners) hold them out of the box. Permissions added to a built-in position after it first shipped reach existing databases once, at startup (`BUILT_IN_GRANTS` in `src/shared/permissions.ts`); a permission an owner removes afterwards stays removed.

Without "All workshops" a person sees their own workshops — the ones they teach (or cover as a substitute) and the ones they created — and those workshops' students plus the students they added. Taking attendance needs "See workshops" as well. (The permission keys behind these labels stay `classes.all`, `courses.read` and `courses.write`.)

Students and actors don't have logins.

See `CLAUDE.md` for the architecture and the rules the code follows.
