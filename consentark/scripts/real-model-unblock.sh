#!/usr/bin/env bash
# real-model-unblock.sh — the whole real-model unblock in one command.
#
#   bash consentark/scripts/real-model-unblock.sh
#
# Run AFTER pasting the key into consentark/.env (line: FREELLMAPI_KEY=sk-...).
# It:
#   1. gates on `keycheck` PASS (never prints the key — only length/last-4),
#   2. runs the real-model probe through the production browser path
#      (BrowserService → LLM proxy → FreeLLMAPI),
#   3. appends a dated, verdict-stamped section to docs/real-model-findings.md.
# Exits non-zero on any gate failure; the findings doc always shows the verdict.
set -uo pipefail
cd "$(dirname "$0")/../apps/api"

echo "== keycheck =="
if ! npx tsx src/cli/keycheck.ts; then
  echo "keycheck FAILED — fix the key first; findings doc not touched."
  exit 1
fi

echo "== real-model probe =="
LOG="/tmp/real-model-probe-$(date +%Y%m%d-%H%M%S).log"
RESULT="$(npx tsx scripts/real-model-probe.ts 2>&1 | tee "$LOG")"
STATUS=$?
echo "$RESULT" | tail -15
if [ "$STATUS" -ne 0 ]; then
  VERDICT="FAIL (exit $STATUS — see log above and $LOG; key/URL/model need investigation)"
else
  VERDICT="PASS — first real-model execution evidence recorded"
fi

echo "== findings doc update =="
cat >> ../../docs/real-model-findings.md <<EOF

## Run of $(date +%Y-%m-%d %H:%M %Z) — via consentark/scripts/real-model-unblock.sh

- keycheck: PASS (key present; reported as length/last-4 only, never the value)
- probe: ${VERDICT}
- full probe log: ${LOG}
- next on PASS: three-task matrix (scripts/dev/gate-adversarial.ts with the real
  preset), then flip the demo sandbox per startup-kit/demo-sandbox-runbook.md.
EOF
echo "findings doc updated with: ${VERDICT}"
exit "$STATUS"
