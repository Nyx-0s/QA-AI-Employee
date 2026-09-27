import type {
  ApprovalRequest,
  Employee,
  LLMPlan,
  Task,
  TaskCreateInput,
} from "@consentark/shared";
import type { Config } from "../config/env.js";
import { LLMError } from "../llm/provider.js";
import type { ProviderRegistry } from "../llm/factories.js";
import type { TaskRepository } from "../db/repositories/tasks.js";
import type { EmployeeRepository } from "../db/repositories/employees.js";
import { TaskAuditLogger } from "./audit.js";
import type { TaskQueue } from "./queue.js";
import { sleep } from "../llm/resilience.js";
import { newId, truncate } from "../util/ids.js";
import { validateAgainstSchema } from "../util/schemaValidate.js";
import { BrowserError, BrowserService } from "../browser/BrowserService.js";
import type {
  BrowserTaskSpec,
  BrowserRunResult,
} from "../browser/BrowserService.js";
import { resolve } from "node:path";

/**
 * Executes queued tasks in-process.
 *
 * Chat task flow: build messages → call the employee's LLM backend → parse
 * a JSON plan (audit-logged) → return the reply.
 *
 * Browser task flow (Phase 2): acquire a context from the bounded pool →
 * inject page-agent → run the agent loop with the consent gate → stream
 * steps + LLM calls into the audit log → validate outputSchema → persist
 * output. Submit-like clicks trip the gate: status → awaiting_approval,
 * resume on /approve, abort on /cancel.
 *
 * Durability: tasks are persisted before execution; recover() re-enqueues
 * `queued` rows. awaiting_approval tasks are NOT touched by recovery —
 * they keep waiting for a human decision across restarts.
 */
