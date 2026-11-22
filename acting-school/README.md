# Acting School

Internal staff app for an acting school that is also a talent agency. Works in the browser on desktop and phone (installable to the home screen), in English and Arabic.

**Status:** phase 1 built — sign-in and first-run setup, staff accounts and settings, students, classes (weekly schedule, sessions, attendance), talent roster with headshots, castings with roles and submissions, the combined schedule and the home dashboard, in English and Arabic (right-to-left). Phase 2 is in `ROADMAP.md`.

## Run it

Requires Node 22+.

```
cd acting-school
npm install
npm run dev        # open http://localhost:5173
```

The first visit asks you to set up the school (school name + the owner account). To start with demo data instead: `npm run seed` (or `npm run seed -- --reset` to wipe an existing `$DATA_DIR` first), then sign in with one of the demo logins it prints — `owner@demo.school`, `admin@demo.school`, `teacher@demo.school`, `teacher2@demo.school`, `agent@demo.school`, all with the password `demo1234`. The demo data is dated relative to today, so it always looks current.

Production: `npm run build && npm start` — one Node process serves the API and the app on `$PORT` (default 3000). Data lives in `$DATA_DIR` (default `./data`): `app.db` (SQLite) and `uploads/` (photos). Back up that folder. Put it behind HTTPS (the session cookie is `Secure` in production; set `COOKIE_SECURE=false` only to try it over plain http on a private network).

## Roles

| | Owner / Admin | Teacher | Agent |
|---|---|---|---|
| Students | view + edit | view | view |
| Classes, schedule | view + edit | view; marks attendance for the sessions they teach | view |
| Talent, castings, submissions | view + edit | — | view + edit |
| Staff accounts, settings | yes (admins can't touch owner accounts) | — | — |

Students and actors don't have logins.

See `CLAUDE.md` for the architecture and the rules the code follows.
