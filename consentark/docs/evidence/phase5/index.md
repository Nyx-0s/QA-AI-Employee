# Phase 5 evidence — composed stack

All captures are from `docker compose up` (image target `runtime-browser`,
final build including the PHASE5-notes §5 deadline fix) — not dev servers.
One reproducible run produces all four:

```bash
docker compose --profile browser up -d app
APPROVE=1 node apps/api/scripts/dev/phase5-evidence.mjs
```

The driver restarts the app container first (orphan-daemon runbook,
PHASE5-notes §4), starts the mock LLM + demo pages in-container, hires a
gated employee via the packaged CLI, enqueues through the employee-token
API, waits at the gate, then captures.

| File | Shows |
| --- | --- |
| `05-approvals-gate.png` | Approvals queue: live gated card (employee, objective, URL, gate details, countdown) |
| `05-tasks.png` | Task list with statuses/employees; the parked awaiting_approval row |
| `05-employees.png` | Employees view: grants, allowlist, "consent gate ON" badge, task count |
| `05-task-done-audit.png` | After approve: task `done` with output, screenshots, grouped audit timeline |

Auth note: captures set `ca-operator-token` in localStorage (the dashboard's
packaged-build token input path); the first attempt used a stale key and
produced unauthenticated shells — discarded.
