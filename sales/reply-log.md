# Reply evidence log (append-only) — created 2026-09-24

The archive for real replies, per the reply-evidence schema in
`sales/ledger.md` and the procedure in `sales/reply-playbooks.md`. Same
motion as `send-evidence-log.md` / `nudge-evidence-log.md`: a reply is only
logged when the verbatim text is pasted (never assumed from silence), and
entries are never edited or removed after being appended.

Schema — one block per reply, appended by the operator or tracker:

```
## <company> — received <YYYY-MM-DD>
```
company: <exact name from the ledger row>
received date: <YYYY-MM-DD>
reply verbatim: "<full reply text>"
channel: <email reply | phone note | form response>
classification: <MEETING-SET | REPLIED | CLOSED> (objections additionally logged verbatim on the row)
nudge cancelled: <staged nudge filename or "none staged">
response draft: <outreach/drafts/YYYY-MM-DD-reply-<slug>.md or "none">
```

No entries yet — zero real replies received as of 2026-09-24 (operator
attestations on 2026-09-23: inbox checked, nothing there). The first real
reply gets processed immediately per `sales/reply-playbooks.md`.
