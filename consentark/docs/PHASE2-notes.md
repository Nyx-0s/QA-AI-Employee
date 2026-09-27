# Phase 2 — BrowserService (the employee's hands)

**Status: complete (hardened + adversarially audited).** Build + typecheck green,
**62 tests: 61 passing, 1 skipped** (live HN gate). Post-approval hardening (§1b) closed
the Enter/implicit-submission bypass and strengthened submit detection; the adversarial
self-audit (§1c) found and closed two further bypasses (synthetic page clicks, frame
propagation) — 7/7 vectors now hold, with two documented GAPs by decision. Real-model
findings: `docs/real-model-findings.md` (NOT RUN — no key in this environment).
Phase 0 risk #1 ("page-agent is in-page JavaScript, not a headless-browser service") is **RESOLVED** —
see `docs/spike-findings.md` for the evidence and `BrowserService.ts` for the production wrapper:
our thin Playwright shell navigates, injects the bundled agent, and runs it headless.

## 1. Confirm-before-submit gate — the mechanism actually used

**Chosen mechanism: `customTools` overrides** (page-agent 1.12.4
merges `customTools` AFTER its internal tool registry, so a same-name entry replaces the
built-in — verified in `@page-agent/core/dist/esm/page-agent-core.js`). TWO built-ins are
wrapped — `click_element_by_index` AND `input_text` — and a page-level Enter blocker
covers real keyboard input (see §1b). The custom tools
execute bound to the agent, read the same `selectorMap` index→element mapping the native
implementations use, inspect the element BEFORE any action fires, and then:

1. classifies the element with a conservative in-page detector (`submitDetect.ts`):
   **primary signal — `input[type=submit|image]` and `button[type=submit]` are submit-like
   regardless of text** (icon-only buttons exist); then `button` (submit/untyped),
   untyped `button` inside a `form`, and finally text/aria/title/value matching
   `/submit|send|pay|confirm|delete|order/i` as a SECONDARY signal — any doubt trips the gate;
2. when `confirmBeforeSubmit: true`: ALL paths route through ONE shared in-page flow
   (`gateFlow` in `browser-entry.ts`) — announce the pending action over an
   `exposeBinding` fire-and-forget channel (`__caApprovalRequest`) → the runner persists
   the `ApprovalRequest` (including `via: click | newline | enter-key`), flips the task to
   `awaiting_approval`, and captures the pause screenshot; the tool then BLOCKS inside the
   page on a second binding (`__caApprovalDecision`, a real promise across the CDP bridge);
   - approve (`POST /api/tasks/:id/approve`) → the runner settles the oldest pending
     trip's resolver (FIFO per task), the promise crosses the bridge into the page, the
     tool proceeds and delegates to the native `pageController.clickElement(index)` /
     `inputText(index, text)`;
   - cancel (`POST /api/tasks/:id/cancel`) → the decision resolves "cancelled", the tool
     sets the in-page `gateCancelled` marker, throws `DOMException(..., "AbortError")`,
     and page-agent's own abort path stops the loop ("Task aborted") — the host maps the
     marker to task status `cancelled` (page-agent reduces ANY tool error to the same
     "Task aborted" string, so the explicit marker is the only honest discriminator);
3. when `confirmBeforeSubmit: false`: the gate is audit-only — the announce still fires
   (plain-language "Auto-submitting …" line in the `safety` phase) and the action proceeds
   immediately. Observability never depends on the gate being on.

Why not a lifecycle hook: `onBeforeStep`/`onAfterStep` see only the agent, not the chosen
action's element, and cannot block a single tool call — the tool override is the only
clean interception point (documented in the spike's Phase 2 recommendation).

**Known limit, monitored:** a hypothetical future `execute_javascript` (or any
DOM-scripting) tool would bypass ALL of this — arbitrary JS can submit forms. As of
page-agent 1.12.4 no such tool ships (the `experimentalScriptExecutionTool` config only
REMOVES the built-in; verified in dist). A code comment at the gate registration site in
`browser-entry.ts` mandates wrapping any such tool if a vendor upgrade ever adds one.

The consent clock: `APPROVAL_TIMEOUT_HOURS` (default 24). The runner's sweeper (60s
interval) auto-cancels `awaiting_approval` tasks older than the window, with an audit line.
Gate state (`awaiting_approval` + `awaiting_at` columns) survives server restarts; on
restart the sweeper can still expire it, and an approve-after-restart honestly re-queues
the task from the beginning (no fake completion).

