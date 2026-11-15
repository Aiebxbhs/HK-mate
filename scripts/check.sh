#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PWD/.tools/node/bin:$PATH"
.venv/bin/ruff check backend scripts/*.py
.venv/bin/ruff format --check backend scripts/*.py
.venv/bin/pytest
npm --prefix frontend run lint
npm --prefix frontend run format:check
npm --prefix frontend run test
npm --prefix frontend run build
