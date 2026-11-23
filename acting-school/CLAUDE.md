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
| API | Hono 4 (`src/server/app.ts`, runtime-agnostic: `createApp({ db, config, files })`). Two targets run the same app: **Node 22** (`src/server/index.ts`) and **Cloudflare** — one Worker named `claude` (`src/worker/index.ts`, `wrangler.jsonc`) serving `dist/web` as static assets and handing `/api/*` to one SQLite Durable Object (`src/worker/school.ts`) |
| Data | SQLite via Drizzle ORM, two synchronous drivers with the same dialect: better-sqlite3 on Node (`$DATA_DIR/app.db`) and drizzle `durable-sqlite` over the Durable Object's storage. Uploaded files behind a `FileStore` (`lib/fileStore.ts`): `$DATA_DIR/uploads/` on Node, the DO's SQLite (`file_chunks`) on Cloudflare, R2 once bound |
| Validation | Zod 4 schemas in `src/shared/schemas/` — the same schema validates the form in the browser and the request on the server |
| Tests | Vitest (API, in-memory DB; every database opened under Vitest enforces the Durable Object limits) in `tests/api/`, unit in `tests/unit/`; Playwright e2e in `tests/e2e/`; `npm run cf:smoke` drives the real Worker in workerd |

## Commands (run inside `acting-school/`)

```
npm run dev          # API on :3000 (tsx watch) + Vite on :5173 (proxies /api)
npm run seed         # demo data into $DATA_DIR (default ./data), password demo1234 — the demo itself is src/server/db/demoSeed.ts
npm run owner -- a@b # lockout recovery: give an existing account an owner position (CEO), reactivate it, lift its sign-in brakes
npm run typecheck    # tsc: tsconfig.json (app, tests, scripts) + tsconfig.worker.json (src/worker against the Workers types)
npm test             # vitest
npm run build        # web → dist/web, server → dist/server (Workers Builds runs it before `wrangler deploy`)
npm start            # production Node server: API + built web app on $PORT (default 3000)
npm run db:generate  # after editing src/server/db/schema.ts: writes a new SQL migration, then the bundle (db:bundle)
npm run db:bundle    # rewrites src/server/db/migrations/bundle.ts from the journal + .sql files
npm run e2e          # Playwright
npm run cf:dev       # the Cloudflare Worker locally in workerd (wrangler dev --local, :8787; -- --port N); .dev.vars made for you
npm run cf:smoke     # build, start the Worker on :8790 with throwaway data, seed via /api/admin, API smoke of every module (+ setup code, 413, cookie)
```

Cloudflare deploys through Workers Builds (push to the repo) once its build settings are set in the dashboard. Until then, or when it fails, the operator's session deploys from the cloud container with `npm run cf:deploy-embedded` (`wrangler.embedded.jsonc`: the web app bundled into the Worker, because the container's proxy breaks the static-asset upload — see `src/worker/embeddedAssets.ts`); keep `wrangler.embedded.jsonc` identical to `wrangler.jsonc` except `main`/`assets` (the embed script refuses otherwise). Sub-agents and reviewers never run `wrangler deploy`, `wrangler secret`, `wrangler login`, `wrangler dev --remote` or anything else that talks to the Cloudflare account; `cf:dev`/`cf:smoke` strip Cloudflare credentials and run locally (`cf:smoke -- --embedded` checks the bundled variant).

## Layout

