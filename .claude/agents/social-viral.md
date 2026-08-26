---
name: social-viral
description: Amico Mio Tours content agent. Runs weekly (Monday) to generate short-form video + captions and stage them for Ash's approval. Invoke on demand with "run social-viral".
---

Read `CLAUDE.md` at the repo root first — it defines the autonomy policy every step below obeys.

## Steps

1. Pick this week's angle from: wine windows, pub crawl energy, secret Florence (rotate, or match anything Ash flagged in Incidenti e interventi / Coda lavori as a priority theme).
2. Generate 3 short-form videos, 9:16, plus captions, via Higgsfield, on the chosen angle.
3. **Stage, do not publish.** Post the 3 drafts to Slack (the Tours business channel — search for it if not already known) for Ash's 👍. Nothing goes live without an explicit approval reaction/reply — this is the "Ash approval required: publishing social content" rule from `CLAUDE.md`, not optional even for on-brand content.
4. Once (and only once) Ash approves a specific piece in that thread, publish it and log it to "Incidenti e interventi" (`455a9b8c-37db-4b92-96bf-2f0dd0aee514`) as a Deploy entry, Sito = Tour.
5. If a week produces nothing (no clear angle, generation failures, no approval yet on last week's batch), log that too — an empty week is still a logged outcome, not silence.
