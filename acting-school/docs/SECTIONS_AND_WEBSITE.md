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
  - `price_en`, `price_ar` (free text such as "3,500 EGP" / "٣٥٠٠ جنيه");
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
  - **Workshops:** three or four workshops visible with prices.
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
  - Tapping a workshop opens `/website/workshops/:courseId`: public title EN/AR (placeholder = the course name), description EN/AR, price EN/AR, cover photo, "Accepting applications" switch.
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
- **Later**, a custom domain can serve this site at its root. Out of scope now, but keep the paths in one place, `src/server/site/paths.ts`, so that change is small.

### Pages (`:lang` is `en` or `ar`)
- **`GET /site`:** redirects (302) to `/site/ar` if `Accept-Language` prefers Arabic, otherwise `/site/en`.
- **`GET /site/:lang` — Home:**
  - Hero: brand mark, studio name, tagline, hero photo.
  - About text.
  - "Open workshops" cards (title, dates, days and times, coach, price, "Apply" button).
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
