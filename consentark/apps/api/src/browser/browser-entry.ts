/**
 * browser-entry.ts — runs INSIDE the page.
 *
 * Bundled by buildInjectionBundle.ts into a single IIFE and injected with
 * context.addInitScript() (re-runs on every navigation) or page.addScriptTag
 * for single-page injection.
 *
 * Contract with the Node host (BrowserService.ts) — see contract.ts:
 * - Sets `window.__caPageAgentState` (pollable state mirror) and
 *   `window.__caBundleReady`.
 * - Node writes `window.__caCfgData` (JSON) then evaluates CONFIG_MERGE_JS
 *   (in contract.ts), which builds `window.__caCfg` — attaching customFetch
 *   (CDP bridge) and customTools (the consent gate) as real functions.
 * - Node dispatches the `ca-browser-task` DOM event; the bundle runs
 *   page-agent and dispatches `ca-browser-done` when settled.
 * - Streams every history change to Node via `window.__caStepsToHost`.
 * - The consent gate: the overridden click tool detects submit-like elements
 *   and blocks in-page (exposeFunction promise bridge) until Node resolves
 *   an approve/cancel decision.
 */
import { PageAgent } from "page-agent";
import { z } from "zod";
import type { AgentConfig, HistoricalEvent, PageAgentCore, PageAgentTool } from "page-agent";
import type { StreamedStep, CfgData, GateInfo, GateVia } from "./pageTypes.js";

export type { StreamedStep, CfgData };

type FullConfig = AgentConfig & CfgData;

// (FullConfig stays an intersection: AgentConfig's required LLM fields plus
// our JSON-serializable extras.)

/**
 * The step index the gate reports: the agent's history length at gate time
 * equals the step ABOUT to run (history grows only after each step lands).
 */
let currentStepIndex = 0;

/**
 * Blocking wait for the human's gate decision (exposeFunction bridge).
 * Each gate trip calls the binding ONCE — Playwright gives every call its
 * own pending promise, and the host resolves them per trip (FIFO per task;
 * the agent loop is blocked while a gate is open, so trips are sequential).
 */
function awaitDecision(info: GateInfo, win: Window = window): Promise<"approved" | "cancelled"> {
  const binding = win.__caApprovalDecision;
  if (!binding) {
    // Binding absent (host gone / version drift): fail safe — treat as
    // cancelled rather than submitting without consent.
    return Promise.resolve("cancelled");
  }
  return binding(info);
}

/**
 * Shared gate flow — ONE approval path for every submission channel:
 * announce (Node persists ApprovalRequest + screenshots + audit) → block
 * in-page on the decision bridge → proceed or abort. The click gate, the
 * newline gate, and the Enter-key gate all call THIS — no side doors.
 * `win` defaults to the top window; iframe-enter intercepts pass the iframe's
 * window so bindings resolve there first (Playwright bindings are installed
 * per frame; if absent, the top-window binding is used).
 */
async function gateFlow(
  cfg: FullConfig,
  via: GateVia,
  describeTarget: string,
  text: string,
  stepIndex: number,
  proceed: () => Promise<string>,
  win: Window = window,
): Promise<string> {
  const gated = cfg.confirmBeforeSubmit === true;
  const info: GateInfo = {
    summary: gated
      ? `About to submit via ${via}: "${text}" on ${describeTarget} — awaiting human approval.`
      : `Auto-submitting via ${via}: "${text}" on ${describeTarget} (confirmBeforeSubmit is off — recorded for the audit trail).`,
    elementText: text,
    elementDescription: describeTarget,
    stepIndex,
    gated,
    via,
  };
  // 1) Announce: Node records the (auto-)submission decision in the audit
  //    trail; when gated it also pauses + screenshots the task.
  (win.__caApprovalRequest ?? window.__caApprovalRequest)?.(info);
  if (!gated) return proceed();
  // 2) Block in-page until the human decides (exposeFunction bridge).
  const decision = await awaitDecision(info, win);
  if (decision === "cancelled") {
    // Flag BEFORE throwing: page-agent reduces any tool AbortError to
    // "Task aborted", so the host needs this explicit marker to map the
    // outcome to task status "cancelled" (not agent_failed).
    state().gateCancelled = true;
    // page-agent's own abort path: the loop stops with "Task aborted".
    throw new DOMException("Submission cancelled by reviewer", "AbortError");
  }
  return proceed();
}

