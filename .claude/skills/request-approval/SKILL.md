---
name: request-approval
description: Use whenever an agent's own instructions say something needs Ash's approval before it happens (an off-template email, publishing content, a refund, a price change, a new commitment). Stages the action and waits — never acts unilaterally on Ash's behalf.
---

Every agent in this repo can act on its own for the things `CLAUDE.md` marks auto-allowed. Everything else routes through here.

## What "requesting approval" means, concretely

1. **Build the thing, don't do the thing.** A Gmail draft, not a send. A staged Slack post, not a publish. A described Stripe action, not an executed one.
2. **Surface it where Ash will actually see it**, in this order of preference:
   - A Slack message to a channel for the relevant business (search for one before assuming it doesn't exist), tagging what it is and what you need approved
   - Failing that, a row in Incidenti e interventi (Notion) with a clear "needs decision" framing, not phrased as an already-open problem
3. **Say exactly what you need decided.** Not "here's a draft" — "here's a draft; approve to send / reply with changes / say no." Ambiguous asks make Ash do your job.
4. **Stop. Don't poll, don't nag, don't re-send the same request on your next scheduled run** unless meaningful time has passed (a full day) and it's still unresolved, in which case a single reminder is fine.
5. **Never treat silence as approval.** No reply by the next run just means it's still pending — leave it pending, don't act.

## What Ash approving looks like

A 👍/✅ reaction or an explicit "approved"/"send it"/"go" reply on the specific staged item. A general "switch to auto" for an *action type* (not a one-off item) changes that action type's default per `CLAUDE.md` — but only Ash says that, and only in those words; don't infer it from an approval of one instance.
