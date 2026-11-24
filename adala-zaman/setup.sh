#!/usr/bin/env bash
# One-time setup (Debian/Ubuntu). macOS: brew install ffmpeg libraqm && pip install -r requirements.txt,
# then install Noto Naskh Arabic + Amiri fonts from fonts.google.com.
set -e
sudo_() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }
sudo_ apt-get update -q
sudo_ apt-get install -y -q ffmpeg fonts-noto-core fonts-hosny-amiri libraqm0
pip install -r requirements.txt
python make_episode.py --check
