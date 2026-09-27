# Real-Model Findings — FreeLLMAPI reality check

**Date:** 2026-09-23 (attempted run; superseding the 2026-09-14 no-key record)
**Status: NOT RUN — the key line exists in `consentark/.env` but the value is empty.**
The paste did not survive: `FREELLMAPI_KEY=` (line 4) has a zero-length value. Per the
standing rule (never fabricate, never simulate results), this document records exactly
what was checked and what happened. The mock-LLM-driven evidence remains the only
execution evidence; the small-model caveat stays **open**.

## Key availability (checked 2026-09-23)

| Source | Method | Result |
| --- | --- | --- |
| `consentark/.env` | name-only parse of `FREELLMAPI_KEY=` | line 4 present, **value length 0** (`FREELLMAPI_URL` length 24 — the file was edited; only the key value is missing) |
| Every `*.env*` file in the workspace | recursive scan, lengths only | no other `FREELLMAPI_KEY` occurrence anywhere |
| Shell environment | `env` (variable names only) | no `FREELLMAPI_*` variables exported |
| Repo-root `.env` | name-only listing | legacy QA-employee vars only (`BASE_URL`, `USERNAME`, …) — no LLM credentials |

No key value was found in any configured source, so **no live model call was made** and
`scripts/real-model-probe.ts` correctly refused to run. Nothing in this workspace
pretends otherwise: every test in the suite runs against the scripted mock LLM
(`src/browser/mockLlm.ts`), which by design replays tool calls rather than reasoning.

## What the diagnostics reported (2026-09-23)

```
$ npx tsx src/cli/keycheck.ts
keycheck: REAL key check
  FREELLMAPI_URL: http://localhost:3001/v1
  FREELLMAPI_KEY: (empty)
  FREELLMAPI_MODEL: auto
keycheck: NO KEY — paste it into consentark/.env (FREELLMAPI_KEY=...) and rerun.

$ npx tsx scripts/real-model-probe.ts
No FREELLMAPI_KEY configured — paste it into consentark/.env (FREELLMAPI_KEY=...) and re-run.
```