## 1b. Hardening — the Enter/implicit-submission bypass (closed)

**The hole (proven before fixing):** the Phase 2 gate wrapped only the CLICK tool. HTML
implicit submission means a form can be submitted without any click — e.g. the agent
calling `input_text` with text containing `\n`. Regression evidence (kept in
`test/browserTask.test.ts`, "Enter-key bypass hardening"): against the pre-fix code the
task reached `done` — **the form submitted with no ApprovalRequest ever created**. After
the fix the same task parks in `awaiting_approval` with `via: "newline"` and completes
only after an approve.

**Mechanisms chosen (layered, in interception order):**

1. **Tool level — gated `input_text` override (primary).** A `\n` in text typed into a
   single-line input (`HTMLInputElement`) is treated as submit INTENT: it routes through
   the SAME `gateFlow` (announce → persist → block → resume/reject) — no lightweight side
   path. Defense-in-depth: the newline is stripped before the text is typed (a single-line
   input cannot hold `\n`; the native setter would drop it anyway). Textareas are exempt
   (Enter is legitimate content there).
   *Why primary:* it fires on the agent's actual behavior regardless of page listeners;
   page-agent 1.12.4's `inputText` uses the native value setter + `input`/`change` events
   and never synthesizes key events, so today a `\n` alone cannot trigger implicit
   submission — but the submission INTENT is real, and any future vendor keyboard path
   (or user takeover) must not find an open door.
2. **Page level — capturing Enter blocker (defense-in-depth).** When
   `confirmBeforeSubmit: true`, the bundle installs a `document`-level `keydown` listener
   in CAPTURE phase BEFORE the agent runs. A real Enter inside a form input (single-line)
   has its default action prevented and is routed through the same `gateFlow`; on approval
   the exact default action is re-fired via `form.requestSubmit()`. This covers keyboard
   sources that never pass through our tool override: user takeover, a future vendor
   "press key" tool, page-injected trusted events.

Both layers reuse the exact approval flow (same `ApprovalRequest` shape, same status
transition, same screenshot, same audit phases, same cancel/approve endpoints). The gate
coverage test asserts BOTH the click path AND the typed-newline path produce an
`ApprovalRequest` when gated.

**Remaining limits (documented, accepted for Phase 2):**
- A future `execute_javascript` tool would bypass everything — see the monitored limit in
  §1 and the code comment at the gate registration site.
- Synthetic (untrusted) `keydown` events from page scripts can still dispatch to form
  handlers; the blocker gates the default ACTION (implicit submission), not arbitrary
  script-driven `form.submit()` calls. `form.submit()` invoked by page JS is out of reach
  without a vendor script-execution hook.
- Cross-origin iframes: `addInitScript` does not propagate into them (spike Q5); inputs
  inside cross-origin frames are invisible to both layers.
- `select_dropdown_option` can trigger `change`-driven auto-submits on aggressive pages;
  the gate classifies elements on click/newline/Enter, not `change` events. Not observed
  on any tested page; revisit if a real product trips it.

## 1c. Adversarial gate self-audit (post-hardening verification)

Self-audit script: `scripts/dev/gate-adversarial.ts` (run:
`cd apps/api && npx tsx scripts/dev/gate-adversarial.ts`). Each vector drives a real
headless Chromium through the production injection bundle and gate bindings. Verdicts:
**PASS** = gate holds · **BYPASS** = submission without consent · **GAP** = submission
possible but out of scope by explicit decision.

