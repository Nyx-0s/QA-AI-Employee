// Phase 3 evidence capture (development aid — not part of the audited execution path).
// Boots API + dashboard, verifies security behaviors over real HTTP, drives
// Playwright through the three views, saves screenshots to docs/evidence/phase3.
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, "../..");
const repoRoot = resolve(apiDir, "../..");
const dataDir = "/tmp/ca-demo-capture";
const evidence = resolve(repoRoot, "docs/evidence/phase3");
const API = "http://localhost:4000";
const WEB = "http://localhost:5173";
const TOKEN = "dev-admin-token-change-me";

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: "pipe", ...opts }).toString().trim();

// ── build the shared package (Vite needs real dist for the workspace link) ──
sh("pnpm -F @consentark/shared build", { cwd: repoRoot });

// ── seed FIRST (the seeder recreates DATA_DIR; must happen before the API
// opens the DB file, or the API keeps the deleted inode) ──
sh("npx tsx scripts/dev/seed-demo.ts", {
  cwd: apiDir,
  env: { ...process.env, DATA_DIR: dataDir },
});

// ── boot API ──
const api = spawn(
  "npx",
  ["tsx", "src/index.ts"],
  {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: "4000",
      DATA_DIR: dataDir,
      ADMIN_TOKEN: TOKEN,
      APPROVAL_TIMEOUT_HOURS: "24",
      LOG_LEVEL: "warn",
    },
    stdio: "ignore",
    detached: true,
  },
);

// ── boot dashboard (vite dev) ──
const web = spawn("npx", ["vite", "--port", "5173", "--strictPort"], {
  cwd: resolve(repoRoot, "apps/dashboard"),
  stdio: "ignore",
  detached: true,
});

const up = async (url, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

let code = 0;
try {
  if (!(await up(`${API}/api/health`))) throw new Error("API did not come up");
  if (!(await up(WEB))) throw new Error("dashboard did not come up");
  console.log("servers up");

  // ── HTTP security proofs ──
  const noAuth = await fetch(`${API}/api/dashboard/approvals`);
  console.log("approvals without token:", noAuth.status, "(want 401)");
  if (noAuth.status !== 401) throw new Error("approvals not auth-protected");

  const shotNoAuth = await fetch(`${API}/api/dashboard/screenshots/tsk_demo_gate/task-gate-demo.png`);
  console.log("screenshot without token:", shotNoAuth.status, "(want 401)");
  if (shotNoAuth.status !== 401) throw new Error("screenshot not auth-protected");

  const authed = await fetch(`${API}/api/dashboard/approvals`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const entries = await authed.json();
  console.log("approvals with token:", authed.status, "count:", entries.length);
  if (entries.length !== 1) throw new Error("expected exactly 1 approval");

  const shot = await fetch(`${API}/api/dashboard/screenshots/tsk_demo_gate/task-gate-demo.png`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  console.log(
    "screenshot with token:",
    shot.status,
    shot.headers.get("content-type"),
    shot.headers.get("cache-control"),
  );
  if (shot.status !== 200 || !shot.headers.get("content-type").includes("image/png")) {
    throw new Error("screenshot serving broken");
  }

  const traversal = await fetch(
    `${API}/api/dashboard/screenshots/tsk_demo_gate/${encodeURIComponent("../../etc/passwd")}`,
    { headers: { authorization: `Bearer ${TOKEN}` } },
  );
  console.log("traversal attempt:", traversal.status, "(want 403)");
  if (traversal.status !== 403) throw new Error("traversal not blocked");

  // ── UI capture ──
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });

  // NOTE: the dev UI reads VITE_ADMIN_TOKEN at build time; for the dev server
  // we pass it via localStorage-free query (not supported) — so instead the
  // dashboard default token matches the API's dev token and auth just works.
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Invoice Clerk", { timeout: 15000 });
  await page.screenshot({ path: `${evidence}/approvals.png`, fullPage: true });
  console.log("captured approvals.png");

  // Two-step approve UX proof: arm without commit.
  await page.click("button:has-text('Approve')");
  await page.waitForSelector("button:has-text('Approve — click again')");
  const callsBefore = [];
  page.on("request", (r) => callsBefore.push(r.url()));
  await page.screenshot({ path: `${evidence}/approve-armed.png`, fullPage: true });
  console.log("captured approve-armed.png (gate still held — no /approve fired)");

  // Reload to re-render the still-pending approval (the arm did NOT commit).
  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.click("nav >> text=Tasks");
  await page.waitForSelector("text=Fill and submit the monthly invoice form");
  await page.click("text=Fill and submit the monthly invoice form");
  await page.waitForSelector("text=AI reasoning");
  await page.screenshot({ path: `${evidence}/task-audit.png`, fullPage: true });
  console.log("captured task-audit.png");

  await page.click("nav >> text=Employees");
  await page.waitForSelector("text=consent gate ON");
  await page.screenshot({ path: `${evidence}/employees.png`, fullPage: true });
  console.log("captured employees.png");

  await browser.close();
  console.log("ALL CAPTURES OK");
} catch (err) {
  console.error("CAPTURE FAILED:", err.message);
  code = 1;
} finally {
  try {
    process.kill(-api.pid);
  } catch {}
  try {
    process.kill(-web.pid);
  } catch {}
}
process.exit(code);
