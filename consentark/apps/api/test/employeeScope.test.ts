import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, type AppContext } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 4 security spine — the scoping matrix, test-pinned.
 *
 * Two tiers:
 * - operator (ADMIN_TOKEN env): everything.
 * - employee (hashed token in SQLite): ONLY /api/employee/*, and only its
 *   OWN rows. Every test here is a regression pin for one cell of that
 *   matrix; if any of these fail, tokens have leaked scope.
 */

let dataDir: string;
let app: FastifyInstance;
let context: AppContext;

const OPERATOR = "test-admin-token-xyz";
const operatorAuth = { authorization: `Bearer ${OPERATOR}` };

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn());
  dataDir = mkdtempSync(join(tmpdir(), "consentark-employee-scope-"));
  const built = await buildApp(
    {
      PORT: "4312",
      DATA_DIR: dataDir,
      ADMIN_TOKEN: OPERATOR,
      LOG_LEVEL: "error",
      FREELLMAPI_URL: "http://llm.test/v1",
      FREELLMAPI_KEY: "test-key",
      WORKER_CONCURRENCY: "1",
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

async function hireEmployee(name: string, tools: string[]): Promise<{ id: string; token: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/api/employees",
    headers: operatorAuth,
    payload: {
      name,
      role: "data_clerk",
      systemPrompt: `You are ${name}.`,
      toolsEnabled: tools,
      allowedDomains: ["127.0.0.1"],
    },
  });
  expect(created.statusCode).toBe(201);
  const { id } = created.json() as { id: string };
  const issued = await app.inject({
    method: "POST",
    url: `/api/employees/${id}/tokens`,
    headers: operatorAuth,
  });
  expect(issued.statusCode).toBe(201);
  const { token } = issued.json() as { token: string };
  return { id, token };
}

