import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Scheduler, cronMatches, fieldMatches, FIELD_RANGES } from "../src/queue/scheduler.js";
import type { FieldRange } from "../src/queue/scheduler.js";
import { openDatabase } from "../src/db/sqlite.js";
import { EmployeeRepository } from "../src/db/repositories/employees.js";
import { TaskRepository } from "../src/db/repositories/tasks.js";
import { MemoryTaskQueue } from "../src/queue/memoryQueue.js";
import type { Config } from "../src/config/env.js";

/**
 * Scheduler tests — cron matching + the tick's dedupe/active/skip rules.
 *
 * Cron follows the SERVER's clock (local time), so tests construct dates
 * with local Date constructors — never `new Date(iso)`, which interprets
 * UTC and shifts the wall-clock fields the matcher reads.
 */

/** Local-time constructor: y, m (1-based), d, h, min. */
const at = (y: number, m: number, d: number, h: number, min: number): Date =>
  new Date(y, m - 1, d, h, min, 0, 0);

/** Wednesday — used for weekday-range assertions. */
const WED = { y: 2026, m: 9, d: 23 };
/** Sunday — used for the 0/7 aliases. */
const SUN = { y: 2026, m: 9, d: 20 };

describe("cron matcher", () => {
  it("matches simple wildcards at any minute", () => {
    expect(cronMatches("* * * * *", at(2026, 9, 23, 14, 7))).toBe(true);
  });

  it("matches exact minute+hour", () => {
    expect(cronMatches("30 8 * * *", at(2026, 9, 23, 8, 30))).toBe(true);
    expect(cronMatches("30 8 * * *", at(2026, 9, 23, 8, 31))).toBe(false);
    expect(cronMatches("30 8 * * *", at(2026, 9, 23, 9, 30))).toBe(false);
  });

  it("handles weekday ranges (Mon–Fri)", () => {
    expect(cronMatches("0 8 * * 1-5", at(WED.y, WED.m, WED.d, 8, 0))).toBe(true);
    expect(cronMatches("0 8 * * 1-5", at(SUN.y, SUN.m, SUN.d, 8, 0))).toBe(false);
  });

  it("accepts 0 and 7 for Sunday", () => {
    expect(cronMatches("0 8 * * 0", at(SUN.y, SUN.m, SUN.d, 8, 0))).toBe(true);
    expect(cronMatches("0 8 * * 7", at(SUN.y, SUN.m, SUN.d, 8, 0))).toBe(true);
    expect(cronMatches("0 8 * * 7", at(2026, 9, 21, 8, 0))).toBe(false);
  });

  it("handles steps like */15", () => {
    expect(cronMatches("*/15 * * * *", at(2026, 9, 23, 14, 0))).toBe(true);
    expect(cronMatches("*/15 * * * *", at(2026, 9, 23, 14, 15))).toBe(true);
    expect(cronMatches("*/15 * * * *", at(2026, 9, 23, 14, 7))).toBe(false);
  });

  it("handles lists", () => {
    expect(cronMatches("5,25,45 * * * *", at(2026, 9, 23, 14, 25))).toBe(true);
    expect(cronMatches("5,25,45 * * * *", at(2026, 9, 23, 14, 26))).toBe(false);
  });

  it("respects day-of-month and month fields", () => {
    expect(cronMatches("0 9 1 * *", at(2026, 10, 1, 9, 0))).toBe(true);
    expect(cronMatches("0 9 1 * *", at(2026, 10, 2, 9, 0))).toBe(false);
    expect(cronMatches("0 9 * 10 *", at(2026, 10, 15, 9, 0))).toBe(true);
    expect(cronMatches("0 9 * 10 *", at(2026, 9, 15, 9, 0))).toBe(false);
  });

  it("rejects malformed expressions and out-of-range values", () => {
    expect(cronMatches("61 * * * *", at(2026, 9, 23, 14, 7))).toBe(false);
    expect(cronMatches("* * * *", at(2026, 9, 23, 14, 7))).toBe(false);
    expect(cronMatches("* * * * * *", at(2026, 9, 23, 14, 7))).toBe(false);
    expect(cronMatches("not a cron", at(2026, 9, 23, 14, 7))).toBe(false);
  });

  it("fieldMatches clamps star ranges and validates explicit ones", () => {
    const minute: FieldRange = FIELD_RANGES[0];
    expect(fieldMatches("*", 59, minute)).toBe(true);
    expect(fieldMatches("0-59/30", 30, minute)).toBe(true);
    expect(fieldMatches("0-59/30", 31, minute)).toBe(false);
    expect(fieldMatches("5-3", 4, minute)).toBe(false); // inverted explicit range
    expect(fieldMatches("junk", 5, minute)).toBe(false);
  });
});