interface PageState {
  ready: boolean;
  busy: boolean;
  done: boolean;
  error?: string;
  historyLength: number;
  steps: StreamedStep[];
  result?: { success: boolean; data: string; steps: number };
  task?: string;
  /** A gate trip was rejected by the reviewer (maps to status cancelled). */
  gateCancelled?: boolean;
}

declare global {
  interface Window {
    __caPageAgentState?: PageState;
    __caCfg?: FullConfig;
    __caCfgData?: CfgData;
    __caAgent?: PageAgentCore;
    __caBundleReady?: boolean;
    __caStepsToHost?: (steps: StreamedStep[]) => void;
    __caApprovalRequest?: (info: GateInfo) => void;
    __caApprovalDecision?: (info: GateInfo) => Promise<"approved" | "cancelled">;
    __caGatePending?: (info: GateInfo) => void;
    __caEnterBlockerInstalled?: boolean;
    __caClickBlockerInstalled?: boolean;
    /** True while an APPROVED agent click is being dispatched (click gate passes it). */
    __caAgentClickInProgress?: boolean;
  }
}

// GateInfo lives in pageTypes.ts (shared with the Node host).

function state(): PageState {
  if (!window.__caPageAgentState) {
    window.__caPageAgentState = {
      ready: false,
      busy: false,
      done: false,
      historyLength: 0,
      steps: [],
    };
  }
  return window.__caPageAgentState;
}

function mapHistory(history: HistoricalEvent[]): StreamedStep[] {
  return history.map((h) => {
    if (h.type === "step") {
      return {
        type: "step",
        stepIndex: h.stepIndex,
        tool: h.action?.name,
        input: h.action?.input,
        output: h.action?.output,
        reflection: h.reflection,
        at: Date.now(),
      };
    }
    const rest = h as { message?: string };
    return { type: h.type, message: rest.message, at: Date.now() };
  });
}

/**
 * The consent gate as a page-agent custom tool.
 *
 * customTools entries override built-ins by name (verified in
 * @page-agent/core 1.12.4: the merge happens AFTER the internal registry is
 * built). The tool executes bound to the agent, so `this.pageController`
 * gives the same index→element mapping the native click uses — we simply
 * inspect the element BEFORE delegating to the real click.
 */
function gatedClickTool(cfg: FullConfig): PageAgentTool<{ index: number }> {
  return {
    description:
      "Click element by index. If the element would submit or send data, human approval is obtained first.",
    // Same contract as the built-in click_element_by_index tool.
    inputSchema: z.object({ index: z.number().int().min(0) }),
    execute: async function (this: PageAgentCore, input) {
      // Runtime-public, typing-private internals (page-controller 1.12.4):
      // selectorMap/assertIndexed exist on the instance but are marked
      // private in the .d.ts — the two-step cast avoids the never-collapse.
      const pc = this.pageController as unknown as {
        assertIndexed?: () => void;
        selectorMap?: Map<number, { ref?: HTMLElement }>;
        clickElement: (index: number) => Promise<{ success: boolean; message: string }>;
      };
      try {
        pc.assertIndexed?.();
      } catch {
        /* pre-indexing state — clickElement below re-asserts */
      }
      const node = pc.selectorMap?.get(input.index);
      const element = node?.ref;
      if (!element) {
        // Internals unavailable (future version drift): fall back to the
        // native click WITHOUT gate inspection — same behavior as gate-off,
        // never a broken task. The audit log shows the tool ran ungated.
        const result = await pc.clickElement(input.index);
        return `⚠️ ungated (element lookup unavailable): ${result.message}`;
      }
      const helpers = cfg.__caSubmitHelpers;
      const desc = helpers ? helpers.describe(element) : element.tagName.toLowerCase();
      const text = (
        (element.textContent || "") +
        " " +
        (element.getAttribute?.("aria-label") || "")
      )
        .trim()
        .slice(0, 120);
      const submitLike = helpers ? helpers.isSubmitLike(element) : false;
      const stepIndex = currentStepIndex;

      if (submitLike) {
        // NOTE: if a future page-agent upgrade ships an execute_javascript
        // (or any DOM-scripting) tool, it MUST be wrapped by this gate too —
        // arbitrary JS could submit forms and bypass every path covered
        // here. 1.12.4 does not ship it (experimentalScriptExecutionTool
        // only REMOVES the built-in; see docs/spike-findings.md).
        return gateFlow(cfg, "click", desc, text, stepIndex, async () => {
          // Flag the dispatch so the PAGE-LEVEL click blocker (hardened
          // layer) lets this APPROVED agent click through untouched —
          // without the flag it would trip a second, duplicate approval.
          window.__caAgentClickInProgress = true;
          try {
            const result = await pc.clickElement(input.index);
            return result.message;
          } finally {
            window.__caAgentClickInProgress = false;
          }
        });
      }

      const result = await pc.clickElement(input.index);
      return result.message;
    },
  };
}

