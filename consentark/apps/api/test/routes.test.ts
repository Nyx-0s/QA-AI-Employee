import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, type AppContext } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route integration tests through the REAL app factory (auth, CORS, error
 * handler, SQLite) using fastify.inject — no network, no real LLM. A mocked
 * global fetch stands in for the OpenAI-compatible backend so full task
 * flows run end-to-end: hire → chat → poll → audit trail.
 */

let dataDir: string;
let app: FastifyInstance;
let context: AppContext;

const TOKEN = "test-admin-token-xyz";
const auth = { authorization: `Bearer ${TOKEN}` };

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn());
  dataDir = mkdtempSync(join(tmpdir(), "consentark-routes-"));
  const built = await buildApp(
    {
      PORT: "4310",
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
    },
    { startWorker: false }, // tests drive the runner manually for determinism
  );
  app = built.app;
  context = built.context;
});

afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
  rmSync(dataDir, { recursive: true, force: true });
});

function ctx(): AppContext {
  return context;
}

function mockLLM(content: string): void {
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        model: "auto-served",
        choices: [{ message: { role: "assistant", content } }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

async function hire(name = "Data Clerk 01"): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/employees",
    headers: auth,
    payload: {
      name,
      role: "data_clerk",
      systemPrompt: "You are a meticulous data clerk.",
      toolsEnabled: ["chat_task"],
    },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

describe("auth", () => {
  it("rejects requests without a token", async () => {
    const response = await app.inject({ method: "GET", url: "/api/employees" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("unauthorized");
  });

  it("allows /api/health without a token", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
  });
});

describe("employee CRUD", () => {
  it("hires, lists, gets, patches and soft-deletes", async () => {
    const id = await hire();

    const list = await app.inject({ method: "GET", url: "/api/employees", headers: auth });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].tasksCompleted).toBe(0);

    const got = await app.inject({ method: "GET", url: `/api/employees/${id}`, headers: auth });
    const employee = got.json();
    // Safety fields are always present and enforced — never nullable.
    expect(employee.allowedDomains).toEqual([]);
    expect(employee.confirmBeforeSubmit).toBe(true);
    expect(employee.maxStepsPerTask).toBe(25);
    expect(employee.status).toBe("active");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/employees/${id}`,
      headers: auth,
      payload: { backend: "local", model: "OLMoE-7B", maxStepsPerTask: 40 },
    });
    expect(patched.json().backend).toBe("local");
    expect(patched.json().maxStepsPerTask).toBe(40);

    const paused = await app.inject({ method: "DELETE", url: `/api/employees/${id}`, headers: auth });
    expect(paused.json()).toMatchObject({ deleted: false, mode: "soft" });
    const afterPause = await app.inject({ method: "GET", url: `/api/employees/${id}`, headers: auth });
    expect(afterPause.json().status).toBe("paused");

    // Chat is refused while paused.
    const chat = await app.inject({
      method: "POST",
      url: `/api/employees/${id}/chat`,
      headers: auth,
      payload: { message: "hello" },
    });
    expect(chat.statusCode).toBe(409);
  });

  it("hard-deletes only when no work is in flight", async () => {
    const id = await hire("Hard Delete Candidate");
    const response = await app.inject({
      method: "DELETE",
      url: `/api/employees/${id}?hard=true`,
      headers: auth,
    });
    expect(response.json()).toMatchObject({ deleted: true, mode: "hard" });
    const gone = await app.inject({ method: "GET", url: `/api/employees/${id}`, headers: auth });
    expect(gone.statusCode).toBe(404);
  });

  it("rejects invalid payloads with field details", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers: auth,
      payload: { name: "", systemPrompt: "x" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
  });
});

describe("chat flow end-to-end (mocked LLM)", () => {
  it("hires → chats → executes → exposes output + audit trail", async () => {
    const id = await hire();
    mockLLM(JSON.stringify({ steps: ["greet"], reply: "Hello, I am your data clerk." }));

    const chat = await app.inject({
      method: "POST",
      url: `/api/employees/${id}/chat`,
      headers: auth,
      payload: { message: "Introduce yourself." },
    });
    expect(chat.statusCode).toBe(202);
    const { id: taskId } = chat.json() as { id: string };

    // Run the task synchronously for determinism (worker is disabled here).
    const context = ctx();
    await context.runner.executeById(taskId);

    const detail = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: auth });
    const task = detail.json();
    expect(task.status).toBe("done");
    expect(task.output.reply).toBe("Hello, I am your data clerk.");
    expect(task.plan.steps).toEqual(["greet"]);
    // The audit trail is human-readable and ordered.
    const messages = task.logs.map((log: { message: string }) => log.message);
    expect(messages.some((message: string) => message.includes("Calling cloud (FreeLLMAPI)"))).toBe(true);
    expect(messages.some((message: string) => message.includes("completed the task"))).toBe(true);
  });

  it("marks a task failed when no LLM backend is reachable", async () => {
    const id = await hire("Offline Clerk");
    vi.mocked(fetch).mockRejectedValue(new TypeError("connect ECONNREFUSED"));

    const chat = await app.inject({
      method: "POST",
      url: `/api/employees/${id}/chat`,
      headers: auth,
      payload: { message: "hello" },
    });
    const { id: taskId } = chat.json() as { id: string };

    const context = ctx();
    await context.runner.executeById(taskId);

    const detail = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: auth });
    const task = detail.json();
    expect(task.status).toBe("failed");
    expect(task.error.code).toBe("network_error");
    expect(task.output).toBeNull();
  });

  it("rejects browser_task when the tool is not enabled or the domain is off-list", async () => {
    // Default hire: no toolsEnabled, empty allowlist.
    const id = await hire();

    // (a) tool not enabled → 409 before any domain check
    const noTool = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: auth,
      payload: {
        employeeId: id,
        type: "browser_task",
        objective: "Scrape the CRM",
        url: "https://crm.example.com",
      },
    });
    expect(noTool.statusCode).toBe(409);
    expect(noTool.json().error.code).toBe("tool_not_enabled");

    // (b) tool enabled but domain off-list → 403
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/employees/${id}`,
      headers: auth,
      payload: { toolsEnabled: ["chat_task", "browser_task"], allowedDomains: ["127.0.0.1"] },
    });
    expect(patch.statusCode).toBe(200);
    const offList = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: auth,
      payload: {
        employeeId: id,
        type: "browser_task",
        objective: "Scrape the CRM",
        url: "https://crm.example.com",
      },
    });
    expect(offList.statusCode).toBe(403);
    expect(offList.json().error.code).toBe("domain_not_allowed");
  });

  it("cancels a queued task", async () => {
    const id = await hire();
    mockLLM("unused");
    const task = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: auth,
      payload: { employeeId: id, type: "chat", objective: "long job" },
    });
    const { id: taskId } = task.json() as { id: string };

    const cancel = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/cancel`,
      headers: auth,
    });
    expect(cancel.json()).toMatchObject({ cancelled: true, status: "cancelled" });

    const detail = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: auth });
    expect(detail.json().status).toBe("cancelled");
  });

  it("404s unknown tasks and validates filters", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/tasks/tsk_nope", headers: auth });
    expect(missing.statusCode).toBe(404);

    const id = await hire();
    mockLLM("x");
    await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: auth,
      payload: { employeeId: id, type: "chat", objective: "filter me" },
    });
    const filtered = await app.inject({
      method: "GET",
      url: "/api/tasks?status=queued&employeeId=" + id,
      headers: auth,
    });
    expect(filtered.json()).toHaveLength(1);
  });
});
