import { useEffect, useState } from "react";
import type { ApprovalQueueEntry, EmployeeSummary, Task } from "@consentark/shared";
import { api, setOperatorToken } from "./api.js";
import { ApprovalsView } from "./views/ApprovalsView.js";
import { TasksView } from "./views/TasksView.js";
import { EmployeesView } from "./views/EmployeesView.js";
import { WorkforceView } from "./views/WorkforceView.js";

/**
 * App shell — owns the polling loop and the tab-title consent indicator.
 *
 * Polling at 4s (not websockets): the approval queue is a handful of rows,
 * a 4s refresh is well inside the human decision timescale, and polling
 * survives proxies/deployments that break long-lived connections. The tab
 * title shows the pending count — an approval sitting unseen defeats the gate.
 */

export type ViewName = "workforce" | "approvals" | "tasks" | "employees";

const POLL_MS = 4000;

/** Document title = "ConsentArk (n)" while approvals await a decision. */
function usePendingTitle(count: number): void {
  useEffect(() => {
    document.title = count > 0 ? `ConsentArk (${count})` : "ConsentArk — Supervisor";
  }, [count]);
}

export function App(): React.JSX.Element {
  const [view, setView] = useState<ViewName>("workforce");
  const [approvals, setApprovals] = useState<ApprovalQueueEntry[]>([]);
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [config, setConfig] = useState<{ approvalTimeoutHours: number }>({
    approvalTimeoutHours: 24,
  });
  const [connected, setConnected] = useState(true);
  const [version, setVersion] = useState<string | null>(null);
  /** Shown when the API says 401 — the packaged build ships token-free. */
  const needsToken = !connected;
  const [tokenInput, setTokenInput] = useState("");

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async (): Promise<void> => {
      try {
        const [a, e, c] = await Promise.all([api.approvals(), api.employees(), api.config()]);
        if (!alive) return;
        setApprovals(a);
        setEmployees(e);
        setConfig(c);
        setConnected(true);
      } catch {
        if (alive) setConnected(false);
      } finally {
        if (alive) timer = setTimeout(tick, POLL_MS);
      }
    };

    // Version comes from /api/health (unauthenticated); fetched once.
    api
      .health()
      .then((h) => {
        if (alive) setVersion(h.version);
      })
      .catch(() => undefined);
    void tick();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  // Task list refreshes on-demand per view; keep it light here by only
  // refetching when a task-consuming view is active.
  useEffect(() => {
    if (view !== "tasks" && view !== "workforce") return;
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const list = await api.tasks();
        if (alive) setTasks(list);
      } catch {
        /* the connection banner covers API failures */
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [view]);

  usePendingTitle(approvals.length);

  const refresh = async (): Promise<void> => {
    try {
      const [a, e] = await Promise.all([api.approvals(), api.employees()]);
      setApprovals(a);
      setEmployees(e);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  const submitToken = (): void => {
    setOperatorToken(tokenInput.trim());
    setTokenInput("");
    // Re-check immediately; the poll loop covers the rest.
    void refresh();
  };

  const tab = (name: ViewName, label: string, badge?: number): React.JSX.Element => (
    <button
      key={name}
      type="button"
      onClick={() => setView(name)}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        view === name
          ? "bg-zinc-700 text-white"
          : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
      }`}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="ml-2 inline-flex items-center justify-center rounded-full bg-ca-accent px-2 py-0.5 text-xs font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900/60 sticky top-0 z-10 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-ca-accent grid place-items-center text-sm font-black">
              CA
            </div>
            <span className="font-semibold tracking-tight">ConsentArk Supervisor</span>
          </div>
          <nav className="flex gap-1">
            {tab("workforce", "Workforce")}
            {tab("approvals", "Approvals", approvals.length)}
            {tab("tasks", "Tasks")}
            {tab("employees", "Employees")}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span
              className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-ca-ok" : "bg-red-500"}`}
            />
            <span className={connected ? "text-zinc-400" : "text-red-400"}>
              {connected ? "API connected" : "API unreachable"}
            </span>
          </div>
        </div>
      </header>

      {needsToken && (
        <div className="mx-auto max-w-6xl px-6 pt-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
            <h2 className="text-sm font-semibold text-zinc-200">Connect to the API</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Paste the operator token once (from the server boot log or{" "}
              <code className="text-zinc-300">DATA_DIR/operator-token</code>). It stays in this browser.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitToken();
                }}
                placeholder="operator token"
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-ca-accent"
              />
              <button
                type="button"
                onClick={submitToken}
                className="rounded-lg bg-ca-accent px-4 py-2 text-sm font-medium text-white hover:bg-ca-accent-hover"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {view === "workforce" && <WorkforceView employees={employees} tasks={tasks} />}
        {view === "approvals" && (
          <ApprovalsView
            entries={approvals}
            timeoutHours={config.approvalTimeoutHours}
            onResolved={refresh}
          />
        )}
        {view === "tasks" && <TasksView tasks={tasks} employees={employees} />}
        {view === "employees" && <EmployeesView employees={employees} />}
      </main>

      <footer className="border-t border-zinc-800 py-3 text-center text-xs text-zinc-500">
        ConsentArk — consent-first, fully audited AI workforce
        {version !== null && <span className="ml-2 text-zinc-600">· API v{version}</span>}
      </footer>
    </div>
  );
}
