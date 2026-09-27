import { employeeCreateSchema, employeePatchSchema, taskCreateSchema } from "@consentark/shared";
import { describe, expect, it } from "vitest";

/**
 * Safety-field validation — the ConsentArk brand promise. The three safety
 * fields are NON-NULLABLE: they always resolve to an enforced value, even
 * when the caller omits them entirely.
 */

describe("employeeCreateSchema — safety fields are enforced", () => {
  it("applies safe defaults when safety fields are omitted", () => {
    const parsed = employeeCreateSchema.parse({
      name: "Data Clerk 01",
      systemPrompt: "You are a meticulous data clerk.",
    });
    expect(parsed.allowedDomains).toEqual([]); // no browsing unless granted
    expect(parsed.confirmBeforeSubmit).toBe(true); // consent-first default
    expect(parsed.maxStepsPerTask).toBe(25);
    expect(parsed.toolsEnabled).toEqual([]);
    expect(parsed.backend).toBe("cloud");
    expect(parsed.status === undefined).toBe(true); // status not client-settable
  });

  it("keeps explicit safety values verbatim", () => {
    const parsed = employeeCreateSchema.parse({
      name: "Lead Ops",
      systemPrompt: "Run lead ops.",
      allowedDomains: ["crm.example.com", "sheets.google.com"],
      confirmBeforeSubmit: false,
      maxStepsPerTask: 50,
    });
    expect(parsed.allowedDomains).toEqual(["crm.example.com", "sheets.google.com"]);
    expect(parsed.confirmBeforeSubmit).toBe(false);
    expect(parsed.maxStepsPerTask).toBe(50);
  });

  it("rejects maxStepsPerTask outside 1..200", () => {
    expect(() =>
      employeeCreateSchema.parse({ name: "X", systemPrompt: "s", maxStepsPerTask: 0 }),
    ).toThrow();
    expect(() =>
      employeeCreateSchema.parse({ name: "X", systemPrompt: "s", maxStepsPerTask: 201 }),
    ).toThrow();
    expect(() =>
      employeeCreateSchema.parse({ name: "X", systemPrompt: "s", maxStepsPerTask: 1.5 }),
    ).toThrow();
  });

  it("rejects non-boolean confirmBeforeSubmit", () => {
    expect(() =>
      employeeCreateSchema.parse({ name: "X", systemPrompt: "s", confirmBeforeSubmit: "yes" }),
    ).toThrow();
  });

  it("rejects blank names, prompts and unknown backends", () => {
    expect(() => employeeCreateSchema.parse({ name: "  ", systemPrompt: "s" })).toThrow();
    expect(() => employeeCreateSchema.parse({ name: "X", systemPrompt: "" })).toThrow();
    expect(() =>
      employeeCreateSchema.parse({ name: "X", systemPrompt: "s", backend: "quantum" }),
    ).toThrow();
  });
});

describe("employeePatchSchema", () => {
  it("allows partial updates including status", () => {
    const parsed = employeePatchSchema.parse({ status: "paused" });
    expect(parsed.status).toBe("paused");
  });

  it("rejects an invalid status", () => {
    expect(() => employeePatchSchema.parse({ status: "retired" })).toThrow();
  });
});

describe("taskCreateSchema", () => {
  it("requires a url for browser_task", () => {
    const result = taskCreateSchema.safeParse({
      employeeId: "emp",
      type: "browser_task",
      objective: "Extract the table",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("url");
    }
  });

  it("accepts a browser_task with a url", () => {
    const result = taskCreateSchema.safeParse({
      employeeId: "emp",
      type: "browser_task",
      objective: "Extract the table",
      url: "https://crm.example.com/leads",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing objective and unknown types", () => {
    expect(() => taskCreateSchema.parse({ employeeId: "emp", type: "chat", objective: "  " })).toThrow();
    expect(() =>
      taskCreateSchema.parse({ employeeId: "emp", type: "teleport", objective: "go" }),
    ).toThrow();
  });
});
