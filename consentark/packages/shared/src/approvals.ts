import { z } from "zod";
import { approvalRequestSchema, taskStatusSchema } from "./task.js";

/**
 * Approvals queue (Phase 3 dashboard).
 *
 * A read-model joined from tasks + employees: everything the operator needs
 * to make a consent decision without opening the raw task record. Built
 * server-side so the dashboard renders from one typed shape.
 */

export const approvalQueueEntrySchema = z.object({
  taskId: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  taskObjective: z.string(),
  taskUrl: z.string().nullable(),
  /** The consent-gate details (what would be submitted, how, since when). */
  approval: approvalRequestSchema,
  /** ISO timestamp the task entered awaiting_approval (= approval.at). */
  awaitingAt: z.string(),
  status: taskStatusSchema,
  /** Latest evidence screenshot (DATA_DIR-relative ref), if one exists. */
  latestScreenshotRef: z.string().nullable(),
});
export type ApprovalQueueEntry = z.infer<typeof approvalQueueEntrySchema>;

/** GET /api/dashboard/config — the few server knobs the dashboard must render. */
export const dashboardConfigSchema = z.object({
  /** The consent clock: awaiting approvals older than this auto-cancel. */
  approvalTimeoutHours: z.number(),
});
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;
