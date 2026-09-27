import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { hashToken } from "./tokens.js";

/**
 * Operator credential (Phase 5) — closes the documented Phase 4 asymmetry.
 *
 * Three modes, resolved once at boot:
 * 1. ENV OVERRIDE — ADMIN_TOKEN set to anything other than the dev default:
 *    the env value IS the credential (hash-compared per request, never
 *    stored). Rotation = change the env + restart. Backwards compatible.
 * 2. PERSISTED FILE — a `operator-token` file (chmod 600) under DATA_DIR
 *    holds the plaintext; its sha256 lives in the DB (`settings` row
 *    `operator_token_hash`). Survives restarts without env vars.
 * 3. FIRST BOOT — neither exists: generate a 32-byte token, persist it to
 *    the file (600), store only the hash in the DB, and print the plaintext
 *    ONCE to the server log.
 *
 * Rotation (operator endpoint): new token issued, old invalidated, plaintext
 * printed once, file updated atomically.
 *
 * Storage rules (test-pinned): the DB never holds plaintext; the file is
 * chmod 600; env mode never writes anything to disk.
 */

const DEV_DEFAULT_TOKEN = "dev-admin-token-change-me";
const SETTINGS_KEY = "operator_token_hash";
const ENV_OVERRIDE_ACTIVE = "operator_token_env_active";

export type OperatorCredentialMode = "env-override" | "persisted" | "generated";

export interface OperatorCredential {
  mode: OperatorCredentialMode;
  /** sha256 hex — what request-time comparison checks against. */
  tokenHash: string;
  /** Plaintext, present ONLY in generated mode (printed once) and persisted mode (read from file). */
  token?: string;
  /** Generated/persisted: path of the 600-perm plaintext file. */
  tokenFile?: string;
}

// hashToken is shared with the employee token module — one hashing story.

interface SettingsRow {
  value: string;
}

function readSetting(db: Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | SettingsRow
    | undefined;
  return row?.value ?? null;
}

function writeSetting(db: Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

/** Resolve (or bootstrap) the operator credential. See module docstring. */
export function resolveOperatorCredential(
  db: Database,
  dataDir: string,
  envAdminToken: string | undefined,
  log: { info(msg: string): void; warn(msg: string): void },
): OperatorCredential {
  // Mode 1 — env override (any non-dev-default value wins; nothing at rest).
  if (envAdminToken !== undefined && envAdminToken.length > 0 && envAdminToken !== DEV_DEFAULT_TOKEN) {
    writeSetting(db, ENV_OVERRIDE_ACTIVE, "1");
    return { mode: "env-override", tokenHash: hashToken(envAdminToken) };
  }

  const envWasActive = readSetting(db, ENV_OVERRIDE_ACTIVE) === "1";

  // Mode 2 — persisted file with a matching DB hash: the normal restart path.
  const tokenFile = join(dataDir, "operator-token");
  if (existsSync(tokenFile)) {
    const token = readFileSync(tokenFile, "utf8").trim();
    const storedHash = readSetting(db, SETTINGS_KEY);
    if (token.length > 0 && storedHash === hashToken(token)) {
      return { mode: envWasActive ? "persisted" : "persisted", tokenHash: storedHash, token, tokenFile };
    }
    if (token.length > 0 && storedHash === null) {
      // File exists but the DB lost its hash (fresh DATA_DIR copy without the
      // settings row): adopt the file rather than orphaning the operator.
      writeSetting(db, SETTINGS_KEY, hashToken(token));
      log.warn("operator-token file found without a DB hash — adopting it.");
      return { mode: "persisted", tokenHash: hashToken(token), token, tokenFile };
    }
    // File/DB mismatch is the rotate-crash case: fall through to issue a new
    // credential rather than locking the operator out.
    log.warn("operator-token file does not match the stored hash — issuing a new credential.");
  }

  // Mode 3 — first boot: generate, persist (600), hash to DB, print once.
  const token = randomBytes(32).toString("base64url");
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  const tokenHash = hashToken(token);
  writeSetting(db, SETTINGS_KEY, tokenHash);
  log.info(
    "Generated a new operator credential — printed ONCE below (also saved to " +
      `${tokenFile}, mode 600; the database stores only its sha256):\n` +
      `  OPERATOR TOKEN: ${token}`,
  );
  return { mode: "generated", tokenHash, token, tokenFile };
}

/** Rotate: invalidate the old token, issue a new one (returned ONCE). */
export function rotateOperatorCredential(
  db: Database,
  tokenFile: string,
): string {
  const token = randomBytes(32).toString("base64url");
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  writeSetting(db, SETTINGS_KEY, hashToken(token));
  return token;
}

/** Whether request-time comparison should ALSO accept the env token. */
export function envTokenActive(db: Database): boolean {
  return readSetting(db, ENV_OVERRIDE_ACTIVE) === "1";
}
