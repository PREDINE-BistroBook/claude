# Roadmap

What the school asked for, in the order we plan to build it. Update this file as decisions are made.

**Phase 1 (the basics) — done (2026-11-22):** staff sign-in, students, classes with weekly schedules, attendance, actor roster with photos, castings with roles and submissions, combined schedule, home dashboard, staff and settings. English + Arabic, phone and desktop, demo data (`npm run seed`). Everything below is phase 2 onward.

**Phase 2, step 1 (positions & permissions) — done (2026-11-23):** the positions below are built in, editable on the Positions page, and enforced by the server; reviewed for security (23 issues found and fixed, each with a test).

**Phase 2, step 2 (admissions) — done (2026-11-23):** enquiries, follow-ups, interviews scored on editable criteria, coach and class choice, one-step enrolment, WhatsApp/call buttons; reviewed (12 issues found and fixed, each with a test).

**Phase 2, step 3 (go-live essentials) — started (2026-11-23):** the app is live on the school's Cloudflare plan at https://claude.hashesha.workers.dev with demo data (one Worker, one Durable Object holding the database; reviewed: 10 issues found and fixed before going live, including a setup code so nobody else can claim an empty school). "Classes" are now called **Workshops / ورش** on screen.

**Phase 2, step 3 — three sections + the public website — done (2026-11-23):** the staff app is split into **School / Casting / Website** with tabs at the top (own colour, home and menu per section; a coach sees School only), made for older users (48 px buttons, labels next to icons, plain words). The **Website** section runs a public website in English and Arabic — workshops with an apply form (enquiries land in Admissions with source "website"), a casting call with photos (Casting › Applications → "Add to roster" creates the talent profile), about & coaches, and a link-in-bio page (#60). No prices anywhere (the school's decision): "Ask about fees on WhatsApp" instead. Protected without captchas (form token, hidden trap field, rate limits, size limits). The website is at the root of **turquoisestudio.app** (www redirects there) and the staff app at **staff.turquoisestudio.app**; the same pages stay reachable at `/site/en` and `/site/ar` on the app's address as previews. Reviewed before going public (2026-11-23): 32 findings and 9 follow-ups fixed, each with a test where it can be tested — among them: junk requests can no longer use up the school's daily form allowance, mistakes in a form no longer lock an honest applicant out, a parent's second child becomes a lead of their own, the guardian's phone stays behind the contact permission, and an applicant's photos can always be deleted for good. Spec: `docs/SECTIONS_AND_WEBSITE.md` (Parts A–D).

**Next:** the opportunity radar, the AI pack (built switched off until the school says so), the team pack and studio email addresses (`docs/SECTIONS_AND_WEBSITE.md` Parts E–H); then the rest of step 3 — nightly backup (#88), change history with undo (#99), the notification bar (#89), staff leaving checklist (#94), vetting folder (#92). Then step 4 (Sheets import).

## Decisions so far

- **Users:** staff only in phase 1. Students get their own section in phase 2 (see "Student section").
- **Who sees what:** confirmed by the school (2026-11-22) — see "Positions" below. CEO and CFO see everything; Salma (Executive Director) manages everything below them; everyone else sees and does only what their position allows. One person can hold several positions (their permissions add up).
- **The business:** Turquoise Studio (Turquoise Casting Studio, Giza). Workshops (ورش) with named coaches, international intensives, long cohort programmes (دفعة) ending in a graduation show, and a casting agency (separate phone lines for workshops and casting). The app uses its name, black + turquoise colours and the turquoise "T" (interim drawing until the original logo file arrives).
- **Languages:** English + Arabic (right-to-left). Arabic uses Western digits.
- **Budget:** $0. The only paid piece is the AI model: **Claude Haiku**, pay per use (estimated $1–5/month at the school's size). Everything else uses free tools (Google Sheets / Forms / Apps Script, Gmail, wa.me WhatsApp links, Google Drive).
- **Requests arrive today via:** Google Sheets, WhatsApp, email.
- **No prices on the website or in the app (2026-11-23):** people ask about fees on WhatsApp instead.
- **The studio's domain (2026-11-23):** `turquoisestudio.app` — the public website at its root (www redirects there), the staff app on `staff.turquoisestudio.app`.
- **Hosting:** the school's Cloudflare plan (asked 2026-11-23; live the same day). One Worker named `claude` (the one connected to GitHub) at the free address https://claude.hashesha.workers.dev; the whole database lives in one Durable Object with 30 days of point-in-time recovery. Photos are stored in the database for now; videos and bigger files move to Cloudflare R2 once R2 is switched on in the account. A custom address (e.g. app.<the studio's domain>) can be added later. Deploys: automatically on every push once the Workers Builds settings are filled in on the dashboard; until then from the cloud session.

## Positions (confirmed by the school)

| Position | People | Can see / do |
|---|---|---|
| **Owner** (CEO, CFO) | Ahmed Tamam (CEO), Abdelrahman Tamam (CFO) | Everything, including staff accounts, positions and all money. |
| **Executive Director** | Salma | Everything operational, and manages staff accounts and positions — **except**: money is limited to each student's payment status (who paid / who owes; no totals, revenue or commissions); the CEO and CFO accounts are hidden from her and untouchable; she can never grant anyone a permission she doesn't hold herself. Runs admissions interviews and picks each student's coach; first stop for requests; may send actor profiles to clients. |
| **Head of Casting** | Ahmed Abdellah, Ayman Farouk | Full actor database and castings; send actor profiles to clients; see coach scores and students (to spot talent). |
| **Casting team** | Mohamed Hamzawy, Taha | Add and update actors, build shortlists for the heads. Cannot send to clients. |
| **Video editor** | Ali El Gohary | Editors' work queue; add photos/videos to student packs and actor profiles; sees names and photos only (no contact details, no money). |
| **Acting coach** | Moaty, plus more coaches (names to come) | Only their own students and classes: attendance, notes (each note can be marked "visible to student"), scores, highlights. |
| **Finance** | Moaty | Tuition, payments, reminders, totals, commissions; student/guardian contact details for reminders. |

Rules that hold for every position: owner accounts are visible and editable only by owners; nobody can give someone (or themselves) a permission they don't hold; holding two positions (Moaty: coach + finance) combines both.

## Phase 2 — in build order

Updated 2026-11-23 with the school's picks from the Idea Board. The numbers in brackets (#n) are ideas from `docs/IDEAS.md`. Each one is built with the step it extends.

1. ✅ **Positions & permissions.** Replace the four fixed roles with the positions above, editable as checkboxes per permission by owners (and by the Executive Director within her own limits). A person can hold several positions.
2. ✅ **Admissions.** Leads (people asking about classes, from WhatsApp / email / Sheets / forms) → interview with Salma (notes + assessment) → Salma picks the coach and class → enrolled student. Follow-up reminders so no lead is forgotten.
   - Picked ideas, right after the core: referral codes and bring-a-friend days (#22); cold lead revival and win-back (#54) — the daily follow-up list first, AI-written messages once the AI key is in; free trial class booking page (#2) — a public page, so it needs hosting.
3. **Go-live essentials** *(new — before the school puts real data in)*. Move the app onto the school's Cloudflare plan. Nightly backup with restore test (#88); change history with one-tap undo (#99); unusual activity alarms (#89) as an **in-app notification bar** as the school asked, not Telegram; one-button staff leaving checklist (#94); staff vetting folder with expiry alerts (#92).
4. **Import from Google Sheets.** Upload a CSV/Excel export, match columns to fields (students, actors, leads). Optional automatic sync of new rows through a free Google Apps Script.
5. **Coach rankings.** Coaches score their students on criteria (editable list), with notes and history; progress over time; top students surface for castings.
   - Picked ideas: Kombars-to-Batal level ladder (#13); voice notes become coach evaluations (#11); exam day jury mode (#18); session log and lesson library (#19); pre-class coach briefing card (#97).
6. **Actor database + "Find actors for a role".** Everyone who passes through is kept (represented, freelancers, auditioned once). Search by filters or by describing the role in plain Arabic/English (Claude Haiku turns the description into filters + ranked matches). Includes top-ranked students.
   - First AI feature, so it ships with the AI spending meter and monthly cap (#84): the owners set a limit (e.g. $5) and the AI stops at it.
   - Picked ideas: dialect passport and verified skills (#32); travel-ready board for Gulf jobs (#42); Actors' Syndicate permit tracker (#93); family and look-alike group finder (#33); voice-over and dubbing talent line (#34); book-out and holds calendar (#41).
7. **Actor profile cards.** One tap makes a shareable profile (headshots, measurements, skills, showreel link) to send to casting directors.
   - Picked ideas: casting director pick-list link (#30); monthly New Faces lookbook (#45).
8. **AI secretary.** One inbox for requests from the app, email and Google Sheets (free Apps Script connector) and WhatsApp (forwarded/pasted — reading WhatsApp automatically costs money). The AI summarizes in both languages, labels type and urgency, suggests who handles it; routing follows the positions above (flow to be confirmed with the school; Salma is the first stop for many requests). Replies via pre-written wa.me links.
   - Picked ideas: reply drafts from the fact sheet (#79); council approval inbox for the owners (#96); interview co-pilot for Salma (#6).
9. **Casting tracker & bookings.** The school lists casting sources (websites, public channels); a scheduled job checks them, Claude Haiku extracts each casting call, and each one gets an automatic shortlist of matching actors. Facebook/Instagram posts can't be read automatically for free: staff paste them and the AI extracts the details.
   - Picked ideas: casting rush board with Ramadan mode (#38); script-to-roles breakdown in one click (#28); one-tap "Are you free?" check (#81); extras booking desk (#40); host casting days at the school (#35); one-tap guardian consent per job (#23); chaperone gate for child jobs (#86); ad usage-rights and exclusivity watchdog (#66); contracts filled from the record (#43).
10. **Tuition & payments.** Fees per class, who paid / who owes, overdue list, WhatsApp reminder links to parents. Tracking only — no card payments.
    - Picked ideas: one price list, approved discounts only (#67); numbered receipts that can't vanish (#68); attending-but-unpaid student alerts (#64); payment screenshot reader with copy guard (#63); end-of-day cash closing (#69); expenses, custody and accountant pack (#70); one-click next-term renewals (#1).
11. **Video editors' work queue.** Tasks (showreels, self-tapes, class footage) with deadlines, status, Google Drive links.
    - Picked ideas: children's photo and clip protection (#87) — nothing is marked "OK to post" without the right consent; footage library searchable by student (#49); guided self-tape recorder (#48); monthly content shoot-day planner (#53); Day 1 vs today progress reels (#47); monthly class highlight for parents (#25).
12. **Student section.**
    - **Sign-in at $0:** a personal link sent by WhatsApp from the app (wa.me, pre-written) plus a short PIN. No email or SMS codes (they cost money; many students only have a phone).
    - **What students see:** coach notes the coach marks "visible to student"; their scores and progress over time; highlights the coach picks (best moments, clips, photos); attendance, schedule, homework (monologues, scenes). Seeing their rank against classmates is off unless the owners turn it on.
    - **End-of-course pack:** one private page per student with their showreel, the photos the agency took, certificate and final coach feedback — everything downloadable. Unguessable link, can be revoked. Media of a student only goes in their pack if their photo/filming consent is recorded (minors: guardian consent).
    - **Video storage at $0:** photos are stored in the app; videos are linked from Google Drive (download button on the student's page) until hosting is chosen. With a free server with large disk, editors can upload videos directly instead.
    - Picked ideas: homework self-tapes (#14), sent through the student page or a Google Form; shareable bilingual certificates (#26) in the end-of-course pack.

## Phase 3 — the school's other picks

13. **Money & owner insights.** Coach and editor payroll in one tap (#65); 90-day cash forecast (#74); profit map by class, coach and talent (#72); booking scoreboard and rising stars (#73); staff performance scorecards, owners only (#77). These come after steps 10–11 because they read attendance, payments, bookings and the editors' queue.
14. **Marketing.** Egyptian-season content calendar (#59); our students on screen (#55); ✅ self-updating link-in-bio page (#60) — built with the public website (2026-11-23).
15. **Calendar & weak signal.** Ramadan, Eid and exam-aware timetable (#10); basement mode for weak signal (#95) — the day's classes and lists saved on the phone, attendance and notes kept offline and sent when the signal returns.

## Idea Board decisions (2026-11-23)

- **Want (58):** all placed in the steps above.
- **Telegram:** not used for staff. The school skipped the staff Telegram bot (#98) and asked for an in-app notification bar instead of Telegram alarms (#89). Where someone outside the app must answer (an actor for "Are you free?" #81 or an extras call #40, a student sending homework #14), they get a pre-written WhatsApp message with a link to a one-tap answer page. A free Telegram bot or channel stays an option if the school wants one later.
- **Maybe (34) — kept for later, not scheduled:** best class and coach suggestion (#4); success stories screen for interviews (#5); open day and intake audition mode (#7); makeup class finder (#8); one-tap substitute coach (#9); monthly parent progress letter (#20); dropout early warning with check-in draft (#21); end-of-term showcase planner (#24); alumni mentor matching (#27); ready-for-roster gate and handoff (#29); showcase night that books actors (#31); headshot auto-tagger and quality check (#36); casting director relationship book (#37); booking message to call sheet (#39); actor's private status page (#44); Booked! story drafted automatically (#50); digitals day and look-change tracker (#51); showreel brief writer for editors (#52); Google review booster (#56); weekly post ideas with safe captions (#57); testimonial bank and quote cards (#58); follower counts on actor profiles (#61); booking money ledger and fee guide (#62); weekly council brief you can question (#71); roster gap and season report (#75); which posts bring paying students (#76); end-of-term survey summaries (#78); screenshot a DM, get a lead (#80); pitch note for every submission (#82); plain-Arabic contract explainer (#83); casting scam and child-safety screen (#85); safe pickup for kids' classes (#91); nightly data tidy-up list (#100). (#89 moved up to step 3 as a notification bar.)
- **Skip (8) — not doing:** smart waitlist with automatic offers (#3); every audition teaches something (#12); AI scene partner on the phone (#15); monologue matchmaker and shared library (#16); dialect and Fusha practice gym (#17); showreel gap finder and paid shoots (#46); shoot-day check-ins with overtime proof (#90); Telegram helper bot for staff (#98).

## Waiting on the school

- Names of the other acting coaches.
- A sample Google Sheet they use today (CSV/Excel export), to map the import.
- The casting sources to watch (sites, pages, channels).
- An Anthropic account with a small prepaid credit (the key is added through a secure form, never pasted in chat).
- What Salma assesses in interviews and what coaches rank on (defaults used until then).
- Attaching `turquoisestudio.app` and `www.turquoisestudio.app` (the website) to the Worker — decided 2026-11-23 (`staff.turquoisestudio.app` is already attached); a deploy step with the owner's approval.
- The studio's original logo file, the real "about" text and coach bios for the website (the demo texts are placeholders to edit in Website › Studio & contact and Coaches).
- The Workers Builds settings on the Cloudflare dashboard (root directory `acting-school`, build `npm run build`, deploy `npx wrangler deploy`), so every push updates the live app.
- Switching on R2 in the Cloudflare account (free tier), for videos.

## Ideas backlog

The 100 ideas are described in `docs/IDEAS.md` and on the interactive Idea Board (https://claude.ai/artifact/SV4PHBRaWH7aG4wBYD4Q1Y). The school's picks are placed above ("Idea Board decisions"); if picks change on the board, update this file.
