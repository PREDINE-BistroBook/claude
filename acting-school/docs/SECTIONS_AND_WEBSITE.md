# Three sections + the public website — spec

Asked by the school on 2026-11-23: "everything is melted on top of each other". The owners are older people, and seeing everything at once confuses them. So the app is split into **three sections, School, Casting and Website**, switched with **tabs at the top**. The **Website section** manages a public website with all four pieces the school picked:
1. workshops + an apply form,
2. a casting call page,
3. about & coaches,
4. a link-in-bio page.

**Admissions stays in School.** Website forms feed into it.

This file is the contract for the build. Where it names a file, route, permission or column, use exactly that name. Where it leaves a detail open, follow the existing patterns in `CLAUDE.md` (they all still apply: i18n in both languages, RTL logical utilities, phone first, Durable Object limits, synchronous transactions, the school clock, `withPhoneDigits`, and the rest).

Design rule for everything here: **made for older, non-technical people.**
- Tap targets of at least 48 px.
- Icons always come with a visible text label.
- Plain words ("Show on website", not "Publish toggle").
- One main action per screen.
- Clear "where am I" cues: section name and colour.
- Up/down buttons rather than drag-and-drop.
- Confirm before anything destructive.

**No prices — decided by the school (2026-11-23).** The studio doesn't put fees on the website, so people get in touch instead of being put off. There are no price fields anywhere: not in the data, the staff screens, the demo, or the public pages. Where a visitor would look for the fee, workshop cards and pages show an **"Ask about fees on WhatsApp"** button instead. It opens the workshops WhatsApp with a prefilled message naming the workshop, in the page's language.

---

## Part A — Three sections in the staff app (web UI)

### Model
- **New file `src/web/layout/sections.ts`.** It exports `SECTIONS`, a list of `{ key: 'school' | 'casting' | 'website', home: string, icon, labelKey }`, plus these functions:
  - `visibleSections(can)`
  - `sectionForPath(pathname): SectionKey | null`
  - `rememberSection(key)` / `rememberedSection()`: localStorage key `section`, with every access wrapped in try/catch.
- **Which sections a person sees:**
  - School: any of `courses.read`, `students.read`, `admissions.read`.
  - Casting: any of `talent.read`, `castings.read`.
  - Website: `website.manage`.
  - Owners hold every permission, so they see all three.
- **Path → section (by prefix):**
  - School: `/school`, `/schedule`, `/admissions`, `/students`, `/classes`, `/sessions`.
  - Casting: `/casting`, `/talent`, `/castings`. This includes `/casting/schedule` and `/casting/applications`.
  - Website: `/website`.
  - Anything else (`/profile`, `/staff`, `/positions`, `/settings`) returns `null` and keeps the last remembered section.
- **`NavItem` in `src/web/layout/nav.ts`** gets `section: 'school' | 'casting' | 'website' | 'admin'`, which replaces `group`. Admin items (Staff, Positions, Settings) appear in every section, under an "Administration" heading at the end of the sidebar and in the phone "More" sheet. Profile stays where it is today.
- **Section homes:** `/school`, `/casting`, `/website`.
  - `/` redirects to the remembered section's home if the person can still see it, otherwise to the first visible section.
  - If the person sees **no** section, `/` shows a small home: greeting, profile link and a "nothing assigned yet" note.
  - Every existing deep link (`/students/12`, `/classes/3`, …) keeps working.

### Top tabs
- **New component `SectionTabs`**, rendered by `AppShell`.
  - On phones: a full-width segmented control directly under the header.
  - On desktop: at the top of the content area, or in the header if that reads better.
  - Each tab shows icon + label and is at least 48 px tall.
  - The active tab is filled with that section's colour and has `aria-current="page"`.
  - Use `role="tablist"`-style semantics or plain links with `aria-current`. Either is fine, but keyboard focus must be visible.
  - **Hidden when the person sees only one section** (a coach never sees tabs).
- **Tapping a tab** goes to the last route visited in that section, or its home. Remember this per section in memory and localStorage, with try/catch.
- **Section colours:** new tokens in `src/web/styles.css`, with light and dark values:
  - `--color-section-school`: the turquoise accent.
  - `--color-section-casting`: an amber/gold.
  - `--color-section-website`: an indigo/blue.
  - Each has a matching `-ink` text colour.
  - Use them for the active tab, a thin coloured line at the top of the header, and the section home's heading. Text on a filled tab must reach 4.5:1 contrast in both themes.
- **Labels:**
  - EN: School / Casting / Website.
  - AR: المدرسة / الكاستينج / الموقع.
  - The header shows the school name plus the current section name.

### Navigation per section
- **Sidebar (desktop):** only the current section's items, then "Administration" (Staff, Positions, Settings, if permitted).
- **Phone bottom bar:** the section's Home, up to three of the section's destinations, then "More". "More" lists the rest of the section, the admin items and Profile. Replace `mobileTabs` with `mobileTabs(section, can)`:
  - **School:**
    - coach-like (`attendance.write` without `classes.all`): Schedule, Workshops, Students.
    - `admissions.read`: Admissions, Students, Workshops.
    - otherwise: Students, Workshops, Schedule.
  - **Casting:** Talent, Castings, Applications (`talent.read`). Schedule (`/casting/schedule`) goes in More.
  - **Website:** Pages, Workshops on site, Casting call. Coaches and Links go in More.

### Section homes (split `DashboardPage`)
- **`/school` — School home.**
  - Greeting.
  - Today's sessions (or "Your sessions today" for coaches).
  - Admissions follow-ups due.
  - New website enquiries: count + link to Admissions filtered to source = website.
  - Active workshops.
  - Quick actions: New enquiry, New student. Show each only if permitted.
  - No casting content.
- **`/casting` — Casting home.**
  - Upcoming auditions.
  - Castings closing soon.
  - New casting applications: count + link to Applications.
  - Roster size.
  - Quick actions: New talent, New casting.
  - No school content.
- **`/website` — Website home:** see Part C.
- **API:** keep `GET /api/dashboard` and add two counts, each only when permitted (otherwise `null`):
  - `newWebsiteLeads`: leads with source `website` and status `new` (needs `admissions.read`).
  - `newCastingApplications`: applications with status `new` (needs `talent.read`).

### Schedule per section
- **School schedule (`/schedule`):** shows the `class` and `interview` kinds.
- **Casting schedule (`/casting/schedule`):** shows `audition` only.
- Reuse one schedule view with a `kinds` prop. Filter on the client; the API already limits kinds to what the person can see. Each schedule's filter chips only offer that section's kinds.

---

## Part B — Website: data, permissions, staff API

### Permission
- **Add `website.manage`** to `PERMISSIONS` in `src/shared/permissions.ts`, in a new "website" group. It means "Edit the public website: pages, coaches, workshops shown, casting call, links". Add EN + AR label and description in `src/web/features/positions/i18n.ts`.
- **Built-in positions:** `executive_director` gets it in `BUILT_IN_POSITIONS` and through a new `BUILT_IN_GRANTS` entry `{ version: 2, grants: { executive_director: ['website.manage'] } }`. Owners (CEO, CFO) have everything already.
- **Casting applications use existing permissions:**
  - see the list and details: `talent.read`;
  - see contact fields (phone, email, guardian phone, links): `talent.contact`. Without it these come back `null` with `contactHidden: true`, as talent does;
  - accept, decline, mark reviewing, delete: `talent.write`.

