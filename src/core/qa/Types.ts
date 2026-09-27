import type { PageElementProfile } from "../intelligence/ElementTypes";
import type {
  PageInspection,
} from "../intelligence/PageInspector";

import type { TestExecutionResult } from "../execution/TestExecutionResult";
import type { AIReasoning } from "../ai/models/AIReasoning";

import type {
  ScoreResult,
} from "../intelligence/PageScorer";

export interface NavigationItem {
  text: string;
  href: string;
  tag?: string;
  visible?: boolean;
}

export interface NavigationGroup {
  module: string;
  items: NavigationItem[];
}

export interface ConsoleIssue {
  type: string;
  text: string;
  location?: string;
  timestamp: string;
}

export interface NetworkIssue {
  url: string;
  method: string;
  status: number;
  statusText: string;
  resourceType: string;
  timestamp: string;
}

export interface PerformanceMetrics {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

export interface PageQAResult {
  module: string;
  page: string;
  url: string;
  finalUrl: string;

  success: boolean;

  performance: PerformanceMetrics;

  consoleErrors: ConsoleIssue[];
  networkErrors: NetworkIssue[];

  screenshot: string;

  inspection?: PageInspection;
  elementIntelligence?: PageElementProfile;
  score?: ScoreResult;

  error?: string;

  businessTests?: TestExecutionResult[];

  aiAnalysis?: AIReasoning;
}

export interface QASummary {
  startedAt: string;
  finishedAt?: string;

  totalPages: number;
  passed: number;
  failed: number;
  skipped: number;

  pages: PageQAResult[];
}