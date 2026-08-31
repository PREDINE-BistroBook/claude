---
name: short-form-editing-craft
description: Use whenever editing real footage into a short-form clip for wine-window-content or pub-crawl-content (or any future content agent) — how to cut, pace, and time it so it reads as funny/engaging and not AI-made or cringe. Load this before touching the timeline, not after a rough cut is already assembled.
---

Research backing this: Growth Playbook page in Notion Ops HQ, 2026-08-29 evening update and the editing-craft addendum. This skill is the "how to actually cut it" companion to that page's "what angle/hook to pick."

## The rule that matters most: dead time kills everything

Any moment where nothing new appears on screen or in the audio is the single fastest way to lose a viewer on short-form. Before anything else — pacing, jokes, hooks — cut every beat where nothing is changing. If you're unsure whether a moment is dead, cut it; you can always be wrong toward "too fast," never toward "too slow."

## Cut rhythm, by platform

- **TikTok:** a cut every 1.5-3 seconds. No single shot holds longer than 3 seconds without a specific reason (the reveal, the payoff, a beat for a real laugh).
- **Instagram Reels:** slightly more room, 2.5-4 seconds per cut.
- Don't hold a uniform pace the whole way through — **start faster to win the hook, slow down for the one moment that's actually the point** (the wine window reveal, the bar reveal, the guest's genuine reaction), then pick pace back up to close. A flat, constant cut rate reads as mechanical — which is exactly the "made by AI" tell we're trying to avoid.

## Comedic timing, concretely

- **Cut to the reaction immediately after the punchline or reveal** — don't linger on the setup once the payoff has landed. The reaction shot *is* the joke as much as the reveal is.
- **A sudden pause or a beat of silence right before or after a punchline lands harder than another jump cut would.** Laughter needs a beat of air — resist the urge to keep cutting through that beat.
- **Jump cuts exaggerate reactions and create urgency** — use them to remove the "and then..." connective filler between two funny/interesting moments, not to speed up a moment that needed to breathe.
- **Don't force it.** A missed comedic beat or an over-edited attempt at a joke reads as cringe, which is worse than not attempting humor at all. If a real moment (a guest's genuine laugh, an awkward pause, a deadpan aside) is already funny on its own, cut *around* it, don't cut *into* it.

## The humor that actually lands right now: deadpan and irony, not slapstick

Gen Z/current short-form humor runs on irony, deadpan delivery, and understatement — "the joke is that there's no joke," ironic detachment, dry commentary over a real moment — not exaggerated mugging or forced punchlines. Concretely for our two products:
- A guide deadpanning a wild fact about the wine window with zero reaction, cut immediately to a guest's genuine shocked face, is funnier than a guide performing surprise.
- An unscripted, slightly awkward real moment on the crawl (the group actually failing to guess the next bar, someone's real reaction to a shot) beats a staged "and then we all laughed" recreation every time.
- This is also why real footage over AI-generated footage matters for comedy specifically, not just for the trust reason already logged: timing off a real moment can't be faked convincingly — a synthetic clip can't have real comedic timing because nothing real happened in it.

## Sound: sync cuts to the beat, but not every beat

If there's music underneath, cut on **downbeats for major cuts** (the hook landing, the reveal), not on every beat — cutting on every beat reads as frantic rather than punchy. Cuts timed to the music's rhythm measurably outperform cuts that ignore it. This is also where the Business-account-vs-creator-account sound decision (open in the Growth Playbook) matters: whatever track is used, cut *to* it, don't lay a track under a cut pattern that ignores it.

## A working checklist, in order

1. Watch the raw footage once, full-length, without cutting anything — mark the one real moment that's actually the point (the reveal, the genuine reaction, the punchline).
2. Build the hook (per the agent file's hook-pattern rules) as the first 2 seconds, using the loudest visual/textual moment available — don't save the best moment for later.
3. Cut everything between the hook and the marked payoff moment down to the minimum needed to make sense — every cut point removes dead time, not just "trims."
4. Let the payoff moment breathe — hold it, even if only for a beat — don't jump-cut through the one moment that's actually funny/interesting.
5. Close fast — don't linger after the payoff has landed.
6. Re-watch once against the platform cut-rhythm numbers above (TikTok 1.5-3s/cut, Reels 2.5-4s) — if a section is slower than that without a clear reason (it's the payoff beat), tighten it.
7. Then apply the export guardrail from the agent file (1080p H.264, 15-30s, under 30MB) — export is the last step, not something to work around mid-edit.

## AI editing capabilities actually available here — audited 2026-08-31

Ash asked (2026-08-31) to push further on what AI editing this setup can do. This is what's real, checked directly against the tools in this environment rather than assumed:

- **higgsedit's own `p.frame()` proof-still step is not optional polish** — it renders a PNG at a given timeline second before you commit to a full render, so you catch a wrong crop, a collided text box, or a blank composed layer before spending render time on it. The agent files now call this out explicitly at the build step. Post-render pixel-match verification (the same-location-cuts fix from 2026-08-31) is a *different* check — it confirms the right source moment landed at the cut point, not that the composition looks right. Do both; neither substitutes for the other.
- **Burned captions (`subtitles` workflow) are a real, unused-until-now capability** — Whisper timing off the clip's own audio, several look presets (`bold`, `paper`, `clean`), and it never fabricates words that weren't said. Now wired into both agent files as a default step whenever a beat has legible spoken dialogue. This is the single highest-value addition from this pass: burned captions are close to table stakes for retention on TikTok/Reels, and skipping them was a real gap, not a deliberate choice.
- **`upscale_video`** (bytedance or topaz backend) is a legitimate tool for real footage specifically because it doesn't invent content — it's the same real pixels at higher resolution/bitrate. Worth reaching for on older or lower-quality guide phone footage before writing it off as unusable, without violating the "real footage, not AI-generated" rule (nothing is generated, just upscaled).
- **`reframe`** can produce an aspect-ratio-safe crop when source footage isn't natively 9:16, instead of hand-tuning `fit="cover"` math in the edit script.
- **What exists but doesn't fit this brand, on purpose:** `shorts_studio_create` restyles raw footage through an AI visual style preset (claymation, urban, monochrome, etc.) — that's the opposite of the "real footage, unedited-looking, not AI-made" positioning Ash confirmed 2026-08-29, so don't reach for it as a shortcut even though it's faster. `dubbing` (real speech translated + lip-synced) is a genuine future-growth idea for international-guest reach, not part of the current weekly pipeline — flag it as an Idea if it seems worth raising, don't just start using it.
- **What doesn't exist in this account:** the `video-editing` workflow's own docs describe a `fable_editor` tool that links a project to a live, shareable web editor (solving delivery in one step) — that tool is not present in this session's toolset. Don't plan around it or promise it to Ash; the delivery path stays the media-upload/tmpfiles.org approach in the agent files' step 4 until that changes.
