/**
 * Phase 5 evidence capture (development aid — not part of the audited
 * execution path): screenshots of the COMPOSED STACK (the packaged app
 * serving the built dashboard at :4000), not the dev servers.
 *
 * Prereq: `docker compose up -d app` (runtime-browser target for a live
 * gate card). Saves PNGs to docs/evidence/phase5/.
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://localhost:4000";
const CWD = process.cwd();
const OUT = join(CWD, "../../docs/evidence/phase5");
mkdirSync(OUT, { recursive: true });

const OP = execSync("docker compose exec -T app cat /data/operator-token", {
  cwd: CWD,
  encoding: "utf8",
}).trim();

const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
console.log("health:", JSON.stringify(health));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await ctx.addInitScript(
  (token) => localStorage.setItem("ca-operator-token", token),
  OP,
);
const page = await ctx.newPage();

const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, name) });
  console.log("saved", name, "-", await page.title());
};

// 1. Approvals queue (live gate card if a gated task is pending).
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("text=ConsentArk", { timeout: 15000 });
await shot("05-approvals.png");

// 2. Tasks view with audit timeline of the completed run.
await page.getByText("Tasks", { exact: true }).first().click();
await page.waitForTimeout(600);
await shot("05-tasks.png");
const row = page.locator("text=Place order").first();
if (await row.count()) {
  await row.click();
  await page.waitForTimeout(600);
  await shot("05-task-audit.png");
}

// 3. Employees view.
await page.getByText("Employees", { exact: true }).first().click();
await page.waitForTimeout(600);
await shot("05-employees.png");

await browser.close();
console.log("DONE");
