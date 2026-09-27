import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { loadConfig, type Config } from "./config/env.js";
import { openDatabase } from "./db/sqlite.js";
import { EmployeeRepository } from "./db/repositories/employees.js";
import { TaskRepository } from "./db/repositories/tasks.js";
import { TokenRepository } from "./db/repositories/tokens.js";
import { resolveOperatorCredential, type OperatorCredential } from "./auth/operator.js";
import { hashToken } from "./auth/tokens.js";
import { createProviders, type ProviderRegistry } from "./llm/factories.js";
import { MemoryTaskQueue } from "./queue/memoryQueue.js";
import { TaskRunner } from "./queue/taskRunner.js";
import { Scheduler } from "./queue/scheduler.js";
import type { TaskQueue } from "./queue/queue.js";
import { employeeRoutes } from "./routes/employees.js";
import { taskRoutes } from "./routes/tasks.js";
import { healthRoutes } from "./routes/health.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { employeeSelfRoutes } from "./routes/employeeSelf.js";
import { operatorRoutes } from "./routes/operator.js";
import { HttpError } from "./routes/httpError.js";

/**
 * Application context — the single wiring point. buildApp() is used by both
 * the real server (index.ts) and the route tests (fastify.inject), so the
 * integration tests exercise exactly the production configuration path.
 */
export interface AppContext {
  config: Config;
  db: Database;
  employees: EmployeeRepository;
  tasks: TaskRepository;
  tokens: TokenRepository;
  /** Operator credential state (mode + hash) — see auth/operator.ts. */
  operator: OperatorCredential;
  providers: ProviderRegistry;
  queue: TaskQueue;
  runner: TaskRunner;
  /** Cron-driven scheduled-task creation for employees with a schedule. */
  scheduler: Scheduler;
  /** package.json version, surfaced via /api/health. */
  version: string;
}

export interface BuildAppOptions {
  config?: Partial<Config>;
  /** Disable the task worker (used by tests that drive tasks manually). */
  startWorker?: boolean;
}

export async function buildApp(
  env: NodeJS.ProcessEnv = process.env,
  options: BuildAppOptions = {},
): Promise<{ app: FastifyInstance; context: AppContext }> {
  const config: Config = { ...loadConfig(env), ...(options.config ?? {}) };
  const db = openDatabase(config.DATA_DIR);

  // Deployed version: from the API package.json. This module lives at
  // src/ under tsx and dist/ once compiled — try both relative layouts.
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  let version = "unknown";
  for (const candidate of ["../package.json", "../../package.json"]) {
    try {
      const parsed = JSON.parse(readFileSync(join(moduleDir, candidate), "utf8")) as { version?: string };
      if (parsed.version !== undefined) {
        version = parsed.version;
        break;
      }
    } catch {
      /* try the next layout */
    }
  }

  // Operator credential bootstrap (Phase 5): env override, persisted 600
  // file, or first-boot generation printed once. See auth/operator.ts.
  // (Boot-time logging uses console — the Fastify logger does not exist yet.)
  const operator = resolveOperatorCredential(db, config.DATA_DIR, env.ADMIN_TOKEN, {
    info: (msg) => console.log(`[consentark] ${msg}`),
    warn: (msg) => console.warn(`[consentark] ${msg}`),
  });

  const context: AppContext = {
    config,
    db,
    employees: new EmployeeRepository(db),
    tasks: new TaskRepository(db),
    providers: createProviders(config),
    tokens: new TokenRepository(db),
    operator,
    queue: new MemoryTaskQueue(),
    runner: null as unknown as TaskRunner,
    scheduler: null as unknown as Scheduler,
    version,
  };
  context.runner = new TaskRunner(
    config,
    context.queue,
    context.providers,
    context.tasks,
    context.employees,
  );
  context.scheduler = new Scheduler({
    config,
    db,
    employees: context.employees,
    tasks: context.tasks,
    queue: context.queue,
  });

  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
  });

  // Packaged mode (Phase 5): when DASHBOARD_DIST points at a built
  // dashboard, the API serves it — one container, one port. In dev the
  // dashboard runs on its own Vite server (CORS_ORIGIN covers it), so this
  // registration is skipped entirely when the variable is unset.
  if (env.DASHBOARD_DIST !== undefined && env.DASHBOARD_DIST.length > 0) {
    const { fastifyStatic } = await import("@fastify/static");
    await app.register(fastifyStatic, {
      root: resolve(env.DASHBOARD_DIST),
      prefix: "/",
      // SPA fallback: anything not starting with /api lands on index.html.
      wildcard: false,
      serve: true,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        void reply.code(404).send({
          error: { code: "not_found", message: `No route for ${request.url}` },
        });
        return;
      }
      void reply.sendFile("index.html");
    });
  }

  // Two-tier Bearer auth on every /api route except /api/health.
  //
  // Tier 1 — operator: the static ADMIN_TOKEN from env (Phase 1 design kept
  // as-is; the asymmetry — operator token lives in env config, employee
  // tokens are hashed in SQLite — is documented in docs/PHASE4-notes.md).
  // Tier 2 — employee: a per-employee token whose sha256 lives in SQLite;
  // its scope is enforced by the /api/employee/* routes, never here.
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    if (request.url.startsWith("/api/health")) return;
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token.length > 0) {
      // Employee tokens: valid ONLY on /api/employee/* — anywhere else is
      // 401. (Exact-path check so /api/employees is NOT swallowed.)
      const employeeId = context.tokens.employeeIdForToken(token);
      const scopedPath =
        request.url === "/api/employee" || request.url.startsWith("/api/employee/");
      if (employeeId !== null && scopedPath) {
        (request as unknown as { employeeAuth: string }).employeeAuth = employeeId;
        return;
      }
    }
    // Operator: uniform hash comparison (Phase 5) — env token, persisted
    // token, or first-boot generated token all compare the same way.
    if (token.length === 0 || hashToken(token) !== context.operator.tokenHash) {
      await reply.code(401).send({
        error: { code: "unauthorized", message: "Missing or invalid token" },
      });
    }
  });

  // Zod schema errors → the uniform error envelope with field details.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      void reply.code(400).send({
        error: {
          code: "validation_error",
          message: "Request validation failed",
          details: error.validation,
        },
      });
      return;
    }
    // HttpError carries its own code/details — preserve them verbatim.
    if (error instanceof HttpError) {
      if (error.statusCode >= 500) {
        request.log.error(error);
      }
      void reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
      return;
    }
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error(error);
    }
    void reply.code(statusCode).send({
      error: {
        code: statusCode >= 500 ? "internal_error" : "bad_request",
        message: statusCode >= 500 ? "Internal server error" : error.message,
      },
    });
  });

  await app.register(employeeRoutes, { context, prefix: "/api/employees" });
  await app.register(taskRoutes, { context, prefix: "/api/tasks" });
  await app.register(healthRoutes, { context, prefix: "/api/health" });
  await app.register(dashboardRoutes, { context, prefix: "/api/dashboard" });
  await app.register(employeeSelfRoutes, { context, prefix: "/api/employee" });
  await app.register(operatorRoutes, { context, prefix: "/api/operator" });

  // Worker + recovery: on by default; tests pass startWorker: false and
  // drive tasks manually.
  if (options.startWorker ?? true) {
    const recovered = context.runner.recover();
    if (recovered > 0) {
      app.log.info(`Recovered ${recovered} interrupted/queued task(s) after restart`);
    }
    context.runner.start();
    context.scheduler.start();
  }

  return { app, context };
}
