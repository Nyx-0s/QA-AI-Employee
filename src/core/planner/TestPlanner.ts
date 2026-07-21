import { TestDefinitionLoader } from "../tests/runtime/TestDefinitionLoader";
import type { ExecutionPlan } from "./ExecutionPlan";

export class TestPlanner {
  private readonly loader = new TestDefinitionLoader();

  async createPlan(
    moduleName: string,
    pageName: string,
    url: string
  ): Promise<ExecutionPlan> {

    const suites = await this.loader.findSuitesForPage(
      moduleName,
      pageName,
      url
    );

    const plan: ExecutionPlan = {
      page: pageName,
      module: moduleName,
      readOnly: [],
      safeInteraction: [],
      dataCreation: [],
      destructive: [],
      totalTests: 0
    };

    for (const suite of suites) {
      for (const test of suite.tests) {

        if (!test.enabled) continue;

        plan.totalTests++;

        switch (test.executionMode) {

          case "READ_ONLY":
            plan.readOnly.push(test);
            break;

          case "SAFE_INTERACTION":
            plan.safeInteraction.push(test);
            break;

          case "DATA_CREATION":
            plan.dataCreation.push(test);
            break;

          case "DESTRUCTIVE":
            plan.destructive.push(test);
            break;
        }
      }
    }

    return plan;
  }
}
