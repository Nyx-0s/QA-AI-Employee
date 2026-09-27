export type QASeverity =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL";

export type QACategory =
  | "BUSINESS_RULE"
  | "VALIDATION"
  | "FUNCTIONAL"
  | "NETWORK"
  | "CONSOLE"
  | "PERFORMANCE"
  | "SECURITY"
  | "UI"
  | "UNKNOWN";

export type FindingSource =
  | "BUSINESS_TEST"
  | "NETWORK"
  | "CONSOLE"
  | "PAGE"
  | "AI";

export interface QAFinding {
  id: string;

  module: string;
  page: string;

  title: string;
  category: QACategory;
  severity: QASeverity;
  source: FindingSource;

  evidence: string[];

  businessImpact: string;

  probableRootCause: string[];

  reproductionSteps: string[];

  recommendedFix: string[];

  responsibleTeam:
    | "FRONTEND"
    | "BACKEND"
    | "QA"
    | "DEVOPS"
    | "SECURITY"
    | "PRODUCT"
    | "UNKNOWN";

  confidence: number;

  testId?: string;
}
