import type { EmployeeSummary, Task } from "@consentark/shared";

/**
 * Workforce overview — the one-screen answer to "what is my AI workforce
 * doing right now?" while supervising multiple employees (pilot ops).
 *
 * Reads only data the app already fetches: the employee list (with
 * completed counts) and the global task list. Computed client-side —
 * no new API surface, no new failure modes.
 */

interface EmployeeRow {
  employee: EmployeeSummary;
  done: number;
  failed: number;
  running: number;
  awaiting: number;
  lastActivity: string | null;
}

function summarize(employee: EmployeeSummary, tasks: Task[]): EmployeeRow {
  const mine = tasks.filter((t) => t.employeeId === employee.id);
  const byStatus = (status: Task["status"]): number =>
    mine.filter((t) => t.status === status).length;
  const stamps = mine
    .map((t) => t.startedAt ?? t.createdAt)
    .filter((s): s is string => s !== null)
    .sort();
  return {
    employee,
    done: employee.tasksCompleted,
    failed: byStatus("failed"),
    running: byStatus("running"),
    awaiting: byStatus("awaiting_approval"),
    lastActivity: stamps.length > 0 ? stamps[stamps.length - 1] : null,
  };
}

function Stat({ label, value, tone = "default" }: { label: string; value: number | string; tone?: "default" | "warn" | "bad" | "good" }): React.JSX.Element {
  const toneClass =
    tone === "warn"
      ? "text-amber-400"
      : tone === "bad"
        ? "text-red-400"
        : tone === "good"
          ? "text-ca-ok"
          : "text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

export function WorkforceView({ employees, tasks }: { employees: EmployeeSummary[]; tasks: Task[] }): React.JSX.Element {
  const rows = employees.map((e) => summarize(e, tasks));

  const totals = {
    employees: employees.length,
    active: employees.filter((e) => e.status === "active").length,
    done: tasks.filter((t) => t.status === "done").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    awaiting: tasks.filter((t) => t.status === "awaiting_approval").length,
    scheduled: employees.filter((e) => e.schedule !== null).length,
  };

  return (
    <section>
      <h2 className="text-lg font-semibold text-zinc-100">Workforce overview</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Every AI employee, its workload, and its consent posture — one screen.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Employees" value={totals.employees} />
        <Stat label="Active" value={totals.active} tone="good" />
        <Stat label="Tasks done" value={totals.done} />
        <Stat label="Failed" value={totals.failed} tone={totals.failed > 0 ? "bad" : "default"} />
        <Stat label="Awaiting approval" value={totals.awaiting} tone={totals.awaiting > 0 ? "warn" : "default"} />
        <Stat label="On schedules" value={totals.scheduled} />
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/70 p-6 text-sm text-zinc-400">
          No employees hired yet. <code className="text-zinc-300">npm run hire -- --template data-clerk --allowlist "example.com"</code>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((row) => (
            <div
              key={row.employee.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="font-semibold text-zinc-100">{row.employee.name}</span>
                <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                  {row.employee.role}
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    row.employee.status === "active"
                      ? "bg-ca-ok/15 text-ca-ok"
                      : "bg-amber-500/15 text-amber-400"
                  }`}
                >
                  {row.employee.status}
                </span>
                {row.employee.confirmBeforeSubmit ? (
                  <span className="rounded-md bg-ca-accent/15 px-2 py-0.5 text-xs text-ca-accent">
                    consent gate ON
                  </span>
                ) : (
                  <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
                    consent gate OFF
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <span className="text-zinc-500">done </span>
                  <span className="font-semibold text-zinc-200">{row.done}</span>
                </div>
                <div>
                  <span className="text-zinc-500">failed </span>
                  <span className={`font-semibold ${row.failed > 0 ? "text-red-400" : "text-zinc-200"}`}>
                    {row.failed}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">running </span>
                  <span className="font-semibold text-zinc-200">{row.running}</span>
                </div>
                <div>
                  <span className="text-zinc-500">awaiting </span>
                  <span className={`font-semibold ${row.awaiting > 0 ? "text-amber-400" : "text-zinc-200"}`}>
                    {row.awaiting}
                  </span>
                </div>
              </div>

              <div className="mt-2 text-xs text-zinc-500">
                {row.employee.schedule ? (
                  <span>
                    schedule: <code className="text-zinc-300">{row.employee.schedule.cron}</code> →{" "}
                    {row.employee.schedule.taskTemplate.slice(0, 70)}
                  </span>
                ) : (
                  <span>no schedule (manual runs)</span>
                )}
                {row.lastActivity && (
                  <span className="ml-3">
                    · last activity {new Date(row.lastActivity).toLocaleString()}
                  </span>
                )}
                {row.employee.allowedDomains.length > 0 && (
                  <span className="ml-3">
                    · allowlist: {row.employee.allowedDomains.slice(0, 3).join(", ")}
                    {row.employee.allowedDomains.length > 3 ? ", …" : ""}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
