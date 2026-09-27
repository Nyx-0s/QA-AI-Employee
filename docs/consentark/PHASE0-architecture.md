# ConsentArk AI Workforce — Phase 0 Architecture Plan

Status: PROPOSED — awaiting approval. Phase 1 does not start until approved.

## 0. Grounding — what the three repos actually are

Inspected from their live READMEs (2026-09-14). Integration assumptions below are
based on these facts, not guesses.

### FreeLLMAPI (tashfeenahmed/freellmapi)
- Self-hosted, local-first, single-user. Node 20+, ~40 MB RSS. Docker one-liner install.
- One OpenAI-compatible surface: `http://localhost:3001/v1` (`/v1/chat/completions`,
  `/v1/models`, streaming, **tool calling round-trips across providers**,
  `response_format` structured outputs).
- Auth: one unified bearer key (`freellmapi-…`) from its dashboard; provider keys are
  stored encrypted inside FreeLLMAPI itself (we never hold them).
- Built-in smart routing + automatic fallover on 429/5xx with cooldowns — provider
  rate-limit failover is **its job, not ours**. Response header `X-Routed-Via` names the
  provider/model actually served.
- Model can be `auto`, `auto:fast`, `auto:smart`, a named profile, or a model id.

### page-agent (alibaba/page-agent) — ⚠️ ARCHITECTURAL FLAG
- **It is in-page JavaScript, not a headless-browser service.** README: "No need for
  browser extension / python / headless browser. Just in-page javascript. Everything
  happens in your web page" and "designed for client-side web enhancement, not
  server-side automation."
- Real API (from README): `npm install page-agent`;
  `new PageAgent({ model, baseURL, apiKey, language, autoInit:false })`;
  `await agent.execute('instruction')`. Bring-your-own OpenAI-compatible LLM — so it can
  point at FreeLLMAPI or Colibrì directly.
- Optional Chrome extension for multi-page; MCP server (Beta) to control from outside.
- **Consequence for us:** the "hands" service must WRAP page-agent: a Node process runs
  Playwright (headless chromium), navigates to the task URL, injects the page-agent
  script into the page, instantiates it against our LLM endpoint, calls `execute()`,
  and captures screenshots/results from Playwright. We do NOT get a ready-made
  "Node service that executes in a headless browser" out of the box — we build that
  shell (~1 file, Playwright + injection). Flagged honestly per the master prompt.
- Multi-page tasks: handled by our shell looping navigate → inject → execute per page.
  The Chrome-extension and MCP routes are Phase 2 evaluation alternatives, not defaults.

### Colibrì (JustVugg/colibri)
- Pure-C local MoE inference engine, one file per model family. Frontends:
  `coli chat`, `coli serve`, `coli web`.
- `coli serve` exposes the OpenAI-compatible endpoint (config `COLIBRI_URL`,
  default `http://localhost:8080/v1` — verify exact port at Phase 1 integration).