/**
 * Gated input_text — closes the Enter/implicit-submission bypass at the tool
 * level. page-agent's inputText sets values via the native setter + input/
 * change events (NO key events), so a "\n" never fires a real Enter — but the
 * SUBMISSION INTENT is real and unguarded today: any page listening for
 * Enter, or a future vendor keyboard path, would submit without consent.
 *
 * Two layers:
 *  1. text containing "\n" targeted at a single-line input = submit intent →
 *     routes through the SAME gateFlow (announce → persist → block).
 *     Defense-in-depth: the newline is stripped for single-line inputs
 *     (Enter is legitimate in textareas — the text goes through unstripped).
 *  2. (page level, installed below) a capturing keydown blocker prevents
 *     REAL Enter presses inside forms from triggering implicit submission
 *     while gated.
 */
function gatedInputTextTool(cfg: FullConfig): PageAgentTool<{ index: number; text: string }> {
  return {
    description: "Click and type text into an interactive input element",
    inputSchema: z.object({ index: z.number().int().min(0), text: z.string() }),
    execute: async function (this: PageAgentCore, input) {
      const pc = this.pageController as unknown as {
        assertIndexed?: () => void;
        selectorMap?: Map<number, { ref?: HTMLElement }>;
        inputText: (index: number, text: string) => Promise<{ success: boolean; message: string }>;
      };
      try {
        pc.assertIndexed?.();
      } catch {
        /* pre-indexing state — inputText below re-asserts */
      }
      const node = pc.selectorMap?.get(input.index);
      const element = node?.ref;
      const helpers = cfg.__caSubmitHelpers;
      // Single-line input = HTMLInputElement (a <textarea> is
      // HTMLTextAreaElement, so it never matches — Enter is legit there).
      const singleLine = element instanceof HTMLInputElement;
      const hasNewline = input.text.includes("\n");

      if (hasNewline && singleLine && helpers) {
        const desc = helpers.describe(element);
        const stepIndex = currentStepIndex;
        // Gate on the SUBMISSION INTENT (the newline), then type the text
        // with the newline stripped (single-line inputs cannot hold "\n" —
        // the setter would drop it anyway; explicit is better).
        const clean = input.text.replace(/\n+/g, "");
        return gateFlow(cfg, "newline", desc, input.text.trim().slice(0, 120), stepIndex, async () => {
          const result = await pc.inputText(input.index, clean);
          return result.message;
        });
      }

      const result = await pc.inputText(input.index, input.text);
      return result.message;
    },
  };
}

