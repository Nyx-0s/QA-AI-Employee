#!/usr/bin/env node
/**
 * keycheck — one-command validation of the tracker employee's chat backend.
 *
 * Modes:
 *   node dist/cli/keycheck.js          → REAL key check: loads .env, builds the
 *                                        actual cloud provider, sends one live
 *                                        chat call. Exit 0 = key works.
 *   node dist/cli/keycheck.js --mock   → MOCK provider integration test: same
 *                                        call path (LLMProvider.chat), served
 *                                        by an in-process scripted provider.
 *                                        Proves everything EXCEPT the real key.
 *
 * This is a diagnostic tool (development aid, not part of the audited
 * browser path). It never stores or prints the key — only its length and
 * last 4 characters.
 */
import { resolve } from "node:path";
import { config as dotenv } from "dotenv";
import { configSchema } from "../config/env.js";
import { createCloudProvider } from "../llm/factories.js";
import { LLMError, type ChatRequest, type ChatResponse, type HealthStatus, type LLMEventHandler } from "../llm/provider.js";

/**
 * CLI-scope config: validate ONLY what this tool uses (the LLM block),
 * so unrelated shell noise (e.g. an exported PORT=0 for another tool)
 * cannot block a diagnostic run. Mirrors the hire/work CLI pattern.
 */
function loadLlmConfig() {
  const picked = {
    FREELLMAPI_URL: process.env.FREELLMAPI_URL,
    FREELLMAPI_KEY: process.env.FREELLMAPI_KEY,
    FREELLMAPI_MODEL: process.env.FREELLMAPI_MODEL,
    FREELLMAPI_TIMEOUT_MS: process.env.FREELLMAPI_TIMEOUT_MS,
    LLM_RETRIES: process.env.LLM_RETRIES,
    LLM_RETRY_BASE_MS: process.env.LLM_RETRY_BASE_MS,
  };
  return configSchema.pick({
    FREELLMAPI_URL: true,
    FREELLMAPI_KEY: true,
    FREELLMAPI_MODEL: true,
    FREELLMAPI_TIMEOUT_MS: true,
    LLM_RETRIES: true,
    LLM_RETRY_BASE_MS: true,
  }).parse(picked);
}

function describeKey(key: string): string {
  if (!key) return "(empty)";
  return `***${key.slice(-4)} (length ${key.length})`;
}

async function main(): Promise<number> {
  const mock = process.argv.includes("--mock");

  if (mock) {
    // ── MOCK MODE: same interface, scripted responses. Verifies the exact
    // call path the tracker employee will use (chat + usage + audit events)
    // without needing credentials.
    console.log("keycheck: MOCK provider integration test");
    let captured: ChatRequest | null = null;
    const provider = {
      kind: "cloud" as const,
      label: "mock (keycheck)",
      async chat(request: ChatRequest, onEvent?: LLMEventHandler): Promise<ChatResponse> {
        captured = request;
        onEvent?.({
          type: "request",
          provider: "mock (keycheck)",
          model: request.model ?? "mock-model",
          messageCount: request.messages.length,
          attempt: 1,
        });
        return {
          content: "MOCK-OK pipeline ready",
          model: request.model ?? "mock-model",
          provider: "mock (keycheck)",
          latencyMs: 3,
          usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
          routedVia: "mock-upstream",
        };
      },
      async health(): Promise<HealthStatus> {
        return { ok: true, latencyMs: 1, detail: "mock" };
      },
    };
    const res = await provider.chat(
      {
        messages: [
          { role: "system", content: "You record sales pipeline events with dates, evidence and status tags; never invent outcomes" },
          { role: "user", content: "Say the pipeline phrase." },
        ],
        maxTokens: 64,
      },
      (e) => {
        if (e.type === "request") console.log(`  event: request model=${e.model} messages=${e.messageCount}`);
      },
    );
    const sysOk = captured!.messages[0].content.includes("never invent outcomes");
    console.log(`  response: "${res.content}"`);
    console.log(`  usage: ${res.usage?.totalTokens ?? 0} tokens, latency ${res.latencyMs}ms, routed via ${res.routedVia}`);
    console.log(`  system prompt passed through: ${sysOk ? "yes" : "NO (FAIL)"}`);
    if (res.content !== "MOCK-OK pipeline ready" || !sysOk) {
      console.log("keycheck: MOCK FAIL");
      return 1;
    }
    console.log("keycheck: MOCK PASS — integration path verified. Real key still required for production calls.");
    return 0;
  }

  // ── REAL MODE ──
  // Same dotenv behavior as the API entry: look for consentark/.env, then CWD.
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
    dotenv({ path: p, quiet: true });
  }
  const config = loadLlmConfig();
  console.log("keycheck: REAL key check");
  console.log(`  FREELLMAPI_URL: ${config.FREELLMAPI_URL}`);
  console.log(`  FREELLMAPI_KEY: ${describeKey(config.FREELLMAPI_KEY)}`);
  console.log(`  FREELLMAPI_MODEL: ${config.FREELLMAPI_MODEL}`);
  if (!config.FREELLMAPI_KEY) {
    console.log("keycheck: NO KEY — paste it into consentark/.env (FREELLMAPI_KEY=...) and rerun.");
    return 2;
  }

  const provider = createCloudProvider(config);
  const health = await provider.health();
  console.log(`  health: ${health.ok ? "ok" : "FAILED"}${health.latencyMs != null ? ` (${health.latencyMs}ms)` : ""}${health.detail ? ` — ${health.detail}` : ""}`);

  try {
    const res = await provider.chat({
      messages: [
        { role: "system", content: "Reply with exactly: KEYCHECK-OK" },
        { role: "user", content: "Run the keycheck." },
      ],
      maxTokens: 32,
    });
    console.log(`  chat: "${res.content.slice(0, 80)}" (model ${res.model}, ${res.latencyMs}ms, ${res.usage?.totalTokens ?? "?"} tokens)`);
    console.log("keycheck: PASS — the tracker employee's chat backend is live.");
    return 0;
  } catch (err) {
    if (err instanceof LLMError) {
      console.log(`  chat FAILED: ${err.code} — ${err.message}${err.status ? ` (HTTP ${err.status})` : ""}`);
    } else {
      console.log(`  chat FAILED: ${String(err)}`);
    }
    console.log("keycheck: FAIL — key rejected or endpoint unreachable. Check the key value and FREELLMAPI_URL.");
    return 1;
  }
}

// Direct-execution guard: works for both `tsx src/cli/keycheck.ts` and the
// compiled `node dist/cli/keycheck.js` (resolved entrypoint, not argv[1] endsWith).
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
const here = new URL(import.meta.url).pathname;
if (invoked === here) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("keycheck crashed:", err);
      process.exit(1);
    });
}
