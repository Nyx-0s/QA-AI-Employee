import type { TaskLog } from "@consentark/shared";

/**
 * Pure helpers for rendering the audit timeline. The timeline must let an
 * operator reconstruct exactly what an employee did and why — so related
 * log lines are grouped and each phase gets a distinct visual treatment.
 */

export type AuditGroupKind = "llm" | "browser" | "safety" | "system" | "other";

/** Map a log phase to a timeline visual group. */
export function auditGroupKind(phase: TaskLog["phase"]): AuditGroupKind {
  switch (phase) {
    case "llm":
    case "plan":
      return "llm";
    case "browser":
    case "tool":
      return "browser";
    case "safety":
      return "safety";
    case "system":
      return "system";
    default:
      return "other";
  }
}

export interface AuditGroup {
  kind: AuditGroupKind;
  label: string;
  entries: TaskLog[];
}

/** Group consecutive log lines of the same visual kind (stable, in order). */
export function groupAuditLogs(logs: TaskLog[]): AuditGroup[] {
  const groups: AuditGroup[] = [];
  for (const entry of logs) {
    const kind = auditGroupKind(entry.phase);
    const last = groups[groups.length - 1];
    if (last && last.kind === kind) {
      last.entries.push(entry);
    } else {
      groups.push({ kind, label: auditGroupLabel(kind), entries: [entry] });
    }
  }
  return groups;
}

function auditGroupLabel(kind: AuditGroupKind): string {
  switch (kind) {
    case "llm":
      return "AI reasoning";
    case "browser":
      return "Browser actions";
    case "safety":
      return "Safety / consent";
    case "system":
      return "System";
    default:
      return "Other";
  }
}

/** Does the audit trail contain at least one LLM call and one browser step? */
export function auditHasLlmAndBrowser(logs: TaskLog[]): boolean {
  const kinds = new Set(logs.map((entry) => auditGroupKind(entry.phase)));
  return kinds.has("llm") && kinds.has("browser");
}
