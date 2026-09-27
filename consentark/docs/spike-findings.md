# page-agent Spike — Findings & Phase 2 Recommendation

> **STATUS (Phase 2 shipped):** approved and PRODUCTIONIZED as
> `apps/api/src/browser/BrowserService.ts`. Phase 2 outcome lives in
> `docs/PHASE2-notes.md` (gate mechanism, pool lifecycle, memory profile,
> small-model caveat). The recommendation below was implemented with two
> refinements: the LLM proxy is per-task (per-employee upstream), and the
> consent gate is the `customTools.click_element_by_index` override plus a
> promise bridge for the decision — as predicted in §Phase 2 recommendation.

**Date:** 2026-09-14 · **page-agent:** 1.12.4 (npm, ESM-only) · **Playwright:** 1.63.0 (Chromium headless shell 153)
**Verdict: VIABLE — proceed to Phase 2** with the architecture below. No showstoppers. Two real-world blockers were found and solved (CORS/PNA, CSP), one tool documented as absent (`execute_javascript`), one vendor flag documented as inverted-in-practice.

Evidence sources: `apps/api/scripts/spike-probe.ts` (all probes, `RUN_HN=1 RUN_CSP=1 RUN_SPA=1` for the live ones), `apps/api/test/browserSpike.test.ts` (7 passing tests), logs in this doc.

---

## Q1 — Injection mechanism & navigation survival

**Answer: YES. `context.addInitScript()` is the mechanism; it re-installs on every navigation.** Probe results:

| Mechanism | Installs | Survives navigation | Notes |
|---|---|---|---|
| `context.addInitScript(bundle)` | ✅ | ✅ (every nav) | **Use this.** Runs before page scripts. |
| `page.addScriptTag({content})` | ✅ | ❌ | Works for late injection on the current page only. |
| `page.evaluate(() => eval(code))` | ✅ | ❌ | Requires page CSP `unsafe-eval` — fails on locked-down sites. |

