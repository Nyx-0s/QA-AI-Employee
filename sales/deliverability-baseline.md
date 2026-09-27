# Deliverability baseline — 2026-09-19 (read-only, no implementation)

## Where we stand (honest)

- **We send from `@gmail.com` shared infrastructure.** Reputation is
  **account-level**: what matters is this specific account's age, its send
  history, and its recipient engagement — not our domain, because we don't
  have one in the return path.
- **Test #1 hit spam.** Two contributors, logged: a brand-new business
  account with zero send history (cold start), and a machine-shaped message
  (timestamped subject, "operator" language). Test #2 used the human-shaped
  message; its inbox/spam result is the operator's check.
- **Warm-up is the main lever we hold.** Manual, ordinary, two-way email
  from the business account builds the account's own reputation. That is
  the operator's current protocol (3–5 real emails + replies this week).
- Volume context: our batches are 5 emails — far below any bulk-sender
  threshold. Volume is not our risk; **account trust** is.

## What a custom-domain fallback would require (research only — not implemented)

If test #3 still lands in spam, moving to `outreach@<yourdomain>.com` via
Google Workspace changes the trust model from "one new account's reputation"
to "your own domain's authentication," which is the durable fix.

1. **Domain.** Buy/own a domain (e.g. `consentark.com`) — ~$10–20/yr.
   *Setup time: minutes; propagation note below.*
2. **Google Workspace** on that domain ($7/user/mo, 14-day trial) →
   `outreach@consentark.com` mailbox. *Setup: ~30 min.*
3. **SPF** — one DNS TXT record: `v=spf1 include:_spf.google.com ~all`.
   *Setup: ~5 min + DNS propagation (minutes to 48h; usually <1h).*
4. **DKIM** — generate a 1024-bit+ key in the Workspace Admin console, add
   the TXT record Google gives you, turn DKIM on. *Setup: ~15 min + the
   same propagation window. Gmail requires 1024-bit minimum (2048
   recommended).*
5. **DMARC** — one DNS TXT record on `_dmarc.<domain>`, start in
   monitoring mode: `v=DMARC1; p=none; rua=mailto:you@<domain>`. *Setup:
   ~5 min.*
6. **Gmail sender-guideline compliance** (2026 rules): SPF+DKIM+DMARC with
   alignment is required for bulk senders (5,000+/day) and is best practice
   for everyone; keep spam-complaint rate under 0.3% (target 0.1%), honor
   unsubscribes within 2 days. At 5-email batches we are nowhere near the
   bulk thresholds — the value here is authentication and domain reputation.
7. **Realistic total: ~1–2 hours of setup** (mostly DNS propagation waiting)
   + ~$10–35/mo. Then the new domain account itself needs the **same
   warm-up** (a new domain has zero reputation either) — but it starts from
   authenticated, aligned mail, which is a categorically better floor.

## Decision framing (facts only)

| option | cost | time to better deliverability | risk |
| --- | --- | --- | --- |
| Stay on gmail.com + warm-up | $0 | days–weeks, gradual | account-level reputation only; shared infra |
| Custom domain + Workspace | ~$10–35/mo | ~1–2 h setup + own warm-up (days) | new-domain cold start, but authenticated from day 1 |

**No changes made.** This file exists so that if test #3 hits spam, the
decision is facts-first. Warm-up protocol remains the active lever this week.
