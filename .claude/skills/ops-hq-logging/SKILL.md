---
name: ops-hq-logging
description: Use at the end of every agent run (scheduled or on-demand) to log outcomes to the shared Notion Ops HQ, and whenever something needs to be escalated as an incident mid-run. Every agent in this repo depends on this — it's how Ash sees what happened without reading transcripts.
---

Ops HQ root: Notion page "Amico Mio — Ops HQ" (`3c282845-0aff-8126-be56-c1796e1eb2e5`).

## Databases and when to write to each

- **Incidenti e interventi** (`455a9b8c-37db-4b92-96bf-2f0dd0aee514`) — anything that needs a human decision, anything unusual, anything you couldn't finish, any escalation. Status **Aperto** when you log it; whoever resolves it (usually Ash, sometimes a later agent run) changes the status. Always set the right **Sito** (Tour, or the specific client site name for Locali & Ordinazioni — don't leave it blank or guess).
- **Coda lavori** (`6f84c826-63b5-41dc-9110-947c7b607570`) — site work items, per `site-ops.md`'s rules on what's safe to close yourself vs. leave open.
- **Siti** (`9ca66617-f8a5-44e9-badc-8e31dc6b1bda`) — current status per site; update when site-ops observes a change.
- **Clienti e offerte** (`4dc49796-e107-4ed4-b1dc-829a18fe4442`) — the Tours booking ledger; concierge only.

## The silence rule

Stated in `CLAUDE.md`, worth repeating because it's the one rule every agent file leans on: **a run that goes quiet without writing anything is treated as a failure, not a no-op.** If you hit an error, a missing credential, an ambiguous case, or genuinely have nothing to report — write that down. "Ran clean, nothing to do" is a valid, expected log entry. No entry at all is not.

## Format

Keep entries short and scannable — Ash reads these fast, often on a phone. One line of what happened, the Sito, and (for Incidenti) what decision is needed. Don't write prose explanations of your own reasoning; write what a human needs to act.
