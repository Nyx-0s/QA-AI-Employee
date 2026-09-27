import type { Database } from "better-sqlite3";
import type {
  Employee,
  EmployeeCreateInput,
  EmployeePatchInput,
  EmployeeSummary,
} from "@consentark/shared";

/**
 * Employee persistence. JSON-typed columns (tools_enabled, allowed_domains,
 * schedule) are (de)serialized here — the rest of the app sees plain objects.
 */

interface EmployeeRow {
  id: string;
  name: string;
  role: string;
  description: string;
  system_prompt: string;
  backend: string;
  model: string;
  tools_enabled: string;
  allowed_domains: string;
  confirm_before_submit: number;
  max_steps_per_task: number;
  schedule: string | null;
  status: string;
  created_at: string;
}

function rowToEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    name: row.name,
    role: row.role as Employee["role"],
    description: row.description,
    systemPrompt: row.system_prompt,
    backend: row.backend as Employee["backend"],
    model: row.model,
    toolsEnabled: JSON.parse(row.tools_enabled) as Employee["toolsEnabled"],
    allowedDomains: JSON.parse(row.allowed_domains) as Employee["allowedDomains"],
    confirmBeforeSubmit: row.confirm_before_submit === 1,
    maxStepsPerTask: row.max_steps_per_task,
    schedule: row.schedule ? (JSON.parse(row.schedule) as Employee["schedule"]) : null,
    status: row.status as Employee["status"],
    createdAt: row.created_at,
  };
}

export class EmployeeRepository {
  constructor(private readonly db: Database) {}

  create(id: string, input: EmployeeCreateInput, now: string): Employee {
    this.db
      .prepare(
        `INSERT INTO employees (
           id, name, role, description, system_prompt, backend, model,
           tools_enabled, allowed_domains, confirm_before_submit,
           max_steps_per_task, schedule, status, created_at
         ) VALUES (
           @id, @name, @role, @description, @systemPrompt, @backend, @model,
           @toolsEnabled, @allowedDomains, @confirmBeforeSubmit,
           @maxStepsPerTask, @schedule, @status, @createdAt
         )`,
      )
      .run({
        id,
        name: input.name,
        role: input.role,
        description: input.description,
        systemPrompt: input.systemPrompt,
        backend: input.backend,
        model: input.model,
        toolsEnabled: JSON.stringify(input.toolsEnabled),
        allowedDomains: JSON.stringify(input.allowedDomains),
        confirmBeforeSubmit: input.confirmBeforeSubmit ? 1 : 0,
        maxStepsPerTask: input.maxStepsPerTask,
        schedule: input.schedule ? JSON.stringify(input.schedule) : null,
        status: "active",
        createdAt: now,
      });
    const created = this.getOrThrow(id);
    return created;
  }

  /** Apply a partial update, returning the updated employee (or null). */
  patch(id: string, patch: EmployeePatchInput): Employee | null {
    const existing = this.get(id);
    if (!existing) return null;
    const merged: Employee = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE employees SET
           name = @name, role = @role, description = @description,
           system_prompt = @systemPrompt, backend = @backend, model = @model,
           tools_enabled = @toolsEnabled, allowed_domains = @allowedDomains,
           confirm_before_submit = @confirmBeforeSubmit,
           max_steps_per_task = @maxStepsPerTask, schedule = @schedule,
           status = @status
         WHERE id = @id`,
      )
      .run({
        id,
        name: merged.name,
        role: merged.role,
        description: merged.description,
        systemPrompt: merged.systemPrompt,
        backend: merged.backend,
        model: merged.model,
        toolsEnabled: JSON.stringify(merged.toolsEnabled),
        allowedDomains: JSON.stringify(merged.allowedDomains),
        confirmBeforeSubmit: merged.confirmBeforeSubmit ? 1 : 0,
        maxStepsPerTask: merged.maxStepsPerTask,
        schedule: merged.schedule ? JSON.stringify(merged.schedule) : null,
        status: merged.status,
      });
    return this.getOrThrow(id);
  }

  /** Permanently remove an employee and their task history (hard delete). */
  hardDelete(id: string): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE employee_id = ?)",
        )
        .run(id);
      this.db.prepare("DELETE FROM tasks WHERE employee_id = ?").run(id);
      this.db.prepare("DELETE FROM employees WHERE id = ?").run(id);
    })();
  }

  get(id: string): Employee | null {
    const row = this.db
      .prepare("SELECT * FROM employees WHERE id = ?")
      .get(id) as EmployeeRow | undefined;
    return row ? rowToEmployee(row) : null;
  }

  private getOrThrow(id: string): Employee {
    const employee = this.get(id);
    if (!employee) throw new Error(`employee ${id} disappeared after write`);
    return employee;
  }

  /** All employees, oldest first, each with its completed-task count. */
  listWithCompletedCounts(): EmployeeSummary[] {
    const rows = this.db
      .prepare(
        `SELECT e.*, (
           SELECT COUNT(*) FROM tasks t
           WHERE t.employee_id = e.id AND t.status = 'done'
         ) AS tasks_completed
         FROM employees e
         ORDER BY e.created_at ASC`,
      )
      .all() as Array<EmployeeRow & { tasks_completed: number }>;
    return rows.map((row) => {
      const employee = rowToEmployee(row);
      return { ...employee, tasksCompleted: row.tasks_completed };
    });
  }
}
