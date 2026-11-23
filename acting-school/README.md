# Acting School

Internal staff app for an acting school that is also a talent agency. Works in the browser on desktop and phone (installable to the home screen), in English and Arabic.

**Status:** phase 1 built — sign-in and first-run setup, staff accounts and settings, students, workshops (weekly schedule, sessions, attendance), talent roster with headshots, castings with roles and submissions, the combined schedule and the home dashboard, in English and Arabic (right-to-left). Phase 2, step 1 built — editable positions and permissions. Phase 2, step 2 built — admissions: enquiries from every source with follow-up reminders, pre-written WhatsApp messages (wa.me links, English or Arabic), interviews scored on the criteria in Settings, decisions and enrolment into a workshop, with interviews on the schedule and follow-ups on the home screen. Phase 2, step 3 (in progress) — the app is split into three sections, **School**, **Casting** and **Website**, switched with tabs at the top, and the studio has a **public website** run from the Website section: workshops with an apply form, a casting call with photos, about & coaches, and a link-in-bio page. Its forms feed Admissions (enquiries with source "website") and Casting › Applications. The rest of phase 2 is in `ROADMAP.md`.

## Run it

Requires Node 22+.

```
cd acting-school
npm install
npm run dev        # open http://localhost:5173
```

The first visit asks you to set up the school (school name + the first account, which gets the CEO position). To start with demo data instead: `npm run seed` (or `npm run seed -- --reset` to wipe an existing `$DATA_DIR` first), then sign in with one of the demo logins below, all with the password `demo1234`. The demo data is dated relative to today, so it always looks current.

| Login | Position(s) | Fictional person |
|---|---|---|
| `owner@demo.school` | CEO | Karim Mansour |
| `cfo@demo.school` | CFO | Hisham Mansour |
| `director@demo.school` | Executive Director | Dalia Fathy |
| `head@demo.school` | Head of Casting | Sherif Adel |
| `casting@demo.school` | Casting team | Tarek Samir |
| `editor@demo.school` | Video editor | Hany Nabil |
| `coach@demo.school` | Acting coach (teaches workshops) | Layla Haddad |
| `coach2@demo.school` | Acting coach + Finance (teaches workshops) | Daniel Price |

