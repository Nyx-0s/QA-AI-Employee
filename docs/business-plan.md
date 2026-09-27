# ConsentArk — business plan

*Version 1.0 · 2026-09-24 · Founding cohort. Living document; every claim here
is evidence-backed and every evidence pointer exists in this repository.*

---

## 1. What the business is

**ConsentArk is an AI staffing agency.** Customers do not buy software —
they **hire AI employees**. We deploy the employee on infrastructure the
customer controls, configure its rules, and supervise it for a flat monthly
retainer. The employee works only inside domains the customer allowlists,
pauses for a human approval before any submission, and writes a plain-English
audit trail of every step.

One sentence: **the employee asks, you decide, everything is written down.**

The platform underneath (ConsentArk, in `consentark/`) is proven and running:
hiring flow, task scheduler, browser agent, consent gate, operator dashboard,
audit replay, per-customer sealed appliances, and a rehearsed public demo.

## 2. Why this business exists (the wedge)

Small businesses have repetitive digital work — re-typing bookings, re-checking
orders, chasing follow-ups. It is too repetitive for a person and too scattered
for off-the-shelf software. The AI industry's answer so far has been chatbots
and dashboards the owner must operate and trust blindly. ConsentArk inverts
that: the product **is** the trust structure — allowlist, approval gate,
audit trail — with the automation inside it.

We are not selling "AI." We are selling **an employee who can prove where it
worked, and who cannot commit anything without permission.**

## 3. The philosophy (summarized — full version: `docs/business-philosophy.md`)

Six principles govern product, sales, and operations:

1. **Consent before action** — approval gate on every submission, always.
2. **Everything is written down** — plain-English audit trail is the spine.
3. **Your data stays in your box** — sealed per-customer appliance; no cloud.
4. **Drafts only, always** — nothing sends without a human pressing send.
5. **Evidence or silence** — no claim without a reproducible receipt.
6. **Small on purpose** — few roles, few customers, deep supervision.

Plus the **iron rule**: no employee template is sold until it has done the
work for us (dogfood) and passed a real-model run.

## 4. The workforce (full catalog + gates: `startup-kit/README.md`)

| Employee | What it does | Status | Price (setup + monthly) |
| --- | --- | --- | --- |
| Data Clerk | Intake, re-keying, form entry with consent gate | ✅ shipped, flagship | $500 + $300/mo |
| QA Analyst | Phone-sized site walk, plain-English findings report | ✅ template shipped | $750 + $400/mo |
| Outreach Assistant | Evidence-based email drafts + follow-up tracking | ✅ template shipped | $500 + $300/mo |
| Scheduler | Daily scheduled runs (capability attached to any employee) | ✅ cron shipped | included |
| Evidence Clerk | Compliance paperwork assembly | in dogfood | by demand |
| Invoice / Review / Ledger clerks | Bookkeeping-adjacent work | by demand | by demand |

## 5. Business structure

- **Sole operator + agent systems** at founding; no payroll until 5+ paying
  customers (agent systems already do scheduling, drafting, QA, and
  bookkeeping drafts for us — we are our own customer zero).
- **Revenue model:** one-time setup fee (covers hiring/training) + flat
  monthly retainer (covers operation/supervision). No usage meters, no
  per-seat fees, no contract terms.
- **Delivery model:** one sealed appliance per customer on hardware the
  customer controls; one named data volume per customer is the customer's
  entire world. Offboarding = hand over the volume.
- **Entity form:** proprietorship or single-member LLC at founding; formalize
  (multi-member or S-corp election) only at recurring revenue that justifies
  it. *Legal and tax structure to be confirmed with a professional — this
  document describes intent, not advice.*

## 6. Pricing model (full rationale: `docs/pricing-model.md`)

**Fixed setup fee + monthly retainer.** The setup fee is the cost of hiring
(kickoff, configuration, appliance, training). The retainer is the cost of
the work (operation, supervision, upkeep). Deliberately rejected: usage
metering, per-seat, pay-per-outcome, self-serve tiers.

