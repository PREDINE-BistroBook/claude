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
  - `/` redirects to the remembered section's home if the person can still see it, otherwise to the first visible section — except that someone who sees Casting and has no `admissions.read` starts in Casting when their School is only the student list (`students.read` without `courses.read`: the casting team) or when they write castings (`castings.write`: the Heads of Casting — the operator's decision, 2026-11-23) (`defaultSection`). The remembered section is kept per signed-in person.
  - After sign-in, a `?next=` page the person can't open (a section they don't see, a menu page their positions don't open — on a shared phone, the last person's page) becomes `/`, never a "No access" screen (`landingAfterSignIn`).
  - `/schedule` is the School schedule; an old link that was after auditions (`?show=auditions`, or anyone who sees auditions but no workshops or interviews) goes on to `/casting/schedule`, the date kept.
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
    published: boolean   (the "Website is public" switch — see "Publish switch" in Part D; default false),
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
  - the public URLs to show and copy: `{ home, workshops, castingCall, links }` for `en` and `ar` — on the first `PUBLIC_SITE_HOSTS` entry without `/site` when the studio's domain is configured (`https://turquoisestudio.app/ar/links`), otherwise built from the request's own origin (`…/site/ar/links`).
- **`/api/casting-applications`:**
  - `GET` (`talent.read`): `?status=` and `?q=` (name/phone/city search via `contains()` and `phone_digits`), newest first, answering `{ items }`. Each item: id, names, gender, age, city, status, createdAt, first photo file id, minor flag.
  - `GET /:id` (`talent.read`): everything, with photos as `[{ fileId }]`. Contact fields are redacted without `talent.contact`.
  - `PATCH /:id` (`talent.write`): `{ status: 'reviewing' | 'declined' | 'new' }`. Sets `reviewed_by_id` / `reviewed_at`.
  - `POST /:id/accept` (`talent.write`):
    - in one transaction: create a `talent` row from the application (names, gender, date_of_birth, phone through `withPhoneDigits`, email, city, height_cm, languages, skills, plus notes with the experience, the message and the guardian's name and consent — **not** the guardian's phone or the raw links, which are contact fields and stay on the application behind `talent.contact`; an Instagram link fills `instagram`, the first other link `showreel_url`), create `talent_photos` for its photos reusing the same file ids, then set status `accepted`, `talent_id` and the reviewer;
    - answers 201 `{ talentId }`;
    - 409 if already accepted and its talent profile still exists. If that profile was deleted since (`talent_id` back to null), the application is open again: it can be accepted once more, or its status changed.
  - `DELETE /:id` (`talent.write`): deletes the application and its photos' files (files deleted after the transaction). Files already linked to a talent profile are kept; they are deleted when that profile (or that photo) is deleted and nothing else uses them, so an applicant's photos can always be removed for good. Answers 204.