- Bundle size: **215 KB minified IIFE** (page-agent + @page-agent/* + zod + chalk + ai-motion).
- esbuild `platform: browser` bundles everything; **chalk 6 imports `node:os`/`node:process`/`node:tty`**, shimmed via esbuild `alias` to `src/browser/shims-browser.mjs`.
- Actual working invocation (condensed — full code in `src/browser/buildInjectionBundle.ts`, `src/browser/browser-entry.ts`):

```ts
const bundle = await buildInjectionBundle();      // esbuild → IIFE string, cached
await context.addInitScript(FETCH_BRIDGE);        // CDP fetch bridge (see Q2/Q5)
await context.addInitScript(bundle);              // re-runs on every navigation
// in-page: window.__paBundleReady === true after every load
```

- The entry exposes a **DOM-event contract** (`pa-spike-task` / `pa-spike-done` + `window.__PAGE_AGENT_SPIKE_CFG__`) so ONE injection serves MANY tasks; a live agent instance is created per task and disposed after.
- page-agent's floating UI panel is disposable (`agent.panel.dispose()`) — done at task start; no headless artifacts.

## Q2 — Model proxy (baseURL passthrough to OUR API)

**Answer: YES — natively.** `LLMConfig` is `{ baseURL: string; model: string; apiKey?; maxRetries?; transformRequestBody?; disableNamedToolChoice?; customFetch? }` (from `@page-agent/llms` `index.d.ts`; `baseURL` is required). Setting `baseURL` to our local proxy works with zero patching: the agent POSTs OpenAI-style `/chat/completions` with `Authorization: Bearer <key>`.

**Verified end-to-end:** in-page agent → local proxy (CORS + auth) → scripted mock upstream. The mock enforces the exact key the proxy injects — `auth enforced end-to-end: true`. The proxy records per call: model, message count, prompt size (14.8–15.2 KB real DOM payloads), status, duration → **the task audit trail captures every model call** (product requirement satisfied at the spike level).

**Security win:** the real provider API key lives only in the Node-side proxy; the page sees `apiKey: "pa-proxy"`. In Phase 2 this proxy is simply our Fastify app's LLM route (same audit log), so page-agent's model calls flow through `LLMProvider` with `llm_calls` audit entries.

## Q3 — Observability (capturing steps from outside the page)

**Answer: YES — two independent channels, both working:**

1. **Streaming:** `context.exposeFunction("__paStepToHost", …)` + the in-page bundle calling it on every `historychange` event → Node receives the full step array as it grows. Evidence: `Q3 streamed steps: 6 update(s)`.
2. **Polling:** `window.__PAGE_AGENT_SPIKE__.steps` readable from Node at any time; plus `agent.execute(task)` resolves with `{success, data, history}`.

Step records are rich — each step carries `reflection {evaluation_previous_goal, memory, next_goal}`, the tool name, its input, and its output:

```
step 0: input_text({"index":0,"text":"Ada Lovelace"}) → ✅ Input text (Ada Lovelace) into element (0).
step 2: select_dropdown_option({"index":2,"text":"Pro"}) → ✅ Selected option (Pro) in element ([2]<select id=plan>…)
step 3: click_element_by_index({"index":3}) → ✅ Clicked element ([3]<button type=button id=go>Submit form…)
step 4: done({"text":"Submitted the contact form.","success":true}) → Task completed
```

This maps 1:1 onto ConsentArk's human-readable audit requirement (what the AI did and why, per step). page-agent also exposes `onBeforeStep`/`onAfterStep`/`onAfterTask` lifecycle hooks and an `activity` event if we ever need finer grain.

## Q4 — One real browser task with a small/mocked model

**Answer: YES for deterministic GUI workflows; extraction channel proven.** No FreeLLMAPI key is available in this environment (none in `.env`), so per the spike brief the model is the scripted OpenAI-compatible mock (`src/browser/mockLlm.ts`). Important honesty note: a scripted mock cannot *decide* — it proves the plumbing, not model intelligence.

**Real GUI task, real page effects (local form):** the agent loop executed `input_text ×2 → select_dropdown_option → click_element_by_index → done` against a live page; the page's own JS wrote `"Submitted Ada Lovelace ada@example.com Pro"` into `#out` — **asserted in tests, not just agent self-report**.

**Real site (live HN, `RUN_HN=1`):** full loop on `https://news.ycombinator.com/` with the same scripted LLM; loop completed `wait → done`; titles reported match Playwright ground truth (that content was baked into the mock's final `done` — see caveat below).

**Extraction channel (the part a real model would use), proven by a DOM-secret probe:** a unique token planted only in the page DOM (`PA_SPIKE_SECRET_9137`) appeared in the serialized prompt received by the mock:

```
…</browser_state>\n\n[Start of page]\nSecret page\nMagic token: PA_SPIKE_SECRET_9137\n*[0]<button id=b>Nothing button />\n[End of page]…
```

So page → page-agent DOM serialization → LLM prompt works: a real model receives everything it needs to extract and return JSON via `done`. Prompt sizes observed: **~14.8 KB (small form page), ~15 KB+ (HN)**.

**⚠️ Caveat documented:** page-agent 1.12.4 ships **no `execute_javascript` tool**. Verified empirically (`InvokeError: Unknown action "execute_javascript". Available: done, wait, ask_user, click_element_by_index, input_text, select_dropdown_option, scroll, scroll_horizontally`) and in source (`this.tools.delete("execute_javascript")` — the `experimentalScriptExecutionTool` flag only deletes it; it does not add it). Consequences: (a) our earlier HN "extraction" via JS was mock-baked, and the probe/tests were corrected to assert the prompt channel instead; (b) the model can only act through the fixed toolset and answer from serialized DOM text — sufficient for Phase 2's form/navigation/extraction tasks, but custom in-page tools would need page-agent's `customTools` API.

**Small-model risk for real runs (documented, untested here — no key):** FreeLLMAPI's free-tier models must produce valid tool-call JSON; page-agent retries on malformed output (retry event observed in logs: `LLM retry attempt 1 of 2`). Recommend a Phase 2 acceptance test with the cheapest real model before promising small-model support.

## Q5 — Limits: CSP, sandbox, iframes, memory, SPAs

- **CSP `default-src 'self'` (probe `RUN_CSP=1`):** BLOCKED the direct fetch — `Connecting to http://127.0.0.1:<port>/v1/chat/completions violates CSP directive "default-src 'self'"` and `Fetch API cannot load … Refused to connect`. **Solved:** the fetch now travels over Playwright's `exposeFunction` CDP binding (injected before the bundle), which does not touch the page network stack. CSP page then passed: `ok=true`, only a cosmetic CSP violation remains (`Applying inline style violates …` — page-agent's own highlight mask; harmless, and removed when `enableMask` stays off/disposed panel).
- **Chrome Private Network Access / mixed content (live https HN → http loopback proxy):** direct fetch failed with `InvokeError: Network request failed` even on the non-CSP page. Same CDP fetch bridge solves it (plus `access-control-allow-private-network: true` on the proxy as defense-in-depth). **This is the critical discovery: never rely on the page's own fetch to reach the proxy — always wire `customFetch` → CDP bridge.**
- **Injection vs CSP:** `addInitScript` is **not** blocked by page CSP (Chromium treats it as isolated bootstrap), and `exposeFunction` bindings work on CSP pages — both verified on the `script-src 'self'` page.
- **SPAs:** hash-routing SPA probe passed (`ok=true`): click → client-side view change → DOM read all through the agent loop. addInitScript re-injection on SPA soft navigations is a non-issue (no document reload). pushState-heavy apps should be equivalent since the DOM re-serialization happens per step.
- **Iframes:** not directly probed. page-agent's DOM extraction has top-layer focus ("from top layer of the current page" observed in the serialized state); same-origin iframes are likely included, cross-origin frames are NOT reachable (standard in-page limitation). Flagged as a Phase 2 boundary — cross-origin iframe automation is out of scope for the in-page model.
- **Memory:** headless Chromium with the bundle installed: **~249 MB total RSS** across all Chromium helper processes (idle, about:blank). Per-employee browsers will need pooling/caps in Phase 2.
- **Bundle footprint:** 215 KB per page, installed pre-navigation — negligible.

## Working invocation pattern (the one that works — condensed)

```ts
// Node side
const bundle = await buildInjectionBundle();               // 215 KB IIFE (esbuild, cached)
const proxy  = await startLlmProxy({ upstreamUrl, upstreamApiKey });  // CORS + PNA + auth + audit
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.exposeFunction("__paStepToHost", steps => auditStream.push(steps));
await context.exposeFunction("__paCdpFetchBinding", async (url, optsJson) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json",
    authorization: "Bearer <real key stays in proxy>" }, body: JSON.parse(optsJson).body });
  return JSON.stringify({ status: res.status, body: await res.text() });
});
await context.addInitScript(FETCH_BRIDGE);   // registers window.__paCdpFetch
await context.addInitScript(bundle);         // registers the spike/agent entry
await page.goto(url);                        // both re-install on every navigation

// per task: set cfg (JSON) + merge customFetch in-page, dispatch pa-spike-task,
// await pa-spike-done, read window.__PAGE_AGENT_SPIKE__ {result, steps}
```

```js
// In-page (browser-entry.ts) — agent config that makes it all work:
new PageAgent({
  baseURL: proxyUrl,            // OUR proxy, not the provider
  apiKey: "pa-proxy",           // placeholder; real key Node-side only
  model: "…",
  maxSteps: 15,
  customFetch: (url, opts) => window.__paCdpFetch(url, opts),  // CSP/PNA-proof
})
```

## Phase 2 architecture recommendation

1. **Keep page-agent.** The in-page model works headless, survives navigation via addInitScript, gives human-readable step reflection for the audit log, and needs zero patching for model-proxy routing.
2. **Architecture: Playwright host + CDP injection + LLM proxy route in apps/api.**
   - `BrowserService` (per-employee browser pool, domain allowlist via `context.route`, screenshots to DATA_DIR, maxSteps/timeouts enforced Node-side).
   - Injection lifecycle: context-level `addInitScript(FETCH_BRIDGE)` + `addInitScript(bundle)` at context creation; per task = set cfg → dispatch → await done → collect `ExecutionResult` + streamed steps. No per-page re-injection logic needed beyond the init scripts.
   - Audit: stream steps via exposeFunction → task_logs; every model call recorded by the LLM proxy (model, chars, status, duration); screenshots at task start/end + on step N.
   - LLM: point the proxy at our existing LLMProvider (cloud/local). No new provider code.
3. **Keep the mock LLM** (`mockLlm.ts`) as a permanent CI fixture — deterministic browser E2E without keys.
4. **Do NOT use `execute_javascript` in designs** — it doesn't exist in 1.12.4. If in-page computation is needed later, use page-agent's `customTools` API (add a narrow, audited tool) — explicitly listed as an upgrade path, not Phase 2 scope.
5. **Safety unchanged:** allowedDomains enforced by Playwright routing (verified), confirm-before-submit still a Phase 2 gate, real API key never enters the page.

### Showstoppers: none. Watch-list (non-blocking):
- `experimentalScriptExecutionTool` flag is misleading (deletes the tool; doesn't add it) — upstream issue material.
- WebGL warning noise in headless (`GPU stall due to ReadPixels`) from the disposed mask — cosmetic; suppress via console filtering if noisy in logs.
- Cross-origin iframes are out of reach for the in-page model (documented boundary).
- Small-model tool-call reliability unverified (needs one real-key acceptance run).

---

*Probes: `apps/api/scripts/spike-probe.ts` · Tests: `apps/api/test/browserSpike.test.ts` (7 passing, 1 skipped live) · Spike code: `apps/api/src/browser/{BrowserSpike,buildInjectionBundle,browser-entry,llmProxy,mockLlm}.ts`*
