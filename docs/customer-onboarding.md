# Customer onboarding runbook

*Exactly what happens between "yes, do the pilot" and "your employee is
working." The operator's checklist; also the source of truth for what we
promise the customer will experience. Companion to
`docs/pilot-agreement-skeleton.md` and `sales/offer-sheet.md`.*

---

## Phase 0 · Kickoff (30 minutes, video or in person)

**Goal:** fill Appendix A (the job description) together.

1. Ask the customer to show (not describe) the repetitive work: the
   spreadsheet, the inbox, the form. Watch it done once.
2. Write the job description in their words: what the employee reads, where
   it acts, what it must ask permission for, what "done" looks like.
3. Agree the allowlist explicitly — domains only, no "and wherever else."
4. Book the daily 5-minute gate window (when they'll approve parked
   submissions) for pilot days 1–7.
5. Send same day: the offer sheet + agreement skeleton with Appendix A
   filled. Signature not required to start the pilot — the audit trail
   starts regardless.

**Operator prep (same day):**

```bash
cd consentark
./scripts/deploy-pilot.sh <customer-slug>   # stages pilots/<slug>/
# paste key into pilots/<slug>/.env, then start per printed commands
```

- Configure: allowlist, consent gate ON, scheduler (if in scope), dashboard
  token for the customer's gate window.
- Seed the first real task list from what you watched.
- Verify the audit trail writes from step one (`docs/real-model-findings.md`
  discipline: no claims before a real pass).

## Phase 1 · Days 1–2 · Supervised start

- Operator watches the first runs end-to-end; customer watches the
  dashboard, not the plumbing.
- Every parked submission is approved (or declined) during the agreed
  window; each decision lands in the trail with the customer's name on it.
- Daily 3-line message to the customer: what it did, what it asked, what's
  queued. Evidence links, no adjectives.

## Phase 2 · Days 3–5 · Steady state

- Scheduler takes over the morning runs (if in scope); operator checks the
  health view once daily.
- Customer now approves at the gate unassisted; operator available by reply.
- Mid-pilot note (day 4): hours-saved readout from the trail, in their
  numbers. This becomes the conversion case — or the honest reason to stop.

## Phase 3 · Days 6–7 · The decision

- Day 6: full audit replay with the customer (the demo's Beat 5, but their
  real work).
- Day 7: two options only — convert (setup + retainer per sheet; founding
  terms if still open) or stop (appliance wound down, volume handed over,
  records theirs).
- Either way: ask what the employee should have done better. Log it in the
  audit log; it feeds the workflow fixes, not the pitch.

## Phase 4 · Conversion (if yes)

1. Invoice setup; first monthly in advance (quoting rules:
   `docs/pricing-model.md` §Quoting).
2. Rate lock and testimonial consent (if founding) into Appendix B, in
   writing.
3. Cadence moves to the operating rhythm: monthly evidence summary, gate
   support by reply, quarterly workflow review.
4. Add the customer to the ledger's customer section; pipeline row closed
   as WON with evidence links.

## Standing rules during any pilot

- The consent gate never turns off, even "just for a day."
- Nothing the employee drafts ever sends itself.
- The customer's data never leaves their appliance.
- Every number we quote the customer comes from their trail.
- If the workflow is wrong, we fix the workflow — never the pitch.
