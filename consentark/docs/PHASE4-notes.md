# Phase 4 — The Hire Flow & Employee Scoping

**Status: complete.** Full workspace build + typechecks green. Test count:
**106 total — 105 passing + 1 skipped** (live HN gate): 87 from Phases 1–3,
**19 new** (6 employee-scope security, 9 hire CLI, 4 work CLI).

## 1. Token & scoping design (the security heart — review this first)

### The two-tier model

| Tier | Credential | Storage | Scope |
| --- | --- | --- | --- |
| **Operator** | static `ADMIN_TOKEN` from env | env config (plaintext by necessity) | everything: `/api/employees`, `/api/tasks`, `/api/dashboard` |
| **Employee** | per-employee token, 32 random bytes, base64url (~192 bits) | **sha256 hash only** (`employee_tokens.token_hash`, migration 003) | `GET /api/employee/me`, `GET/POST /api/employee/tasks`, `GET /api/employee/tasks/:id`, `POST /api/employee/tasks/:id/cancel` — **own rows only** |

### Enforcement mechanics

- **One auth hook** (`app.ts` `onRequest`): a presented bearer is either the
  operator token, a valid employee token, or 401. A valid employee token
  resolves to `(employeeAuth = employeeId)` and is accepted **only** when the
  URL path is exactly `/api/employee` or under `/api/employee/` — the exact
  match (not a bare prefix) so `/api/employees` (the operator CRUD) cannot be
  reached by an employee token. This hook-level denial is the primary
  perimeter; the test pinning it failed before the fix and passes after.
- **Self-scope inside the routes** (`routes/employeeSelf.ts`): the employee
  object is always resolved from `request.employeeAuth` (never from the
  request body). Cross-employee access (read/cancel/enqueue-for) returns
  **404 with `task_not_found`** rather than 403 — it does not confirm that a
  peer's task id exists.
- **Grant enforcement at three layers**: the self-serve enqueue checks
  `toolsEnabled` (chat needs `chat_task`, browser needs `browser_task`), the
  operator enqueue does the same, and the runner re-checks before executing
  any task (defense-in-depth — a grant revoked after enqueue cannot run).
- **Token lifecycle**: issued once at hire (or later via
  `POST /api/employees/:id/tokens`), shown in the response exactly once,
  stored as sha256; `GET …/tokens` returns hashes/counts only;
  `DELETE …/tokens` revokes all (offboarding); hard delete revokes too.
- **Honest asymmetry (documented, unchanged per instructions)**: the
  operator token is a static env credential while employee tokens are
  hashed, revocable, and per-principal. Upgrading the operator tier (issuer,
  rotation, hashing) is future work; the current design keeps the Phase 1
  contract stable.

### Why hash-at-rest

The DB must not hold a usable credential. A leaked backup, a debug SELECT, or
a support dump yields hex digests, not Bearer headers. Verification is
O(1): hash the presented token, primary-key lookup. Cost: a lost token can
only be replaced (issue + revoke), not recovered — the hire output says so.

## 2. The hire flow

`npm run hire` (root script → `apps/api` `src/cli/hire.ts`, zero new deps —
`node:readline/promises`).

Interactive walkthrough: name → tool grants (one-line explanation each:
`chat_task` = reasons in text, `browser_task` = operates a browser within its
allowlist) → allowlist (only with the browser tool; entries validated to the
runtime contract, blank = empty allowlist = no browsing) → consent gate y/n
with a one-line explanation → backend (cloud FreeLLMAPI / local Colibrì) →
model → maxSteps → system prompt (custom path only) → **summary card +
explicit confirm** (`Create this employee? [y/N]`; decline aborts with
nothing written — test-pinned) → write → **summary card + the hiring token
printed ONCE** + next-step instructions.

Non-interactive: `--name --tools --allowlist --confirm/--no-confirm
--backend --model --max-steps --system-prompt --template data-clerk --demo
--help`. Complete flags = explicit intent, so no confirm prompt (scriptable
and testable). `--template data-clerk` pre-fills the flagship persona;
explicit flags override individual template values; the template still asks
for an allowlist (deliberately empty in the profile — the operator's targets
are unknowable in advance).

**Allowlist semantics match runtime enforcement exactly**: entries are
hostnames, lowercased, dot-boundary suffix match (`example.com` matches
`app.example.com`, not `notexample.com`); ports and paths are not part of
the contract. Pasting a URL normalizes to its hostname (the safe subset —
the operator is never silently granted less than they asked for).

