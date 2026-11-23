# Acting School — staff app (school + talent agency)

A standalone project. It shares nothing with the rest of this repository: not the Amico Mio businesses, not `sites/` (Zen etc.). Don't import from, copy from, or "align with" anything outside `acting-school/`. The Notion/Slack/approval rules in the root `CLAUDE.md` are about running those businesses; they don't apply to building this app.

**Whose it is:** Turquoise Studio (Turquoise Casting Studio, Giza; Arabic: استوديو تركواز) — an acting school that sells workshops (ورش) led by named coaches, plus a casting agency. Brand: black + turquoise, the turquoise "T" mark (`BrandMark`; interim drawing until the studio sends the original logo file).

**What it is:** an internal web app (works on phones, installable as a PWA) for the staff of an acting school that is also a talent agency. Staff only — students and actors don't sign in. English + Arabic, with full right-to-left layout.

- **School:** students, classes (courses with a weekly schedule → dated sessions), enrollments, attendance.
- **Agency:** talent roster (profiles, headshots, skills, languages), castings with roles, submissions (talent put forward for a role → audition → callback → booked).
- **Admissions:** enquiries ("leads") from WhatsApp, calls, forms… → follow-ups → interviews (scored on criteria from settings) → decision → enrol (creates the student + enrollment). WhatsApp = `wa.me` links (no API; $0).
- **Everyone:** home dashboard, combined schedule (classes + auditions + admissions interviews).

## Stack

| Layer | Choice |
|---|---|
| Web | React 19 + Vite 8 + Tailwind 4, React Router 8, TanStack Query 5, i18next |
| API | Hono 4 on Node 22 (`src/server/app.ts` is runtime-agnostic; `src/server/index.ts` is the Node server) |
| Data | SQLite (better-sqlite3) via Drizzle ORM; one file at `$DATA_DIR/app.db`; images in `$DATA_DIR/uploads/` |
| Validation | Zod 4 schemas in `src/shared/schemas/` — the same schema validates the form in the browser and the request on the server |
| Tests | Vitest (API, in-memory DB) in `tests/api/`, unit in `tests/unit/`; Playwright e2e in `tests/e2e/` |

## Commands (run inside `acting-school/`)

```
npm run dev          # API on :3000 (tsx watch) + Vite on :5173 (proxies /api)
npm run seed         # demo data into $DATA_DIR (default ./data) — see src/server/db/seed.ts for logins
npm run owner -- a@b # lockout recovery: give an existing account an owner position (CEO) and reactivate it
npm run typecheck    # tsc, whole project
npm test             # vitest
npm run build        # web → dist/web, server → dist/server
npm start            # production server: API + built web app on $PORT (default 3000)
npm run db:generate  # after editing src/server/db/schema.ts: writes a new SQL migration
npm run e2e          # Playwright
```

## Layout

```
src/shared/          permissions.ts (permission catalogue, built-in positions, BUILT_IN_GRANTS upgrades), enums.ts, dates.ts, phone.ts (phone → wa.me), schemas/<module>.ts (zod + API types)
src/server/
  app.ts             mounts every router under /api/<module>
  db/schema.ts       all tables; db/migrations/ generated SQL (applied at startup)
  middleware/auth.ts requireAuth, requirePermission/requireAnyPermission, currentUser, userCan
  lib/               access.ts (positions → permissions, built-in upgrades, class scope, contact redaction), errors.ts (ApiError, fieldError), validate.ts (body/query/paramId), password.ts, settings.ts,
                     enrollments.ts (enrolment rules shared by classes + admissions), admissions.ts (lead/interview loaders, duplicates), classSessions.ts,
                     phone.ts (the phone_digits() SQL function createDb registers, phone search)
  db/grantOwner.ts   `npm run owner -- email`: lockout recovery — give an account an owner position (CEO) and reactivate it
  routes/<module>.ts one Hono router per module (admissions: routes/leads.ts at /api/leads, interviews nested under their lead)
src/web/
  router.tsx         spreads each feature's routes
  features/<module>/ routes.tsx, pages, components, i18n.ts (en + ar)
  components/ui/     the UI kit (import from '@web/components/ui')
  lib/               api.ts, auth.tsx (useAuth, Guard), forms.ts (useForm), format.ts (useFormat), positions.ts (usePositionName), query.ts, image.ts
  i18n/              index.ts (registers namespaces), common.ts (shared strings + enum labels)
  layout/            AppShell (sidebar on desktop, bottom tabs on phones), nav.ts
tests/helpers.ts     makeTestContext(): in-memory app, t.as('executive_director' | ['acting_coach','finance'] | { permissions }) → signed-in client
```

## Rules

