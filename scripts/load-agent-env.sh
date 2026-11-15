# Sourced by dev.sh and serve.sh. Exports AI assistant settings from private-data/agent.env
# (Git-ignored). Only KEY=value lines named HKM_AGENT_* are read; nothing in the file runs as
# code, and variables already set in the shell take precedence. Values are never printed.
agent_env="private-data/agent.env"
if [ -f "$agent_env" ]; then
  chmod 600 "$agent_env" 2>/dev/null || true
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      HKM_AGENT_*=*)
        name="${line%%=*}"
        value="${line#*=}"
        value="${value%\"}"
        value="${value#\"}"
        if [ -n "$value" ] && printf '%s' "$name" | grep -Eq '^HKM_AGENT_[A-Z_]+$' \
          && [ -z "${!name:-}" ]; then
          export "$name=$value"
        fi
        ;;
    esac
  done < "$agent_env"
fi
unset agent_env line name value
