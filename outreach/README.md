# Outreach drafts — process and gate rules

**Role:** outreach drafter. Input: one prospect row per task (from sales
research). Output: one 90-word cold email draft, saved here, held at the
approval gate.

## The gate (mandatory, every draft)

1. Draft is saved as `drafts/YYYY-MM-DD-<company-slug>.md` in this folder.
2. Draft is presented to the operator with: prospect URL, the site-sourced
   pain quote (verbatim, with the page it came from), and the draft text.
3. **Nothing is ever sent, submitted, or posted by the agent.** There is no
   send path in this workflow at all — approval means "hold for human to
   send manually from the human's own mail client." The agent has no mail
   credentials, no form-submit tooling for outreach, and must never acquire
   them.
4. Every draft carries a status line: `APPROVAL: PENDING` →
   `APPROVAL: APPROVED (human initials/date)` → `SENT-BY-HUMAN (date)`.
   A draft never skips states.

## Draft rules (90 words, three sentences)

1. **One sentence proving we looked**: references something only visible on
   their actual site (a page, a policy, an offer, a stated process). No
   generic flattery.
2. **One sentence on ConsentArk** with a concrete example task drawn from
   *their* workflow (e.g., "retype every phone order into your invoice
   template"). One example, not a feature list.
3. **One low-commitment ask**: a 15-minute demo. No "buy now," no pricing,
   no limited-time anything.

**Tone constraints (hard rules):** no hype words (revolutionary,
game-changing, cutting-edge, supercharge, unleash); no fake urgency; no
claimed customers, case studies, or traction — ConsentArk has none yet, and
saying otherwise is fabrication. Product truth as of 2026-09: browser
employees exist and run against allowlisted sites with a human approval
gate before any form submission; no real-model validation yet (see
`consentark/docs/real-model-findings.md`) — drafts must not claim
production-proven reliability.

**Honesty constraint:** the pain quote must come from the prospect's own
site, verbatim, with its source page noted. If the site doesn't state a
pain, the draft says what we *observed* (e.g., "your order page lists a
phone number as the only ordering channel") rather than inventing their
frustration.

## Prospect row schema (input)

```
company: <name>            url: <site>          size: <verified or unverified>
does: <one line from their site>
task-for-consentark: <specific repetitive task, evidence-cited>
contact-channel: <public contact form URL or public LinkedIn page — never a DM>
verification: <verified | unverified>   gate-status: <none | approval-requested>
```

Rows marked `unverified` or `approval-requested` are not draftable until
resolved.
