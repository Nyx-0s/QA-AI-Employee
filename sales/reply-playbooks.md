# Reply-handling playbooks (written 2026-09-24)

Ready human-response templates for the most likely reply types, wired into the
existing system of record. The ledger's classification rules (in
`sales/ledger.md`, "Classification rules") are canonical — these playbooks
implement them so a reply can be processed completely in one session:

> classify → log → cancel the nudge → draft the response → operator go.

Nothing auto-sends. Every response is a draft at `APPROVAL: PENDING` until the
operator approves; sends go through the same transport/gates as everything else.

---

## The universal procedure (every reply, no exceptions)

1. **Evidence first.** Fill the reply-evidence template and append it to
   `sales/reply-log.md` (append-only archive, created with this playbook):

   ```
   company: <exact name from the ledger row>
   received date: <YYYY-MM-DD>
   reply verbatim: "<paste the full reply here>"
   channel: <email reply | phone note | form response>
   ```

2. **Classify** per the playbook table below. Record the reply IN the row's
   evidence and next-action cells (reply date, classification, verbatim-text
   pointer to `sales/reply-log.md`) — but **leave the `SENT —` status tag and
   the status cell's SENT token in place**: the send is historical fact, and
   the battery's counters (tick 8's summary count, precompute eligibility)
   key off those tokens. Verified by dry run 2026-09-24. Objections are also
   logged verbatim in the row's objection field and the weekly summary
   top-three.
3. **Cancel that row's nudge.** Flip the staged nudge file's gate line to:

   ```
   NUDGE-GATE: CANCELLED <date> — reply received (evidence: sales/reply-log.md)
   ```

   The transport lists CANCELLED files among its HOLDs and skips them; a
   cancelled nudge can never fire. Do NOT stamp `SENT` — that token means
   "sent, message-id archived" and would poison the audit.
4. **Draft the response** from the matching playbook →
   `outreach/drafts/YYYY-MM-DD-reply-<slug>.md` (the `reply-` naming is load-
   bearing: `pipeline-tick` counts response drafts separately), header
   `**Draft type:** reply response`, `APPROVAL: PENDING`. Then write that
   exact filename into the reply-log entry's `response draft:` line — battery
   check 7b links entry ↔ draft by filename (dry-run verified 2026-09-24).
5. **Operator reviews** the draft; on approval it becomes sendable like any
   other draft (mail client, or the transport on explicit go). A reply to our
   reply re-enters this procedure at step 1.
6. **Keep the battery green.** `node sales/pipeline-tick.mjs` must end ALL
   GREEN after processing any reply — it now understands reply states (see
   "System wiring" at the bottom).

## House style for every response (enforced by review)

- ≤90 words in the body; plain-ASCII subject (the transport rejects non-ASCII
  subjects — no em-dashes, no curly quotes).
- Named greeting only if the name is verified on their site (owner-name rule,
  `outreach/research/reformat-standard.md`); otherwise "Hello,".
- Sign-off block exactly:

  ```
  Thanks for your time,
  ConsentArk
  consentarkhe@gmail.com
  ```

