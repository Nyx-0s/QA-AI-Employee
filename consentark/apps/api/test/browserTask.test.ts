import { describe, it, expect, afterAll, beforeAll, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockLlm, type MockLlmServer, type ScriptedToolCall } from "../src/browser/mockLlm.js";
import { BrowserService, BrowserError } from "../src/browser/BrowserService.js";
import { TaskRunner } from "../src/queue/taskRunner.js";
import { loadConfig } from "../src/config/env.js";
import { openDatabase } from "../src/db/sqlite.js";
import { TaskRepository } from "../src/db/repositories/tasks.js";
import { EmployeeRepository } from "../src/db/repositories/employees.js";
import { MemoryTaskQueue } from "../src/queue/memoryQueue.js";
import { createProviders } from "../src/llm/factories.js";
import type { Task } from "@consentark/shared";

// Re-exported for the (unused-in-CI) live gate below.
export { BrowserError };

/**
 * Phase 2 browser-task E2E — CI-safe: headless Chromium + scripted mock LLM +
 * local static/dynamic pages. No external sites, no API keys.
 *
 * Covers the seven required scenarios:
 *  (a) happy-path form task → done
 *  (b) confirm gate → awaiting_approval → approve → done
 *  (c) confirm gate → cancel → cancelled
 *  (d) allowedDomains enforced (enqueue via routes test; navigation here)
 *  (e) maxSteps exceeded → distinct error code
 *  (f) extraction with outputSchema validation (match + mismatch)
 *  (g) audit trail contains llm + browser phases
 */

// ---------------------------------------------------------------------------
// Static test pages
// ---------------------------------------------------------------------------

/** (a)/(b)/(c): a form whose submit button reports the submit happened. */
const FORM_HTML = (id: string): string => `<!doctype html><html><head><title>T${id}</title></head><body>
  <h1>Register</h1>
  <form onsubmit="return false">
    <input id="who" name="fullname" placeholder="Your name" />
    <input id="mail" name="email" placeholder="Email address" />
    <button id="go" type="submit">Submit order</button>
  </form>
  <div id="out" role="status"></div>
  <script>
    document.getElementById('go').addEventListener('click', () => {
      document.getElementById('out').textContent =
        'Registered ' + document.getElementById('who').value;
    });
  </script>
</body></html>`;

/** (e): an endless page — the agent never reaches a done state. */
const INFINITE_HTML = `<!doctype html><html><head><title>Endless</title></head><body>
  <div id="stage">0</div>
  <button id="inc" type="button">next</button>
  <script>
    let n = 0;
    document.getElementById('inc').addEventListener('click', () => {
      n += 1;
      document.getElementById('stage').textContent = String(n);
    });
  </script>
</body></html>`;

/**
 * Enter-bypass page: a plain form with NO click handler — the only way it
 * "submits" is HTML implicit submission (Enter in a text input). onsubmit
 * records the submission so the test can assert whether the gate caught it.
 */
const ENTER_FORM_HTML = `<!doctype html><html><head><title>EnterForm</title></head><body>
  <h1>Enter test</h1>
  <form id="f" action="#" onsubmit="document.getElementById('out').textContent='SUBMITTED';return false">
    <input id="who" name="fullname" placeholder="Your name" />
    <button id="go" type="submit">Submit order</button>
  </form>
  <div id="out" role="status"></div>
</body></html>`;

/**
 * Icon-only submit button: aria-label only, no text content, no type on the
 * button (form-descendant + explicit type=submit both make it submit-like).
 */
const ICON_HTML = `<!doctype html><html><head><title>Icon</title></head><body>
  <form onsubmit="return false">
    <input id="who" name="fullname" placeholder="Your name" />
    <button id="ico" type="submit" aria-label="Submit order">✅</button>
  </form>
</body></html>`;

/** (f): a page holding a JSON payload to extract. */
const DATA_HTML = `<!doctype html><html><head><title>Data</title></head><body>
  <h1>Q3 Report</h1>
  <p id="payload">{"quarter": "Q3", "revenue": 4200, "region": "EMEA"}</p>
</body></html>`;

/**
 * Hardening: a page that ATTACKS itself — page JS dispatches a synthetic
 * MouseEvent click on the submit button ~300 ms after load, while the agent
 * only waits. Proves the PAGE-LEVEL click blocker gates submit-like clicks
 * that never pass through the agent's click tool.
 */