## 3. The Data Clerk persona

`DATA_CLERK_TEMPLATE` (`src/cli/hireCore.ts`): `chat_task` + `browser_task`,
`confirmBeforeSubmit: true` (the poster child), `maxStepsPerTask: 40` (data
entry needs source-read + form-fill headroom; the runner clamps to the 500
hard cap), cloud/auto by default. The system prompt scaffolds the extract-
X-from-source, enter-into-target craft and explicitly tells the agent to
stop at submit and let the gate ask the human — the product thesis, stated
to the employee.

`--demo` enqueues two example tasks **through the employee-token API**
(doubling as a live check of the fresh token + scoped routes): (a) extract
the price list into schema-validated JSON from a local page, (b) fill a
local order form — which trips the consent gate, proving the whole loop.
Targets are served by `src/cli/demoPages.ts` (dev aid, port 8787, no real
submit endpoint; the form GET-echoes).

## 4. The work runner

`npm run work -- --token …` (`src/cli/work.ts`): token from
`--token` → `CONSENTARK_EMPLOYEE_TOKEN` → `--token-file` (first line). Polls
`GET /api/employee/tasks` every 3s, prints active tasks in plain language,
`--once` for cron/tests. It executes NOTHING — all execution stays in the
server-side runner (Phase 1/2 machinery); the CLI is HTTP + printing, so it
is auditable at a glance. Ctrl-C sets a flag, finishes the current poll, and
exits.

### The stale-task decision

Verified behavior, not assumed: task state lives **entirely server-side**
(SQLite status + in-memory queue reservation). A killed `work` process
cannot orphan anything because it never claims work — the server's worker
claims tasks. An in-flight browser task killed at the server dies with the
process and is handled by the existing startup recovery
(`TaskRunner.recover()`: `running` → re-queued with an audit line, `queued`
re-enqueued; tested in `queue.test.ts` "crash recovery" pins). A task in
`awaiting_approval` is deliberately untouched by recovery — the consent gate
must survive restarts. Conclusion: **no new claim-timeout needed**; the
existing restart-recovery covers the only stale state this architecture can
produce, and the decision is documented rather than duplicated with a
redundant sweeper.

## 5. Scoping matrix (test-pinned in `test/employeeScope.test.ts`)

| Endpoint | Operator token | Employee token (own) | Employee token (other) |
| --- | --- | --- | --- |
| `GET /api/health` | ✅ | ✅ | ✅ |
| `GET /api/employee/me` | ✅ | ✅ | — |
| `GET/POST /api/employee/tasks` | ✅ | ✅ own only | 404 |
| `GET /api/employee/tasks/:id` | ✅ (via `/api/tasks/:id`) | ✅ own only | **404** |
| `POST /api/employee/tasks/:id/cancel` | ✅ (via `/api/tasks/:id/cancel`) | ✅ own only | **404** |
| `/api/employees` CRUD + token issue/revoke | ✅ | **401** | **401** |
| `/api/tasks` (global enqueue/list) | ✅ | **401** | **401** |
| `/api/dashboard/*` (approvals, config, screenshots) | ✅ | **401** | **401** |

Pins include: plaintext never at rest (sha256 checked + raw SQLite bytes
grepped), revocation, forged `employeeId` rejected, grants enforced on the
self-serve path, operator↔employee coexistence.

## 6. Files & deviations

New: `src/auth/tokens.ts`, `src/db/repositories/tokens.ts`,
`src/routes/employeeSelf.ts`, `src/cli/{hireCore,hire,work,demoPages}.ts`,
`test/{employeeScope,hireCli}.test.ts`, migration 003.

Deviations: (1) allowlist URLs are normalized to hostnames rather than
rejected — the runtime contract is hostname-only, and this errs permissive
on *format* while strictly narrowing *scope*; (2) the operator `/chat`
route now requires the `chat_task` grant (previously chat was ungated) —
this is the one behavior change for existing employees, made so grants mean
the same thing on both tiers; three chat-flow fixtures gained the grant;
(3) no `n8n`/scheduler work — scheduling remains Phase 5; (4) the demo page
server starts on demand via a future `npm run demo` script rather than
always-on (the tasks themselves are enqueued without it and fail honestly
if the pages are unreachable).
