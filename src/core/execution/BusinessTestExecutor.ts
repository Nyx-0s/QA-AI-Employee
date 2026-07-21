import type { Page } from "@playwright/test";

import type { ExecutionPlan } from "../planner/ExecutionPlan";
import type { TestExecutionResult } from "./TestExecutionResult";
import { ScreenshotManager } from "../qa/ScreenshotManager";

import { ReadOnlyExecutor } from "./adapters/ReadOnlyExecutor";
import { SafeInteractionExecutor } from "./adapters/SafeInteractionExecutor";

export class BusinessTestExecutor {

  private readonly readOnly = new ReadOnlyExecutor();
  private readonly safeInteraction = new SafeInteractionExecutor();
  private readonly screenshots = new ScreenshotManager();

  async execute(
    page: Page,
    plan: ExecutionPlan
  ): Promise<TestExecutionResult[]> {

    const results: TestExecutionResult[] = [];

    for (const test of plan.readOnly) {
      results.push(
        await this.readOnly.execute(page, test)
      );
    }

    for (const test of plan.safeInteraction) {
      let screenshotBefore: string | undefined;
      let screenshotAfter: string | undefined;

      try {
        screenshotBefore =
          await this.screenshots.captureBusinessTest(
            page,
            test.module,
            test.feature,
            test.id,
            "before"
          );
      } catch {
        screenshotBefore = undefined;
      }

      const result =
        await this.safeInteraction.execute(page, test);

      try {
        screenshotAfter =
          await this.screenshots.captureBusinessTest(
            page,
            test.module,
            test.feature,
            test.id,
            "after"
          );
      } catch {
        screenshotAfter = undefined;
      }

      results.push({
        ...result,
        ...(screenshotBefore ? { screenshotBefore } : {}),
        ...(screenshotAfter ? { screenshotAfter } : {})
      });
    }

    for (const test of plan.dataCreation) {
      results.push({
        test,
        status: "SKIPPED",
        expected: test.expected.map(x => x.description),
        observed: [
          "DATA_CREATION disabled in Community Edition"
        ],
        durationMs: 0
      });
    }

    for (const test of plan.destructive) {
      results.push({
        test,
        status: "SKIPPED",
        expected: test.expected.map(x => x.description),
        observed: [
          "DESTRUCTIVE tests disabled"
        ],
        durationMs: 0
      });
    }

    return results;
  }

}
