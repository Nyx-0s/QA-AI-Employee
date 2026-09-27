import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, type AppContext } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 3 dashboard-support route tests: approvals queue, config surface,
 * and authenticated screenshot serving. Screenshots are evidence — these
 * tests pin down that they are never publicly fetchable and never resolve
 * outside DATA_DIR.
 */

let dataDir: string;
let app: FastifyInstance;
let context: AppContext;

const TOKEN = "test-admin-token-xyz";
const auth = { authorization: `Bearer ${TOKEN}` };

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn());
  dataDir = mkdtempSync(join(tmpdir(), "consentark-dash-"));
  const built = await buildApp(
    {
      PORT: "4311",
      DATA_DIR: dataDir,
      ADMIN_TOKEN: TOKEN,
      LOG_LEVEL: "error",
      FREELLMAPI_URL: "http://llm.test/v1",
      FREELLMAPI_KEY: "test-key",
      FREELLMAPI_MODEL: "auto",
      COLIBRI_URL: "http://llm.test/v1",
      COLIBRI_MODEL: "OLMoE-7B",
      LOCAL_FALLBACK_TO_CLOUD: "false",
      WORKER_CONCURRENCY: "1",
      APPROVAL_TIMEOUT_HOURS: "24",
    },
    { startWorker: false },
  );
  app = built.app;
  context = built.context;
});

afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
  rmSync(dataDir, { recursive: true, force: true });
});

/** Hire an employee + create an awaiting_approval task directly in the DB. */
function seedApproval(): { taskId: string; employeeId: string } {
  const employee = context.employees.create(
    "gate-clerk",
    {
      name: "Gate Clerk",
      role: "data_clerk",
      description: "",
      systemPrompt: "Careful clerk.",
      backend: "cloud",
      model: "auto",
      toolsEnabled: ["chat_task", "browser_task"],
      allowedDomains: ["127.0.0.1"],
      confirmBeforeSubmit: true,
      maxStepsPerTask: 25,
      schedule: null,
    },
    new Date().toISOString(),
  );
  const task = context.tasks.create(
    "tsk_gate_dash",
    employee.id,
    { employeeId: employee.id, type: "browser_task", objective: "Submit the invoice form", url: "http://127.0.0.1:9/invoice" },
    new Date().toISOString(),
  );
  context.tasks.setAwaitingApproval(
    task.id,
    {
      summary: 'About to click the submit button "Pay invoice" (via click).',
      elementText: "Pay invoice",
      elementDescription: 'button[type=submit] "Pay invoice"',
      stepIndex: 3,
      via: "click",
      at: new Date().toISOString(),
    },
    new Date().toISOString(),
  );
  context.tasks.setStatus(task.id, "awaiting_approval", new Date().toISOString());
  return { taskId: task.id, employeeId: employee.id };
}

describe("GET /api/dashboard/approvals", () => {
  it("requires auth", async () => {
    const response = await app.inject({ method: "GET", url: "/api/dashboard/approvals" });
    expect(response.statusCode).toBe(401);
  });

  it("lists awaiting tasks joined with employee + gate details", async () => {
    const { taskId } = seedApproval();
    const response = await app.inject({ method: "GET", url: "/api/dashboard/approvals", headers: auth });
    expect(response.statusCode).toBe(200);
    const entries = response.json();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      taskId,
      employeeName: "Gate Clerk",
      taskObjective: "Submit the invoice form",
      status: "awaiting_approval",
    });
    expect(entries[0].approval.via).toBe("click");
    expect(entries[0].approval.elementText).toBe("Pay invoice");
  });

  it("includes the latest screenshot ref when the task has evidence", async () => {
    const { taskId } = seedApproval();
    context.tasks.addScreenshot(taskId, "task-gate-1.png");
    context.tasks.addScreenshot(taskId, "task-gate-2.png");
    const response = await app.inject({ method: "GET", url: "/api/dashboard/approvals", headers: auth });
    const entries = response.json();
    expect(entries[0].latestScreenshotRef).toBe("task-gate-2.png");
    expect(entries[0].taskId).toBe(taskId);
  });

  it("returns latestScreenshotRef null when there is no evidence", async () => {
    seedApproval();
    const response = await app.inject({ method: "GET", url: "/api/dashboard/approvals", headers: auth });
    expect(response.json()[0].latestScreenshotRef).toBeNull();
  });

  it("is empty when nothing is awaiting approval", async () => {
    const response = await app.inject({ method: "GET", url: "/api/dashboard/approvals", headers: auth });
    expect(response.json()).toEqual([]);
  });
});

describe("GET /api/dashboard/config", () => {
  it("exposes the consent clock and requires auth", async () => {
    const denied = await app.inject({ method: "GET", url: "/api/dashboard/config" });
    expect(denied.statusCode).toBe(401);

    const response = await app.inject({ method: "GET", url: "/api/dashboard/config", headers: auth });
    expect(response.json()).toEqual({ approvalTimeoutHours: 24 });
  });
});

describe("GET /api/dashboard/screenshots/:taskId/:name", () => {
  it("requires auth — screenshots are never publicly fetchable", async () => {
    const { taskId } = seedApproval();
    context.tasks.addScreenshot(taskId, "task-start-123.png");
    const response = await app.inject({
      method: "GET",
      url: `/api/dashboard/screenshots/${taskId}/task-start-123.png`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("serves a stored screenshot with the right content type", async () => {
    const { taskId } = seedApproval();
    const ref = "task-start-123.png";
    context.tasks.addScreenshot(taskId, ref);
    writeFileSync(join(dataDir, ref), Buffer.from("89504e47", "hex"));

    const response = await app.inject({
      method: "GET",
      url: `/api/dashboard/screenshots/${taskId}/${ref}`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.rawPayload).toBeDefined();
  });

  it("404s a foreign task id", async () => {
    const { taskId } = seedApproval();
    context.tasks.addScreenshot(taskId, "task-x.png");
    const response = await app.inject({
      method: "GET",
      url: `/api/dashboard/screenshots/tsk_other/task-x.png`,
      headers: auth,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("task_not_found");
  });

  it("404s when the file is not in the task's screenshot list", async () => {
    const { taskId } = seedApproval();
    writeFileSync(join(dataDir, "orphan.png"), "x");
    const response = await app.inject({
      method: "GET",
      url: `/api/dashboard/screenshots/${taskId}/orphan.png`,
      headers: auth,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("screenshot_not_found");
  });

  it("404s when the DB lists it but the file is missing on disk", async () => {
    const { taskId } = seedApproval();
    context.tasks.addScreenshot(taskId, "task-gone.png");
    const response = await app.inject({
      method: "GET",
      url: `/api/dashboard/screenshots/${taskId}/task-gone.png`,
      headers: auth,
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects path traversal out of DATA_DIR with 403", async () => {
    const { taskId } = seedApproval();
    context.tasks.addScreenshot(taskId, "../secret.png");
    writeFileSync(join(tmpdir(), "consentark-traversal-secret.png"), "top secret");
    const response = await app.inject({
      method: "GET",
      url: `/api/dashboard/screenshots/${taskId}/${encodeURIComponent("../secret.png")}`,
      headers: auth,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("screenshot_path_forbidden");
  });
});
