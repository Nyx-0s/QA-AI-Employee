import { createHash, randomBytes } from "node:crypto";

/**
 * Employee hiring tokens (Phase 4 security core).
 *
 * Design:
 * - A token is 32 random bytes, base64url — ~192 bits of entropy.
 * - At rest we store ONLY `sha256(token)` (hex). The DB is not a credential
 *   store; a stolen backup cannot be replayed as a Bearer header.
 * - The plaintext is shown exactly once at hire time and never persisted.
 * - Lookup is O(1): hash the presented bearer, primary-key the hash.
 */

export interface IssuedToken {
  /** The plaintext token — the ONLY time it exists outside the caller's head. */
  token: string;
  /** sha256(token) hex — the value stored in the DB. */
  tokenHash: string;
}

/** Issue a fresh employee token (opaque, ~192 bits). */
export function issueToken(): IssuedToken {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/** The at-rest representation: sha256 hex of the presented token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
