# Acting School

Internal staff app for an acting school that is also a talent agency. Works in the browser on desktop and phone (installable to the home screen), in English and Arabic.

**Status:** phase 1 built — sign-in and first-run setup, staff accounts and settings, students, classes (weekly schedule, sessions, attendance), talent roster with headshots, castings with roles and submissions, the combined schedule and the home dashboard, in English and Arabic (right-to-left). Phase 2, step 1 built — editable positions and permissions. Phase 2, step 2 built — admissions: enquiries from every source with follow-up reminders, pre-written WhatsApp messages (wa.me links, English or Arabic), interviews scored on the criteria in Settings, decisions and enrolment into a class, with interviews on the schedule and follow-ups on the home screen. The rest of phase 2 is in `ROADMAP.md`.

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
| `coach@demo.school` | Acting coach (teaches classes) | Layla Haddad |
| `coach2@demo.school` | Acting coach + Finance (teaches classes) | Daniel Price |

(`tom.wilkins@demo.school`, a former coach, is deactivated.) The demo also has 16 enquiries in every admissions stage — follow-ups overdue, due today and later, interviews coming up, recorded (with scores) and one no-show, one enquiry enrolled into Screen Acting I and two lost — taken by the director.

Locked out? `npm run owner -- someone@example.com` gives that existing account an owner position — CEO, or another owner position if CEO has been made an ordinary one — and reactivates it. (Upgrading a database from phase 1 needs nothing: each fixed role becomes the matching position — owner → CEO, admin → Executive Director, teacher → Acting coach, agent → Head of Casting. The server warns at startup if no active account holds an owner position.)

Production: `npm run build && npm start` — one Node process serves the API and the app on `$PORT` (default 3000). Data lives in `$DATA_DIR` (default `./data`): `app.db` (SQLite) and `uploads/` (photos). Back up that folder. Put it behind HTTPS (the session cookie is `Secure` in production; set `COOKIE_SECURE=false` only to try it over plain http on a private network).

## Positions

Access comes from **positions**. A person can hold several; their permissions add up (e.g. Acting coach + Finance). Owners (CEO, CFO) can change everything on the Positions screen; the Executive Director can manage staff and positions too, but only within her own access. The built-in positions as confirmed by the school:

| Position | Can see / do |
|---|---|
| **CEO**, **CFO** (owner positions) | Everything, including staff accounts, positions, all money, and permissions added later. Owner accounts and owner positions are invisible to everyone else. |
| **Executive Director** | Everything except money totals (payment status only): staff accounts and positions (never beyond her own access, never owners), settings, students with contacts, all classes, attendance, actors, castings, sending actors to clients, and admissions (enquiries, interviews, decisions, enrolling). |
| **Head of Casting** | Actor database with contacts, castings, sending actors to clients; sees students and all classes (names, no student contacts). |
| **Casting team** | Adds and updates actors (with contacts), builds shortlists. Can't send to clients. Sees students (no contacts). |
| **Video editor** | Students, classes and actors — names and photos only: no contact details, no money. |
| **Acting coach** | Only their own students and classes (as the class's teacher or a session's substitute): attendance for the sessions they teach. No contact details. |
| **Finance** | Payment status and money; students with guardian/emergency contacts; all classes. |

Rules that always hold: nobody can give anyone (or themselves) access they don't have; nobody changes their own positions or deactivates themselves; someone who can do more than you is out of your reach (no editing, password reset or deactivation — and no changing a position they hold); there is always at least one active account in an owner position. Built-in positions can be renamed and changed, not deleted.

**Admissions** has three permissions: *See admissions* (enquiries with their contact details, interviews, history — not limited to anyone's classes), *Work on admissions* (add/edit enquiries, log calls and messages, follow-ups, schedule interviews, close/reopen) and *Admissions decisions* (interview assessments, accept/decline, choose the class, enrol — enrolling creates the student and the enrollment even without "Edit students"/"Edit classes"). Only the Executive Director (and owners) hold them out of the box. Permissions added to a built-in position after it first shipped reach existing databases once, at startup (`BUILT_IN_GRANTS` in `src/shared/permissions.ts`); a permission an owner removes afterwards stays removed.

Without "All classes" a person sees their own classes — the ones they teach (or cover as a substitute) and the ones they created — and those classes' students plus the students they added. Taking attendance needs "See classes" as well.

Students and actors don't have logins.

See `CLAUDE.md` for the architecture and the rules the code follows.
