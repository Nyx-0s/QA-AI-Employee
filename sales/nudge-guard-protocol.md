# Nudge due-date guard — protocol (written 2026-09-19, active)

**Applies to:** all 14 SENT rows (batches 1–3), nudge-due 2026-09-25.

## The check (runs on the normal daily audit schedule, starting 09-25)

For each SENT row, in order:

1. **Reply check first.** Was a reply received and logged? (Reply evidence =
   pasted reply text logged in `sales/reply-log.md` — never assumed from
   silence.)
   - **Reply exists** → nudge CANCELLED for that row (gate stamped
     CANCELLED, can never fire); the human-response draft is written to
     `outreach/drafts/` at `APPROVAL: PENDING` per the reply playbook for its
     type (`sales/reply-playbooks.md`) and shown to the operator with the
     reply text. Status: REPLIED (or classified per reply — MEETING-SET /
     CLOSED; opt-outs additionally go on `sales/do-not-contact.md`).
   - **No reply** → nudge HOLDS: the formatted draft in
     `outreach/nudges/2026-09-25-nudge-<slug>.md` stays ready.
2. **Nothing sends automatically.** The daily audit reports "NUDGE DUE" rows
   and stops there. Sending requires the operator's explicit go, per message,
   per the standing rule ("does NOT send until I give the go separately").
3. **The transport cannot fire a nudge on its own** — nudges are not in any
   batch plan file, and `--send-batch` only reads staged batch plans. Two
   independent structural barriers stand between the nudge drafts and SMTP.

## Transport nudge mode (built 2026-09-20) — how a go becomes a send

`--send-nudges` (in `sales/send-transport.mjs`) now sends nudges through the
business address — but ONLY under stacked gates, in this order:

1. `CA_SEND_ARMED=1` (the same process-level interlock as batches; refuses
   exit 2 without it).
2. **Per-file:** each nudge's `NUDGE-GATE:` line must read `GO <date>` —
   flipped only on your explicit per-row go ("nudge the Barn Inn, hold
   Country Coach"). The run lists every HOLD it skipped and refuses outright
   (exit 2) if zero files are gated GO.
3. **Pre-flight per GO nudge:** structurally complete, and its parent draft
   must exist and NOT still read `APPROVAL: PENDING` (drift guard: a nudge
   never fires for a row that may never have been sent).

On send, the same motion as batches: ratified evidence block archived to
`sales/nudge-evidence-auto/` + `sales/nudge-evidence-log.md`, ledger row
annotated `nudged <date>; next nudge due <+5 business days>`, gate line
stamped `NUDGE-GATE: SENT … cannot re-send` (re-runs can never double-send).

**Operator go procedure on 09-25:** reply-check first (paste replies; a reply
cancels that nudge — do not flip its gate). For each no-reply nudge you
approve, flip its gate line to `NUDGE-GATE: GO 2026-09-25`, then one command
fires all GO'd nudges:

    CA_SEND_ARMED=1 node sales/send-transport.mjs --send-nudges

Alternative unchanged: copy the nudge body from `outreach/nudges/` and send
from your own mail client — no gate flips needed for that path.

## Current state (updated 2026-09-20)

- 14 nudge drafts formatted to the approved standard, all `NUDGE-GATE: HOLD`
  (5 batch-1 written 2026-09-19; 9 batch-2/3 pre-written 2026-09-20 with their
  parents' real message-ids carried from `sales/send-evidence-log.md`).
- All 5 nudges reference the batch-1 recipients; the Country Coach nudge
  greets "Hello," (address is the owners' box; Sarah is referenced in third
  person — do not misaddress).
- Warm-up week: zero sends of any kind; the daily audit continues on
  schedule and will list due rows on 09-25.
- 2026-09-20: transport nudge mode built + pinned (25/25 CLI guard tests,
  wired into battery check 9); all 14 gates HOLD — nothing has fired.
- 2026-09-20 (later): the 9 batch-2/3 nudges pre-written; all 14 exist,
  all HOLD, word-count headers mechanically verified. Friday is gate-flips
  only: reply-check first, flip the approved ones to `GO 2026-09-25`, then
  one `--send-nudges` command (or the mail-client path).
- 2026-09-24: waves 2–3 (due 2026-09-28 and 2026-09-30) fully pre-staged.
  Ledger reconciliation found 20 missing files, now written: 6 batch-8
  first-nudges (Willow Haven Lodge, Century Farms, Rustic Ridge, Magnolia
  Spring Farm, Rivercrest Farm, Black Run Farms — sent 09-23, due 09-30) and
  14 second-nudges for the batch-1 rows nudged 09-23 (next due 09-30), each
  carrying the real original + first-nudge message-ids. All 45 due drafts
  (10 due 09-28, 35 due 09-30) mechanically audited: `NUDGE-GATE: HOLD` with
  correct due date, message-id tied to the ledger row, parent draft present
  and APPROVED, word counts verified ≤90. Nothing sends until the operator's
  per-row go; a logged reply still cancels its nudge.
