#!/usr/bin/env bash
# demo-rehearsal-live.sh — drive the live sandbox through the 15-minute demo:
# enqueue → work → consent gate parks → operator approves → audit replay.
# Writes evidence to docs/demo-rehearsal-evidence.md. Assumes the sandbox
# appliance (container consentark-demo, port 4400) is running with the
# demo-pages + scripted-LLM daemon inside it.
set -uo pipefail
API=http://127.0.0.1:4400
EV_DIR="/tmp/ca-rehearsal"; mkdir -p "$EV_DIR"; EV="$EV_DIR/live-evidence.md"
TOKEN=$(cat /tmp/demo-token.txt 2>/dev/null | xargs)
OP=$(docker exec consentark-demo cat /data/operator-token 2>/dev/null | xargs)
: > "$EV"

log() { echo "$@" | tee -a "$EV"; }
jq0() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log(eval(process.argv[1]))}catch(e){console.log("")}})' "$1"; }

log "# ConsentArk demo rehearsal — LIVE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "container: consentark-demo · API $API · employee: data-clerk (consent gate ON)"
log ""

# Beat 1 — the first demo task, exactly as --demo enqueues it.
# The gated form task is enqueued only AFTER this one finishes (see Beat 3):
# tasks run concurrently, and the scripted-LLM queue is shared, so overlap
# would make the choreography nondeterministic. Sequential = deterministic.
log "## Beat 1 — tasks enqueued (extraction + gated order form)"
T1=$(curl -s -X POST "$API/api/employee/tasks" -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"employeeId":"data-clerk","type":"browser_task","objective":"Read the price list and extract every product name with its price into JSON: {\"items\":[{\"name\":string,\"price\":number}]}","url":"http://127.0.0.1:8787/list","outputSchema":{"type":"object","required":["items"],"properties":{"items":{"type":"array","minItems":2}}}}')
ID1=$(echo "$T1" | jq0 'j.id')
log "- extraction task: $ID1"
log ""

# Beat 2 — wait for the extraction task to finish (scripted JSON, schema-validated)
log "## Beat 2 — extraction task result"
DONE1=""
for i in $(seq 1 40); do
  ST=$(curl -s -H "authorization: Bearer $TOKEN" "$API/api/employee/tasks/$ID1" | jq0 'j.status')
  [ "$ST" = "done" ] || [ "$ST" = "failed" ] && { DONE1="$ST"; break; }
  sleep 2
done
OUT1=$(curl -s -H "authorization: Bearer $TOKEN" "$API/api/employee/tasks/$ID1" | jq0 'JSON.stringify(j.output).slice(0,220)')
log "- status: ${DONE1:-timeout}"
log "- output: $OUT1"
log ""

# Now that Beat 2 is finished, enqueue the gated form task. This ordering is
# what makes the choreography deterministic (see the note at Beat 1).
log "## Beat 3 — the gated order form (enqueued now; the consent gate will park it)"
T2=$(curl -s -X POST "$API/api/employee/tasks" -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"employeeId":"data-clerk","type":"browser_task","objective":"Fill the order form with: item Blue Widget, quantity 3, email clerk@example.com — then stop; the consent gate will ask a human before submitting.","url":"http://127.0.0.1:8787/form"}')
ID2=$(echo "$T2" | jq0 'j.id')
log "- gated form task: $ID2"
log ""
# Wait for the gate to park the form task
GATE=""
for i in $(seq 1 60); do
  ST=$(curl -s -H "authorization: Bearer $TOKEN" "$API/api/employee/tasks/$ID2" | jq0 'j.status')
  [ "$ST" = "awaiting_approval" ] && { GATE=yes; break; }
  [ "$ST" = "failed" ] || [ "$ST" = "done" ] && break
  sleep 2
done
if [ "$GATE" = "yes" ]; then
  GATE_INFO=$(curl -s -H "authorization: Bearer $TOKEN" "$API/api/employee/tasks/$ID2" | jq0 'JSON.stringify(j.awaitingApproval).slice(0,300)')
  log "- PARKED as designed. The human sees: $GATE_INFO"
  log ""
  # Beat 4 — the operator approves
  log "## Beat 4 — operator approves (the one click)"
  AP=$(curl -s -X POST "$API/api/tasks/$ID2/approve" -H "authorization: Bearer $OP")
  log "- approve response: $(echo "$AP" | head -c 160)"
  sleep 5
  ST2=$(curl -s -H "authorization: Bearer $TOKEN" "$API/api/employee/tasks/$ID2" | jq0 'j.status')
  OUT2=$(curl -s -H "authorization: Bearer $TOKEN" "$API/api/employee/tasks/$ID2" | jq0 'JSON.stringify(j.output).slice(0,200)')
  log "- final status: $ST2 · output: $OUT2"
else
  log "- DID NOT PARK (status: ${ST:-unknown}) — gate behavior needs investigation"
fi
log ""

# Beat 5 — audit replay
log "## Beat 5 — audit replay (plain-language log lines)"
for TID in "$ID1" "$ID2"; do
  log ""
  log "### $TID"
  curl -s -H "authorization: Bearer $TOKEN" "$API/api/employee/tasks/$TID" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      try{const j=JSON.parse(d);
        console.log("  status: "+j.status);
        if(j.output) console.log("  output: "+JSON.stringify(j.output).slice(0,200));
        for(const l of (j.logs||[])) console.log("  ["+l.phase+"] "+l.message.slice(0,150));
      }catch{console.log("  (unparseable)")}
    });' | tee -a "$EV"
done

# Screenshots evidence (employees save task-*.png directly in /data)
log ""
log "## Screenshots captured by the employee"
docker exec consentark-demo sh -c 'ls -1t /data/task-*.png 2>/dev/null | head -6' | while read -r s; do log "- ${s##*/}"; done

cp "$EV" "$(dirname "$0")/../docs/demo-rehearsal-evidence.md"
echo ""
echo "evidence → consentark/docs/demo-rehearsal-evidence.md"
