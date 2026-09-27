# Data handling — the one-pager we hand to cautious customers

*Plain-English commitments, all enforced by mechanisms rather than trust.
For anything a customer's counsel asks about that isn't here: answer
"let me confirm in writing" and record it — never improvise.*

---

## Where your data lives

- In a **sealed appliance** on hardware you control: one container, one
  data volume, one customer. The volume is your entire employee's world.
- We do not operate a multi-tenant cloud. There is no ConsentArk database
  with your records in it, because there is no ConsentArk database.

## What we can see, and when

- During setup and supervision, through logged channels that are part of
  your audit trail: the configuration, the gate queue, the trail itself.
- The model provider processes prompts in the course of the employee's
  work; where you supply your own key, that relationship is directly yours
  and we never hold it. *(Provider-specific retention terms to be confirmed
  in writing per deployment.)*
- Anything outside the job description's scope isn't reachable: the
  allowlist is enforced at run time, not by policy.

## What we never do

- Never use your data to train models, benchmark, or build case studies
  without written permission (anonymized if you prefer).
- Never move your data off the appliance except an export you asked for.
- Never let the employee transmit anything on its own — the gate and the
  drafts-only rule are structural.
- Never keep a copy after offboarding. We hand over the volume, delete our
  staging artifacts, and confirm the deletion in writing.

## The employee's own rules (structural, not contractual)

1. **Allowlist** — only the domains named in your job description.
2. **Consent gate** — every submission, booking, and outbound message stops
   and waits for a human click. There is no auto-approve.
3. **Audit trail** — every step, timestamped, plain English, owned by you,
   exportable at any time.

## If something goes wrong

The trail answers first: what happened, when, on which step. You get root
cause and the fix in plain English. Because the gate blocks unapproved
commits, the damage classes that need a lawyer usually can't occur — and
when they could, the trail shows the decision point and who clicked.

## Offboarding, in one line

We stop the appliance, hand you the volume (your records, complete),
delete everything on our side, and confirm it in writing — usually the
same day.