const SYNTHETIC_CLICK_HTML = `<!doctype html><html><head><title>Synth</title></head><body>
  <form id="f" onsubmit="document.getElementById('out').textContent='SUBMITTED';return false">
    <input id="who" name="fullname" value="Ada"/>
    <button id="go" type="submit">Submit order</button>
  </form>
  <div id="out" role="status"></div>
  <script>
    setTimeout(() => {
      document.getElementById('go').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }));
    }, 300);
  </script>
</body></html>`;

/**
 * Hardening: same-origin iframe hosting a form that ATTACKS itself — the
 * frame's own script presses Enter (synthetic keydown) in its input ~700 ms
 * after load (after the frame watcher's first sweep). Proves the Enter
 * blocker propagates into child frames with realm-agnostic element checks.
 */
const FRAME_HOST_HTML = `<!doctype html><html><head><title>FrameHost</title></head><body>
  <iframe id="frame" src="/frame-form" width="500" height="200"></iframe>
</body></html>`;
const FRAME_FORM_HTML = `<!doctype html><html><head><title>FrameForm</title></head><body>
  <form id="ff" onsubmit="return false">
    <input id="who" name="fullname" value="Ada"/>
    <button id="go" type="submit">Submit order</button>
  </form>
  <script>
    setTimeout(() => {
      const input = document.getElementById('who');
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }, 700);
  </script>
</body></html>`;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let staticServer: Server;
let origin: string;
let dataDir: string;
let mockLlm: MockLlmServer;
let service: BrowserService;
let runner: TaskRunner;
let tasks: TaskRepository;
let employees: EmployeeRepository;

const EMPLOYEE = {
  id: "emp_test000001",
  name: "Browser Clerk",
  role: "data_clerk",
  description: "",
  systemPrompt: "You operate a browser.",
  backend: "cloud" as const,
  model: "mock-model",
  toolsEnabled: ["chat_task", "browser_task"] as const,
  allowedDomains: ["127.0.0.1"],
  confirmBeforeSubmit: true,
  maxStepsPerTask: 6,
  schedule: null,
  status: "active" as const,
  createdAt: new Date().toISOString(),
};

beforeAll(async () => {
  staticServer = createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/frame-form")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(FRAME_FORM_HTML);
      return;
    }
    const page = url.match(/^\/(form-[abc]|enter|icon|endless|data|synthetic|frame-host)$/);
    if (page) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page[1] === "endless"
          ? INFINITE_HTML
          : page[1] === "data"
            ? DATA_HTML
            : page[1] === "enter"
              ? ENTER_FORM_HTML
              : page[1] === "icon"
                ? ICON_HTML
                : page[1] === "synthetic"
                  ? SYNTHETIC_CLICK_HTML
                  : page[1] === "frame-host"
                    ? FRAME_HOST_HTML
                    : FORM_HTML(page[1]!.slice(-1)),
      );
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => staticServer.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(staticServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await service?.close().catch(() => undefined);
  await mockLlm?.close().catch(() => undefined);
  await new Promise<void>((r) => staticServer.close(() => r()));
});

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "consentark-browser-"));
  mockLlm = undefined as unknown as MockLlmServer;
});

afterEach(async () => {
  await service?.close().catch(() => undefined);
  await mockLlm?.close().catch(() => undefined);
  service = undefined as unknown as BrowserService;
  runner = undefined as unknown as TaskRunner;
  rmSync(dataDir, { recursive: true, force: true });
});

interface Harness {
  runner: TaskRunner;
  tasks: TaskRepository;
  employees: EmployeeRepository;
  config: ReturnType<typeof loadConfig>;
}

function buildRunner(
  mock: MockLlmServer,
  employeeOverrides: Partial<typeof EMPLOYEE> = {},
  envOverrides: Record<string, string> = {},
): Harness {
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
    ...envOverrides,
  } as NodeJS.ProcessEnv);
  const db = openDatabase(config.DATA_DIR);
  const tasksRepo = new TaskRepository(db);
  const employeesRepo = new EmployeeRepository(db);
  const emp = { ...EMPLOYEE, ...employeeOverrides };
  // Tests may build two runners in one test file pass — remove any prior seed.
  employeesRepo.hardDelete(emp.id);
  employeesRepo.create(emp.id, emp, emp.createdAt);
  const runner = new TaskRunner(
    config,
    new MemoryTaskQueue(),
    createProviders(config),
    tasksRepo,
    employeesRepo,
  );
  return { runner, tasks: tasksRepo, employees: employeesRepo, config };
}

