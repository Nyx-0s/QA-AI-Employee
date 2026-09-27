# ConsentArk — the pipeline that sells it, running itself

*As of 2026-09-20, close of discovery session 10. Every number below is
traceable to `sales/discovery-log.md`, `sales/audit-log.md`, and the
`sales/ledger.md` rows they describe.*

This document has one claim: **an AI employee can take over a small
business's repetitive intake work, honestly and auditably.** The proof is
not a demo video — it is the operating record of the pipeline that produced
this document, every number traceable to a timestamped log line.

## What this pipeline actually did

**Fourteen real outreach emails went out** across three batches — five from
the operator's own mailbox (2026-09-19), nine through the business SMTP
transport with a two-step send interlock (2026-09-20). Each send produced a
runbook-format evidence block, archived the moment it was accepted
(`sales/evidence-auto/`), and flipped its ledger row DRAFT → SENT in the
same motion. Follow-up dates compute as +5 business days; the daily battery
watches every one.

**Fifty-three qualified prospects stand behind those sends and the next
three staged batches** — every one verified on their own website, every
pain point a verbatim quote with a cited source page, across **10 discovery
sessions** in northern Ohio: Holmes, Wayne, Stark, and Tuscarawas counties.

**The self-audit has caught itself.** Every session closes by re-fetching
every quote it cited. Lifetime record: **52 quotes re-verified, 1 failure —
and that failure (a florist whose quoted line vanished from its page between
fetches) was quarantined by the audit itself, stamped never-sent, before
anyone could act on it.** One further row was cut on fit grounds (a retailer
with no custom-order flow at all). The audit bites its own output; that is
the point of it.

**Rejections outnumber verifications roughly 3–4:1.** The last three
sessions alone parked 37 candidates with logged reasons: bot walls, 403s,
TLS certificate errors never worked around, sites that publish no email,
quotes that only existed in snippets. 10 fenced, 53 admitted. The bar is
evidence, not enthusiasm.

**Placeholder and invalid evidence blocks have been rejected outright,
every time** — zero rows have ever moved on evidence that didn't check out.
The system's most consistent behavior is refusing to count things that
didn't happen.

**A nine-point mechanical battery runs on every audit** — drafts vs ledger
vs evidence archives vs summary vs the send-transport's own CLI contract —
all green as of this writing, with every historical drift caught and
corrected in-session by the checks themselves.

## What ConsentArk would do for you

Exactly what it does here, pointed at *your* intake: a booking that arrives
by phone, a vendor application on a paper form, a custom order taken over
email. The employee gathers it, organizes it, and **pauses for a human
click before anything is submitted** — with a full audit trail of every
step, like the one you just read.

## Honest limitations

- The assistant's own chat tasks currently run on a scripted mock backend —
  live-tracker pending API key. Config-only swap when it arrives.
- Zero verified replies so far; the 2026-09-25 follow-up gate is armed and
  nothing auto-sends. Empty is reported as empty.
- The business transport is in its warm-up window; deliverability facts and
  the custom-domain fallback are documented, not hidden
  (`sales/deliverability-baseline.md`).

---
*Every number in this document is computed from the logs and verified by
`sales/pipeline-tick.mjs` (9/9 green at writing). Ask to see the logs —
they are the product.*
