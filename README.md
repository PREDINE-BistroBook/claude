# Amico Mio — AI agent company

This repo is the operating system for a team of AI agents running two businesses for Ash (CEO, approves everything that matters): **Amico Mio Tours** and **Locali & Ordinazioni** (smart websites + ordering systems for bar/restaurant clients).

Start at [`CLAUDE.md`](./CLAUDE.md) — it's the constitution every agent reads first: the two businesses, the shared Notion Ops HQ, the full roster, and the autonomy policy (what's auto-allowed vs. what needs Ash's approval).

## Layout

```
CLAUDE.md                          company constitution — read this first
.claude/agents/                    one file per agent role
  concierge.md                     Tours booking + guest comms — LIVE, scheduled
  social-viral.md                  Tours content — LIVE, scheduled
  site-ops.md                      cross-business site health + work queue — LIVE, scheduled
  client-success.md                Locali & Ordinazioni support — drafted, not live yet
  biz-dev.md                       Locali & Ordinazioni outreach — drafted, not live yet
  finance-ops.md                   cross-business finance — read-only checks live, sends not live
.claude/skills/
  request-approval/                how every agent stages something for Ash instead of acting alone
  ops-hq-logging/                  how every agent logs to Notion Ops HQ
```

## Why three agents are "live" and three aren't

Concierge, Social/Viral, and Site Ops mirror a playbook Ash had already fully specified in Notion (templates, cadence, escalation rules) — there was nothing ambiguous left to fill in, so they're wired to real scheduled Routines (below) and can run unattended in DRAFT mode.

Client Success, Biz Dev, and Finance Ops (send-side) touch things a wrong guess would actually hurt — an unconfirmed support inbox, a cold-outreach list nobody approved, a live Stripe account. Each file ends with a short "before this goes live" list of exactly what's missing. Once Ash fills those in, wiring the Routine is a five-minute follow-up, not a redesign.

## What "live" actually means right now

Every live agent runs in **DRAFT mode**: it does the work, produces the draft/log/staged item, and stops. Nothing sends or publishes until Ash approves it — per the Head Chef rules in `CLAUDE.md`. "Live" means "runs on schedule and gets real work ready for approval," not "sends things unattended."

## Scheduled Routines

Each live agent runs on a Claude Code Routine (a scheduled trigger) that spins up a fresh session, points it at this repo, and tells it to read `CLAUDE.md` plus its own agent file before doing anything:

| Agent | Schedule (UTC) | Local (Europe/Rome) |
|---|---|---|
| Concierge | `0 7,16 * * *` | 09:00 + 18:00 |
| Social / Viral | `0 8 * * 1` | Monday 10:00 |
| Site Ops | `0 6 * * *` | 08:00 daily |

Europe/Rome runs CEST (UTC+2) for most of the year and CET (UTC+1) in winter — the cron above is pinned to UTC, so it drifts one hour relative to local time across the DST changeover. Adjust then, or ask an agent to fix it when it does.

Note on "event-driven": true push-based triggers (a Gmail push notification, a Stripe webhook) need infrastructure this repo doesn't set up on its own (a Cloudflare Worker receiving webhooks, a Pub/Sub subscription). The one piece of real event-driven infra already exists and is untouched by this repo: Guardiano, the uptime watcher, alerts by email within its 5-minute check cycle. Everything else here runs on a schedule tight enough (twice daily, daily) that it behaves like event-driven from Ash's side, without the extra infrastructure. If true webhook-driven triggers matter later (e.g. a Stripe webhook firing finance-ops the moment a charge fails), that's a follow-up, not part of this scaffold.

## Running an agent by hand

Open a session in this repo and say the agent's name — e.g. "run concierge" or "run site-ops, fix the Sergio Bar contrast item."
