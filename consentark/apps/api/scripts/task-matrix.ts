/**
 * Task matrix — the three-task comparison harness (mock baseline vs real model).
 *
 *   npx tsx scripts/task-matrix.ts                # auto: real model if key, else mock
 *   npx tsx scripts/task-matrix.ts --force-mock   # pin the scripted-mock baseline
 *
 * Runs the same three tasks through the PRODUCTION browser path
 * (BrowserService → LLM proxy), once against the scripted mock
 * (deterministic known-good baseline) and once against the real
 * FreeLLMAPI model (when the key exists) — identical tasks, identical
 * success criteria, so the real-model run has an honest comparison.
 *
 *   T1 extraction:  price list → schema-validated JSON
 *   T2 form fill:   fill 3 fields (no submit click) → done
 *   T3 gated submit: fill 3 fields + click submit → gate MUST park, then
 *                    the harness approves, task completes.
 *                    Mock failure = the harness/gate broke, not the model.
 *
 * Output: docs/task-matrix-<mode>.md + docs/task-matrix-latest.md
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { config as dotenv } from "dotenv";
import { join, resolve } from "node:path";
import { BrowserService } from "../src/browser/BrowserService.js";
import { startMockLlm } from "../src/browser/mockLlm.js";
import { configSchema } from "../src/config/env.js";

// ── env (consentark/.env, LLM block only — keycheck's pattern) ──────────
for (const p of [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]) {
  dotenv({ path: p, quiet: true });
}
const llmCfg = configSchema
  .pick({ FREELLMAPI_URL: true, FREELLMAPI_KEY: true, FREELLMAPI_MODEL: true, FREELLMAPI_TIMEOUT_MS: true })
  .parse({
    FREELLMAPI_URL: process.env.FREELLMAPI_URL,
    FREELLMAPI_KEY: process.env.FREELLMAPI_KEY,
    FREELLMAPI_MODEL: process.env.FREELLMAPI_MODEL,
    FREELLMAPI_TIMEOUT_MS: process.env.FRELLMAPI_TIMEOUT_MS,
  });

const FORCE_MOCK = process.argv.includes("--force-mock");
const MODE: "mock" | "real" = llmCfg.FREELLMAPI_KEY && !FORCE_MOCK ? "real" : "mock";

interface TaskResult {
  id: string;
  name: string;
  ok: boolean;
  criteria: string[];
  steps: number;
  llmCalls: { status: number; ms: number }[];
  gate: { parked: boolean; approved: boolean; summary: string } | null;
  durationMs: number;
}

// ── demo pages (same content shape the demo sandbox serves) ─────────────
const LIST_HTML = `<!doctype html><html><head><title>Acme Price List</title></head><body>
<h1>Acme Supplies — Price List</h1>
<table id="prices">
<tr><th>Product</th><th>Price</th></tr>
<tr><td>Blue Widget</td><td>4.50</td></tr>
<tr><td>Red Gears</td><td>12.00</td></tr>
<tr><td>Steel Bolts</td><td>1.20</td></tr>
<tr><td>Copper Wire</td><td>7.75</td></tr>
</table></body></html>`;

const FORM_HTML = `<!doctype html><html><head><title>Acme Order Form</title></head><body>
<h1>Acme Supplies — Order Form</h1>
<form id="order" onsubmit="document.getElementById('confirmation').textContent='ORDER RECEIVED';return false">
<label>Item <input id="item" name="item" type="text"></label>
<label>Quantity <input id="quantity" name="quantity" type="number"></label>
<label>Email <input id="email" name="email" type="email"></label>
<button id="place-order" type="submit">Place order</button>
</form>
<p id="confirmation" aria-live="polite"></p></body></html>`;

// ── harness ──────────────────────────────────────────────────────────────
let staticServer: Server | null = null;
let portOut = { port: 0 };
let origin = "";

async function startPages(): Promise<void> {
  staticServer = createServer((req, res) => {
    const path = req.url ?? "/";
    const html = path.startsWith("/form") ? FORM_HTML : LIST_HTML;
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise<void>((r) => staticServer!.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(staticServer.address() as AddressInfo).port}`;
}

async function stopPages(): Promise<void> {
  if (staticServer) {
    await new Promise<void>((r) => staticServer!.close(() => r()));
    staticServer = null;
  }
}

// ── the three tasks (mode-specific upstream, identical otherwise) ───────
const dataDir = mkdtempSync(join(tmpdir(), "ca-task-matrix-"));

async function runTask(
  label: string,
  urlPath: string,
  objective: string,
  opts: {
    outputSchema?: Record<string, unknown>;
    confirmBeforeSubmit: boolean;
    script?: Array<{ name: string; args: Record<string, unknown> }>;
    approveGate: boolean;
  },
): Promise<TaskResult> {
  const started = Date.now();
  const steps: string[] = [];
  const llmCalls: { status: number; ms: number }[] = [];
  let gateParked = false;
  let gateApproved = false;
  let gateSummary = "";
  let pendingResolve: ((d: "approved" | "cancelled") => void) | null = null;

  const upstream =
    MODE === "real"
      ? { url: llmCfg.FREELLMAPI_URL, key: llmCfg.FREELLMAPI_KEY, model: llmCfg.FREELLMAPI_MODEL }
      : { url: "http://127.0.0.1:0", key: "unused", model: "mock-model" };

  const service = new BrowserService({ poolSize: 1, timeoutMs: 180_000, maxStepsHardCap: 500 });

  let mockServer: Awaited<ReturnType<typeof startMockLlm>> | null = null;
  if (MODE === "mock") {
    mockServer = await startMockLlm(opts.script ?? [], { authRequired: false, port: 0 });
    upstream.url = mockServer!.url;
  }

  const result = await service.runTask({
    url: `${origin}${urlPath}`,
    objective,
    allowedDomains: ["127.0.0.1"],
    upstreamUrl: upstream.url,
    upstreamApiKey: upstream.key,
    llmModel: upstream.model,
    maxSteps: 8,
    confirmBeforeSubmit: opts.confirmBeforeSubmit,
    dataDir,
    onStep: (s) => {
      if (s.type === "step") steps.push(`${s.stepIndex ?? steps.length}: ${s.tool}`);
    },
    onLlmRequest: (r) => llmCalls.push({ status: r.status, ms: r.durationMs }),
    onGateTripped: (info) => {
      gateParked = true;
      gateSummary = info.summary;
    },
    onGatePending: (info, resolve) => {
      gateParked = true;
      gateSummary = info.summary;
      pendingResolve = resolve;
      if (opts.approveGate) {
        gateApproved = true;
        resolve("approved");
  }
    },
  });

  await service.close();
  if (mockServer) await mockServer.close();

  const criteria: string[] = [];
  const agentData = result.agentData || "";
  criteria.push(
    ok(result.ok)
      ? "ok=true"
      : `ok=false (${agentData.slice(0, 80)})`,
  );
  if (opts.outputSchema) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(agentData);
    } catch {
      /* keep null */
    }
    const hasItems =
      !!parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { items?: unknown }).items) &&
      (parsed as { items: unknown[] }).items.length >= 2;
    criteria.push(hasItems ? "extraction has items[>=2]" : "extraction missing/short");
  }
  criteria.push(
    opts.confirmBeforeSubmit && opts.approveGate
      ? gateParked && gateApproved
        ? "gate parked + approved"
        : "gate did NOT park/approve"
      : "no gate expected",
  );

  return {
    id: label,
    name: objective.slice(0, 58),
    ok:
      result.ok &&
      (!opts.outputSchema || criteria.some((c) => c.startsWith("extraction has"))) &&
      (!opts.confirmBeforeSubmit || !opts.approveGate || (gateParked && gateApproved)),
    criteria,
    steps: result.steps,
    llmCalls,
    gate: gateParked ? { parked: gateParked, approved: gateApproved, summary: gateSummary } : null,
    durationMs: Date.now() - started,
  };
}