### Data (`src/server/db/schema.ts`, then `npm run db:generate` → migration 0005)
- **Site content:** stored in the existing `settings` table under the key `site` as one JSON object, validated by `siteContent` (zod, `src/shared/schemas/site.ts`). The helpers `getSiteContent(db)` / `saveSiteContent(db, content)` live in `src/server/lib/siteContent.ts`; a missing key means defaults with empty texts and the casting call closed. Shape (each `Bilingual` is `{ en: string, ar: string }`, both may be empty):
  ```
  {
    tagline: Bilingual, about: Bilingual, address: Bilingual,
    mapUrl: string|null, instagram: string|null (handle without @),
    whatsappWorkshops: string|null, whatsappCasting: string|null, phone: string|null, email: string|null,
    heroFileId: string|null,
    castingCall: { open: boolean, intro: Bilingual, lookingFor: Bilingual },
    links: [{ id: string, label: Bilingual, url: string (https only), visible: boolean }]   (max 20, ordered)
  }
  ```
  - Limits: about ≤ 4000 characters per language, tagline ≤ 160, intro/lookingFor ≤ 2000, link label ≤ 60.
  - Phones go through the existing phone normalisation (`optPhoneText`).
  - URLs must be `https:`. Reject `javascript:`, `data:` and the rest.
- **`site_coaches`:**
  - id;
  - `user_id` (nullable FK users, on delete set null; optional link to a staff account);
  - `name_en`, `name_ar`, `title_en`, `title_ar`, `bio_en`, `bio_ar`;
  - `photo_file_id` (nullable FK files, set null);
  - `visible` (bool, default true);
  - `sort_order` (int);
  - timestamps.
- **`site_workshops`** (one row per course shown or prepared for the site):
  - `course_id` (PK, FK courses, on delete cascade);
  - `visible` (bool, default false);
  - `title_en`, `title_ar` (empty = use the course name);
  - `description_en`, `description_ar`;
  - `cover_file_id` (nullable FK files, set null);
  - `accepting_applications` (bool, default true);
  - `sort_order`;
  - timestamps.
  - A workshop appears on the public site only if `visible`, the course is `active`, and its `end_date` ≥ the school's today.
- **`casting_applications`:**
  - id;
  - `first_name`, `last_name`, `gender`, `date_of_birth`;
  - `phone` + `phone_digits` (through `withPhoneDigits`), `email`, `city`, `height_cm`;
  - `languages` (json string[]), `skills` (json string[]), `experience`;
  - `links` (json string[], https only, max 3), `message`;
  - `guardian_name`, `guardian_phone`, `guardian_consent` (bool; required when under 18);
  - `locale` ('en'|'ar');
  - `status` (`new` | `reviewing` | `accepted` | `declined`, default `new`; add `CASTING_APPLICATION_STATUSES` to `src/shared/enums.ts` with labels in common i18n);
  - `reviewed_by_id` (FK users, set null), `reviewed_at`;
  - `talent_id` (FK talent, set null);
  - timestamps.
  - Indexes: status, created_at, phone_digits.
- **`casting_application_photos`:** id, `application_id` (FK, cascade), `file_id` (FK files), `sort_order`.
- **`rate_limits`:** `key` (PK text), `count` int, `window_start` int (epoch ms). Generic fixed-window counter, used by the public forms. The helper `hitRateLimit(db, key, limit, windowMs, now): boolean` lives in `src/server/lib/rateLimit.ts`. It deletes expired rows opportunistically and stays under the DO limits.
- **Form token secret:** settings key `siteFormSecret`. It holds 32 random bytes (hex), created once in `initDb` if missing, with `crypto.getRandomValues`.

### Staff API (all under `/api`, behind `requireAuth`)
- **`GET /api/site/content`** and **`PUT /api/site/content`** (`website.manage`): the whole `siteContent` object.
- **`/api/site/coaches`** (`website.manage`):
  - `GET` answers `{ items }` in `sort_order`.
  - `POST` answers 201.
  - `GET /:id`, `PATCH /:id`, `DELETE /:id` (204).
  - `POST /api/site/coaches/order` takes `{ ids: number[] }` and sets `sort_order`.
  - `user_id`, if given, must be a visible active staff member: use `isVisibleActiveStaff`, so a hidden owner answers like a missing id.
- **`/api/site/workshops`** (`website.manage`):
  - `GET` lists the active and upcoming courses, each with its `site_workshops` row or the defaults, plus the course name, dates, teacher name and schedule summary.
  - `PUT /api/site/workshops/:courseId` creates or updates the row.
  - `POST /api/site/workshops/order` reorders.
- **`GET /api/site/summary`** (`website.manage`):
  - `{ newWebsiteLeads, newCastingApplications, castingCallOpen, visibleWorkshops, visibleCoaches }`;
  - the public URLs to show and copy: `{ home, workshops, castingCall, links }` for `en` and `ar`, built from the request's own origin.
- **`/api/casting-applications`:**
  - `GET` (`talent.read`): `?status=` and `?q=` (name/phone/city search via `contains()` and `phone_digits`), newest first, answering `{ items }`. Each item: id, names, gender, age, city, status, createdAt, first photo file id, minor flag.
  - `GET /:id` (`talent.read`): everything, with photos as `[{ fileId }]`. Contact fields are redacted without `talent.contact`.
  - `PATCH /:id` (`talent.write`): `{ status: 'reviewing' | 'declined' | 'new' }`. Sets `reviewed_by_id` / `reviewed_at`.
  - `POST /:id/accept` (`talent.write`):
    - in one transaction: create a `talent` row from the application (names, gender, date_of_birth, phone through `withPhoneDigits`, email, city, height_cm, languages, skills, plus notes with experience/message/links/guardian info), create `talent_photos` for its photos reusing the same file ids, then set status `accepted`, `talent_id` and the reviewer;
    - answers 201 `{ talentId }`;
    - 409 if already accepted.
  - `DELETE /:id` (`talent.write`): deletes the application and its photos' files (files deleted after the transaction). Files already linked to a talent profile are kept. Answers 204.
