import type {
  BusinessTestDefinition,
  TestResultStatus,
} from "../tests/models/TestDefinition";

export interface TestExecutionResult {
  test: BusinessTestDefinition;

  status: TestResultStatus;

  expected: string[];
  observed: string[];

  durationMs: number;

  screenshotBefore?: string;
  screenshotAfter?: string;

  error?: string;
}
