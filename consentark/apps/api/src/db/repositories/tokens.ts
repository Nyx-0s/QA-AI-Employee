import type { Database } from "better-sqlite3";
import { hashToken } from "../../auth/tokens.js";

/**
 * Employee-token persistence (Phase 4). Hashes only — see auth/tokens.ts for
 * the rationale. One employee may hold several tokens (key rotation); a
 * token uniquely identifies one employee.
 */
export class TokenRepository {
  constructor(private readonly db: Database) {}

  /** Store a new token hash for an employee. */
  create(employeeId: string, tokenHash: string, now: string): void {
    this.db
      .prepare(
        "INSERT INTO employee_tokens (token_hash, employee_id, created_at) VALUES (?, ?, ?)",
      )
      .run(tokenHash, employeeId, now);
  }

  /** Resolve a presented bearer token to its employee id, or null. */
  employeeIdForToken(token: string): string | null {
    const row = this.db
      .prepare("SELECT employee_id FROM employee_tokens WHERE token_hash = ?")
      .get(hashToken(token)) as { employee_id: string } | undefined;
    return row?.employee_id ?? null;
  }

  /** All token hashes for an employee (e.g. future revoke UI). */
  listForEmployee(employeeId: string): string[] {
    return (
      this.db
        .prepare("SELECT token_hash FROM employee_tokens WHERE employee_id = ?")
        .all(employeeId) as Array<{ token_hash: string }>
    ).map((row) => row.token_hash);
  }

  /** Revoke every token of an employee (used on hard delete). */
  deleteForEmployee(employeeId: string): void {
    this.db
      .prepare("DELETE FROM employee_tokens WHERE employee_id = ?")
      .run(employeeId);
  }
}
