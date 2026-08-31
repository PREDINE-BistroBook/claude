#!/bin/bash
set -euo pipefail

# This repo has no app dependencies (no package.json/pyproject.toml) — it's an
# ops/agent config repo. What every content-agent session actually needs is
# real video tooling: ffmpeg (cut/caption/export real footage per
# short-form-editing-craft) and gdown/yt-dlp (pull footage in from Google
# Drive links, since the Drive MCP connector caps inline downloads at 10MB).
# Without this, wine-window-content/pub-crawl-content silently can't produce
# anything the moment real footage exists — see Incidenti e interventi,
# 2026-08-31, "Pub Crawl Content" tooling-gap entry.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  # noble-updates occasionally 404s a few transitive deps (libva2, libva-drm2,
  # libva-x11-2, libcaca0) that newer ffmpeg builds pull in for GPU/console
  # extras we don't need. Pin those four to the plain noble build instead of
  # letting the whole ffmpeg install fail on them.
  apt-get update -qq
  apt-get install -y --no-install-recommends \
    libva2=2.20.0-2build1 libva-drm2=2.20.0-2build1 \
    libva-x11-2=2.20.0-2build1 libcaca0=0.99.beta20-4build2 \
    2>/dev/null || true
  apt-get install -y --no-install-recommends ffmpeg
fi

if ! command -v gdown >/dev/null 2>&1 || ! command -v yt-dlp >/dev/null 2>&1; then
  pip install --quiet --break-system-packages gdown yt-dlp 2>/dev/null \
    || pip install --quiet gdown yt-dlp
fi
