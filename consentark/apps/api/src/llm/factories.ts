import type { LLMProvider } from "./provider.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import type { Config } from "../config/env.js";

/**
 * The two backend presets (Phase 0 §4). Both are the same
 * OpenAICompatibleProvider with different configuration — switching an
 * employee from cloud to local is a data change, not a code change.
 */

/**
 * Only the LLM-related config keys — lets CLI diagnostics (keycheck) and any
 * future chat-only tool build a cloud provider without full server config.
 */
export type CloudProviderConfig = Pick<
  Config,
  | "FREELLMAPI_URL"
  | "FREELLMAPI_KEY"
  | "FREELLMAPI_MODEL"
  | "FREELLMAPI_TIMEOUT_MS"
  | "LLM_RETRIES"
  | "LLM_RETRY_BASE_MS"
>;

export function createCloudProvider(config: CloudProviderConfig): LLMProvider {
  return new OpenAICompatibleProvider({
    kind: "cloud",
    label: "cloud (FreeLLMAPI)",
    baseURL: config.FREELLMAPI_URL,
    apiKey: config.FREELLMAPI_KEY,
    defaultModel: config.FREELLMAPI_MODEL,
    timeoutMs: config.FREELLMAPI_TIMEOUT_MS,
    retries: config.LLM_RETRIES,
    retryBaseMs: config.LLM_RETRY_BASE_MS,
  });
}

export function createLocalProvider(config: Config): LLMProvider {
  return new OpenAICompatibleProvider({
    kind: "local",
    label: "local (Colibrì)",
    baseURL: config.COLIBRI_URL,
    apiKey: "", // Colibrì `coli serve` requires no key
    defaultModel: config.COLIBRI_MODEL,
    timeoutMs: config.COLIBRI_TIMEOUT_MS,
    retries: config.LLM_RETRIES,
    retryBaseMs: config.LLM_RETRY_BASE_MS,
  });
}

export interface ProviderRegistry {
  cloud: LLMProvider;
  local: LLMProvider;
}

export function createProviders(config: Config): ProviderRegistry {
  return {
    cloud: createCloudProvider(config),
    local: createLocalProvider(config),
  };
}
