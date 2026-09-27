import type { FastifyPluginAsync } from "fastify";
import { taskCreateSchema } from "@consentark/shared";
import type { AppContext } from "../app.js";
import { newId } from "../util/ids.js";
import { HttpError } from "./httpError.js";

/**
 * Task routes: creation (chat + browser_task), filtered listing, audit-rich
 * detail, cancellation, and the approval gate for the consent flow.
 */
export const taskRoutes: FastifyPluginAsync<{ context: AppContext }> = async (
  app,
  { context },
) => {
  // POST /api/tasks — enqueue work for an employee.
  app.post("/", async (request, reply) => {
    const parsed = taskCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, "validation_error", "Invalid task payload", {
        issues: parsed.error.issues,
      });
    }
    const input = parsed.data;
    const employee = context.employees.get(input.employeeId);
    if (!employee) {
      throw new HttpError(404, "employee_not_found", `No employee with id "${input.employeeId}"`);
    }
    if (employee.status !== "active") {
      throw new HttpError(409, "employee_paused", `Employee "${employee.name}" is paused`);
    }
    // Grants are enforced at enqueue (Phase 4): browser work needs
    // browser_task, chat work needs chat_task.
    const requiredTool = input.type === "browser_task" ? "browser_task" : "chat_task";
    if (!employee.toolsEnabled.includes(requiredTool)) {
      throw new HttpError(
        409,
        "tool_not_enabled",
        `Employee "${employee.name}" does not have the ${requiredTool} tool enabled`,
      );
    }
    if (input.type === "browser_task") {
      // SAFETY (enqueue-time check): the URL must be inside the employee's
      // allowlist. The same check runs again at navigation (routing + goto),
      // so a policy change between enqueue and run cannot widen access.
      if (!input.url) {
        throw new HttpError(400, "validation_error", "browser_task requires a url");
      }
      const host = safeHost(input.url);
      const allowed = employee.allowedDomains.some((d) => {
        const dd = d.toLowerCase();
        return host === dd || host.endsWith("." + dd);
      });
      if (!allowed) {
        throw new HttpError(
          403,
          "domain_not_allowed",
          `URL host "${host}" is not in the employee's allowed domains`,
        );
      }
      const task = context.runner.createBrowserTask(employee, input);
      void reply.code(202);
      return task;
    }

    const task = context.tasks.create(newId("tsk"), employee.id, input, new Date().toISOString());
    context.queue.enqueue(task.id);
    void reply.code(202);
    return task;
  });

  // GET /api/tasks?status=&employeeId= — global task table with filters.
  app.get<{
    Querystring: { status?: string; employeeId?: string };
  }>("/", async (request) => {
    const { status, employeeId } = request.query;
    const validStatuses = [
      "queued",
      "running",
      "awaiting_approval",
      "done",
      "failed",
      "cancelled",
    ] as const;
    const statusFilter =
      status && (validStatuses as readonly string[]).includes(status)
        ? (status as (typeof validStatuses)[number])
        : undefined;
    return context.tasks.list({ status: statusFilter, employeeId });
  });

  // GET /api/tasks/:id — full detail: output, plan, logs (audit), screenshots.
  app.get<{ Params: { id: string } }>("/:id", async (request) => {
    const task = context.tasks.get(request.params.id);
    if (!task) {
      throw new HttpError(404, "task_not_found", `No task with id "${request.params.id}"`);
    }
    return task;
  });

  // POST /api/tasks/:id/cancel — queued: remove; running: cooperative flag;
  // awaiting_approval: resolve the in-page gate with "cancelled".
  app.post<{ Params: { id: string } }>("/:id/cancel", async (request) => {
    const task = context.tasks.get(request.params.id);
    if (!task) {
      throw new HttpError(404, "task_not_found", `No task with id "${request.params.id}"`);
    }
    const result = context.runner.cancel(task.id);
    if (!result.cancelled) {
      return { cancelled: false, reason: result.reason };
    }
    // For queued cancels the runner already finalized the row; for
    // running/gate cancels the row settles when the run notices.
    const fresh = context.tasks.get(task.id);
    return { cancelled: true, status: fresh?.status };
  });

  // POST /api/tasks/:id/approve — consent gate: resume the paused task.
  app.post<{ Params: { id: string } }>("/:id/approve", async (request) => {
    const task = context.tasks.get(request.params.id);
    if (!task) {
      throw new HttpError(404, "task_not_found", `No task with id "${request.params.id}"`);
    }
    const result = context.runner.approve(task.id);
    if (!result.approved) {
      throw new HttpError(409, "not_awaiting_approval", result.reason ?? `Task is ${task.status}`);
    }
    const fresh = context.tasks.get(task.id);
    return { approved: true, status: fresh?.status };
  });
};

/** Hostname of a URL, or "" when unparseable (rejected by the caller). */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
