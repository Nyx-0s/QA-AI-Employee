#!/usr/bin/env bash
# rehearse-demo.sh — the 15-minute demo, end to end, in one shot.
#
# Boots a fresh sandbox (demo pages + API + packaged dashboard), hires the
# data-clerk template, runs the two demo tasks, walks the consent gate,
# and writes every piece of evidence to /tmp/ca-rehearsal/rehearsal-evidence.md
# (copied to consentark/docs/ at the end). Nothing is left running: this
# script is the proof; the runbook is the persistent deployment.
set -uo pipefail

API_PORT=4400
PAGES_PORT=8788
ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # consentark/
API="$ROOT/apps/api"
EV_DIR="/tmp/ca-rehearsal"
EV="$EV_DIR/rehearsal-evidence.md"
mkdir -p "$EV_DIR"

log()  { echo "$@" | tee -a "$EV"; }

# ── 0. clean slate ───────────────────────────────────────────────────────
rm -rf /tmp/ca-demo-sandbox && mkdir -p /tmp/ca-demo-sandbox
: > "$EV"

log "# ConsentArk demo rehearsal — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log ""

# ── 1. demo pages ────────────────────────────────────────────────────────
DEMO_PAGES_PORT=$PAGES_PORT node "$API/scripts/demo-pages.mjs" > /tmp/ca-demo-pages.log 2>&1 &
PAGES_PID=$!
sleep 1
PAGES_OK=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PAGES_PORT/list")
log "## Beat 0 — demo pages: HTTP $PAGES_OK on :$PAGES_PORT (/list, /form)"

# ── 2. API appliance (packaged mode: dashboard served by the API) ────────
(
  cd "$API"
  PORT=$API_PORT DATA_DIR=/tmp/ca-demo-sandbox \
  DASHBOARD_DIST="$API/../dashboard/dist" LOG_LEVEL=info node dist/index.js \
    > /tmp/ca-demo-api.log 2>&1 &
  echo $! > /tmp/ca-demo-api.pid
)
for i in $(seq 1 30); do
  HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$API_PORT/api/health" 2>/dev/null)
  [ "$HEALTH" = "200" ] && break
  sleep 1
done
log "## Beat 0 — API + dashboard: HTTP $HEALTH on :$API_PORT"
log ""

# ── 3. hire the data-clerk (allowlist: the demo pages) ───────────────────
log "## Beat 1 — hire (template: data-clerk, consent gate ON)"
HIRE_OUT=$(cd "$API" && PORT=$API_PORT DATA_DIR=/tmp/ca-demo-sandbox node dist/cli/hire.js \
  --template data-clerk --allowlist "127.0.0.1" 2>&1)
log '```'
log "$HIRE_OUT"
log '```'
TOKEN=$(echo "$HIRE_OUT" | grep -E '^\s+[A-Za-z0-9_-]{43}$' | tail -1 | xargs)
log ""
log "Hiring token captured: $([ -n "$TOKEN" ] && echo YES || echo NO)"
log ""

# ── 4. enqueue the two demo tasks (extraction + gated form fill) ─────────
log "## Beat 2 — enqueue demo tasks via the employee API"
ENQ=$(curl -s -X POST "http://127.0.0.1:$API_PORT/api/employee/tasks" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d "{\"employeeId\":\"data-clerk\",\"type\":\"browser_task\",\"objective\":\"Read the price list and extract every product name with its price into JSON: {\\\"items\\\":[{\\\"name\\\":string,\\\"price\\\":number}]}\",\"url\":\"http://127.0.0.1:$PAGES_PORT/list\",\"outputSchema\":{\"type\":\"object\",\"required\":[\"items\"],\"properties\":{\"items\":{\"type\":\"array\",\"minItems\":2}}}}")
log "  extraction task: $(echo "$ENQ" | head -c 160)"
ENQ2=$(curl -s -X POST "http://127.0.0.1:$API_PORT/api/employee/tasks" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d "{\"employeeId\":\"data-clerk\",\"type\":\"browser_task\",\"objective\":\"Fill the order form with item Blue Widget, quantity 3, email clerk@example.com — then stop; the consent gate will ask a human before submitting.\",\"url\":\"http://127.0.0.1:$PAGES_PORT/form\"}")
log "  gated form task: $(echo "$ENQ2" | head -c 160)"
log ""

