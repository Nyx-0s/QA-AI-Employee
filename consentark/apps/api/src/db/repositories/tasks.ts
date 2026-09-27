import type { Database } from "better-sqlite3";
import type {
  ApprovalRequest,
  LLMPlan,
  Task,
  TaskCreateInput,
  TaskError,
  TaskLog,
  TaskStatus,
} from "@consentark/shared";

/**
 * Task persistence, including the per-task audit log (task_logs table).
 * A task's `logs` array is hydrated from task_logs on every read, so the
 * audit trail is always live — not a cached copy.
 */

interface TaskRow {
  id: string;
  employee_id: string;
  type: string;
  objective: string;
  url: string | null;
  steps: string | null;
  output_schema: string | null;
  status: string;
  output: string | null;
  plan: string | null;
  error: string | null;
  awaiting_approval: string | null;
  awaiting_at: string | null;
  screenshots: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

interface TaskLogRow {
  at: string;
  level: string;
  phase: string;
  message: string;
  data: string | null;
}

function rowToTask(row: TaskRow, logs: TaskLog[]): Task {
  return {
    id: row.id,
    employeeId: row.employee_id,
    type: row.type as Task["type"],
    objective: row.objective,
    url: row.url,
    steps: row.steps ? (JSON.parse(row.steps) as string[]) : null,
    outputSchema: row.output_schema
      ? (JSON.parse(row.output_schema) as Task["outputSchema"])
      : null,
    status: row.status as TaskStatus,
    output: row.output ? JSON.parse(row.output) : null,
    plan: row.plan ? (JSON.parse(row.plan) as LLMPlan) : null,
    error: row.error ? (JSON.parse(row.error) as TaskError) : null,
    awaitingApproval: row.awaiting_approval
      ? (JSON.parse(row.awaiting_approval) as ApprovalRequest)
      : null,
    logs,
    screenshots: JSON.parse(row.screenshots) as string[],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export class TaskRepository {
  constructor(private readonly db: Database) {}

  create(id: string, employeeId: string, input: TaskCreateInput, now: string): Task {
    this.db
      .prepare(
        `INSERT INTO tasks (
           id, employee_id, type, objective, url, steps, output_schema,
           status, output, plan, error, screenshots, started_at, finished_at, created_at
         ) VALUES (
           @id, @employeeId, @type, @objective, @url, @steps, @outputSchema,
           'queued', NULL, NULL, NULL, '[]', NULL, NULL, @createdAt
         )`,
      )
      .run({
        id,
        employeeId,
        type: input.type,
        objective: input.objective,
        url: input.url ?? null,
        steps: input.steps ? JSON.stringify(input.steps) : null,
        outputSchema: input.outputSchema ? JSON.stringify(input.outputSchema) : null,
        createdAt: now,
      });
    return this.getOrThrow(id);
  }

  get(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | TaskRow
      | undefined;
    if (!row) return null;
    return rowToTask(row, this.logs(id));
  }

  private getOrThrow(id: string): Task {
    const task = this.get(id);
    if (!task) throw new Error(`task ${id} disappeared after write`);
    return task;
  }

  /** All tasks, newest first. Optional filters by status and employee. */
  list(filter: { status?: TaskStatus; employeeId?: string } = {}): Task[] {
    const conditions: string[] = [];
    const params: Record<string, string> = {};
    if (filter.status) {
      conditions.push("status = @status");
      params.status = filter.status;
    }
    if (filter.employeeId) {
      conditions.push("employee_id = @employeeId");
      params.employeeId = filter.employeeId;
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC, id DESC`)
      .all(params) as TaskRow[];
    return rows.map((row) => rowToTask(row, this.logs(row.id)));
  }

  /** Tasks that need work after a restart: stuck in running, or queued. */
  listForRecovery(): { queued: Task[]; interrupted: Task[] } {
    const rows = this.db
      .prepare(
        "SELECT * FROM tasks WHERE status IN ('queued','running') ORDER BY created_at ASC",
      )
      .all() as TaskRow[];
    const queued: Task[] = [];
    const interrupted: Task[] = [];
    for (const row of rows) {
      const task = rowToTask(row, this.logs(row.id));
      if (task.status === "queued") queued.push(task);
      else interrupted.push(task);
    }
    return { queued, interrupted };
  }

  setStatus(id: string, status: TaskStatus, now: string): void {
    const startedAt = status === "running" ? now : null;
    const finishedAt =
      status === "done" || status === "failed" || status === "cancelled" ? now : null;
    this.db
      .prepare(
        `UPDATE tasks SET
           status = @status,
           started_at = COALESCE(@startedAt, started_at),
           finished_at = COALESCE(@finishedAt, finished_at)
         WHERE id = @id`,
      )
      .run({ id, status, startedAt, finishedAt });
  }

  setPlan(id: string, plan: LLMPlan): void {
    this.db
      .prepare("UPDATE tasks SET plan = ? WHERE id = ?")
      .run(JSON.stringify(plan), id);
  }

  setOutput(id: string, output: unknown): void {
    this.db
      .prepare("UPDATE tasks SET output = @output WHERE id = @id")
      .run({ id, output: JSON.stringify(output ?? null) });
  }

  setError(id: string, error: TaskError): void {
    this.db
      .prepare("UPDATE tasks SET error = ? WHERE id = ?")
      .run(JSON.stringify(error), id);
  }

  /** Mark the consent-gate state: what a task is waiting on, and since when. */
  setAwaitingApproval(id: string, request: ApprovalRequest, now: string): void {
    this.db
      .prepare(
        "UPDATE tasks SET awaiting_approval = @request, awaiting_at = @now WHERE id = @id",
      )
      .run({ id, request: JSON.stringify(request), now });
  }

  /** Clear the consent-gate state after approve/cancel. */
  clearAwaitingApproval(id: string): void {
    this.db
      .prepare(
        "UPDATE tasks SET awaiting_approval = NULL, awaiting_at = NULL WHERE id = @id",
      )
      .run({ id });
  }

  /** All tasks currently in awaiting_approval — input for the timeout sweeper. */
  listAwaiting(): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE status = 'awaiting_approval' ORDER BY awaiting_at ASC")
      .all() as TaskRow[];
    return rows.map((row) => rowToTask(row, this.logs(row.id)));
  }

  /**
   * Cheap dedupe guard for the scheduler: has a scheduled task already been
   * created for this employee at/after the given ISO timestamp? (List would
   * hydrate full audit logs per row — this counts one indexed column.)
   */
  existsScheduledSince(employeeId: string, sinceIso: string): boolean {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM tasks WHERE employee_id = ? AND type = 'scheduled' AND created_at >= ?",
      )
      .get(employeeId, sinceIso) as { n: number };
    return row.n > 0;
  }

  addScreenshot(id: string, path: string): void {
    const row = this.db.prepare("SELECT screenshots FROM tasks WHERE id = ?").get(id) as
      | { screenshots: string }
      | undefined;
    if (!row) return;
    const paths = JSON.parse(row.screenshots) as string[];
    paths.push(path);
    this.db
      .prepare("UPDATE tasks SET screenshots = ? WHERE id = ?")
      .run(JSON.stringify(paths), id);
  }

  // ── audit log ───────────────────────────────────────────

  appendLog(taskId: string, entry: TaskLog, data?: unknown): void {
    this.db
      .prepare(
        "INSERT INTO task_logs (task_id, at, level, phase, message, data) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(taskId, entry.at, entry.level, entry.phase, entry.message, data ? JSON.stringify(data) : null);
  }

  logs(taskId: string): TaskLog[] {
    const rows = this.db
      .prepare("SELECT at, level, phase, message, data FROM task_logs WHERE task_id = ? ORDER BY seq ASC")
      .all(taskId) as TaskLogRow[];
    return rows.map((row) => ({
      at: row.at,
      level: row.level as TaskLog["level"],
      phase: row.phase as TaskLog["phase"],
      message: row.message,
      data: row.data ? (JSON.parse(row.data) as unknown) : undefined,
    }));
  }
}
