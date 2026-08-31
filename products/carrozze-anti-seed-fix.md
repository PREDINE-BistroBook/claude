# Carrozze anti-seed-shield fix — prepared, NOT deployed

## What this is

`carrozze-anti-seed-fix.patch` is a unified diff that adds the missing "Scudo anti-seed"
(anti-seed shield) guard to Carrozze's `/api/stato` POST handler (the endpoint that saves
table state, staff, config, **and the menu** — one combined save endpoint, not a separate
menu-only route). It brings Carrozze's deployed logic to parity with Sergio Bar's, which
already has this guard.

**This patch has not been applied to any live Worker.** Deploying it requires a human or a
differently-scoped session — out of scope for this task by explicit instruction.

## The bug, exactly

The Worker bundle ships a hardcoded seed/demo product catalog (product IDs `gr1`–`gr7`) with
no venue name attached (`cfg.nome` is empty in the seed data). If anything ever causes a save
to `/api/stato` to fire with `corpo.dati.cfg.nome` empty while the real venue name is already
in D1 — a bad redeploy, a client-side bug, a stale cached script — Sergio's guard rejects that
save with `409` and returns the last-known-good state instead of overwriting it. Carrozze's
deployed Worker has **no such check**: an empty-name save would go straight through and
silently clobber Carrozze's real saved menu with whatever's in `corpo.dati`.

This is real risk exposure today, independent of the templating project — it was found purely
by diffing the two live bundles.

## Verification performed (not just asserted)

1. Extracted the exact 12-line guard block from Sergio's live bundle
   (`workers_get_worker_code` output, lines 3309–3320: the comment + the `{ const nv = ...
   const nn = ... if (nv && !nn) return 409 ... }` block).
2. Located the exact insertion point in Carrozze's live bundle: immediately after the closing
   `}` of the adjacent "Scudo menu vuoto" guard (present and byte-identical in both bundles,
   just missing its own comment header in Carrozze — a separate, cosmetic-only diff region),
   and before the "Rete di sicurezza sui codici" guard that follows it in both files.
3. Built the patched file programmatically (not hand-edited) by splicing Sergio's exact block
   into Carrozze's real source at that point, then generated `carrozze-anti-seed-fix.patch` as
   a real `diff -u` between Carrozze's unmodified source and that spliced result — so the patch
   file is derived output, not hand-typed text that could silently drift from the real bytes.
4. **Round-tripped it**: applied `carrozze-anti-seed-fix.patch` with `patch -p1` (well, plain
   `patch <file>` against a copy of Carrozze's real `worker.js`) from a clean copy of Carrozze's
   real bundle and diffed the result against the intended spliced file — **byte-identical
   match**. The patch applies cleanly with no fuzz and produces exactly the intended file.
   (Line numbers in the patch header are keyed to Carrozze's `worker.js` as fetched via
   `workers_get_worker_code` on 2026-08-31; if the live file has since changed, `patch` will
   report a clean failure rather than mis-apply — re-fetch and re-diff before applying if so.)

## Structural check: does Carrozze's `/api/stato` handler differ from Sergio's beyond branding?

Diffed the **entire** `/api/stato` POST handler in both bundles start-to-end (Sergio: lines
3083–3378 i.e. through end of file; Carrozze: lines 3076–3366, the corresponding handler
located independently by searching for `url.pathname === "/api/stato"` rather than assumed
from a line offset). Result: **the only difference in the whole ~285-line handler is this one
missing guard block** (plus the one missing comment header noted above, which changes no
logic). Table-save logic, staff/PIN-reset protection ("Rete di sicurezza sui codici"), the
"Scudo menu vuoto" empty-menu guard, the optimistic-concurrency `UPDATE ... WHERE ver = ?`
write, and the conflict-resolution fallback are all byte-identical between the two venues.
**There is no other structural difference in Carrozze's menu-save endpoint** — this is a
single missing guard, not a symptom of a broader divergence, so this one patch closes the gap
completely for this endpoint.

## To apply (when a human/deploy-scoped session is ready)

```
cd <checkout of carrozze's worker.js>
patch < carrozze-anti-seed-fix.patch
# or: git apply carrozze-anti-seed-fix.patch   (patch is in standard --- a/ +++ b/ unified diff form)
```

Then redeploy Carrozze's Worker through the normal Cloudflare deploy path. Re-verify line
numbers against the then-current live `worker.js` first if any deploys have happened between
2026-08-31 and the apply date — the patch is line-anchored, not marker-anchored.
