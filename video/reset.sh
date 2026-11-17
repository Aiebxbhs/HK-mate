#!/usr/bin/env bash
# Restart the demo instance with a fresh database and wait until its mail is labelled.
set -euo pipefail
cd "$(dirname "$0")/.."
pkill -f "video/demo_server.py" 2>/dev/null || true
sleep 1
mkdir -p video/out
nohup bash video/run_demo.sh > video/out/demo.log 2>&1 &
for _ in $(seq 1 120); do
  sleep 1
  state=$(curl -s -m 2 http://127.0.0.1:8010/__demo/state || true)
  case "$state" in
    *'"done":10'*) echo "demo ready"; exit 0 ;;
  esac
done
echo "demo not ready: $state" >&2
exit 1
