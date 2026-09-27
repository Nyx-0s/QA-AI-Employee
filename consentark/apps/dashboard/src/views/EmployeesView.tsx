import type { EmployeeSummary } from "@consentark/shared";

/**
 * Employees view — a read-only roster (deliberately minimal per Phase 3
 * scope: the API supports full CRUD; the dashboard only surfaces posture).
 */
export function EmployeesView(props: { employees: EmployeeSummary[] }): React.JSX.Element {
  const { employees } = props;

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">Employees</h2>
      {employees.length === 0 && (
        <p className="text-sm text-zinc-400">
          No employees hired yet. Use the API (POST /api/employees) to hire your first.
        </p>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {employees.map((e) => (
          <li key={e.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="flex items-center gap-2">
              <span className="font-medium">{e.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  e.status === "active"
                    ? "bg-emerald-900/50 text-emerald-300"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {e.status}
              </span>
              <span className="ml-auto text-xs text-zinc-500">
                {e.tasksCompleted} completed
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {e.role} · backend {e.backend} · model {e.model}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {e.toolsEnabled.map((tool) => (
                <span key={tool} className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-300">
                  {tool}
                </span>
              ))}
              <span
                className={`rounded px-2 py-0.5 font-semibold ${
                  e.confirmBeforeSubmit
                    ? "bg-ca-accent/20 text-ca-accent-hover"
                    : "bg-amber-900/40 text-amber-300"
                }`}
                title={
                  e.confirmBeforeSubmit
                    ? "Submissions require human approval"
                    : "Submissions happen without approval"
                }
              >
                {e.confirmBeforeSubmit ? "consent gate ON" : "consent gate OFF"}
              </span>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              allowlist:{" "}
              {e.allowedDomains.length > 0 ? (
                <span className="font-mono">{e.allowedDomains.join(", ")}</span>
              ) : (
                <span className="italic">empty — no browsing permitted</span>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