async function runTask(task: string, cfg: FullConfig): Promise<void> {
  const st = state();
  st.busy = true;
  st.done = false;
  st.error = undefined;
  st.task = task;
  st.steps = [];
  currentStepIndex = 0;

  const agent = new PageAgent(cfg);
  // Headless automation does not need the floating UI panel.
  try {
    agent.panel?.dispose();
  } catch {
    /* panel is cosmetic — never fail the task over it */
  }
  // Expose the live instance so the host can stop() mid-task (cancellation).
  window.__caAgent = agent;

  const push = (): void => {
    const s = state();
    s.steps = mapHistory(agent.history);
    s.historyLength = agent.history.length;
    currentStepIndex = s.steps.filter((x) => x.type === "step").length;
    // Stream to Node when the host registered an exposeFunction binding.
    try {
      window.__caStepsToHost?.(s.steps);
    } catch {
      /* host binding absent — in-page state mirror remains available */
    }
  };

  agent.addEventListener("historychange", push);

  try {
    const result = await agent.execute(task);
    push();
    st.result = {
      success: result.success,
      data: result.data,
      steps: agent.history.filter((h) => h.type === "step").length,
    };
  } catch (err) {
    push();
    st.error = err instanceof Error ? err.message : String(err);
    st.result = { success: false, data: "", steps: st.steps.length };
  } finally {
    st.busy = false;
    st.done = true;
    window.__caAgent = undefined;
    try {
      agent.dispose();
    } catch {
      /* already disposed */
    }
    document.dispatchEvent(new CustomEvent("ca-browser-done"));
  }
}

// ---- bundle install --------------------------------------------------------
state().ready = true;
window.__caBundleReady = true;

// Enter blocker needs the config (gate on/off) — installed lazily when Node
// writes __caCfgData, BEFORE the agent starts (see ca-browser-task handler).
function ensureEnterBlocker(): void {
  const cfg = window.__caCfg;
  if (cfg) installEnterBlocker(cfg);
}

// Gate tool factory — CONFIG_MERGE_JS (contract.ts) calls this to attach the
// consent-gate tools as customTools (overriding built-ins by name) with real
// zod schemas and real functions (which cannot cross the JSON config boundary).
// click_element_by_index + input_text are BOTH wrapped: together they close
// the click path AND the Enter/implicit-submission path.
(window as unknown as {
  __caMakeGateTools?: (cfg: FullConfig) => Record<string, PageAgentTool>;
}).__caMakeGateTools = (cfg) => ({
  click_element_by_index: gatedClickTool(cfg),
  input_text: gatedInputTextTool(cfg),
});

/**
 * Page-level Enter blocker (defense-in-depth behind the input_text gate).
 * Installed only when confirmBeforeSubmit is ON: while a REAL Enter keypress
 * inside a form would trigger HTML implicit submission, this capturing
 * listener swallows the default action and routes the interception through
 * the SAME approval flow (announce → persist → block → resume/reject). On
 * approval the exact default action is re-fired via requestSubmit().
 *
 * Why a second layer: the input_text gate covers the agent's tool path, but
 * a real keyboard source (user takeover, a future vendor "press key" tool,
 * page-injected events) never passes through our tool override.
 */
/**
 * Per-DOCUMENT blocker flags: a document can be replaced by a navigation
 * while the window persists (iframes!), so window-level flags would leave
 * the new document unguarded. Flags live on the document itself.
 */
function docHasBlocker(doc: Document, kind: "enter" | "click"): boolean {
  return (doc as unknown as Record<string, unknown>)[`__ca${kind}BlockerInstalled`] === true;
}
function markDocBlocker(doc: Document, kind: "enter" | "click"): void {
  (doc as unknown as Record<string, unknown>)[`__ca${kind}BlockerInstalled`] = true;
}

function installEnterBlocker(cfg: FullConfig): void {
  if (cfg.confirmBeforeSubmit !== true) return;
  if (docHasBlocker(document, "enter")) return;
  markDocBlocker(document, "enter");
  installEnterBlockerOnDoc(cfg, document);
}

/**
 * Enter-implicit-submission interception. Per the HTML spec an Enter
 * keypress in a single-line input triggers the form's DEFAULT BUTTON
 * ('input[type=submit]', 'button[type=submit]', or an untyped button in the
 * form) and falls back to plan B — DIRECT form submission — when the form
 * has NO submit button at all. Both cases submit; BOTH must be gated (a
 * form without any submit button is a real, common pattern). The listener
 * therefore gates EVERY Enter in a non-textarea text-entry control inside a
 * form — the button-existence check must not become an escape hatch.
 */
