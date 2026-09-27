/**
 * Phase 5 evidence driver (development aid — not part of the audited
 * execution path): brings the composed stack's in-container mock LLM +
 * demo pages up FRESH, hires a gated employee via the packaged CLI,
 * enqueues a browser task, leaves it AT the approval gate, then captures
 * dashboard screenshots from the composed stack (not dev servers).
 *
 * Run: node apps/api/scripts/dev/phase5-evidence.mjs   (stack must be up)
 */
import { execSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Anchor to the script's own location, NOT the invocation cwd — running from
// the repo root vs apps/api must not change where evidence lands.
const HERE = dirname(fileURLToPath(import.meta.url));
const CWD = join(HERE, "../../.."); // consentark workspace root
// dev/ → scripts/ → api/ → apps/ → consentark/docs/evidence/phase5
const OUT = join(HERE, "../../../../docs/evidence/phase5");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:4000";

const script = [
  { name: "input_text", args: { index: 1, text: "Arc Widget" } },
  { name: "input_text", args: { index: 3, text: "2" } },
  { name: "input_text", args: { index: 5, text: "grace@navy.mil" } },
  { name: "click_element_by_index", args: { index: 6 } },
  { name: "done", args: { text: "Order placed.", success: true } },
];
const daemon = `
import { startMockLlm } from "/app/apps/api/dist/browser/mockLlm.js";
import { DEMO_PAGES } from "/app/apps/api/dist/cli/demoPages.js";
await startMockLlm(${JSON.stringify(script)}, { authRequired: false, port: 3001 });
await DEMO_PAGES.start(8787);
console.log("READY");
await new Promise(() => {});
`;

// The in-container API keeps orphaned daemons alive across exec clients;
// a restart guarantees ports 3001/8787 are free and the LLM script is fresh.
execSync("docker compose restart app", { cwd: CWD, stdio: "inherit" });
for (let i = 0; i < 25; i++) {
  try {
    const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
    if (h.status === "ok") break;
  } catch {}
  await new Promise((r) => setTimeout(r, 2000));
}

const daemonProc = spawn(
  "docker", ["compose", "exec", "-T", "app", "node", "--input-type=module", "-e", daemon],
  { cwd: CWD, stdio: ["ignore", "pipe", "inherit"] },
);
let daemonReady = "";
daemonProc.stdout.on("data", (d) => (daemonReady += String(d)));
for (let i = 0; i < 20 && !daemonReady.includes("READY"); i++) {
  await new Promise((r) => setTimeout(r, 500));
}
if (!daemonReady.includes("READY")) throw new Error("daemon did not start");

// Hire via the packaged CLI (tokens print once; capture from stdout).
// The CLI prompts for ANY flag left unset — pass a COMPLETE flag set
// (including --system-prompt) so nothing reads stdin, then < /dev/null
// + execSync timeout as belt-and-braces.
const log = (m) => console.log(new Date().toISOString().slice(11, 19), m);
const hireOut = execSync(
  String.raw`docker compose exec -T app sh -c 'node dist/cli/hire.js --name Shot-Clerk --tools browser_task --allowlist 127.0.0.1,localhost --confirm --backend cloud --system-prompt You-are-a-meticulous-data-clerk < /dev/null'`,
  { cwd: CWD, encoding: "utf8", timeout: 120_000 },
);
const empId = hireOut.match(/id:\s+(\S+)/)?.[1];
const empToken = hireOut.match(/^\s{5}(\S{43})$/m)?.[1];
if (!empId || !empToken) throw new Error("hire failed:\n" + hireOut.slice(-400));
console.log("hired:", empId);

const OP = execSync("docker compose exec -T app cat /data/operator-token", { cwd: CWD, encoding: "utf8", timeout: 30_000 }).trim();
log("operator token read");

const enq = await fetch(`${BASE}/api/employee/tasks`, {
  method: "POST",
  headers: { authorization: `Bearer ${empToken}`, "content-type": "application/json" },
  body: JSON.stringify({
    employeeId: empId,
    type: "browser_task",
    objective: "Fill the order form with Arc Widget x2 for grace@navy.mil and submit it.",
    url: "http://127.0.0.1:8787/form",
  }),
});
if (enq.status !== 202) throw new Error("enqueue failed: " + (await enq.text()));
const taskId = (await enq.json()).id;
console.log("enqueued:", taskId);

let task = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  task = await fetch(`${BASE}/api/tasks/${taskId}`, { headers: { authorization: `Bearer ${OP}` } }).then((r) => r.json());
  if (task.status === "awaiting_approval" || task.status === "done" || task.status === "failed") break;
}
if (task.status !== "awaiting_approval") throw new Error("expected awaiting_approval, got " + task.status);
console.log("GATE TRIPPED — capturing dashboard");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await ctx.addInitScript((t) => localStorage.setItem("ca-operator-token", t), OP);
const page = await ctx.newPage();
const shot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, name) });
  console.log("saved", name);
};

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("text=ConsentArk", { timeout: 15000 });
await shot("05-approvals-gate.png");

await page.getByText("Tasks", { exact: true }).first().click();
await page.waitForTimeout(700);
await shot("05-tasks.png");
const cell = page.locator("text=Place order").first();
if (await cell.count()) {
  await cell.click();
  await page.waitForTimeout(700);
  await shot("05-task-audit.png");
}

await page.getByText("Employees", { exact: true }).first().click();
await page.waitForTimeout(700);
await shot("05-employees.png");

// Optional stage 2: approve the parked task from the composed stack and
// capture the DONE state (audit timeline + screenshots on the task view).
if (process.env.APPROVE === "1") {
  const ap = await fetch(`${BASE}/api/tasks/${taskId}/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${OP}` },
  });
  if (ap.status !== 200) throw new Error("approve failed: " + (await ap.text()));
  log("approved — waiting for completion");
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    task = await fetch(`${BASE}/api/tasks/${taskId}`, { headers: { authorization: `Bearer ${OP}` } }).then((r) => r.json());
    if (task.status === "done" || task.status === "failed" || task.status === "cancelled") break;
  }
  log("final status: " + task.status);
  await page.getByText("Tasks", { exact: true }).first().click();
  await page.waitForTimeout(700);
  const row = page.locator("text=Arc Widget").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(700);
    await shot("05-task-done-audit.png");
  }
  console.log("DONE-STATE task", taskId, task.status);
}

await browser.close();
// Leave the task pending for manual operator UX inspection unless APPROVE=1
// already drove it to done (stage 2 above). Daemons intentionally persist.
console.log("DONE — task", taskId, "final status:", task.status);
// The spawned `docker compose exec` client keeps the event loop alive —
// exit explicitly (the in-container daemons intentionally persist).
daemonProc.kill("SIGKILL");
process.exit(0);
