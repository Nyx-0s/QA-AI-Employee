/**
 * The host ↔ in-page-agent contract, in ONE place so neither side drifts.
 *
 * The in-page bundle (browser-entry.ts, compiled into the injection IIFE) and
 * the Node-side BrowserService talk through four channels:
 *
 *  1. Config:  Node sets `window[CFG_DATA]` (plain JSON), then evaluates
 *              CONFIG_MERGE_JS, which builds `window[CFG]` — attaching
 *              `customFetch` (CDP fetch bridge) and `customTools`
 *              (click_element_by_index consent gate) as real functions.
 *              Config must go through JSON + a pure-JS merge string because
 *              tsx/esbuild wraps function-valued object properties in
 *              `__name()` calls that don't exist in the page (spike finding).
 *  2. Tasking: Node dispatches the `TASK` DOM event (detail = objective);
 *              the bundle runs page-agent and dispatches `DONE` when settled.
 *  3. Stream:  page → Node via exposeFunction bindings (steps, screenshots,
 *              approval requests, decisions).
 *  4. Abort:   Node evaluates STOP_AGENT_JS → agent.stop() inside the page.
 */

import { SUBMIT_DETECT_JS } from "./submitDetect.js";
import type { GateInfo } from "./pageTypes.js";

export type { GateInfo };

/** Substituted into CONFIG_MERGE_JS at module-eval time (single source). */
const SUBMIT_HELPERS_SOURCE = SUBMIT_DETECT_JS;
export const ContractKeys = {
  /** JSON config blob written by Node (no functions). */
  CFG_DATA: "__caCfgData",
  /** Final config (with customFetch/customTools merged in). */
  CFG: "__caCfg",
  /** Pollable in-page state mirror (streaming is the primary channel). */
  STATE: "__caPageAgentState",
  /** The live PageAgentCore instance, set in onBeforeTask (for stop()). */
  AGENT: "__caAgent",
  /** True once the bundle has installed itself on the current document. */
  BUNDLE_READY: "__caBundleReady",
} as const;

/** exposeFunction binding names (Node implements, page calls). */
export const HostBindings = {
  /** History mirror: page pushes the full step array after every change. */
  STEPS: "__caStepsToHost",
  /** CDP fetch bridge — page-agent's LLM calls travel over CDP, not the net. */
  FETCH: "__caCdpFetchBinding",
  /** Gate: page announces what it is about to submit (fire-and-forget). */
  APPROVAL_REQUEST: "__caApprovalRequest",
  /** Gate: page blocks on this until Node resolves approve/cancel. */
  APPROVAL_DECISION: "__caApprovalDecision",
} as const;

/**
 * Evaluated by Node to abort a running in-page agent (mid-task cancellation).
 * Fire-and-forget on purpose: stop() settles when the run settles, and the
 * evaluate must not race context disposal.
 */
export const STOP_AGENT_JS = `(() => {
  const a = window.__caAgent;
  if (a && typeof a.stop === 'function') { void a.stop(); return true; }
  return false;
})()`;

/** DOM events for tasking and completion. */
export const DomEvents = {
  TASK: "ca-browser-task",
  DONE: "ca-browser-done",
} as const;

/**
 * Injected BEFORE the bundle: a fetch bridge for the agent's model calls.
 *
 * Why: on real sites the page's own fetch() to our local proxy is blocked by
 * CSP (default-src / connect-src) and by Chrome Private Network Access
 * (public https → private http). Playwright's exposeFunction bindings travel
 * over CDP, not the network stack, so they bypass both (verified in the
 * spike). page-agent's LLMConfig.customFetch plugs the bridge in natively.
 */
export const FETCH_BRIDGE = `(() => {
  if (window.__caCdpFetch) return; // idempotent re-injection
  window.__caCdpFetch = async (url, opts) => {
    const raw = await window.__caCdpFetchBinding(url, JSON.stringify(opts ?? {}));
    const p = JSON.parse(raw);
    return {
      ok: p.status >= 200 && p.status < 300,
      status: p.status,
      text: async () => p.body,
      json: async () => JSON.parse(p.body),
    };
  };
})();`;

/**
 * Pure-JS config merge (string, NOT a tsx-transformed callback): builds the
 * final agent config from the JSON blob set by Node, attaching customFetch
 * and the consent-gate customTools as real functions. Done as a string
 * because tsx/esbuild injects `__name()` wrappers into function-valued
 * object properties, which don't exist in the page (spike finding).
 *
 * The gate tool itself is manufactured by the bundle (`window.__caMakeGateTool`)
 * so all zod/TS logic stays inside the bundle — this string only wires it up.
 */
export const CONFIG_MERGE_JS = `(() => {
  const data = window.__caCfgData;
  if (!data) throw new Error('browser config missing');
  const submitHelpers = ${SUBMIT_HELPERS_SOURCE};
  const cfg = { ...data, __caSubmitHelpers: submitHelpers };
  const customFetch = (url, opts) => window.__caCdpFetch(url, opts);
  let customTools;
  if (typeof window.__caMakeGateTools === 'function') {
    customTools = window.__caMakeGateTools(cfg);
  }
  window.__caCfg = { ...cfg, customFetch, ...(customTools ? { customTools } : {}) };
  return true;
})();`;

/**
 * Decision of the human (or policy) on a pending approval request.
 * "cancelled" makes the in-page gate throw an AbortError, which stops the
 * agent loop with page-agent's own abort path.
 */
export type ApprovalDecision = "approved" | "cancelled";
