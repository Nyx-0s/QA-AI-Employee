import type { Page } from "@playwright/test";

import { TestPlanner } from "../planner/TestPlanner";
import { BusinessTestExecutor } from "./BusinessTestExecutor";
import type { TestExecutionResult } from "./TestExecutionResult";

export class BusinessTestRunner {

  private readonly planner = new TestPlanner();
  private readonly executor = new BusinessTestExecutor();

  async run(
    page: Page,
    moduleName: string,
    pageName: string,
    url: string
  ): Promise<TestExecutionResult[]> {

    const plan = await this.planner.createPlan(
      moduleName,
      pageName,
      url
    );

    return this.executor.execute(page, plan);
  }

}
