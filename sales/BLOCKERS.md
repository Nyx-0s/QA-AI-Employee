# BLOCKERS — the only things waiting on the operator

**Evidence format, final (operator-ratified 2026-09-18):** the processor's
validated schema — `company`, `draft file`, `sent date`, `message-id`,
`forwarded header / sent-item paste` — and the **+5 business day** nudge rule
are the only accepted format everywhere. The earlier spec fields (`draft_id`,
`recipient`, `sent_at`, `sent_folder_ref`, `nudge_due +4`) are **superseded**;
blocks using them are rejected as malformed. See
`sales/operator-runbook-approve-send.md`.

Nothing on this list may be attempted by the agent; nothing here is silently
dropped. Everything else is done and validated (see sales/summary-2026-09-16.md,
third edition). This file is the single source of truth for human-side gaps.

**Autopilot (armed 2026-09-18, Path B):** the transport is built, offline-tested
(8/8 selftest), and wired to the evidence processor. The moment the operator
provides Path B credentials (`CA_SMTP_HOST` / `CA_SMTP_PORT` / `CA_SMTP_USER` /
`CA_SMTP_PASS` / `CA_SMTP_FROM` / `CA_TEST_TO` — app password via
myaccount.google.com → Security → App passwords; values land in `.env` or env,
never printed), `node sales/send-transport.mjs --test` verifies delivery, and
`node sales/send-transport.mjs --send-batch 1` executes the staged
`sales/batch1-send-plan.json` (top 5 email-eligible drafts) end to end: sends,
evidence blocks, processor flips DRAFT→SENT, +5-business-day nudge dates,
archives, audit log — one motion, zero manual steps after the paste.
Batch 2 is pre-staged the same way (`sales/batch2-send-plan.json`: Dutch Craft
Furniture, Mel & Mary's Cottages, Miller's Dry Goods, Murr Printing, The Barn
Inn — disjoint from batch 1, all verified PENDING on disk); fires with
`--send-batch --batch 2` after batch 1's replies are reviewed.

## B1 — Send evidence (unblocks: first SENT rows, nudge calendar population)

**What's blocked:** all 14 ledger rows sit at DRAFTED/PENDING; the pipeline's
first non-zero send count.

**Unblocking step (yours):**
1. Open any draft in `outreach/drafts/` (38 choices, all ≤90 words,
   quality-checked), copy its subject + body, and send it from your own
   mail client to the public channel in the draft header.
   **Do NOT edit the draft file** — its `APPROVAL: PENDING` line is the
   gate state the processor validates against; the processor flips both
   the ledger row and the draft to APPROVED itself when evidence lands.
   (2026-09-18 correction: this step previously told the operator to flip
   the draft manually, which would make the processor reject the evidence.)
2. Paste this block into chat, filled:
   ```
   company: <exact prospect name from the ledger row>
   draft file: <2026-09-17-the-barn-inn.md>
   sent date: <YYYY-MM-DD>
   message-id: <from your sent items>
   forwarded header / sent-item paste: <paste the forwarded header or sent-item here>
   ```
   One block per draft. (Template also in the ledger's process notes.)
3. The ingestion (`sales/send-evidence-processor.mjs`, selftest green) does
   the rest: row → SENT with nudge due, draft → APPROVED + SENT line,
   evidence archived, audit line logged.

## B2 — Cloud LLM key (unblocks: tracker employee's chat backend, real-model probe)

**What's blocked:** the `sales-tracker` employee's chat tasks cannot execute;
the Phase-2 real-model probe stays "not run". The agent cannot create
credentials — this stays yours.

**Unblocking step (yours, config-only — code changes are neither needed nor
allowed for this):**
1. Paste your FreeLLMAPI key onto the existing `FREELLMAPI_KEY=` line in
   `consentark/.env` — line 4 of the current minimal 6-var file. (2026-09-17
   correction: the old ~40-line template with the "paste key here" marker at
   line ~40 no longer exists — it was replaced by a minimal dev `.env` during
   Phase-5 testing. An earlier paste attempt left the value empty; keycheck
   exit 2 confirmed NO KEY at 02:0x.)
2. Make sure `FREELLMAPI_URL` points at a live endpoint. Current value is
   `http://localhost:3001/v1`, which expects the self-hosted FreeLLMAPI
   compose service — start it with
   `docker compose --profile freellmapi up -d freellmapi` (it maps host port
   3001 and is NOT running as of 2026-09-17). For a hosted/cloud endpoint
   instead, set `FREELLMAPI_URL=https://<your-endpoint>/v1`.
3. Verify: from `consentark/`, run
   ```
   node apps/api/dist/cli/keycheck.js
   ```
   Exit 0 + "PASS" = key valid and provider reachable; the integration path
   is already mock-proven (MOCK PASS). Config-only is hash-proven: adding a
   key to `.env` leaves src/dist code hashes identical.
3. Say the word — the tracker's first real chat task and, if desired, the
   real-model probe (payload already staged) run next.

## Nothing else is blocked

- Discovery: unblocked (chamber/tourism sitemap method works without a search
  API; search API outage no longer matters).
- Replies/objections/meetings: not blocked — schemas pre-built in the ledger;
  they process the moment real text arrives.
- Quality gate: all 14 drafts pass 14/14; the gate itself needs nothing.

*Last updated: 2026-09-17, keycheck-failure diagnosis session.*
