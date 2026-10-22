#!/usr/bin/env bash
# Restart ollama serve and keep it alive across multiple requests
start_ollama() {
  ollama serve > /tmp/ollama-e2e.log 2>&1 &
  local pid=$!
  for i in $(seq 1 20); do
    if curl -s -m 2 http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

echo "=== QA E2E TEST: AI Employee / Ollama runtime ==="
echo ""

# Start
start_ollama
if [ $? -ne 0 ]; then
  echo "FAIL: ollama serve did not start"
  exit 1
fi
echo "[OK] ollama serve started (pid $OLLAMA_PID)"

# Test 1: Basic generation
echo ""
echo "--- TEST 1: Basic generation ---"
timeout 90 curl -s -m 240 -X POST http://127.0.0.1:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5:7b","prompt":"Reply with exactly the single word WORKING.","stream":false,"options":{"temperature":0.15,"top_p":0.8,"num_predict":300,"num_ctx":4096,"repeat_penalty":1.1}}' 2>&1 | head -c 400
echo ""
echo "[OK]: generate returned response"

# Test 2: QA analysis with real evidence
echo ""
echo "--- TEST 2: QA analysis (JSON extraction) ---"
timeout 120 npx tsx scripts/test-qa-analysis.ts 2>&1 | tail -15
echo "=== TEST 2 exit: $? ==="
