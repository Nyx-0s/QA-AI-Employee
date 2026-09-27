/**
 * LLMProvider — the single internal interface every backend must speak.
 *
 * FreeLLMAPI (cloud) and Colibrì (local `coli serve`) both expose
 * OpenAI-compatible chat endpoints, so ONE client plus two thin presets
 * implement this interface. Switching an employee between backends is a
 * config field (`backend: "cloud" | "local"`), never a code change.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Override the provider's default model for this call. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the backend for JSON output (response_format: json_object). */
  jsonMode?: boolean;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  content: string;
  /** Model that actually served the request (may differ from requested). */
  model: string;
  /** Provider label, e.g. "cloud (FreeLLMAPI)" or "local (Colibrì)". */
  provider: string;
  latencyMs: number;
  usage: ChatUsage | null;
  /** FreeLLMAPI's X-Routed-Via header (which upstream served), when present. */
  routedVia: string | null;
}

export interface HealthStatus {
  ok: boolean;
  latencyMs?: number;
  detail?: string;
}

/** Structured event emitted on every provider call — feeds the audit log. */
export type LLMClientEvent =
  | {
      type: "request";
      provider: string;
      model: string;
      messageCount: number;
      attempt: number;
    }
  | {
      type: "retry";
      provider: string;
      code: string;
      message: string;
      attempt: number;
      delayMs: number;
    }
  | {
      type: "response";
      provider: string;
      model: string;
      latencyMs: number;
      promptTokens: number | null;
      completionTokens: number | null;
      routedVia: string | null;
    }
  | { type: "error"; provider: string; code: string; message: string };

export type LLMEventHandler = (event: LLMClientEvent) => void;

export interface LLMProvider {
  /** Backend kind — used for logging and fallback decisions. */
  readonly kind: "cloud" | "local";
  readonly label: string;
  chat(request: ChatRequest, onEvent?: LLMEventHandler): Promise<ChatResponse>;
  health(): Promise<HealthStatus>;
}

/** Structured LLM failure. `retriable` drives the retry loop. */
export class LLMError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retriable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
