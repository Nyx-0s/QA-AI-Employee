import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../../src/db/sqlite.js";
import { EmployeeRepository } from "../../src/db/repositories/employees.js";
import { TaskRepository } from "../../src/db/repositories/tasks.js";

/**
 * Demo seed (development aid — not part of the audited execution path):
 * populates a FRESH DATA_DIR with one employee, one task parked at the
 * consent gate (with a gate screenshot), and one finished task — so the
 * dashboard has content to render without needing a live LLM or browser.
 *
 * Usage: DATA_DIR=/tmp/ca-demo-data npx tsx scripts/dev/seed-demo.ts
 */

const dataDir = resolve(process.env.DATA_DIR ?? "/tmp/ca-demo-data");
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

// Minimal valid 1×1 PNG so screenshot serving has a real image to stream.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const gateShot = "task-gate-demo.png";
writeFileSync(`${dataDir}/${gateShot}`, PNG_1PX);
const doneShot = "task-end-demo.png";
writeFileSync(`${dataDir}/${doneShot}`, PNG_1PX);

const db = openDatabase(dataDir);
const employees = new EmployeeRepository(db);
const tasks = new TaskRepository(db);

const now = new Date().toISOString();
const employee = employees.create(
  "invoice-clerk",
  {
    name: "Invoice Clerk",
    role: "data_clerk",
    description: "Processes monthly invoice forms.",
    systemPrompt: "You fill invoice forms carefully and stop before submitting.",
    backend: "cloud",
    model: "auto",
    toolsEnabled: ["browser_task"],
    allowedDomains: ["127.0.0.1"],
    confirmBeforeSubmit: true,
    maxStepsPerTask: 25,
    schedule: null,
  },
  now,
);

// Task 1 — parked at the consent gate with evidence.
const gated = tasks.create(
  "tsk_demo_gate",
  employee.id,
  {
    employeeId: employee.id,
    type: "browser_task",
    objective: "Fill and submit the monthly invoice form",
    url: "http://127.0.0.1:4173/form.html",
    steps: ["Fill every field", "Click the submit button"],
  },
  now,
);
tasks.addScreenshot(gated.id, gateShot);
tasks.setAwaitingApproval(
  gated.id,
  {
    summary: 'About to click the submit button "Pay invoice".',
    elementText: "Pay invoice",
    elementDescription: 'button[type=submit] "Pay invoice"',
    stepIndex: 4,
    via: "click",
    at: new Date().toISOString(),
  },
  new Date().toISOString(),
);
tasks.setStatus(gated.id, "awaiting_approval", new Date().toISOString());
tasks.appendLog(gated.id, {
  at: new Date().toISOString(),
  level: "info",
  phase: "plan",
  message: "Planned 2 steps: fill the form, then submit.",
});
tasks.appendLog(gated.id, {
  at: new Date().toISOString(),
  level: "info",
  phase: "llm",
  message: "Calling cloud (FreeLLMAPI) model auto for step planning.",
});
tasks.appendLog(gated.id, {
  at: new Date().toISOString(),
  level: "info",
  phase: "browser",
  message: "Navigated to the invoice form and filled 3 fields.",
});
tasks.appendLog(gated.id, {
  at: new Date().toISOString(),
  level: "warn",
  phase: "safety",
  message: 'About to click the submit button "Pay invoice" — task paused for human approval.',
});

// Task 2 — already completed, with output + audit + evidence.
const done = tasks.create(
  "tsk_demo_done",
  employee.id,
  {
    employeeId: employee.id,
    type: "browser_task",
    objective: "Extract the top 5 story titles",
    url: "http://127.0.0.1:4173/list.html",
  },
  now,
);
tasks.setStatus(done.id, "running", new Date().toISOString());
tasks.setStatus(done.id, "done", new Date().toISOString());
tasks.setOutput(done.id, {
  titles: ["Consent-first automation ships", "Small models, big audits", "The gate holds"],
});
tasks.addScreenshot(done.id, doneShot);
tasks.appendLog(done.id, {
  at: new Date().toISOString(),
  level: "info",
  phase: "llm",
  message: "Calling cloud (FreeLLMAPI) model auto for extraction.",
});
tasks.appendLog(done.id, {
  at: new Date().toISOString(),
  level: "info",
  phase: "browser",
  message: "Extracted 3 story titles from the listing page.",
});
tasks.appendLog(done.id, {
  at: new Date().toISOString(),
  level: "info",
  phase: "system",
  message: "The employee completed the task.",
});

console.log(`Seeded ${dataDir} — employee ${employee.id}, tasks ${gated.id} + ${done.id}`);
