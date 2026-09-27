# Operator runbook — approve + send (one page)

**The 30-second version:** pick a draft → send it from your own mail client →
paste one filled evidence block. You never edit pipeline files; the agent never
sends mail. The gate stays a gate.

---

## 1. Send a draft

1. Open any draft in `outreach/drafts/` — all of them are ≤90 words,
   quality-checked, and marked `APPROVAL: PENDING`.
2. The draft header names the **public channel** (a public email address or a
   public contact form — never a DM) and carries the **Subject** line.
3. Copy the subject + body into **your own mail client** and send it.
4. **Do NOT edit the draft file.** `APPROVAL: PENDING` is the gate state the
   processor validates against — it flips both draft and ledger itself when
   evidence lands. (Editing it first makes the processor reject your evidence.)

## 2. The evidence block — what valid looks like

Paste in chat, all five fields, real values:

```
company: The Barn Inn Bed & Breakfast          ← EXACT name from the ledger row
draft file: 2026-09-17-the-barn-inn.md         ← that row's draft filename
sent date: 2026-09-18                           ← YYYY-MM-DD
message-id: <barn-001@mail.example>             ← from your sent items
forwarded header / sent-item paste: Received: from mail.example by mx; ...
```

- The **forwarded-header paste** may run multiple lines; everything after that
  line counts as evidence until the next `key:` line. It must be non-empty.
- One block per draft. Multiple sends = multiple blocks (or multiple pastes).

## 3. What happens after each paste

The agent runs `node sales/send-evidence-processor.mjs --apply --file <evidence.txt>`.
On success, in one atomic pass:

| # | artifact | change |
| --- | --- | --- |
| 1 | Ledger row | `DRAFTED → SENT`, approval `PENDING → APPROVED`, outcome → `SENT`, evidence cell gains **sent date + message-id**, next-action gains the nudge date |
| 2 | Nudge calendar | **nudge-due = sent + 5 business days** (weekends skipped — sent Fri 2026-09-18 → due Fri 2026-09-25; sent Sat → same Friday) |
| 3 | Draft file | `APPROVAL: PENDING → APPROVED` + a `**SENT:**` history line |
| 4 | `sales/send-evidence-log.md` | full evidence block archived (append-only) |
| 5 | `sales/discovery-log.md` | audit line for the transition |

The agent then reports the flip and re-runs the drift check
(ledger = drafts = nudge calendar). `sales/BLOCKERS.md` B1 shrinks by one.

## 4. Why a paste can bounce — all checked *before* any write

| rejection message | cause → fix |
| --- | --- |
| `no ledger row matches company` | name must match the ledger row exactly |
| `row references draft "X", evidence says "Y"` | use the filename from the row's draft cell |
| `row is …, not DRAFTED` / `draft is not APPROVAL: PENDING` | already sent (replay) or hand-edited — each draft sends once |
| `bad sent date` | use `YYYY-MM-DD` |
| `missing forwarded header / sent-item paste` | paste the sent item or header |
| template placeholders | fill every field — placeholders are rejected (2026-09-18 incident) |

**Nothing half-applies:** every check runs before the first write, so a
rejected block leaves ledger, drafts, and calendar byte-identical.

## 5. After SENT

- `NO-REPLY` is applied **only if** the nudge-due date passes with no reply —
  a separate, later step, never pre-assigned.
- A real reply: paste it verbatim → processed per `sales/reply-playbooks.md`
  (log in `sales/reply-log.md` → classify on the row → that row's staged nudge
  CANCELLED → response draft at `APPROVAL: PENDING` for you). Full procedure:
  Section 6 below.
- `CLOSED` / opt-out: honored immediately and permanently — no nudges, no
  re-contact, ever.

## 6. The Monday ritual (preflight → reply-check → gate flips → nudge wave)

The weekly motion, end to end. Same ritual at smaller scale on any nudge-due day.

**Step 0 — preflight (30 seconds, non-negotiable):**

```bash
node sales/audit-outreach.mjs
```

Must print `NO STRUCTURAL DRIFT FOUND — all cross-checks pass.` The audit
reconciles ledger ↔ send-evidence ↔ nudge-evidence ↔ staged nudge files ↔
parent drafts. A problem is drift caught *before* it can hurt: fix the files,
never the counts, then re-run until clean.

**Step 1 — the inbox paste.** Paste what's in the inbox, one line per sender
(`yvonne@whiteoakinn.com — reply: "…"` / `… — nothing`). A reply exists only
when its verbatim text is pasted, or the operator attests "nothing there" —
never assumed from silence. The paste is logged in the reply-check worksheet
(`sales/reply-check-<due-date>.md`) as the attestation record.

**Step 2 — real replies** (agent, per `sales/reply-playbooks.md`): for each —
log verbatim in `sales/reply-log.md` → classify on the row (the `SENT —` tag
stays; the send is historical fact) → that row's staged nudge gate becomes
`CANCELLED` (never fires) → response draft at `APPROVAL: PENDING` in
`outreach/drafts/YYYY-MM-DD-reply-<slug>.md` → battery stays green. You review
the response draft like any other (Section 1); nothing sends until you approve.

**Step 3 — the flip list.** Every no-reply row still due is presented with its
recipient and greeting. You decide **per row**; only rows you approve get their
nudge file's gate flipped `HOLD → GO <date>`.

**Step 4 — fire (two interlocks, explicit arming):**

```bash
CA_SEND_ARMED=1 node sales/send-transport.mjs --send-nudges
```

The transport sends ONLY files gated GO, archives fresh message-ids to the
nudge-evidence log, and stamps the gates cannot-resend. Any address on
`sales/do-not-contact.md` is refused automatically.

**Step 5 — close:** `node sales/pipeline-tick.mjs` must end `TICK: ALL GREEN`
and the Step-0 audit re-run must still report 0 problems. One line goes to
`sales/audit-log.md`: what was checked, what was cancelled, what fired.

*Early-fire note:* on a non-due day, Steps 0–2 apply as-is (classification and
cancellations are always valid), but gate flips require the explicit early-fire
override with the inbox attestation (precedent 2026-09-23).

*Processor guarantees verified from source (`sales/send-evidence-processor.mjs`,
selftest green) — this runbook documents behavior, not intention.*