(Both diagnostics print only the key's presence and length — never its value.)

## Fixed while attempting the run

1. **`scripts/real-model-probe.ts` now loads `consentark/.env` itself** (same dotenv
   chain as the API entry and `keycheck`) — previously it depended on exported shell
   vars only, so a key in `.env` alone would not have been picked up.
2. **The probe validates only the LLM config block** (keycheck's pattern). Attempting
   the run exposed that a wrapper's `PORT=0` export crashed the full-schema
   `loadConfig()` before the key check — a diagnostic should not care about unrelated
   shell noise. The keycheck path was already immune; the probe now matches.
3. Confirmed the honest failure path end to end: both tools exit non-zero with a clear,
   secret-free message when the key is missing.

## What IS proven without a key (unchanged)

- Injection, proxy auth, gate interception, audit streaming, structured output, timeout /
  cancel paths — all exercised E2E by `test/browserTask.test.ts` (61 passing) and the
  adversarial audit (`scripts/dev/gate-adversarial.ts`, 7/7 vectors held).
- The gate's correctness does **not** depend on model strength: every submission path is
  intercepted *mechanically* (tool override + page-level blockers) before any model output
  is trusted. A weak model can at worst fail or stall a task, never bypass the gate.
- The demo sandbox (`consentark-demo`, see `startup-kit/demo-sandbox-runbook.md`) has
  been rehearsed end to end on the scripted backend: extraction, consent-gate parking,
  operator approval, audit replay — twice, all beats green.

## What only a real key can answer (the open risk register — unchanged)

1. **Does a small model complete the tool-calling loop at all** (spike Q4 concern:
   OLMoE-7B-class macro-format adherence)?
2. **Does a real model respect `maxSteps` pacing** — or does it burn steps on repeats
   (would justify lowering `BROWSER_MAX_STEPS_HARD_CAP` or per-employee defaults)?
3. **Does it hallucinate element indexes** (clicks that miss) at rates that make
   `confirmBeforeSubmit` noise rather than signal?
4. **Does it attempt non-click submission paths** (newline in `input_text`) unprompted —
   the gate now covers it, but frequency data would tune the UX.
5. **Is `outputSchema` adherence reliable enough** to keep hard-failing on mismatch, or
   should mismatches be retried once before failing?

## 2026-09-24 (second attempt) — key STILL not in the file

Checked again at the operator's instruction: `consentark/.env` line 4 remains
`FREELLMAPI_KEY=` (value length 0, unchanged from the 09-23 record). The shell
environment carries no `FREELLMAPI_*` variables, and a workspace-wide scan found
no key material anywhere (the `sk-` grep hits were the substrings "task-" and
"disk-", not keys). **Conclusion: the paste is not reaching the file — likely an
editor not saving this exact path, or the key being pasted into a different
surface.**

**09-24, third attempt — the paste is landing OUTSIDE this checkout.**
File-structure forensics eliminated every format theory (no BOM, no CRLF, no
`export` prefix, no spacing — line 4 is genuinely empty), and the mtime is
conclusive: `consentark/.env` was **last modified Sep 19 10:15** (the SMTP
credential session). No env file anywhere on this disk is newer. The pastes of
09-23 and 09-24 therefore reached a different surface — another window, another
clone, or an unsaved editor buffer. Housekeeping is verified safe: the ignore
rule is active (`consentark/.gitignore` line 8: `.env` → `consentark/.env`), so
key-in-file can never touch git. Paths that cannot miss:

1. **Intake-file path (works even with broken pastes):** create
   `consentark/KEY.TMP` containing exactly one line, `FREELLMAPI_KEY=<key>`,
   then say "key in KEY.TMP". The tracker moves it into place and runs the
   unblock in the same motion, then deletes the temp file.
2. **Direct-save check:** open `consentark/.env` **from this checkout on disk**,
   edit line 4, and confirm the save actually writes (the file's mtime must read
   later than Sep 19 10:15).

**The unblock is one command** after the key is actually in place:

```bash
bash consentark/scripts/real-model-unblock.sh
```

Standing watch (added 2026-09-24): the daily audit (`sales/morning-audit.mjs`)
now flags an empty `FREELLMAPI_KEY` every morning — `key=EMPTY` in the audit
log, ATTENTION verdict, exit 1 — until the key is in, so an unsaved paste can
never silently block the real-model unblock again. Presence-only: the value is
never printed, logged, or stored.

It gates on `keycheck` PASS, runs the real-model probe through the production
browser path, and appends a dated verdict to this document automatically
(findings untouched on failure — verified today: the gate fired, nothing was
written). Manual equivalent:

```bash
cd apps/api
npx tsx src/cli/keycheck.ts          # must print PASS first
npx tsx scripts/real-model-probe.ts  # one real browser task through the production path
```

Then extend to the three-task matrix (extraction / form fill / gated submit):
`npx tsx scripts/task-matrix.ts` — dual-mode, real model automatically when the key
lands, same harness and criteria as the mock baseline (see the 2026-09-24 record
below; supersedes the old plan of hand-swapping `startMockLlm` inside
`scripts/dev/gate-adversarial.ts`). Record: model id, task outcomes, step counts,
latency per step, tokens per task (proxy `llmRequests` already captures everything),
and any anomalous behavior — then update this document with dated results and flip
the demo sandbox to real-model mode per `startup-kit/demo-sandbox-runbook.md`.

## Mock baseline for the three-task matrix (recorded 2026-09-24)

While the key is pending, the comparison's known-good side is locked in.
`apps/api/scripts/task-matrix.ts` runs the three demo-shape tasks through the
**production browser path** (`BrowserService` → LLM proxy → page agent) against
the scripted mock — the exact tasks and assertions the real-model run must meet:

| Task | Shape | Mock result |
| --- | --- | --- |
| T1 | Price-list extraction → structured JSON (`items[≥2]`) | PASS · 1 step · 2.0s |
| T2 | Order-form fill (item / qty / email), no submit | PASS · 4 steps · 4.0s |
| T3 | Same fill, then submit behind the consent gate | PASS · 5 steps · 4.9s · gate parked → approved |

**Verdict: ALL THREE TASKS PASS.** Full evidence auto-written to
`docs/task-matrix-mock.md` (`docs/task-matrix-latest.md` mirrors the most recent
run of either mode). Design points that make the comparison honest: one fresh mock
per task (no shared-queue drift, the lesson from the demo rehearsal), per-task
assertions (extraction shape / field values / gate parked+approved / no unexpected
gate), and `--force-real` no-ops with a clear message while the key is absent.
The real-model run uses the identical harness (`npx tsx scripts/task-matrix.ts`
auto-detects the key) and must meet the same criteria; outcomes, step counts, and
per-call latency land side by side in `docs/task-matrix-real.md`.