# ── 5. work loop until the gate parks the form task ──────────────────────
log "## Beat 3 — the employee works; the consent gate parks the form task"
GATE_TASK=""
for i in $(seq 1 60); do
  TASKS=$(curl -s -H "authorization: Bearer $TOKEN" "http://127.0.0.1:$API_PORT/api/employee/tasks")
  GATE_TASK=$(echo "$TASKS" | node -e '
    let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
      try { const t=JSON.parse(d); const g=t.find(x=>x.status==="awaiting_approval"); console.log(g?g.id:""); }
      catch { console.log(""); }
    });')
  DONE_COUNT=$(echo "$TASKS" | node -e '
    let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
      try { const t=JSON.parse(d); console.log(t.filter(x=>x.status==="done").length); }
      catch { console.log(0); }
    });')
  if [ -n "$GATE_TASK" ]; then break; fi
  sleep 2
done
log "  extraction task done: $DONE_COUNT (expect 1)"
log "  consent gate parked task: ${GATE_TASK:-none}"
log ""

# ── 6. the approval (the whole product in one click) ─────────────────────
if [ -n "$GATE_TASK" ]; then
  APPROVALS=$(curl -s -H "authorization: Bearer $TOKEN" "http://127.0.0.1:$API_PORT/api/employee/approvals" )
  log "## Beat 4 — the approval queue (what the human sees)"
  log '```'
  log "$APPROVALS" | head -c 400
  log '```'
  APPROVE=$(curl -s -X POST "http://127.0.0.1:$API_PORT/api/tasks/$GATE_TASK/approve" \
    -H "authorization: Bearer $(cat /tmp/ca-demo-sandbox/operator-token 2>/dev/null | xargs)" 2>/dev/null)
  log "  approve call: $(echo "$APPROVE" | head -c 200)"
else
  log "## Beat 4 — SKIPPED (no task reached the gate within the window)"
fi
log ""

# ── 7. audit replay ──────────────────────────────────────────────────────
log "## Beat 5 — audit trail replay (plain-language lines)"
TASKS=$(curl -s -H "authorization: Bearer $TOKEN" "http://127.0.0.1:$API_PORT/api/employee/tasks")
for TID in $(echo "$TASKS" | node -e '
  let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
    const t=JSON.parse(d); console.log(t.map(x=>x.id).join("\n"));
  });'); do
  log ""
  log "### task $TID"
  curl -s -H "authorization: Bearer $TOKEN" "http://127.0.0.1:$API_PORT/api/employee/tasks/$TID" \
    | node -e '
      let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
        try {
          const t=JSON.parse(d);
          console.log("  status: " + t.status);
          if (t.output) console.log("  output: " + JSON.stringify(t.output).slice(0, 200));
          for (const l of (t.logs||[]).slice(-6)) console.log("  [" + l.phase + "] " + l.message.slice(0, 140));
        } catch { console.log("  (unparseable)"); }
      });' | tee -a "$EV"
done

# ── 8. dashboard sanity + teardown ───────────────────────────────────────
DASH=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$API_PORT/")
log ""
log "## Dashboard served by the API: HTTP $DASH"
kill "$(cat /tmp/ca-demo-api.pid)" 2>/dev/null
kill $PAGES_PID 2>/dev/null
log ""
log "Rehearsal complete — sandbox torn down. Evidence above."

cp "$EV" "$ROOT/docs/demo-rehearsal-evidence.md" && echo "evidence copied to consentark/docs/demo-rehearsal-evidence.md"
