import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { taskCreateSchema } from "@consentark/shared";
import type { AppContext } from "../app.js";
import { HttpError } from "./httpError.js";

/**
 * Employee-scoped routes (Phase 4) — the second auth tier.
 *
 * Scope rules (test-pinned):
 * - A valid employee token reaches ONLY these routes. The operator tier
 *   (admin token) additionally has /api/employees, /api/tasks, /api/dashboard.
 * - `request.employeeAuth` is set by the app auth hook for valid employee
 *   tokens. Every route here resolves the employee from THAT value and
 *   refuses anything addressed to another employee — a token can never read
 *   or enqueue for a peer, even by guessing ids.
 * - Enforced grants: enqueueing requires the task's tool in toolsEnabled
 *   (mirrors the operator route so the same business rule holds on both tiers).
 */
export const employeeSelfRoutes: FastifyPluginAsync<{ context: AppContext }> = async (
  app,
  { context },
) => {
  /** The authenticated employee, or 401 when the hook found no employee token. */
  const self = (request: FastifyRequest) => {
    const employeeId = (request as unknown as { employeeAuth?: string }).employeeAuth;
    if (!employeeId) {
      throw new HttpError(401, "unauthorized", "A valid employee token is required");
    }
    const employee = context.employees.get(employeeId);
    if (!employee) {
      throw new HttpError(404, "employee_not_found", "Employee no longer exists");
    }
    return employee;
  };

  /** A task visible only when it belongs to the authenticated employee. */
  const ownTask = (request: FastifyRequest, taskId: string) => {
    const employee = self(request);
    const task = context.tasks.get(taskId);
    if (!task || task.employeeId !== employee.id) {
      throw new HttpError(404, "task_not_found", `No task \"${taskId}\" for this employee`);
    }
    return { employee, task };
  };

  // GET /api/employee/me — identity + posture the runner prints on startup.
  app.get("/me", async (request) => {
    const employee = self(request);
    return {
      id: employee.id,
      name: employee.name,
      role: employee.role,
      backend: employee.backend,
      model: employee.model,
      toolsEnabled: employee.toolsEnabled,
      confirmBeforeSubmit: employee.confirmBeforeSubmit,
      maxStepsPerTask: employee.maxStepsPerTask,
    };
  });

  // GET /api/employee/tasks — this employee's task feed (newest first).
  app.get("/tasks", async (request) => {
    const employee = self(request);
    return context.tasks.list({ employeeId: employee.id });
  });

  // POST /api/employee/tasks — enqueue work for MYSELF (never for a peer).
  app.post("/tasks", async (request, reply) => {
    const employee = self(request);
    const parsed = taskCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, "validation_error", "Invalid task payload", {
        issues: parsed.error.issues,
      });
    }
    const input = parsed.data;
    if (input.employeeId !== employee.id) {
      // Framing as 404 avoids confirming which employee ids exist.
      throw new HttpError(
        404,
        "task_not_found",
        "employeeId must match the token's own employee",
      );
    }
    if (employee.status !== "active") {
      throw new HttpError(409, "employee_paused", `Employee \"${employee.name}\" is paused`);
    }
    const requiredTool = input.type === "browser_task" ? "browser_task" : "chat_task";
    if (!employee.toolsEnabled.includes(requiredTool)) {
      throw new HttpError(
        409,
        "tool_not_enabled",
        `Employee \"${employee.name}\" does not have the ${requiredTool} tool enabled`,
      );
    }
    if (input.type === "browser_task") {
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
          `URL host \"${host}\" is not in the employee's allowed domains`,
        );
      }
    }
    const task =
      input.type === "browser_task"
        ? context.runner.createBrowserTask(employee, input)
        : context.runner.createChatTask(employee, input.objective);
    void reply.code(202);
    return {
      id: task.id,
      employeeId: task.employeeId,
      status: task.status,
      poll: `/api/employee/tasks/${task.id}`,
    };
  });

  // GET /api/employee/tasks/:id — own task detail incl. audit log + screenshots.
  app.get<{ Params: { id: string } }>("/tasks/:id", async (request) => {
    const { task } = ownTask(request, request.params.id);
    return task;
  });

  // POST /api/employee/tasks/:id/cancel — an employee may abandon its own work.
  app.post<{ Params: { id: string } }>("/tasks/:id/cancel", async (request) => {
    const { task } = ownTask(request, request.params.id);
    const result = context.runner.cancel(task.id);
    if (!result.cancelled) {
      return { cancelled: false, reason: result.reason };
    }
    const fresh = context.tasks.get(task.id);
    return { cancelled: true, status: fresh?.status };
  });
};

/** Hostname of a URL, or \"\" when unparseable (then never allowlisted). */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
