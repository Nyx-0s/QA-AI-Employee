/**
 * Discovery fetch helper — exponential backoff + rate-limit logging.
 *
 * This module documents and enforces the discovery fetch policy:
 *   - max 3 attempts per URL
 *   - exponential backoff between attempts: 2s, 4s (doubled)
 *   - a 403/429 (rate limit / bot wall) is LOGGED as a rate-limit event
 *     and is NOT retried — the caller rotates to the next candidate source
 *   - every attempt (success or failure) is appended to sales/discovery-log.md
 *
 * The live workflow executes fetches through the read_url tool (agent-side),
 * so this script's role is (a) the authoritative policy definition and
 * (b) a verifiable timing/log simulator used to test the backoff math
 * without hammering anything. Run: node sales/fetch-tools.mjs --selftest
 */
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = join(HERE, "discovery-log.md");

export const POLICY = {
  maxAttempts: 3,
  baseDelayMs: 2_000,
  backoffFactor: 2,
  /** Statuses that mean "back off and rotate" — never retry these. */
  rotateStatuses: new Set([403, 429]),
  /** Statuses that mean "dead candidate" — no retry, no rotation value. */
  deadStatuses: new Set([404]),
};

/** Delay for attempt N (1-based): 2s, 4s, 8s… capped at 8s. */
export function backoffDelayMs(attempt) {
  const ms = POLICY.baseDelayMs * POLICY.backoffFactor ** (attempt - 1);
  return Math.min(ms, 8_000);
}

/** Decide the next action for a fetch outcome, per policy. */
export function nextAction({ status, attempt }) {
  if (status === 200) return "accept";
  if (POLICY.rotateStatuses.has(status)) return "rotate";
  if (POLICY.deadStatuses.has(status)) return "reject";
  // Timeouts, 5xx, TLS, DNS, socket errors: retryable up to maxAttempts.
  return attempt < POLICY.maxAttempts ? "retry" : "reject";
}

export function logLine(time, url, outcome, note = "") {
  const line = `${time} | ${url} | ${outcome}${note ? " | " + note : ""}`;
  try {
    appendFileSync(LOG, line + "\n");
  } catch {
    /* logging must never break the workflow */
  }
  return line;
}

// ── self-test with fixed timing (no network) ───────────────────────────
if (process.argv.includes("--selftest")) {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error("SELFTEST FAIL:", msg);
      process.exit(1);
    }
  };
  assert(backoffDelayMs(1) === 2_000, "attempt 1 backoff should be 2s");
  assert(backoffDelayMs(2) === 4_000, "attempt 2 backoff should be 4s");
  assert(backoffDelayMs(3) === 8_000, "attempt 3 backoff should be 8s");
  assert(backoffDelayMs(4) === 8_000, "backoff caps at 8s");
  assert(nextAction({ status: 200, attempt: 1 }) === "accept", "200 → accept");
  assert(nextAction({ status: 403, attempt: 1 }) === "rotate", "403 → rotate (never hammer)");
  assert(nextAction({ status: 429, attempt: 2 }) === "rotate", "429 → rotate");
  assert(nextAction({ status: 404, attempt: 1 }) === "reject", "404 → reject");
  assert(nextAction({ status: 500, attempt: 1 }) === "retry", "500 → retry");
  assert(nextAction({ status: 500, attempt: 3 }) === "reject", "500 at max attempts → reject");
  assert(nextAction({ status: 0, attempt: 2 }) === "retry", "network error mid-sequence → retry");
  assert(nextAction({ status: 0, attempt: 3 }) === "reject", "network error at max attempts → reject");
  console.log("fetch-tools selftest: PASS (backoff 2/4/8s capped; 403/429 rotate; 404 reject; errors retry→reject)");
}
