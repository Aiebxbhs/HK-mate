#!/usr/bin/env bash
# Start only this project's backend and frontend. Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PWD/.tools/node/bin:$PATH"
if [ ! -x .venv/bin/python ] || ! command -v node >/dev/null || [ ! -d frontend/node_modules ]; then
  printf 'Dependencies missing. Follow the setup steps in README.md.\n' >&2
  exit 1
fi
for port in 8000 5173; do
  if command -v lsof >/dev/null && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    printf 'Port %s is in use. Stop the existing service or reuse the running preview.\n' "$port" >&2
    exit 1
  fi
done
umask 077
. scripts/load-agent-env.sh
.venv/bin/alembic upgrade head
backend_pid=''
frontend_pid=''
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$backend_pid" ]; then kill "$backend_pid" 2>/dev/null || true; fi
  if [ -n "$frontend_pid" ]; then kill "$frontend_pid" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM
.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --no-proxy-headers --no-access-log &
backend_pid=$!
node frontend/node_modules/vite/bin/vite.js --config frontend/vite.config.js frontend --host 127.0.0.1 --port 5173 --strictPort &
frontend_pid=$!
printf '\nHK Mate preview: http://127.0.0.1:5173\nAPI documentation: http://127.0.0.1:8000/docs\nPress Ctrl+C to stop both services.\n\n'
while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do sleep 1; done
printf '\nA development service exited; stopping its companion.\n' >&2
exit 1
