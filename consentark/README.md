# ConsentArk — AI Workforce

ConsentArk delivers **AI Employees** — role-based autonomous workers with a defined job, an LLM brain, and real browser hands — to small businesses. Every employee operates inside explicit grants (tools, URL allowlists, step caps) and pauses for **human approval before any form submission**. Every action it takes lands in a plain-language, timestamped audit trail an operator can replay in the supervisor dashboard.

## Quickstart

```bash
cp .env.example .env          # then edit (at minimum: set ADMIN_TOKEN or leave unset to auto-generate)
docker compose up --build -d  # app container + data volume
docker compose logs app | grep "OPERATOR TOKEN"   # first boot prints it ONCE (also in ./data/operator-token inside the container, mode 600)
open http://localhost:4000    # dashboard served by the API itself
```

Hire your first employee (inside the container):

```bash
docker compose exec app node dist/cli/hire.js --template data-clerk --allowlist "example.com"
# → prints the employee id + hiring token ONCE
docker compose exec app node dist/cli/work.js --token <the token>   # watch it work
```

Catalog templates (`--template <alias>`): **data-clerk** (flagship),
**qa-analyst**, **outreach-assistant** — all consent-gate ON by default.
Add `--schedule-cron "0 8 * * 1-5" --schedule-task "…"` for recurring runs.

Development (no Docker): `pnpm install && pnpm build && pnpm dev` (API on :4000, dashboard on :5173 with `pnpm dev:dashboard`).

## Security model (the short version)

- **Two credential tiers.** Operators hold one revocable token (env override or auto-generated at first boot — printed once, stored as sha256, persisted `chmod 600` under `DATA_DIR/operator-token`). Employees hold per-employee hiring tokens, hashed at rest, scoped to `/api/employee/*` and to **their own rows only**.
- **Consent gate.** With `confirmBeforeSubmit` on, every form submission — clicks, typed newlines, Enter keys, page-JS clicks, same-origin iframes — is intercepted; the task parks in `awaiting_approval` until a human decides. Submit-like clicks are detected by structure (type=submit/image) plus text heuristics.
- **Allowlists + grants.** Employees browse only inside their hostname allowlist (dot-boundary suffix match, hostname-only — enforced at enqueue, at navigation, and in the browser routing layer) and only use granted tools (`chat_task`, `browser_task`), re-checked at execution time.
- **Audit.** Every AI decision, browser step, gate trip, and token (usage, latency, model) is a human-readable line in `task_logs`, surfaced in the dashboard.

## What this is NOT

- **No real-model validation yet.** Every browser-task test runs against a scripted mock LLM; the FreeLLMAPI probe has not been run because no API key has been available in this environment. See `docs/real-model-findings.md` — until a key run happens, claims about what models do inside the agent loop are unverified, not proven.
- **`form.submit()` is an accepted risk.** Page-level JS calling `form.submit()` bypasses the click/Enter interception. Documented in `docs/PHASE2-notes.md` §1c with the rationale: the threat model is model error, not a malicious page. Structural submit detection is partially covered (submit-button interception); full coverage would require a navigation-level layer.
- **SQLite is single-node.** The data volume is the whole durability story: one writer, WAL mode, restart recovery re-queues interrupted tasks. There is no clustering, no horizontal scale, no external DB. This is a small-business appliance, not a cloud platform.
- **Scheduling ships, appliance-scale.** Active employees with a `schedule` get `scheduled` tasks from a 60s cron tick (dedupe-guarded, minute precision, server-local time). No distributed scheduling, no catch-up of missed runs — a small-business appliance, not a datacenter.
- **The LLM backends are yours to provide.** ConsentArk does not bundle model providers; it points at FreeLLMAPI (cloud) or Colibrì (local). No key = browser tasks fail honestly at the first model call.

## Environment

Every variable in `.env.example` is documented inline. Minimum to boot: none — the operator credential auto-generates on first boot. For cloud inference set `FREELLMAPI_URL` + `FREELLMAPI_KEY`; for local/private inference point `COLIBRI_URL` at your `coli serve` endpoint.

## Docs

- `docs/PHASE0-architecture.md` — plan (0–4 approved)
- `docs/spike-findings.md`, `docs/PHASE2-notes.md` — browser hands + consent gate hardening
- `docs/PHASE3-notes.md`, `docs/PHASE4-notes.md` — dashboard, hire flow + scoping
- `docs/PHASE5-notes.md` — operator auth, packaging, runbook
- `docs/real-model-findings.md` — what is (not) proven with a real model
- `../startup-kit/README.md` — the business runbook: catalog gates, pricing, pilot deployment, 10-day plan
- `../sales/demo-script.md`, `../sales/offer-sheet.md` — the 15-minute demo and the offer
- `scripts/deploy-pilot.sh` — one isolated appliance per pilot customer
- `../scripts/generate-qa-report.mjs` — free prospect QA report (`npm run qa:report -- <url>` at the repo root)