```
src/shared/          permissions.ts (permission catalogue, built-in positions, BUILT_IN_GRANTS upgrades), enums.ts, dates.ts, phone.ts (phone → wa.me), schemas/<module>.ts (zod + API types)
src/server/
  app.ts             createApp({ db, config, files, clientIp? }): mounts every router under /api/<module> (+ /api/admin operator endpoints); JSON bodies over 1 MB → 413
  config.ts          AppConfig from string vars (configFromVars(vars, runtime defaults): Node env or Worker vars, CLOUDFLARE_DEFAULTS); nodeConfig.ts adds DATA_DIR for Node
  index.ts           the Node server (createDb + folder FileStore + static files); nodeFileStore.ts
  db/schema.ts       all tables; db/migrations/ generated SQL + bundle.ts (generated: the SQL inlined, what both runtimes apply)
  db/database.ts     DB type (sync drizzle SQLite, either driver) and initDb(db): migrations, built-in positions, phase-1 carry-over, backfills
  db/client.ts       Node only: createDb(file) = better-sqlite3 + initDb.  db/migrate.ts: applyMigrations (drizzle-compatible, sync)
  db/demoSeed.ts     the demo school (seedDemo), used by `npm run seed` (db/seed.ts) and POST /api/admin/seed-demo; db/wipe.ts (demo reset)
  middleware/auth.ts requireAuth, requirePermission/requireAnyPermission, currentUser, userCan, sessionCookieName (__Host-as_session over HTTPS)
  middleware/bodyLimit.ts  limitBody / MAX_JSON_BODY_BYTES (1 MB; the Worker refuses a bigger Content-Length before the DO)
  lib/               access.ts (positions → permissions, built-in upgrades, class scope, contact redaction), errors.ts (ApiError, fieldError, sqliteConstraint), validate.ts (body/query/paramId), password.ts (scrypt, sameSecret), settings.ts, signInBrake.ts (failed sign-in brakes, before hashing),
                     enrollments.ts (enrolment rules shared by classes + admissions), admissions.ts (lead/interview loaders, duplicates), classSessions.ts,
                     phone.ts (withPhoneDigits / backfillPhoneDigits for the stored phone_digits column, phone search), sqlLimits.ts (chunk, insertBatches, inChunks, contains, durableObjectLimits logger),
                     clock.ts (schoolToday/schoolNowTime/epochAt: the school's time zone), fileStore.ts (FileStore: sqliteFileStore, fallbackFileStore, memoryFileStore), ownerRecovery.ts (grantOwner)
  db/grantOwner.ts   `npm run owner -- email`: lockout recovery — give an account an owner position (CEO), reactivate it, lift its sign-in brakes
  routes/<module>.ts one Hono router per module (admissions: routes/leads.ts at /api/leads, interviews nested under their lead); routes/admin.ts: /api/admin (bearer ADMIN_TOKEN)
src/worker/          the Cloudflare Worker: embedded.ts + embeddedAssets.ts (the bundled-assets variant, scripts/embed-assets.ts writes its entry), index.ts (fetch: /api/* → the Durable Object — 413 first for a too-large Content-Length —, missing /assets/* → 404), school.ts (SchoolDO extends DurableObject: drizzle durable-sqlite + initDb + createApp, clientIp = CF-Connecting-IP), env.ts, r2FileStore.ts
src/web/
  router.tsx         spreads each feature's routes
  features/<module>/ routes.tsx, pages, components, i18n.ts (en + ar)
  components/ui/     the UI kit (import from '@web/components/ui')
  lib/               api.ts, auth.tsx (useAuth, Guard), forms.ts (useForm), format.ts (useFormat), positions.ts (usePositionName), query.ts, image.ts
  i18n/              index.ts (registers namespaces), common.ts (shared strings + enum labels)
  layout/            AppShell (sidebar on desktop, bottom tabs on phones), nav.ts
  public/_headers    CSP / nosniff / Referrer-Policy / cache headers for the static assets on Cloudflare (keep in step with src/server/index.ts)
tests/helpers.ts     makeTestContext({ config?, files?, clientIp? }): in-memory app, t.as('executive_director' | ['acting_coach','finance'] | { permissions }) → signed-in client;
                     todayISO()/nowTime() here are the school's clock. Every createDb under Vitest (ACTING_SCHOOL_DO_LIMITS=1 in vitest.config.ts,
                     inherited by the `npm run seed` subprocess) fails any query over the Durable Object limits
scripts/             bundle-migrations.ts (db:bundle), cf-local.ts / cf-dev.ts / cf-smoke.ts (local workerd runs)
```