(`tom.wilkins@demo.school`, a former coach, is deactivated.) The demo also has 16 enquiries in every admissions stage — follow-ups overdue, due today and later, interviews coming up, recorded (with scores) and one no-show, one enquiry enrolled into Screen Acting I and two lost — taken by the director — plus a filled-in website: studio texts and contact lines, three coach profiles, four workshops shown (no prices: the school's decision), an open casting call, three custom links, four casting applications with photos (one a minor with guardian consent) and two enquiries sent through the website.

Locked out? `npm run owner -- someone@example.com` gives that existing account an owner position — CEO, or another owner position if CEO has been made an ordinary one — reactivates it and lifts the sign-in brakes on its email. (Upgrading a database from phase 1 needs nothing: each fixed role becomes the matching position — owner → CEO, admin → Executive Director, teacher → Acting coach, agent → Head of Casting. The server warns at startup if no active account holds an owner position.)

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

**Set `ADMIN_TOKEN` before (or right after) the first deploy.** The Worker is public on its workers.dev address as soon as a push lands, and an empty school offers first-run setup — so on Cloudflare the setup screen asks for a **setup code**: the `ADMIN_TOKEN`. Without it nobody (an attacker polling for a fresh deployment included) can create the first owner account. The same holds after a demo reset. Either open the app and enter the code on the setup screen, or load the demo with `seed-demo` below (it creates the owner itself). On Node, setup stays open (the server isn't public until you put it somewhere); `REQUIRE_SETUP_CODE=true` turns the code on there too.

There's no shell next to the database on Cloudflare, so these replace `npm run seed` and `npm run owner` (all need `Authorization: Bearer $ADMIN_TOKEN`; the token is never logged):

```
# Demo data into an empty deployment (409 once anyone has an account). Choose the password; it's never demo1234 there.
curl -X POST https://<worker-url>/api/admin/seed-demo -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"password":"a-long-demo-password"}'

# The website demo alone (texts, coaches, workshops shown, casting call, links, applications), for a school seeded before
# the website existed. Only while the website is empty (nothing saved, no coaches); else 409. seed-demo includes it already.
curl -X POST https://<worker-url>/api/admin/seed-demo-website -H "Authorization: Bearer $ADMIN_TOKEN"

# Locked out: same as npm run owner -- someone@example.com (also lifts the sign-in brakes on that email)
curl -X POST https://<worker-url>/api/admin/grant-owner -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"email":"someone@example.com"}'

# Demo deployments only (ALLOW_DEMO_RESET=true): delete every row and file; the next visit asks for setup again (with the setup code).
curl -X POST https://<worker-url>/api/admin/reset -H "Authorization: Bearer $ADMIN_TOKEN"
```

Sign-in brakes (both runtimes, kept in the database): 10 failed sign-ins per email from one address in 15 minutes, 100 per email from anywhere, 30 per address whatever the email, and 30 a minute across the whole school. They're checked before the password is hashed, so a flood of bad sign-ins can't stall the one Durable Object (scrypt runs on its only thread); while the school-wide brake holds nobody can sign in, but everyone already signed in carries on. Request bodies over 1 MB are refused (413) before they're read (uploads: 8 MB).

The Durable Object speaks Workers RPC (`extends DurableObject`), so wrangler's local explorer can run SQL against the local database (`npm run cf:dev` prints its address).

Uploaded photos are stored in the Durable Object's SQLite (R2 isn't enabled on the account yet). Once it is: create a private bucket, uncomment the `r2_buckets` line in `wrangler.jsonc`, and new uploads go there (older ones are still read from SQLite). Durable Objects keep 30 days of point-in-time recovery for the database.

**Deploying without Workers Builds.** Until the Workers Builds settings above are filled in, the app is deployed by hand with `npm run cf:deploy-embedded` (needs Cloudflare credentials). It's the same Worker and the same Durable Object, but the web app is bundled into the Worker's code (`wrangler.embedded.jsonc`, entry written by `scripts/embed-assets.ts`) instead of uploaded as static assets, because the cloud container's network proxy breaks Cloudflare's asset upload. It answers the same way: the headers from `_headers`, ETags, the SPA fallback, a 404 for a missing hashed file. The embed script stops with an error rather than serve something differently from the real asset server: a `_redirects` file in `dist/web`, or `_headers` rules other than exact paths and a trailing `*`. A later Workers Builds deploy simply replaces it, data kept.

Locally, in the same runtime (workerd), with nothing sent to Cloudflare:

```
npm run cf:dev                  # the Worker on http://localhost:8787 (-- --port 8790 for another port); data in .wrangler/state
npm run cf:smoke                # builds, starts it on :8790 with throwaway data, seeds and checks every module end to end (public website and the studio-domain routing included); -- --port N, -- --state-dir <folder>
npm run cf:smoke -- --embedded  # the same against the bundled variant (wrangler.embedded.jsonc)
```

`cf:dev` creates a gitignored `.dev.vars` with a throwaway `ADMIN_TOKEN` and `ALLOW_DEMO_RESET=true` (see `.dev.vars.example`), so the seed command above works against `http://localhost:8787` (and that token is the local setup code).

## Sections

The staff app has three sections, switched with the tabs under the header (on phones) or at the top of the page (desktop). Each has its own colour, home page and menu; Staff, Positions and Settings sit under "Administration" in every section, and the profile is always in the menu.

| Section | Home | What's in it | Who sees it |
|---|---|---|---|
| **School** (turquoise) | `/school` | today's sessions, follow-ups, new website enquiries; Schedule (workshops + interviews), Admissions, Students, Workshops | anyone with *See workshops*, *See students* or *See admissions* |
| **Casting** (gold) | `/casting` | upcoming auditions, castings closing soon, new casting applications; Talent, Castings, Applications, Audition schedule | anyone with *See actors* or *See castings* |
| **Website** (indigo) | `/website` | "Open the website", the casting call switch, every public page with Open / Copy link; Studio & contact, Workshops on the website, Casting call, Coaches, Link-in-bio | *Edit the website* (`website.manage`): owners and the Executive Director |

People who see only one section get no tabs (a coach sees School only). `/` opens the section you were last in; each tab goes back to the last page you had open in that section. Old links (`/students/12`, `/classes/3`, …) still work.

## The public website

Server-rendered pages in English and Arabic (no JavaScript, no prices — workshop cards and pages have an **"Ask about fees on WhatsApp"** button instead):

| Page | On the studio's domain | Preview on any other address |
|---|---|---|
| Home (picks Arabic or English from the browser) | `https://turquoisestudio.app/` → `/ar` or `/en` | `/site` → `/site/ar` or `/site/en` |
| Workshops, one workshop + its apply form | `/en/workshops`, `/en/workshops/12` | `/site/en/workshops`, `/site/en/workshops/12` |
| "Not sure which workshop? Ask us" | `/en/apply` | `/site/en/apply` |
| Casting call (form with 1–3 photos when open) | `/en/casting-call` | `/site/en/casting-call` |
| Link-in-bio (for the Instagram bio) | `/en/links` | `/site/en/links` |

**The studio's domain:** the staff app lives on `staff.turquoisestudio.app`; the website at the root of `turquoisestudio.app`, and `www.turquoisestudio.app` redirects there. The hosts that serve the website at their root are listed in the `PUBLIC_SITE_HOSTS` var (both wrangler configs); nothing of the staff app answers on them (`/api`, `/login`, the service worker: the site's 404 page). The domains are attached to the Worker by the `routes` (with `custom_domain: true`) in both wrangler configs. With `PUBLIC_SITE_HOSTS` set, the Website section's Open / Copy link buttons — the link for the Instagram bio included — give addresses on the first host listed (`https://turquoisestudio.app/ar/links`); the same pages stay reachable under `/site/…` on the staff address as previews, which name the studio's domain as their canonical address. Without `PUBLIC_SITE_HOSTS` (a local run) the buttons give the `/site/…` addresses of the host you are on.

