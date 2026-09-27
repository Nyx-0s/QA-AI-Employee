/**
 * BrowserService — the employee's hands (Phase 2).
 *
 * Evolves the spike driver (BrowserSpike.ts) into a long-lived service:
 * - ONE shared headless Chromium with a BOUNDED pool of BrowserContexts
 *   (BROWSER_POOL_SIZE, one context per concurrent task, disposed after
 *   each task — isolation + memory cleanup),
 * - per-task injection + consent gate + streaming audit callbacks,
 * - allowlist enforced twice: at the Playwright context routing (never
 *   touches non-allowed hosts) and at navigation (clear error),
 * - one LLM proxy per service instance (all page-agent model calls flow
 *   through it; the real upstream key never enters the page),
 * - screenshots at task start, on gate pause, and on completion.
 */
import { chromium, type Browser, type Page } from "playwright";
import { join, resolve } from "node:path";
import {
  HostBindings,
  CONFIG_MERGE_JS,
  FETCH_BRIDGE,
  STOP_AGENT_JS,
} from "./contract.js";
import { buildInjectionBundle } from "./buildInjectionBundle.js";
import { startLlmProxy, type LlmProxy, type ProxyRequestRecord } from "./llmProxy.js";
import type { StreamedStep, GateInfo } from "./pageTypes.js";

export type { GateInfo };

export interface ScreenshotRef {
  name: string;
  /** Path relative to DATA_DIR (what the task record stores). */
  path: string;
}

export interface BrowserTaskSpec {
  /** Absolute URL to open (allowlist-checked at enqueue AND at navigation). */
  url: string;
  /** What the employee should accomplish, in one instruction. */
  objective: string;
  /** The EMPLOYEE's allowlist (suffix match) — enforced per context. */
  allowedDomains: string[];
  /** Upstream OpenAI-compatible endpoint for THIS employee's backend. */
  upstreamUrl: string;
  /** Authorization header sent upstream; never exposed to the page. */
  upstreamApiKey?: string;
  /** Model id the agent requests (employee.model). */
  llmModel: string;
  /** Step cap forwarded to page-agent's maxSteps (clamped to hard cap). */
  maxSteps: number;
  /** Consent gate: pause before any submit-like click for human approval. */
  confirmBeforeSubmit: boolean;
  /** Called on every agent step (historychange stream) — audit trail. */
  onStep: (step: StreamedStep, index: number) => void;
  /** Called on every proxied LLM request — audit trail (phase llm). */
  onLlmRequest: (record: ProxyRequestRecord) => void;
  /** Called when the gate trips, BEFORE the task pauses. */
  onGateTripped: (info: GateInfo, screenshot: ScreenshotRef | null) => void;
  /**
   * Called each time a gate trip starts WAITING for a decision (per trip).
   * `resolve` settles THAT trip: "approved" resumes the in-page action,
   * "cancelled" aborts it. The caller (TaskRunner) holds it so a later
   * approve/cancel REST call can unblock the page. Resolving twice is
   * harmless (a promise settles once); the service keeps its own FIFO for
   * timeout/cancel cleanup.
   */
  onGatePending: (
    info: GateInfo,
    resolve: (decision: "approved" | "cancelled") => void,
  ) => void;
  /** Optional cancel signal polled while the agent runs. */
  shouldCancel?: () => boolean;
  /** Where screenshots land (absolute). */
  dataDir: string;
}

export interface BrowserRunResult {
  ok: boolean;
  agentSuccess: boolean;
  agentData: string;
  steps: number;
  llmRequests: ProxyRequestRecord[];
  screenshots: ScreenshotRef[];
  error?: string;
  /** A gate trip was rejected by the reviewer (the agent aborted itself). */
  gateCancelled: boolean;
  /** Full step log (diagnostics + tests). */
  stepLog: StreamedStep[];
}

/** Typed failure for the browser path — maps 1:1 to task.error codes. */
export class BrowserError extends Error {
  constructor(
    public readonly code:
      | "domain_not_allowed"
      | "navigation_failed"
      | "injection_failed"
      | "agent_failed"
      | "agent_timeout"
      | "max_steps_exceeded"
      | "output_schema_mismatch"
      | "cancelled",
    message: string,
  ) {
    super(message);
    this.name = "BrowserError";
  }
}

