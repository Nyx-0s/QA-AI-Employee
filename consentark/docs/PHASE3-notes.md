# Phase 3 — Supervisor Dashboard (the human side of the consent flow)

**Status: complete.** Build + typechecks green across the workspace; test count
**76 total: 75 passing + 1 skipped** (live HN gate): 62 from Phases 1–2, 12 new
API tests (`apps/api/test/dashboard.test.ts`), 14 new dashboard tests
(unit + jsdom render smoke). Screenshot evidence: `docs/evidence/phase3/`.

## 1. App choice

**React 19 + Vite 7 + Tailwind 4** in `apps/dashboard`.

- **React**: the UI is state-dense (two poll loops, armed-button state,
  expandable rows) but small; React's model fits and it was the Phase 0 plan.
  Vite 7 was already in the workspace dependency store — zero new toolchain.
- **Tailwind 4 (CSS-first `@theme`)**: no config file, no component library,
  dark zinc palette with a single consent-red accent (`ca-accent`). Professional
  without paid deps.
- **Polling (4s), not websockets**: the approval queue is a handful of rows and
  human decision timescales are minutes — 4s polling is invisible in practice,
  survives proxies/redeploys, and adds no server state. Revisit only if task
  volume makes 4s×N-operators chatty.
- **Two API surfaces**: dashboard read-models live under `/api/dashboard/*`
  (approvals queue, config, screenshots) so the consent surface has its own
  versioned contract; task/employee writes reuse the existing endpoints.

## 2. New API endpoints

| Endpoint | Purpose | Auth |
| --- | --- | --- |
| `GET /api/dashboard/approvals` | Read-model joined from tasks+employees: gate details, employee name, latest screenshot ref, awaiting timestamp. Oldest-first (closest to auto-cancel first). | Bearer |
| `GET /api/dashboard/config` | `{ approvalTimeoutHours }` — the consent clock the UI renders. | Bearer |
| `GET /api/dashboard/screenshots/:taskId/:name` | Streams a stored PNG. Resolves strictly inside `DATA_DIR` (403 `screenshot_path_forbidden` on traversal), verifies the ref is in the task's screenshot list (404 otherwise), `cache-control: private, no-store`. | Bearer |

Shared package additions: `ApprovalQueueEntry`, `DashboardConfig`
(`packages/shared/src/approvals.ts`), plus `taskStatusSchema` exported from
`task.ts` for downstream read-models.

## 3. UX decisions

- **Approve is a two-step button** (arm → "Approve — click again" → commit).
  Accidental approval is the *dangerous* direction — a real form submission on
  a client system — so it costs one extra explicit action. Cancel is the cheap
  direction (wasted work, nothing committed) so it uses a plain confirm dialog.
  The jsdom tests pin both behaviors: one click never fires `/approve`.
- **Countdown on every card** from `APPROVAL_TIMEOUT_HOURS`: "23h 1m left",
  turns urgent (accent border + badge) inside the last 10% of the window,
  "expired" at zero. A human should always see when silence ⇒ auto-cancel.
- **Tab-title indicator**: `ConsentArk (n)` while approvals wait; an unseen
  approval defeats the gate.
- **Audit timeline groups** consecutive log lines into AI reasoning / Browser
  actions / Safety / System bands (pure helper, unit-tested) — an operator can
  reconstruct what happened and why from one expanded row.
- **Evidence thumbnails** are fetched with the auth header (blob URLs, revoked
  on unmount) — never raw URL params carrying tokens.

## 4. Security posture

Screenshots are task evidence: 401 without the Bearer token (pinned by test),
403 on any path escaping `DATA_DIR` (pinned), 404 for refs not in the task's
own screenshot list (pinned — no enumerating other tasks' files), and no
caching. The dashboard is operator-only; employees never see these routes.

## 5. Accepted risk (carried from Phase 2)

The `form.submit()` GAP documented in `docs/PHASE2-notes.md` §1d remains open
by decision — the threat model is model *error*, not malicious pages; a page
that deliberately calls `form.submit()` from its own JS is outside the consent
gate's remit. The dashboard assumes the same threat model: it surfaces exactly
what the gate caught and does not attempt to detect unobservable submission
paths. See PHASE2-notes for the full rationale.

## 6. Deviation from the Phase 3 brief

- **Employees view is read-only** (brief allowed minimal editing): full CRUD
  already exists via the API and the hire-wizard belongs to a later UX pass —
  adding forms now would be gold-plating.
- **Reports/Settings pages deferred**: the brief scoped Phase 3 to the
  approval surface + tasks + employees; weekly reports need a data model
  (task-hours aggregation) that doesn't exist yet. Flagged for Phase 4.
