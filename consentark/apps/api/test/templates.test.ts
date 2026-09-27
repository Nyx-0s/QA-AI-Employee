import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runHireCli, type HireIo } from "../src/cli/hire.js";
import { getTemplate, resolveHireInput, TEMPLATES, TEMPLATE_ALIASES } from "../src/cli/hireCore.js";
import { openDatabase } from "../src/db/sqlite.js";
import { EmployeeRepository } from "../src/db/repositories/employees.js";
import { TokenRepository } from "../src/db/repositories/tokens.js";

/**
 * Template registry tests — every launch persona hires cleanly through the
 * same CLI path, keeps its consent posture, and validates schedule flags.
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
  const dataDir = mkdtempSync(join(tmpdir(), "consentark-templates-"));
  const db = openDatabase(dataDir);
  const cleanup = (): void => rmSync(dataDir, { recursive: true, force: true });
  return { deps: { employees: new EmployeeRepository(db), tokens: new TokenRepository(db) }, cleanup };
}

describe("template registry", () => {
  it("offers the three launch personas with consent gates ON", () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(["data-clerk", "outreach-assistant", "qa-analyst"]);
    for (const alias of Object.keys(TEMPLATES)) {
      const template = getTemplate(alias);
      expect(template).not.toBeNull();
      expect(template!.confirmBeforeSubmit).toBe(true);
      expect(template!.systemPrompt.length).toBeGreaterThan(50);
      expect(template!.toolsEnabled).toContain("browser_task");
    }
  });

  it("aliases list data-clerk first (flagship) and resolve cleanly", () => {
    expect(TEMPLATE_ALIASES.startsWith("data-clerk")).toBe(true);
    expect(getTemplate("no-such-template")).toBeNull();
  });

  it("the outreach template never sends: the rule is in the standing instructions", () => {
    const template = getTemplate("outreach-assistant")!;
    expect(template.systemPrompt).toMatch(/never SEND/i);
    expect(template.systemPrompt).toMatch(/APPROVAL: PENDING/);
    expect(template.systemPrompt).toMatch(/consent gate/i);
  });

  it("the QA template refuses live submissions and demands evidence", () => {
    const template = getTemplate("qa-analyst")!;
    expect(template.systemPrompt).toMatch(/NEVER submit a form/i);
    expect(template.systemPrompt).toMatch(/OBSERVATIONS/i);
    expect(template.maxStepsPerTask).toBeGreaterThan(40); // exploration headroom
  });

  it("template profile resolves with schedule flags", () => {
    const input = resolveHireInput({
      templateAlias: "data-clerk",
      name: "Scheduled Clerk",
      systemPrompt: "x",
      tools: "chat_task",
      backend: "cloud",
      scheduleCron: "0 8 * * 1-5",
      scheduleTask: "Morning sweep",
    });
    expect(input.schedule).toEqual({ cron: "0 8 * * 1-5", taskTemplate: "Morning sweep" });
    expect(input.role).toBe("data_clerk");
  });

  it("rejects cron without task, task without cron, and malformed cron", () => {
    expect(() => resolveHireInput({ scheduleCron: "0 8 * * 1-5" })).toThrow(/--schedule-task/);
    expect(() => resolveHireInput({ scheduleTask: "solo" })).toThrow(/--schedule-cron/);
    expect(() => resolveHireInput({ scheduleCron: "0 8 *", scheduleTask: "x" })).toThrow(/5 fields/);
  });
});

describe("hire CLI — templates", () => {
  it("hires an outreach-assistant by alias with consent gate ON", async () => {
    const { deps, cleanup } = makeDeps();
    try {
      const { io, out } = makeIo(["prospect.example.com"]);
      const code = await runHireCli({
        argv: ["--template", "outreach-assistant", "--allowlist", "prospect.example.com"],
        io,
        deps,
      });
      expect(code).toBe(0);
      const employee = deps.employees.get("outreach-assistant");
      expect(employee).not.toBeNull();
      expect(employee?.role).toBe("outreach_assistant");
      expect(employee?.confirmBeforeSubmit).toBe(true);
      expect(employee?.systemPrompt).toMatch(/never SEND/i);
      expect(out.some((line) => line.includes("Template: outreach-assistant"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("hires a qa-analyst and preserves explicit flag overrides", async () => {
    const { deps, cleanup } = makeDeps();
    try {
      const { io } = makeIo(["client.example.com"]);
      const code = await runHireCli({
        argv: [
          "--template", "qa-analyst",
          "--allowlist", "client.example.com",
          "--name", "Site Auditor",
          "--max-steps", "80",
        ],
        io,
        deps,
      });
      expect(code).toBe(0);
      const employee = deps.employees.get("site-auditor");
      expect(employee).not.toBeNull();
      expect(employee?.role).toBe("qa_analyst");
      expect(employee?.maxStepsPerTask).toBe(80); // override wins
      expect(employee?.confirmBeforeSubmit).toBe(true); // template posture kept
    } finally {
      cleanup();
    }
  });

  it("hires with a schedule in one command", async () => {
    const { deps, cleanup } = makeDeps();
    try {
      const { io } = makeIo([]);
      const code = await runHireCli({
        argv: [
          "--template", "data-clerk",
          "--allowlist", "orders.example.com",
          "--schedule-cron", "0 8 * * 1-5",
          "--schedule-task", "Enter yesterday's phone orders",
        ],
        io,
        deps,
      });
      expect(code).toBe(0);
      const employee = deps.employees.get("data-clerk");
      expect(employee?.schedule).toEqual({
        cron: "0 8 * * 1-5",
        taskTemplate: "Enter yesterday's phone orders",
      });
    } finally {
      cleanup();
    }
  });

  it("still rejects unknown templates with the full alias list", async () => {
    const { deps, cleanup } = makeDeps();
    try {
      const { io, out } = makeIo();
      const code = await runHireCli({ argv: ["--template", "space-lawyer"], io, deps });
      expect(code).toBe(1);
      expect(out.some((line) => line.includes("available: data-clerk, outreach-assistant, qa-analyst"))).toBe(true);
    } finally {
      cleanup();
    }
  });
});
