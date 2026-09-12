#!/usr/bin/env bash
# Zen Recovery — one-shot deploy. Run from a machine/session that has Cloudflare access:
#   CLOUDFLARE_API_TOKEN (Workers Scripts:Edit, D1:Edit, Workers Routes:Edit, Zone:Read on zenrecovery.club)
#   plus the three keys below on first run. Safe to re-run; secrets are only set when the variable is present.
set -euo pipefail
cd "$(dirname "$0")"

echo "→ wrangler"
npx --yes wrangler@4 whoami

echo "→ database schema (idempotent)"
npx --yes wrangler@4 d1 execute zen-recovery --remote --file=schema.sql

put() { if [ -n "${!1:-}" ]; then printf '%s' "${!1}" | npx --yes wrangler@4 secret put "$1"; else echo "  (skip $1 — not set in env)"; fi; }
echo "→ secrets"
put STRIPE_SECRET_KEY
put STRIPE_WEBHOOK_SECRET
put RESEND_API_KEY
put ADMIN_BOOTSTRAP_EMAIL
put ADMIN_BOOTSTRAP_PASSWORD
if [ -n "${SESSION_SECRET:-}" ]; then put SESSION_SECRET; else
  echo "  generating SESSION_SECRET"; openssl rand -hex 32 | tr -d '\n' | npx --yes wrangler@4 secret put SESSION_SECRET; fi

echo "→ deploy"
npx --yes wrangler@4 deploy
echo "done: https://zenrecovery.club  (admin: /admin.html)"
