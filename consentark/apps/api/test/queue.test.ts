import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/sqlite.js";
import { TaskRepository } from "../src/db/repositories/tasks.js";
import { EmployeeRepository } from "../src/db/repositories/employees.js";
import { MemoryTaskQueue } from "../src/queue/memoryQueue.js";
import { TaskRunner } from "../src/queue/taskRunner.js";
import type { EmployeeCreateInput } from "@consentark/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config/env.js";
import { LLMError } from "../src/llm/provider.js";
import type { LLMProvider } from "../src/llm/provider.js";

/**
 * Queue + persistence tests. Real SQLite (temp dir), real in-memory queue.
 * Crash recovery is simulated by constructing a FRESH TaskRunner over the
 * SAME database — exactly what happens after a server restart.
 */

let dataDir: string;
let db: ReturnType<typeof openDatabase>;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "consentark-test-"));
  db = openDatabase(dataDir);
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function makeDeps(): {
  tasks: TaskRepository;
  employees: EmployeeRepository;
  queue: MemoryTaskQueue;
} {
  const tasks = new TaskRepository(db);
  const employees = new EmployeeRepository(db);
  const queue = new MemoryTaskQueue();
  return { tasks, employees, queue };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    PORT: 4000,
    DATA_DIR: dataDir,
    ADMIN_TOKEN: "test-token-123456",
    CORS_ORIGIN: "*",
    LOG_LEVEL: "error",
    FREELLMAPI_URL: "http://llm.test/v1",
    FREELLMAPI_KEY: "k",
    FREELLMAPI_MODEL: "auto",
    FREELLMAPI_TIMEOUT_MS: 5000,
    COLIBRI_URL: "http://llm.test/v1",
    COLIBRI_MODEL: "OLMoE-7B",
    COLIBRI_TIMEOUT_MS: 5000,
    LOCAL_FALLBACK_TO_CLOUD: false,
    LLM_RETRIES: 0,
    LLM_RETRY_BASE_MS: 1,
    WORKER_CONCURRENCY: 1,
    ...overrides,
  };
}

function makeRunner(
  deps: { tasks: TaskRepository; employees: EmployeeRepository; queue: MemoryTaskQueue },
  provider: LLMProvider,
  configOverrides: Partial<Config> = {},
): TaskRunner {
  const providers = { cloud: provider, local: provider };
  return new TaskRunner(makeConfig(configOverrides), deps.queue, providers, deps.tasks, deps.employees);
}

const CLERK: EmployeeCreateInput = {
  name: "Data Clerk 01",
  role: "data_clerk",
  description: "",
  systemPrompt: "You are a meticulous data clerk. Reply as JSON: {\"steps\":[...],\"reply\":\"...\"}",
  backend: "local",
  model: "OLMoE-7B",
  toolsEnabled: ["chat_task"],
  allowedDomains: [],
  confirmBeforeSubmit: true,
  maxStepsPerTask: 25,
  schedule: null,
};

function providerReply(content: string): LLMProvider {
  return {
    kind: "local",
    label: "local (test)",
    chat: async () => ({
      content,
      model: "OLMoE-7B",
      provider: "local (test)",
      latencyMs: 12,
      usage: { promptTokens: 5, completionTokens: 9, totalTokens: 14 },
      routedVia: null,
    }),
    health: async () => ({ ok: true }),
  };
}

function failingProvider(code: string, retriable: boolean): LLMProvider {
  return {
    kind: "local",
    label: "local (test)",
    chat: async () => {
      throw new LLMError(code, "simulated outage", retriable);
    },
    health: async () => ({ ok: false }),
  };
}

async function seedEmployee(employees: EmployeeRepository): Promise<void> {
  employees.create("data-clerk-01", CLERK, new Date().toISOString());
}

describe("task creation and persistence", () => {
  it("persists a chat task before it runs", async () => {
    const { tasks, employees } = makeDeps();
    await seedEmployee(employees);
    const runner = makeRunner(makeDeps(), providerReply("ok"));
    const task = runner.createChatTask(employees.get("data-clerk-01")!, "hello there");

    const stored = tasks.get(task.id);
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("queued");
    expect(stored?.objective).toBe("hello there");
    expect(stored?.logs.some((log) => log.phase === "system")).toBe(true);
  });
});

