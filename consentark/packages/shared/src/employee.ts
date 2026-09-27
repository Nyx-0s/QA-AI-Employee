import { z } from "zod";

/**
 * Employee domain model.
 *
 * The three safety fields — allowedDomains, confirmBeforeSubmit and
 * maxStepsPerTask — are NON-NULLABLE and always enforced: they get safe
 * defaults at parse time so an employee can never exist without a safety
 * posture. This is a ConsentArk product requirement ("consent first").
 */

export const EMPLOYEE_ROLES = [
  "data_clerk",
  "outreach_assistant",
  "qa_analyst",
  "lead_ops",
  "support",
  "custom",
] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const EMPLOYEE_STATUSES = ["active", "paused"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYEE_BACKENDS = ["cloud", "local"] as const;
export type EmployeeBackend = (typeof EMPLOYEE_BACKENDS)[number];

/**
 * Tools an employee may be granted. Grants are enforced at enqueue AND at
 * execution (defense-in-depth): a task whose tool is not granted fails with
 * `tool_not_enabled` no matter how it reached the queue.
 */
export const SUPPORTED_TOOLS = ["chat_task", "browser_task"] as const;
export type SupportedTool = (typeof SUPPORTED_TOOLS)[number];

export const employeeScheduleSchema = z.object({
  /** Cron expression; scheduling itself ships in Phase 4/5. */
  cron: z.string().min(1),
  /** Template for the task created on each scheduled run. */
  taskTemplate: z.string().min(1),
});
export type EmployeeSchedule = z.infer<typeof employeeScheduleSchema>;

/** Payload for POST /api/employees. */
export const employeeCreateSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(120),
  role: z.enum(EMPLOYEE_ROLES).default("custom"),
  description: z.string().trim().max(2000).default(""),
  /** The employee's standing instructions — the "brain" configuration. */
  systemPrompt: z.string().trim().min(1, "systemPrompt is required").max(8000),
  /** Which LLM backend serves this employee: FreeLLMAPI (cloud) or Colibrì (local). */
  backend: z.enum(EMPLOYEE_BACKENDS).default("cloud"),
  /** Model id sent to the backend ("auto" lets FreeLLMAPI's router pick). */
  model: z.string().trim().min(1).default("auto"),
  toolsEnabled: z.array(z.enum(SUPPORTED_TOOLS)).default([]),
  /**
   * SAFETY: domains the employee's browser automation may touch.
   * Empty array = the employee may not browse anywhere.
   */
  allowedDomains: z.array(z.string().trim().min(1)).default([]),
  /**
   * SAFETY: when true, any browser task that would submit a form first
   * moves to `awaiting_approval` and waits for a human decision.
   */
  confirmBeforeSubmit: z.boolean().default(true),
  /**
   * SAFETY: hard cap on automation steps per task.
   */
  maxStepsPerTask: z.number().int().min(1).max(200).default(25),
  /** Optional recurring schedule; null = manual/chat/scheduled tasks only. */
  schedule: employeeScheduleSchema.nullable().default(null),
});
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;

/** Payload for PATCH /api/employees/:id — every field optional, plus status. */
export const employeePatchSchema = employeeCreateSchema
  .partial()
  .extend({ status: z.enum(EMPLOYEE_STATUSES).optional() });
export type EmployeePatchInput = z.infer<typeof employeePatchSchema>;

/** Stored employee as returned by the API. */
export const employeeSchema = employeeCreateSchema.extend({
  id: z.string().min(1),
  status: z.enum(EMPLOYEE_STATUSES),
  createdAt: z.string(),
});
export type Employee = z.infer<typeof employeeSchema>;

/** Employee as listed on the Team page (with an aggregate count). */
export const employeeSummarySchema = employeeSchema.extend({
  tasksCompleted: z.number().int().min(0),
});
export type EmployeeSummary = z.infer<typeof employeeSummarySchema>;
