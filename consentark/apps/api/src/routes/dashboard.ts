import { createReadStream, existsSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { approvalQueueEntrySchema } from "@consentark/shared";
import type { AppContext } from "../app.js";
import { HttpError } from "./httpError.js";

/**
 * Dashboard support routes (Phase 3): the approvals queue read-model, the
 * dashboard's small config surface, and authenticated screenshot serving.
 *
 * Security posture:
 * - Everything here sits behind the app-wide /api Bearer auth (screenshots
 *   are evidence and are NOT publicly fetchable).
 * - Screenshot paths come from the DB as DATA_DIR-relative strings; serving
 *   resolves + verifies containment inside DATA_DIR so a tampered row can
 *   never read files outside the data directory (path traversal).
 */
export const dashboardRoutes: FastifyPluginAsync<{ context: AppContext }> = async (
  app,
  { context },
) => {
  // GET /api/dashboard/approvals — the consent queue for the operator.
  app.get("/approvals", async () => {
    const entries = [];
    for (const task of context.tasks.listAwaiting()) {
      if (!task.awaitingApproval) continue; // defensive: invariant says non-null
      const employee = context.employees.get(task.employeeId);
      const entry = approvalQueueEntrySchema.parse({
        taskId: task.id,
        employeeId: task.employeeId,
        employeeName: employee?.name ?? "(deleted employee)",
        taskObjective: task.objective,
        taskUrl: task.url,
        approval: task.awaitingApproval,
        awaitingAt: task.awaitingApproval.at,
        status: task.status,
        latestScreenshotRef: task.screenshots.at(-1) ?? null,
      });
      entries.push(entry);
    }
    // Oldest first — the request closest to its auto-cancel deadline is most urgent.
    entries.sort((a, b) => a.awaitingAt.localeCompare(b.awaitingAt));
    return entries;
  });

  // GET /api/dashboard/config — server knobs the UI renders (the consent clock).
  app.get("/config", async () => ({
    approvalTimeoutHours: context.config.APPROVAL_TIMEOUT_HOURS,
  }));

  // GET /api/dashboard/screenshots/:taskId/:name — one captured screenshot.
  // `name` is a stored DATA_DIR-relative path (URL-encoded by the dashboard);
  // it must resolve strictly inside DATA_DIR and refer to an existing file.
  app.get<{ Params: { taskId: string; name: string } }>(
    "/screenshots/:taskId/:name",
    async (request, reply: FastifyReply) => {
      const task = context.tasks.get(request.params.taskId);
      if (!task) {
        throw new HttpError(404, "task_not_found", `No task with id "${request.params.taskId}"`);
      }

      const relative = decodeURIComponent(request.params.name);
      if (relative.length === 0 || relative.includes("\0")) {
        throw new HttpError(400, "bad_screenshot_path", "Invalid screenshot path");
      }

      const dataDir = resolve(context.config.DATA_DIR);
      const absolute = resolve(dataDir, relative);
      const relativeFromRoot = relative.startsWith("./") ? relative.slice(2) : relative;
      if (absolute !== dataDir && !absolute.startsWith(dataDir + sep)) {
        throw new HttpError(403, "screenshot_path_forbidden", "Path escapes the data directory");
      }
      if (!task.screenshots.includes(relativeFromRoot)) {
        throw new HttpError(
          404,
          "screenshot_not_found",
          `Task "${task.id}" has no screenshot "${relativeFromRoot}"`,
        );
      }
      if (!existsSync(absolute) || !statSync(absolute).isFile()) {
        throw new HttpError(404, "screenshot_not_found", "Screenshot file is missing on disk");
      }

      void reply.header("content-type", "image/png");
      void reply.header("cache-control", "private, no-store");
      return reply.send(createReadStream(absolute));
    },
  );
};

/** Filename portion of a screenshot ref for display, if needed later. */
export function screenshotBasename(refPath: string): string {
  return basename(refPath);
}
