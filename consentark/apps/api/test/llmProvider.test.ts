import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../src/llm/openaiCompatible.js";
import type { LLMClientEvent } from "../src/llm/provider.js";

/**
 * LLMProvider tests against a mocked HTTP layer (no real backend needed).
 * Covers the master-prompt requirements: timeout, retry with backoff, and
 * structured error behavior — for the OpenAI-compatible client both
 * FreeLLMAPI (cloud) and Colibrì (local) are configured with.
 */

function makeProvider(overrides: Partial<ConstructorParameters<typeof OpenAICompatibleProvider>[0]> = {}) {
  return new OpenAICompatibleProvider({
    kind: "cloud",
    label: "cloud (test)",
    baseURL: "http://llm.test/v1",
    apiKey: "test-key",
    defaultModel: "auto",
    timeoutMs: 5000,
    retries: 2,
    retryBaseMs: 1, // fast tests; backoff math is covered separately
    ...overrides,
  });
}

function openAIResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      model: "served-model-1",
      choices: [{ message: { role: "assistant", content: "hello from the mock" } }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json", "x-routed-via": "google/gemini" } },
  );
}

const events = (): { list: LLMClientEvent[]; onEvent: (e: LLMClientEvent) => void } => {
  const list: LLMClientEvent[] = [];
  return { list, onEvent: (e) => list.push(e) };
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleProvider.chat — success path", () => {
  it("returns content, usage, served model and routedVia", async () => {
    vi.mocked(fetch).mockResolvedValue(openAIResponse());
    const provider = makeProvider();
    const { list, onEvent } = events();

    const response = await provider.chat(
      { messages: [{ role: "user", content: "hi" }] },
      onEvent,
    );

    expect(response.content).toBe("hello from the mock");
    expect(response.model).toBe("served-model-1");
    expect(response.provider).toBe("cloud (test)");
    expect(response.routedVia).toBe("google/gemini");
    expect(response.usage).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 });

    const sentBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string) as {
      model: string;
      messages: unknown[];
    };
    expect(sentBody.model).toBe("auto"); // default model used
    expect(sentBody.messages).toHaveLength(1);

    // Structured event trail: one request, one response.
    expect(list.map((e) => e.type)).toEqual(["request", "response"]);
    const responseEvent = list[1];
    expect(responseEvent.type === "response" && responseEvent.routedVia).toBe("google/gemini");
  });

  it("honors per-request model, maxTokens and jsonMode", async () => {
    vi.mocked(fetch).mockResolvedValue(openAIResponse());
    const provider = makeProvider();

    await provider.chat({
      messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
      model: "custom-model",
      maxTokens: 100,
      jsonMode: true,
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string) as Record<string, unknown>;
    expect(body.model).toBe("custom-model");
    expect(body.max_tokens).toBe(100);
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});

describe("OpenAICompatibleProvider.chat — resilience", () => {
  it("retries transient 5xx errors and succeeds on a later attempt", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("still boom", { status: 503 }))
      .mockResolvedValueOnce(openAIResponse());
    const provider = makeProvider();
    const { list, onEvent } = events();

    const response = await provider.chat({ messages: [{ role: "user", content: "hi" }] }, onEvent);
    expect(response.content).toBe("hello from the mock");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);

    const retries = list.filter((e) => e.type === "retry");
    expect(retries).toHaveLength(2);
  });

  it("retries 429 rate limits", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(openAIResponse());
    const provider = makeProvider();

    const response = await provider.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(response.content).toBe("hello from the mock");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry non-retriable auth failures and reports a structured error", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("bad key", { status: 401 }));
    const provider = makeProvider();

    await expect(provider.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      name: "LLMError",
      code: "llm_auth",
      retriable: false,
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry 404 (model or URL wrong)", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("nope", { status: 404 }));
    const provider = makeProvider();

    await expect(provider.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      code: "llm_model_not_found",
      retriable: false,
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("retries network errors and throws the last error when retries are exhausted", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED"));
    const provider = makeProvider({ retries: 1 });

    await expect(provider.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      code: "network_error",
      retriable: true,
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2); // 1 attempt + 1 retry
  });

  it("surfaces timeouts as retriable llm_timeout errors", async () => {
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const provider = makeProvider({ timeoutMs: 30, retries: 0 });

    await expect(provider.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      code: "llm_timeout",
      retriable: true,
    });
  });
});

describe("OpenAICompatibleProvider.health", () => {
  it("reports ok with latency when the backend answers", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const provider = makeProvider();

    const health = await provider.health();
    expect(health.ok).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports not ok with detail when the backend is down", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("ECONNREFUSED"));
    const provider = makeProvider();

    const health = await provider.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain("ECONNREFUSED");
  });
});