| Vector | Attack | Verdict | Notes |
| --- | --- | --- | --- |
| 1 | Page JS synthetic `MouseEvent('click')` on a submit button | **PASS** | Closed by the new PAGE-LEVEL click blocker (§1d): intercepted, routed through `gateFlow` (via=click), re-fired under the agent flag after approval. |
| 1b | `event.isTrusted` as a trusted/untrusted discriminator | **PASS** (rejected) | Not a hardening win — **page-agent's own `clickElement()` dispatches synthetic events** (`target.click()` + `dispatchEvent(new MouseEvent(...))`, verified in page-controller 1.12.4). An isTrusted filter would gate every agent click (safe but unusable) or none. Decision: the flag-guarded page blocker replaces the isTrusted idea. |
| 2 | Enter keypress in a form with NO submit button (spec plan-B implicit submission) | **PASS** | Old blocker only covered the default-button case; the rewritten blocker gates EVERY Enter in a non-textarea text-entry control inside a form — the button-existence check must never become an escape hatch. |
| 2b | Page `change`-listener that calls `form.submit()` on input change | **GAP** | CONFIRMED real: `form.submit()` by page JS navigates with no gate trip. Gating it requires intercepting `form.submit()`/navigation, not tool calls — future navigation-level layer. The `input_text` newline gate covers the agent-side intent; this vector is page-side. |
| 3 | Direct navigation to a URL with submission query params (GET-form semantics) | **GAP** | Decision: this is NAVIGATION, not form submission — no more risk than any URL fetch, the **domain allowlist already governs every navigation**, and approval would be meaningless post-hoc. Out of scope by decision; allowlist is the control. |
| 4 | Enter inside a SAME-ORIGIN iframe form (synthetic keydown from frame JS) | **PASS** | Enter blocker propagates into same-origin child frames via the frame watcher (300 ms re-sweep; load-event re-check). Required realm-agnostic element checks — `instanceof Element` FAILS for frame-realm nodes when the closure was created in the parent realm (found and fixed during this audit). |
| 4b | Synthetic click on a submit button INSIDE a same-origin iframe | **PASS** | The click blocker's frame copy intercepts frame-internal synthetic clicks (same realm-agnostic fix). Cross-origin frames remain out of reach (documented). |

**Score: 7/7 vectors held — 5 PASS, 2 GAP (by decision), 0 BYPASS.** Two real bypasses
were found and CLOSED during the audit (synthetic main-frame click; frame propagation),
plus the Enter plan-B hole — all three now have permanent regression tests.

## 1d. Hardening implemented (adversarial audit, item 2)

1. **Page-level click blocker** (`installClickBlockerOnDoc` in `browser-entry.ts`):
   capturing `click` listener; blocks submit-like clicks that do NOT carry the
   `__caAgentClickInProgress` flag, routes them through the same `gateFlow`, and the
   approved `proceed()` re-fires the click under the flag. The flag is the ONLY
   pass-through — isTrusted cannot discriminate (vector 1b).
2. **Enter plan-B coverage**: the Enter blocker now gates every Enter in a non-textarea
   text-entry control inside a form (default-button AND no-button forms).
3. **Frame propagation + watcher**: both blockers install into same-origin child frames;
   a 300 ms interval + `load`-event re-sweep re-guards documents replaced by late loads
   or page-JS navigation (per-DOCUMENT flags keep re-install a no-op).
4. **Realm-agnostic element checks**: all page-level blockers use `nodeType === 1` /
   `tagName` instead of `instanceof` (cross-realm `instanceof` failure found by vector 4).

Regression tests (all in `test/browserTask.test.ts`, "HARDENING" tests): page-JS
synthetic click → gate trips with `page-level` description; agent click completes with
EXACTLY ONE approval (no double gate); iframe self-Enter → gate trips with
`via: "enter-key"`.

**Accepted risk — page-JS `form.submit()` / `change`-driven auto-submits (vectors 2b/3,
GAP by decision):** the gate's threat model is **model error, not malicious pages**. The
employee's LLM is the only actor we need to consent-gate: it can misjudge a submission,
hallucinate a target, or act on a mangled instruction — and every path it can take
(click, typed newline, Enter) is intercepted mechanically before any model output is
trusted. A page's own JavaScript, by contrast, runs inside the page's trust origin: it
could equally well forge the request via `fetch()` with none of the DOM theatre, so
gating `form.submit()` alone adds almost no real defense against a truly malicious page
while adding a permanent false-approval tax on every benign auto-submitting form. The
real controls for page-side behavior are the **domain allowlist** (an employee can only
ever be pointed at pages the operator chose) and the **audit trail** (everything that did
happen is reconstructible). Navigation-level interception remains a documented future
layer if the threat model ever expands to untrusted pages.

## 2. Service & pool lifecycle

- ONE shared headless Chromium per API process, `BROWSER_POOL_SIZE` contexts (default 2),
  one per concurrent task, **disposed after every task** (context is the memory unit —
  pages, service workers, and caches die with it).
