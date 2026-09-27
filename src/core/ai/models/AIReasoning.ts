import type {
  QASeverity,
  QACategory
} from "./QAFinding";

export interface AIRootCause {
  cause: string;
  confidence: number;
  evidence: string[];
}

export interface AIRemediation {
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  team:
    | "FRONTEND"
    | "BACKEND"
    | "QA"
    | "DEVOPS"
    | "SECURITY"
    | "PRODUCT"
    | "UNKNOWN";

  action: string;
}

export interface AIReasoning {
  summary: string;

  risk: QASeverity;

  category?: QACategory;

  confidence: number;

  rootCauses: AIRootCause[];

  remediations: AIRemediation[];
}
