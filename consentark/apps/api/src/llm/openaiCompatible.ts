import type {
  ChatRequest,
  ChatResponse,
  ChatUsage,
  HealthStatus,
  LLMEventHandler,
  LLMProvider,
} from "./provider.js";
import { LLMError } from "./provider.js";
import { isRetriableStatus, withRetries } from "./resilience.js";

/**
 * ONE OpenAI-compatible HTTP client, configured by two presets:
 *   CloudProvider → FreeLLMAPI  (baseURL from FREELLMAPI_URL)
 *   LocalProvider → Colibrì     (baseURL from COLIBRI_URL)
 *
 * Every call carries: timeout, retry with exponential backoff (transient
 * failures only), and structured event emission for the audit log. Model
 * failover across free providers is FreeLLMAPI's own router — deliberately
 * NOT duplicated here (Phase 0 decision).
 */

interface Preset {
  kind: "cloud" | "local";
  label: string;
  baseURL: string;
  apiKey: string;
  defaultModel: string;
  timeoutMs: number;
  retries: number;
  retryBaseMs: number;
}

interface OpenAIChatChoice {
  message?: { role?: string; content?: string | null };
  finish_reason?: string;
}

interface OpenAIChatResponse {
  model?: string;
  choices?: OpenAIChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

const USER_AGENT = "consentark-api/0.1 (+https://consent.xyz)";

export class OpenAICompatibleProvider implements LLMProvider {
  readonly kind: Preset["kind"];
  readonly label: string;

  constructor(private readonly preset: Preset) {
    this.kind = preset.kind;
    this.label = preset.label;
  }

  async chat(
    request: ChatRequest,
    onEvent?: LLMEventHandler,
  ): Promise<ChatResponse> {
    const model = request.model?.trim() || this.preset.defaultModel;
    const body = {
      model,
      messages: request.messages,
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      ...(request.jsonMode ? { response_format: { type: "json_object" } } : {}),
    };

    const started = Date.now();
    const response = await withRetries(
      (attempt) => this.attempt(model, body, attempt, onEvent),
      {
        retries: this.preset.retries,
        baseMs: this.preset.retryBaseMs,
        onRetry: (error, attempt, delayMs) =>
          onEvent?.({
            type: "retry",
            provider: this.label,
            code: error.code,
            message: error.message,
            attempt,
            delayMs,
          }),
      },
    );

    const latencyMs = Date.now() - started;
    const content = response.choices?.[0]?.message?.content ?? "";
    const usage: ChatUsage | null = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens ?? 0,
          completionTokens: response.usage.completion_tokens ?? 0,
          totalTokens: response.usage.total_tokens ?? 0,
        }
      : null;
    const servedModel = response.model ?? model;

    onEvent?.({
      type: "response",
      provider: this.label,
      model: servedModel,
      latencyMs,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      routedVia: response.routedVia,
    });

    return {
      content,
      model: servedModel,
      provider: this.label,
      latencyMs,
      usage,
      routedVia: response.routedVia,
    };
  }

  async health(): Promise<HealthStatus> {
    const url = `${this.preset.baseURL.replace(/\/$/, "")}/models`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const started = Date.now();
      const response = await fetch(url, {
        headers: this.headers(),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        return {
          ok: false,
          latencyMs,
          detail: `HTTP ${response.status}`,
        };
      }
      return { ok: true, latencyMs };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── internals ────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      // FreeLLMAPI and Colibrì both accept a bearer key; empty for local
      // installs that run without one.
      ...(this.preset.apiKey ? { authorization: `Bearer ${this.preset.apiKey}` } : {}),
    };
  }

  private async attempt(
    model: string,
    body: unknown,
    attempt: number,
    onEvent?: LLMEventHandler,
  ): Promise<OpenAIChatResponse & { routedVia: string | null }> {
    onEvent?.({
      type: "request",
      provider: this.label,
      model,
      messageCount: (body as { messages: unknown[] }).messages.length,
      attempt,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.preset.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.preset.baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // Network-level failure or timeout.
      const aborted = controller.signal.aborted;
      throw new LLMError(
        aborted ? "llm_timeout" : "network_error",
        aborted
          ? `LLM request timed out after ${this.preset.timeoutMs} ms`
          : error instanceof Error
            ? error.message
            : String(error),
        true, // transient — retry
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const status = response.status;
      if (status === 401 || status === 403) {
        throw new LLMError(
          "llm_auth",
          `LLM backend rejected credentials (HTTP ${status})`,
          false,
          status,
        );
      }
      if (status === 404) {
        throw new LLMError(
          "llm_model_not_found",
          `LLM backend returned 404 (check base URL and model "${model}")`,
          false,
          status,
        );
      }
      throw new LLMError(
        "llm_http_error",
        `LLM backend returned HTTP ${status}${text ? `: ${text.slice(0, 300)}` : ""}`,
        isRetriableStatus(status),
        status,
      );
    }

    let json: OpenAIChatResponse;
    try {
      json = (await response.json()) as OpenAIChatResponse;
    } catch (error) {
      throw new LLMError(
        "llm_bad_response",
        `LLM backend returned non-JSON body: ${
          error instanceof Error ? error.message : String(error)
        }`,
        false,
      );
    }
    if (!json.choices || json.choices.length === 0) {
      throw new LLMError(
        "llm_bad_response",
        "LLM backend response contained no choices",
        false,
      );
    }

    const routedVia = response.headers.get("x-routed-via");
    return { ...json, routedVia };
  }
}