function ok(b: boolean): boolean {
  return b;
}

const T1_SCRIPT = [
  { name: "done", args: { text: '{"items":[{"name":"Blue Widget","price":4.5},{"name":"Red Gears","price":12},{"name":"Steel Bolts","price":1.2},{"name":"Copper Wire","price":7.75}]}', success: true } },
];

const T2_SCRIPT = [
  { name: "input_text", args: { index: 1, text: "Blue Widget" } },
  { name: "input_text", args: { index: 3, text: "3" } },
  { name: "input_text", args: { index: 5, text: "clerk@example.com" } },
  { name: "done", args: { text: "Filled the order form fields (no submission).", success: true } },
];

const T3_SCRIPT = [
  { name: "input_text", args: { index: 1, text: "Blue Widget" } },
  { name: "input_text", args: { index: 3, text: "3" } },
  { name: "input_text", args: { index: 5, text: "clerk@example.com" } },
  { name: "click_element_by_index", args: { index: 6 } },
  { name: "done", args: { text: "Order placed: Blue Widget x3 for clerk@example.com.", success: true } },
];

async function main(): Promise<void> {
  await startPages();
  const results: TaskResult[] = [];
  results.push(
    await runTask("T1", "/list",
      'Read the price list and extract every product name with its price into JSON: {"items":[{"name":string,"price":number}]}',
      {
        outputSchema: { type: "object", required: ["items"] },
        confirmBeforeSubmit: false,
        script: MODE === "mock" ? T1_SCRIPT : undefined,
        approveGate: false,
      },
    ),
  );
  results.push(
    await runTask("T2", "/form",
      "Fill the order form: item Blue Widget, quantity 3, email clerk@example.com — fill only, do NOT submit.",
      {
        confirmBeforeSubmit: false,
        script: MODE === "mock" ? T2_SCRIPT : undefined,
        approveGate: false,
      },
    ),
  );
  results.push(
    await runTask("T3", "/form",
      'Fill the order form: item Blue Widget, quantity 3, email clerk@example.com — then click "Place order".',
      {
        confirmBeforeSubmit: true,
        script: MODE === "mock" ? T3_SCRIPT : undefined,
        approveGate: true,
      },
    ),
  );
  await stopPages();

  // ── report ─────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const verdict = results.every((r) => r.ok) ? "ALL THREE TASKS PASS" : "FAILURES PRESENT";
  const lines = [
    `# Task matrix — ${MODE === "real" ? "REAL MODEL" : "scripted mock baseline"}`,
    "",
    `Run: ${stamp} · harness: task-matrix.ts (production path: BrowserService → LLM proxy)`,
    "",
    "| Task | Result | Steps | LLM calls | Gate | ms |",
    "|---|---|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${r.id} ${r.name} | ${r.ok ? "PASS" : "FAIL"} — ${r.criteria.join("; ")} | ${r.steps} | ${r.llmCalls.map((c) => `${c.status} in ${c.ms}ms`).join(", ") || "n/a"} | ${r.gate ? `${r.gate.parked ? "parked" : "no"}/${r.gate.approved ? "approved" : "not approved"}` : "—"} | ${r.durationMs} |`,
    ),
    "",
    `## Verdict: ${verdict}`,
    "",
    MODE === "mock"
      ? "Baseline side of the comparison. The real-model run must meet the same criteria through the same harness (`npx tsx scripts/task-matrix.ts` with the key in .env)."
      : "Real-model side. Compare against the mock baseline in task-matrix-mock.md.",
  ];
  const report = lines.join("\n") + "\n";
  const docDir = resolve(process.cwd(), "../../docs");
  writeFileSync(join(docDir, `task-matrix-${MODE === "real" ? "real" : "mock"}.md`), report);
  writeFileSync(join(docDir, "task-matrix-latest.md"), report);
  console.log(report);
  console.log(`written: docs/task-matrix-${MODE}.md + docs/task-matrix-latest.md`);

  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error("task matrix crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