describe("crash recovery (restart over the same database)", () => {
  it("re-queues tasks stuck in running after a restart", async () => {
    const { tasks, employees, queue } = makeDeps();
    await seedEmployee(employees);
    const runner = makeRunner({ tasks, employees, queue }, providerReply("recovered reply"));
    const task = runner.createChatTask(employees.get("data-clerk-01")!, "interrupt me");

    // Simulate a crash mid-run: row says running, queue memory is gone.
    tasks.setStatus(task.id, "running", new Date().toISOString());

    const freshRunner = makeRunner(
      { tasks, employees, queue: new MemoryTaskQueue() },
      providerReply("recovered reply"),
    );
    const recovered = freshRunner.recover();

    expect(recovered).toBe(1);
    const after = tasks.get(task.id)!;
    expect(after.status).toBe("queued");
    expect(after.logs.some((log) => log.message.includes("re-queued"))).toBe(true);
  });

  it("re-enqueues queued tasks left behind by a crash", async () => {
    const { tasks, employees, queue } = makeDeps();
    await seedEmployee(employees);
    const runner = makeRunner({ tasks, employees, queue }, providerReply("ok"));
    runner.createChatTask(employees.get("data-clerk-01")!, "queued work");

    // Crash: the in-memory queue is lost; a fresh process re-reads SQLite.
    const freshRunner = makeRunner(
      { tasks, employees, queue: new MemoryTaskQueue() },
      providerReply("ok"),
    );
    const recovered = freshRunner.recover();
    expect(recovered).toBe(1);
  });

  it("does not touch completed or failed tasks", async () => {
    const { tasks, employees, queue } = makeDeps();
    await seedEmployee(employees);
    const runner = makeRunner({ tasks, employees, queue }, providerReply("ok"));
    const done = runner.createChatTask(employees.get("data-clerk-01")!, "a");
    tasks.setStatus(done.id, "done", new Date().toISOString());
    const failed = runner.createChatTask(employees.get("data-clerk-01")!, "b");
    tasks.setStatus(failed.id, "failed", new Date().toISOString());

    expect(runner.recover()).toBe(0);
  });
});

