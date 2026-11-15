#!/usr/bin/env bash
# Serve the built frontend and API from one local origin.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f frontend/dist/index.html ]; then
  printf 'Build the frontend first; see README.md.\n' >&2
  exit 1
fi
umask 077
. scripts/load-agent-env.sh
.venv/bin/alembic upgrade head
exec .venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --no-proxy-headers --no-access-log
