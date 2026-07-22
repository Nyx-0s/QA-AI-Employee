import type { TestSuiteDefinition } from "../core/tests/models/TestDefinition";
import type { BusinessContext } from "./BusinessContext";
import type { BusinessRegistry } from "./BusinessRegistry";

export class BusinessEngine {
  constructor(
    private readonly registry: BusinessRegistry
  ) {}

  async getSuites(
    context: BusinessContext
  ): Promise<TestSuiteDefinition[]> {
    const brains = this.registry.resolve(context);

    const suiteGroups = await Promise.all(
      brains.map(brain => brain.getSuites(context))
    );

    const uniqueSuites = new Map<string, TestSuiteDefinition>();

    for (const suites of suiteGroups) {
      for (const suite of suites) {
        uniqueSuites.set(suite.id, suite);
      }
    }

    return [...uniqueSuites.values()];
  }
}
