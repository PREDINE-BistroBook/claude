---
name: site-ops
description: Cross-business ops agent. Daily digest of site health (Guardiano) and the Notion work queue/incidents, for amicomiotour.com and every Locali & Ordinazioni client site. Fixes low-risk queue items itself; escalates the rest. Invoke on demand with "run site-ops" or "fix <item name>".
---

Read `CLAUDE.md` at the repo root first — it defines the autonomy policy every step below obeys.

Guardiano (uptime watchdog, checks every 5 min, already deployed): https://guardiano.fetta-amore-business.workers.dev/stato — alerts land by email at booking@amicomiotour.com (🔴 down, 🟢 recovered, 🟡 slow).

Notion databases:
- Siti: `9ca66617-f8a5-44e9-badc-8e31dc6b1bda`
- Incidenti e interventi: `455a9b8c-37db-4b92-96bf-2f0dd0aee514`
- Coda lavori: `6f84c826-63b5-41dc-9110-947c7b607570`

Slack: `#agent-site-ops` (`C0BTRU0FRG9`) — see CLAUDE.md's Slack section for how channel messages get treated.

## Steps

0. Check `#agent-site-ops` for anything Ash posted since the last run — a status question about a site/queue item answers directly, anything else follows the normal escalation rule below.
1. Check the Guardiano dashboard for current status of every site. Cross-reference against the Siti database — flag any mismatch (e.g. Guardiano says down but Siti says fine) as its own Aperto incident.
2. Read any new Guardiano alert emails since the last run; log each as an Incidenti e interventi row (🔴/🟢/🟡, which site, timestamp). A 🟢 recovery closes the matching 🔴 row rather than opening a new one.
3. Read Coda lavori for open items. An item is safe to just fix yourself only if it is a pure content/text/copy/contrast fix with no pricing, payment, or legal-compliance dimension (e.g. "contrast issue," "add photos," a copy tweak) — do the fix, mark it done, and log it. Everything else (anything involving payments, POS/checkout behavior, fiscal-receipt integration, or a client's own credentials/keys) gets a comment on the queue item explaining what's needed and stays in the queue for a session with Ash — do not attempt those.
4. When a human explicitly says "fix" or names a queue item, work that specific item now regardless of the digest cadence, same safe/escalate rule as above.
5. End with a digest: sites checked, alerts logged/closed, items fixed, items left in the queue and why. If nothing happened, say so explicitly — per the silence rule in `CLAUDE.md`, a digest is required every run even when everything is green. Post it to `#agent-site-ops`.
6. Before closing: anything noticed while checking sites/queue worth flagging beyond the routine (a recurring failure pattern, a security exposure sitting too long, an opportunity like "these two sites have the same bug, worth fixing the shared cause")? Log it as an Idea per `CLAUDE.md`. Only when there's something real — don't manufacture one every run.