- Runs OLMoE 7B and Qwen3.6 35B on modest hardware (streams experts from disk).
- Caveat carried into the design: small local models may be weak at GUI-agent
  tool-calling (page-agent's loop). Mitigation: per-employee backend choice, and
  browser-task planning may default to cloud while chat/summarization can stay local.

## 1. System overview

```
                         ┌────────────────────────────┐
   Vercel (free tier)    │  Supervisor Dashboard      │  React + Vite + Tailwind
   (dashboard only)  ───▶│  Team / Employee / Tasks / │  talks REST to API
                         │  Reports / Settings        │
                         └─────────────┬──────────────┘
                                       │ REST (admin token)
                         ┌─────────────▼──────────────┐
   Self-hosted (docker)  │  consentark-api (Fastify)  │
                         │  • REST API                │
                         │  • Task queue + worker     │
                         │  • SQLite (better-sqlite3) │
                         │  • Audit log (every AI     │
                         │    decision, human-readable)│
                         │  • LLMProvider             │
                         │  • BrowserTool (Playwright │
                         │    + page-agent injection) │
                         └──────┬──────────────┬──────┘
                                │              │
              ┌─────────────────▼───┐   ┌──────▼─────────────┐
              │ FreeLLMAPI :3001    │   │ Colibrì :8080      │
              │ cloud (docker)      │   │ local (optional)   │
              └─────────────────────┘   └────────────────────┘
                                ▲
                         ┌──────┴──────┐
                         │ n8n :5678   │  workflow orchestration → webhook → API
                         └─────────────┘
```

Service boundaries:
- **Dashboard** never talks to LLMs or browsers. REST only.
- **API** is the only component that touches LLMs, the browser, and the database.
- **FreeLLMAPI / Colibrì** are interchangeable behind `LLMProvider`.
- **n8n** integrates via a webhook route that enqueues tasks — it never calls the LLM.

## 2. Directory structure (pnpm monorepo)

```
consentark/
├── package.json                 # workspaces, scripts (dev, test, hire, lint)
├── pnpm-workspace.yaml
├── tsconfig.base.json           # strict: true, no unchecked anys
├── .env.example                 # every var documented
├── docker-compose.yml           # Phase 5: api, freellmapi, n8n, optional colibri
├── docs/                        # this file, audit-log format spec, setup guides
├── packages/
│   └── shared/                  # zod schemas + TS types shared api↔dashboard
│       └── src/{employee.ts, task.ts, api-contracts.ts}
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── index.ts             # Fastify bootstrap, graceful shutdown
│   │   │   ├── config/env.ts        # zod-validated env (fails fast, no hardcoded keys)
│   │   │   ├── db/
│   │   │   │   ├── sqlite.ts        # better-sqlite3 + numbered migrations
│   │   │   │   └── repositories/{employees,tasks,logs}.ts
│   │   │   ├── llm/
│   │   │   │   ├── provider.ts      # LLMProvider interface + wire types
│   │   │   │   ├── openaiCompatible.ts  # ONE client, two config presets
│   │   │   │   ├── cloudProvider.ts     # FreeLLMAPI preset
│   │   │   │   ├── localProvider.ts     # Colibrì preset
│   │   │   │   └── resilience.ts    # timeout, retry + backoff, circuit note
│   │   │   ├── queue/
│   │   │   │   ├── queue.ts         # TaskQueue interface
│   │   │   │   ├── memoryQueue.ts   # in-memory + SQLite persistence + crash recovery
│   │   │   │   └── bullmqQueue.ts   # optional adapter when Redis exists (Phase 5+)
│   │   │   ├── worker/
│   │   │   │   ├── taskRunner.ts    # employee loop: plan → tool calls → structured output
│   │   │   │   └── audit.ts         # human-readable decision logging
│   │   │   ├── tools/
│   │   │   │   ├── registry.ts      # tool registry (function-calling schemas)
│   │   │   │   └── browser/
│   │   │   │       ├── browserTool.ts       # browser_task schema + orchestration
│   │   │   │       ├── pageAgentRunner.ts   # Playwright + page-agent injection
│   │   │   │       └── safety.ts            # domain whitelist, max steps, submit gate
│   │   │   ├── routes/
│   │   │   │   ├── employees.ts  tasks.ts  chat.ts
│   │   │   │   ├── reports.ts  settings.ts  hooks.ts (n8n)
│   │   │   └── templates/
│   │   │       └── dataClerk.ts     # Phase 4 "Private Data Clerk" template
│   │   └── test/                    # Vitest: providers, queue, safety, routes
│   └── dashboard/                   # Phase 3 (React+Vite+Tailwind, Vercel-ready)
│       └── src/{pages,components,api,lib}
└── scripts/
    └── hire.ts                      # npm run hire data-clerk (Phase 4 CLI bootstrap)
```

Decision: **monorepo** because `packages/shared` gives dashboard and API one source of
truth for Employee/Task types and API contracts — cheapest to keep honest for a
solo founder.

## 3. Data models (packages/shared, zod-validated)

### Employee
```ts
interface Employee {
  id: string                    // slug, e.g. "data-clerk-01"
  name: string
  role: 'data_clerk' | 'lead_ops' | 'support' | 'custom'
  description: string
  systemPrompt: string
  backend: 'cloud' | 'local'    // FreeLLMAPI | Colibrì — config change, not code
  model: string                 // e.g. "auto" (cloud) or "OLMoE-7B" (local)
  toolsEnabled: string[]        // e.g. ["browser_task"]
  allowedDomains: string[]      // safety whitelist; empty = deny all browser use
  confirmBeforeSubmit: boolean  // never auto-submit forms on client systems
  maxStepsPerTask: number       // default 25
  schedule: { cron: string; taskTemplate: string } | null
  status: 'active' | 'paused'
  createdAt: string             // ISO-8601
}
```

### Task
```ts
type TaskStatus = 'queued' | 'running' | 'awaiting_approval' | 'done' | 'failed' | 'cancelled'

interface Task {
  id: string
  employeeId: string
  type: 'chat' | 'browser_task' | 'scheduled'
  input: { objective: string; url?: string; steps?: string[]; outputSchema?: object }
  status: TaskStatus
  output: unknown | null        // validated against outputSchema when present
  plan: LLMPlan | null          // the AI's plan — logged for client audit
  error: { code: string; message: string; retriable: boolean } | null
  logs: TaskLog[]               // human-readable audit trail
  screenshots: string[]         // DATA_DIR/screenshots/<taskId>/*.png
  startedAt?: string
  finishedAt?: string
  createdAt: string
}

interface TaskLog {
  at: string
  level: 'info' | 'warn' | 'error'
  phase: 'plan' | 'llm' | 'tool' | 'browser' | 'safety' | 'system'
  message: string               // human-readable — "Employee opened https://… "
  data?: unknown                // structured detail, kept out of the message
}
```

SQLite tables mirror these: `employees`, `tasks`, `task_logs`, `settings`,
`schema_migrations`. Screenshots live on disk under `DATA_DIR`, paths in `tasks`.

## 4. LLMProvider abstraction

```ts
interface LLMProvider {
  chat(req: ChatRequest): Promise<ChatResponse>            // OpenAI wire format
  stream(req: ChatRequest): AsyncIterable<ChatChunk>
  health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }>
}
```

- **One OpenAI-compatible client** (`openaiCompatible.ts`); `CloudProvider` and
  `LocalProvider` are thin config presets (baseURL, key, model, timeouts). Switching an
  employee from cloud to private is `backend: "local"` — no code change.
- Resilience wrapper on every call: timeout (default 60 s), 2 retries with exponential
  backoff (500 ms base), structured error logging to the task log.
- Rate-limit fallover across providers is FreeLLMAPI's own router (verified). Optional
  local→cloud fallback is OUR flag, default **OFF** (privacy-first).
- Every call logs: provider, model, latency, token usage, and `X-Routed-Via` when cloud.

## 5. Hands — BrowserTool (Phase 2 preview, shaped now so Phase 1 doesn't block it)

```ts
// function-calling tool schema exposed to the employee LLM
browser_task {
  url: string
  objective: string
  steps?: string[]                // optional prescribed steps
  outputSchema?: object           // JSON schema for the extracted result
}
```

Execution shell (`pageAgentRunner.ts`): Playwright launches headless chromium → navigate
(whitelist-checked) → inject `page-agent` dist → `new PageAgent({ model, baseURL, apiKey,
autoInit:false })` → `agent.execute(objective)` → collect result, per-step screenshots,
console/network errors → structured output written to the task.

Safety (ConsentArk brand = consent + audit):
- Domain whitelist per employee, checked before every navigation; violations fail the
  task with a logged safety event.
- `maxStepsPerTask` and a hard timeout per task.
- `confirmBeforeSubmit`: task moves to `awaiting_approval`; dashboard exposes
  Approve/Reject; Playwright-level request interception blocks form submissions until
  approved. (Exact interception mechanism = first Phase 2 spike; flagged as risk.)

Open design point for Phase 2: page-agent calls the LLM **from browser context**, so its
`baseURL` must be reachable from the headless browser (true for localhost/docker). Two
modes — (a) direct to FreeLLMAPI/Colibrì, or (b) **proxy mode** through our API, which
injects keys and logs every model call for the audit trail. Recommend (b); it is cheap
and directly serves the audit product requirement.

## 6. REST API

```
POST   /api/employees                      hire (template or custom)
GET    /api/employees                      team cards data
GET    /api/employees/:id                  detail
PATCH  /api/employees/:id                  prompt/backend/model/schedule/safety
DELETE /api/employees/:id                  soft-delete (status → paused) unless ?hard
POST   /api/employees/:id/chat             interactive instruction → reply + taskId
GET    /api/employees/:id/tasks            task feed for one employee
GET    /api/employees/:id/report/weekly    weekly report JSON (dashboard renders + PDF export)
POST   /api/tasks                          enqueue
GET    /api/tasks?status=&employeeId=      list + filters
GET    /api/tasks/:id                      detail: logs, plan, screenshots, output
POST   /api/tasks/:id/approve              approval gate (confirm-before-submit)
POST   /api/tasks/:id/cancel
POST   /api/hooks/n8n/task                 webhook for n8n workflows (token-authed)
GET    /api/health                         api + cloud health + local health
GET|PATCH /api/settings                    URLs, privacy mode (keys never returned)
```

Auth model: dashboard is deployable to Vercel, but the **API stays self-hosted** (it
drives browsers and owns SQLite). Remote dashboard → API uses `ADMIN_TOKEN` bearer +
CORS allowlist.

## 7. Environment variables (.env.example)

```
# ── API ──────────────────────────────────────────────
PORT=4000
DATA_DIR=./data                      # sqlite db, screenshots, audit exports
ADMIN_TOKEN=change-me                # bearer for API when dashboard is remote
CORS_ORIGIN=http://localhost:5173

# ── LLM: cloud (FreeLLMAPI) ─────────────────────────
FREELLMAPI_URL=http://localhost:3001/v1
FREELLMAPI_KEY=freellmapi-your-unified-key
FREELLMAPI_MODEL=auto                # auto | auto:fast | auto:smart | model id
FREELLMAPI_FALLBACK_MODEL=           # optional; FreeLLMAPI already fails over internally

# ── LLM: local (Colibrì) ────────────────────────────
COLIBRI_URL=http://localhost:8080/v1
COLIBRI_MODEL=OLMoE-7B               # modest-hardware default
LOCAL_FALLBACK_TO_CLOUD=false        # privacy-first: default OFF

# ── Hands (browser) ─────────────────────────────────
PLAYWRIGHT_HEADLESS=true
BROWSER_MAX_STEPS=25
BROWSER_TIMEOUT_MS=120000
BROWSER_DEFAULT_DOMAINS=             # per-employee whitelist overrides

# ── Dashboard (Vite) ────────────────────────────────
VITE_API_URL=http://localhost:4000
```

## 8. Testing & verification (Vitest)

- `llm/`: mock HTTP — timeout, retry/backoff, fallback flag behavior, streaming, health.
- `queue/`: enqueue→run, persistence, crash recovery on restart, concurrency=1 per
  employee, cancel.
- `tools/safety`: whitelist enforcement, max steps, submit gate.
- `routes/`: fastify `inject()` contract tests against shared schemas.
- Non-negotiable from the master prompt: provider + queue tests land in Phase 1.

## 9. Audit logging (product requirement)

Every AI decision is appended to `task_logs` in plain language a client can read:
plan produced, each tool call with arguments, each browser step, each LLM call
(model + latency + tokens), every safety event, every approval. `GET /api/tasks/:id`
returns the full trail; the weekly report includes a digest. Format spec:
`docs/audit-log-format.md` (written at Phase 1).

## 10. Phase roadmap (confirm each before next)

| Phase | Deliverable | Notes |
|---|---|---|
| 0 | this plan | awaiting approval |
| 1 | API core: env, SQLite, Employee/Task CRUD, LLMProvider (both backends), queue + worker, chat endpoint, Vitest | no browser yet |
| 2 | BrowserTool: Playwright + page-agent injection, safety, approval gate, screenshots | page-agent spike first |
| 3 | Dashboard: Team / Employee Detail / Tasks / Reports (PDF) / Settings, dark Tailwind UI | kiraai.vn studied for layout, assets not copied |
| 4 | "Private Data Clerk" template + `npm run hire data-clerk` | end-to-end demo |
| 5 | docker-compose (api, freellmapi, n8n, optional colibri), README cloud/private paths, .env.example | final packaging |

## 11. Risks & honest caveats

1. **page-agent is in-page JS** — we build the headless wrapper around it (small, but it
   is our code, not a library feature).
2. **Small local models vs GUI tool-calling** — OLMoE 7B may be unreliable at page-agent's
   tool loop; browser tasks default to cloud backend, local preferred for chat/summarize.
3. **Confirm-before-submit interception** — exact Playwright mechanism needs a Phase 2
   spike; risk is low but not zero.
4. **FreeLLMAPI license scope** — its README states "Personal experimentation only";
   client deployments need a compliance check before selling throughput on it. Flagged,
   not solved here.
5. **Vercel free tier hosts the dashboard only** — the API (browsers + SQLite) is
   self-hosted by design; README will say so explicitly.

## 12. Decisions needed before Phase 1

1. **Workspace location**: new directory `consentark/` inside this workspace (recommended
   — clean monorepo root next to the QA project), or a separate folder/repo?
2. **Fastify vs Express** — recommend Fastify (schema validation, fast, good DX).
3. **Queue default** — in-memory + SQLite (recommended) with the BullMQ adapter added
   only when Redis is actually available?
4. **LLM proxy mode for page-agent** (audit-grade) — build in Phase 2? (recommended yes)
