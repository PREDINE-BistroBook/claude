# Acting School

Internal staff app for an acting school that is also a talent agency. Works in the browser on desktop and phone (installable to the home screen), in English and Arabic.

**Status:** phase 1 built — sign-in and first-run setup, staff accounts and settings, students, workshops (weekly schedule, sessions, attendance), talent roster with headshots, castings with roles and submissions, the combined schedule and the home dashboard, in English and Arabic (right-to-left). Phase 2, step 1 built — editable positions and permissions. Phase 2, step 2 built — admissions: enquiries from every source with follow-up reminders, pre-written WhatsApp messages (wa.me links, English or Arabic), interviews scored on the criteria in Settings, decisions and enrolment into a workshop, with interviews on the schedule and follow-ups on the home screen. The rest of phase 2 is in `ROADMAP.md`.

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

(`tom.wilkins@demo.school`, a former coach, is deactivated.) The demo also has 16 enquiries in every admissions stage — follow-ups overdue, due today and later, interviews coming up, recorded (with scores) and one no-show, one enquiry enrolled into Screen Acting I and two lost — taken by the director.

Locked out? `npm run owner -- someone@example.com` gives that existing account an owner position — CEO, or another owner position if CEO has been made an ordinary one — reactivates it and lifts the sign-in brakes on its email. (Upgrading a database from phase 1 needs nothing: each fixed role becomes the matching position — owner → CEO, admin → Executive Director, teacher → Acting coach, agent → Head of Casting. The server warns at startup if no active account holds an owner position.)

Production on a server of your own: `npm run build && npm start` — one Node process serves the API and the app on `$PORT` (default 3000). Data lives in `$DATA_DIR` (default `./data`): `app.db` (SQLite) and `uploads/` (photos). Back up that folder. Put it behind HTTPS (the session cookie is `Secure` in production; set `COOKIE_SECURE=false` only to try it over plain http on a private network). The school's time zone (the server's "today") is `SCHOOL_TIME_ZONE`, default `Africa/Cairo`.

## Cloudflare

The app also runs on Cloudflare as **one Worker named `claude`**: the built web app is served as static assets, and the whole API runs inside one SQLite-backed Durable Object (the school's database — no separate database service). The repository is connected to that Worker through **Workers Builds**, with root directory `acting-school/`, install `npm ci`, build command `npm run build` and deploy command `npx wrangler deploy` — a push deploys. The configuration is `wrangler.jsonc`.

| Setting | Where | What |
|---|---|---|
| `ADMIN_TOKEN` | Secret (dashboard → the Worker → Settings → Variables and Secrets) | Bearer token for the operator endpoints below, 24+ random characters, **and the setup code** first-run setup asks for. Leave it unset and those endpoints don't exist — and nobody can set the school up. |
| `SCHOOL_TIME_ZONE` | `vars` in `wrangler.jsonc` | `Africa/Cairo`. Workers run in UTC; "today" on the server comes from this. |
| `ALLOW_DEMO_RESET` | `vars` | `"false"`. `"true"` only on a demo deployment (enables the reset below). |
| `SESSION_DAYS`, `COOKIE_SECURE` | optional vars | as on Node (cookies are `Secure`, named `__Host-as_session`, by default on Cloudflare). |

**Set `ADMIN_TOKEN` before (or right after) the first deploy.** The Worker is public on its workers.dev address as soon as a push lands, and an empty school offers first-run setup — so on Cloudflare the setup screen asks for a **setup code**: the `ADMIN_TOKEN`. Without it nobody (an attacker polling for a fresh deployment included) can create the first owner account. The same holds after a demo reset. Either open the app and enter the code on the setup screen, or load the demo with `seed-demo` below (it creates the owner itself). On Node, setup stays open (the server isn't public until you put it somewhere); `REQUIRE_SETUP_CODE=true` turns the code on there too.

There's no shell next to the database on Cloudflare, so these replace `npm run seed` and `npm run owner` (all need `Authorization: Bearer $ADMIN_TOKEN`; the token is never logged):

```
# Demo data into an empty deployment (409 once anyone has an account). Choose the password; it's never demo1234 there.
curl -X POST https://<worker-url>/api/admin/seed-demo -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"password":"a-long-demo-password"}'

# Locked out: same as npm run owner -- someone@example.com (also lifts the sign-in brakes on that email)
curl -X POST https://<worker-url>/api/admin/grant-owner -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"email":"someone@example.com"}'

# Demo deployments only (ALLOW_DEMO_RESET=true): delete every row and file; the next visit asks for setup again (with the setup code).
curl -X POST https://<worker-url>/api/admin/reset -H "Authorization: Bearer $ADMIN_TOKEN"
```

Sign-in brakes (both runtimes, kept in the database): 10 failed sign-ins per email from one address in 15 minutes, 100 per email from anywhere, 30 per address whatever the email, and 30 a minute across the whole school. They're checked before the password is hashed, so a flood of bad sign-ins can't stall the one Durable Object (scrypt runs on its only thread); while the school-wide brake holds nobody can sign in, but everyone already signed in carries on. Request bodies over 1 MB are refused (413) before they're read (uploads: 8 MB).

The Durable Object speaks Workers RPC (`extends DurableObject`), so wrangler's local explorer can run SQL against the local database (`npm run cf:dev` prints its address).

Uploaded photos are stored in the Durable Object's SQLite (R2 isn't enabled on the account yet). Once it is: create a private bucket, uncomment the `r2_buckets` line in `wrangler.jsonc`, and new uploads go there (older ones are still read from SQLite). Durable Objects keep 30 days of point-in-time recovery for the database.

Locally, in the same runtime (workerd), with nothing sent to Cloudflare:

```
npm run cf:dev                  # the Worker on http://localhost:8787 (-- --port 8790 for another port); data in .wrangler/state
npm run cf:smoke                # builds, starts it on :8790 with throwaway data, seeds and checks every module end to end
```

`cf:dev` creates a gitignored `.dev.vars` with a throwaway `ADMIN_TOKEN` and `ALLOW_DEMO_RESET=true` (see `.dev.vars.example`), so the seed command above works against `http://localhost:8787` (and that token is the local setup code).

## Positions

Access comes from **positions**. A person can hold several; their permissions add up (e.g. Acting coach + Finance). Owners (CEO, CFO) can change everything on the Positions screen; the Executive Director can manage staff and positions too, but only within her own access. The built-in positions as confirmed by the school:

| Position | Can see / do |
|---|---|
| **CEO**, **CFO** (owner positions) | Everything, including staff accounts, positions, all money, and permissions added later. Owner accounts and owner positions are invisible to everyone else. |
| **Executive Director** | Everything except money totals (payment status only): staff accounts and positions (never beyond her own access, never owners), settings, students with contacts, all workshops, attendance, actors, castings, sending actors to clients, and admissions (enquiries, interviews, decisions, enrolling). |
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
