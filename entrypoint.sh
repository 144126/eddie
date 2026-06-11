#!/bin/bash
set -e

mkdir -p ~/.hermes

cat > ~/.hermes/config.yaml <<EOF
model:
  default: "${HERMES_MODEL:-openrouter/anthropic/claude-sonnet-4}"
  provider: "${HERMES_PROVIDER:-openrouter}"
EOF

case "${HERMES_PROVIDER:-openrouter}" in
  openrouter) export OPENROUTER_API_KEY="$HERMES_API_KEY" ;;
  anthropic)  export ANTHROPIC_API_KEY="$HERMES_API_KEY" ;;
  openai)     export OPENAI_API_KEY="$HERMES_API_KEY" ;;
  *)          export OPENROUTER_API_KEY="$HERMES_API_KEY" ;;
esac

export API_SERVER_KEY="${API_SERVER_KEY:-eddie-dev}"

echo "[eddie] Starting Hermes agent gateway..."
exec hermes gateway run