export interface BrowserServiceOptions {
  /** Bounded context pool: one context per concurrent task. */
  poolSize: number;
  /** Overall per-task timeout (also navigation timeout). */
  timeoutMs: number;
  /** Hard cap for maxSteps (employee cap clamps to this). */
  maxStepsHardCap: number;
  headless?: boolean;
}

export class BrowserService {
  private browser: Browser | null = null;
  private bundle: string | null = null;
  private readonly slots: boolean[];
  /** Tasks waiting for a browser slot (FIFO). */
  private readonly waiters: Array<() => void> = [];
  private launching: Promise<void> | null = null;

  constructor(private readonly opts: BrowserServiceOptions) {
    if (opts.poolSize < 1) throw new Error("poolSize must be >= 1");
    this.slots = Array.from({ length: opts.poolSize }, () => false);
  }

  /** Number of contexts currently running tasks. */
  get busyCount(): number {
    return this.slots.filter(Boolean).length;
  }

  /**
   * Start the shared browser and build the injection bundle once.
   * Idempotent — safe to call per-task (internally awaits the first call).
   */
  async ensureStarted(): Promise<void> {
    if (this.launching) return this.launching;
    this.launching = (async () => {
      this.browser = await chromium.launch({ headless: this.opts.headless ?? true });
      this.bundle = await buildInjectionBundle();
    })();
    return this.launching;
  }

