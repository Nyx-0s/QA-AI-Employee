import { describe, expect, it } from "vitest";
import type { TaskLog } from "@consentark/shared";
import { auditGroupKind, auditHasLlmAndBrowser, groupAuditLogs } from "../src/lib/audit.js";

const log = (phase: TaskLog["phase"], message: string): TaskLog => ({
  at: "2026-09-15T12:00:00Z",
  level: "info",
  phase,
  message,
});

describe("auditGroupKind", () => {
  it("maps phases to visual groups", () => {
    expect(auditGroupKind("plan")).toBe("llm");
    expect(auditGroupKind("llm")).toBe("llm");
    expect(auditGroupKind("browser")).toBe("browser");
    expect(auditGroupKind("tool")).toBe("browser");
    expect(auditGroupKind("safety")).toBe("safety");
    expect(auditGroupKind("system")).toBe("system");
  });
});

describe("groupAuditLogs", () => {
  it("groups consecutive same-kind entries and preserves order", () => {
    const logs = [
      log("plan", "Planning the task"),
      log("llm", "Calling cloud (FreeLLMAPI)"),
      log("browser", "Navigating to the page"),
      log("tool", "Clicked submit button"),
      log("llm", "Summarising result"),
    ];
    const groups = groupAuditLogs(logs);
    expect(groups.map((g) => g.kind)).toEqual(["llm", "browser", "llm"]);
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[1].label).toBe("Browser actions");
  });

  it("handles empty logs", () => {
    expect(groupAuditLogs([])).toEqual([]);
  });
});

describe("auditHasLlmAndBrowser", () => {
  it("requires both llm and browser evidence", () => {
    expect(auditHasLlmAndBrowser([log("llm", "x"), log("browser", "y")])).toBe(true);
    expect(auditHasLlmAndBrowser([log("llm", "x")])).toBe(false);
    expect(auditHasLlmAndBrowser([])).toBe(false);
  });
});
