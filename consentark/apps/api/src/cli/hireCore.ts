import {
  SUPPORTED_TOOLS,
  employeeCreateSchema,
  type EmployeeCreateInput,
  type SupportedTool,
} from "@consentark/shared";
import { issueToken } from "../auth/tokens.js";
import { uniqueSlug } from "../util/ids.js";
import { DATA_CLERK_TEMPLATE, getTemplate, TEMPLATES, TEMPLATE_ALIASES } from "./templates.js";
export { DATA_CLERK_TEMPLATE, TEMPLATES, TEMPLATE_ALIASES, getTemplate };

/**
 * Hire flow core (Phase 4) — everything the hire CLI does that is worth
 * testing, kept free of console/readline so tests drive it directly.
 *
 * Two layers:
 * - resolveHireInput(): flags/template/defaults → a validated
 *   EmployeeCreateInput. Throws CliError with a friendly message.
 * - performHire(): resolve → create the employee → issue + store its token
 *   → return everything the CLI prints (id, token, next steps).
 *
 * Allowlist semantics intentionally mirror the RUNTIME enforcement
 * (BrowserService.isAllowed + the enqueue checks): entries are hostnames,
 * matched lowercase with a dot-boundary suffix rule (`example.com` matches
 * `app.example.com` but NOT `notexample.com`). Ports and paths are not part
 * of the contract; the CLI normalizes URLs to hostnames so an operator who
 * pastes `https://app.example.com/forms` gets the safe subset.
 */

/** A user-facing CLI error (printed as `error: …`, exit 1). */
export class CliError extends Error {}

export interface HireFlags {
  name?: string;
  tools?: string;
  allowlist?: string;
  confirm?: boolean;
  backend?: string;
  model?: string;
  maxSteps?: string;
  systemPrompt?: string;
  /** Recurring cron expression (5 fields); omit or blank = no schedule. */
  scheduleCron?: string;
  /** Objective template for scheduled runs (required with scheduleCron). */
  scheduleTask?: string;
  /** Internal: alias of the selected template (base = the template). */
  templateAlias?: string;
}

/** HireProfile lives in the template registry (single source of personas). */
export type { HireProfile } from "./templates.js";
import type { HireProfile } from "./templates.js";

/** The one-line explanations shown during the interactive flow. */
export const TOOL_EXPLANATIONS: Record<SupportedTool, string> = {
  chat_task: "Answers questions and reasons in text — no browser.",
  browser_task: "Operates a real web browser within its approved domain allowlist.",
};

/** Parse + validate a comma-separated tool list. */
export function parseTools(raw: string | undefined): SupportedTool[] {
  if (raw === undefined || raw.trim() === "") return [];
  const tools = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  for (const tool of tools) {
    if (!(SUPPORTED_TOOLS as readonly string[]).includes(tool)) {
      throw new CliError(
        `unknown tool \"${tool}\" — supported: ${SUPPORTED_TOOLS.join(", ")}`,
      );
    }
  }
  return [...new Set(tools)] as SupportedTool[];
}

/**
 * Normalize one allowlist entry to the runtime's hostname contract.
 * Accepts a bare hostname or any URL and returns the hostname; everything
 * else (ports, paths, schemes) is not part of the enforcement contract.
 */
export function normalizeDomainEntry(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) throw new CliError("allowlist entry is empty");
  if (trimmed.includes("/") || trimmed.includes(":")) {
    try {
      const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
      return url.hostname;
    } catch {
      throw new CliError(
        `\"${raw}\" is not a valid hostname or URL — use e.g. \"example.com\" or \"app.example.com\"`,
      );
    }
  }
  if (!/^[a-z0-9.-]+$/.test(trimmed)) {
    throw new CliError(
      `\"${raw}\" is not a valid hostname — use letters, digits, dots and dashes only`,
    );
  }
  return trimmed;
}

/** Parse + validate a comma-separated allowlist. */
export function parseAllowlist(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const part of raw.split(",")) {
    const entry = normalizeDomainEntry(part);
    if (!seen.has(entry)) {
      seen.add(entry);
      entries.push(entry);
    }
  }
  return entries;
}

export function parseMaxSteps(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw new CliError(`maxSteps must be an integer between 1 and 200 (got \"${raw}\")`);
  }
  return value;
}