function installEnterBlockerOnDoc(cfg: FullConfig, doc: Document): void {
  doc.addEventListener(
    "keydown",
    (ev: Event) => {
      const keyEv = ev as KeyboardEvent;
      if (keyEv.key !== "Enter") return;
      const target = keyEv.target;
      // Realm-agnostic element check: the closure may be created in the
      // parent realm while the event target lives in a child frame's realm —
      // `instanceof Element` FAILS across realms (verified in the adversarial
      // audit). nodeType 1 = ELEMENT_NODE in every realm.
      if (!target || (target as Node).nodeType !== 1) return;
      const el = target as Element;
      const form = el.closest("form");
      if (!form) return;
      // Text-entry controls only: Enter inside a textarea is a literal
      // newline, not implicit submission. tagName checks, not instanceof —
      // same cross-realm reason as above.
      const tag = el.tagName.toUpperCase();
      const isTextArea = tag === "TEXTAREA";
      const isTextEntry =
        tag === "INPUT" ||
        tag === "SELECT" ||
        (el as HTMLElement).isContentEditable === true;
      if (isTextArea || !isTextEntry) return;
      keyEv.preventDefault();
      keyEv.stopPropagation();
      const helpers = cfg.__caSubmitHelpers;
      const describeTarget = helpers
        ? helpers.describe(el)
        : el.tagName.toLowerCase();
      const text = ((el as HTMLInputElement).value || "").trim().slice(0, 120);
      const stepIndex = currentStepIndex;
      const win = doc.defaultView ?? window;
      void gateFlow(
        cfg,
        "enter-key",
        describeTarget,
        text || "(Enter pressed)",
        stepIndex,
        async () => {
          // Approved: re-fire the exact default action that was blocked.
          if (typeof (form as HTMLFormElement).requestSubmit === "function") {
            (form as HTMLFormElement).requestSubmit();
          } else {
            (form as HTMLFormElement).submit();
          }
          return "Enter submission re-fired after approval";
        },
        win,
      );
    },
    { capture: true },
  );
}

// Same-origin iframe propagation: addInitScript runs in every frame, but a
// frame's document can be REPLACED at any time (src load finishing after our
// install, page-JS navigation, reload). installBlockerInFramesOnWin walks
// every same-origin child frame; it is called (a) at hook install, (b) on
// every window load event, and (c) periodically by the frame watcher below,
// so a replaced document is re-guarded on the next sweep. Cross-origin
// frames stay out of reach (documented limit).
function installBlockerInFramesOnWin(owner: Window, cfg: FullConfig): void {
  for (let i = 0; i < owner.frames.length; i++) {
    try {
      const win = owner.frames[i];
      // Any cross-origin access throws — this line is the same-origin test.
      void win.document;
      if (!docHasBlocker(win.document, "enter")) {
        markDocBlocker(win.document, "enter");
        installEnterBlockerOnDoc(cfg, win.document);
        installBlockerInFramesOnWin(win, cfg);
      }
      if (!docHasBlocker(win.document, "click")) {
        markDocBlocker(win.document, "click");
        installClickBlockerOnDoc(cfg, win.document);
      }
    } catch {
      /* cross-origin frame — documented limit, skipped */
    }
  }
}

function installBlockerInFrames(cfg: FullConfig): void {
  installBlockerInFramesOnWin(window, cfg);
}

/**
 * Frame watcher: same-origin child-frame documents can finish loading (or
 * be swapped by page JS) AFTER hook installation — the initial sweep then
 * guards a document that is about to be replaced. A lightweight interval
 * re-sweeps for the life of the page (300 ms), re-installing on any new
 * document (per-document flags make re-install a cheap no-op otherwise).
 * This is the SAME trust boundary as Playwright's addInitScript: same-origin
 * content only.
 */
function installFrameWatcher(cfg: FullConfig): void {
  const w = window as unknown as { __caFrameWatcherInstalled?: boolean };
  if (w.__caFrameWatcherInstalled) return;
  w.__caFrameWatcherInstalled = true;
  window.addEventListener("load", () => installBlockerInFrames(cfg));
  const iv = setInterval(() => {
    try {
      // A navigated-away window throws on setInterval keepalive access.
      installBlockerInFrames(cfg);
    } catch {
      clearInterval(iv);
    }
  }, 300);
  // Do not keep the process alive for the watcher.
  const ivAny = iv as unknown as { unref?: () => void };
  ivAny.unref?.();
}