- **Website enquiries:** the leads they create are ordinary leads, so Admissions shows them as it does today.
  - Make sure the Admissions list can filter by source (add `?source=` to `GET /api/leads` plus a filter in the UI if it isn't there).
  - The `website` source already exists in `LEAD_SOURCES`.

### Files that become public
- A file is **public** if it is:
  - `siteContent.heroFileId`, or
  - the `photo_file_id` of a **visible** coach, or
  - the `cover_file_id` of a workshop that **appears on the site**.
- Only those are served by `GET /site/media/:id`:
  - image mime types only;
  - `Cache-Control: public, max-age=3600`;
  - `X-Content-Type-Options: nosniff`;
  - `Content-Disposition: inline`;
  - every other id answers 404.
- Casting application photos are **never** public.
- `GET /api/files/:id` stays staff-only.

### Admin endpoint for the live demo
- **`POST /api/admin/seed-demo-website`** (bearer `ADMIN_TOKEN`, same middleware as the other admin routes): fills in the demo website content (below) **only if** the `site` settings key is missing **and** there are no `site_coaches`. Otherwise it answers 409. It is idempotent and never touches other data.
- **`seedDemo` (`src/server/db/demoSeed.ts`)** also creates the website demo for new installs:
  - **Studio info:** EN + AR about text for Turquoise Studio (invented but plausible, clearly editable); tagline; the studio's real public contact lines from its Instagram (workshops WhatsApp 01094635959, casting WhatsApp 01119003100); Instagram `turquoisecastingstudio`; address "Mohandessin, Giza" / "المهندسين، الجيزة".
  - **Coaches:** coach profiles for the demo coach accounts.
  - **Workshops:** three or four workshops visible (no prices — see "No prices" above).
  - **Casting call:** open, with intro text.
  - **Links:** three custom links.
  - **Applications:** three or four casting applications with generated portrait photos (as the talent demo makes them), one of them a minor with guardian consent.
  - **Enquiries:** two leads with source `website`.

---

## Part C — Website section and Casting applications (staff web UI)

- **`/website` — Website home:**
  - A big "Open the website" button: opens `/site` in a new tab, `rel="noopener"`.
  - Status cards (from `/api/site/summary`): new website enquiries (link to Admissions filtered to website), new casting applications (link to Casting › Applications), casting call open/closed with a quick switch, workshops shown, coaches shown.
  - "Your website's pages": Home, Workshops, Casting call, Links. Each row has "Open" and "Copy link" buttons, with a toast "Link copied". An English/Arabic toggle picks which language's links are shown.
- **`/website/pages` — "Studio & contact":** one `FormPage`.
  - "About the studio": tagline EN/AR, about EN/AR, main photo (`PhotoInput` + `uploadImage`, which resizes on the phone).
  - "Contact": WhatsApp for workshops, WhatsApp for casting, phone, email, Instagram, address EN/AR, map link.
  - **Bilingual fields:** English and Arabic side by side on desktop, stacked on phones. Each is labelled "English" / "العربية"; Arabic inputs get `dir="rtl"` and English inputs `dir="ltr"`.
- **`/website/coaches`:**
  - The list shows a photo, name, "Shown on website" badge and up/down buttons.
  - `/website/coaches/new` and `/website/coaches/:id`: an edit form with an optional "linked staff account" picker, and delete with confirm.
- **`/website/workshops` — "Workshops on the website":**
  - Every active or upcoming workshop with a big `Switch` "Show on website".
  - Tapping a workshop opens `/website/workshops/:courseId`: public title EN/AR (placeholder = the course name), description EN/AR, cover photo, "Accepting applications" switch.
  - Show a small preview line: dates, days and times, coach — what the public will see.
- **`/website/casting-call`:**
  - A big Open/Closed switch, with an explanation of what each state shows the public.
  - Intro EN/AR and "What we're looking for" EN/AR.
  - A link to the applications list.
- **`/website/links` — "Link-in-bio":**
  - Explains: "Put this link in your Instagram bio", with the copyable `/site/links` URL.
  - The automatic buttons, listed read-only: open workshops, casting call when open, WhatsApp, Instagram.
  - Custom links: add, edit, delete (with confirm), up/down, "shown" switch.
- **Casting › Applications (`/casting/applications`):**
  - Status tabs: New / Reviewing / Added to roster / Declined, with counts.
  - Rows show a photo thumbnail, name, age, city, date and a "Under 18" badge when a minor.
- **`/casting/applications/:id`:**
  - Photo gallery.
  - All the details, with guardian info highlighted for minors.
  - WhatsApp and call buttons, only with contact permission.
  - Actions (each only with `talent.write`): "Add to roster" (primary; confirms, accepts, then navigates to the new talent profile), "Mark as reviewing", "Decline", "Delete" (confirm).
- **Applications in Casting navigation:** add Applications to the Casting nav with a count badge of new ones if easy.
- **Every string in EN + AR**, following all the `CLAUDE.md` web rules.

---

## Part D — The public website (server-rendered)

### Where it lives
- **Served by the API app** (`createApp`), mounted at **`/site`**: a new router `src/server/site/index.ts` (plus page modules under `src/server/site/`).
  - Not under `/api`.
  - No session, no `X-Requested-With` requirement.
  - The same code runs on Node and in the Durable Object.
- **Cloudflare routing:**
  - `src/worker/index.ts` sends `/site` and `/site/*` to the Durable Object, like `/api/*`.
  - `wrangler.jsonc` adds `"/site"` and `"/site/*"` to `run_worker_first`. **Keep `wrangler.embedded.jsonc` in step**: it has no assets block, so nothing to change there, but the embed script's config check must still pass.
  - The Worker's `tooLarge` uses the per-route caps below.
- **Node:** `src/server/index.ts` must not serve the SPA for `/site*`.
- **The staff app's service worker must never answer `/site`:** in `vite.config.ts`, `navigateFallbackDenylist: [/^\/api\//, /^\/site(\/|$)/]`.
- **The studio's own domain (decided 2026-11-23).** The school bought `turquoisestudio.app`.
  - **Staff app:** `staff.turquoisestudio.app` (already attached to the Worker).
  - **Public website:** at the root of `turquoisestudio.app`. `www.turquoisestudio.app` redirects (301) to it.
  - **How the Worker routes it:** a var `PUBLIC_SITE_HOSTS` (comma-separated; `"turquoisestudio.app,www.turquoisestudio.app"`, the same in both wrangler configs) names the public hosts.
    - On a public host, the site is served **at the root**: `/` → home, `/ar`, `/en/workshops/12`, `/ar/casting-call`, `/en/links`, `/media/:id`, and so on.
    - The Worker maps a public-host path `/x` to the app's `/site/x`, with no `/site` in the visible URLs.
    - Nothing of the staff app answers on a public host. `/api/*`, `/login`, the staff static files and the service worker all get the site's 404 page.
    - `www` → 301 to the apex, with the same path and query.
  - **Links inside the pages** come from `src/server/site/paths.ts`, given the request: `/site/...` on any other host (staff host, workers.dev, localhost), bare paths on a public host.
  - **On a non-public host,** `/site/*` keeps working as today, for previews.
  - **`run_worker_first`:** with static assets, a path on a public host must reach the Worker before assets. So `wrangler.jsonc` uses `"run_worker_first": true`, and the Worker passes staff-host asset requests to `env.ASSETS` exactly as before; the embedded variant already runs the Worker first.
  - **Tests:** cover the public-host routing (Worker-level unit tests in `tests/unit/`, using a fake ASSETS and DO stub) and the link building in `paths.ts`.
  - **Custom domains in the configs:** the deployer adds `routes` with `custom_domain: true` when switching the domain on. Builders don't add `routes`.

### Pages (`:lang` is `en` or `ar`)
- **`GET /site`:** redirects (302) to `/site/ar` if `Accept-Language` prefers Arabic, otherwise `/site/en`.
- **`GET /site/:lang` — Home:**
  - Hero: brand mark, studio name, tagline, hero photo.
  - About text.
  - "Open workshops" cards (title, dates, days and times, coach, "Apply" button, and "Ask about fees on WhatsApp").
  - Casting-call banner when open.
  - Coaches (photo, name, title, short bio).
  - Contact block: WhatsApp buttons (`https://wa.me/<international digits>?text=<prefilled in page language>`), phone (`tel:`), Instagram, address, map link.
- **`GET /site/:lang/workshops`** lists them. **`GET /site/:lang/workshops/:id`** is the detail page plus the apply form when accepting applications. A workshop that is hidden, not active or over answers a friendly 404 page.
- **`POST /site/:lang/workshops/:id/apply`** and a general **`POST /site/:lang/apply`** (from Home, "Not sure which workshop? Ask us").
  - Fields: first name, last name, phone (WhatsApp), email (optional), date of birth, experience (none / some / a lot), how you heard (Instagram / friend / other), message, privacy consent checkbox. When under 18 (worked out from date of birth against the school's today): guardian name, guardian phone, guardian consent.
  - Creates a **lead**: source `website`, `sourceDetail` set to the workshop title or "general", `preferredCourseId`, notes from the message, guardian fields, status `new`, the usual `created` activity.
  - **Refactor lead creation** from `routes/leads.ts` into a shared `createLead(...)` in `lib/admissions.ts`, so both use one path.
  - **If an open lead with the same phone already exists:** add a note activity "Applied again on the website: …" to it instead of creating a duplicate.
- **`GET` and `POST /site/:lang/casting-call`:**
  - **When open:** intro, "what we're looking for", then the form: first/last name, gender, date of birth, phone, email, city, height (cm), languages, skills, experience, up to 3 links (Instagram/showreel, https only), message, **1–3 photos** (the first is the headshot, required), guardian block when under 18, privacy consent.
  - **When closed:** "There's no open casting call right now. Follow us on Instagram" + Instagram link. A `POST` answers that page with 410.
  - The form uses `enctype="multipart/form-data"`.
- **`GET /site/:lang/links`:** the link-in-bio page. Logo, name, then big stacked buttons:
  - each open workshop accepting applications;
  - "Casting call" when open;
  - WhatsApp workshops, WhatsApp casting, Instagram;
  - then the visible custom links.
- **`GET /site/:lang/thanks?k=apply|casting`:** a thank-you page with a WhatsApp button. Forms use POST → 303 redirect → GET (PRG).
- **`GET /site/media/:id`:** see "Files that become public".
- **Unknown `/site/...`:** a friendly 404 page in the right language.

### Rendering
- **No client JavaScript:** everything works with plain HTML forms. Render with Hono's `html` tagged template (`hono/html`), which escapes interpolations. **Never** use `raw()` with user content. Turn multi-paragraph texts into `<p>` elements by splitting on blank lines, escaped.
- **`src/server/site/i18n.ts`:** every visible string in EN + AR (typed so Arabic can't miss a key). `<html lang dir>` comes from `:lang`.
- **One layout (`src/server/site/layout.ts`):**
  - Inline `<style>` (one block, mobile-first, around 10 KB or less), black + turquoise brand matching the app's tokens.
  - System font stack, with an Arabic-friendly stack for `ar` and line-height 1.8 for Arabic.
  - CSS logical properties so RTL mirrors.
  - Big buttons, accessible contrast, visible focus.
  - Header: brand mark, which is the same SVG as the app's `BrandMark`. Move its path data into `src/shared/brand.ts` and use it from both.
  - Language switch link to the same page in the other language.
  - Footer: Instagram, address, © year.
- **Meta:**
  - `<title>`, `meta description` (from tagline/about), `og:title`, `og:description`, `og:image` (hero via `/site/media/:id`, absolute URL).
  - `link rel=alternate hreflang` for en/ar, canonical, `theme-color`.
  - The brand SVG as a data: URI favicon.
- **Forms:**
  - `<label for>` on every input; `autocomplete` (`given-name`, `family-name`, `tel`, `email`, `bday`); `inputmode="tel"`; `required` markers.
  - On a validation error: re-render with an error summary at the top (links to the fields), messages next to fields, and the values kept (except photos, which must be chosen again; say so).
  - A short privacy note under each form: what's stored and why, and that the studio will contact them on WhatsApp or by phone.

### Security and abuse
- **Response headers for every `/site` response:**
  - `Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: strict-origin-when-cross-origin`;
  - pages `Cache-Control: public, max-age=60`; form responses and redirects `no-store`.
- **On a POST:**
  - if an `Origin` header is present, it must match the request host; otherwise 403;
  - **honeypot:** a text field named `website`, hidden with CSS and `aria-hidden`/`tabindex=-1`. If it is filled, pretend success (303 to thanks) and store nothing;
  - **form token:** a hidden field holding `<issuedAt>.<hmac-sha256(siteFormSecret, issuedAt + form kind)>`. Reject when it is missing, invalid, older than 24 h, or younger than 3 s by re-rendering with a friendly "please try again", without storing. Compare in constant time.
- **Rate limits (`rate_limits`)**, checked **before** any parsing of photos and before writing:
  - apply: 5 per hour per client address, 300 per day school-wide;
  - casting: 3 per hour per address, 100 per day school-wide, plus 300 MB of photos per day school-wide;
  - when hit: a friendly 429 page in the right language.
  - The client address comes from the existing `clientIp` dependency (CF-Connecting-IP / socket).
- **Body caps:**
  - apply forms 64 KB;
  - casting form 20 MB total, each photo ≤ 6 MB, at most 3;
  - photos must be real JPEG/PNG/WebP, checked by magic bytes; otherwise a friendly error asking for a JPG or PNG;
  - the Worker's `tooLarge()` refuses a larger `Content-Length` before the DO, and the app enforces the same caps on bodies without a length.
- **Validation:**
  - zod schemas in `src/shared/schemas/site.ts`;
  - text lengths capped;
  - phone normalised (`reqPhoneText`);
  - date of birth: a real date, age 5–100;
  - under 18 requires the guardian fields + consent;
  - links https only.
- **Photos** go into the `FileStore` (`uploadedBy` null), the same as staff uploads. On any later failure in the same request, delete the files already stored.

---

## Tests and checks
- **API tests:**
  - `tests/api/site.test.ts`: staff endpoints, public routes, forms.
  - `tests/api/casting-applications.test.ts`.
  - Additions to `tests/api/schedule-dashboard.test.ts` for the new counts.
- **Cover:**
  - 401/403/404 and validation;
  - public pages render 200 in both languages, with `dir` right;
  - stored content containing `<script>` comes out escaped;
  - hidden or over workshops 404;
  - valid apply creates a lead with source `website`; a duplicate phone adds an activity instead;
  - honeypot, token too fast / old / forged;
  - Origin mismatch;
  - rate limits;
  - minor needs guardian + consent;
  - photo magic-bytes check, too many photos, too large;
  - a closed casting call refuses submissions (410);
  - accept creates talent + photos and is not repeatable (409);
  - delete removes files not used by talent;
  - `/site/media` only serves public files;
  - the `BUILT_IN_GRANTS` v2 upgrade gives the director `website.manage` once.
- **Unit tests:** `sectionForPath`, `visibleSections`, `mobileTabs(section, can)`.
- **`scripts/cf-smoke.ts`:** extend with the public pages (both languages), one apply, one casting application with a photo, `/site/media`, accept → talent, and the headers on `/site`. Run `npm run cf:smoke` and `npm run cf:smoke -- --embedded`.
- **Docs:** update `README.md`, `CLAUDE.md` (layout, the sections model, the public site rules: no raw HTML, the rate limits, `/site` paths) and `ROADMAP.md`.

---

## Part E — Opportunity radar (Casting): sources checked every night

Asked by the school on 2026-11-23: "put websites or Instagram pages where AI checks them every now and then for new casting opportunities, after midnight, so the team knows the next morning and can grab more opportunities." It lives in the **Casting** section. It is built **after Parts A–D**, in its own migration (the next number after the website's).

### What a source can be (be honest in the UI about Instagram)
- **Website page** (`web`): any public page that lists casting calls. The nightly check reads its text, finds what's new since last night, and asks AI to pull out the opportunities.
- **RSS/Atom feed** (`rss`): each new item is checked.
- **Telegram public channel** (`telegram`): read from its public web preview (`https://t.me/s/<channel>`); each new post is checked. Many Egyptian casting calls are posted on Telegram.
- **Instagram and Facebook cannot be watched automatically.** They hide posts behind a login, forbid automated reading in their terms, and block servers. The UI says this plainly when someone pastes an instagram.com/facebook.com URL as a source, and offers the alternative below instead of failing silently.
- **"Add from a screenshot or text"** covers Instagram, Facebook, WhatsApp groups and anything else. A team member pastes a post's text or uploads a screenshot. AI reads it and fills in an opportunity for them to check and save. On a phone: screenshot the post in Instagram → in the app, Casting › Opportunities › "Add from screenshot".

### Data
- **`opportunity_sources`:**
  - id, `name`;
  - `kind` (`web` | `rss` | `telegram`); `url` (http/https only; for telegram store the channel name and build the URL);
  - `active` (bool);
  - `last_checked_at`, `last_status` (`ok` | `unchanged` | `error` | `blocked`), `last_error` (short text), `consecutive_failures`;
  - `last_snapshot` (text, capped at 60 KB, web pages only);
  - `created_by_id`; timestamps.
- **`opportunity_seen`:** `source_id`, `item_key` (hash of a post id/link or of a normalised paragraph), `first_seen_at`, used so the same post is never processed twice. Prune entries older than 120 days.
- **`casting_opportunities`:**
  - id, `source_id` (nullable: null = added by hand);
  - `title`, `summary`, `project_type` (`film` | `series` | `ad` | `theatre` | `music_video` | `online` | `other`);
  - `roles` (json: `[{ description, gender: 'male'|'female'|'any'|null, ageMin, ageMax }]`);
  - `location`, `deadline` (YYYY-MM-DD or null), `contact` (text);
  - `apply_url` (http/https only), `original_url`, `original_excerpt` (≤ 2000 characters);
  - `language` (`ar` | `en` | `mixed`), `involves_minors` (bool);
  - `status` (`new` | `interested` | `applied` | `dismissed`); `casting_id` (FK castings, set null) once turned into a casting;
  - `fingerprint` (unique: normalised title + deadline + contact), `found_at`, `reviewed_by_id`; timestamps.
- **`ai_usage`:** day (YYYY-MM-DD, the school's date), `feature` (`radar` | `radar_manual`), `input_tokens`, `output_tokens`, `cost_micro_usd`.
- **Settings:** `radarEnabled` (default true) and `aiMonthlyCapUsd` (default 3). Both are editable in Settings by `settings.manage`, with a line showing this month's spend.

### The nightly run
- **When:** a Cron Trigger on the Worker, `"triggers": { "crons": ["30 22 * * *"] }` in **both** wrangler configs (22:30 UTC, which is about 00:30 or 01:30 Cairo). The Worker's `scheduled()` handler calls the Durable Object, the same instance "main" (an RPC method on `SchoolDO`, e.g. `runRadar()`), so all work and data stay in the one database. Use `ctx.waitUntil`. Node has no cron, so add an `npm run radar` script that runs the same function against the Node database.
- **For each active source, one at a time:**
  - fetch with a 15 s timeout and a 2 MB cap, `User-Agent: TurquoiseStudioRadar/1.0 (+https://turquoisestudio.app)`;
  - respect `robots.txt` (fetch it, cache it for a day, honour Disallow for `*` and for our agent); if disallowed, set `blocked` and explain it in the UI;
  - extract text with `HTMLRewriter`: drop scripts, styles and navigation, and for Telegram keep each message's text, date and post link;
  - work out the **new** items (Telegram/RSS: items whose key isn't in `opportunity_seen`; web: paragraphs not in last night's snapshot), then mark them seen.
  - At most 40 sources a night. A source that fails 7 nights in a row is switched off, with a note.
- **AI extraction:** only when there is new text. Claude Haiku 5.5 (`claude-haiku-5-5`) through the official `@anthropic-ai/sdk` (it supports Cloudflare Workers). **Before writing any API code, read the claude-api skill files**:
  - `/tmp/claude-0/bundled-skills/2.1.330/757b3d191a9f94da40a321abff43c216/claude-api/typescript/claude-api/README.md`;
  - `tool-use.md` next to it;
  - `shared/models.md`;
  - the "Migrating to Claude Haiku 5.5" section of `shared/model-migration.md`.
  Follow them exactly. In particular for Haiku 5.5: no `temperature`/`top_p`, no assistant prefill, no `budget_tokens`; set a low `effort` or disable thinking where the docs allow, to keep it cheap. Get structured output through a tool with a JSON schema; validate its input with zod before using it, and treat a failure like no result.
  - **Input:** the new text (capped at about 30k characters per source per night), the source name and URL, today's date in Cairo.
  - **Instructions:** extract each distinct casting call (Arabic or English), ignore everything else (workshop ads, news, other posts), never invent fields (null when unknown), and keep the original language for title/summary. One call per source per night.
- **Untrusted content:** page text is data, never instructions. The model has no tools with side effects; the only tool is the extraction schema. Show everything it returns as plain text, links only when http/https, and never act on anything automatically.
- **Costs:** record `usage` from every response into `ai_usage`, priced at Haiku 5.5's rates ($0.10 per million input tokens and $0.50 per million output tokens for prompts up to 100k tokens). Before each call, if this month's spend plus an estimate would pass `aiMonthlyCapUsd`, skip the AI step and keep the item as an "unread change".
- **No AI key:** without the `ANTHROPIC_API_KEY` secret on the Worker (or `ANTHROPIC_API_KEY` env on Node), the radar still runs. It stores each new item as an opportunity with status `new`, title "New post on <source>", the excerpt and the link. The team still sees what changed overnight, at $0.
- **Dedupe:** same fingerprint → don't create again. An item already seen → skip.

### Staff API (`/api/radar/...`)
- **Opportunities:** `castings.read` sees them (`GET /api/radar/opportunities?status=&q=`, `GET /:id`); `castings.write` can `PATCH` the status, delete, and `POST /:id/to-casting`, which creates a casting prefilled from the opportunity (title, description with summary, roles as casting roles where the shapes fit, deadline, original link in notes), links it, and answers `{ castingId }`.
- **Sources:** `castings.write` can create, update and delete them (`/api/radar/sources`). On create or update: validate the URL; for instagram.com/facebook.com/fb.com/tiktok.com answer a field error `radar:errors.socialNotSupported`; Telegram accepts `t.me/<name>`, `@name` or a bare name.
- **Manual add:** `POST /api/radar/extract` (`castings.write`) takes `{ text }` or an uploaded image file id, runs the same extraction (image input for screenshots, as the skill docs show), records usage under `radar_manual`, and returns draft opportunities without saving them. `POST /api/radar/opportunities` saves one. Without a key: 409 `ai_not_configured`, and the UI shows how to add the key.
- **Run now:** `POST /api/radar/run` (`castings.write`) runs the nightly check now, at most once per 10 minutes school-wide. It answers a summary `{ sources, newItems, opportunities, errors, aiUsed, skippedForCap }`.
- **Status:** `GET /api/radar/status` gives the last run's time and summary, this month's AI spend and cap, and whether the key is configured.
- **Dashboard:** `newOpportunities` (status `new`, needs `castings.read`) is added to `/api/dashboard`.

### UI (Casting section)
- **Casting home:** a card "Found overnight: N new opportunities" linking to the list. When N > 0, also show a gentle bar across the top of the Casting home (the start of the notification bar).
- **`/casting/opportunities` (nav "Opportunities", with a count badge):**
  - tabs New / Interested / Applied / Dismissed;
  - cards with title, project type, deadline (red when within 3 days), roles summary, source name, found date;
  - buttons "Open original", "Interested", "Not for us", and "Turn into a casting";
  - an "Add from screenshot or text" button (opens a sheet: paste text or choose a screenshot → AI draft → edit → save).
- **`/casting/sources`:**
  - the list, with status (✓ checked last night / unchanged / ⚠ error with a plain explanation / blocked by the site), last checked time and an on/off switch;
  - add/edit (kind picker with a plain explanation of each, plus the Instagram/Facebook notice and a pointer to the screenshot method);
  - "Check now".
- **Settings:** "AI" card with a monthly cap and this month's spend, and a "Nightly opportunity check" on/off switch.
- **Demo seed:** two or three sources (clearly example URLs on `example.com`, inactive) and five or six realistic demo opportunities in Arabic and English, so the screens aren't empty.

### Tests
- **Unit:** text extraction (web, Telegram preview HTML fixture, RSS fixture), the new-items diff, robots.txt rules, fingerprint, the cost cap.
- **AI calls:** test with a **mocked** Anthropic client. Never call the real API in tests; there is no key in the container.
- **API tests:** permissions, social-URL refusal, run-now rate limit, to-casting, no-key mode, dashboard count.
- **`cf:smoke`:** the radar endpoints with a source pointing at a local fixture server or the Worker's own `/site` page. No external network in tests.

---

## Part F — The AI pack: shared foundation, staff Secretary, website "Chat with us"

Asked by the school on 2026-11-23:
- "a secretary button for all the workers to help them understand whatever they need";
- "a chat with us button on the website that would understand the question and redirect them to the right place".

Built together with the radar (Part E) on one shared AI foundation. **Claude Haiku 5.5 only** (the school's budget rule). Same SDK rules as Part E: read the claude-api skill files first, use the official `@anthropic-ai/sdk`, no temperature, no prefill, no budget_tokens, structured output through tools validated with zod, and **mocked clients in tests**.

### F1. Shared foundation (`src/server/lib/ai/`)
- **`client.ts`:**
  - `getAi(c)` returns a thin wrapper, or `null` when no `ANTHROPIC_API_KEY` is configured (a Worker secret; env on Node).
  - Model constant `claude-haiku-5-5`; pricing constants for the cost math.
  - Timeouts: 30 s for chat, 60 s for radar.
- **`usage.ts`:**
  - `recordUsage(db, feature, usage)` writes to `ai_usage` (Part E table; `feature` is one of `radar`, `radar_manual`, `secretary`, `site_chat`).
  - `canSpend(db, feature, estimate)` checks the monthly overall cap `aiMonthlyCapUsd` **and** a separate public cap `siteChatMonthlyCapUsd` (default 2) for `site_chat`, so strangers on the website can never use up the staff's budget.
- **Prompt caching** for the long, stable system prompts (app guide, site facts) where the skill docs say Haiku supports it.
- **Untrusted text everywhere:** user questions, page text and database contents are data. Tools are **read-only**. Nothing the model says is executed. Links come from a fixed list of targets the server maps to real URLs (website chat) or are internal app paths validated on the client (Secretary).
- **Settings › AI card** (from Part E) shows:
  - this month's spend per feature, with the overall cap and the website-chat cap;
  - switches for "Secretary", "Website chat" and "Nightly opportunity check";
  - whether the key is configured, with plain steps to add it in the Cloudflare dashboard (Workers & Pages → claude → Settings → Variables and Secrets → Add → Secret, name `ANTHROPIC_API_KEY`). Never ask for the key in the app.

### F2. Staff "Secretary" (every signed-in worker)
- **Button:** a floating, labelled button "Secretary" / "السكرتيرة" on every staff screen.
  - On phones: bottom-end, above the tab bar, at least 48 px.
  - It opens a chat sheet (the `Modal`, a bottom sheet on phones) with a greeting and three starter suggestions that fit the person's sections, e.g. "Who has a session today?", "Which enquiries need a follow-up?", "How do I add a new student?".
  - It answers in the language the person writes in (Egyptian Arabic welcome).
- **What it does (v1):**
  - **Explains how to do anything in the app.** A concise app guide is maintained in `src/server/lib/ai/appGuide.ts`: every section and screen, what each position can do, the common tasks step by step, and where things live. A test fails if a nav item exists that the guide doesn't mention.
  - **Answers questions about the school's data, read-only, with exactly the person's permissions.** Each tool is executed by calling the app's own GET API **in-process** with the person's session (e.g. `app.request('/api/students?q=…', { headers: cookie + X-Requested-With })` inside the same Durable Object). Permission checks, class scope and contact redaction are therefore identical to the screens, by construction. A coach asking about a student outside their workshops gets the same 404 the screen would.
    - Tools: `search_students`, `get_student`, `schedule` (from/to), `list_workshops`, `get_workshop`, `list_enquiries` (status / follow-ups due), `get_enquiry`, `search_talent` (filters), `get_talent`, `list_castings`, `get_casting`, `list_opportunities`, `dashboard_summary`, `app_guide(topic)`.
    - Trim the JSON to the useful fields before giving it back to the model.
    - At most 6 tool rounds per question.
  - **Drafts text** (a WhatsApp reply to an enquiry, a message to a coach) for the person to copy. It **never** sends, saves or changes anything.
  - **Links into the app:** the model may write `[label](/students/12)`-style links. The client renders only same-app relative paths that match the router's patterns as buttons; everything else stays plain text. The client renders a small safe subset of markdown (bold, lists, line breaks, those links), never HTML.
- **API:** `POST /api/secretary/chat`, `{ messages: [{ role, content }] }` (last 12 turns, each ≤ 2000 characters), any signed-in staff.
  - Answers `{ reply, links? }`.
  - Rate limit 30 questions an hour per person, plus the overall cap.
  - No key or switched off: 409 `ai_not_configured`, and the sheet explains it. Over the cap: 429 with a plain message.
  - Conversations are **not stored** on the server (only usage numbers); the sheet keeps them in memory until it's closed.
- **i18n** for everything; RTL; phone first; the sheet must not cover the input on small phones (use `dvh`).

### F3. Website "Chat with us" (public site)
- **A "Chat with us" button** on every public page: fixed, bottom-end, big, with a speech icon and the label. It links to **`/:lang/chat`** (`/site/:lang/chat` on non-public hosts).
- **The chat page works without JavaScript** (the site's rule): a question box (≤ 500 characters) and a "Send" button. The answer appears above with **buttons to the right place**. Up to the last 4 turns are carried in hidden fields (each capped, escaped) so follow-up questions work. Quick-choice buttons are always shown: Workshops · Casting call · WhatsApp (workshops) · WhatsApp (casting).
- **What it knows** comes from a system prompt built per request from the **published site content only**:
  - about, address, contact lines, Instagram;
  - visible workshops with dates, days, times and coach (**no prices** — the school's rule);
  - casting call open/closed with its intro;
  - the links page.
  Nothing from the staff database beyond what the public site already shows.
- **How it answers:** through a tool `{ answer: string (≤ 600 characters), targets: [ 'workshops' | 'workshop:<id>' | 'apply' | 'casting_call' | 'whatsapp_workshops' | 'whatsapp_casting' | 'links' | 'home' | 'instagram' ] }`.
  - The server maps targets to real URLs and **ignores unknown targets and any URLs in the text**.
  - Rules in the prompt:
    - answer briefly in the visitor's language;
    - fees/prices → "the team will tell you on WhatsApp" + `whatsapp_workshops`;
    - never promise acceptance, roles or results;
    - never ask for or repeat personal data (to apply → the apply form or casting call);
    - off-topic or abusive → a polite line + WhatsApp;
    - questions about children → mention guardian consent and the casting call rules;
    - when unsure → WhatsApp.
- **Abuse and cost:**
  - Origin check, honeypot and signed form token (the Part D helpers).
  - Rate limits: 15 messages an hour per address, 500 a day school-wide.
  - The `site_chat` monthly cap.
  - A question over 500 characters is refused politely.
- **No key, switched off, or over the cap:** the page shows the quick-choice buttons with "Our team answers on WhatsApp", which is still useful.
- **"What people ask" (Website section):** store each question and answer **without** the address or any identifier in `site_chat_log` (id, created_at, lang, question ≤ 500 characters, answer, targets json). Delete rows older than 90 days in the nightly run. Show it at `/website/questions` (`website.manage`) as a simple list with the newest first, so the owners learn what visitors want. Mention this in the website's privacy note.

### Tests (Part F)
- **Usage and caps:** usage recording and both caps (the website chat can't spend the staff budget).
- **Secretary:**
  - tools run with the person's permissions: a coach's tool call for another coach's student gets the not-found answer; contact fields stay hidden without `students.contact`;
  - link rendering allows only internal router paths;
  - the rate limit;
  - no-key 409;
  - the app guide covers every nav item.
- **Website chat:**
  - target mapping ignores unknown targets and model-written URLs;
  - fees questions route to WhatsApp (prompt-level, with a mocked model returning targets; assert the mapping and that no price text exists in the site facts);
  - rate limits and caps;
  - no-JS form round trip with history fields;
  - no-key fallback;
  - log purge.
- **Never call the real API in tests.**

### Deploy gate for the AI pack (decided 2026-11-23)
**Nothing that costs money goes live until the school says so.** Everything in Parts E and F is built and tested now, but stays **switched off** in the deployment:
- a var `AI_PACK_ENABLED` (`"false"` in both wrangler configs; unset = false on Node) hides every AI screen, button and nav item;
- it also disables `/api/radar/*`, `/api/secretary/*` and the website chat page (404) and skips the nightly radar run.

With it `"true"`, each feature still needs its own Settings switch, and AI needs the key. The cron trigger may stay in the config; `scheduled()` returns at once while the gate is off.

---

## Part G — Team pack: pictures & files, internal chat, "call to the office", notifications

Asked by the school on 2026-11-23:
- "workers should be able to put pictures etc": profile photos, pictures and files in the chat, photos on students and workshops, files on castings — all of it;
- the CEO, CFO and Executive Directors get a button beside every employee they see to **send them an internal chat** or **call them to the office**;
- **everyone can message everyone**;
- only those managers can call someone to the office;
- no COO position.

Free to run (no paid services). Built in its own migration, after the website's.

### G1. Pictures and files
- **Uploads in general:** `POST /api/files` (existing) accepts images (JPEG/PNG/WebP, resized on the phone with `uploadImage`; HEIC is turned into JPEG on the phone where the browser can) and documents (PDF; Word `.docx`, Excel `.xlsx`, PowerPoint `.pptx`). Each upload is checked by magic bytes and stays ≤ 8 MB.
  - `GET /api/files/:id` serves images `inline` and everything else as `attachment` with the original file name.
  - It never serves SVG or HTML inline; `nosniff` always.
  - File ids are random UUIDs (unguessable). A file is only ever handed to people who can see the record it belongs to; document this "capability" rule in `CLAUDE.md`.
- **Profile photo for every worker:** `users.photo_file_id`.
  - Anyone sets their own on Profile; `staff.manage` can set anyone's on the staff page.
  - Shown by `Avatar` everywhere a staff member appears: staff list, Team directory, chat, the workshop's coach, an enquiry's assignee, the schedule.
- **Student photo:** the `students.photo_file_id` column already exists. Make sure the student form and detail page let `students.write` add or change it, and that lists show it.
- **Workshop photos & files:** `course_files` (id, `course_id` FK cascade, `file_id` FK files, `kind` `photo` | `document`, `caption` ≤ 200, `uploaded_by_id`, `created_at`).
  - A "Photos & files" tab on the workshop page: a grid of photos (tap to view full screen) and a list of documents (tap to download).
  - Visible to whoever can see the workshop (same class scope as the rest of the workshop). Adding needs `courses.write` **or** being the workshop's coach, so coaches can add rehearsal photos. Deleting needs `courses.write` or being the uploader.
- **Casting files:** `casting_files` (id, `casting_id` FK cascade, `file_id`, `kind`, `caption`, `uploaded_by_id`, `created_at`). A "Files" section on the casting page; `castings.read` to see, `castings.write` to add or delete.
- **Deleting a file record** deletes the stored file when nothing else references it. Use a small `releaseFile(db, files, fileId)` helper that checks every referencing table. Add it to `lib/fileStore.ts` or nearby and use it in the new deletes.

### G2. Team directory
- **New page `/team`** ("Team" / "الفريق"), available to **every** signed-in worker from the account / "More" menu in every section. It lists active staff: photo, name and positions.
  - For non-owners, owner accounts appear with their name and photo but **no positions**; the owner-hiding rule for positions stays.
  - Each row has a **"Message"** button. With `staff.summon`, it also has **"Call to the office"**.
- **Where else the buttons appear:** the same buttons sit beside each person on the staff list and staff detail page, the coach on a workshop page, and an enquiry's assignee. Use one `PersonActions` component.
- **Owners in chat (a deliberate exception):** owners are visible here and can be messaged, as a name and photo only. The owner-hiding rule in `CLAUDE.md` still applies to everything about positions and access; write this exception into `CLAUDE.md`.

### G3. Internal chat
- **Data:**
  - `conversations` (id, `pair_key` unique for direct chats as `"<minUserId>:<maxUserId>"`, `last_message_at`, `created_at`);
  - `conversation_members` (`conversation_id`, `user_id`, `last_read_message_id`, unique pair);
  - `messages` (id, `conversation_id`, `sender_id`, `body` ≤ 4000, `created_at`, `deleted_at`);
  - `message_attachments` (`message_id`, `file_id`, `kind`).
  - Direct (one-to-one) chats only in v1.
- **API (`/api/chat`, any active signed-in staff):**
  - `GET /conversations`: mine, newest first, with the other person, the last message preview and the unread count.
  - `POST /conversations` `{ userId }`: open or create the direct chat; the other person must be an active staff member.
  - `GET /conversations/:id/messages?after=<id>&before=<id>`: paged, members only (anyone else gets 404).
  - `POST /conversations/:id/messages` `{ body?, fileIds?[] }`: at least one of them; up to 5 attachments, each a file the sender uploaded in the last hour that isn't attached elsewhere.
  - `POST /conversations/:id/read` `{ messageId }`.
  - `DELETE /messages/:id`: the sender only, within 15 minutes; the message shows as "deleted".
  - `GET /unread`: the total, for the badge.
  - Rate limit 60 messages a minute per person.
- **UI:**
  - A **"Messages"** icon with an unread badge in the header of every section.
  - `/messages` lists the conversations. `/messages/:id` is the conversation: bubbles, dates, "Seen", attachments (photos inline and tappable, documents as download chips), an input with a camera/gallery button and a file button.
  - Phone first, RTL-correct (my bubbles on the end side), works in Arabic and English.
- **Freshness:**
  - the unread badge polls every 20 s while the app is visible;
  - an open conversation polls every 4 s (`after=<last id>`);
  - polling stops when the tab is hidden;
  - push notifications (G5) cover the app being closed.

### G4. "Call to the office"
- **New permission `staff.summon`** ("Call someone to the office"). Built-in for `executive_director` through `BUILT_IN_GRANTS` **version 3** (the website uses version 2). Owners have it by definition. EN and AR labels.
- **Data:** `summons` (id, `from_user_id`, `to_user_id`, `note` ≤ 200, `status` `pending` | `on_my_way` | `cant_now` | `cancelled`, `created_at`, `answered_at`).
  - One pending summons per pair at a time.
  - A pending one older than 2 hours counts as expired.
  - At most 20 an hour per sender.
- **API:**
  - `POST /api/summons` `{ userId, note? }` (`staff.summon`).
  - `GET /api/summons/incoming`: my pending ones.
  - `POST /api/summons/:id/answer` `{ status: 'on_my_way' | 'cant_now' }` (recipient only).
  - `POST /api/summons/:id/cancel` (sender only).
  - `GET /api/summons/sent?status=` (sender).
- **The recipient sees:**
  - a push notification "Dalia is calling you to the office" (G5), with the note;
  - in the app, within about 20 s through the same poll as the unread badge, a **full-width, can't-miss banner** at the top of every screen with the caller's photo and name, the note, and two big buttons, **"On my way"** and **"Can't come now"**;
  - a short vibration where the browser allows.
- **The sender sees** the answer as a toast and on the person's row ("On my way ✓ 10:42").
- **Who sees the button:** "Call to the office" only shows for people with `staff.summon` (the CEO, CFO and Executive Directors as built in). It never offers to call yourself.

### G5. Notifications (the in-app bar, and push to the phone)
- **In-app notification bar (#89):**
  - `notifications` (id, `user_id`, `kind` `message` | `summon` | `summon_answer`, `title`, `body`, `link`, `created_at`, `read_at`);
  - a bell with an unread count in the header, and a sheet listing them (tap → go to the link and mark it read);
  - `GET /api/notifications`, `POST /api/notifications/read` `{ ids | all }`.
  - New messages create one notification per conversation, updated rather than piled up.
- **Web Push (free):**
  - VAPID keys: the public key as var `VAPID_PUBLIC_KEY`, the private key as secret `VAPID_PRIVATE_KEY` (the operator generates the pair at deploy; on Node, env vars), with subject `mailto:` from settings or `https://turquoisestudio.app`.
  - Without the keys, push is simply off and the in-app bar still works.
  - `push_subscriptions` (id, `user_id`, `endpoint` unique, `p256dh`, `auth`, `user_agent` short, `created_at`, `last_success_at`, `failures`).
  - Profile has **"Turn on notifications on this phone"**, which explains plainly that **on iPhone the app must first be added to the Home Screen (Share → Add to Home Screen) and opened from there**, and asks permission only from that button tap. `POST /api/push/subscribe` and `DELETE /api/push/subscribe`.
  - **Sending:**
    - Implement RFC 8291 (aes128gcm message encryption) and RFC 8292 (VAPID JWT, ES256) with WebCrypto in `src/server/lib/push/`, with **no Node-only crypto** (it runs in the Durable Object). Test it against the RFC 8291 test vectors.
    - Send after the database transaction (`ctx.waitUntil` on Workers where available; on Node, fire and forget with errors logged).
    - Delete a subscription on 404/410; count other failures and drop it after 10.
    - Payload: `{ title, body, link, kind }`, ≤ 3 KB, no message text beyond a 100-character preview.
  - **Service worker:** add the push and notificationclick handlers to the staff app's service worker (vite-plugin-pwa: an `importScripts` file in `src/web/public/`, or the injectManifest strategy — keep the precache and the update behaviour exactly as they are, `skipWaiting` and `clientsClaim` included).
    - On push: show the notification. A summons notification has `requireInteraction: true` and vibration; message notifications are tagged per conversation so they replace each other.
    - On click: focus an open app window and navigate to the link, or open one.
- **Push goes out for:** a new message to the other member (not to the sender), a summons to the recipient, and a summons answer to the sender.

### Tests (Part G)
- **API tests:**
  - chat membership (outsiders 404), owner messaging allowed, attachments only your own fresh uploads, delete window, unread counts, rate limit;
  - summons: permission, one pending per pair, answer and cancel rules, expiry;
  - notifications; push subscribe/unsubscribe;
  - files: type and magic-bytes checks, attachment disposition, `releaseFile` keeping shared files;
  - the workshop files scope (a coach sees only their own workshops' files), casting files permissions.
- **Unit tests:** the push crypto against the RFC 8291 vectors, the VAPID JWT structure, `PersonActions` visibility rules.
- **`cf:smoke`:** a chat round trip with a photo, a summons answered, notifications.

---

## Part H — Studio email addresses (`name@turquoisestudio.app`), forwarded to each person's real inbox

Decided by the school on 2026-11-23.
- Every account signs in with a studio address: `ceo@`, `cfo@`, `salma@`, then the person's first name, all `@turquoisestudio.app`.
- **Every worker, the CEO and CFO included, enters their own real email in the app**, and the app does the rest: mail sent to their studio address is forwarded to that inbox (Cloudflare Email Routing, free).
- Receiving only for now; replying "as" the studio address is a later, optional step.
- Built **after the Team pack is merged**, because it touches the same staff and profile screens. Its own migration.

### Data and settings
- `users.personal_email` (nullable, normalised lower-case, a real address).
  - **Private:** visible only to the person themself and to `staff.manage`; owners see it the same way. Never in Team-directory or chat payloads.
  - The sign-in email (`users.email`) stays the studio address.
- `users.forwarding_status`: `none` | `pending_confirmation` | `active` | `error` | `disabled`, plus `forwarding_error` (short text).
- Settings (`settings.manage`):
  - `emailDomain` (default `turquoisestudio.app`);
  - `infoForwardTo` (a staff member, for `info@`);
  - `catchAllForwardTo` (a staff member, or off);
  - the forwarding status of `info@` and the catch-all.

### Screens
- **Add staff (`staff.manage`):** the email field fills itself with `firstname@<emailDomain>` from the Latin first name (lower-case, letters only; duplicates get `firstname.lastname@`). It can be edited. If the name is only in Arabic, the field is left for the person adding to type.
- **Profile, "Your email":**
  - shows the studio address;
  - asks for "Your personal email, where your studio mail should arrive";
  - shows the status in plain words: "Check your inbox and click the confirmation link from Cloudflare" / "Working ✓" / "Something went wrong — ask the manager".
  - `staff.manage` can set or change it for anyone on the staff detail page.
- **Staff list (`staff.manage`):** a small forwarding-status badge per person.
- **When an account is deactivated:** its forwarding rule is switched off (former staff stop receiving studio mail). Optionally it forwards to `infoForwardTo` instead, as the deactivation dialog chooses.

### How forwarding is set up (`src/server/lib/emailForwarding.ts`)
- **Calls the Cloudflare API from the app:**
  - `POST /accounts/{account}/email/routing/addresses { email }` creates the destination; Cloudflare sends the person a confirmation email;
  - `GET` it to read whether it is `verified`;
  - zone rules `POST/PUT/DELETE /zones/{zone}/email/routing/rules` with `matchers [{ type: 'literal', field: 'to', value: <studio address> }]` and `actions [{ type: 'forward', value: [<personal email>] }]`;
  - the catch-all rule (`/zones/{zone}/email/routing/rules/catch_all`).
- **Configuration:**
  - vars `CF_ACCOUNT_ID`, `CF_EMAIL_ZONE_ID`;
  - secret `CF_EMAIL_TOKEN`: a Cloudflare API token limited to **Account › Email Routing Addresses: Edit** and **Zone (turquoisestudio.app) › Email Routing Rules: Edit**, created by the owner in the dashboard; README explains it step by step;
  - env vars on Node.
  - Without them: personal emails are still saved and the status shows "Waiting for the administrator to switch on forwarding".
- **Syncing:**
  - sync on change (after the database transaction; failures saved as `error` with a short reason);
  - a "Check again" button;
  - the nightly cron also refreshes `pending_confirmation` statuses;
  - the operator can run `npm run email:sync` from a machine with Cloudflare credentials to sync everything at once.
- **Email Routing must be enabled on the zone once**, which adds its MX/SPF DNS records. The operator does this at deploy with the owner's approval; the app doesn't enable it.

### Tests
- **Mock the Cloudflare API with a fake fetch:** create, update, verify, delete and catch-all calls with the right shapes, plus error handling.
- **Privacy:** `personal_email` never leaves in other people's payloads.
- **Rules:** auto-fill naming rules and duplicates; deactivation switches the rule off.
- **No-config mode.**

### Amendment to Part G2 — one "Team" page, and the word "Team" instead of "Staff" (asked 2026-11-23)
The school asked to call it **Team**, not Staff. So there is **one** page, "Team" / "الفريق", at `/team`, instead of a separate Staff page and Team directory.
- **Everyone** sees the team list: photo, name, positions (owners' positions stay hidden from non-owners) and the **Message** button.
- **With `staff.manage`**, the same page also shows the management controls: **Add team member**, a link on each row to the member's page (the existing staff detail/edit screens, kept at `/staff/:id` and `/staff/new`), the active/inactive filter, and inactive members. `/staff` redirects to `/team`.
- **With `staff.summon`**, each row also has **Call to the office**.
- **Menu:** one entry, "Team", in the account / "More" menu of every section. The "Administration" group keeps Positions and Settings.
- **Wording everywhere on screen:** "staff" → "team" / "team member(s)" (Arabic: "الفريق" / "عضو الفريق" / "أعضاء الفريق"), including the sign-in page ("Team accounts only"), permission labels and descriptions, empty states and the Secretary's app guide. Code names (`staff.manage`, `/api/staff`, file names) do not change.
