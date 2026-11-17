#!/usr/bin/env bash
# Start the demo instance used to record the intro video (synthetic data, port 8010).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f frontend/dist/index.html ]; then
  printf 'Build the frontend first: npm --prefix frontend run build\n' >&2
  exit 1
fi
umask 077
. scripts/load-agent-env.sh
exec .venv/bin/python video/demo_server.py
