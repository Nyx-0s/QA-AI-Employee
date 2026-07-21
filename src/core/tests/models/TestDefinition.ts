export type TestCategory =
  | "PAGE_LOAD"
  | "UI"
  | "INPUT"
  | "VALIDATION"
  | "SEARCH"
  | "WORKFLOW"
  | "BUSINESS_RULE"
  | "PAYMENT"
  | "PERMISSION"
  | "UPLOAD"
  | "REGRESSION";

export type TestRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type TestExecutionMode =
  | "READ_ONLY"
  | "SAFE_INTERACTION"
  | "DATA_CREATION"
  | "DESTRUCTIVE";

export type TestResultStatus =
  | "PASS"
  | "FAIL"
  | "WARNING"
  | "BLOCKED"
  | "NOT_TESTED"
  | "SKIPPED";

export interface TestInputDefinition {
  field: string;
  value: string | number | boolean | null;
  description?: string;
}

export interface TestExpectedResult {
  description: string;
  selector?: string;
  text?: string;
  urlContains?: string;
  statusCode?: number;
}

export interface BusinessTestDefinition {
  id: string;
  name: string;
  description: string;

  module: string;
  feature: string;

  category: TestCategory;
  risk: TestRisk;
  executionMode: TestExecutionMode;

  preconditions: string[];
  steps: string[];

  inputs?: TestInputDefinition[];
  expected: TestExpectedResult[];

  tags: string[];

  enabled: boolean;
}

export interface TestSuiteDefinition {
  id: string;
  name: string;
  module: string;
  feature: string;
  description: string;

  routeHints: string[];
  tests: BusinessTestDefinition[];
}

export interface BusinessTestResult {
  testId: string;
  testName: string;

  module: string;
  feature: string;

  category: TestCategory;
  risk: TestRisk;

  status: TestResultStatus;

  expected: string[];
  observed: string[];

  stepsExecuted: string[];

  durationMs: number;

  screenshotBefore?: string;
  screenshotAfter?: string;

  error?: string;
  blockedReason?: string;
}
