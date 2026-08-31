#!/bin/bash
# SessionStart hook: make sure ffmpeg is available for the content agents
# (Wine Window Content / Pub Crawl Content) that need to cut real guest
# footage into short-form clips. Must never hard-fail session start —
# if ffmpeg can't be installed, we leave a clear signal instead so an
# agent run logs an incident rather than silently assuming it has
# editing capability it doesn't.
set -uo pipefail

STATUS_FILE="${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/ffmpeg-status.txt"

report() {
  echo "$1" > "$STATUS_FILE"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export FFMPEG_AVAILABLE=$2" >> "$CLAUDE_ENV_FILE"
  fi
}

if command -v ffmpeg >/dev/null 2>&1; then
  report "ffmpeg already present: $(ffmpeg -version 2>/dev/null | head -1)" "true"
  exit 0
fi

# Only auto-install in the remote/web sandbox; leave local dev machines alone.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

INSTALL_OK=false
if command -v apt-get >/dev/null 2>&1; then
  if [ "$(id -u)" = "0" ]; then
    SUDO=""
  elif command -v sudo >/dev/null 2>&1; then
    SUDO="sudo -n"
  else
    SUDO=""
  fi
  if $SUDO apt-get update -qq >/dev/null 2>&1 && $SUDO apt-get install -y -qq ffmpeg >/dev/null 2>&1; then
    INSTALL_OK=true
  fi
fi

if [ "$INSTALL_OK" = "true" ] && command -v ffmpeg >/dev/null 2>&1; then
  report "ffmpeg installed via apt-get: $(ffmpeg -version 2>/dev/null | head -1)" "true"
else
  report "ffmpeg NOT available and automatic install failed (no apt-get, no root/sudo, or a network/permission error). Content agents needing to cut video should log an Incidenti e interventi entry (Sito: Tour) instead of assuming editing capability exists." "false"
fi

exit 0