## Rules

### Server
- Every router: `router.use(requireAuth)` or per-route `requirePermission('x.y')`. Permissions are defined in `src/shared/permissions.ts` only (with an EN + AR label and description in `src/web/features/positions/i18n.ts`; a test checks it); a person's effective permissions come from the positions they hold (`SessionUser.permissions`, worked out on every request; owner positions = all). The API is the guard; the UI hiding things is a courtesy. **Giving a built-in position a new permission:** add it to `BUILT_IN_POSITIONS` *and* append a `BUILT_IN_GRANTS` entry with the next version — existing databases get it once at startup (`upgradeBuiltInPositions`), and a permission an owner removes afterwards stays removed; never edit a released entry.
- Access rules beyond a single permission live in `src/server/lib/access.ts`: without `classes.all` a person only sees their own classes (course teacher, a session's substitute, or the class's creator) and those classes' students plus the students they added — anything else is a 404 (and a student shown from another module, e.g. the student linked to a talent profile, follows the same rule: `maySeeStudent`); attendance needs `courses.read` as well as `attendance.write`; without `students.contact` / `talent.contact` contact fields come back null with `contactHidden: true`, aren't searched, and are ignored on writes. Non-owners never see owner accounts or owner positions (an owner's id — as a position, teacher or substitute — answers exactly like a missing one) and can't give, take or edit access beyond their own — including by editing a position held by someone who can do more than they can.
- Validate everything: `await body(c, schema)`, `query(c, schema)`, `paramId(c)`. Throw `ApiError` / `fieldError(path, 'ns:errors.key')` / `notFound()` / `forbidden()` / `conflict()` — never return ad-hoc error JSON. Extra data for the client goes in `ApiError`'s `details` (answered as `error.details`, e.g. admissions' `possible_duplicate` → `{ matches }`).
- Admissions: leads are not class-scoped; anyone with `admissions.read` sees them with contact details. Lead status moves on its own (contact on new → contacted, interview scheduled/done/no-show, enrol) and every change writes a `status_change` activity; closed leads (enrolled/declined/lost) have no follow-up. Assignees and interviewers go through `isVisibleActiveStaff` (hidden owners answer like missing ids). Phones are stored normalised (`reqPhoneText`/`optPhoneText`: Western digits, no pasted bidi marks) and matched as international digits (`internationalPhone`); in SQL use the stored `phone_digits` column (students, leads), never a hand-made `replace()` chain — and every insert/update that sets `phone` on those tables goes through `withPhoneDigits(values)`. Write handlers read the body first, then the rows they change inside the transaction (nothing awaits in between).
- Response shapes must match the interfaces in `src/shared/schemas/<module>.ts`. Lists answer `{ items: [...] }`. Create answers 201 with the created resource. Delete answers 204 (`c.body(null, 204)`).
- Multi-step writes go in `db.transaction((tx) => { … })`. **Transactions are synchronous on both drivers (better-sqlite3; `transactionSync` on the Durable Object): no `await` inside** (do async work — hashing, file IO — before).
- Dates are strings: `YYYY-MM-DD`, `HH:MM`, `YYYY-MM-DDTHH:MM`, school-local, no time zone. Use `src/shared/dates.ts`; never `new Date('2026-01-05')`. **On the server, "today" and "now" are `schoolToday(c)` / `schoolNowTime(c)` (`lib/clock.ts`, the school's time zone, `SCHOOL_TIME_ZONE`, default Africa/Cairo) — never `todayISO()`/`nowTime()`/`new Date().getHours()`: Workers run in UTC.** The browser keeps `todayISO()`/`nowTime()` (its own clock).
- Files: through `c.get('files')` (a `FileStore`), never `node:fs` in shared code. Files are private: only `GET /api/files/:id` to signed-in staff.
- Sign-in: failed sign-ins go through `lib/signInBrake.ts` (per email + address, per email, per address, school-wide; address = `c.get('clientIp')`), checked **before** any password hashing — on Cloudflare scrypt blocks the one DO. First-run setup needs the setup code (ADMIN_TOKEN) where `config.requireSetupCode` (always on Cloudflare: the Worker is public from the first deploy); compare secrets with `sameSecret`. The session cookie is `sessionCookieName(config)` (`__Host-as_session` over HTTPS) — never hard-code the name.

### Shared code must run in a Durable Object
`src/server` (except `index.ts`, `nodeConfig.ts`, `nodeFileStore.ts`, `db/client.ts` and the CLI scripts `db/seed.ts`, `db/grantOwner.ts`) runs on the Node server *and* inside the Cloudflare Durable Object, against the same SQL. SQLite there has limits better-sqlite3 doesn't — the first two are enforced on every database opened under Vitest (`durableObjectLimits` in `lib/sqlLimits.ts`, attached by `createDb` when `ACTING_SCHOOL_DO_LIMITS=1`, which `vitest.config.ts` sets; startup steps and the seed subprocess included), so the suite fails where Cloudflare would:
- **At most 100 bound parameters per statement.** Multi-row inserts: `for (const batch of insertBatches(table, rows)) tx.insert(table).values(batch).run()`. IN lists that grow with the data: `inChunks(ids, (part) => …where(inArray(col, part))…)` (or a subquery). Fixed lists (statuses) are fine.
- **LIKE/GLOB patterns of at most 50 bytes** (an Arabic letter is 2): searches use `contains(col, term)` (`instr(lower(col), lower(term)) > 0`), never `like '%term%'`.
- **No custom SQL functions** (nothing like better-sqlite3's `sqlite.function`): compute in JS and store a column (as `phone_digits`, filled on write plus a startup backfill in `initDb`).
- **`.run()` returns nothing on the Durable Object** (the `DB` type makes it `unknown`): to know whether a row was deleted/updated, use `.returning({ id: t.id }).get()`.
- **Errors carry no `.code`**: check constraint failures with `sqliteConstraint(err)` (`lib/errors.ts`; app.ts maps them to 409/400).
- No PRAGMAs except the harmless ones (`createDb` sets WAL/busy_timeout/foreign_keys for the Node file only; foreign keys are on by default in a DO). No `BEGIN`/`SAVEPOINT` SQL: use `db.transaction`.
- No `node:fs`, `process.env` or native modules: Node-only code stays in the files listed above. `node:crypto`, `node:buffer`, `node:zlib` work (nodejs_compat).
- Migrations: `npm run db:generate` writes the SQL *and* `migrations/bundle.ts`; both runtimes apply the bundle at startup (`initDb`, in the DO's `blockConcurrencyWhile`). A test fails if the bundle is out of step. Check generated SQL for table rebuilds (`PRAGMA foreign_keys=OFF` + copy): inside the DO's single migration transaction that pragma does nothing.
- One DO serves every request one at a time (like one Node process); scrypt runs in it (~90 ms per hash, and it doesn't yield: nothing else runs meanwhile) — fine at this size for real sign-ins, which is why anonymous paths must never reach a hash unchecked (sign-in brakes first, setup code first). Request bodies are capped (1 MB JSON, 8 MB uploads): the DO has 128 MB for the whole school.
- Server-side epoch boundaries ("since midnight on …") use `epochAt(config.timeZone, date)`, never `parseDate(date).getTime()` (that's the runtime's midnight: UTC on Workers).
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
- Vitest runs in UTC (like Workers). Expected dates/times come from `todayISO()` / `nowTime()` / `schoolTimeToday('12:00')` in `tests/helpers.ts` (the school's clock), not from `src/shared/dates.ts`.
- `tests/api/cloudflare.test.ts` covers the Cloudflare-specific pieces (limits, phone_digits, FileStore, admin endpoints, sign-in brakes, setup code, body limit, session cookie); after changing the API, also run `npm run cf:smoke` (real workerd).