export class TaskRunner {
  private readonly audit: TaskAuditLogger;
  private running = false;
  private inFlight = 0;
  /** Started lazily on first browser task; one shared Chromium. */
  private browserService: BrowserService | null = null;
  /** Cancel flag per in-flight task id (cancel endpoint sets true). */
  private readonly cancelled = new Set<string>();
  /**
   * Pending gate-trip resolvers per task (FIFO: oldest first). Each trip
   * (click, newline, enter-key) pushes its page-side resolver; approve()
   * and cancel() settle the OLDEST one — matching the in-page FIFO.
   */
  private readonly gateResolvers = new Map<string, Array<(d: "approved" | "cancelled") => void>>();
  private sweeperTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly queue: TaskQueue,
    private readonly providers: ProviderRegistry,
    private readonly tasks: TaskRepository,
    private readonly employees: EmployeeRepository,
  ) {
    this.audit = new TaskAuditLogger(tasks);
  }

  /** Create a chat task for an employee, persist it, and queue it. */
  createChatTask(employee: Employee, message: string): Task {
    const input: TaskCreateInput = {
      employeeId: employee.id,
      type: "chat",
      objective: message,
    };
    const task = this.tasks.create(newId("tsk"), employee.id, input, new Date().toISOString());
    this.audit.info(
      task.id,
      "system",
      `Task queued for ${employee.name}: ${truncate(message, 160)}`,
    );
    this.queue.enqueue(task.id);
    return task;
  }

  /** Create a browser task, persist it, and queue it (URL validated by caller). */
  createBrowserTask(employee: Employee, input: TaskCreateInput): Task {
    const task = this.tasks.create(newId("tsk"), employee.id, input, new Date().toISOString());
    this.audit.info(
      task.id,
      "system",
      `Browser task queued for ${employee.name}: ${truncate(input.objective, 140)} → ${input.url ?? "(no url)"}`,
    );
    this.queue.enqueue(task.id);
    return task;
  }

  /**
   * Re-enqueue work after a restart. `queued` rows re-enter the queue;
   * rows a crash interrupted re-run. awaiting_approval rows are left alone —
   * the consent gate survives restarts by design.
   */
  recover(): number {
    const { queued, interrupted } = this.tasks.listForRecovery();
    let recovered = 0;
    for (const task of interrupted) {
      this.tasks.setStatus(task.id, "queued", new Date().toISOString());
      this.audit.info(
        task.id,
        "system",
        "Task was interrupted by a server restart — re-queued automatically.",
      );
      this.queue.enqueue(task.id);
      recovered++;
    }
    for (const task of queued) {
      this.queue.enqueue(task.id);
      recovered++;
    }
    return recovered;
  }

  start(): void {
    this.running = true;
    this.startSweeper();
    void this.loop();
  }

  /** Stop the worker and release the shared browser when idle. */
  stop(): void {
    this.running = false;
    if (this.sweeperTimer) {
      clearInterval(this.sweeperTimer);
      this.sweeperTimer = null;
    }
    void this.browserService?.close();
    this.browserService = null;
  }

  /**
   * The consent clock: auto-cancel awaiting_approval tasks older than
   * APPROVAL_TIMEOUT_HOURS, with a plain-language audit entry.
   */
  private startSweeper(): void {
    const sweep = (): void => {
      try {
        const cutoff = Date.now() - this.config.APPROVAL_TIMEOUT_HOURS * 3_600_000;
        for (const task of this.tasks.listAwaiting()) {
          const at = task.awaitingApproval?.at ?? task.createdAt;
          if (Date.parse(at) < cutoff) {
            this.cancelAwaitingTask(task.id, `approval timeout (${this.config.APPROVAL_TIMEOUT_HOURS}h)`);
          }
        }
      } catch {
        /* sweeper failure must never kill the worker */
      }
    };
    this.sweeperTimer = setInterval(sweep, 60_000);
    this.sweeperTimer.unref?.();
  }

  /** Internal: cancel a task sitting in awaiting_approval (gate or queued). */
  private cancelAwaitingTask(taskId: string, reason: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const pending = this.gateResolvers.get(taskId);
    if (pending && pending.length > 0) {
      // In-page gate resolves "cancelled" → the tool throws AbortError →
      // runBrowserTask maps it to task status cancelled.
      this.gateResolvers.delete(taskId);
      const resolve = pending.shift();
      if (resolve) resolve("cancelled");
    } else if (this.queue.cancel(taskId)) {
      // Still queued (recovered after restart): just cancel the row.
      this.tasks.setStatus(taskId, "cancelled", new Date().toISOString());
      this.audit.warn(taskId, "safety", `Task auto-cancelled: ${reason}.`);
    }
  }

  /** User-facing cancel (POST /api/tasks/:id/cancel). Returns what happened. */
  cancel(taskId: string): { cancelled: boolean; reason?: string } {
    const task = this.tasks.get(taskId);
    if (!task) return { cancelled: false, reason: "task not found" };
    if (task.status === "queued") {
      if (this.queue.cancel(taskId)) {
        this.tasks.setStatus(taskId, "cancelled", new Date().toISOString());
        return { cancelled: true };
      }
      return { cancelled: false, reason: "task already reserved by the worker" };
    }
    if (task.status === "awaiting_approval") {
      const inGate = (this.gateResolvers.get(taskId)?.length ?? 0) > 0;
      this.cancelAwaitingTask(taskId, "cancelled by user");
      if (inGate) {
        // In-flight inside the gate — runBrowserTask finalizes the row.
        return { cancelled: true };
      }
      return { cancelled: true };
    }
    if (task.status === "running") {
      // Cooperative cancel: the flag is polled every 200 ms during the run.
      this.cancelled.add(taskId);
      return { cancelled: true };
    }
    return { cancelled: false, reason: `task is already ${task.status}` };
  }

  /** User-facing approval (POST /api/tasks/:id/approve). */
  approve(taskId: string): { approved: boolean; reason?: string } {
    const task = this.tasks.get(taskId);
    if (!task) return { approved: false, reason: "task not found" };
    if (task.status !== "awaiting_approval") {
      return { approved: false, reason: `task is ${task.status}, not awaiting approval` };
    }
    const req = task.awaitingApproval;
    if (req) {
      this.audit.info(
        taskId,
        "safety",
        `Human approved: "${req.elementText}" on ${req.elementDescription}. Task resumes.`,
      );
    }
    const pending = this.gateResolvers.get(taskId);
    if (pending && pending.length > 0) {
      const resolve = pending.shift();
      if (resolve) resolve("approved");
      return { approved: true };
    }
    // Restart case: the gate promise is gone; clear the state so the row
    // can be re-run from scratch (honest recovery, no fake completion).
    this.tasks.clearAwaitingApproval(taskId);
    this.tasks.setStatus(taskId, "queued", new Date().toISOString());
    this.queue.enqueue(taskId);
    this.audit.info(taskId, "system", "Approved after a restart — task re-queued from the beginning.");
    return { approved: true };
  }

  // ── worker loop ──────────────────────────────────────────

  private async loop(): Promise<void> {
    while (this.running) {
      const taskId = this.queue.popReady();
      if (taskId === null) {
        await sleep(250);
        continue;
      }
      this.inFlight++;
      void this.executeById(taskId).finally(() => {
        this.inFlight--;
        this.queue.complete(taskId);
      });
      while (this.inFlight >= this.config.WORKER_CONCURRENCY) {
        await sleep(50);
      }
    }
  }

  private async executeById(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "queued") return; // cancelled or gone
    const employee = this.employees.get(task.employeeId);
    if (!employee) {
      this.failTask(task, "employee_unavailable", `Employee ${task.employeeId} no longer exists`, false);
      return;
    }
    if (employee.status === "paused") {
      this.failTask(task, "employee_paused", `Employee ${employee.name} is paused — task will not run`, false);
      return;
    }
    // Defense-in-depth (Phase 4): grants are checked at enqueue on both
    // tiers; a task whose tool is no longer granted never executes.
    const requiredTool = task.type === "browser_task" ? "browser_task" : "chat_task";
    if (!employee.toolsEnabled.includes(requiredTool)) {
      this.failTask(
        task,
        "tool_not_enabled",
        `Employee ${employee.name} does not have the ${requiredTool} tool enabled`,
        false,
      );
      return;
    }

    this.tasks.setStatus(task.id, "running", new Date().toISOString());
    this.audit.info(task.id, "system", `Employee ${employee.name} started the task.`);
    try {
      switch (task.type) {
        case "chat":
          await this.runChatTask(task, employee);
          break;
        case "browser_task":
          await this.runBrowserTask(task, employee);
          break;
        case "scheduled":
          this.failTask(task, "not_implemented", "Task type \"scheduled\" is not implemented yet", false);
          return;
      }
    } catch (error) {
      if (error instanceof BrowserError) {
        if (error.code === "cancelled") {
          this.tasks.clearAwaitingApproval(task.id);
          this.audit.warn(task.id, "system", "Task cancelled while running.");
          this.tasks.setError(task.id, {
            code: "cancelled",
            message: "Cancelled by user request",
            retriable: false,
          });
          this.tasks.setStatus(task.id, "cancelled", new Date().toISOString());
          return;
        }
        this.failTask(task, error.code, error.message, error.code === "agent_timeout");
        return;
      }
      const llmError =
        error instanceof LLMError
          ? error
          : new LLMError(
              "internal_error",
              error instanceof Error ? error.message : String(error),
              false,
            );
      this.failTask(task, llmError.code, llmError.message, llmError.retriable);
      return;
    } finally {
      this.cancelled.delete(taskId);
      this.gateResolvers.delete(taskId);
    }
    this.tasks.setStatus(task.id, "done", new Date().toISOString());
  }

  // ── chat execution ───────────────────────────────────────

  private async runChatTask(task: Task, employee: Employee): Promise<void> {
    const request = {
      messages: [
        {
          role: "system" as const,
          content: `${employee.systemPrompt}\n\nRespond helpfully and concisely.`,
        },
        { role: "user" as const, content: task.objective },
      ],
      model: employee.model,
    };

    const primary = this.providers[employee.backend];
    let response;
    try {
      response = await primary.chat(request, (event) =>
        this.audit.fromLLMEvent(task.id, event),
      );
    } catch (error) {
      // Optional privacy-gated fallback: local down → cloud (OFF by default).
      const canFallback =
        employee.backend === "local" &&
        this.config.LOCAL_FALLBACK_TO_CLOUD &&
        error instanceof LLMError &&
        error.retriable;
      if (!canFallback) throw error;
      this.audit.warn(
        task.id,
        "llm",
        "Local backend unavailable — falling back to the cloud backend (LOCAL_FALLBACK_TO_CLOUD is enabled).",
      );
      response = await this.providers.cloud.chat(request, (event) =>
        this.audit.fromLLMEvent(task.id, event),
      );
    }

    // The plan/reply contract: ask the model to emit JSON, but never fail a
    // task just because it replied in prose — the raw reply is still valid.
    const parsed = this.parseModelReply(response.content);
    if (parsed.plan) {
      this.audit.planProduced(task.id, parsed.plan);
    } else {
      this.audit.info(task.id, "plan", "Employee replied directly without a structured plan.");
    }

    const tokens = response.usage ? response.usage.totalTokens : null;
    this.tasks.setOutput(task.id, {
      reply: parsed.reply,
      model: response.model,
      provider: response.provider,
      tokens,
    });
    this.audit.info(
      task.id,
      "system",
      `Employee completed the task — replied in ${response.latencyMs} ms using ${response.provider} (model ${response.model}${tokens !== null ? `, ${tokens} tokens` : ""}).`,
    );
  }

  /** Expected shape: {"steps": [...], "reply": "..."}. Falls back to raw text. */
  private parseModelReply(content: string): { reply: string; plan: LLMPlan | null } {
    let plan: LLMPlan | null = null;
    try {
      const json = JSON.parse(content) as Record<string, unknown>;
      if (json && typeof json === "object") {
        plan = {
          rationale: typeof json.rationale === "string" ? json.rationale : "",
          steps: Array.isArray(json.steps)
            ? json.steps.filter((s): s is string => typeof s === "string")
            : [],
          toolCalls: [],
          model: undefined,
        };
        const reply =
          typeof json.reply === "string"
            ? json.reply
            : typeof json.response === "string"
              ? json.response
              : null;
        if (reply !== null) return { reply, plan };
      }
    } catch {
      // Not JSON — fall through and use the raw text.
    }
    return { reply: content.trim(), plan };
  }

  // ── browser execution (Phase 2) ────────────────────────

  /**
   * Employee-derived browser fields: allowlist + backend (URL/key/model)
   * + step cap. The per-task proxy points at the employee's OWN backend,
   * so cloud and local employees get identical audit coverage.
   */
  private browserSpecFields(employee: Employee): {
    allowedDomains: string[];
    upstreamUrl: string;
    upstreamApiKey?: string;
    llmModel: string;
    maxSteps: number;
  } {
    const upstreamUrl =
      employee.backend === "local" ? this.config.COLIBRI_URL : this.config.FREELLMAPI_URL;
    const upstreamApiKey = employee.backend === "local" ? undefined : this.config.FREELLMAPI_KEY;
    const llmModel = employee.model !== "auto" ? employee.model : this.config.FREELLMAPI_MODEL;
    const maxSteps = Math.min(employee.maxStepsPerTask, this.config.BROWSER_MAX_STEPS_HARD_CAP);
    return {
      allowedDomains: employee.allowedDomains,
      upstreamUrl,
      upstreamApiKey,
      llmModel,
      maxSteps,
    };
  }

  private async runBrowserTask(task: Task, employee: Employee): Promise<void> {
    const fields = this.browserSpecFields(employee);
    const dataDirAbs = resolve(this.config.DATA_DIR);
    const rel = (p: string): string =>
      p.startsWith(dataDirAbs) ? p.slice(dataDirAbs.length + 1) : p;

    if (fields.allowedDomains.length === 0) {
      throw new BrowserError(
        "domain_not_allowed",
        `Employee ${employee.name} has an empty allowlist — no browsing is permitted`,
      );
    }
    if (!task.url) {
      throw new BrowserError("navigation_failed", "browser_task has no url (should have been rejected at enqueue)");
    }

    let gateScreenshotRel: string | null = null;

    const spec: BrowserTaskSpec = {
      url: task.url,
      objective:
        task.objective +
        (task.steps?.length
          ? `\n\nPrescribed steps:\n${task.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
          : ""),
      allowedDomains: fields.allowedDomains,
      upstreamUrl: fields.upstreamUrl,
      upstreamApiKey: fields.upstreamApiKey,
      llmModel: fields.llmModel,
      maxSteps: fields.maxSteps,
      confirmBeforeSubmit: employee.confirmBeforeSubmit,
      dataDir: dataDirAbs,
      onStep: (step, index) => this.audit.browserStep(task.id, step, index),
      onLlmRequest: (record) => this.audit.fromProxyRecord(task.id, record),
      onGateTripped: (info, screenshot) => {
        if (!info.gated) {
          // Audit-only: confirmBeforeSubmit is OFF — the click proceeds, the
          // trail records the auto-submit (the ConsentArk brand promise is
          // observability, even when a human is not in the loop).
          this.audit.warn(task.id, "safety", info.summary);
          return;
        }
        const now = new Date().toISOString();
        if (screenshot) gateScreenshotRel = rel(screenshot.path);
        const request: ApprovalRequest = {
          summary: info.summary,
          elementText: info.elementText,
          elementDescription: info.elementDescription,
          stepIndex: info.stepIndex,
          via: info.via,
          ...(info.inputText !== undefined ? { inputText: info.inputText } : {}),
          at: now,
        };
        if (screenshot) {
          this.tasks.addScreenshot(task.id, rel(screenshot.path));
        }
        this.tasks.setAwaitingApproval(task.id, request, now);
        this.tasks.setStatus(task.id, "awaiting_approval", now);
        this.audit.warn(task.id, "safety", `${info.summary} — task paused for human approval.`);
      },
      // Per-trip decision channel: each gate trip (click, newline, enter-key)
      // hands the runner its page-side resolver. approve()/cancel() settle the
      // OLDEST pending trip for the task — matching the in-page FIFO. This
      // replaces the Phase-2 one-shot gatePromise, which deadlocked a task
      // that tripped the gate more than once.
      onGatePending: (_info, resolve) => {
        const list = this.gateResolvers.get(task.id);
        if (list) list.push(resolve);
      },
      shouldCancel: () => this.cancelled.has(task.id),
    };

    // Per-trip resolver queue: the service registers each gate trip's
    // page-side resolver via onGatePending; approve()/cancel() below settle
    // them FIFO. Nothing to pre-create here — but the queue must exist
    // BEFORE the run starts.
    this.gateResolvers.set(task.id, []);

    try {
      this.browserService ??= new BrowserService({
        poolSize: this.config.BROWSER_POOL_SIZE,
        timeoutMs: this.config.BROWSER_TIMEOUT_MS,
        maxStepsHardCap: this.config.BROWSER_MAX_STEPS_HARD_CAP,
      });
      const service = this.browserService;
      // The gate promise is gone: a tripped gate simply parks runPromise
      // inside the in-page approval bridge until approve()/cancel() resolve
      // the stored resolver. The run continues (or aborts) without any
      // runner-side racing — the service maps the outcome.
      const result = await service.runTask(spec);
      this.finishBrowserTask(task, employee, result, rel, {
        gateApproved: gateScreenshotRel !== null,
        gateScreenshotRel,
      });
    } catch (error) {
      // If the run failed while a gate trip was pending, resolve all pending
      // trips so nothing waits forever, and clear the persisted approval state.
      const pending = this.gateResolvers.get(task.id);
      if (pending) {
        this.gateResolvers.delete(task.id);
        for (const resolve of pending) resolve("cancelled");
      }
      throw error;
    } finally {
      this.gateResolvers.delete(task.id);
    }
  }

  /** Persist a finished browser run: screenshots, output, schema validation. */
  private finishBrowserTask(
    task: Task,
    employee: Employee,
    result: BrowserRunResult,
    rel: (p: string) => string,
    gate: { gateApproved: boolean; gateScreenshotRel: string | null },
  ): void {
    for (const shot of result.screenshots) {
      this.tasks.addScreenshot(task.id, rel(shot.path));
    }
    this.tasks.clearAwaitingApproval(task.id);

    if (gate.gateApproved) {
      this.audit.info(task.id, "safety", "Human approved the submission — task resumed and completed.");
    }

    if (!result.ok) {
      // Reviewer rejected the submission at the gate: the in-page tool set
      // the explicit marker before aborting (page-agent reduces ANY tool
      // error to "Task aborted", so this is the only honest signal).
      if (result.gateCancelled) {
        this.audit.warn(task.id, "safety", "Submission cancelled by reviewer — task aborted at the consent gate.");
        throw new BrowserError("cancelled", "Submission cancelled by reviewer");
      }
      // Agent-level failure: page-agent reported success=false (e.g. it gave
      // up, or maxSteps was exceeded). Distinct code for the step-cap case.
      const maxStepsHit =
        result.error?.includes("Step count exceeded maximum limit") ||
        result.stepLog.some(
          (s) => s.type === "error" && s.message?.includes("Step count exceeded maximum limit"),
        );
      if (maxStepsHit) {
        throw new BrowserError(
          "max_steps_exceeded",
          `Agent exceeded the step cap (${Math.min(employee.maxStepsPerTask, this.config.BROWSER_MAX_STEPS_HARD_CAP)})`,
        );
      }
      throw new BrowserError("agent_failed", result.error ?? "The employee could not complete the task");
    }

    // Structured output: validate agentData against outputSchema when present.
    if (task.outputSchema) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.agentData);
      } catch {
        throw new BrowserError(
          "output_schema_mismatch",
          "The employee's final answer is not valid JSON, but an outputSchema was required",
        );
      }
      const issues = validateAgainstSchema(parsed, task.outputSchema);
      if (issues.length > 0) {
        const detail = issues
          .slice(0, 5)
          .map((i) => `${i.path}: ${i.message}`)
          .join("; ");
        throw new BrowserError("output_schema_mismatch", detail);
      }
      this.tasks.setOutput(task.id, {
        reply: parsed,
        validated: true,
        steps: result.steps,
        model: employee.model,
        provider: "browser",
      });
      this.audit.info(task.id, "browser", `Extraction validated against the requested schema (${result.steps} steps).`);
      return;
    }

    this.tasks.setOutput(task.id, {
      reply: result.agentData,
      steps: result.steps,
      model: employee.model,
      provider: "browser",
    });
  }

  // ── failure handling ─────────────────────────────────────

  private failTask(task: Task, code: string, message: string, retriable: boolean): void {
    this.audit.error(task.id, "system", `Task failed (${code}): ${truncate(message, 200)}`, { code });
    this.tasks.setError(task.id, { code, message, retriable });
    this.tasks.setStatus(task.id, "failed", new Date().toISOString());
  }
}

/* __PART_B_APPEND__ */
