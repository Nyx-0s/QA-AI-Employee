import type { Database } from "better-sqlite3";
import type { Config } from "../config/env.js";
import type { EmployeeRepository } from "../db/repositories/employees.js";
import type { TaskRepository } from "../db/repositories/tasks.js";
import type { TaskQueue } from "./queue.js";
import { newId } from "../util/ids.js";

/**
 * Scheduler — the missing half of `employeeSchedule` (README: "Scheduling is
 * not shipped… cron execution is future work"). This module ships it.
 *
 * Every 60s, for each ACTIVE employee with a non-null `schedule`:
 *   1. Take the current minute as the due slot (UTC-aligned to the minute).
 *   2. Skip if the cron does not fire at this minute.
 *   3. Skip if the employee already has a scheduled task created in this
 *      slot (dedupe guard: restarts and overlapping ticks never double-fire).
 *   4. Create a `scheduled` task from the schedule's taskTemplate and enqueue.
 *
 * Cron matching is deliberately self-contained (5 fields, minute precision,
 * standard `* , - /` syntax) so the appliance needs no native cron parser.
 * Missed runs are NOT replayed: a tick acts on its own minute only. Pausing
 * an employee (status != active) stops its schedule; the consent gate applies
 * per-task exactly as with manual work.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly deps: {
      config: Config;
      db: Database;
      employees: EmployeeRepository;
      tasks: TaskRepository;
      queue: TaskQueue;
    },
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        // Never let one bad cron expression kill the interval.
        console.error(
          "[scheduler] tick failed:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }, SCHEDULER_TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One scheduling pass. Exposed for tests — call directly, no waiting. */
  tick(now: Date = new Date()): number {
    const slot = new Date(now.getTime());
    slot.setSeconds(0, 0);
    const slotIso = slot.toISOString();

    let created = 0;
    for (const employee of this.deps.employees.listWithCompletedCounts()) {
      const schedule = employee.schedule;
      if (!schedule || employee.status !== "active") continue;
      if (!cronMatches(schedule.cron, slot)) continue;
      if (this.deps.tasks.existsScheduledSince(employee.id, slotIso)) continue;

      const task = this.deps.tasks.create(
        newId("tsk"),
        employee.id,
        {
          employeeId: employee.id,
          type: "scheduled",
          objective: schedule.taskTemplate,
        },
        now.toISOString(),
      );
      this.deps.queue.enqueue(task.id);
      this.deps.tasks.appendLog(task.id, {
        at: now.toISOString(),
        level: "info",
        phase: "system",
        message: `Scheduled run fired (cron: ${schedule.cron}) — objective: ${schedule.taskTemplate.slice(0, 120)}`,
      });
      created += 1;
    }
    return created;
  }
}

/** Tick cadence: one minute, aligned with cron's smallest unit. */
export const SCHEDULER_TICK_MS = 60_000;

/**
 * Does the cron expression fire at the given minute? Five fields:
 * minute hour day-of-month month day-of-week (0 and 7 both = Sunday).
 */
export function cronMatches(cron: string, at: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const dow = at.getDay(); // 0–6, Sunday = 0
  const dowCandidates = dow === 0 ? [0, 7] : [dow];
  const checks: Array<{ values: number[]; range: FieldRange }> = [
    { values: [at.getMinutes()], range: FIELD_RANGES[0] },
    { values: [at.getHours()], range: FIELD_RANGES[1] },
    { values: [at.getDate()], range: FIELD_RANGES[2] },
    { values: [at.getMonth() + 1], range: FIELD_RANGES[3] },
    { values: dowCandidates, range: FIELD_RANGES[4] },
  ];

  return fields.every((field, i) =>
    checks[i].values.some((value) => fieldMatches(field, value, checks[i].range)),
  );
}

/** Valid bounds per cron position: minute, hour, dom, month, dow. */
export interface FieldRange {
  min: number;
  max: number;
}

export const FIELD_RANGES: FieldRange[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week
];

/** Does one cron field match one value? Supports `*`, lists, ranges, steps. */
export function fieldMatches(field: string, value: number, range: FieldRange): boolean {
  return field.split(",").some((part) => {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return false;
    const step = m[3] !== undefined ? Math.max(1, Number(m[3])) : 1;
    let lo: number;
    let hi: number;
    if (m[1] === "*") {
      lo = range.min;
      hi = range.max;
    } else {
      lo = Number(m[1]);
      hi = m[2] !== undefined ? Number(m[2]) : lo;
      if (lo < range.min || hi > range.max || lo > hi) return false;
    }
    for (let v = lo; v <= hi; v += step) {
      if (v === value) return true;
    }
    return false;
  });
}