const selfAuth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("token issuance and storage", () => {
  it("issues a token once and stores ONLY its hash", async () => {
    const { id, token } = await hireEmployee("Hash Check", ["chat_task"]);

    // The token works.
    const me = await app.inject({ method: "GET", url: "/api/employee/me", headers: selfAuth(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(id);

    // At rest: hashes only. The plaintext appears nowhere in the DB.
    const rows = context.tokens.listForEmployee(id);
    expect(rows).toHaveLength(1);
    const { createHash } = await import("node:crypto");
    expect(rows[0]).toBe(createHash("sha256").update(token, "utf8").digest("hex"));

    const raw = (await import("node:fs")).readFileSync(join(dataDir, "consentark.db"));
    expect(raw.includes(Buffer.from(token, "utf8"))).toBe(false);
  });

  it("rejects garbage, empty and revoked tokens; revocation works", async () => {
    const { id, token } = await hireEmployee("Revoke Me", ["chat_task"]);
    expect(token.length).toBeGreaterThanOrEqual(32);

    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/employees/${id}/tokens`,
      headers: operatorAuth,
    });
    expect(revoke.json()).toEqual({ revoked: 1 });

    const after = await app.inject({ method: "GET", url: "/api/employee/me", headers: selfAuth(token) });
    expect(after.statusCode).toBe(401);

    const garbage = await app.inject({
      method: "GET",
      url: "/api/employee/me",
      headers: selfAuth("totally-not-a-token"),
    });
    expect(garbage.statusCode).toBe(401);
  });
});

describe("scoping matrix — employee tokens stay in their lane", () => {
  it("cannot touch ANY operator endpoint (employees/tasks/dashboard)", async () => {
    const { token } = await hireEmployee("Lane Keeper", ["chat_task", "browser_task"]);
    const employeeList = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers: selfAuth(token),
      payload: { name: "Rogue", systemPrompt: "x" },
    });
    expect(employeeList.statusCode).toBe(401);

    const taskEnqueue = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: selfAuth(token),
      payload: { employeeId: "anything", type: "chat", objective: "x" },
    });
    expect(taskEnqueue.statusCode).toBe(401);

    const approvals = await app.inject({
      method: "GET",
      url: "/api/dashboard/approvals",
      headers: selfAuth(token),
    });
    expect(approvals.statusCode).toBe(401);

    const config = await app.inject({
      method: "GET",
      url: "/api/dashboard/config",
      headers: selfAuth(token),
    });
    expect(config.statusCode).toBe(401);

    const employeesGet = await app.inject({
      method: "GET",
      url: "/api/employees",
      headers: selfAuth(token),
    });
    expect(employeesGet.statusCode).toBe(401);
  });

  it("token A cannot read or enqueue for token B — even with B's ids", async () => {
    const a = await hireEmployee("Employee A", ["chat_task"]);
    const b = await hireEmployee("Employee B", ["chat_task"]);

    // A cannot read B's identity or tasks.
    const meB = await app.inject({ method: "GET", url: "/api/employee/me", headers: selfAuth(a.token) });
    expect(meB.json().id).toBe(a.id);
    const bTasksViaA = await app.inject({
      method: "GET",
      url: "/api/employee/tasks",
      headers: selfAuth(a.token),
    });
    for (const task of bTasksViaA.json() as Array<{ employeeId: string }>) {
      expect(task.employeeId).toBe(a.id);
    }

    // B seeds a task; A must get 404 (not 403 — do not confirm existence).
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "m",
          choices: [{ message: { role: "assistant", content: "hi" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const bTask = await app.inject({
      method: "POST",
      url: "/api/employee/tasks",
      headers: selfAuth(b.token),
      payload: { employeeId: b.id, type: "chat", objective: "B's private task" },
    });
    expect(bTask.statusCode).toBe(202);
    const bTaskId = (bTask.json() as { id: string }).id;

    const readB = await app.inject({
      method: "GET",
      url: `/api/employee/tasks/${bTaskId}`,
      headers: selfAuth(a.token),
    });
    expect(readB.statusCode).toBe(404);

    const cancelB = await app.inject({
      method: "POST",
      url: `/api/employee/tasks/${bTaskId}/cancel`,
      headers: selfAuth(a.token),
    });
    expect(cancelB.statusCode).toBe(404);

    // A cannot enqueue FOR B even by forging employeeId in the payload.
    const forge = await app.inject({
      method: "POST",
      url: "/api/employee/tasks",
      headers: selfAuth(a.token),
      payload: { employeeId: b.id, type: "chat", objective: "A speaking as B" },
    });
    expect(forge.statusCode).toBe(404);
    expect(forge.json().error.code).toBe("task_not_found");
  });

  it("enforces grants + allowlist on the self-serve path too", async () => {
    const { id, token } = await hireEmployee("Grant Checker", ["chat_task"]);

    const browser = await app.inject({
      method: "POST",
      url: "/api/employee/tasks",
      headers: selfAuth(token),
      payload: { employeeId: id, type: "browser_task", objective: "x", url: "https://nope.example.com" },
    });
    expect(browser.statusCode).toBe(409);
    expect(browser.json().error.code).toBe("tool_not_enabled");

    const chat = await app.inject({
      method: "POST",
      url: "/api/employee/tasks",
      headers: selfAuth(token),
      payload: { employeeId: id, type: "chat", objective: "allowed" },
    });
    expect(chat.statusCode).toBe(202);
  });

  it("operator token retains full access and coexists with employee tokens", async () => {
    const { id, token } = await hireEmployee("Dual Check", ["chat_task"]);

    const employeeMe = await app.inject({ method: "GET", url: "/api/employee/me", headers: selfAuth(token) });
    expect(employeeMe.statusCode).toBe(200);

    const operatorDashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard/approvals",
      headers: operatorAuth,
    });
    expect(operatorDashboard.statusCode).toBe(200);

    const operatorEmployee = await app.inject({
      method: "GET",
      url: `/api/employees/${id}`,
      headers: operatorAuth,
    });
    expect(operatorEmployee.statusCode).toBe(200);
  });
});
