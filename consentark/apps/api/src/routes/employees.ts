import type { FastifyPluginAsync } from "fastify";
import {
  employeeCreateSchema,
  employeePatchSchema,
  type EmployeeSummary,
} from "@consentark/shared";
import type { AppContext } from "../app.js";
import { uniqueSlug } from "../util/ids.js";
import { HttpError } from "./httpError.js";

/**
 * Employee routes: CRUD + the interactive chat endpoint.
 * Zod parsing happens here so API responses never contain unvalidated data.
 */
export const employeeRoutes: FastifyPluginAsync<{ context: AppContext }> = async (
  app,
  { context },
) => {
  const summaryOf = (employeeId: string): EmployeeSummary | null => {
    const found = context.employees
      .listWithCompletedCounts()
      .find((entry) => entry.id === employeeId);
    return found ?? null;
  };

  // POST /api/employees — hire an employee.
  app.post("/", async (request, reply) => {
    const parsed = employeeCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, "validation_error", "Invalid employee payload", {
        issues: parsed.error.issues,
      });
    }
    // Unique slug id: "Data Clerk 01" → "data-clerk-01" (+2 when taken).
    const id = uniqueSlug(parsed.data.name, (slug) => context.employees.get(slug) !== null);
    const created = context.employees.create(id, parsed.data, new Date().toISOString());
    void reply.code(201);
    return summaryOf(created.id);
  });

  // GET /api/employees — the Team page listing.
  app.get("/", async () => context.employees.listWithCompletedCounts());

  // GET /api/employees/:id — employee detail.
  app.get<{ Params: { id: string } }>("/:id", async (request) => {
    const employee = summaryOf(request.params.id);
    if (!employee) {
      throw new HttpError(404, "employee_not_found", `No employee with id "${request.params.id}"`);
    }
    return employee;
  });

  // PATCH /api/employees/:id — update prompt/backend/model/safety/etc.
  app.patch<{ Params: { id: string } }>("/:id", async (request) => {
    const parsed = employeePatchSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, "validation_error", "Invalid employee patch", {
        issues: parsed.error.issues,
      });
    }
    const updated = context.employees.patch(request.params.id, parsed.data);
    if (!updated) {
      throw new HttpError(404, "employee_not_found", `No employee with id "${request.params.id}"`);
    }
    return summaryOf(updated.id);
  });

  // DELETE /api/employees/:id — default soft-delete (status → paused);
  // ?hard=true permanently removes the employee.
  app.delete<{ Params: { id: string }; Querystring: { hard?: string } }>(
    "/:id",
    async (request) => {
      const { id } = request.params;
      const employee = context.employees.get(id);
      if (!employee) {
        throw new HttpError(404, "employee_not_found", `No employee with id "${id}"`);
      }
      if (request.query.hard === "true") {
        const inFlight = context.tasks
          .list({ employeeId: id })
          .filter((task) => task.status === "queued" || task.status === "running");
        if (inFlight.length > 0) {
          throw new HttpError(
            409,
            "employee_busy",
            `Employee has ${inFlight.length} queued/running task(s) — cancel them first`,
          );
        }
        context.employees.hardDelete(id);
        context.tokens.deleteForEmployee(id);
        return { deleted: true, mode: "hard" };
      }
      const paused = context.employees.patch(id, { status: "paused" });
      return { deleted: false, mode: "soft", employee: paused };
    },
  );

  // POST /api/employees/:id/chat — interactive instruction.
  // Creates a chat task, queues it, and returns immediately with the task id;
  // the supervisor polls GET /api/tasks/:id for status/output/logs.
  app.post<{ Params: { id: string } }>("/:id/chat", async (request, reply) => {
    const employee = context.employees.get(request.params.id);
    if (!employee) {
      throw new HttpError(404, "employee_not_found", `No employee with id "${request.params.id}"`);
    }
    if (employee.status !== "active") {
      throw new HttpError(409, "employee_paused", `Employee "${employee.name}" is paused`);
    }
    // Grants are enforced at enqueue (Phase 4): chat work needs chat_task.
    if (!employee.toolsEnabled.includes("chat_task")) {
      throw new HttpError(
        409,
        "tool_not_enabled",
        `Employee "${employee.name}" does not have the chat_task tool enabled`,
      );
    }
    const body = (request.body ?? {}) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length === 0) {
      throw new HttpError(400, "validation_error", "Body must include a non-empty `message` string");
    }
    const task = context.runner.createChatTask(employee, message);
    void reply.code(202);
    return {
      id: task.id,
      employeeId: task.employeeId,
      status: task.status,
      poll: `/api/tasks/${task.id}`,
    };
  });

  // GET /api/employees/:id/tasks — the task feed for one employee.
  app.get<{ Params: { id: string } }>("/:id/tasks", async (request) => {
    const employee = context.employees.get(request.params.id);
    if (!employee) {
      throw new HttpError(404, "employee_not_found", `No employee with id "${request.params.id}"`);
    }
    return context.tasks.list({ employeeId: employee.id });
  });

  // POST /api/employees/:id/tokens — issue a hiring token (operator only).
  // The plaintext is returned ONCE in this response and never stored; the DB
  // keeps only its sha256. Losing it means issuing a new token.
  app.post<{ Params: { id: string } }>("/:id/tokens", async (request, reply) => {
    const employee = context.employees.get(request.params.id);
    if (!employee) {
      throw new HttpError(404, "employee_not_found", `No employee with id "${request.params.id}"`);
    }
    const { issueToken } = await import("../auth/tokens.js");
    const issued = issueToken();
    context.tokens.create(employee.id, issued.tokenHash, new Date().toISOString());
    void reply.code(201);
    return {
      token: issued.token,
      employeeId: employee.id,
      note: "Store this token now — it is shown once and never again.",
    };
  });

  // GET /api/employees/:id/tokens — hash inventory only (no secrets).
  app.get<{ Params: { id: string } }>("/:id/tokens", async (request) => {
    const employee = context.employees.get(request.params.id);
    if (!employee) {
      throw new HttpError(404, "employee_not_found", `No employee with id "${request.params.id}"`);
    }
    const hashes = context.tokens.listForEmployee(employee.id);
    return { employeeId: employee.id, count: hashes.length, tokenHashes: hashes };
  });

  // DELETE /api/employees/:id/tokens — revoke every token (e.g. offboarding).
  app.delete<{ Params: { id: string } }>("/:id/tokens", async (request) => {
    const employee = context.employees.get(request.params.id);
    if (!employee) {
      throw new HttpError(404, "employee_not_found", `No employee with id "${request.params.id}"`);
    }
    const count = context.tokens.listForEmployee(employee.id).length;
    context.tokens.deleteForEmployee(employee.id);
    return { revoked: count };
  });
};
