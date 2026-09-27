# Task matrix — scripted mock baseline

Run: 2026-09-23 22:23 · harness: task-matrix.ts (production path: BrowserService → LLM proxy)

| Task | Result | Steps | LLM calls | Gate | ms |
|---|---|---|---|---|---|
| T1 Read the price list and extract every product name with it | PASS — ok=true; extraction has items[>=2]; no gate expected | 1 | 200 in 12ms | — | 2012 |
| T2 Fill the order form: item Blue Widget, quantity 3, email c | PASS — ok=true; no gate expected | 4 | 200 in 6ms, 200 in 5ms, 200 in 6ms, 200 in 5ms | — | 3960 |
| T3 Fill the order form: item Blue Widget, quantity 3, email c | PASS — ok=true; gate parked + approved | 5 | 200 in 8ms, 200 in 12ms, 200 in 4ms, 200 in 3ms, 200 in 4ms | parked/approved | 4888 |

## Verdict: ALL THREE TASKS PASS

Baseline side of the comparison. The real-model run must meet the same criteria through the same harness (`npx tsx scripts/task-matrix.ts` with the key in .env).
