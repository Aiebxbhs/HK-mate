#!/usr/bin/env bash
# Record and encode the intro video: video/out/hk-mate-intro.mp4 (add --lang=en for English)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PWD/.tools/node/bin:$PATH"
if [ ! -f video/out/lecture.wav ]; then
  mkdir -p video/out
  say -v Daniel -o video/out/lecture.aiff -f scripts/bench-data/lecture_script.txt
  afconvert -f WAVE -d LEI16@16000 -c 1 video/out/lecture.aiff video/out/lecture.wav
fi
bash video/reset.sh
node video/record.mjs "$@"
node video/timeline.mjs
# --lang=en writes the English version next to the Chinese one.
name=hk-mate-intro
case " $* " in *" --lang=en "*) name=hk-mate-intro-en ;; esac
swift video/encode.swift video/out/sequence.txt "video/out/$name.mp4"
