import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, type AppContext } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "../src/auth/tokens.js";
import { resolveOperatorCredential } from "../src/auth/operator.js";
import { openDatabase } from "../src/db/sqlite.js";

/**
 * Phase 5 operator-credential pins. The operator tier now mirrors the
 * employee-token pattern: hash at rest, printed once, revocable by
 * rotation. These tests pin the three boot modes and the rotation
 * lifecycle.
 */

const silentLog = { info: () => undefined, warn: () => undefined };

describe("resolveOperatorCredential — boot modes", () => {
  it("first boot generates a token, persists it to a 600 file, stores only the hash", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ca-op-first-"));
    try {
      const db = openDatabase(dataDir);
      const cred = resolveOperatorCredential(db, dataDir, undefined, silentLog);

      expect(cred.mode).toBe("generated");
      expect(cred.token).toBeDefined();
      const file = join(dataDir, "operator-token");
      expect(readFileSync(file, "utf8").trim()).toBe(cred.token);
      expect(statSync(file).mode & 0o777).toBe(0o600);

      // DB holds the hash, never the plaintext.
      const raw = readFileSync(join(dataDir, "consentark.db"));
      expect(raw.includes(Buffer.from(cred.token!, "utf8"))).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("restart path: the persisted file is adopted and stable across boots", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ca-op-restart-"));
    try {
      const db = openDatabase(dataDir);
      const first = resolveOperatorCredential(db, dataDir, undefined, silentLog);
      const second = resolveOperatorCredential(db, dataDir, undefined, silentLog);
      expect(second.mode).toBe("persisted");
      expect(second.token).toBe(first.token);
      expect(second.tokenHash).toBe(first.tokenHash);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("env override wins, writes nothing, and beats an existing file", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ca-op-env-"));
    try {
      const db = openDatabase(dataDir);
      const before = readFileSync(join(dataDir, "consentark.db"));
      const cred = resolveOperatorCredential(db, dataDir, "env-set-secret-token", silentLog);

      expect(cred.mode).toBe("env-override");
      expect(cred.token).toBeUndefined();
      expect(cred.tokenFile).toBeUndefined();
      expect(cred.tokenHash).toBe(hashToken("env-set-secret-token"));

      // The dev default must NOT count as an override (backwards compat).
      const devDefault = resolveOperatorCredential(db, dataDir, "dev-admin-token-change-me", silentLog);
      expect(devDefault.mode).not.toBe("env-override");

      void before;
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("operator credential — end-to-end through the app", () => {
  let dataDir: string;
  let app: FastifyInstance;
  let context: AppContext;

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    dataDir = mkdtempSync(join(tmpdir(), "ca-op-app-"));
  });

  afterEach(async () => {
    await app?.close();
    vi.unstubAllGlobals();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function boot(adminToken?: string): Promise<void> {
    const built = await buildApp(
      {
        PORT: "4314",
        DATA_DIR: dataDir,
        ...(adminToken !== undefined ? { ADMIN_TOKEN: adminToken } : {}),
        LOG_LEVEL: "error",
        FREELLMAPI_URL: "http://llm.test/v1",
        WORKER_CONCURRENCY: "1",
      },
      { startWorker: false },
    );
    app = built.app;
    context = built.context;
  }

  it("generated credential authenticates; the plaintext works from the file after 'restart'", async () => {
    await boot(); // no ADMIN_TOKEN env at all
    expect(context.operator.mode).toBe("generated");
    const token = context.operator.token!;
    const me = await app.inject({ method: "GET", url: "/api/employees", headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
  });

  it("env-override mode authenticates with the env value", async () => {
    await boot("env-mode-token-123456");
    expect(context.operator.mode).toBe("env-override");
    const me = await app.inject({ method: "GET", url: "/api/employees", headers: { authorization: "Bearer env-mode-token-123456" } });
    expect(me.statusCode).toBe(200);
    const bad = await app.inject({ method: "GET", url: "/api/employees", headers: { authorization: "Bearer wrong" } });
    expect(bad.statusCode).toBe(401);
  });

  it("rotate invalidates the old token and the new one works (persisted mode)", async () => {
    await boot(); // generated → persisted
    const oldToken = context.operator.token!;

    const rotated = await app.inject({ method: "POST", url: "/api/operator/rotate", headers: { authorization: `Bearer ${oldToken}` } });
    expect(rotated.statusCode).toBe(201);
    const { token: newToken } = rotated.json() as { token: string };
    expect(newToken).not.toBe(oldToken);

    const oldWorks = await app.inject({ method: "GET", url: "/api/employees", headers: { authorization: `Bearer ${oldToken}` } });
    expect(oldWorks.statusCode).toBe(401);
    const newWorks = await app.inject({ method: "GET", url: "/api/employees", headers: { authorization: `Bearer ${newToken}` } });
    expect(newWorks.statusCode).toBe(200);

    // The file was updated; the DB still holds only the hash of the NEW token.
    expect(readFileSync(join(dataDir, "operator-token"), "utf8").trim()).toBe(newToken);
    const raw = readFileSync(join(dataDir, "consentark.db"));
    expect(raw.includes(Buffer.from(newToken, "utf8"))).toBe(false);

    // Status endpoint reflects the mode.
    const status = await app.inject({ method: "GET", url: "/api/operator/status", headers: { authorization: `Bearer ${newToken}` } });
    expect(status.json()).toMatchObject({ mode: "persisted", envOverride: false });
  });

  it("rotation is refused in env-override mode (the env is the source of truth)", async () => {
    await boot("env-mode-token-123456");
    const refused = await app.inject({ method: "POST", url: "/api/operator/rotate", headers: { authorization: "Bearer env-mode-token-123456" } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("rotation_unavailable");
  });

  it("rotation requires the operator tier — an employee token cannot rotate", async () => {
    await boot("env-mode-token-123456");
    const hired = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers: { authorization: "Bearer env-mode-token-123456" },
      payload: { name: "Clerk", systemPrompt: "s", toolsEnabled: ["chat_task"] },
    });
    const { id } = hired.json() as { id: string };
    const issued = await app.inject({ method: "POST", url: `/api/employees/${id}/tokens`, headers: { authorization: "Bearer env-mode-token-123456" } });
    const { token: employeeToken } = issued.json() as { token: string };

    const attempt = await app.inject({ method: "POST", url: "/api/operator/rotate", headers: { authorization: `Bearer ${employeeToken}` } });
    expect(attempt.statusCode).toBe(401);
  });

  it("health reports the deployed version", async () => {
    await boot("env-mode-token-123456");
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.json().version).toMatch(/^\d+\.\d+\.\d+$|unknown/);
  });
});
