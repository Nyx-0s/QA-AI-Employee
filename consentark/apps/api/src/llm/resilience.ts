import { LLMError } from "./provider.js";

/**
 * Resilience primitives shared by every LLM call: retriable-status
 * classification and exponential backoff with jitter. The task runner
 * gets timeout+retry+structured logging on every call for free.
 */

/** HTTP statuses that represent transient failures worth retrying. */
export function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Exponential backoff with jitter: base * 2^(attempt-1) + up to 250 ms.
 * attempt starts at 1, so the first retry waits ~base ms.
 */
export function backoffDelay(baseMs: number, attempt: number): number {
  const exponential = baseMs * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  return exponential + jitter;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  /** Number of retries AFTER the initial attempt. */
  retries: number;
  baseMs: number;
  /** Called before each retry wait — the audit-logging hook. */
  onRetry?: (error: LLMError, attempt: number, delayMs: number) => void;
}

/**
 * Run `fn` up to (retries + 1) attempts. Non-retriable LLMErrors propagate
 * immediately; retriable ones wait `backoffDelay` between attempts. When all
 * attempts fail, the LAST error is thrown — never swallowed.
 */
export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.retries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retriable = error instanceof LLMError ? error.retriable : true;
      const attemptsLeft = attempt <= opts.retries;
      if (!retriable || !attemptsLeft) break;
      const delay = backoffDelay(opts.baseMs, attempt);
      const llmError =
        error instanceof LLMError
          ? error
          : new LLMError(
              "network_error",
              error instanceof Error ? error.message : String(error),
              true,
            );
      opts.onRetry?.(llmError, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}
