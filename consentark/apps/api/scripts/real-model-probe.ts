/**
 * Real-model probe (manual, NOT CI) — the small-model reality check.
 *
 * ⚠️ UNTESTED WITH A REAL MODEL: no FreeLLMAPI key exists in this
 * environment. This script is ready to run the moment a key is set:
 *
 *   FREELLMAPI_URL=http://localhost:3001/v1 FREELLMAPI_KEY=sk-... \
 *   FREELLMAPI_MODEL=auto npx tsx scripts/real-model-probe.ts
 *
 * It runs ONE real browser task through the employee's production path
 * (BrowserService → LLM proxy → FreeLLMAPI) against a local form page, so
 * the only real dependency is the model itself.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { config as dotenv } from "dotenv";
import { join, resolve } from "node:path";
import { BrowserService } from "../src/browser/BrowserService.js";
import { configSchema, loadConfig } from "../src/config/env.js";

const FORM_HTML = `<!doctype html><html><head><title>Real-model probe</title></head><body>
  <h1>Register</h1>
  <form onsubmit="return false">
    <input id="who" name="fullname" placeholder="Your name" />
    <input id="mail" name="email" placeholder="Email address" />
    <button id="go" type="button">Submit form</button>
  </form>
  <div id="out" role="status"></div>
  <script>
    document.getElementById('go').addEventListener('click', () => {
      document.getElementById('out').textContent =
        'Registered ' + document.getElementById('who').value;
    });
  </script>
</body></html>`;

async function main(): Promise<void> {
  // Load consentark/.env (then CWD), mirroring the API entry and keycheck.
  for (const p of [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]) {
    dotenv({ path: p, quiet: true });
  }
  // Validate ONLY the LLM block (keycheck's pattern): this diagnostic must
  // not care about unrelated shell exports (e.g. PORT=0 from a wrapper).
  const config = configSchema
    .pick({
      FREELLMAPI_URL: true,
      FREELLMAPI_KEY: true,
      FREELLMAPI_MODEL: true,
      FREELLMAPI_TIMEOUT_MS: true,
    })
    .parse({
      FREELLMAPI_URL: process.env.FREELLMAPI_URL,
      FREELLMAPI_KEY: process.env.FREELLMAPI_KEY,
      FREELLMAPI_MODEL: process.env.FREELLMAPI_MODEL,
      FREELLMAPI_TIMEOUT_MS: process.env.FREELLMAPI_TIMEOUT_MS,
    });
  if (!config.FREELLMAPI_KEY) {
    console.error(
      "No FREELLMAPI_KEY configured — paste it into consentark/.env (FREELLMAPI_KEY=...) and re-run.",
    );
    process.exit(1);
  }
  console.log(`backend: ${config.FREELLMAPI_URL} (model: ${config.FREELLMAPI_MODEL})`);

  const staticServer = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(FORM_HTML);
  });
  await new Promise<void>((r) => staticServer.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(staticServer.address() as AddressInfo).port}`;

  const dataDir = mkdtempSync(join(tmpdir(), "ca-real-model-"));
  const service = new BrowserService({
    poolSize: 1,
    timeoutMs: 180_000, // real models are slow; generous ceiling
    maxStepsHardCap: 500,
  });

  const steps: string[] = [];
  const result = await service.runTask({
    url: `${origin}/form`,
    objective:
      "Register the user 'Ada Lovelace' with email 'ada@example.com' in the form, then click the submit button.",
    allowedDomains: ["127.0.0.1"],
    upstreamUrl: config.FREELLMAPI_URL,
    upstreamApiKey: config.FREELLMAPI_KEY,
    llmModel: config.FREELLMAPI_MODEL,
    maxSteps: 8,
    confirmBeforeSubmit: false, // keep the probe single-shot; gate is tested in CI
    dataDir,
    onStep: (step) => {
      if (step.type === "step") {
        steps.push(`${step.stepIndex ?? steps.length}: ${step.tool}`);
        console.log(`  step ${steps.length}: ${step.tool}`);
      }
    },
    onLlmRequest: (r) =>
      console.log(`  llm: ${r.status} in ${r.durationMs}ms (${r.promptChars} chars, model ${r.model})`),
    onGateTripped: (info) => console.log(`  gate: ${info.summary}`),
  });

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(
    {
      ok: result.ok,
      agentSuccess: result.agentSuccess,
      agentData: result.agentData.slice(0, 200),
      steps: result.steps,
      llmRequests: result.llmRequests.map((r) => ({ status: r.status, ms: r.durationMs })),
    },
    null,
    2,
  ));
  console.log(`\nscreenshots in ${dataDir}`);
  console.log("SUCCESS CRITERIA: ok=true AND agentData mentions Ada Lovelace.");

  await service.close();
  staticServer.close();
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("real-model probe failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
