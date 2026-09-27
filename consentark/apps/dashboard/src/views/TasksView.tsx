import { useMemo, useState } from "react";
import type { EmployeeSummary, Task, TaskLog } from "@consentark/shared";
import { groupAuditLogs } from "../lib/audit.js";
import { Screenshot } from "../components/Screenshot.js";

/**
 * Tasks view — the transparency surface. Filter by employee/status, click a
 * row for full detail: screenshots, output, error, and the expandable audit
 * timeline (browser steps, LLM calls, gate trips rendered distinctly).
 */

const STATUS_STYLES: Record<Task["status"], string> = {
  queued: "bg-zinc-800 text-zinc-300",
  running: "bg-blue-900/60 text-blue-300",
  awaiting_approval: "bg-ca-accent/20 text-ca-accent-hover",
  done: "bg-emerald-900/50 text-emerald-300",
  failed: "bg-red-900/50 text-red-300",
  cancelled: "bg-zinc-800 text-zinc-400",
};

const GROUP_STYLES: Record<string, string> = {
  llm: "border-purple-800/60 bg-purple-950/20",
  browser: "border-sky-800/60 bg-sky-950/20",
  safety: "border-ca-accent/60 bg-ca-accent/5",
  system: "border-zinc-800 bg-zinc-950/40",
  other: "border-zinc-800 bg-zinc-950/40",
};

function AuditTimeline({ logs }: { logs: TaskLog[] }): React.JSX.Element {
  const groups = useMemo(() => groupAuditLogs(logs), [logs]);
  return (
    <div className="mt-3 space-y-2">
      {groups.length === 0 && <p className="text-xs text-zinc-500">No audit entries.</p>}
      {groups.map((group, i) => (
        <div key={i} className={`rounded-lg border p-3 ${GROUP_STYLES[group.kind]}`}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {group.label} · {group.entries.length}
          </p>
          <ol className="space-y-1">
            {group.entries.map((entry, j) => (
              <li key={j} className="text-sm leading-snug">
                <span className="mr-2 font-mono text-[11px] text-zinc-500">
                  {entry.at.slice(11, 19)}
                </span>
                <span
                  className={
                    entry.level === "error"
                      ? "text-red-300"
                      : entry.level === "warn"
                        ? "text-amber-300"
                        : "text-zinc-200"
                  }
                >
                  {entry.message}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function TaskRow(props: { task: Task; employeeName?: string }): React.JSX.Element {
  const { task, employeeName } = props;
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-xl border border-zinc-800 bg-zinc-900/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[task.status]}`}
        >
          {task.status}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{task.objective}</span>
        {employeeName && <span className="text-xs text-zinc-500">{employeeName}</span>}
        <span className="font-mono text-[11px] text-zinc-600">{task.id}</span>
        <span className="text-xs text-zinc-600">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-4 py-3">
          {task.url && <p className="text-xs text-zinc-500">{task.url}</p>}
          {task.error && (
            <p className="mt-1 text-sm text-red-300">
              {task.error.code}: {task.error.message}
            </p>
          )}
          {task.output !== null && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300">
              {JSON.stringify(task.output, null, 2)}
            </pre>
          )}
          {task.screenshots.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {task.screenshots.map((ref) => (
                <Screenshot key={ref} taskId={task.id} refPath={ref} />
              ))}
            </div>
          )}
          <AuditTimeline logs={task.logs} />
        </div>
      )}
    </li>
  );
}

export function TasksView(props: {
  tasks: Task[];
  employees: EmployeeSummary[];
}): React.JSX.Element {
  const { tasks, employees } = props;
  const [status, setStatus] = useState<string>("");
  const [employeeId, setEmployeeId] = useState<string>("");

  const filtered = useMemo(
    () =>
      tasks.filter(
        (t) => (!status || t.status === status) && (!employeeId || t.employeeId === employeeId),
      ),
    [tasks, status, employeeId],
  );

  const employeeName = (id: string): string | undefined =>
    employees.find((e) => e.id === id)?.name;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {Object.keys(STATUS_STYLES).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm"
        >
          <option value="">All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-zinc-500">
          {filtered.length} of {tasks.length}
        </span>
      </div>

      <ul className="space-y-2">
        {filtered.map((task) => (
          <TaskRow key={task.id} task={task} employeeName={employeeName(task.employeeId)} />
        ))}
        {filtered.length === 0 && (
          <li className="rounded-xl border border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
            No tasks match the current filters.
          </li>
        )}
      </ul>
    </section>
  );
}
