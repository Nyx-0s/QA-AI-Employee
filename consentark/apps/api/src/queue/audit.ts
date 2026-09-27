import type { LLMPlan } from "@consentark/shared";
import type { LogPhase, LogLevel } from "@consentark/shared";
import type { LLMClientEvent } from "../llm/provider.js";
import type { TaskRepository } from "../db/repositories/tasks.js";
import { truncate } from "../util/ids.js";
import type { StreamedStep } from "../browser/pageTypes.js";
import type { ProxyRequestRecord } from "../browser/llmProxy.js";

/**
 * The ConsentArk audit log — a product requirement, not a nice-to-have.
 *
 * Every AI decision lands in task_logs as a sentence a non-technical client
 * can read: which model ran, what was asked, what it produced, what it
 * cost in tokens, and what failed. Structured detail rides in `data`,
 * never inside the message text.
 */
export class TaskAuditLogger {
  constructor(private readonly tasks: TaskRepository) {}

  log(
    taskId: string,
    level: LogLevel,
    phase: LogPhase,
    message: string,
    data?: unknown,
  ): void {
    this.tasks.appendLog(
      taskId,
      { at: new Date().toISOString(), level, phase, message },
      data,
    );
  }

  info(taskId: string, phase: LogPhase, message: string, data?: unknown): void {
    this.log(taskId, "info", phase, message, data);
  }

  warn(taskId: string, phase: LogPhase, message: string, data?: unknown): void {
    this.log(taskId, "warn", phase, message, data);
  }

  error(taskId: string, phase: LogPhase, message: string, data?: unknown): void {
    this.log(taskId, "error", phase, message, data);
  }

  /** Persist the LLM's plan and record the decision in plain language. */
  planProduced(taskId: string, plan: LLMPlan): void {
    this.tasks.setPlan(taskId, plan);
    this.info(
      taskId,
      "plan",
      `Employee planned ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}${
        plan.rationale ? `: ${truncate(plan.rationale, 160)}` : ""
      }`,
      { steps: plan.steps },
    );
  }

  /**
   * One agent step (click, type, extract…) as a readable audit line:
   * "Step 2: input_text → 'Grace Hopper' — 🎯 Fill the name field".
   */
  browserStep(taskId: string, step: StreamedStep, index: number): void {
    if (step.type === "step") {
      const goal = step.reflection?.next_goal ? ` — ${truncate(step.reflection.next_goal, 120)}` : "";
      this.info(
        taskId,
        "browser",
        `Step ${step.stepIndex ?? index}: ${step.tool ?? "(unknown tool)"} → ${truncate(String(step.output ?? step.input ?? ""), 140)}${goal}`,
      );
      return;
    }
    if (step.type === "error") {
      this.error(taskId, "browser", `Agent error: ${truncate(step.message ?? "(no message)", 200)}`);
      return;
    }
    if (step.type === "retry") {
      this.warn(taskId, "browser", `Agent retry: ${truncate(step.message ?? "", 160)}`);
    }
    // observations / user_takeover stay unlogged — noise for a client audit.
  }

  /** One proxied page-agent LLM call as a readable audit line. */
  fromProxyRecord(taskId: string, record: ProxyRequestRecord): void {
    if (record.status >= 400) {
      this.error(
        taskId,
        "llm",
        `Model call failed with status ${record.status} after ${record.durationMs} ms (model ${record.model}).`,
      );
      return;
    }
    this.info(
      taskId,
      "llm",
      `Model call served in ${record.durationMs} ms (model ${record.model}, ${record.promptChars} chars of page context sent).`,
    );
  }

  /** Translate a provider event into a human-readable audit line. */
  fromLLMEvent(taskId: string, event: LLMClientEvent): void {
    switch (event.type) {
      case "request":
        this.info(
          taskId,
          "llm",
          `Calling ${event.provider} (model ${event.model}) with ${event.messageCount} message${event.messageCount === 1 ? "" : "s"} — attempt ${event.attempt}.`,
        );
        break;
      case "retry":
        this.warn(
          taskId,
          "llm",
          `Attempt ${event.attempt} failed (${event.code}): ${truncate(event.message, 200)}. Retrying in ${event.delayMs} ms.`,
        );
        break;
      case "response": {
        const tokens =
          event.promptTokens !== null && event.completionTokens !== null
            ? ` — tokens: ${event.promptTokens} in / ${event.completionTokens} out`
            : "";
        const via = event.routedVia ? `, served by ${event.routedVia}` : "";
        this.info(
          taskId,
          "llm",
          `${event.provider} replied in ${event.latencyMs} ms (model ${event.model}${via}${tokens}).`,
        );
        break;
      }
      case "error":
        this.error(taskId, "llm", `${event.provider} call failed (${event.code}): ${truncate(event.message, 200)}.`);
        break;
    }
  }
}