| | Setup | Monthly | Break-even vs. minimum wage* |
| --- | --- | --- | --- |
| Data Clerk | $500 | $300/mo | saves ~2.1 h/weekday |
| QA Analyst | $750 | $400/mo | one prevented booking fallout pays a year |
| Outreach Assistant | $500 | $300/mo | drafts the follow-ups nobody sends |

*Conservative illustrative framing for sales conversations; the audit trail
produces the customer's actual numbers during the pilot.

- **Free 7-day pilot** on the customer's real work — we set everything up.
- **30-day money-back guarantee** after conversion: if the employee doesn't
  clearly save hours, refund every dollar — the audit trail proves it either way.
- **Founding five:** setup waived + rate locked 12 months, for a candid
  testimonial and workflow reference (anonymized if preferred).

## 7. Market and motion

- **Customer:** small service businesses with repetitive intake/QA/follow-up
  work — inns, clinics, agencies, booking-driven shops. Local first.
- **Motion:** direct outreach (evidence-based drafts, ≤5/day warm-up rules),
  15-minute live demo, free 7-day pilot, convert. No paid acquisition, no
  self-serve funnel at founding.
- **Track B:** agencies and consultants who can resell or refer; QA reports
  as the free proof-of-work.
- **Demo assets:** always-on demo sandbox (runbook:
  `startup-kit/demo-sandbox-runbook.md`), rehearsed five-beat choreography,
  `sales/demo-script.md`.

## 8. Operating cadence

- **Daily (15 min):** preflight audit (`node sales/audit-outreach.mjs` →
  0 problems), reply-check, gated sends, log evidence.
- **Monday ritual:** approve-and-send runbook
  (`sales/operator-runbook-approve-send.md` §6).
- **Weekly:** pilot health review per customer from the audit trail; nudge
  waves per `sales/nudge-guard-protocol.md`.
- **Every claim:** recorded in `sales/audit-log.md` — append-only, the same
  discipline we sell.

## 9. Stage, milestones, and the honest scoreboard

**Stage now:** pre-revenue, pilot-ready. Product shipped; pipeline live.

| Milestone | Definition | State |
| --- | --- | --- |
| Product | suites green; sandbox rehearses 3× clean; appliance deploys | ✅ done |
| Pipeline | 70-row ledger, gated transport, DNC enforcement, reply playbooks | ✅ done |
| First pilot | 1 customer, 7 days, real work | ⬜ next |
| First conversion | pilot → paid retainer | ⬜ |
| Founding five | 5 paying customers, testimonials | ⬜ |
| Scale decision | raise setup price, add roles by demand | ⬜ |

**Deliberately not being done** (see `startup-kit/README.md`): self-serve
signup, multi-tenant cloud, marketing funnels, pay-per-outcome pricing,
employees 5+ before demand.

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Model provider pricing/quality shifts | cost is fixed per appliance; mock/deterministic mode keeps demos and tests honest |
| Deliverability (outreach) | SPF/DKIM baseline doc; ≤5/day warm-up; DNC list enforced in transport; drafts-only philosophy |
| Key-person dependency (operator) | every ritual documented; agent systems run the back office; runbooks are the business |
| Trust incident | audit trail + consent gate make incidents rare; appliance isolation makes them small; evidence-first response |
| Churn | 30-day guarantee forces value proof early; audit trail surfaces drift before the customer complains |

## 11. Financial shape (foundational unit economics)

Per Data Clerk customer at list price: **$500 setup + $300/mo.** Marginal
delivery cost is model usage inside the customer's appliance (their key or
metered pass-through at cost) plus supervision time that amortizes across
customers as rituals are already documented. Target shape: 5 founding
customers ≈ $1,500/mo recurring at near-zero fixed cost, with setup revenue
waived as the founding-cohort marketing spend it is.

*No revenue projections beyond this — the honest scoreboard in §9 is the
forecast until real numbers exist.*
