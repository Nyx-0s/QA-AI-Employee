import { z } from "zod";

/**
 * Environment configuration.
 *
 * loadConfig() is a pure function of an env-object so tests can pass
 * overrides directly; index.ts feeds it process.env after dotenv loading.
 * Secrets are read ONLY here — no key ever appears in source files.
 */

/** dotenv treats booleans as strings; "false" is truthy in JS. Parse explicitly. */
const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => value === true || value === "true" || value === "1");

const configSchema = z.object({
  // API server
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATA_DIR: z.string().trim().min(1).default("./data"),
  ADMIN_TOKEN: z.string().trim().min(8).default("dev-admin-token-change-me"),
  CORS_ORIGIN: z.string().trim().min(1).default("http://localhost:5173"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // LLM backend: cloud (FreeLLMAPI)
  FREELLMAPI_URL: z.string().url().default("http://localhost:3001/v1"),
  FREELLMAPI_KEY: z.string().trim().default(""),
  FREELLMAPI_MODEL: z.string().trim().min(1).default("auto"),
  FREELLMAPI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),

  // LLM backend: local (Colibrì `coli serve`)
  COLIBRI_URL: z.string().url().default("http://localhost:8080/v1"),
  COLIBRI_MODEL: z.string().trim().min(1).default("OLMoE-7B"),
  COLIBRI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120000),
  LOCAL_FALLBACK_TO_CLOUD: booleanFromEnv.default(false),

  // LLM resilience (both backends)
  LLM_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  LLM_RETRY_BASE_MS: z.coerce.number().int().min(0).max(60000).default(500),

  // Task worker
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(1),

  // Browser automation (Phase 2 hands)
  /** Concurrent browser contexts; one per running browser task. */
  BROWSER_POOL_SIZE: z.coerce.number().int().min(1).max(16).default(2),
  /** Hard cap for page-agent's maxSteps — employee caps clamp to this. */
  BROWSER_MAX_STEPS_HARD_CAP: z.coerce.number().int().min(1).max(2000).default(500),
  /** Navigation + overall per-task browser timeout. */
  BROWSER_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(60_000),
  /** awaiting_approval tasks older than this auto-cancel (the consent clock). */
  APPROVAL_TIMEOUT_HOURS: z.coerce.number().min(1).max(24 * 30).default(24),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Exported for CLI tools that need to validate a SUBSET of the environment
 * (e.g. keycheck validates only the LLM block, so unrelated shell exports
 * like PORT=0 cannot block a diagnostic run).
 */
export { configSchema };

/** Parse and validate configuration; throws a descriptive error on bad input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
