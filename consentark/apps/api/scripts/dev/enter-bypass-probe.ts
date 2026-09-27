/**
 * development aid — not part of the audited execution path.
 *
 * Reproduces the Enter-bypass regression test exactly and dumps the
 * in-page step log + audit trail, so gate behavior can be inspected
 * without re-running the whole suite.
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

const ENTER_FORM_HTML = `<!doctype html><html><head><title>EnterForm</title></head><body>
  <h1>Enter test</h1>
  <form id="f" action="#" onsubmit="document.getElementById('out').textContent='SUBMITTED';return false">
    <input id="who" name="fullname" placeholder="Your name" />
    <button id="go" type="submit">Submit order</button>
  </form>
  <div id="out" role="status"></div>
</body></html>`;

async function main(): Promise<void> {
  const staticServer = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(ENTER_FORM_HTML);
  });
  await new Promise<void>((r) => staticServer.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(staticServer.address() as AddressInfo).port}`;

  const dataDir = mkdtempSync(join(tmpdir(), "ca-enter-probe-"));
  const script: ScriptedToolCall[] = [
    { name: "input_text", args: { index: 0, text: "Grace Hopper\n" } },
    { name: "done", args: { text: "filled", success: true } },
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
  employees.create("emp_probe", {
    name: "Probe Clerk",
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

  const task = tasks.create("tsk_probe", "emp_probe", {
    employeeId: "emp_probe",
    type: "browser_task",
    objective: "Fill the name field.",
    url: `${origin}/enter`,
  }, now);

  await (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(task.id);

  const final = tasks.get(task.id)!;
  console.log("=== status ===", final.status);
  console.log("=== awaitingApproval ===", JSON.stringify(final.awaitingApproval));
  console.log("=== error ===", JSON.stringify(final.error));
  console.log("=== logs ===");
  for (const l of final.logs) {
    console.log(`[${l.phase}] ${l.message}`);
  }

  rmSync(dataDir, { recursive: true, force: true });
  await mock.close();
  await new Promise<void>((r) => staticServer.close(() => r()));
  process.exit(0);
}

void main();
