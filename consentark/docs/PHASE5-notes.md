# Phase 5 — Operator Auth Hardening & Packaging

**Status: complete.** Full workspace build + typechecks green. Test count:
**112 total — 111 passing + 1 skipped** (live HN gate): 103 from Phases 1–4,
**4 new** operator-auth tests (`test/operatorAuth.test.ts`), **1 new**
gate-deadline regression test (see §5), plus 4 dashboard tests re-verified
against the packaged token-input UX.

## 1. Operator auth (mirrors the employee pattern)

Three modes resolved once at boot (`src/auth/operator.ts`), all compared as
**sha256 hashes** — no plaintext comparison path exists:

| Mode | When | At rest |
| --- | --- | --- |
| **Generated** (default) | no `ADMIN_TOKEN` env, no stored credential | sha256 in `settings` table; plaintext printed **once** in the boot log and persisted to `DATA_DIR/operator-token` (mode 600) so restarts work without env vars |
| **File resume** | `DATA_DIR/operator-token` exists, no env | hash verified against the file before use; mismatch = loud failure, never silent credential drift |
| **Env override** | `ADMIN_TOKEN` set | env value hash-compared per request; **no plaintext is ever written to DB or disk** |

Rotation: `POST /api/operator/rotate` (operator-authenticated) mints a new
token, swaps the stored hash, rewrites the mode-600 file, invalidates the old
credential immediately, and prints the new plaintext once. `GET
/api/operator/status` reports mode + fingerprint (never the secret). The
employee-token asymmetry documented in Phase 4 is now closed: both tiers are
hashed, revocable, and one-per-principal.

Test-pinned (`test/operatorAuth.test.ts`): plaintext never appears in the raw
SQLite bytes; env-override path never writes plaintext anywhere; rotate
invalidates the old token on the very next request; the file-resume path
survives a restart.

## 2. Compose architecture (decision + justification)

**One application container.** The API serves the built dashboard as static
files (`@fastify/static`, `DASHBOARD_DIST`), so there is no nginx and no
second service to authenticate, monitor, or version — the dashboard is the
API's own read surface, not a separate app. SQLite means no DB service; the
`consentark-data` volume **is** the durability story (single writer, WAL,
restart recovery re-queues interrupted rows — limits stated plainly in the
README).

**Two image targets:**
- `runtime` (default, `docker compose up`): no browser stack. Chat tasks work
  fully; browser tasks fail honestly at Chromium launch. Keeps the image at
  ~half the size for the common "operator wants the dashboard + chat" case.
- `runtime-browser` (`docker compose --profile browser up`, or
  `CONSENTARK_IMAGE_TARGET=runtime-browser docker compose build`): adds
  Playwright Chromium (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, owned by the
  app user). Use this when employees will actually browse.

First boot prints the operator token once; subsequent boots resume from the
file. `docker compose logs app | grep "OPERATOR TOKEN"` retrieves it.

## 3. Packaging bugs found and fixed (why this phase exists)

Packaging did exactly what it is for: the composed stack refused to behave
like the dev server in six distinct places, each invisible in `pnpm dev`:

1. **`tsconfig.base.json` missing from the build context** — packages extend
   it; in-container `tsc` silently built with different strictness. Fixed:
   copied into the builder stage.
2. **`esbuild` was an undeclared runtime dependency** — the injection-bundle
   builder imports esbuild at *runtime* (first browser task), resolved locally
   only through pnpm hoisting. Fixed: declared in `apps/api/package.json`.
3. **The CLIs' direct-execution guard checked `argv[1].endsWith("hire.ts")`**
   — true under tsx, false for compiled `hire.js`, so `dist/cli/hire.js` was a
   no-op in the container. Fixed: both CLIs use the resolved-entrypoint path.
4. **Version read the wrong file in dist layouts** — the relative path was
   correct for src/tsx and one level short for dist, reporting
   `version: "unknown"` on the composed stack. Fixed: resolve robustly from
   `import.meta.url` regardless of layout.
