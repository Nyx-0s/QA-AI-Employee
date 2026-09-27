/**
 * DOM-free types shared between the in-page bundle (browser-entry.ts) and
 * Node-side modules (BrowserService, audit). Kept separate so importing a
 * type never drags browser-entry.ts — which references window/document —
 * into the server TypeScript program.
 */

export interface StreamedStep {
  type: "step" | "observation" | "retry" | "error" | "user_takeover";
  stepIndex?: number;
  tool?: string;
  input?: unknown;
  output?: string;
  reflection?: {
    evaluation_previous_goal?: string;
    memory?: string;
    next_goal?: string;
  };
  message?: string;
  at: number;
}

/** Extra config fields the host passes alongside page-agent's AgentConfig. */
export interface CfgData {
  /** Consent gate on/off (employee.confirmBeforeSubmit). */
  confirmBeforeSubmit?: boolean;
  /** Single-shot mode: run immediately at bundle install. */
  autoRun?: boolean;
  /** Task text for single-shot mode. */
  task?: string;
  /** Pure-JS submit-detection helpers injected by the host (SUBMIT_DETECT_JS). */
  __caSubmitHelpers?: {
    isSubmitLike: (el: unknown) => boolean;
    describe: (el: unknown) => string;
  };
}

/**
 * Which submit path tripped the gate. The gate covers ALL submission routes:
 * - "click":     the agent clicked a submit-like element (click gate tool),
 * - "newline":   the agent typed text containing a newline into a single-line
 *                 input (Enter → HTML implicit submission intent),
 * - "enter-key": a REAL Enter keypress inside a form input (user takeover,
 *                 a future vendor keyboard tool, or page-injected events).
 */
export type GateVia = "click" | "newline" | "enter-key";

/**
 * What the in-page gate announces to the host when the agent is about to
 * activate a submit-like element. `gated` mirrors the employee's
 * confirmBeforeSubmit: true = block for approval, false = audit-only
 * (the click proceeds; the audit trail records the auto-submit).
 */
export interface GateInfo {
  summary: string;
  elementText: string;
  elementDescription: string;
  stepIndex: number;
  gated: boolean;
  /** Which submission path was intercepted. */
  via: GateVia;
  /** For the newline path: the text that carried the newline (truncated). */
  inputText?: string;
}
