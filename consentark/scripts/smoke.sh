#!/usr/bin/env bash
# Self-contained Phase 1 smoke test: mock LLM + real API + full chat flow.
set -u
cd "$(dirname "$0")/../apps/api"

# 1) Mock OpenAI-compatible backend on :4999
node -e 'const http=require("http");http.createServer((req,res)=>{res.setHeader("content-type","application/json");res.setHeader("x-routed-via","mock/provider");res.end(JSON.stringify({model:"mock-model",choices:[{message:{role:"assistant",content:JSON.stringify({steps:["wave"],reply:"Hello! I am your AI employee."})}}],usage:{prompt_tokens:5,completion_tokens:8,total_tokens:13}}))}).listen(4999,()=>console.log("[mock-llm] up on :4999"))' &
MOCK_PID=$!
trap 'kill $API_PID $MOCK_PID 2>/dev/null' EXIT
sleep 1

# 2) Real API on :4400, pointed at the mock as its "cloud" backend
PORT=4400 LOG_LEVEL=warn ADMIN_TOKEN=smoke-token-123456 FREELLMAPI_URL=http://localhost:4999/v1 node dist/index.js &
API_PID=$!
for i in $(seq 1 20); do curl -s -m 1 http://localhost:4400/api/health >/dev/null 2>&1 && break; sleep 0.5; done

TOKEN="Authorization: Bearer smoke-token-123456"

echo "=== HEALTH (unauthenticated) ==="
curl -s http://localhost:4400/api/health
echo; echo

echo "=== /api/employees WITHOUT token (expect 401) ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4400/api/employees
echo

echo "=== HIRE employee ==="
HIRE=$(curl -s -X POST http://localhost:4400/api/employees -H "$TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Smoke Clerk","role":"data_clerk","systemPrompt":"You are a smoke-test clerk. Always reply as JSON with steps and reply."}')
echo "$HIRE"
EMP=$(printf '%s' "$HIRE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
echo

echo "=== CHAT (creates task, worker runs it) ==="
CHAT=$(curl -s -X POST "http://localhost:4400/api/employees/$EMP/chat" -H "$TOKEN" -H 'content-type: application/json' \
  -d '{"message":"Introduce yourself."}')
echo "$CHAT"
TSK=$(printf '%s' "$CHAT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
echo

sleep 3
echo "=== TASK DETAIL: status, output, human-readable audit trail ==="
curl -s "http://localhost:4400/api/tasks/$TSK" -H "$TOKEN" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=JSON.parse(d);console.log("status: ",t.status);console.log("output: ",JSON.stringify(t.output));console.log("audit trail:");t.logs.forEach(l=>console.log("  ["+l.phase+"] "+l.message))})'
echo

echo "=== TEAM listing ==="
curl -s http://localhost:4400/api/employees -H "$TOKEN" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{JSON.parse(d).forEach(e=>console.log(e.id,"|",e.role,"|",e.backend,"| tasksCompleted:",e.tasksCompleted,"| confirmBeforeSubmit:",e.confirmBeforeSubmit))})'
echo
echo "SMOKE COMPLETE"
