# The ConsentArk philosophy

*What we believe, what we refuse, and why the constraints are the product.
Public version lives on the website (`startup-kit/site/philosophy.html`);
this is the internal, operational version.*

---

## The one sentence

**The employee asks. You decide. Everything is written down.**

Every product decision, price, sales message, and ritual must be able to
trace back to this sentence. If a feature would require breaking it, the
feature is rejected — no matter how much revenue it might add.

## The six principles, operationally

### 1 · Consent before action

**Claim:** the AI pauses for human approval before anything is committed.

**In the product:** the consent gate parks every form submission, booking,
and outbound message; one operator click resumes it. There is no
"auto-approve" toggle, and there never will be.

**In the business:** we never commit a customer to anything without their
explicit yes — no sneak renewals, no "your pilot converts automatically,"
no pre-checked boxes anywhere.

### 2 · Everything is written down

**Claim:** every step lands in a timestamped, plain-English audit trail.

**In the product:** the audit log is the spine, not an admin afterthought.
The dashboard reads it; the demo's final beat replays it.

**In the business:** `sales/audit-log.md` is append-only. Ledger counts are
reconciled by script, never hand-edited (`node sales/audit-outreach.mjs`
must print 0 problems before any send). Our own numbers get the same
receipts we sell.

### 3 · Your data stays in your box

**Claim:** the employee runs in a sealed appliance on hardware you control.

**In the product:** one container, one named data volume, one customer.
Offboarding hands the volume over; nothing of the customer's remains
anywhere else.

**In the business:** we do not build a multi-tenant cloud. We never ask for
more access than the job needs, and we say no to work that would require it.

### 4 · Drafts only, always

**Claim:** nothing sends without a human pressing send.

**In the product:** the Outreach Assistant produces drafts; the transport
refuses to act without explicit arming (`CA_SEND_ARMED=1`) and an
operator gate (`NUDGE-GATE`, `APPROVAL: PENDING` → GO). The DNC list is
enforced in code, pre-SMTP.

**In the business:** our own outreach runs through the same gated pipeline
we sell. If we wouldn't accept the mechanism, we don't use it on prospects.

### 5 · Evidence or silence

**Claim:** we don't say anything we can't show.

**In the product:** findings reports carry evidence (screenshots, replayed
steps), never adjectives.

**In the business:** rule zero — never fabricate an outcome. Numbers come
from the ledger; claims unblock only on real-model proof
(`consentark/docs/real-model-findings.md`). An empty result is reported as
empty.

### 6 · Small on purpose

**Claim:** few roles, few customers, deep supervision.

**In the product:** the workforce is a short list of roles that genuinely
ship, not a roadmap of everything.

**In the business:** no self-serve signup, no marketing funnels beyond the
site, no scaling talk before the founding five exist. Growth follows proof.

## The iron rule (dogfood gate)

**A template is sold only after it has done the work for us — on our own
operations — and passed a run on a real model.**

This is why the catalog is short and why every "shipped" badge on the site
is true. The trust story depends on it; there are no exceptions, including
for us.

## What we refuse (the non-negotiable list)

- Auto-approve anything, even "just this once."
- Meter or surveil beyond the audit trail the customer owns.
- Hold customer data anywhere but the customer's appliance.
- Sell a role that hasn't passed the dogfood gate.
- Send anything without a human press of send — ours or theirs.
- Claim an outcome we haven't logged.

## Language we use (and don't)

**Use:** hire, employee, works for you, asks permission, shows receipts,
plain English, sealed, proof, pilot, retainer.
**Avoid:** users, resources, automation magic, hands-free, fully autonomous,
set-and-forget, AI-powered (as a claim), revolutionize.

## How this stays true

The philosophy is enforced by mechanisms, not memos: the gate, the trail,
the armed-transport flags, the audit scripts, the dogfood rule, and the
runbooks that assume nothing. If a mechanism and a shortcut ever conflict,
the mechanism wins — that preference **is** the company.
