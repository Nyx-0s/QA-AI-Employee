import { z } from "zod";

/**
 * Task domain model.
 *
 * A Task is the unit of work an AI Employee executes. Every AI decision
 * made while running a task is appended to `logs` in human-readable form —
 * this is the client-facing audit trail (product requirement, not a luxury).
 */

export const TASK_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "done",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Zod schema for a task status (reused by downstream read-models). */
export const taskStatusSchema = z.enum(TASK_STATUSES);

export const TASK_TYPES = ["chat", "browser_task", "scheduled"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const LOG_LEVELS = ["info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Which stage of the runner produced a log line. */
export const LOG_PHASES = ["plan", "llm", "tool", "browser", "safety", "system"] as const;
export type LogPhase = (typeof LOG_PHASES)[number];

/** A single tool call the LLM asked for (executed from Phase 2 onward). */
export const llmToolCallSchema = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});
export type LLMToolCall = z.infer<typeof llmToolCallSchema>;

/** The plan an LLM produced for a task — logged for the audit trail. */
export const llmPlanSchema = z.object({
  rationale: z.string().default(""),
  steps: z.array(z.string()).default([]),
  toolCalls: z.array(llmToolCallSchema).default([]),
  /** Model that produced the plan, if known. */
  model: z.string().optional(),
});
export type LLMPlan = z.infer<typeof llmPlanSchema>;

/** Payload for POST /api/tasks. */
export const taskCreateSchema = z
  .object({
    employeeId: z.string().min(1, "employeeId is required"),
    type: z.enum(TASK_TYPES),
    /** What the employee should accomplish, in one instruction. */
    objective: z.string().trim().min(1, "objective is required").max(8000),
    /** Required for browser_task. */
    url: z.string().url().optional(),
    /** Optional prescribed steps the employee should follow. */
    steps: z.array(z.string().min(1)).max(50).optional(),
    /** Optional JSON-schema-ish object the output must conform to. */
    outputSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "browser_task" && !value.url) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "browser_task tasks require a url",
      });
    }
    if (value.type === "chat" && value.url) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "chat tasks do not take a url",
      });
    }
  });
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

/** One human-readable audit log entry. */
export const taskLogSchema = z.object({
  at: z.string(),
  level: z.enum(LOG_LEVELS),
  phase: z.enum(LOG_PHASES),
  /** Plain-language sentence a client can read — never an internal dump. */
  message: z.string(),
  /** Optional structured detail (kept OUT of the message text). */
  data: z.unknown().optional(),
});
export type TaskLog = z.infer<typeof taskLogSchema>;

/** Structured failure information. */
export const taskErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retriable: z.boolean(),
});
export type TaskError = z.infer<typeof taskErrorSchema>;

/**
 * Why a browser task is waiting for a human decision (the consent gate).
 * Populated while status is `awaiting_approval`; cleared once resolved.
 */
export const approvalRequestSchema = z.object({
  /** What the employee was about to do, in plain language. */
  summary: z.string(),
  /** Text of the element about to be activated, e.g. "Submit payment". */
  elementText: z.string(),
  /** Element tag + identifying attributes for the audit trail. */
  elementDescription: z.string(),
  /** The step index at which the gate tripped. */
  stepIndex: z.number().int().min(0),
  /** Which submission path was intercepted (click, newline typed, real Enter). */
  via: z.enum(["click", "newline", "enter-key"]),
  /** For the newline path: the typed text that carried the newline (truncated). */
  inputText: z.string().optional(),
  /** When the task entered `awaiting_approval`. */
  at: z.string(),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

/** Stored task as returned by the API. */
export const taskSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  type: z.enum(TASK_TYPES),
  objective: z.string(),
  url: z.string().nullable(),
  steps: z.array(z.string()).nullable(),
  outputSchema: z.record(z.string(), z.unknown()).nullable(),
  status: z.enum(TASK_STATUSES),
  /** Validated result; shape depends on task type. */
  output: z.unknown().nullable(),
  plan: llmPlanSchema.nullable(),
  error: taskErrorSchema.nullable(),
  /** Consent-gate details; non-null only while awaiting_approval. */
  awaitingApproval: approvalRequestSchema.nullable(),
  logs: z.array(taskLogSchema),
  /** Paths (relative to DATA_DIR) of captured screenshots. */
  screenshots: z.array(z.string()),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Task = z.infer<typeof taskSchema>;
