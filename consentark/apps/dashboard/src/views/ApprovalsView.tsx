import { useEffect, useState } from "react";
import type { ApprovalQueueEntry } from "@consentark/shared";
import { api, ApiError } from "../api.js";
import { formatAge, formatCountdown, isExpiringSoon } from "../lib/time.js";
import { Screenshot } from "../components/Screenshot.js";

/**
 * Approvals queue — the operator side of the consent gate.
 *
 * UX decisions (docs/PHASE3-notes.md §3):
 * - Approve is TWO-STEP: the button arms ("Approve — click again") and a
 *   second explicit click commits. Accidental approves are the dangerous
 *   direction; accidental cancels only waste work.
 * - Cancel asks for confirmation (window.confirm) — friction in the cheap
 *   direction, none in the expensive one.
 * - Every card shows the auto-cancel countdown from APPROVAL_TIMEOUT_HOURS.
 */

export function ApprovalsView(props: {
  entries: ApprovalQueueEntry[];
  timeoutHours: number;
  onResolved: () => void;
}): React.JSX.Element {
  const { entries, timeoutHours, onResolved } = props;

  const [armedTaskId, setArmedTaskId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  // Re-render every 30s so ages/countdowns stay honest even without new data.
  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Disarm any armed Approve button when the queue changes under the mouse.
  useEffect(() => {
    if (armedTaskId && !entries.some((e) => e.taskId === armedTaskId)) {
      setArmedTaskId(null);
    }
  }, [entries, armedTaskId]);

  const act = async (taskId: string, action: "approve" | "cancel"): Promise<void> => {
    setBusyTaskId(taskId);
    setError(null);
    try {
      if (action === "approve") await api.approve(taskId);
      else await api.cancel(taskId);
      setArmedTaskId(null);
      onResolved();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setBusyTaskId(null);
    }
  };

  if (entries.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-semibold mb-1">Approvals</h2>
        <p className="text-sm text-zinc-400">
          Nothing is waiting for a human decision. Employees pause here the
          moment they are about to submit something.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold">Approvals</h2>
        <span className="text-xs text-zinc-500">
          auto-cancel after {timeoutHours}h without a decision
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4">
        {entries.map((entry) => {
          const expiring = isExpiringSoon(entry.awaitingAt, timeoutHours);
          const armed = armedTaskId === entry.taskId;
          const busy = busyTaskId === entry.taskId;
          return (
            <article
              key={entry.taskId}
              className={`rounded-xl border p-4 ${
                expiring ? "border-ca-accent/70 bg-ca-accent/5" : "border-zinc-800 bg-zinc-900/60"
              }`}
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span className="font-medium text-zinc-200">{entry.employeeName}</span>
                    <span>·</span>
                    <span>{formatAge(entry.awaitingAt)}</span>
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 font-semibold ${
                        expiring ? "bg-ca-accent text-white" : "bg-zinc-800 text-zinc-300"
                      }`}
                      title="Time until this request auto-cancels"
                    >
                      {formatCountdown(entry.awaitingAt, timeoutHours)}
                    </span>
                  </div>

                  <p className="mt-1 font-medium">{entry.taskObjective}</p>
                  {entry.taskUrl && (
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{entry.taskUrl}</p>
                  )}

                  <div className="mt-3 rounded-lg bg-zinc-950/70 border border-zinc-800 p-3">
                    <p className="text-sm">{entry.approval.summary}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      via <span className="font-mono text-zinc-400">{entry.approval.via}</span> ·
                      step {entry.approval.stepIndex}
                      {entry.approval.inputText
                        ? ` · text: "${entry.approval.inputText}"`
                        : ""}
                    </p>
                  </div>
                </div>

                {entry.latestScreenshotRef && (
                  <Screenshot taskId={entry.taskId} refPath={entry.latestScreenshotRef} />
                )}
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (armed) void act(entry.taskId, "approve");
                    else setArmedTaskId(entry.taskId);
                  }}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                    armed
                      ? "bg-ca-accent text-white hover:bg-ca-accent-hover"
                      : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                  }`}
                >
                  {busy ? "Approving…" : armed ? "Approve — click again" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Cancel this task? Its progress is discarded.")) {
                      void act(entry.taskId, "cancel");
                    }
                  }}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                >
                  {busy ? "Working…" : "Cancel"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