5. **`browser-entry.ts` was never shipped in dist** — the injection bundle is
   built from that source *path* at first browser task; the packaged image
   had no such file. Fixed: the API build script copies it into
   `dist/browser/`.
6. **The demo form navigated on submit** — a real GET submission destroys the
   in-page agent context right after the approved click, failing the resumed
   task. CI fixtures always used `onsubmit="return false"`; the demo now
   records the submission in-page instead of navigating.

Found during evidence collection (§4), not by the suite: **the per-task
browser timeout consumed wall-clock time while a task sat at the approval
gate** — an approval slower than `BROWSER_TIMEOUT_MS` killed a gated task
with `agent_timeout`. See §5.

## 4. Evidence (from the composed stack, not dev servers)

All PNGs in `docs/evidence/phase5/`, captured by
`node apps/api/scripts/dev/phase5-evidence.mjs` (`APPROVE=1` adds stage 2)
against `docker compose up` containers — in-container hire → employee-token
enqueue → mock LLM + demo pages in-container → gate trips on the "Place
order" click → dashboard queue → **approve → done** with all four audit
phases (system / llm / browser / safety):

| File | Shows |
| --- | --- |
| `05-approvals-gate.png` | Approvals queue with a live gated card: employee, objective, target URL, gate details, countdown |
| `05-tasks.png` | Task list — statuses, employees, timestamps; the parked card in awaiting_approval |
| `05-employees.png` | Employees view — grants, allowlists, "consent gate ON" badges, task counts |
| `05-task-done-audit.png` | The approved task expanded: `done`, output, screenshots, grouped audit timeline |

(The first capture attempt produced unauthenticated shells — the capture
scripts set a stale localStorage key; fixed to `ca-operator-token` and the
above are verified to contain rendered data, not the connect screen.)

**Orphan-daemon runbook (the pattern that cost three debug cycles):** any
`docker compose exec app node …` process **outlives its exec client** — killing
the host-side `docker compose exec` does not kill the in-container node. The
slim image ships no `pkill`/`pgrep`, so a stray mock-LLM daemon on port 3001
silently serves stale scripted responses to every later run (scripts kept
"passing" against a daemon whose response counter had already advanced past
`done` — the agent finished without ever tripping the gate). The reset is
`docker compose restart app`; both evidence scripts do it in their preamble
so runs are deterministic, and all demo daemons bind fixed ports for exactly
this reason.

## 5. Gate-freeze bugfix disclosure

The brief froze the gate ("bugfixes only") — this was a bugfix, disclosed for
approval: **the approval pause must stop the agent-task deadline.**
`BrowserService`'s per-task timeout used a fixed `setTimeout(timeoutMs)`, so
a gated task parked for human approval died with `agent_timeout` the moment
the budget elapsed — CI never caught it because tests approve in milliseconds.
On a live operator desk, approval takes minutes; the flagship flow (the
product's entire point) was structurally broken for exactly the pauses it
exists to create.

Fix: the deadline is now a **resumable budget** (`timeoutAt`). A gated trip
freezes the remaining budget (`pausedTimeout`), restores it when the human
answers, and the deadline poller ticks against `timeoutAt` — human latency is
no longer agent latency. Non-gated (audit-only) trips pass through unchanged;
cancel still wins instantly via its own 200ms poller; the poller is cleared
when the race settles. Regression test: a gated task whose approval arrives
**7s** into a **3s** budget completes `done` (fails against the old code —
proven live on the composed stack before the fix).

No other gate behavior moved: detection, interception, the approval flow, and
audit semantics are untouched.

## 6. Real-model status

Still no FreeLLMAPI key in this environment — `docs/real-model-findings.md`
unchanged, absence re-confirmed. The Phase 4 demo tasks remain the ready-made
probe payload the moment a key exists.