/**
 * Page-level click gate (hardened layer, adversarial-audit vector 1).
 *
 * Closes the synthetic-click bypass: page JS (or a future vendor
 * script-execution tool) can dispatch a MouseEvent('click') on a submit
 * button — the tool-level click gate never sees it. isTrusted CANNOT
 * discriminate here: page-agent's own clickElement() dispatches synthetic
 * events too (verified in page-controller 1.12.4). Instead, a flag set
 * around APPROVED agent clicks lets the listener distinguish "the agent's
 * (already approved) click is dispatching" from "page JS is clicking".
 *
 * When gated: any click on a submit-like element NOT carrying the flag is
 * blocked (default prevented) and routed through gateFlow. The approved
 * proceed() re-dispatches under the flag, so the action executes normally.
 */
function installClickBlockerOnDoc(cfg: FullConfig, doc: Document): void {    doc.addEventListener(
    "click",
    (ev: Event) => {
      const clickEv = ev as MouseEvent;
      // Approved agent click in flight: let it through untouched.
      if ((doc.defaultView as Window | null)?.__caAgentClickInProgress === true) return;
      const target = clickEv.target;
      // Realm-agnostic element check (see installEnterBlockerOnDoc).
      if (!target || (target as Node).nodeType !== 1) return;
      const helpers = cfg.__caSubmitHelpers;
      if (!helpers) return;
      const el = (target as Element).closest(
        "button, input[type=submit], input[type=image], [role=button], a",
      );
      if (!el || !helpers.isSubmitLike(el)) return;
      // Block the un-approved submission click.
      clickEv.preventDefault();
      clickEv.stopPropagation();
      const desc = helpers.describe(el);
      const text = ((el.textContent || "") + " " + (el.getAttribute?.("aria-label") || ""))
        .trim()
        .slice(0, 120);
      const win = doc.defaultView ?? window;
      void gateFlow(
        cfg,
        "click",
        desc + " (page-level)",
        text || "(click)",
        currentStepIndex,
        async () => {
          // Approved: re-dispatch the click under the agent flag.
          win.__caAgentClickInProgress = true;
          try {
            (el as HTMLElement).click();
          } finally {
            win.__caAgentClickInProgress = false;
          }
          return "Submission click re-fired after approval";
        },
        win,
      );
    },
    { capture: true },
  );
}

function installClickBlocker(cfg: FullConfig): void {
  if (cfg.confirmBeforeSubmit !== true) return;
  if (docHasBlocker(document, "click")) return;
  markDocBlocker(document, "click");
  installClickBlockerOnDoc(cfg, document);
}

// Test/probe hook: install the page-level gate hooks (Enter blocker + iframe
// propagation) without dispatching an agent task. Used by the adversarial
// gate audit and the hardening regression tests.
(window as unknown as { __caInstallGatePageHooks?: () => void }).__caInstallGatePageHooks = () => {
  const c = window.__caCfg;
  if (!c) return;
  installEnterBlocker(c);
  installClickBlocker(c);
  installBlockerInFrames(c);
  installFrameWatcher(c);
};

document.addEventListener("ca-browser-task", (ev: Event) => {
  const detail = (ev as CustomEvent<string>).detail;
  const cfg = window.__caCfg;
  if (!detail || !cfg || state().busy) return;
  ensureEnterBlocker();
  installClickBlocker(cfg);
  installBlockerInFrames(cfg);
  installFrameWatcher(cfg);
  void runTask(detail, cfg);
});

// Single-shot mode: host sets CFG (with autoRun + task) before injecting.
const cfg = window.__caCfg;
if (cfg?.autoRun && cfg.task) {
  ensureEnterBlocker();
  installClickBlocker(cfg);
  installBlockerInFrames(cfg);
  installFrameWatcher(cfg);
  void runTask(cfg.task, cfg);
}

export {};
