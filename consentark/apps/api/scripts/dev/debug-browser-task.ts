/**
 * development aid — not part of the audited execution path.
 *
 * Runs one happy-path browser task through the production harness and dumps
 * the full task record (error, output, screenshots, audit log). Lives under
 * scripts/dev/ for exactly that reason.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockLlm, type ScriptedToolCall } from "../../src/browser/mockLlm.js";
import { loadConfig } from "../../src/config/env.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { TaskRepository } from "../../src/db/repositories/tasks.js";
import { EmployeeRepository } from "../../src/db/repositories/employees.js";
import { MemoryTaskQueue } from "../../src/queue/memoryQueue.js";
import { TaskRunner } from "../../src/queue/taskRunner.js";
import { createProviders } from "../../src/llm/factories.js";

const FORM_HTML = `<!doctype html><html><head><title>T</title></head><body>
  <form onsubmit="return false">
    <input id="who" placeholder="Your name" />
    <input id="mail" placeholder="Email" />
    <button id="go" type="button">Submit form</button>
  </form>
  <div id="out"></div>
  <script>
    document.getElementById('go').addEventListener('click', (e) => {
      document.getElementById('out').textContent = 'Registered ' + document.getElementById('who').value;
    });
  </script>
</body></html>`;

async function main(): Promise<void> {
  const staticServer = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(FORM_HTML);
  });
  await new Promise<void>((r) => staticServer.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(staticServer.address() as AddressInfo).port}`;

  const dataDir = mkdtempSync(join(tmpdir(), "ca-debug-"));
  const script: ScriptedToolCall[] = [
    { name: "input_text", args: { index: 0, text: "Grace Hopper" } },
    { name: "input_text", args: { index: 1, text: "grace@navy.mil\n" } },
    { name: "click_element_by_index", args: { index: 2 } },
    { name: "done", args: { text: "Registration complete for Grace Hopper.", success: true } },
  ];
  const mock = await startMockLlm(script, { authRequired: true, expectedApiKey: "mock-key" });

  const config = loadConfig({
    DATA_DIR: dataDir,
    ADMIN_TOKEN: "test-admin-token",
    LOG_LEVEL: "error",
    FREELLMAPI_URL: mock.url,
    FREELLMAPI_KEY: "mock-key",
    FREELLMAPI_MODEL: "mock-model",
    BROWSER_POOL_SIZE: "1",
    BROWSER_TIMEOUT_MS: "30000",
    BROWSER_MAX_STEPS_HARD_CAP: "500",
    WORKER_CONCURRENCY: "1",
  } as NodeJS.ProcessEnv);
  const db = openDatabase(config.DATA_DIR);
  const tasks = new TaskRepository(db);
  const employees = new EmployeeRepository(db);
  const now = new Date().toISOString();
  employees.create("emp_dbg", {
    name: "Debug Clerk",
    role: "data_clerk",
    description: "",
    systemPrompt: "x",
    backend: "cloud",
    model: "mock-model",
    toolsEnabled: ["browser_task"],
    allowedDomains: ["127.0.0.1"],
    confirmBeforeSubmit: true,
    maxStepsPerTask: 6,
    schedule: null,
  }, now);
  const runner = new TaskRunner(config, new MemoryTaskQueue(), createProviders(config), tasks, employees);

  const task = tasks.create("tsk_dbg", "emp_dbg", {
    employeeId: "emp_dbg",
    type: "browser_task",
    objective: "Register Grace Hopper, then submit.",
    url: `${origin}/form`,
  }, now);

  await (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(task.id);

  const final = tasks.get(task.id)!;
  console.log("=== status ===", final.status);
  console.log("=== error ===", JSON.stringify(final.error, null, 2));
  console.log("=== output ===", JSON.stringify(final.output, null, 2));
  console.log("=== screenshots ===", final.screenshots);
  console.log("=== logs ===");
  for (const l of final.logs) {
    console.log(`[${l.level}] (${l.phase}) ${l.message}`);
  }

  // NOTE: expected outcome is a gate pause ("awaiting human approval" on the
  // newline input), then agent_timeout after 30 s — this aid never approves.
  // The gate behavior itself is covered E2E by test/browserTask.test.ts.
  console.log("(dev aid: no approval is sent — the agent_timeout above is expected)");

  await runner.stop();
  await mock.close();
  staticServer.close();
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
}

main().catch((err) => {
  console.error("debug failed:", err);
  process.exit(1);
});