  /** True if url's host is on the allowlist (suffix match). */
  isAllowed(url: string, allowedDomains: string[]): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return allowedDomains.some((d) => {
        const dd = d.toLowerCase();
        return host === dd || host.endsWith("." + dd);
      });
    } catch {
      return false;
    }
  }

  /** FIFO acquire of a browser slot. */
  private async acquireSlot(): Promise<void> {
    const idx = this.slots.indexOf(false);
    if (idx !== -1) {
      this.slots[idx] = true;
      return;
    }
    await new Promise<void>((res) => this.waiters.push(res));
  }

  private releaseSlot(): void {
    const idx = this.slots.indexOf(true);
    if (idx !== -1) this.slots[idx] = false;
    const next = this.waiters.shift();
    if (next) next();
  }

  /**
   * Run one browser task end-to-end in its own context:
   * slot → context → inject → navigate → gate/stream → done → dispose.
   */
  async runTask(spec: BrowserTaskSpec): Promise<BrowserRunResult> {
    await this.ensureStarted();
    await this.acquireSlot();
    // Proxy per task: per-employee upstream (cloud/local), audit isolation,
    // and clean teardown. A local, not an instance field — two concurrent
    // tasks each get their own proxy with no shared state.
    const proxy = await startLlmProxy({
      upstreamUrl: spec.upstreamUrl,
      upstreamApiKey: spec.upstreamApiKey,
      timeoutMs: 30_000,
      maxRetries: 1,
      onRequest: (record) => {
        try {
          spec.onLlmRequest(record);
        } catch {
          /* audit hook failure must not break the proxy */
        }
      },
    });
    try {
      return await this.runTaskInner(spec, proxy);
    } finally {
      await proxy.close().catch(() => undefined);
      this.releaseSlot();
    }
  }

  private async runTaskInner(
    spec: BrowserTaskSpec,
    proxy: LlmProxy,
  ): Promise<BrowserRunResult> {
    const browser = this.browser;
    if (!browser) throw new Error("browser not started");
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const screenshots: ScreenshotRef[] = [];
    const stepLog: StreamedStep[] = [];
    let gateFired = false;
    /** Resolvers for gate trips currently blocked in-page (FIFO per task). */
    const gateResolvers: Array<(d: "approved" | "cancelled") => void> = [];
    const resolveOldestGate = (d: "approved" | "cancelled"): void => {
      const resolve = gateResolvers.shift();
      if (resolve) resolve(d);
    };
    let pendingGate = false; // gate binding awaited at least once
    /**
     * Approval-pause bookkeeping: the per-task deadline (timeoutMs) must NOT
     * consume wall-clock time while a gated task sits waiting for a human.
     * CI never saw this — approve is immediate there — but on a live operator
     * desk an approval slower than BROWSER_TIMEOUT_MS killed the task with
     * agent_timeout (found by the Phase 5 composed-stack evidence run).
     */
    let pausedTimeout: { remainingMs: number } | null = null;
    let timeoutAt: number | null = null;

    try {
      const page = await context.newPage();

      // ── allowlist routing: main frame + subresources ──
      const allowed = spec.allowedDomains.map((d) => d.toLowerCase());
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          void route.abort();
          return;
        }
        const host = url.hostname.toLowerCase();
        const ok = allowed.some((d) => host === d || host.endsWith("." + d));
        if (ok) void route.continue();
        else void route.abort();
      });

      // ── streaming audit: every agent step → Node ──
      await context.exposeFunction(HostBindings.STEPS, (steps: StreamedStep[]) => {
        for (let i = stepLog.length; i < steps.length; i++) {
          const step = steps[i];
          stepLog.push(step);
          try {
            spec.onStep(step, i);
          } catch {
            /* audit failure must not kill the task */
          }
        }
      });

      // ── consent gate bindings ──
      // APPROVAL_REQUEST fires for every submit-like click: gated (pause for
      // approval) or audit-only (auto-submit recorded, click proceeds).
      await context.exposeBinding(
        HostBindings.APPROVAL_REQUEST,
        async (_source, info: GateInfo) => {
          try {
            if (info.gated) {
              if (gateFired) return;
              gateFired = true;
            }
            const shot = info.gated
              ? await this.capture(page, spec.dataDir, `gate-step${info.stepIndex}`)
              : null;
            if (shot) screenshots.push(shot);
            spec.onGateTripped(info, shot);
          } catch {
            /* audit failure must not kill the task */
          }
        },
      );

      await context.exposeBinding(
        HostBindings.APPROVAL_DECISION,
        async (source, info: GateInfo): Promise<"approved" | "cancelled"> => {
          // The gate tool blocks HERE (in-page) until this promise resolves —
          // the page cannot submit until a human (or the cancel path) answers.
          void source;
          pendingGate = true;
          const decisionPromise = new Promise<"approved" | "cancelled">((res) => {
            gateResolvers.push(res);
            // Hand the resolver to the caller: approve/cancel REST calls
            // settle THIS trip through it.
            try {
              spec.onGatePending(info, res);
            } catch {
              /* callback failure must not break the bridge */
            }
          });
          if (info.gated && timeoutAt !== null) {
            // PAUSE: freeze the remaining deadline budget at gate-open ...
            pausedTimeout = { remainingMs: Math.max(timeoutAt - Date.now(), 0) };
            timeoutAt = null;
            void decisionPromise.finally(() => {
              // ... RESUME: restore whatever remained when the human answered.
              timeoutAt = Date.now() + (pausedTimeout?.remainingMs ?? 0);
              pausedTimeout = null;
            }).catch(() => undefined);
          }
          return decisionPromise;
        },
      );

      // CDP fetch bridge: model calls bypass CSP/PNA; the key stays in Node.
      await context.exposeFunction(
        HostBindings.FETCH,
        async (url: string, optsJson: string): Promise<string> => {
          if (!proxy) throw new Error("proxy closed");
          const opts = JSON.parse(optsJson || "{}") as { body?: string };
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 30_000);
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: opts.body ?? "{}",
              signal: controller.signal,
            });
            const body = await res.text();
            return JSON.stringify({ status: res.status, body });
          } finally {
            clearTimeout(timer);
          }
        },
      );

      // ── injection: bridge first, then bundle (init script = per navigation) ──
      await context.addInitScript(FETCH_BRIDGE);
      await context.addInitScript(this.bundle!);

      // ── navigate with allowlist + timeout ──
      if (!this.isAllowed(spec.url, spec.allowedDomains)) {
        throw new BrowserError("domain_not_allowed", `domain not allowed: ${new URL(spec.url).hostname}`);
      }
      try {
        await page.goto(spec.url, { waitUntil: "load", timeout: this.opts.timeoutMs });
      } catch (err) {
        throw new BrowserError("navigation_failed", `Navigation failed: ${String(err)}`);
      }

      // Start screenshot (evidence at task start).
      const startShot = await this.capture(page, spec.dataDir, "start");
      if (startShot) screenshots.push(startShot);

      // ── configure the agent (JSON first, then pure-JS merge) ──
      const maxSteps = Math.min(spec.maxSteps, this.opts.maxStepsHardCap);
      await page.evaluate((cfg) => {
        (window as unknown as { __caCfgData?: unknown }).__caCfgData = cfg;
      }, {
        baseURL: proxy.url,
        apiKey: "pa-proxy",
        model: spec.llmModel,
        maxSteps,
        stepDelay: 0.1,
        language: "en-US",
        autoRun: false,
        confirmBeforeSubmit: spec.confirmBeforeSubmit,
      });
      await page.evaluate(CONFIG_MERGE_JS);

      // ── run the agent ──
      const donePromise = page
        .evaluate(
          () =>
            new Promise<void>((res) => {
              document.addEventListener("ca-browser-done", () => res(), { once: true });
            }),
        )
        .catch(() => undefined);

      await page.evaluate((t) => {
        document.dispatchEvent(new CustomEvent("ca-browser-task", { detail: t }));
      }, spec.objective);

      // ── race: done vs timeout vs cancellation ──
      // The timeout clock is deadline-based (timeoutAt) so it can be paused
      // while a gated task waits for human approval: human latency is not
      // agent latency.
      timeoutAt = Date.now() + this.opts.timeoutMs;
      let deadlineTimer: ReturnType<typeof setInterval> | null = null;
      const outcome = await Promise.race([
        donePromise.then(() => "done" as const),
        new Promise<"timeout">((res) => {
          deadlineTimer = setInterval(() => {
            if (timeoutAt !== null && Date.now() >= timeoutAt) res("timeout");
          }, 500);
          deadlineTimer.unref?.();
        }),
        ...(spec.shouldCancel
          ? [
              new Promise<"cancelled">((res) => {
                const iv = setInterval(() => {
                  if (spec.shouldCancel?.()) {
                    clearInterval(iv);
                    res("cancelled");
                  }
                }, 200);
              }),
            ]
          : []),
      ]);
      // Whatever won the race, the deadline poller has no more work to do.
      if (deadlineTimer) clearInterval(deadlineTimer);
      if (outcome === "cancelled") {
        await page.evaluate(STOP_AGENT_JS).catch(() => undefined);
        resolveOldestGate("cancelled");
        throw new BrowserError("cancelled", "Task cancelled while running");
      }
      if (outcome === "timeout") {
        await page.evaluate(STOP_AGENT_JS).catch(() => undefined);
        resolveOldestGate("cancelled");
        throw new BrowserError("agent_timeout", `browser task timed out after ${this.opts.timeoutMs}ms`);
      }
      void pendingGate;

      // ── collect result ──
      const st = await page
        .evaluate(() =>
          (window as unknown as {
            __caPageAgentState?: {
              result?: { success: boolean; data: string; steps: number };
              error?: string;
              gateCancelled?: boolean;
            };
          }).__caPageAgentState ?? null,
        )
        .catch(() => null);
      const agentResult = st?.result;
      const agentError = st?.error;

      // Completion screenshot.
      const endShot = await this.capture(page, spec.dataDir, "end");
      if (endShot) screenshots.push(endShot);

      return {
        ok: Boolean(agentResult?.success),
        agentSuccess: Boolean(agentResult?.success),
        agentData: agentResult?.data ?? "",
        steps: agentResult?.steps ?? stepLog.filter((s) => s.type === "step").length,
        llmRequests: [...proxy.requests],
        screenshots,
        error: agentError,
        gateCancelled: st?.gateCancelled === true,
        stepLog,
      };
    } finally {
      // Approval-wait cleanup: if the task ends while any gate trip is
      // pending (timeout/cancel), resolve the in-page blockers so the page
      // can settle before the context is disposed.
      while (gateResolvers.length > 0) {
        try {
          resolveOldestGate("cancelled");
        } catch {
          /* already resolved */
        }
      }
      // Context disposal is unconditional: a failed task must not leak memory.
      try {
        await context.close();
      } catch {
        /* already closed */
      }
    }
  }

  /**
   * Capture a screenshot. The ref path is ABSOLUTE; the caller (runner)
   * relativizes against DATA_DIR before persisting to the task record.
   * Failures never mask the task result.
   */
  private async capture(page: Page, dataDir: string, name: string): Promise<ScreenshotRef | null> {
    try {
      const abs = join(resolve(dataDir), `task-${name}-${Date.now()}.png`);
      await page.screenshot({ path: abs, fullPage: false });
      return { name, path: abs };
    } catch {
      return null;
    }
  }

  /** Stop the shared browser (graceful shutdown). The proxy is per-task. */
  async close(): Promise<void> {
    try {
      await this.browser?.close();
    } catch {
      /* already closed */
    }
    this.browser = null;
  }
}
