export type EvidenceType =
  | "BUSINESS_TEST"
  | "NETWORK"
  | "CONSOLE"
  | "PAGE";

export interface Evidence {
  id: string;

  type: EvidenceType;

  module: string;
  page: string;
  url: string;

  severity: "INFO";

  summary: string;

  screenshot?: string;

  metadata: Record<string, unknown>;
}