Enquiries become ordinary leads (source "website": Admissions › filter by source). When the same person enquires again from the same phone, their open lead gets a note instead of a duplicate and comes up under "Follow-up due" that day; someone else on that phone — a parent's second child — gets a lead of their own. Casting applications wait in Casting › Applications until someone adds them to the roster (that creates the talent profile with their photos; the guardian's phone and the links stay on the application, for people who may see contact details) or declines them. Deleting an application, a talent profile or a talent photo also deletes the image files nothing else uses, so "please delete my photos" can be honoured whichever is deleted first.

The forms are protected without anything for the visitor to solve: an Origin check, a hidden trap field, a signed form token (at least 3 seconds, at most 24 hours old), body limits (64 KB for enquiries; 20 MB for the casting form, each photo at most 6 MB and a real JPEG/PNG/WebP; text fields of bounded length) and rate limits. The limits count two things. *Attempts*, before anything is read: 20 an hour per address for enquiries, 12 for the casting form — a form that comes back with a mistake doesn't lock anyone out. *What is stored*: enquiries 5 an hour per address and 300 a day in total; casting applications 3 an hour per address, 100 a day and 300 MB of photos kept a day in total — counted only when something is actually stored, so junk can't use up the school's day. An IPv6 address counts by its /64. At most 40 MB of casting uploads are received at one moment (two full-size applications, or several ordinary ones); beyond that the visitor is asked to try again in a minute. The limits are per address, so a flood from many addresses at once should be met with a Cloudflare rate-limiting rule on POSTs to the public hosts (dashboard › Security › WAF) — an operator setting, not part of the app. Only the website's own pictures (main photo, shown coaches, shown workshops' covers) are public at `/site/media/:id`; applicants' photos never are, and a student's or talent's photo can't be put on the site.

## Positions

Access comes from **positions**. A person can hold several; their permissions add up (e.g. Acting coach + Finance). Owners (CEO, CFO) can change everything on the Positions screen; the Executive Director can manage staff and positions too, but only within her own access. The built-in positions as confirmed by the school:

| Position | Can see / do |
|---|---|
| **CEO**, **CFO** (owner positions) | Everything, including staff accounts, positions, all money, and permissions added later. Owner accounts and owner positions are invisible to everyone else. |
| **Executive Director** | Everything except money totals (payment status only): staff accounts and positions (never beyond her own access, never owners), settings, students with contacts, all workshops, attendance, actors, castings, sending actors to clients, admissions (enquiries, interviews, decisions, enrolling) and the public website. |
| **Head of Casting** | Actor database with contacts, castings, sending actors to clients; sees students and all workshops (names, no student contacts). |
| **Casting team** | Adds and updates actors (with contacts), builds shortlists. Can't send to clients. Sees students (no contacts). |
| **Video editor** | Students, workshops and actors — names and photos only: no contact details, no money. |
| **Acting coach** | Only their own students and workshops (as the workshop's teacher or a session's substitute): attendance for the sessions they teach. No contact details. |
| **Finance** | Payment status and money; students with guardian/emergency contacts; all workshops. |

Rules that always hold: nobody can give anyone (or themselves) access they don't have; nobody changes their own positions or deactivates themselves; someone who can do more than you is out of your reach (no editing, password reset or deactivation — and no changing a position they hold); there is always at least one active account in an owner position. Built-in positions can be renamed and changed, not deleted.

**Admissions** has three permissions: *See admissions* (enquiries with their contact details, interviews, history — not limited to anyone's workshops), *Work on admissions* (add/edit enquiries, log calls and messages, follow-ups, schedule interviews, close/reopen) and *Admissions decisions* (interview assessments, accept/decline, choose the workshop, enrol — enrolling creates the student and the enrollment even without "Edit students"/"Edit workshops"). Only the Executive Director (and owners) hold them out of the box. Permissions added to a built-in position after it first shipped reach existing databases once, at startup (`BUILT_IN_GRANTS` in `src/shared/permissions.ts`); a permission an owner removes afterwards stays removed.

Without "All workshops" a person sees their own workshops — the ones they teach (or cover as a substitute) and the ones they created — and those workshops' students plus the students they added. Taking attendance needs "See workshops" as well. (The permission keys behind these labels stay `classes.all`, `courses.read` and `courses.write`.)

Students and actors don't have logins.

See `CLAUDE.md` for the architecture and the rules the code follows.