/** Create a browser task row directly (route validation is covered elsewhere). */
function makeTask(overrides: Partial<Task["outputSchema"] extends never ? never : object> = {}): TaskCreateInputLite {
  return {
    employeeId: EMPLOYEE.id,
    type: "browser_task",
    objective: "Do the thing.",
    url: `${origin}/form-a`,
    ...overrides,
  };
}
interface TaskCreateInputLite {
  employeeId: string;
  type: "browser_task";
  objective: string;
  url: string;
  steps?: string[];
  outputSchema?: Record<string, unknown>;
}

async function runOne(
  mock: MockLlmServer,
  input: TaskCreateInputLite,
  employeeOverrides: Partial<typeof EMPLOYEE> = {},
): Promise<Task> {
  const h = buildRunner(mock, employeeOverrides);
  runner = h.runner;
  tasks = h.tasks;
  employees = h.employees;
  const task = h.tasks.create(
    `tsk_test_${Math.random().toString(36).slice(2, 8)}`,
    EMPLOYEE.id,
    input as never,
    new Date().toISOString(),
  );
  // Execute synchronously (worker loop is not started in these tests).
  await (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(task.id);
  return h.tasks.get(task.id)!;
}

const SCRIPT: ScriptedToolCall[] = [
  { name: "input_text", args: { index: 0, text: "Grace Hopper" } },
  { name: "input_text", args: { index: 1, text: "grace@navy.mil" } },
  { name: "click_element_by_index", args: { index: 2 } },
  { name: "done", args: { text: "Registration complete for Grace Hopper.", success: true } },
];

// ---------------------------------------------------------------------------
// (a) happy path
// ---------------------------------------------------------------------------

describe("(a) happy-path form task", () => {
  it("fills, submits, and completes with screenshots + audit trail", { timeout: 120_000 }, async () => {
    mockLlm = await startMockLlm(SCRIPT, { authRequired: true, expectedApiKey: "mock-key" });
    const task = await runOne(mockLlm, makeTask(), { confirmBeforeSubmit: false });

    expect(task.status).toBe("done");
    expect((task.output as { reply: string }).reply).toContain("Grace Hopper");
    // Screenshots: start + end (gate is off).
    expect(task.screenshots.length).toBe(2);
    for (const rel of task.screenshots) {
      expect(existsSync(join(dataDir, rel))).toBe(true);
    }
    // (g) audit trail: llm + browser phases both present.
    const phases = new Set(task.logs.map((l) => l.phase));
    expect(phases.has("llm")).toBe(true);
    expect(phases.has("browser")).toBe(true);
    // Auto-submit was recorded (confirmBeforeSubmit: false).
    expect(task.logs.some((l) => l.phase === "safety" && /auto-submit/i.test(l.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (b) + (c) consent gate
// ---------------------------------------------------------------------------

describe("(b)/(c) consent gate", () => {
  it("pauses on a submit-like click, resumes on approve, and completes", { timeout: 120_000 }, async () => {
    mockLlm = await startMockLlm(SCRIPT, { authRequired: true, expectedApiKey: "mock-key" });
    const h = buildRunner(mockLlm, { confirmBeforeSubmit: true });
    runner = h.runner;
    tasks = h.tasks;
    employees = h.employees;
    const task = h.tasks.create(
      "tsk_gate_approve",
      EMPLOYEE.id,
      makeTask() as never,
      new Date().toISOString(),
    );

    const runPromise = (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(task.id);

    // Wait for the gate to trip, then approve.
    for (let i = 0; i < 200; i++) {
      const current = h.tasks.get(task.id)!;
      if (current.status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const paused = h.tasks.get(task.id)!;
    expect(paused.status).toBe("awaiting_approval");
    expect(paused.awaitingApproval?.elementText).toMatch(/submit|order/i);
    // Gate screenshot exists (pause evidence).
    expect(paused.screenshots.some((s) => s.includes("gate-step"))).toBe(true);

    const approval = runner.approve(task.id);
    expect(approval.approved).toBe(true);

    await runPromise;

    const done = h.tasks.get(task.id)!;
    expect(done.status).toBe("done");
    expect(done.awaitingApproval).toBeNull();
    expect(done.logs.some((l) => l.phase === "safety" && /approved/i.test(l.message))).toBe(true);
  });

  it("does not kill a gated task whose approval arrives after the timeout budget (Phase 5 evidence regression)", { timeout: 120_000 }, async () => {
    mockLlm = await startMockLlm(SCRIPT, { authRequired: true, expectedApiKey: "mock-key" });
    // Budget comfortably covers total agent work (~2-4s under suite load);
    // the pre-approve wait (13s) still outlives it by a wide margin.
    const h = buildRunner(mockLlm, { confirmBeforeSubmit: true }, { BROWSER_TIMEOUT_MS: "8000" });
    runner = h.runner;
    tasks = h.tasks;
    employees = h.employees;
    const task = h.tasks.create(
      "tsk_gate_pause",
      EMPLOYEE.id,
      makeTask() as never,
      new Date().toISOString(),
    );

    const runPromise = (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(task.id);

    for (let i = 0; i < 200; i++) {
      const current = h.tasks.get(task.id)!;
      if (current.status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(h.tasks.get(task.id)!.status).toBe("awaiting_approval");

    // Outlive the ORIGINAL 8s budget while parked at the gate. Before the
    // pause/resume fix this raced agent_timeout and the approval arrived at
    // a dead task (seen live on the composed stack).
    await new Promise((r) => setTimeout(r, 13000));

    const approval = runner.approve(task.id);
    expect(approval.approved).toBe(true);
    await runPromise;

    const done = h.tasks.get(task.id)!;
    expect(done.status).toBe("done");
  });

  it("marks the task cancelled when the reviewer cancels at the gate", { timeout: 120_000 }, async () => {
    mockLlm = await startMockLlm(SCRIPT, { authRequired: true, expectedApiKey: "mock-key" });
    const h = buildRunner(mockLlm, { confirmBeforeSubmit: true });
    runner = h.runner;
    tasks = h.tasks;
    employees = h.employees;
    const task = h.tasks.create(
      "tsk_gate_cancel",
      EMPLOYEE.id,
      makeTask({ url: `${origin}/form-b` }) as never,
      new Date().toISOString(),
    );

    const runPromise = (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(task.id);

    for (let i = 0; i < 200; i++) {
      const current = h.tasks.get(task.id)!;
      if (current.status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(h.tasks.get(task.id)!.status).toBe("awaiting_approval");

    const cancel = runner.cancel(task.id);
    expect(cancel.cancelled).toBe(true);

    await runPromise;

    const cancelled = h.tasks.get(task.id)!;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.awaitingApproval).toBeNull();
    expect(cancelled.error?.code).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Enter-key bypass regression + page-listener gate coverage
// ---------------------------------------------------------------------------

describe("Enter-key bypass hardening", () => {
  it("REGRESSION: an input_text containing a newline triggers the consent gate, not implicit submission", { timeout: 120_000 }, async () => {
    mockLlm = await startMockLlm(
      [
        { name: "input_text", args: { index: 0, text: "Grace Hopper\n" } },
        { name: "done", args: { text: "filled", success: true } },
      ],
      { authRequired: true, expectedApiKey: "mock-key" },
    );
    const h = buildRunner(mockLlm, { confirmBeforeSubmit: true });
    runner = h.runner;
    tasks = h.tasks;
    employees = h.employees;
    const task = h.tasks.create(
      "tsk_gate_enter",
      EMPLOYEE.id,
      makeTask({ url: `${origin}/enter` }) as never,
      new Date().toISOString(),
    );
    const runPromise = (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(task.id);

    for (let i = 0; i < 200; i++) {
      const current = h.tasks.get(task.id)!;
      if (current.status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // GATED: the task must pause, NOT let the form submit via Enter.
    expect(h.tasks.get(task.id)!.status).toBe("awaiting_approval");

    runner.approve(task.id);
    await runPromise;
    const done = h.tasks.get(task.id)!;
    expect(done.status).toBe("done");
    // The approval request itself names the Enter path.
    expect(done.awaitingApproval).toBeNull();
    expect(done.logs.some((l) => l.phase === "safety" && /enter|newline/i.test(l.message))).toBe(true);
  });

  it("gate coverage: every submit path in the test pages produces an ApprovalRequest (click AND enter)", { timeout: 120_000 }, async () => {
    // Click path: standard SCRIPT on /form-c → gate must trip.
    mockLlm = await startMockLlm(SCRIPT, { authRequired: true, expectedApiKey: "mock-key" });
    const h = buildRunner(mockLlm, { confirmBeforeSubmit: true });
    runner = h.runner;
    tasks = h.tasks;
    employees = h.employees;
    const t1 = h.tasks.create(
      "tsk_gate_click_cov",
      EMPLOYEE.id,
      makeTask({ url: `${origin}/form-c` }) as never,
      new Date().toISOString(),
    );
    const p1 = (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(t1.id);
    for (let i = 0; i < 200; i++) {
      if (h.tasks.get(t1.id)!.status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(h.tasks.get(t1.id)!.awaitingApproval).not.toBeNull();
    runner.approve(t1.id);
    await p1;
    expect(h.tasks.get(t1.id)!.logs.some((l) => l.phase === "safety" && /approve/i.test(l.message))).toBe(true);

    // Enter path: newline input_text on /enter → gate must trip again.
    await mockLlm.close().catch(() => undefined);
    mockLlm = await startMockLlm(
      [
        { name: "input_text", args: { index: 0, text: "Ada Lovelace\n" } },
        { name: "done", args: { text: "filled", success: true } },
      ],
      { authRequired: true, expectedApiKey: "mock-key" },
    );
    const h2 = buildRunner(mockLlm, { confirmBeforeSubmit: true });
    runner = h2.runner;
    tasks = h2.tasks;
    employees = h2.employees;
    const t2 = h2.tasks.create(
      "tsk_gate_enter_cov",
      EMPLOYEE.id,
      makeTask({ url: `${origin}/enter` }) as never,
      new Date().toISOString(),
    );
    const p2 = (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(t2.id);
    for (let i = 0; i < 200; i++) {
      if (h2.tasks.get(t2.id)!.status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(h2.tasks.get(t2.id)!.awaitingApproval).not.toBeNull();
    runner.approve(t2.id);
    await p2;
    // The typed-newline path is named honestly in the audit trail.
    expect(h2.tasks.get(t2.id)!.logs.some((l) => l.phase === "safety" && /enter|newline/i.test(l.message))).toBe(true);
  });
});

describe("submit detection: icon-only submit button", () => {
  it("gates a submit button with no text content (aria-label only)", { timeout: 120_000 }, async () => {
    mockLlm = await startMockLlm(
      [
        { name: "input_text", args: { index: 0, text: "Grace Hopper" } },
        { name: "click_element_by_index", args: { index: 1 } },
        { name: "done", args: { text: "clicked", success: true } },
      ],
      { authRequired: true, expectedApiKey: "mock-key" },
    );
    const h = buildRunner(mockLlm, { confirmBeforeSubmit: true });
    runner = h.runner;
    tasks = h.tasks;
    employees = h.employees;
    const task = h.tasks.create(
      "tsk_gate_icon",
      EMPLOYEE.id,
      makeTask({ url: `${origin}/icon` }) as never,
      new Date().toISOString(),
    );
    const runPromise = (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(task.id);
    for (let i = 0; i < 200; i++) {
      if (h.tasks.get(task.id)!.status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const paused = h.tasks.get(task.id)!;
    expect(paused.status).toBe("awaiting_approval");
    // The icon-only button was classified submit-like despite having no text.
    expect(paused.awaitingApproval?.elementDescription).toMatch(/#ico/);
    runner.approve(task.id);
    await runPromise;
    expect(h.tasks.get(task.id)!.status).toBe("done");
  });

  it("HARDENING: a page-JS synthetic click on a submit button trips the page-level gate", { timeout: 120_000 }, async () => {
    // The attack: page JS dispatches a synthetic MouseEvent on the submit
    // button while the agent merely waits — the tool-level click gate never
    // sees this click; the PAGE-LEVEL blocker must intercept it.
    mockLlm = await startMockLlm(
      [
        { name: "wait", args: { seconds: 2 } },
        { name: "done", args: { text: "observed", success: true } },
      ],
      { authRequired: true, expectedApiKey: "mock-key" },
    );
    const h = buildRunner(mockLlm, { confirmBeforeSubmit: true });
    runner = h.runner;
    tasks = h.tasks;
    employees = h.employees;
    const task = h.tasks.create(
      "tsk_gate_synth",
      EMPLOYEE.id,
      makeTask({ url: `${origin}/synthetic` }) as never,
      new Date().toISOString(),
    );
    const runPromise = (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(task.id);
    // The page self-clicks ~300 ms after load; wait for the page-level trip.
    for (let i = 0; i < 200; i++) {
      if (h.tasks.get(task.id)!.status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const paused = h.tasks.get(task.id)!;
    expect(paused.status).toBe("awaiting_approval");
    expect(paused.awaitingApproval?.elementDescription).toMatch(/page-level/);
    // Approve: the blocker re-fires the click under the agent flag.
    runner.approve(task.id);
    await runPromise;
    expect(h.tasks.get(task.id)!.status).toBe("done");
  });

  it("HARDENING: agent click still completes after page-level hardening (no double gate)", { timeout: 120_000 }, async () => {
    // The page-level click blocker + the tool-level gate are BOTH active:
    // an approved agent click must pass the page blocker via the
    // __caAgentClickInProgress flag, not trip a second approval.
    mockLlm = await startMockLlm(SCRIPT, { authRequired: true, expectedApiKey: "mock-key" });
    const h = buildRunner(mockLlm, { confirmBeforeSubmit: true });
    runner = h.runner;
    tasks = h.tasks;
    employees = h.employees;
    const task = h.tasks.create(
      "tsk_gate_nodbl",
      EMPLOYEE.id,
      makeTask({ url: `${origin}/form-a` }) as never,
      new Date().toISOString(),
    );
    const runPromise = (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(task.id);
    for (let i = 0; i < 200; i++) {
      if (h.tasks.get(task.id)!.status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(h.tasks.get(task.id)!.status).toBe("awaiting_approval");
    runner.approve(task.id);
    await runPromise;
    const done = h.tasks.get(task.id)!;
    expect(done.status).toBe("done");
    // EXACTLY ONE approval request for the whole task (no double gate).
    const safetyLogs = done.logs.filter((l) => l.phase === "safety" && /About to submit/i.test(l.message));
    expect(safetyLogs).toHaveLength(1);
  });

  it("HARDENING: Enter inside a same-origin iframe form trips the gate (frame propagation)", { timeout: 120_000 }, async () => {
    // The attack: the form lives INSIDE a same-origin iframe; the frame's
    // own script presses Enter (synthetic keydown) in its input. The frame
    // copy of the Enter blocker (installed by the frame watcher) must gate
    // it — this is the realm-agnostic propagation path.
    mockLlm = await startMockLlm(
      [
        { name: "wait", args: { seconds: 2 } },
        { name: "done", args: { text: "observed", success: true } },
      ],
      { authRequired: true, expectedApiKey: "mock-key" },
    );
    const h = buildRunner(mockLlm, { confirmBeforeSubmit: true });
    runner = h.runner;
    tasks = h.tasks;
    employees = h.employees;
    const task = h.tasks.create(
      "tsk_gate_frame_enter",
      EMPLOYEE.id,
      makeTask({ url: `${origin}/frame-host` }) as never,
      new Date().toISOString(),
    );
    const runPromise = (runner as unknown as { executeById: (id: string) => Promise<void> }).executeById(task.id);
    for (let i = 0; i < 200; i++) {
      if (h.tasks.get(task.id)!.status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const paused = h.tasks.get(task.id)!;
    expect(paused.status).toBe("awaiting_approval");
    expect(paused.awaitingApproval?.via).toBe("enter-key");
    runner.approve(task.id);
    await runPromise;
    expect(h.tasks.get(task.id)!.status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// (d) allowlist at navigation
// ---------------------------------------------------------------------------

describe("(d) allowedDomains enforced at navigation", () => {
  it("fails with domain_not_allowed when the task URL is off-list", { timeout: 90_000 }, async () => {
    mockLlm = await startMockLlm(SCRIPT, { authRequired: true, expectedApiKey: "mock-key" });
    const task = await runOne(
      mockLlm,
      makeTask({ url: "https://evil.example.com/form" }),
    );
    expect(task.status).toBe("failed");
    expect(task.error?.code).toBe("domain_not_allowed");
    // The block happened BEFORE any LLM call (enqueue-style check in the service).
    expect(task.logs.filter((l) => l.phase === "llm")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (e) maxSteps exceeded
// ---------------------------------------------------------------------------

describe("(e) maxSteps exceeded", () => {
  it("fails with max_steps_exceeded when the agent loops forever", { timeout: 150_000 }, async () => {
    // Script: click 'next' forever — never done. Employee cap: 2 steps.
    mockLlm = await startMockLlm(
      [{ name: "click_element_by_index", args: { index: 0 } }],
      { authRequired: true, expectedApiKey: "mock-key" },
    );
    const task = await runOne(
      mockLlm,
      makeTask({ url: `${origin}/endless` }),
      { maxStepsPerTask: 2 },
    );
    expect(task.status).toBe("failed");
    expect(task.error?.code).toBe("max_steps_exceeded");
  });
});

// ---------------------------------------------------------------------------
// (f) structured output / outputSchema
// ---------------------------------------------------------------------------

describe("(f) extraction with outputSchema", () => {
  it("returns validated JSON when the extraction matches the schema", { timeout: 120_000 }, async () => {
    mockLlm = await startMockLlm(
      [{ name: "done", args: { text: '{"quarter":"Q3","revenue":4200}', success: true } }],
      { authRequired: true, expectedApiKey: "mock-key" },
    );
    const task = await runOne(mockLlm, makeTask({
      url: `${origin}/data`,
      outputSchema: {
        type: "object",
        required: ["quarter", "revenue"],
        properties: {
          quarter: { type: "string" },
          revenue: { type: "integer" },
        },
      },
    }));
    expect(task.status).toBe("done");
    expect((task.output as { reply: { quarter: string; revenue: number }; validated: boolean }).validated).toBe(true);
    expect((task.output as { reply: { revenue: number } }).reply.revenue).toBe(4200);
  });

  it("fails with output_schema_mismatch when the extraction does not match", { timeout: 120_000 }, async () => {
    mockLlm = await startMockLlm(
      [{ name: "done", args: { text: '{"quarter":"Q3"}', success: true } }],
      { authRequired: true, expectedApiKey: "mock-key" },
    );
    const task = await runOne(mockLlm, makeTask({
      url: `${origin}/data`,
      outputSchema: {
        type: "object",
        required: ["quarter", "revenue"],
        properties: { quarter: { type: "string" }, revenue: { type: "integer" } },
      },
    }));
    expect(task.status).toBe("failed");
    expect(task.error?.code).toBe("output_schema_mismatch");
    expect(task.error?.message).toContain("revenue");
  });
});

// ---------------------------------------------------------------------------
// Live gates (manual: RUN_HN=1 npx vitest run test/browserTask.test.ts)
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.RUN_HN)("LIVE: news.ycombinator.com (RUN_HN=1)", () => {
  it("runs the full loop against a real public site", { timeout: 180_000 }, async () => {
    const liveMock = await startMockLlm(
      [{ name: "done", args: { text: "extraction channel verified", success: true } }],
      { authRequired: false },
    );
    const liveService = new BrowserService({
      poolSize: 1,
      timeoutMs: 120_000,
      maxStepsHardCap: 500,
    });
    try {
      const result = await liveService.runTask({
        url: "https://news.ycombinator.com/",
        objective: "Extract the top 5 story titles from this page as a JSON array.",
        allowedDomains: ["news.ycombinator.com"],
        upstreamUrl: liveMock.url,
        llmModel: "mock-model",
        maxSteps: 6,
        confirmBeforeSubmit: false,
        dataDir: join(dataDir, "live"),
        onStep: () => {},
        onLlmRequest: () => {},
        onGateTripped: () => {},
      });
      expect(result.ok).toBe(true);
      expect(result.llmRequests.length).toBeGreaterThan(0);
      // Real serialized HN DOM reached the model through our proxy:
      const prompt = liveMock.calls.map((c) => c.promptSnippet).join("");
      expect(prompt.length).toBeGreaterThan(5_000);
      expect(prompt).toContain("[Start of page]");
    } finally {
      await liveService.close();
      await liveMock.close();
    }
  });
});
