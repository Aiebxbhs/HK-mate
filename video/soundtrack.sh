#!/usr/bin/env bash
# Adds the background music to a finished video. The silent picture is kept beside it.
#   bash video/soundtrack.sh video/out/hk-mate-intro.mp4 [A|B|C]   (opening style, default A)
set -euo pipefail
cd "$(dirname "$0")/.."
video="$1"
silent="${video%.mp4}-silent.mp4"
# Run again on the same file: start from the silent picture, not from the one with music.
if [ -f "$silent" ]; then cp "$silent" "$video"; else cp "$video" "$silent"; fi
seconds=$(swift video/duration.swift "$silent")
.venv/bin/python video/music.py "$seconds" video/out/music.wav --opening="${2:-A}" --body="${3:-1}"
afconvert -f m4af -d aac -b 192000 video/out/music.wav video/out/music.m4a
swift video/mux.swift "$silent" video/out/music.m4a "$video"
rm -f video/out/music.wav video/out/music.m4a
