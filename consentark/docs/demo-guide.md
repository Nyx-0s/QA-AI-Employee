# Demo guide — the consent loop, live

**Role:** demo guide. Every claim below is anchored in something the
prospect watches happen on screen. The walkthrough is verified working on
the composed stack (last full run: 2026-09-16, task `tsk_pA9bIM8iHMT1`,
hire → enqueue → gate trip → approve → `done`).

## Before every demo: deterministic reset (non-negotiable)

The app container outlives exec'd helper daemons, and a stale mock-LLM
daemon silently "completes" tasks **without tripping the gate** (its script
counter is exhausted). That failure mode looks like the product breaking —
in front of a prospect it is fatal. So:

```bash
node apps/api/scripts/dev/demo-daemon.mjs   # restarts container, starts mock LLM + demo pages, waits for READY
```

Then confirm `curl localhost:4000/api/health` returns `"ok": true`. Never
skip this. (Pattern documented in PHASE5-notes §4.)

## The loop — five beats, each anchored on screen

**Beat 1 — Hire (30s).** Run the hire command live; the operator watches a
scoped credential being born:

```
docker compose exec app node dist/cli/hire.js --name Demo-Clerk \
  --tools browser_task --allowlist 127.0.0.1,localhost --confirm \
  --backend cloud --system-prompt "You are a meticulous data clerk"
```

Say: "The employee exists the moment we define it — browser access, two
domains on the allowlist, human approval before *every* form submission.
The token prints once; we store only its sha256 — the server itself can't
leak what it never kept."

**Beat 2 — Enqueue (15s).** Paste the order task through the employee's own
token: `"Fill the order form with Arc Widget x2 for grace@navy.mil and
submit it."` → 202, `queued`. Optional proof beat: replay with
`http://malicious-site.example/checkout` → watch the API refuse it —
`403 domain_not_allowed`. "The allowlist isn't a policy document; it's
enforced at the door."

**Beat 3 — Gate trips (the moment).** Switch to the dashboard. The task
card flips to **awaiting_approval** with the ApprovalRequest:
`About to submit via click: "Place order" on button#place-order[submit] —
awaiting human approval.` Pause here. "Watch the gate trip live: it filled
the form, moved to the submit button, and stopped. The click hasn't
happened. A screenshot was taken. The audit trail shows every model call
and every browser step that led here."

**Beat 4 — Human decides.** Two-step Approve (arm → confirm — "approve is
the dangerous direction, so it takes two clicks; cancel takes one").
Say: "If this were a real order and something looked wrong — wrong price,
wrong address — this is where the human says no."

**Beat 5 — Completion + audit.** Status → done; open the audit timeline:
system (queue/start) → llm (model, latency, chars sent) → browser (each
step) → safety (gate trip, human approval, resume) with the output and
screenshots. "This trail is the receipt. It exists for every task, not
just the ones that tripped the gate."

## Talk track (60-second version)

"ConsentArk is an appliance you run — an AI employee with a defined job,
an allowlist, and a hard rule: it cannot submit a form without a human
clicking yes. Let me show you that rule working, live."

## Honesty rules (verbatim, no improvisation)

- **Customers/traction:** "We're pre-revenue with a working product —
  that's why the demo is live, not a slide."
- **Limitations — volunteer BEFORE being asked twice:** no real-model
  validation yet (today's scripted brain is a stand-in for your LLM of
  choice); browser tasks are single-node SQLite; `form.submit()`-from-page-JS
  is a documented accepted risk (threat model = model error, not malicious
  pages); scheduling isn't shipped. (README "What this is NOT".)
- The demo uses a **scripted mock LLM**, not a live model — say it in
  Beat 3, not when caught. The gate, allowlist, and audit trail in view
  are the production code paths.

## Objection log (append every question the guide can't answer)

| Date | Question | Where it came from | Status |
| --- | --- | --- | --- |
| — | — | — | — |

**Rule:** pricing, timelines, custom features → "That's a fair ask — I'll
take it back to the team and come back to you with a straight answer."
Log it here; never promise on the spot. Request approval before committing
to anything.
