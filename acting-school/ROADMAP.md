# Roadmap

What the school asked for, in the order we plan to build it. Phase 1 (the basics) is being built now; everything below is phase 2 onward. Update this file as decisions are made.

## Decisions so far

- **Users:** staff only in phase 1. Students get their own section in phase 2 (see "Student section").
- **Who sees what:** the owner, Ahmed Tamam, and his father (the council) see everything. Every other employee sees and does only what their position allows. The real positions are still to be confirmed by the school; known so far: Salma (office manager — interviews new students and chooses each student's coach), acting coaches, video editors.
- **Languages:** English + Arabic (right-to-left). Arabic uses Western digits.
- **Budget:** $0. The only paid piece is the AI model: **Claude Haiku**, pay per use (estimated $1–5/month at the school's size). Everything else uses free tools (Google Sheets / Forms / Apps Script, Gmail, wa.me WhatsApp links, Google Drive).
- **Requests arrive today via:** Google Sheets, WhatsApp, email.
- **Hosting:** not decided. The app is one Node process + one data folder, so it can run on a free server (e.g. Oracle Cloud Always Free) or an always-on computer at the school.

## Phase 2 — in build order

1. **Positions & permissions.** Replace the four fixed roles with positions the owners create and edit (checkbox per permission). Owners are fixed and see everything. Default positions until the school confirms: Office manager, Acting coach, Video editor, Casting agent.
2. **Admissions.** Leads (people asking about classes, from WhatsApp / email / Sheets / forms) → interview with Salma (notes + assessment) → Salma picks the coach and class → enrolled student. Follow-up reminders so no lead is forgotten.
3. **Import from Google Sheets.** Upload a CSV/Excel export, match columns to fields (students, actors, leads). Optional automatic sync of new rows through a free Google Apps Script.
4. **Coach rankings.** Coaches score their students on criteria (editable list), with notes and history; progress over time; top students surface for castings.
5. **Actor database + "Find actors for a role".** Everyone who passes through is kept (represented, freelancers, auditioned once). Search by filters or by describing the role in plain Arabic/English (Claude Haiku turns the description into filters + ranked matches). Includes top-ranked students.
6. **Actor profile cards.** One tap makes a shareable profile (headshots, measurements, skills, showreel link) to send to casting directors.
7. **AI secretary.** One inbox for requests from the app, email and Google Sheets (free Apps Script connector) and WhatsApp (forwarded/pasted — reading WhatsApp automatically costs money). The AI summarizes in both languages, labels type and urgency, suggests who handles it; routing follows the positions above (flow to be confirmed with the school; Salma is the first stop for many requests). Replies via pre-written wa.me links.
8. **Casting tracker.** The school lists casting sources (websites, public channels); a scheduled job checks them, Claude Haiku extracts each casting call, and each one gets an automatic shortlist of matching actors. Facebook/Instagram posts can't be read automatically for free: staff paste them and the AI extracts the details.
9. **Tuition & payments.** Fees per class, who paid / who owes, overdue list, WhatsApp reminder links to parents. Tracking only — no card payments.
10. **Video editors' work queue.** Tasks (showreels, self-tapes, class footage) with deadlines, status, Google Drive links.
11. **Student section.**
    - **Sign-in at $0:** a personal link sent by WhatsApp from the app (wa.me, pre-written) plus a short PIN. No email or SMS codes (they cost money; many students only have a phone).
    - **What students see:** coach notes the coach marks "visible to student"; their scores and progress over time; highlights the coach picks (best moments, clips, photos); attendance, schedule, homework (monologues, scenes). Seeing their rank against classmates is off unless the owners turn it on.
    - **End-of-course pack:** one private page per student with their showreel, the photos the agency took, certificate and final coach feedback — everything downloadable. Unguessable link, can be revoked. Media of a student only goes in their pack if their photo/filming consent is recorded (minors: guardian consent).
    - **Video storage at $0:** photos are stored in the app; videos are linked from Google Drive (download button on the student's page) until hosting is chosen. With a free server with large disk, editors can upload videos directly instead.

## Waiting on the school

- The real positions and who sees/does what.
- A sample Google Sheet they use today (CSV/Excel export), to map the import.
- The casting sources to watch (sites, pages, channels).
- An Anthropic account with a small prepaid credit (the key is added through a secure form, never pasted in chat).
- What Salma assesses in interviews and what coaches rank on (defaults used until then).

## Ideas backlog

100 more enhancement ideas were brainstormed and published as an interactive board where the school marks Want / Maybe / Skip. Picks from that board get added here.