- FIFO slot waiters; `busyCount` exposes pool utilization.
- One **per-task LLM proxy** (not per-service): per-employee upstream (cloud FreeLLMAPI or
  local Colibrì — the spec carries the employee's own backend URL/key/model), audit
  isolation between tasks, clean teardown. The real upstream key NEVER enters the page;
  the in-page agent holds only the placeholder `apiKey: "pa-proxy"` while
  `customFetch` routes its model calls over Playwright's CDP bridge (`exposeFunction`)
  into the proxy — immune to page CSP and Chrome Private Network Access (spike Q5).
- Allowlist enforced twice: at enqueue (route, 403) and per-context Playwright routing
  (main frame + subresources, hard-abort) + navigation check.
- Screenshots at start, gate pause (gated trips only), completion — paths relativized
  against `DATA_DIR` in the task record.
- Cancellation: cooperative flag polled every 200 ms during a run + the gate-decision
  channel; both end in `page.evaluate(STOP_AGENT_JS)` → `agent.stop()` → context disposal.

## 3. Screen-memory profile (measured)

Measured with a whole-tree probe (`ps` over the `headless_shell` process tree, Playwright
1.63 / Chromium 153, macOS): **idle shared browser ≈ 71 MB RSS; one task context running
≈ 102 MB; two concurrent contexts ≈ 103 MB.** Contexts are the memory unit and are
disposed after every task, so steady-state tracks the number of CONCURRENT tasks, not
history. With the default `BROWSER_POOL_SIZE: 2`, plan ≈ 100–250 MB for the browser
depending on page weight (heavy SPAs push renderer RSS up); `BROWSER_POOL_SIZE: 1`
keeps small hosts flat. The per-task proxy adds one loopback listener per running task
(negligible). Watch-item: renderer-heavy pages peak transiently during agent steps —
the pool size is the operating lever if RAM-constrained.

## 4. Structured output & error codes

`outputSchema` (JSON-Schema subset: type/enum/required/properties/items/min/max —
`src/util/schemaValidate.ts`) validates the agent's final `done` JSON. Mismatch →
task failed with code **`output_schema_mismatch`** and human-readable paths
(`$.revenue: missing required property "revenue"`). Match → `task.output = { reply: <json>,
validated: true, steps, model, provider: "browser" }`.

Distinct task.error codes from the browser path: `domain_not_allowed`,
`navigation_failed`, `injection_failed` (reserved — the bundle self-heals via
addScriptTag), `agent_failed`, `agent_timeout` (BROWSER_TIMEOUT_MS, default 60s),
`max_steps_exceeded` (employee cap clamped to BROWSER_MAX_STEPS_HARD_CAP=500),
`output_schema_mismatch`, `cancelled`.

## 5. Small-model caveat — UNTESTED WITH A REAL MODEL

All CI evidence uses the scripted mock LLM; **no real model has driven the browser loop
in this environment** (no FreeLLMAPI key here). The proxy path is key-ready:
`scripts/real-model-probe.ts` runs one real task end-to-end the moment
`FREELLMAPI_URL` + `FREELLMAPI_KEY` are set. Spike finding Q4 stands: OLMoE-7B-class
models may struggle with the GUI tool-calling macro-format; browser tasks default to
cloud employees until the probe proves a local model viable.

## 6. Deviations from the Phase 2 brief (with justification)

1. **Proxy per task instead of per service** — the brief implied one proxy; per-task
   gives per-employee upstreams (cloud AND local employees in the same pool) plus audit
   isolation. Cost: one loopback listener per running task.
2. **Per-trip gate resolvers instead of one decision promise** — Phase 2 wired a single
   `gateDecision` promise per task; the hardening pass replaced it with a FIFO queue of
   per-trip resolvers (each gate trip registers its own), so a task that trips the gate
   more than once (click, then a second click) cannot deadlock and approve/cancel always
   target the oldest pending trip. Resolvers are handed to the runner through the spec's
   `onGatePending(info, resolve)` callback and forwarded into the page across the CDP
   bridge (an approval must physically reach the in-page blocker — verified by the
   gate-approve E2E).
3. **Migration 002 ships two columns** (`awaiting_approval`, `awaiting_at`) — the first
   draft missed the JSON state column; fresh databases and the migration ledger both
   cover it now (existing dev DBs created during the window need re-creation or manual
   `ALTER TABLE`).
4. **Old spike driver removed, not kept alongside** — `BrowserSpike.ts` was the
   copy-paste risk the brief called out; its evidence lives in `spike-findings.md` +
   git history, and `scripts/spike-probe.ts` now drives `BrowserService` directly.
5. **`routes.test.ts` cancel-shape updated** — cancel responses now return
   `{ cancelled, status }` (richer than the Phase 1 `{ cancelled, when }`), one Phase 1
   assertion adjusted accordingly.
