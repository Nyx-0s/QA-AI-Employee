import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { runHireCli, type HireIo } from "../src/cli/hire.js";
import { hashToken } from "../src/auth/tokens.js";
import { openDatabase } from "../src/db/sqlite.js";
import { EmployeeRepository } from "../src/db/repositories/employees.js";
import { TokenRepository } from "../src/db/repositories/tokens.js";
import { TaskRepository } from "../src/db/repositories/tasks.js";
import { pollOnce, resolveToken } from "../src/cli/work.js";
import { CliError } from "../src/cli/hireCore.js";

/**
 * Phase 4 CLI tests — the non-interactive paths the spec pins:
 * flag-driven hires, the data-clerk template, validation failures, token
 * generation (shown once, stored hashed), and the work runner's polling.
 */

function makeIo(lines: string[] = []): { io: HireIo; out: string[] } {
  const out: string[] = [];
  let index = 0;
  return {
    io: {
      question: async () => {
        const line = lines[index++];
        if (line === undefined) throw new Error("test ran out of scripted input lines");
        return line;
      },
      print: (text) => out.push(text),
    },
    out,
  };
}

function makeDeps() {
  const dataDir = mkdtempSync(join(tmpdir(), "consentark-hire-cli-"));
  const db = openDatabase(dataDir);
  const employees = new EmployeeRepository(db);
  const tokens = new TokenRepository(db);
  const tasks = new TaskRepository(db);
  const cleanup = (): void => rmSync(dataDir, { recursive: true, force: true });
  return { deps: { employees, tokens }, employees, tokens, tasks, cleanup };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hire CLI — non-interactive", () => {
  it("hires with flags, prints the token once, and stores the hash", async () => {
    const { deps, employees, tokens, cleanup } = makeDeps();
    try {
      const { io, out } = makeIo();
      const code = await runHireCli({
        argv: [
          "--name", "Night Clerk",
          "--tools", "chat_task,browser_task",
          "--allowlist", "crm.example.com",
          "--no-confirm",
          "--backend", "local",
          "--model", "OLMoE-7B",
          "--max-steps", "30",
          "--system-prompt", "You are a night-shift clerk.",
        ],
        io,
        deps,
      });
      expect(code).toBe(0);

      const employee = employees.get("night-clerk");
      expect(employee).not.toBeNull();
      expect(employee?.toolsEnabled).toEqual(["chat_task", "browser_task"]);
      expect(employee?.confirmBeforeSubmit).toBe(false);
      expect(employee?.maxStepsPerTask).toBe(30);

      // The token is printed; the DB holds only its sha256.
      // (32 random bytes → 43 base64url chars; the line is indented.)
      const tokenLine = out.find((line) => line.trim().length === 43 && !line.trim().includes(" "));
      expect(tokenLine).toBeDefined();
      const token = tokenLine!.trim();
      expect(tokens.employeeIdForToken(token)).toBe("night-clerk");
      expect(tokens.listForEmployee("night-clerk")).toEqual([hashToken(token)]);

      // Next-step instructions mention the work runner.
      expect(out.some((line) => line.includes("npm run work"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("data-clerk template pre-fills the flagship persona (consent gate ON)", async () => {
    const { deps, employees, cleanup } = makeDeps();
    try {
      const { io, out } = makeIo(["crm.example.com"]); // scripted allowlist prompt
      const code = await runHireCli({
        argv: ["--template", "data-clerk", "--allowlist", "crm.example.com"],
        io,
        deps,
      });
      expect(code).toBe(0);

      const employee = employees.get("data-clerk");
      expect(employee).not.toBeNull();
      expect(employee?.role).toBe("data_clerk");
      expect(employee?.toolsEnabled).toEqual(["chat_task", "browser_task"]);
      expect(employee?.confirmBeforeSubmit).toBe(true); // the poster child
      expect(employee?.maxStepsPerTask).toBe(40);
      expect(employee?.systemPrompt).toContain("consent gate");
      // The template's prompt scaffolding targets data-entry work.
      expect(employee?.systemPrompt).toContain("SOURCE");
      expect(employee?.systemPrompt).toContain("TARGET");
      expect(out.some((line) => line.includes("Template: data-clerk"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("rejects invalid flags with friendly errors (exit 1, nothing written)", async () => {
    const { deps, employees, cleanup } = makeDeps();
    try {
      const { io, out } = makeIo();
      const badTool = await runHireCli({
        argv: ["--name", "X", "--tools", "browser_task,magic_tool", "--backend", "cloud", "--system-prompt", "s"],
        io,
        deps,
      });
      expect(badTool).toBe(1);
      expect(out.some((line) => line.includes("unknown tool"))).toBe(true);

      const badBackend = await runHireCli({
        argv: ["--name", "Y", "--tools", "chat_task", "--backend", "quantum", "--system-prompt", "s"],
        io,
        deps,
      });
      expect(badBackend).toBe(1);
      expect(out.some((line) => line.includes("backend must be"))).toBe(true);

      const badSteps = await runHireCli({
        argv: ["--name", "Z", "--tools", "chat_task", "--backend", "cloud", "--max-steps", "9999", "--system-prompt", "s"],
        io,
        deps,
      });
      expect(badSteps).toBe(1);
      expect(out.some((line) => line.includes("maxSteps must be an integer between 1 and 200"))).toBe(true);

      const badDomain = await runHireCli({
        argv: [
          "--name", "W",
          "--tools", "chat_task,browser_task",
          "--allowlist", "https://app.example.com/forms",
          "--backend", "cloud",
          "--system-prompt", "s",
        ],
        io,
        deps,
      });
      // URLs are NORMALIZED to the hostname (runtime contract), not rejected.
      expect(badDomain).toBe(0);
      expect(employees.get("w")?.allowedDomains).toEqual(["app.example.com"]);

      // Nothing from the failed runs persisted.
      expect(employees.get("x")).toBeNull();
      expect(employees.get("y")).toBeNull();
      expect(employees.get("z")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("interactive mode shows a summary card and REQUIRES explicit confirm", async () => {
    const { deps, employees, cleanup } = makeDeps();
    try {
      // Scripted answers: name, tools, allowlist, consent, backend, model, steps, prompt, then CONFIRM.
      const decline = makeIo([
        "Declined Clerk",
        "chat_task",
        "",
        "y",
        "cloud",
        "auto",
        "",
        "You are a clerk.",
        "n", // ← the explicit confirm: NO
      ]);
      const declined = await runHireCli({ argv: [], io: decline.io, deps });
      expect(declined).toBe(1);
      expect(decline.out.some((line) => line.includes("About to create"))).toBe(true);
      expect(decline.out.some((line) => line.includes("Aborted — nothing was written"))).toBe(true);
      expect(employees.get("declined-clerk")).toBeNull();

      // Same answers, but confirmed → written, token printed.
      const accept = makeIo([
        "Accepted Clerk",
        "chat_task",
        "",
        "y",
        "cloud",
        "auto",
        "",
        "You are a clerk.",
        "y",
      ]);
      const accepted = await runHireCli({ argv: [], io: accept.io, deps });
      expect(accepted).toBe(0);
      expect(employees.get("accepted-clerk")).not.toBeNull();
      expect(accept.out.some((line) => line.includes("Hiring token"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("requires a name in non-interactive mode and errors cleanly", async () => {
    const { deps, employees, cleanup } = makeDeps();
    try {
      const { io, out } = makeIo(); // no scripted lines: any prompt throws
      const code = await runHireCli({
        argv: ["--tools", "chat_task", "--backend", "cloud", "--system-prompt", "s"],
        io,
        deps,
      });
      // No --name → interactive path → scripted io throws → clean error.
      expect(code).toBe(1);
      expect(out.some((line) => line.startsWith("error:"))).toBe(true);
      expect(employees.get("employee")).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("work CLI", () => {
  it("resolveToken prefers flag, then env, then file; errors when none", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const tokenFile = join(tmpdir(), `ca-token-${Date.now()}.txt`);
    fs.writeFileSync(tokenFile, "file-token-abc\n");

    vi.stubEnv("CONSENTARK_EMPLOYEE_TOKEN", "env-token-abc");
    try {
      expect(resolveToken({ once: false, help: false, token: "flag-token" })).toBe("flag-token");
      expect(resolveToken({ once: false, help: false })).toBe("env-token-abc");
      vi.stubEnv("CONSENTARK_EMPLOYEE_TOKEN", "");
      expect(resolveToken({ once: false, help: false, tokenFile })).toBe("file-token-abc");
    } finally {
      vi.unstubAllEnvs();
      rmSync(tokenFile, { force: true });
    }
  });

  it("polls the employee-scoped API with the token and prints active tasks", async () => {
    const printed: string[] = [];
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: "tsk_1", type: "chat", status: "running", objective: "Do the thing" },
          { id: "tsk_2", type: "chat", status: "done", objective: "Old news" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const tasks = await pollOnce({
      api: "http://api.test",
      token: "some-token",
      fetchImpl: fakeFetch as unknown as typeof fetch,
      io: { print: (t) => printed.push(t) },
    });
    expect(tasks).toHaveLength(2);
    expect(fakeFetch).toHaveBeenCalledWith("http://api.test/api/employee/tasks", {
      headers: { authorization: "Bearer some-token" },
    });
    expect(printed.some((line) => line.includes("tsk_1 [chat] running"))).toBe(true);
    expect(printed.some((line) => line.includes("Do the thing"))).toBe(true);
    expect(printed.some((line) => line.includes("Old news"))).toBe(false);
  });

  it("fails honestly on a rejected token (401)", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(
      pollOnce({
        api: "http://api.test",
        token: "revoked",
        fetchImpl: fakeFetch as unknown as typeof fetch,
        io: { print: () => undefined },
      }),
    ).rejects.toThrow(/token rejected/);
  });

  it("throws a clean error when no token source exists", () => {
    const previous = process.env.CONSENTARK_EMPLOYEE_TOKEN;
    delete process.env.CONSENTARK_EMPLOYEE_TOKEN;
    try {
      expect(() => resolveToken({ once: false, help: false })).toThrow(CliError);
    } finally {
      if (previous !== undefined) process.env.CONSENTARK_EMPLOYEE_TOKEN = previous;
    }
  });
});
