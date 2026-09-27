# ConsentArk demo rehearsal — LIVE 2026-09-24T00:08:48Z
container: consentark-demo · API http://127.0.0.1:4400 · employee: data-clerk (consent gate ON)

## Beat 1 — tasks enqueued (extraction + gated order form)
- extraction task: tsk_QW-AuXdUI9fQ

## Beat 2 — extraction task result
- status: done
- output: {"reply":{"items":[{"name":"Blue Widget","price":4.5},{"name":"Red Gears","price":12},{"name":"Steel Bolts","price":1.2},{"name":"Copper Wire","price":7.75}]},"validated":true,"steps":1,"model":"auto","provider":"browser

## Beat 3 — the gated order form (enqueued now; the consent gate will park it)
- gated form task: tsk_LkpbEaDB-lNh

- PARKED as designed. The human sees: {"summary":"About to submit via click: \"Place order\" on button#place-order[submit] — awaiting human approval.","elementText":"Place order","elementDescription":"button#place-order[submit]","stepIndex":3,"via":"click","at":"2026-09-24T00:08:55.863Z"}

## Beat 4 — operator approves (the one click)
- approve response: {"approved":true,"status":"awaiting_approval"}
- final status: done · output: {"reply":"Order placed: Blue Widget x3 for clerk@example.com.","steps":5,"model":"auto","provider":"browser"}

## Beat 5 — audit replay (plain-language log lines)

### tsk_QW-AuXdUI9fQ
  status: done
  output: {"reply":{"items":[{"name":"Blue Widget","price":4.5},{"name":"Red Gears","price":12},{"name":"Steel Bolts","price":1.2},{"name":"Copper Wire","price":7.75}]},"validated":true,"steps":1,"model":"auto"
  [system] Browser task queued for Data Clerk: Read the price list and extract every product name with its price into JSON: {"items":[{"name":string,"price":numb
  [system] Employee Data Clerk started the task.
  [llm] Model call served in 12 ms (model auto, 14833 chars of page context sent).
  [browser] Step 0: done → Task completed — run scripted step
  [browser] Extraction validated against the requested schema (1 steps).

### tsk_LkpbEaDB-lNh
  status: done
  output: {"reply":"Order placed: Blue Widget x3 for clerk@example.com.","steps":5,"model":"auto","provider":"browser"}
  [system] Browser task queued for Data Clerk: Fill the order form with: item Blue Widget, quantity 3, email clerk@example.com — then stop; the consent gate will
  [system] Employee Data Clerk started the task.
  [llm] Model call served in 9 ms (model auto, 15021 chars of page context sent).
  [browser] Step 0: input_text → ✅ Input text (Blue Widget) into element (1). — run scripted step
  [llm] Model call served in 20 ms (model auto, 15182 chars of page context sent).
  [browser] Step 1: input_text → ✅ Input text (3) into element ([3]<input type=number name=quantity />). — run scripted step
  [llm] Model call served in 8 ms (model auto, 15377 chars of page context sent).
  [browser] Step 2: input_text → ✅ Input text (clerk@example.com) into element ([5]<input type=email name=email id=email />). — run scripted step
  [llm] Model call served in 14 ms (model auto, 15593 chars of page context sent).
  [safety] About to submit via click: "Place order" on button#place-order[submit] — awaiting human approval. — task paused for human approval.
  [safety] Human approved: "Place order" on button#place-order[submit]. Task resumes.
  [browser] Step 3: click_element_by_index → ✅ Clicked element ([6]<button type=submit id=place-order>Place order />). — run scripted step
  [llm] Model call served in 7 ms (model auto, 15806 chars of page context sent).
  [browser] Step 4: done → Task completed — run scripted step
  [safety] Human approved the submission — task resumed and completed.

## Screenshots captured by the employee
- task-end-1790208538770.png
- task-gate-step3-1790208535326.png
- task-start-1790208531527.png
- task-end-1790208530340.png
- task-start-1790208529552.png
- task-end-1790207663740.png