- **Website enquiries:** the leads they create are ordinary leads, so Admissions shows them as it does today.
  - Make sure the Admissions list can filter by source (add `?source=` to `GET /api/leads` plus a filter in the UI if it isn't there).
  - The `website` source already exists in `LEAD_SOURCES`.

### Files that become public
- A file is **public** if it is:
  - `siteContent.heroFileId`, or
  - the `photo_file_id` of a **visible** coach, or
  - the `cover_file_id` of a workshop that **appears on the site**.
- A file can only be given one of those three roles if it is an uploaded image that nothing outside the website uses: not a casting application's photo, a student's, a talent's or a team member's photo, a workshop's or a casting's file, or a chat attachment (the Website screens upload their own images; `assertSiteImage` asks `fileUsedOffSite`, the one list of places in `lib/fileRefs.ts`). So holding `website.manage` alone never publishes someone else's file by its id.
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
  - First, a prominent card with the big switch **"Website is public" / «الموقع منشور للزوار»** (the publish switch, Part D), and one plain sentence for its state: "Visitors to turquoisestudio.app see a 'coming soon' page. Only your team can preview the site." / "Anyone can see the site at turquoisestudio.app." Turning it **on** asks first, with a reminder to check that the texts, coaches and workshops are real (the demo content is made up); turning it off is immediate.
  - A big "Open the website" button: opens the site in a new tab, `rel="noopener"`. While the website is not public it reads **"Preview the website"** and opens the `/site` preview; the "Open" button of each page below does the same ("Preview"), while "Copy link" keeps copying the public address.
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
  - **Staff app:** `team.turquoisestudio.app` (renamed 2026-11-23, when the school asked for "Team" instead of "Staff"). Its first address, `staff.turquoisestudio.app`, stays attached and forwards to it: a var `HOST_REDIRECTS` (`"staff.turquoisestudio.app=team.turquoisestudio.app"`, the same in both wrangler configs) read by `src/worker/hostRedirect.ts` before any other routing. On the old host, pages answer 301 to the same path on the new one, `/api/*` keeps answering (a page already open doesn't break mid-task), and `/sw.js` is a service worker that removes itself and reloads, so an installed app there follows the redirect.
  - **Public website:** at the root of `turquoisestudio.app`. `www.turquoisestudio.app` redirects (301) to it.
  - **How the Worker routes it:** a var `PUBLIC_SITE_HOSTS` (comma-separated; `"turquoisestudio.app,www.turquoisestudio.app"`, the same in both wrangler configs) names the public hosts.
    - On a public host, the site is served **at the root**: `/` → home, `/ar`, `/en/workshops/12`, `/ar/casting-call`, `/en/links`, `/media/:id`, and so on.
    - The Worker maps a public-host path `/x` to the app's `/site/x`, with no `/site` in the visible URLs.
    - Nothing of the staff app answers on a public host. `/api/*`, `/login`, the staff static files and the service worker all get the site's 404 page.
    - `www` → 301 to the apex, with the same path and query.
  - **Links inside the pages** come from `src/server/site/paths.ts`, given the request: `/site/...` on any other host (the staff app's host `team.turquoisestudio.app`, workers.dev, localhost), bare paths on a public host.
  - **On a non-public host,** `/site/*` keeps working as today, for previews.
  - **`run_worker_first`:** with static assets, a path on a public host must reach the Worker before assets. So `wrangler.jsonc` uses `"run_worker_first": true`, and the Worker passes staff-host asset requests to `env.ASSETS` exactly as before; the embedded variant already runs the Worker first.
  - **Tests:** cover the public-host routing (Worker-level unit tests in `tests/unit/`, using a fake ASSETS and DO stub) and the link building in `paths.ts`.
  - **Custom domains in the configs:** the deployer adds `routes` with `custom_domain: true` when switching the domain on (done: both configs carry them). Builders don't add `routes`. Local runs (`cf:dev`, `cf:smoke`) pass `--infer-origin-from-routes=false` so wrangler doesn't rewrite every request's host to the first route.

### Publish switch (added 2026-11-23, the operator's decision)
The demo content is made up, and it sits next to the studio's real phone numbers: the website must not be public until the owner says so. So the site content has one master switch, **`published`** (default `false`; in the existing `site` settings JSON, no migration), shown as "Website is public" at the top of the Website home (`website.manage`). It is part of `GET`/`PUT /api/site/content` (left out of a `PUT` it keeps its stored value, so saving texts never publishes or unpublishes; content stored before the switch existed reads as not public) and `GET /api/site/summary` reports it, with `publicHost` (the first `PUBLIC_SITE_HOSTS` entry) and `previewUrls` (the `/site` pages on the host the staff app is used on). The demo seed leaves it off.
- **On a public host while not published,** nothing of the site answers. `GET /` is a **"coming soon" page** rendered by the site code (same brand; the visitor's language by `Accept-Language`, with the other language's line under it): the studio's name, "Our new website is coming soon" / «موقعنا الجديد قريبًا», and — only from the saved content — the WhatsApp workshops and WhatsApp casting buttons, Instagram and the address. No other content (texts, workshops, coaches and photos may be drafts), no menu, no links into the site. It answers 200 with `noindex` (meta and `X-Robots-Tag`) and `no-store`. Every other `GET` redirects (302, `no-store`) to `/` — a fixed `Location`, so it can never lead off the host; `/media/*` answers 404; every `POST` (or other method) answers the same page with **503** before a byte of its body is read, so nothing is stored or counted. `www` → apex is unchanged, and nothing of the staff app answers, as before.
- **On any other host** (`/site/…` on `team.turquoisestudio.app`, workers.dev, localhost) the whole site **always** renders: that is the preview, and its forms keep working so the team can try them. While not published, every preview page carries a slim banner at the top, "Preview — the website is not public yet" / «معاينة — الموقع غير منشور للزوار بعد», is `noindex`, and is not cached (`no-store`), so the banner goes the moment the switch is turned.
- **When it is turned off again,** a visitor's browser may keep a page it loaded in the last minute (pages are cached for 60 s); the next request gets "coming soon".

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
  - **If an open lead with the same phone already exists and it is the same person** (same first name; then the same date of birth when both have one, else family names that agree): add a note activity "Applied again on the website: …" (with the date of birth and email) to it instead of creating a duplicate, and make its follow-up due today so staff see it. **Someone else on that phone** (a parent's second child) becomes a lead of their own, with "Same phone as enquiry #N (name)" in its notes.
- **`GET` and `POST /site/:lang/casting-call`:**
  - **When open:** intro, "what we're looking for", then the form: first/last name, gender, date of birth, phone, email, city, height (cm), languages, skills, experience, up to 3 links (Instagram/showreel, https only), message, **1–3 photos** (the first is the headshot, required), guardian block when under 18, privacy consent.
  - **When closed:** "There's no open casting call right now. Follow us on Instagram" + Instagram link. A `POST` answers that page with 410.
  - The form uses `enctype="multipart/form-data"`.
- **`GET /site/:lang/links`:** the link-in-bio page. Logo, name, then big stacked buttons:
  - each open workshop accepting applications;
  - "Casting call" when open;
  - WhatsApp workshops, WhatsApp casting, Instagram;
  - then the visible custom links.
- **`GET /site/:lang/thanks?k=apply|casting`:** a thank-you page with a WhatsApp button. Forms use POST → 303 redirect → GET (PRG); the redirect ends in `#thanks` (an anchor on that page), not the form's `#apply`.
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
  - `<label for>` on every input; `autocomplete` (`given-name`, `family-name`, `tel`, `email`, `bday-day` / `bday-month` / `bday-year`); `inputmode="tel"`; `required` markers.
  - Date of birth is three plain lists (day, month by name, year) under one legend, joined on the server — not a calendar picker, which is hard to take back to a birth year on a phone.
  - Numbers typed with Arabic-Indic digits (١٧٠) are accepted. Links may be written as an Instagram name (`@name`) or without `https://`; they are stored as https links.
  - An error page's "Back to the form" link must be a real navigation (`?again=1#apply`): two of the forms post to their own address.
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
- **Rate limits (`rate_limits`)**, checked **before a byte of the body is read** (with or without a `Content-Length`) and before writing. Two things are limited (amended after the launch review, 2026-11-23):
  - **attempts** — every POST of one client address, whatever becomes of it: apply 20 per hour, casting 12 per hour. Counted before reading. Generous on purpose: a form that comes back with a mistake must not lock an honest applicant out;
  - **what is stored** — apply: 5 per hour per client address, 300 per day school-wide; casting: 3 per hour per address, 100 per day school-wide, plus 300 MB of photos **kept** per day school-wide. These are looked at before reading (already full → 429) but **counted only at the write**, by what is actually stored (the photos' real sizes). A request that stores nothing — no token, a validation error, a declared length with no body, a dropped connection — uses up none of the school-wide allowance. A filled honeypot counts against its own address only;
  - the per-address key is the IPv4 address, or the **/64** of an IPv6 address (one line or phone holds a whole /64);
  - when hit: a friendly 429 page in the right language.
  - The client address comes from the existing `clientIp` dependency (CF-Connecting-IP / socket).
  - A flood from many addresses at once is bounded only per address: that is for a Cloudflare rate-limiting rule on POSTs to the public hosts (an operator setting), not for the app.
- **Body caps:**
  - apply forms 64 KB;
  - casting form 20 MB total, each photo ≤ 6 MB, at most 3;
  - photos must be real JPEG/PNG/WebP, checked by magic bytes; otherwise a friendly error asking for a JPG or PNG;
  - the Worker's `tooLarge()` refuses a larger `Content-Length` before the DO, and the app enforces the same caps on bodies without a length;
  - text fields are bounded too: no field over 4,000 characters and no more than 64 KB of text in all reaches validation or is echoed back (the casting form's 20 MB are for its photos), and a form with far more multipart parts than ours is refused unparsed;
  - **casting uploads in flight:** the bodies being received or handled at one moment may add up to 40 MB (two full-size applications, or several ordinary ones) — the Durable Object has 128 MB for the whole school. Beyond that the visitor gets a "please try again in a minute" page (429, `Retry-After`), before anything is read or counted. A body that takes longer than 2 minutes to arrive (30 s for the enquiry form) is given up.
- **One answer names every problem:** the fields, the guardian block (when the date of birth says under 18) and the photos (count, size, type) are all checked before a form is sent back, because each round costs the applicant their chosen photos.
- **Redirects never leave the site:** the trailing-slash redirect is built from the still percent-encoded path, so `/%5Cevil.example/` or `/%09/evil.example/` cannot become a `Location` a browser reads as another host.
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
  - the publish switch: default off, toggled only with `website.manage`, kept when a `PUT` leaves it out; a public host in both states (the "coming soon" page, redirects that never leave the host, media 404, forms 503 with nothing stored), the preview banner, and the Worker routing for an unpublished public host;
  - accept creates talent + photos and is not repeatable (409);
  - delete removes files not used by talent;
  - `/site/media` only serves public files;
  - the `BUILT_IN_GRANTS` v2 upgrade gives the director `website.manage` once.
- **Unit tests:** `sectionForPath`, `visibleSections`, `mobileTabs(section, can)`.
- **`scripts/cf-smoke.ts`:** extend with the public pages (both languages), one apply, one casting application with a photo, `/site/media`, accept → talent, and the headers on `/site`; the studio's domain in both states of the publish switch (not public as the demo leaves it, then switched on). Run `npm run cf:smoke` and `npm run cf:smoke -- --embedded`.
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

Free to run (no paid services). Built in its own migration, after the website's: `0006_team` (one migration; `0005_website` is the website's). **Built 2026-11-23**; G2 as amended at the end of this file (one Team page).

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

**Built 2026-11-23** (with Part G, merged into the website line the same day). Notes for whoever builds on it:
- The staff add and edit screens were modals on the old Staff list; they are now pages at `/staff/new` and `/staff/:id` (`features/staff/StaffNewPage.tsx`, `StaffMemberPage.tsx`), both behind `staff.manage`, and saving goes back to `/team`.
- On the Team page the management side comes from `GET /api/staff` (it has the inactive accounts and says which accounts the caller may edit); everyone's list stays `GET /api/team`. A non-owner manager sees owners on the page (name and photo, from `/api/team`) without a link, because `/api/staff` leaves owner accounts out for them.
- The link on a row is the member's name block, ending in the word "Edit" (or "View" for an account out of the caller's reach). The filter is two tabs, Active / Inactive, shown only with `staff.manage`.
- `tests/unit/team-web.test.ts` fails if "staff" (or «موظف») appears in any i18n namespace. The Secretary's app guide (Part F) is not built yet: write it with "Team" from the start.
- The staff app's address followed the wording: `team.turquoisestudio.app`, with `staff.turquoisestudio.app` forwarding (see "The studio's own domain" in Part D).

---

## Part I — Usernames, first-sign-in passwords, and clearing the demo (asked 2026-11-23)

The school asked for three things at once:
- "take out all the demo things";
- "delete all accounts but recreate all of them with a simple password like their name then 123";
- "a username they choose instead of the email".

They also said to keep "the website information we pulled from Instagram".

### I1. Sign in with a username
- **`users.username`:** unique, stored lower-case; 3–20 characters from `a–z 0–9 . _ -`, starting with a letter. A new migration adds the column (nullable) and a unique index; `initDb` fills it for existing rows from the email's local part, made unique.
- **Sign-in:** the field is "Username" / "اسم المستخدم". It accepts a username **or** an email address, trimmed and case-insensitive. The sign-in brakes stay per account: they are keyed on the account the identifier resolves to, or on the typed identifier when it resolves to nobody. The error stays the same generic one.
- **Adding a team member:** asks for Name, **Username**, position(s) and a first password. The username is suggested from the first name (Latin, lower-case; a taken name gets `.lastname`). The email is no longer asked for: `users.email` stays NOT NULL and is filled as `<username>@<emailDomain>` (settings `emailDomain`, default `turquoisestudio.app`; Part H reuses it). An "Email (optional)" field lets a manager set another address.
- **Changing your own username:** anyone can, in My profile, under the same rules and uniqueness check. If their email was the automatic one, it follows the username. Managers can change a member's username on the member page.
- **Where the username shows:** on the Team list for people with `staff.manage`, on the member page, and on My profile.

**Built 2026-11-23.** Notes for whoever builds on it:
- The rules are `src/shared/usernames.ts`; the server side is `src/server/lib/usernames.ts`. An account gets or changes its username and email only through `newAccountNames(db, { name, username?, email? }, emailDomain)` and `usernameChange(db, account, next, emailDomain)` — the operator tool (I3) should call `newAccountNames` for each account it creates (inside its transaction) rather than write its own uniqueness check.
- The sign-in request's field is `username` (a username **or** an email address); `email` is still read as its old name. Look an account up from a typed name with `findSignInAccount`.
- The brakes count under the account's email address whichever name was typed (`signInBrakeName`); a name that is nobody's counts in its email form, so "ghost" and "ghost@<emailDomain>" share a brake exactly as a real account's two names do.
- Migration `0007_usernames` adds `users.username` (nullable, unique index) and `users.must_change_password`; `initDb` → `backfillUsernames` fills usernames for older accounts (`owner@…` → `owner`, a clash numbered, nothing usable → `user<id>`), in id order.
- Setup takes an optional `username` (else from the email); `POST /api/staff` takes `username` (required by the form; an older copy of the app that sends only an email still works: the username is made from the address). `GET /api/staff/username-check?username=&name=&exceptId=` is the live check and the suggestion.
- A "taken" answer never says whose username it is (409 `username_taken`, the same body for an owner's as for anyone's).
- `POST /api/admin/grant-owner` and `npm run owner` name the account by username or email.
- The demo: usernames `owner`, `cfo`, `director`, `head`, `casting`, `editor`, `coach`, `coach2` (and `tom`, deactivated); their `…@demo.school` addresses still sign in.
- After review (2026-11-23):
  - A username also ends with a letter or digit and never has two of `. _ -` in a row (`abc.` and `a..b` made addresses the member page could not save).
  - `RESERVED_USERNAMES` (admin, administrator, hostmaster, postmaster, webmaster, info, abuse, root, support, noreply, …) are nobody's username: their automatic address is one the studio's domain needs (certificate checks, Part H's `info@`). Refused everywhere (`errors.usernameReserved`, live check `status: 'reserved'`); the backfill and the suggestions step around them (`admin@…` → `admin2`).
  - `ROLE_USERNAMES` (ceo, cfo, owner, director, manager, …) are given by a manager or the operator; nobody takes one for themselves in My profile (`errors.usernameForManagers`).
  - `username-check`'s `exceptId` follows the reach of `GET /api/staff/:id`: an owner's id, for a non-owner, answers exactly like a missing one (it confirmed owners' usernames).
  - The brakes count under `signInBrakeNames`: the account's email and its username's automatic address (when the email is another one); for nobody, a typed address and the automatic address of its first part too. Ten failures under one name, then the other name, answer the same whether or not the account exists.

### I2. A first password is temporary
- **`users.must_change_password`** (boolean, default false).
- **When it is set:** whenever someone else sets a person's password. That is: a manager adding a team member, a manager resetting a password, and the operator's clear-and-recreate tool.
- **What the person sees:** on their next sign-in, one screen and nothing else: "Choose your own password" (new password twice, plain rules, show/hide). Until they do:
  - the app shows only that screen;
  - every API call except the auth ones answers 403 `password_change_required`.
- **Rules for the new password:** it must meet the normal password policy and differ from the temporary one.
- **After choosing:** the flag clears and their other sessions end.
- **Why:** this makes simple first passwords ("salma123") safe to hand out. They stop working as soon as the person signs in once.

**Built 2026-11-23.** Notes for whoever builds on it:
- The gate is `requireOwnPassword` (`middleware/auth.ts`), mounted in `app.ts` right after `/api/auth`: every router registered below it answers 403 `password_change_required` to such a session. `/api/auth/*` still answers (so the language can be switched and the person can sign out); `/api/admin/*` is bearer-only and not affected.
- `POST /api/auth/choose-password { newPassword }` (only while the flag is set; no current password asked: two fields on the screen) → `{ user }`. 400 `errors.passwordTooShort` / `errors.passwordSameAsTemporary` on `newPassword`; 409 `password_change_not_required` once chosen. `POST /api/auth/password` (current + new) clears the flag too.
- A manager resetting **their own** password through `PATCH /api/staff/:id` does not set the flag (it is their own choice); the first owner (setup) and the demo accounts never have it.
- **For the operator tool (I3):** insert each account with `mustChangePassword: true`; the password may be shorter than the policy (`hashPassword` takes any length and sign-in accepts any length), the person's own choice then has to meet it.
- The web side: `RequireAuth` → `authGate` → `pages/ChoosePasswordPage.tsx` (no route of its own).
- After review (2026-11-23): `POST /api/auth/password` checks "not the temporary one again" against the stored hash as choose-password does (a full-width spelling, "ｓalma123", is the same password to scrypt).

### I3. Clear the demo and create the real team (operator tool)
- **`POST /api/admin/clear-demo`**, bearer `ADMIN_TOKEN`, with a **dry run first** (the default): it changes nothing and returns the exact plan and a `confirm` code. The real run must send that code, and is refused if the data changed in between.
- **What a real run does, in one transaction:**
  - deletes **every** domain record: students, workshops, sessions, attendance, files, talent, castings, enquiries, interviews, casting applications, chats, summons, alerts, rate limits, sign-in failures;
  - deletes **every** account not listed under `keep` (normally all of them), with their sessions and push subscriptions;
  - creates the accounts listed under `create` (`{ name, username, password, positions: [position keys], locale? }`), each with `must_change_password = true`;
  - guarantees `owner` (a username from `create` or `keep`) is an active owner.
- **Website content, `keepSiteContent`:**
  - `'contact'` (the school's choice): keep the tagline, about text, address, map link, WhatsApp lines, phone, email and Instagram; remove the demo coaches, the workshops shown, the custom links and the main photo; the casting call is closed and the site unpublished;
  - `'all'` keeps everything that doesn't point at a deleted record;
  - `'none'` resets to empty.
- **Kept as they are:** settings, positions (built-in and custom), the form secret and the migration bookkeeping.
- **Stored files** nothing references any more are deleted after the transaction.
- **Restore point:** a real run first records the Durable Object's point-in-time-recovery bookmark and returns it. `GET /api/admin/restore-point` and `POST /api/admin/restore` let the operator roll the whole database back within 30 days. On Node the database file is copied aside instead.

**Built 2026-11-23** (server only; there is no screen for it). Notes for whoever builds on it:
- The tool is `src/server/db/clearDemo.ts`; the three endpoints are in `routes/admin.ts`; README "Clearing the demo and creating the real team" has the operator's steps and the exact request.
- **Request** (strict: an unknown field is a 400): `{ create: [{ name, username, password (1–200), positions: [built-in keys], locale?, email? }] (0–50), keep?: [usernames or emails] (≤ 50), owner, keepSiteContent: 'contact' | 'all' | 'none', dryRun? (true unless false), confirm? }`. **Answer:** `{ dryRun, confirm, accounts: [{ id, username, email, name, positions: [{ key, name }], owner, active, status: 'created' | 'kept' }], willDelete | deleted: { <table name>: rows }, siteContent: { mode, published, castingCallOpen, kept, links, mainPhoto }, restorePoint? }`.
- **The confirm code** is two halves, `<request>-<plan>`: an HMAC keyed with the ADMIN_TOKEN (the request holds passwords). A wrong first half is 409 `confirm_mismatch`, a wrong second half 409 `plan_changed`. The plan half covers the accounts afterwards, the kept accounts' ids, the row counts and the website content afterwards — not sign-in sessions, sign-in brakes, rate-limit counters and push subscriptions, which change whenever someone signs in.
- **Every table is listed** in `CLEAR_DEMO_TABLES` with what happens to its rows; a new table must be added there (a test walks the schema). At the end of the transaction the row counts are compared with the plan, and a difference rolls the run back.
- **`'all'` keeps the content object** (texts, contact lines, links, main photo, casting call, the public switch). The coaches and the workshops shown are deleted in every mode: a workshop row can't outlive its course, and the coaches were the demo's.
- **The owner** gets the CEO position only when none of its positions is an owner position (CFO or another owner position if the school made CEO an ordinary one; 409 `no_owner_position` if none is left). A kept owner that was deactivated is switched on again.
- **After review (2026-11-23):**
  - The confirm code's plan half also covers the ids of the accounts that go and the last rowid of every emptied table, so a code works **once**: after a run, the same request plans to delete the accounts that run created (new ids) and answers `plan_changed` — a re-sent command can no longer delete the team and bring the temporary passwords back. A record deleted and another added between the dry run and the real run is caught too.
  - The dry run names every account that goes (`willDeleteAccounts`: id, username, email, name, active, owner; the real run answers `deletedAccounts`) and `warnings`: `shared_password` (new accounts sharing one temporary password, compared as scrypt sees them; `owner: true` when an owner's account is one of them) and `replaces_account` (a new account taking the username or email of one that goes). Warnings don't stop the run.
  - `'contact'` also empties the casting call's texts (they are not on the list above; the demo's copy would go public when the call is switched on).
  - `POST /api/admin/restore` asks the runtime first, so local `wrangler dev` answers 501 whatever the body, as Node does.
- **Restore points:** the runtime hands them to the app (`createApp({ restore })`, `lib/restorePoint.ts`). Cloudflare: `src/worker/pointInTimeRecovery.ts` — `GET /api/admin/restore-point` → `{ bookmark, at }`, `POST /api/admin/restore { bookmark } | { minutesAgo: 1–43200 }` → 202 `{ restoringTo, undoBookmark }`, then `ctx.abort()` half a second later. Local `wrangler dev` has no recovery (Cloudflare's docs say so; workerd answers a stand-in bookmark and throws for the rest): 501 `not_supported`, and a run's `restorePoint` is null. So **the restore path has only run against a fake**; its first real use is on the deployment. Node: the database is copied to `$DATA_DIR/app.before-clear-demo.<time>.db` (the database only, not `uploads/`).
- **Release 2 (merged with Part J, 2026-11-23):** the tool knows the cafeteria (see Part J, "Tools"); `positions` may also name `reception` and `office_helper`. Each account's `locale` (default: the school's language) is honoured from the first sign-in — the web app switches to the signed-in person's language before its first screen is painted (`signInLanguage`, `lib/authGate.ts`), so an account created with `"locale": "ar"` sees "Choose your own password" in Arabic.

### The real team (from the school's confirmed positions)

| Name | Username | Position | First password |
|---|---|---|---|
| Ahmed Tamam | `ceo` | CEO (owner) | `tamam123` |
| Abdelrahman Tamam | `cfo` | CFO (owner) | `abdelrahman123` |
| Salma | `salma` | Executive Director | `salma123` |
| Ahmed Abdellah | `ahmed` | Head of Casting | `abdellah123` |
| Ayman Farouk | `ayman` | Head of Casting | `ayman123` |
| Mohamed Hamzawy | `hamzawy` | Casting team | `mohamed123` |
| Taha | `taha` | Casting team | `taha123` |
| Ali El Gohary | `ali` | Video editor | `ali123` |
| Moaty | `moaty` | Acting coach + Finance | `moaty123` |

Each person is asked to choose their own password the first time they sign in. All nine accounts are created in Arabic (`"locale": "ar"` on each), with `"keep": []`, `"owner": "ceo"` and `"keepSiteContent": "contact"`.

**Note (review, 2026-11-23):** the first version of this table gave `ceo` (an owner) and `ahmed` the same first password, `ahmed123`. A temporary password works for whoever types it first, and choosing a password asks for nothing more — so whichever Ahmed signed in as `ceo` first would have held the owner account; the dry run says so (`shared_password`, `owner: true`). **Resolved:** the two Ahmeds now have first passwords of their own (`tamam123`, `abdellah123`), and the dry run of this request answers no `shared_password` warning (rehearsed in local workerd on a database shaped like the live one: its only warning is `replaces_account` for `cfo`: the existing account named `cfo`, the CFO's current one, goes with the others). Hand the owner's first password over in person.

### Tests
- **Usernames:** rules, uniqueness, backfill, sign-in by username and by email, brakes per account.
- **First password:** the forced-change gate on every API route, and its lifting.
- **Team form and profile:** adding a member, changing a username.
- **The tool:** dry-run accuracy, confirm code, plan drift, atomicity, no orphan rows in any table (the test walks the schema), files, owner guarantee, website content modes, token rules, the app working afterwards.
- **`cf:smoke`** covers the whole flow.

---

## Part J — Reception and Office helper positions; cafeteria orders (asked 2026-11-23)

The school asked for two more jobs: **Reception** and **Office helper**. "Office helper is like the cafeteria, so food and beverage are on him." They chose **ordering from the app**. They will explain what Reception does later.

### Positions
- **Two new built-in positions**, with English and Arabic names, that appear once in existing databases as well as new ones:
  - `reception` — "Reception" / "الاستقبال". **No section permissions yet**: it waits for the school's description. A receptionist can already use Team, Messages, Alerts, My profile and cafeteria ordering, and can be called to the office.
  - `office_helper` — "Office helper" / "عامل المكتب". Holds the new permission `cafeteria.serve`.
- **New permission `cafeteria.serve`** ("Serve cafeteria orders and manage the menu"), in a new "cafeteria" group with EN and AR labels. Owners hold it by definition. The Executive Director does **not** get it by default; they can still edit the menu through `settings.manage`.
- **Ordering needs no permission:** every signed-in team member can order. A settings switch, `cafeteriaEnabled` (default on, `settings.manage`), turns the whole feature off.

### Data (one new add-only migration)
- **`cafe_items`:** id, `name_en`, `name_ar`, `category` (`hot` | `cold` | `food` | `other`), `available` (bool), `sort_order`, timestamps.
- **`cafe_orders`:**
  - id, `user_id` (who ordered), `place` (≤ 80), `note` (≤ 200);
  - `status` (`new` | `on_the_way` | `delivered` | `cancelled`);
  - `handled_by_id`, `created_at`, `on_the_way_at`, `delivered_at`, `cancelled_at`.
- **`cafe_order_items`:** id, `order_id` (cascade), `item_id` (nullable, set null), `name_en` and `name_ar` (copied at order time), `qty` (1–10), `options` (≤ 60, e.g. "no sugar").
- **Settings:** `cafeteriaEnabled`, and `cafePlaces` (ordered list of `{ en, ar }` names; defaults Office, Reception, Studio 1, Studio 2).
- **No prices and no tabs.** That was offered and not chosen.

### For everyone: ordering
- **Where:** "Cafeteria" / "البوفيه" in the account / "More" menu of every section, plus an "Order a drink" quick action on each section home.
- **The order screen:**
  - the menu grouped by category, with big rows and − / + buttons; unavailable items are greyed out with "Not available now";
  - "Where should it come?": the places as big buttons plus "Somewhere else" with a short text field; the person's last place is remembered;
  - an optional note;
  - **Send order**.
- **After sending:** the screen shows the order's status in large words: "Sent — waiting", "On the way", "Delivered ✓". "Cancel order" is available while it is still new. Recent orders are listed below with "Order again".
- **Alerts:** the person gets an alert, and a push when alerts are on, when their order is on the way and when it is delivered.
- **Limits:** 10 orders an hour per person, 10 lines per order.

### For the office helper: the orders board
- **His home screen.** He sees no School, Casting or Website section, so the start page for someone with `cafeteria.serve` is the board.
- **New orders** are at the top as big cards: who (photo and name), where, what (quantities, options, note), and how long ago. One big button moves each along: **On the way** → **Delivered**. "Can't do this one" cancels, with a short reason that the orderer sees.
- **New-order alert:** an alert, a push when alerts are on, and a short sound and vibration on the open board where the browser allows it. The board refreshes every 10 seconds while open.
- **Today's delivered and cancelled orders** are listed below.
- **"Menu" tab:** add, rename (EN/AR), reorder (up/down), and switch "Available" on or off per item; a "Places" list editor. When the menu is empty, an "Add the usual items" button creates a default set: tea, coffee, Turkish coffee, Nescafé, green tea, water, juice, soft drink, sandwich, biscuits (EN + AR).

### API (`/api/cafe`)
- **Any signed-in member:**
  - `GET /menu`;
  - `POST /orders`;
  - `GET /orders/mine`;
  - `POST /orders/:id/cancel` (own order, while new).
- **`cafeteria.serve`:**
  - `GET /orders?status=`;
  - `POST /orders/:id/status` `{ status, reason? }`;
  - menu CRUD and ordering.
- **Places:** `PUT /places` (`cafeteria.serve` or `settings.manage`).
- **Counts** for the board badge go through the existing unread poll.
- **Privacy:** orders are visible to the orderer, to people with `cafeteria.serve`, and to owners.

### Tests and checks
- **API tests:**
  - permissions;
  - status rules: only forward, cancel rules;
  - limits;
  - copied names survive an item rename or delete;
  - alerts created for the right people;
  - the feature switch;
  - the new positions exist once in an upgraded database and aren't recreated if renamed.
- **Unit tests:** the board ordering and the order form logic.
- **Tools:** the clear-demo tool and `wipe.ts` must handle the new tables (their coverage tests enforce it); orders are cleared, and the menu and places are kept.
- **`cf:smoke`:** an order from start to delivered.
- **Phone walkthrough** in English and Arabic at 375 px.

### The school's decisions (2026-11-23, after the first build)
Asked after the first build; these override the text above where they differ.
- **D1 — Order alerts go only to the office helper.** New-order alerts and pushes go **only** to the dedicated office helper(s): active people who hold `cafeteria.serve` **and** see no School, Casting or Website section — the same rule that makes the board their start page (`servesFromBoard` in `src/shared/permissions.ts`; the web's `boardIsHome` follows the same section lists, `SECTION_PERMISSIONS`). Owners and anyone else with a section get **no** order alerts, even though they hold the permission; they can still open the board from the Cafeteria entry. New-order alerts already in someone's bell are hidden once they no longer serve from the board (permission taken away, or a section given). The orderer's own alerts (on the way / delivered / can't do) are unchanged.
- **D2 — The Executive Director can create the office helper's account.** The built-in `executive_director` position holds `cafeteria.serve` — in `BUILT_IN_POSITIONS` and, for existing databases, through `BUILT_IN_GRANTS` **version 4** (`{ executive_director: ['cafeteria.serve'] }`) — so the "nobody gives access they don't hold" rule lets her assign the Office helper position and manage his account. Because of D1 she gets no order alerts from it. (This replaces an interim exception that let `settings.manage` reach `cafeteria.serve`; there is no such exception: an owner who removes `cafeteria.serve` from her position takes the office helper's account out of her reach again.)
- **D3 — A monthly consumption page for the owners.** New permission **`cafeteria.report`** ("See monthly cafeteria consumption" / «عرض استهلاك البوفيه الشهري», in the cafeteria group); owners hold it by definition, **no other built-in position gets it** (the Executive Director's list leaves it out). Page **`/cafeteria/report`** — the **Monthly** / «استهلاك الشهر» tab of the Cafeteria pages (on the order screen and the board), and a link on the board for someone whose home it is: a month picker (opens on the current month in the school's time zone; Previous / Next month, no further than the current one), then per person (photo, name, number of orders) the delivered items with quantities for that month, and the total of each item. Cancelled (and still open) orders are not counted; an order counts in the month it was **delivered** (school time zone); deactivated people are still listed for the months they ordered in; an item still on the menu is counted under its current name, one deleted since under the names it had on the orders; **no prices anywhere**. API **`GET /api/cafe/report?month=YYYY-MM`** (`cafeteria.report`; without `month`, the current month), answering `CafeReport` (`month`, `currentMonth`, `people[] { person, orders, items[] }`, `totals[]`, `orders`); aggregated in SQL (a fixed handful of bound parameters, the 100-parameter rule), people read with `loadPersons` in slices. Like every `/api/cafe` route it answers 409 `cafeteria_off` while the cafeteria is switched off.
- **D4 — The live menu starts empty.** Nothing is seeded on the live database; "Add the usual items" stays (one tap fills the ten usual items in both languages).

**Built 2026-11-23.** Notes for whoever builds on it:
- **Positions.** `reception` and `office_helper` are the last two entries of `BUILT_IN_POSITIONS`; `ensureBuiltInPositions` creates each once where its key is missing, so no `BUILT_IN_GRANTS` entry was needed (the latest version is still 3). If the school had already made a position called "Reception" or "Office helper" by hand (same English name in any letter case, or same Arabic name; not an owner position), that one is taken over — it gets the key and what the built-in allows, keeping its people — instead of a second one appearing. The Executive Director holds `cafeteria.serve` since `BUILT_IN_GRANTS` v4 (D2), so she can give both positions; her list leaves `cafeteria.report` out (`EXECUTIVE_DIRECTOR_PERMISSIONS`).
- **One column more than the list above:** `cafe_orders.cancel_reason` — the reason the orderer must be able to read on their order (an alert alone can be marked read and is cleared after 60 days).
- **Menu and places** are edited with `cafeteria.serve` **or** `settings.manage` (that is how "the director can still edit the menu" works); the board and the status buttons need `cafeteria.serve`. Reordering is `POST /api/cafe/menu/order { ids }` (like the website's coaches); "Add the usual items" is `POST /api/cafe/menu/defaults` (409 unless the menu is empty). A name typed in one language only is stored in both.
- **Status moves one step at a time** (new → on_the_way → delivered); a skipped or repeated step, or anything after delivered / cancelled, is a 409 with the order as it is. "Can't do this one" requires a reason.
- **Places** are stored on an order by the configured place's English name and shown in the reader's language; anything typed stays as typed.
- **The switch:** with `cafeteriaEnabled` off every `/api/cafe` route answers 409 `cafeteria_off`; the web app learns it from the poll (`GET /api/chat/unread` → `cafe.enabled`) and shows nothing. Orders, menu and places are kept.
- **Who is alerted about a new order:** only someone who serves from the board (D1, `cafeServers` → `servesFromBoard`). The same people get the board as home and the "orders are waiting" banner on other screens; owners and the director open the board from the Cafeteria entry, where the count of waiting orders shows.
- **A new or existing school starts with an empty menu** (nothing is seeded at startup, D4): the order screen says "The menu is not ready yet" until someone with the Menu tab taps "Add the usual items".
- **After the review (2026-11-23):**
  - *Server.* Switching an account off cancels that person's open orders ("No longer on the team"), off the board and out of every bell. Switching the cafeteria off cancels what is still open ("The cafeteria is closed now"), tells each person who ordered in their language and clears the bells; the Settings switch saves the moment it is turned and asks first before switching off. New-order alerts are hidden from the bell while the cafeteria is off. No two places may share a name (either language, ignoring case and spaces). When a new order is taken or cancelled, the servers' "New order" push is replaced quietly (same tag and topic, `quiet`), and the open board closes such notifications on its phone. Ready-made reasons and the sugar/milk choices are stored by their English words and shown in each reader's language, alerts included.
  - *Order screen.* On a hot drink, **Sugar and extras** has one-tap choices — «سادة» No sugar, «على الريحة» A little sugar, «مضبوط» Medium sugar, «سكر زيادة» Sweet (one sugar level at a time), «باللبن» With milk — that write into the field, which stays editable. The place it will be brought to is always shown above **Send order** ("Bring it to: Studio 1 · Change"); with no place chosen, Send scrolls to the picker. "Somewhere else" is its own flag, so a place called "other" is just a place. Notices ("It is on your order…", "not available now") are said in the sticky bar, never as a toast over it (toasts let taps through everywhere). Cancelling asks "Cancel this order?" with **Keep the order** / **Yes, cancel the order**. Only the latest finished order stays large.
  - *Board.* A coloured status strip on every card (**New order** / **On the way**); the buttons say what the helper does — **I'm taking it now**, then in green **I've delivered it** (the statuses keep the spec's words: On the way, Delivered) — and after any tap every step button rests for two seconds with the cards held in place, so a double tap can't mark an order delivered or take the next one. The ring follows the audio's state (the strip asks for a tap again when the phone took the sound back), repeats once a minute while an order waits untouched, and says what to check when nothing is heard; the screen is kept on; the board offers "Alerts on this phone" (the Profile card) for whoever's home it is. The helper's bottom bar is Orders, Menu, My order (no second row of tabs, no subtitle). Long unbroken words wrap inside the cards.
  - *Menu tab.* "Available now" / "Not available now" in words; name fields in the screen's language first, with "one language is enough" above them; Move up / Move down behind "Change the order" per group; places show "Not saved yet" with a sticky **Save places**, and removing a saved place asks first.
  - *Words.* Arabic: «المنيو» for the menu, «تكرار الطلب», «إضافة … بطريقة مختلفة», «اعتذار عن الطلب», «طلبات جديدة» / «انتهت اليوم», and the other fixes the review listed; English: "Where should we bring it?". Reception's start page says "Here is what you can use". The bell shows a plain bell for an alert kind it doesn't know.
- **Tools.** `db/wipe.ts` (the demo reset) deletes the three tables with everything else (`WIPE_ORDER`, checked against the schema by a test). The clear-demo tool of Part I (merged with this part in release 2, 2026-11-23) deletes `cafe_order_items` and `cafe_orders` (orders point at accounts) — counted in the dry run and covered by the confirm code like every emptied table — and every alert, the cafeteria's included; it keeps `cafe_items` (`stay`) and the places and the switch (settings). The migration is `0008_cafeteria`, after Part I's `0007_usernames` (found by its tag in the tests).
- **Not built (not asked):** prices and tabs; order history beyond a person's last 20, the board's "today" and the owners' monthly page; a time-out for an order nobody takes (it stays on the board until someone moves or cancels it).

---

## Part K — "Add" everywhere, and a casting Opportunities list the team fills in (asked 2026-11-23)

The school asked for two things:
- "anything like casting opportunities or workshops etc. needs some sort of add button, so if they want to add new opportunities they can";
- "see whatever you think needs an add button and add it".

Built **after Parts I and J are merged**, because it touches the same screens. One new add-only migration.

### K1. Opportunities (Casting section) — added by hand, no AI
The radar (Part E) is on hold until the school confirms the AI pack. The **list** it would have filled is useful by itself, so the team adds opportunities when they see them on Instagram, Facebook, WhatsApp groups or a website. If the radar is built later, it writes into this same list.

- **Data:**
  - `casting_opportunities`:
    - id, `title`, `details`;
    - `project_type` (`film` | `series` | `ad` | `theatre` | `music_video` | `online` | `other`);
    - `roles` (free text ≤ 1000), `location`, `deadline` (YYYY-MM-DD or null), `contact` (text);
    - `link` (http/https only), `source` (free text ≤ 120, e.g. "Instagram — Frame Casting");
    - `asks_for_payment` (bool), `involves_minors` (bool);
    - `status` (`new` | `interested` | `applied` | `dismissed`);
    - `casting_id` (FK castings, set null);
    - `created_by_id`, `reviewed_by_id`, timestamps.
  - `casting_opportunity_files` (id, `opportunity_id` cascade, `file_id`, `sort_order`): up to 3 screenshots or photos per opportunity. Add them to `FILE_REFERENCES`.
- **Permissions:**
  - `castings.read` sees the list;
  - `castings.write` adds, edits, changes status, deletes and turns one into a casting. Screenshots follow the same permission.
- **API `/api/opportunities`:**
  - list (`?status=&q=`), get, create, patch, delete;
  - `POST /:id/to-casting`: creates a casting prefilled with title, details, deadline, and link and contact in the notes; links it; answers `{ castingId }`.
  - The dashboard gains `newOpportunities`.
- **Screens:**
  - **`/casting/opportunities`:**
    - tabs New / Interested / Applied / Dismissed, with counts;
    - cards showing title, project type, deadline (red when within 3 days, "Closed" when past), roles, source, and the first screenshot as a thumbnail;
    - a red **"Asks for money — be careful"** flag when `asks_for_payment` is set;
    - buttons **Open the post**, **Interested**, **Applied**, **Not for us**, **Turn into a casting**.
  - **"Add opportunity":** a short form made for a phone. Title, where you saw it, the link (optional), screenshots from the gallery or camera, deadline, roles, contact, the two checkboxes, and notes. Only the title is required.
  - **Navigation:** an entry in the Casting section's menu with a count badge of new ones, a Casting home card "N new opportunities", and "Add opportunity" among the Casting home's quick actions.
- **Demo seed:** five realistic opportunities in Arabic and English, one of them flagged as asking for money.

### K2. A clear "Add" on every screen that has something to add
One consistent pattern, so nobody has to hunt for it:
- **List screens:** a labelled primary button, "+ Add …" ("+ Add student", "+ Add workshop", …). On phones it is a **fixed button at the bottom-end, above the tab bar**: at least 48 px, icon plus words, never covering the last row, the chat composer, form action bars or the call-to-the-office banner. On desktop it sits in the page header.
- **Empty lists** show the same action inside the empty state ("No students yet — Add the first one").
- **Inside a record:** each sub-list has its own "+ Add …" at the top of that block. For example: a workshop's sessions, students, and photos & files; a casting's roles, submissions and files; an enquiry's contact log and interviews; a talent's photos; a student's workshops; the website's coaches and links.
- **Section homes:** quick-action tiles for the most common additions, each shown only with the permission:
  - School: New enquiry, New student, New workshop;
  - Casting: New talent, New casting, Add opportunity;
  - Website: Add coach, Add link.
- **The work:** audit every list and every record page in the app. Where a create action exists but is hidden, far away or icon-only, bring it into this pattern. Where a create flow is missing but the data model supports it, add it. Report anything that needs a product decision instead of guessing. Candidates to check:
  - adding an extra session to a workshop from the schedule;
  - enrolling a student from the student's own page;
  - adding a student straight from a workshop;
  - adding a follow-up from the enquiries list;
  - adding a custom position;
  - adding a place for the cafeteria.
- **Permissions:** an Add button never appears for someone who would be refused by the API.

### Tests and checks
- **API tests** for opportunities: permissions, link validation, to-casting, files freed on delete, dashboard count.
- **A unit test over the route table** that fails when a list route has no registered "add" action or an explicit "nothing to add here" mark.
- **`cf:smoke`:** an opportunity from add to casting.
- **Phone walkthrough** at 375 px in English and Arabic, checking that the fixed Add button never covers content or other fixed bars.

### Built (2026-11-23) — and what waits for the school
- **K1** as above, plus: a new opportunity turned into a casting moves to *Interested* (someone has looked at it); its screenshots are copied into the casting's files; the casting's notes carry the roles, link, contact and where it was seen, written in the language of the person who turned it. Migration `0009_opportunities` (add-only, two tables).
- **K2**: one component (`components/ui/AddAction.tsx`), one table of what every screen adds (`layout/addActions.ts`, checked against the route table by `tests/unit/add-actions.test.ts`). Built from the candidates: an extra session from the School schedule (pick the workshop, then the workshop's own session form); enrolling a student from the student's page ("+ Add to a workshop"); a **new** student from a workshop's "Add student" (created, then enrolled there); "Set follow-up" on each open enquiry in the list; "+ Add a place" and "+ Add item" at the top of their blocks on the cafeteria's Menu page; adding a custom position already existed and now follows the pattern. Also "+ Log a contact" / "+ Add interview" at the top of an enquiry's blocks, "+ Add talent" at the top of each role's submissions, 48 px everywhere.
- **Needs a product decision (not built):**
  - Coaches have no Add for students or sessions on their own workshops (they hold neither `students.write` nor `courses.write`). Should a coach add a student to their own workshop, or an extra session?
  - Reception has no permissions yet, so no Add anywhere. Should Reception add enquiries (`admissions.write`)?
  - Workshops on the website: someone with only `website.manage` can't create a school workshop. The list says where workshops are added; a "+ Add workshop" there would need `courses.write` too.
  - The Casting schedule has nothing to add: an audition belongs to a talent's submission on a role. Booking one from the schedule would need a three-step picker (casting, role, talent).
  - Casting applications only come from the website form. A walk-in is added as talent. Should the team hand-enter applications too?
  - "Turn into a casting" doesn't create roles from the free-text roles; they are copied into the casting's notes. Should it try?
  - Messages are one-to-one; a group conversation would need a data-model change.
  - The interview criteria's move/remove icons in Settings are still 32 px (outside this part).
- **At the merge with Part L:** the video routes (`videos`, `videos/:id`) must be added to `SCREENS`, or the route-table test fails. Suggested: the queue is a list with nothing to add (videos are added from a session's or workshop's "Videos" block); the session page's `subLists` gains "Videos — + Add video (videos.add, class scope)".

---

## Part L — The video pipeline: coach → editor → reviewer (asked 2026-11-23)

The school described the flow:
- coaches record in class and put the link for the video editor, who works on it the next day;
- when the editor is done, he marks it;
- **Moaty checks every edit** for mistakes, so he must be notified when an edit is finished.

This is the roadmap's "Editors' queue" (step 11), built now in its first form. **Videos are links** (Google Drive, WeTransfer, YouTube unlisted, …): the app stores no video, so it stays at $0 and needs no R2.

### Positions and permissions
- **`videos.add`** — "Add class videos for the editor". Built in for `acting_coach` and `executive_director` (BUILT_IN_GRANTS, next version). A coach adds videos only to sessions they can see (class scope, `lib/access.ts`).
- **`videos.edit`** — "Edit videos (the editor's queue)". Built in for `video_editor`.
- **`videos.review`** — "Check finished edits". Held through a new built-in position, **Video reviewer** / «مراجع الفيديو», which holds `videos.review` and `videos.read`. Moaty is given it on top of his two positions.
- **`videos.read`** — see the pipeline (read-only). The Executive Director gets it built in. Owners hold everything.
- **Who is alerted** (like the cafeteria's rule, never the owners unless they act):
  - a finished edit → every active holder of `videos.review` **who is not an owner**;
  - "needs changes" → the editor who did it (or every holder of `videos.edit` if unassigned);
  - "approved" → the coach who added the video;
  - a new video → every active holder of `videos.edit` who is not an owner.
- **Existing database:** the new position appears once (`ensureBuiltInPositions`). The grants are applied once.

### Data (one add-only migration)
- **`videos`:**
  - id, `course_id` (FK, cascade), `session_id` (nullable FK `class_sessions`, set null), `title` (≤ 120);
  - `kind`: `scene` | `monologue` | `exercise` | `showreel` | `performance` | `other`;
  - `raw_link` (http/https, ≤ 1000), `notes_for_editor` (≤ 1000), `due_on` (YYYY-MM-DD; default the day after it is added, school clock);
  - `status`: `new` | `editing` | `in_review` | `changes_requested` | `approved`;
  - `added_by_id`, `editor_id` (who took it), `reviewer_id` (who decided);
  - `edited_link` (http/https, ≤ 1000), `editor_notes` (≤ 1000);
  - `taken_at`, `submitted_at`, `decided_at`, timestamps.
- **`video_students`:** `video_id`, `student_id`, unique pair (who appears in it).
- **`video_events`:** id, `video_id`, `user_id`, `type` (`added` | `taken` | `submitted` | `changes_requested` | `approved` | `reopened` | `comment`), `note` (≤ 1000), `link` (nullable), `created_at` — the history shown on the video page, like an enquiry's timeline.
- Add every new table to `CLEAR_DEMO_TABLES` and `WIPE_ORDER`; their coverage tests enforce it.

### The flow (status machine; every move is an `UPDATE … WHERE status = <read>`)
- **`new`** → **`editing`**: the editor taps "Start editing"; `editor_id` is set.
- **`editing`** → **`in_review`**: "Done", with the edited link (required) and optional notes. This alerts the reviewer(s).
- **`in_review`** → **`approved`**: the reviewer taps "Approved". This alerts the coach who added it.
- **`in_review`** → **`changes_requested`**: the reviewer taps "Needs changes", with a note (required). This alerts the editor.
- **`changes_requested`** → **`editing`**: the editor taps "Start fixing", then submits again, which goes back to `in_review`.
- **Other moves:**
  - The coach who added a video (or `videos.review`, or an owner) may edit its title, links, notes, students or due date while it is `new`, and may delete it while `new`.
  - `approved` can be reopened by the reviewer, with a note, back to `changes_requested`.
  - Any participant can add a **comment** to the history.

### Screens
- **On a session's page** (and a workshop's): a **"Videos"** block with **"+ Add video"**. The form asks for:
  - the title, prefilled with "<workshop> — <date>";
  - the kind;
  - the raw footage link;
  - the students in it, picked from the session's students as big checkboxes;
  - notes for the editor;
  - the due date (tomorrow).

  The block lists the session's videos with their status in words.
- **Video queue** (`/videos`, School section; menu entry "Videos" / «الفيديوهات» with a count badge):
  - **The editor sees:** tabs "To edit" (new + changes requested, due first, overdue in red, changes requested on top with the reviewer's note shown), "Editing" (his), "Waiting for check", and "Approved".
  - **The reviewer sees:** "To check" first (each card shows the edited link as a big **"Watch the edit"** button, the editor's notes, and two big buttons, **Approved ✓** and **Needs changes**), then the rest.
  - **Coaches** see the videos they added and their status.
- **Video page** (`/videos/:id`): everything above, the students (links to their pages), both links as "Open raw footage" / "Watch the edit", the history timeline, the next-step button for the viewer's role, and comments.
- **Section homes:** a School home card for each role:
  - editor: "N videos to edit (M due today)";
  - reviewer: "N edits to check";
  - coach: "N of your videos approved this week".
- **The editor's start page:** someone with `videos.edit` and no other section permission lands on the queue. The Video editor position today has talent read-only, so Casting is visible; keep his School section with the queue first in his bottom bar.
- **Every string in EN + AR**, 375 px, 48 px targets, plain words. The links open in a new tab, `rel="noopener noreferrer"`, and their host is shown.

### API (`/api/videos`)
- `GET /` with `?status=&mine=&courseId=&sessionId=`; `GET /:id`; `POST /` (`videos.add`, class scope); `PATCH /:id` (while `new`); `DELETE /:id` (while `new`).
- `POST /:id/take`, `POST /:id/submit { editedLink, notes? }` (`videos.edit`).
- `POST /:id/approve`, `POST /:id/request-changes { note }`, `POST /:id/reopen { note }` (`videos.review`).
- `POST /:id/comments { note }` (participants: the adder, the editor, reviewers, owners).
- **Counts** for the badges go in the existing unread poll.
- **Visibility:**
  - `videos.read`, `videos.edit` and `videos.review` see every video;
  - a coach sees the videos of workshops they can see;
  - students' names follow the existing student scope rules.

### Tests
- **API:** permissions; class scope for coaches; the status machine (every allowed and refused move, double taps); link validation (http/https only); who is alerted at each step (never owners); the history; counts in the poll.
- **Positions:** the Video reviewer position and the grants on an upgraded database.
- **Tools:** clear-demo and wipe coverage.
- **Unit:** the queue's ordering (changes requested first, then due date) and which buttons each role sees.
- **`cf:smoke`:** add → take → submit → changes requested → submit → approved.
- **Demo seed:** a few videos in each state.
