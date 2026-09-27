# Prospect intake — fill this file, then tell me "process intake"

**Why this file exists:** chat-side automation keeps sending templates with
unfilled variables (`<name or URL>`, `[company]`). Six inputs were refused
as non-evidence. This file bypasses that channel entirely: fill the fields
below **in this file** (any editor), save, and say "process intake" in
chat. I read the file from disk, not from chat.

---

```
# ── REQUIRED ─────────────────────────────────────────────────────
company name :
url          :          # their real site, e.g. https://acmebakery.com
# ── OPTIONAL HINTS (I verify everything regardless) ──────────────
what they do :          # one line, your words — I'll confirm on-site
suspected task:         # e.g. phone orders rekeyed, manual confirmations
# ── NOTES ─────────────────────────────────────────────────────────
# One company per intake. For multiple, duplicate this block in
# intake-2.md, intake-3.md, etc. I process them in order.
# Fields left blank = returned unprocessed with a note, never guessed.
```
