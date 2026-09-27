# The 15-minute demo — ConsentArk AI Employees

**Goal:** the prospect sees an AI employee do *their* kind of work, sees it
**stop and ask permission**, and sees the **audit trail**. Those three beats
are the whole company. Do not add features to the demo.

**Setup (before you leave the car / before the call):**
- `demo.c0nsen7.xyz` reachable, or the local stack on your laptop
  (`pnpm dev`, API :4000 + dashboard).
- A hired **Data Clerk** with the prospect's own website in its allowlist,
  consent gate ON.
- One prepared task that mirrors their workflow (you already have their
  pain quote from discovery — build the task around it).

---

## Beat 1 — the hire (2 min)

Open the dashboard. Say, in their language:

> "This is my staffing desk. I'm going to hire an employee for you right
> now. Watch the rules I give it: it may only touch **your** website, and
> before it ever submits a form, it has to come back and ask a human.
> That human would be you."

Hire (or show the already-hired employee). Point at the three settings:
allowlist (their site only), consent gate ON, step cap.

**Why they care:** "allowlist" = it can't wander. "Consent gate" = nothing
goes out without their click. Say those two sentences exactly.

## Beat 2 — the work (5 min)

Give the employee a task that is THEIR workflow, e.g.:

> "Read the custom-order form on their site and enter this sample order:
> [3 real fields from their form]. Fill it, then stop — the gate will ask."

Let it run. While it works, narrate:

- "It's reading the page like a person would."
- "Notice it's not guessing — it verifies the field before typing."
- If it's slow: "That's the caution. Speed costs accuracy; I chose accuracy."

## Beat 3 — the pause (4 min) ← the sale happens here

The task parks at `awaiting_approval`. The dashboard shows what it was
about to submit.

> "Right now, nothing has been sent. It filled the form and stopped. This
> is the moment you stay in control — every time. You approve, or you
> don't. Then click Approve and watch it finish."

Click Approve. Task completes.

## Beat 4 — the receipts (3 min)

Open the task's audit trail. Scroll it slowly:

> "Every step it took is written here in plain English — what it read,
> what it typed, what it asked permission for, what you approved. If your
> bookkeeper ever asks what the AI did, you hand her this. It's the
> employee that writes its own time sheet."

## Beat 5 — the offer (1 min)

> "Free for 7 days on your real work. I set it up, you keep the audit
> trail. If it doesn't save you time, we pull it and you owe nothing."

Hand the offer sheet. Stop talking.

---

## Objections and honest answers

| They say | You say |
| --- | --- |
| "Is this ChatGPT?" | "ChatGPT is a brain. This is an employee with a job description, locked doors, and a paper trail. The brain is the smallest part." |
| "What if it makes a mistake?" | "It will. That's why nothing it does is final until a human clicks — and why every step is logged. A mistake here gets caught at the gate, not in your mailbox." |
| "Where does my data go?" | "Your employee runs in its own sealed box. Your data never leaves it. I can show you the config." |
| "What does it cost?" | "Nothing for the first week. After that, $500 to set up, $300 a month — less per day than a cup of coffee, for work it does every day. Founding customers lock that rate for a year and I ask one thing back: a testimonial if it earns it." |
| "I need to think about it" | "Of course. I'll leave this report / audit trail with you. One question before I go: what would the AI have to do in that free week for you to say yes?" |

## Rules of the demo

1. Never demo a task that isn't their workflow.
2. Never turn the consent gate off, even to "show it faster."
3. Never claim a customer you don't have. "You'd be my first, which is why
   it's free," is a stronger sentence than a fake logo wall.
4. Leave the printed offer sheet + (for Track B) the free QA report of
   their site.