export function parseBackend(raw: string | undefined): "cloud" | "local" | undefined {
  if (raw === undefined) return undefined;
  if (raw !== "cloud" && raw !== "local") {
    throw new CliError(`backend must be \"cloud\" or \"local\" (got \"${raw}\")`);
  }
  return raw;
}

/** flags + template → validated EmployeeCreateInput. */
export function resolveHireInput(flags: HireFlags): EmployeeCreateInput {
  const base: HireProfile =
    flags.templateAlias !== undefined
      ? // Template personas ship a complete profile; every field can still
        // be overridden by an explicit flag below. (Aliases are validated
        // by the CLI before resolveHireInput runs.)
        { ...getTemplate(flags.templateAlias)! }
      : {
          name: "",
          role: "custom",
          description: "",
          systemPrompt: "",
          backend: "cloud",
          model: "auto",
          toolsEnabled: [],
          allowedDomains: [],
          confirmBeforeSubmit: true,
          maxStepsPerTask: 25,
        };

  const profile: HireProfile = {
    ...base,
    name: flags.name ?? base.name,
    systemPrompt: flags.systemPrompt ?? base.systemPrompt,
    backend: parseBackend(flags.backend) ?? base.backend,
    model: flags.model ?? base.model,
    toolsEnabled: flags.tools !== undefined ? parseTools(flags.tools) : base.toolsEnabled,
    allowedDomains:
      flags.allowlist !== undefined ? parseAllowlist(flags.allowlist) : base.allowedDomains,
    confirmBeforeSubmit: flags.confirm ?? base.confirmBeforeSubmit,
    maxStepsPerTask: parseMaxSteps(flags.maxSteps) ?? base.maxStepsPerTask,
  };

  // Validate flag pairs before the required-field checks so a CLI typo
  // surfaces as the schedule error, not as "name is required".
  const schedule = resolveSchedule(flags);

  if (profile.name.trim().length === 0) {
    throw new CliError("name is required (interactive prompt or --name)");
  }
  if (profile.systemPrompt.trim().length === 0) {
    throw new CliError("systemPrompt is required (--system-prompt or the interactive prompt)");
  }

  const parsed = employeeCreateSchema.safeParse({
    name: profile.name,
    role: profile.role,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    backend: profile.backend,
    model: profile.model,
    toolsEnabled: profile.toolsEnabled,
    allowedDomains: profile.allowedDomains,
    confirmBeforeSubmit: profile.confirmBeforeSubmit,
    maxStepsPerTask: profile.maxStepsPerTask,
    schedule,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CliError(`${issue.path.join(".") || "payload"}: ${issue.message}`);
  }
  return parsed.data;
}

/**
 * flags → schedule. A cron without a task template (or a task without a
 * cron) is a CliError; blank/missing flags mean no schedule at all.
 */
function resolveSchedule(flags: HireFlags): EmployeeCreateInput["schedule"] {
  const cron = flags.scheduleCron?.trim() ?? "";
  const taskTemplate = flags.scheduleTask?.trim() ?? "";
  if (cron.length === 0 && taskTemplate.length === 0) return null;
  if (cron.length === 0) {
    throw new CliError("--schedule-task given without --schedule-cron — a schedule needs both");
  }
  if (taskTemplate.length === 0) {
    throw new CliError("--schedule-cron given without --schedule-task — a schedule needs both");
  }
  if (cron.trim().split(/\s+/).length !== 5) {
    throw new CliError(
      `cron "${cron}" must have 5 fields (minute hour day month weekday), e.g. "0 8 * * 1-5"`,
    );
  }
  return { cron, taskTemplate };
}

/** What a completed hire hands back to the CLI for printing. */
export interface HireResult {
  employeeId: string;
  token: string;
  employee: EmployeeCreateInput;
}

/** Repository surface performHire needs (satisfied by the real repos). */
export interface HireDeps {
  employees: { get(id: string): unknown; create(id: string, input: EmployeeCreateInput, now: string): unknown };
  tokens: { create(employeeId: string, tokenHash: string, now: string): void };
}

/** The write path: create employee + issue/store its hiring token. */
export function performHire(
  deps: HireDeps,
  flags: HireFlags,
  now: string = new Date().toISOString(),
): HireResult {
  const input = resolveHireInput(flags);
  const employeeId = uniqueSlug(input.name, (slug) => deps.employees.get(slug) !== null);
  deps.employees.create(employeeId, input, now);
  const issued = issueToken();
  deps.tokens.create(employeeId, issued.tokenHash, now);
  return { employeeId, token: issued.token, employee: input };
}
