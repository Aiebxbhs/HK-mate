#!/usr/bin/env bash
# Run the dedicated local model service; Ctrl+C stops it.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_MODELS="$PWD/private-data/models/ollama"
export OLLAMA_NO_CLOUD=1
export OLLAMA_DEBUG_LOG_REQUESTS=false
export OLLAMA_CONTEXT_LENGTH=16384
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
mkdir -p "$OLLAMA_MODELS"
if lsof -nP -iTCP:11434 -sTCP:LISTEN >/dev/null 2>&1; then
  printf 'Port 11434 is already in use. Reuse or stop your existing Ollama service.\n' >&2
  exit 1
fi
exec .tools/ollama/ollama serve