### Server
- Every router: `router.use(requireAuth)` or per-route `requirePermission('x.y')`. Permissions are defined in `src/shared/permissions.ts` only (with an EN + AR label and description in `src/web/features/positions/i18n.ts`; a test checks it); a person's effective permissions come from the positions they hold (`SessionUser.permissions`, worked out on every request; owner positions = all). The API is the guard; the UI hiding things is a courtesy. **Giving a built-in position a new permission:** add it to `BUILT_IN_POSITIONS` *and* append a `BUILT_IN_GRANTS` entry with the next version — existing databases get it once at startup (`upgradeBuiltInPositions`), and a permission an owner removes afterwards stays removed; never edit a released entry.
- Access rules beyond a single permission live in `src/server/lib/access.ts`: without `classes.all` a person only sees their own classes (course teacher, a session's substitute, or the class's creator) and those classes' students plus the students they added — anything else is a 404 (and a student shown from another module, e.g. the student linked to a talent profile, follows the same rule: `maySeeStudent`); attendance needs `courses.read` as well as `attendance.write`; without `students.contact` / `talent.contact` contact fields come back null with `contactHidden: true`, aren't searched, and are ignored on writes. Non-owners never see owner accounts or owner positions (an owner's id — as a position, teacher or substitute — answers exactly like a missing one) and can't give, take or edit access beyond their own — including by editing a position held by someone who can do more than they can.
- Validate everything: `await body(c, schema)`, `query(c, schema)`, `paramId(c)`. Throw `ApiError` / `fieldError(path, 'ns:errors.key')` / `notFound()` / `forbidden()` / `conflict()` — never return ad-hoc error JSON. Extra data for the client goes in `ApiError`'s `details` (answered as `error.details`, e.g. admissions' `possible_duplicate` → `{ matches }`).
- Admissions: leads are not class-scoped; anyone with `admissions.read` sees them with contact details. Lead status moves on its own (contact on new → contacted, interview scheduled/done/no-show, enrol) and every change writes a `status_change` activity; closed leads (enrolled/declined/lost) have no follow-up. Assignees and interviewers go through `isVisibleActiveStaff` (hidden owners answer like missing ids). Phones are stored normalised (`reqPhoneText`/`optPhoneText`: Western digits, no pasted bidi marks) and matched as international digits (`internationalPhone`); in SQL use `phoneDigitsSql(col)`, never a hand-made `replace()` chain. Write handlers read the body first, then the rows they change inside the transaction (nothing awaits in between).
- Response shapes must match the interfaces in `src/shared/schemas/<module>.ts`. Lists answer `{ items: [...] }`. Create answers 201 with the created resource. Delete answers 204 (`c.body(null, 204)`).
- Multi-step writes go in `db.transaction((tx) => { … })`. **better-sqlite3 transactions are synchronous: no `await` inside** (do async work — hashing, file IO — before).
- Dates are strings: `YYYY-MM-DD`, `HH:MM`, `YYYY-MM-DDTHH:MM`, school-local, no time zone. Use `src/shared/dates.ts`; never `new Date('2026-01-05')`.
- Don't use `.default()` in zod schemas (PATCH uses `.partial()`); apply defaults in insert code.
- Schema change → edit `db/schema.ts`, then `npm run db:generate`. Never edit generated SQL by hand.

### Web
- **Every visible string goes through i18n**, in both languages. Feature strings: `features/<module>/i18n.ts` (`ar` is typed against `en`, so a missing Arabic key is a type error). Shared words/enum labels: `common` (`t('common:actions.save')`, `<StatusBadge group="studentStatus" value=…/>`, `<EnumSelect group="gender" …/>`). Counts use plurals: `x_one`/`x_other` in English; Arabic needs `x_zero, x_one, x_two, x_few, x_many, x_other`.
- **RTL:** logical utilities only — `ms-/me-/ps-/pe-/start-/end-/text-start/border-s/rounded-s` — never `ml-/mr-/pl-/pr-/left-/right-/text-left`. Directional icons (arrows, chevrons) get `rtl:-scale-x-100`. Emails, phones, URLs in inputs: `dir="ltr"`.
- **Phone first:** every screen must work at 375px wide. Use `List`/`ListRow` rather than tables; `FormPage` + `FormSection` + `FormGrid` + `FormActions` for forms; `Modal` (becomes a bottom sheet on phones).
- Use the UI kit and the semantic colour tokens (`bg-surface`, `text-muted`, `border-line`, `bg-accent`, `text-danger`, …) so light and dark mode both work. No raw hex colours.
- Data: TanStack Query with keys starting with the resource (`['students']`, `['students', id]`); invalidate the resource after a mutation. API calls via `api.get/post/patch/put/delete` from `@web/lib/api` (paths without `/api`).
- Forms: `useForm` + the shared zod schema (`form.validate(studentInput)`), `onError: form.setServerError`. Field errors render via `Field`/`TextField` `error={form.error('x')}`.
- Dates/times on screen: `useFormat()` (`f.date(iso)`, `f.time(hhmm)`, `f.weekday(n)`), never raw strings.
- Gate UI with `useAuth().can('x.y')`; gate routes with `<Guard permission="x.y">`. Never branch on a position's name or key — always on a permission. Show position names with `usePositionName()` (Arabic name in Arabic when set).
- Page titles via `PageHeader` (it also sets the browser tab title).

### Tests
- API tests per module in `tests/api/<module>.test.ts` using `makeTestContext()`. Cover: happy path, validation (400), auth (401 signed out, 403 for positions without the permission), not found (404), and the module's own business rules. `t.as()` also accepts the phase-1 names owner/admin/teacher/agent as aliases of ceo/executive_director/acting_coach/head_of_casting.