describe("task execution", () => {
  it("runs a chat task to done with output and an audit trail", async () => {
    const { tasks, employees, queue } = makeDeps();
    await seedEmployee(employees);
    const runner = makeRunner(
      { tasks, employees, queue },
      providerReply(JSON.stringify({ steps: ["read sheet"], reply: "all 40 rows cleaned" })),
    );
    const task = runner.createChatTask(employees.get("data-clerk-01")!, "clean the sheet");
    await runner.executeById(task.id);

    const finished = tasks.get(task.id)!;
    expect(finished.status).toBe("done");
    expect(finished.output).toMatchObject({
      reply: "all 40 rows cleaned",
      model: "OLMoE-7B",
      tokens: 14,
    });
    expect(finished.plan?.steps).toEqual(["read sheet"]);
    // (The in-memory fake emits no llm events; llm-phase audit lines are
    // covered in routes.test.ts, which exercises the real HTTP client.)
    expect(finished.logs.map((log) => log.phase)).toEqual(
      expect.arrayContaining(["system", "plan"]),
    );
    expect(finished.logs.some((log) => log.message.includes("completed the task"))).toBe(true);
  });

  it("uses raw text as the reply when the model answers in prose", async () => {
    const { tasks, employees, queue } = makeDeps();
    await seedEmployee(employees);
    const runner = makeRunner({ tasks, employees, queue }, providerReply("Just a plain answer."));
    const task = runner.createChatTask(employees.get("data-clerk-01")!, "say something");
    await runner.executeById(task.id);

    const finished = tasks.get(task.id)!;
    expect(finished.status).toBe("done");
    expect((finished.output as { reply: string }).reply).toBe("Just a plain answer.");
  });

  it("fails honestly when the LLM is unreachable (no fake success)", async () => {
    const { tasks, employees, queue } = makeDeps();
    await seedEmployee(employees);
    const runner = makeRunner({ tasks, employees, queue }, failingProvider("llm_timeout", true));
    const task = runner.createChatTask(employees.get("data-clerk-01")!, "will fail");
    await runner.executeById(task.id);

    const finished = tasks.get(task.id)!;
    expect(finished.status).toBe("failed");
    expect(finished.error).toMatchObject({ code: "llm_timeout", retriable: true });
    expect(finished.output).toBeNull();
  });

  it("does NOT fall back to cloud while LOCAL_FALLBACK_TO_CLOUD is off", async () => {
    const { tasks, employees, queue } = makeDeps();
    await seedEmployee(employees);
    let cloudCalls = 0;
    const cloudSpy: LLMProvider = {
      kind: "cloud",
      label: "cloud (test)",
      chat: async (request, onEvent) => {
        cloudCalls++;
        return providerReply("should not be used").chat(request, onEvent);
      },
      health: async () => ({ ok: true }),
    };
    // Point the runner at the spy for cloud while local keeps failing.
    const runnerWithSpy = new TaskRunner(
      makeConfig({ LOCAL_FALLBACK_TO_CLOUD: false }),
      queue,
      { cloud: cloudSpy, local: failingProvider("network_error", true) },
      tasks,
      employees,
    );
    const task = runnerWithSpy.createChatTask(employees.get("data-clerk-01")!, "stay local");
    await runnerWithSpy.executeById(task.id);

    expect(cloudCalls).toBe(0);
    expect(tasks.get(task.id)!.status).toBe("failed");
  });

  it("falls back to cloud ONLY when LOCAL_FALLBACK_TO_CLOUD is on", async () => {
    const { tasks, employees, queue } = makeDeps();
    await seedEmployee(employees);
    let cloudCalls = 0;
    const cloudSpy: LLMProvider = {
      kind: "cloud",
      label: "cloud (test)",
      chat: async (request, onEvent) => {
        cloudCalls++;
        return providerReply("cloud rescued this task").chat(request, onEvent);
      },
      health: async () => ({ ok: true }),
    };
    const runnerWithFallback = new TaskRunner(
      makeConfig({ LOCAL_FALLBACK_TO_CLOUD: true }),
      queue,
      { cloud: cloudSpy, local: failingProvider("network_error", true) },
      tasks,
      employees,
    );
    const task = runnerWithFallback.createChatTask(employees.get("data-clerk-01")!, "use fallback");
    await runnerWithFallback.executeById(task.id);

    expect(cloudCalls).toBe(1);
    const finished = tasks.get(task.id)!;
    expect(finished.status).toBe("done");
    expect((finished.output as { reply: string }).reply).toBe("cloud rescued this task");
    expect(finished.logs.some((log) => log.message.includes("falling back to the cloud"))).toBe(true);
  });

  it("refuses to run tasks for paused employees", async () => {
    const { tasks, employees, queue } = makeDeps();
    await seedEmployee(employees);
    const runner = makeRunner({ tasks, employees, queue }, providerReply("nope"));
    const task = runner.createChatTask(employees.get("data-clerk-01")!, "should not run");
    employees.patch("data-clerk-01", { status: "paused" });
    await runner.executeById(task.id);

    const finished = tasks.get(task.id)!;
    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("employee_paused");
  });

  it("silently skips unknown or vanished task ids", async () => {
    const { tasks, employees, queue } = makeDeps();
    const runner = makeRunner({ tasks, employees, queue }, providerReply("nope"));
    await expect(runner.executeById("tsk_nope")).resolves.toBeUndefined();
  });

  it("hard delete cascades the employee's queued task history", async () => {
    const { tasks, employees, queue } = makeDeps();
    await seedEmployee(employees);
    const runner = makeRunner({ tasks, employees, queue }, providerReply("nope"));
    const task = runner.createChatTask(employees.get("data-clerk-01")!, "to be removed");
    employees.hardDelete("data-clerk-01");

    // Foreign keys ON: the task row (and its audit logs) cascade away with
    // the employee — hard delete is only possible when nothing is running.
    expect(tasks.get(task.id)).toBeNull();
  });
});
