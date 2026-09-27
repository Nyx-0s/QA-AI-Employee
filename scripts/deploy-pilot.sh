#!/usr/bin/env bash
# deploy-pilot.sh — one command per pilot customer.
#
#   ./scripts/deploy-pilot.sh <customer-slug> [port]
#
# Creates pilots/<slug>/ with its own .env (operator pastes the LLM key)
# and its own compose project (own container, own named data volume, own
# port), then brings the stack up with browser hands enabled. Nothing is
# shared between pilots — the "your data never leaves your box" promise.
#
# After it finishes:
#   docker compose -f pilots/<slug>/compose.yaml --project-directory pilots/<slug> ps
#   docker compose -f pilots/<slug>/compose.yaml --project-directory pilots/<slug> logs app | grep "OPERATOR TOKEN"
#
# Tear-down (keeps the customer's data volume):
#   docker compose -f pilots/<slug>/compose.yaml --project-directory pilots/<slug> down
set -euo pipefail

SLUG="${1:-}"
PORT="${2:-}"

if [ -z "$SLUG" ]; then
  echo "usage: $0 <customer-slug> [port]" >&2
  exit 1
fi
case "$SLUG" in
  *[!a-z0-9-]* | "") echo "error: slug must be lowercase letters, digits, dashes" >&2; exit 1 ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required (docker compose v2)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"       # consentark/
REPO="$(cd "$ROOT/.." && pwd)"                 # workspace root (for the build context)
PILOT_DIR="$ROOT/pilots/$SLUG"

if [ -d "$PILOT_DIR" ]; then
  echo "error: pilots/$SLUG already exists — pick another slug or remove it first" >&2
  exit 1
fi

if [ -z "$PORT" ]; then
  PORT=$(python3 - <<'PY' 2>/dev/null || echo 4100
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)
  echo "  (auto-selected free port: $PORT)"
fi

mkdir -p "$PILOT_DIR"

# ── compose project: same image build, isolated everything else ─────────
cat > "$PILOT_DIR/compose.yaml" <<EOF
services:
  app:
    build:
      context: ${REPO}
      dockerfile: ${ROOT}/Dockerfile
      target: runtime-browser
    container_name: consentark-${SLUG}
    ports:
      - "127.0.0.1:${PORT}:4000"
    env_file:
      - .env
    environment:
      DATA_DIR: /data
      DASHBOARD_DIST: /app/apps/dashboard/dist
    volumes:
      - consentark-data-${SLUG}:/data
    restart: unless-stopped

volumes:
  consentark-data-${SLUG}:
EOF

# ── env: every pilot generates its own operator token on first boot ─────
cat > "$PILOT_DIR/.env" <<EOF
# ConsentArk pilot stack — ${SLUG}
# Paste the FreeLLMAPI key below, then restart:
#   docker compose -f compose.yaml --project-directory . up -d --build
PORT=4000
DATA_DIR=/data
FREELLMAPI_URL=http://host.docker.internal:3001/v1
FREELLMAPI_KEY=
FREELLMAPI_MODEL=auto
CONSENTARK_PORT=${PORT}
EOF

echo
echo "✔ Pilot stack for \"${SLUG}\" staged at pilots/${SLUG}/"
echo "  1. Paste the FreeLLMAPI key into pilots/${SLUG}/.env (FREELLMAPI_KEY=)"
echo "  2. Start it:"
echo "     docker compose -f pilots/${SLUG}/compose.yaml --project-directory pilots/${SLUG} up -d --build"
echo "  3. Read the operator token (printed ONCE):"
echo "     docker compose -f pilots/${SLUG}/compose.yaml --project-directory pilots/${SLUG} logs app | grep 'OPERATOR TOKEN'"
echo "  4. Open http://127.0.0.1:${PORT} — hire the first employee:"
echo "     docker compose -f pilots/${SLUG}/compose.yaml --project-directory pilots/${SLUG} exec app node dist/cli/hire.js --template data-clerk --allowlist \"${SLUG}.example.com\""
echo
echo "  Data volume consentark-data-${SLUG} is exclusive to this pilot."