- Rule zero applies: cite only what we can verify. Real-model status is stated
  honestly if it comes up ("running on a scripted demo backend today; a real
  model is the operator's next unblock" — never claim otherwise).
- One ask per email. Never pitch a second thing in a reply response.

---

## PB-1 — INTERESTED

**Classify:** `MEETING-SET` if the reply proposes or confirms a concrete time
(log the meeting date on the row); otherwise `REPLIED` with an interested tag.

### PB-1a — they proposed a time (→ MEETING-SET)

```
**Subject:** Confirmed - <day> at <time>

<Named greeting or Hello>,

<Day> at <time> works - calendar invite is on its way from consentarkhe@gmail.com.

For the 15 minutes: I will show the intake employee working on <their actual
intake flow from the draft>, the pause-and-ask moment before anything submits,
and the audit trail afterward. Nothing to prepare on your side.

If the time needs to move, any slot that week is fine.

Thanks for your time,
ConsentArk
consentarkhe@gmail.com
```

Then: create the calendar invite (operator's mail client), note the meeting
date on the row, and add it to the weekly summary's meetings list.

### PB-1b — interested, no time proposed (→ REPLIED)

```
**Subject:** Happy to show you - two slots this week

<Named greeting or Hello>,

Glad this landed. Two slots that usually work: <day A> or <day B>, 15 minutes
on a call while I walk you through <their intake flow> handled by the
employee - including the moment it stops and asks before submitting.

If neither works, name two times and I will be there.

Thanks for your time,
ConsentArk
consentarkhe@gmail.com
```

## PB-2 — NOT NOW (timing objection)

**Classify:** `REPLIED`. Log the objection verbatim ("too busy until <x>",
"call me in <season>"). Nudge CANCELLED — a mechanical follow-up would prove
we didn't listen.

```
**Subject:** Understood - I will reach out <their horizon>

<Named greeting or Hello>,

Completely understood - <restate their reason in five words, e.g. "wedding
season has your hands full">. I will reach out <their stated horizon, e.g.
"after the first of the year">, and not before.

If anything changes on your end, this address reaches me directly.

Thanks for your time,
ConsentArk
consentarkhe@gmail.com
```

Then: record a **re-contact horizon** on the row (their stated date, not an
auto-scheduler). Re-contact on/after that date requires operator go; no nudge
file is staged for it.

## PB-3 — UNSUBSCRIBE / not interested (opt-out)

**Classify:** `CLOSED`. Opt-outs are honored **immediately and permanently** —
no nudge, no re-contact, ever. Response is one short, warm, pitch-free line.

```
**Subject:** Done - you will not hear from me again

<Named greeting or Hello>,

Done - I have removed you from our contact list, and you will not hear from
us again. If <their intake pain> ever becomes a priority, a plain email to
this address reaches a human.

Thanks for your time,
ConsentArk
consentarkhe@gmail.com
```

Then: add the email address to `sales/do-not-contact.md` (created with this
playbook) with the date and reply pointer; gate line CANCELLED; row CLOSED.
The response itself is courtesy only — send it once, then silence.

## PB-4 — WRONG PERSON / not my area

**Classify:** `REPLIED`. The goal is a warm handoff, not a workaround.

```
**Subject:** Thanks for pointing me right

<Named greeting or Hello>,

Thanks for the quick note - that is exactly the kind of reply that saves
everyone time. <If they named someone:> I will reach out to <name> and mention
you passed them my way. <If not:> If whoever handles <the intake area, e.g.
"online orders"> comes to mind, a name or a "forward this" works too.

Either way, thanks for the help.

Thanks for your time,
ConsentArk
consentarkhe@gmail.com
```

Then: if a named referral arrives, it becomes a **new intake** through
`sales/intake.md` (new row, fresh discovery, own gates) — never a hijack of
the existing row. The original row keeps its REPLIED status with a
"referred to <x>" note.

## PB-5 — OBJECTION (pricing / trust / "we already have a tool")

**Classify:** `REPLIED`. Objection text is logged verbatim on the row and in
the weekly summary's top-three — the objection is the product feedback.

```
**Subject:** Fair question, straight answer

<Named greeting or Hello>,

<One-sentence honest answer to the specific objection. House answers:
pricing - "$500 to deploy, $300 a month, and the free 7-day pilot exists
precisely so you can judge before any of that"; trust - "it only acts inside
domains you allowlist and pauses for a human click before anything submits;
the audit trail is the product"; already have a tool - "we are not replacing
your tool - the employee works the intake the tool leaves in your inbox."> 

If it is useful, 15 minutes answers the rest; if not, no hard feelings.

Thanks for your time,
ConsentArk
consentarkhe@gmail.com
```

Keep the honest-answer sentence short and concrete; never argue, never
discount on the spot (discounts are the operator's call, in person).

---

## System wiring (what makes these playbooks executable)

- **`sales/reply-log.md`** — append-only reply archive (same motion as the
  send/nudge evidence logs). Created with this playbook; schema at top.
- **`sales/do-not-contact.md`** — the permanent opt-out list. The transport
  and every future send path must refuse any address on it.
- **Reply drafts in `outreach/drafts/`** with `YYYY-MM-DD-reply-<slug>.md`
  naming — counted separately by `pipeline-tick.mjs` so the battery's
  files==rows invariant survives responses (check 4 now splits work drafts
  from reply drafts; check 5/7 count "sent-or-beyond" rows via their
  message-id evidence rather than the literal SENT token).
- **CANCELLED gate token** — recognized by the transport as a never-send
  state (it already skips everything that is not GO; CANCELLED makes the
  skip loud and self-documenting in the HOLD list).
- **`sales/audit-outreach.mjs`** is the pre-flight: after any reply session,
  it must still report 0 problems (it already ignores non-HOLD files when
  pairing due rows, so CANCELLED nudges do not count as missing coverage).

## Edge cases

- **Reply arrives before the nudge due date** → same procedure; the nudge is
  cancelled early. Early reply does NOT authorize early nudges for other rows.
- **Reply is only an autoreply/out-of-office** → not a reply. No
  classification, no nudge cancellation. Note the return date on the row's
  due cell as `OOO until <date>; nudge decision deferred`.
- **Bounce instead of reply** → do not classify as reply; log in the row,
  re-verify the address before any further contact (the Track B crawl rules
  for verification apply).
- **Threatening/legal language** → CLOSED, opt-out honored, forward to the
  operator immediately; no template response.
- **A reply arrives for a row whose nudge already fired** → same procedure;
  the *next* nudge (second-wave files exist for the 9/30 batch) gets the
  CANCELLED stamp instead.