describe("Scheduler.tick", () => {
  function makeScheduler() {
    const dataDir = mkdtempSync(join(tmpdir(), "consentark-scheduler-"));
    const db = openDatabase(dataDir);
    const employees = new EmployeeRepository(db);
    const tasks = new TaskRepository(db);
    const queue = new MemoryTaskQueue();
    const config = { DATA_DIR: dataDir } as unknown as Config;
    const scheduler = new Scheduler({ config, db, employees, tasks, queue });
    const cleanup = (): void => rmSync(dataDir, { recursive: true, force: true });
    return { scheduler, employees, tasks, queue, cleanup };
  }

  const flags = {
    backend: "cloud",
    model: "auto",
    toolsEnabled: ["chat_task"],
    allowedDomains: [],
    confirmBeforeSubmit: true,
    maxStepsPerTask: 25,
  } as const;

  it("fires a scheduled task for an active employee on its cron minute", () => {
    const { scheduler, employees, tasks, queue, cleanup } = makeScheduler();
    try {
      employees.create("morning-clerk", {
        name: "Morning Clerk",
        role: "data_clerk",
        description: "",
        systemPrompt: "You are a clerk.",
        ...flags,
        schedule: { cron: "30 8 * * 1-5", taskTemplate: "Do the morning sweep." },
      }, "2026-09-21T00:00:00.000Z");

      const created = scheduler.tick(at(2026, 9, 23, 8, 30));
      expect(created).toBe(1);

      const scheduled = tasks.list({ employeeId: "morning-clerk" });
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0].type).toBe("scheduled");
      expect(scheduled[0].objective).toBe("Do the morning sweep.");
      expect(scheduled[0].status).toBe("queued");
      expect(queue.size()).toBe(1);

      // The audit line exists and is readable.
      const log = tasks.logs(scheduled[0].id).find((l) => l.phase === "system");
      expect(log?.message).toContain("cron: 30 8 * * 1-5");
    } finally {
      cleanup();
    }
  });

  it("does NOT fire off-schedule, paused, or schedule-less employees", () => {
    const { scheduler, employees, cleanup } = makeScheduler();
    try {
      employees.create("off-schedule", {
        name: "Off Schedule",
        role: "custom",
        description: "",
        systemPrompt: "x",
        ...flags,
        schedule: { cron: "0 22 * * *", taskTemplate: "night work" },
      }, "2026-09-21T00:00:00.000Z");
      employees.create("paused-clerk", {
        name: "Paused Clerk",
        role: "data_clerk",
        description: "",
        systemPrompt: "x",
        ...flags,
        schedule: { cron: "30 8 * * 1-5", taskTemplate: "morning" },
      }, "2026-09-21T00:00:00.000Z");
      employees.patch("paused-clerk", { status: "paused" });
      employees.create("unscheduled", {
        name: "Unscheduled",
        role: "custom",
        description: "",
        systemPrompt: "x",
        ...flags,
        schedule: null,
      }, "2026-09-21T00:00:00.000Z");

      expect(scheduler.tick(at(2026, 9, 23, 8, 30))).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("dedupes: two ticks in the same minute create exactly one task", () => {
    const { scheduler, employees, tasks, cleanup } = makeScheduler();
    try {
      employees.create("dedupe-clerk", {
        name: "Dedupe Clerk",
        role: "data_clerk",
        description: "",
        systemPrompt: "x",
        ...flags,
        schedule: { cron: "* * * * *", taskTemplate: "every minute" },
      }, "2026-09-21T00:00:00.000Z");

      expect(scheduler.tick(at(2026, 9, 23, 8, 30))).toBe(1);
      expect(scheduler.tick(new Date(at(2026, 9, 23, 8, 30).getTime() + 30_000))).toBe(0);
      expect(tasks.list({ employeeId: "dedupe-clerk" })).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("fires again the next matching minute (recurring, not once)", () => {
    const { scheduler, employees, tasks, cleanup } = makeScheduler();
    try {
      employees.create("recurring-clerk", {
        name: "Recurring Clerk",
        role: "data_clerk",
        description: "",
        systemPrompt: "x",
        ...flags,
        schedule: { cron: "* * * * *", taskTemplate: "tick work" },
      }, "2026-09-21T00:00:00.000Z");

      expect(scheduler.tick(at(2026, 9, 23, 8, 30))).toBe(1);
      expect(scheduler.tick(at(2026, 9, 23, 8, 31))).toBe(1);
      expect(tasks.list({ employeeId: "recurring-clerk" })).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it("one bad cron expression never blocks the other employees", () => {
    const { scheduler, employees, tasks, cleanup } = makeScheduler();
    try {
      employees.create("bad-cron", {
        name: "Bad Cron",
        role: "custom",
        description: "",
        systemPrompt: "x",
        ...flags,
        schedule: { cron: "garbage", taskTemplate: "x" },
      }, "2026-09-21T00:00:00.000Z");
      employees.create("good-cron", {
        name: "Good Cron",
        role: "data_clerk",
        description: "",
        systemPrompt: "x",
        ...flags,
        schedule: { cron: "30 8 * * 1-5", taskTemplate: "morning" },
      }, "2026-09-21T00:00:00.000Z");
      expect(scheduler.tick(at(2026, 9, 23, 8, 30))).toBe(1);
      expect(tasks.list({ employeeId: "good-cron" })).toHaveLength(1);
      expect(tasks.list({ employeeId: "bad-cron" })).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});
