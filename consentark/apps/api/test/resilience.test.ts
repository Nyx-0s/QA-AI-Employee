import { backoffDelay, isRetriableStatus, withRetries } from "../src/llm/resilience.js";
import { LLMError } from "../src/llm/provider.js";
import { describe, expect, it } from "vitest";

describe("isRetriableStatus", () => {
  it("marks timeouts, rate limits and 5xx as retriable", () => {
    expect(isRetriableStatus(408)).toBe(true);
    expect(isRetriableStatus(429)).toBe(true);
    expect(isRetriableStatus(500)).toBe(true);
    expect(isRetriableStatus(503)).toBe(true);
  });

  it("marks client errors as non-retriable", () => {
    expect(isRetriableStatus(400)).toBe(false);
    expect(isRetriableStatus(401)).toBe(false);
    expect(isRetriableStatus(404)).toBe(false);
  });
});

describe("backoffDelay", () => {
  it("grows exponentially with the attempt number", () => {
    expect(backoffDelay(500, 1)).toBeGreaterThanOrEqual(500);
    expect(backoffDelay(500, 2)).toBeGreaterThanOrEqual(1000);
    expect(backoffDelay(500, 3)).toBeGreaterThanOrEqual(2000);
    // jitter is capped at 250 ms
    expect(backoffDelay(500, 1)).toBeLessThan(500 + 250);
  });
});

describe("withRetries", () => {
  it("returns the first successful result", async () => {
    let calls = 0;
    const result = await withRetries(
      async () => {
        calls++;
        if (calls < 3) throw new LLMError("llm_http_error", "503", true, 503);
        return "ok";
      },
      { retries: 3, baseMs: 1 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry non-retriable errors", async () => {
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls++;
          throw new LLMError("llm_auth", "401", false, 401);
        },
        { retries: 5, baseMs: 1 },
      ),
    ).rejects.toMatchObject({ code: "llm_auth" });
    expect(calls).toBe(1);
  });

  it("informs onRetry before each retry wait", async () => {
    const seen: Array<[number, number]> = [];
    let calls = 0;
    await withRetries(
      async () => {
        calls++;
        if (calls <= 2) throw new LLMError("network_error", "down", true);
        return "done";
      },
      {
        retries: 3,
        baseMs: 10,
        onRetry: (error, attempt, delayMs) => {
          seen.push([attempt, delayMs]);
          expect(error.code).toBe("network_error");
        },
      },
    );
    expect(seen).toEqual([
      [1, expect.any(Number)],
      [2, expect.any(Number)],
    ]);
    // Deterministic ranges: base*2^(attempt-1) plus jitter capped at 250 ms.
    // (A strict > comparison would be flaky: jitter can invert single samples.)
    expect(seen[0][1]).toBeGreaterThanOrEqual(10);
    expect(seen[0][1]).toBeLessThan(10 + 250);
    expect(seen[1][1]).toBeGreaterThanOrEqual(20);
    expect(seen[1][1]).toBeLessThan(20 + 250);
  });
});
