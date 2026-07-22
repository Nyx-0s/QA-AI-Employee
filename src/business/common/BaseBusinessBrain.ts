import type { BusinessBrain } from "../BusinessBrain";
import type { BusinessContext } from "../BusinessContext";
import type { TestSuiteDefinition } from "../../core/tests/models/TestDefinition";
import { TestDefinitionLoader } from "../../core/tests/runtime/TestDefinitionLoader";

export abstract class BaseBusinessBrain implements BusinessBrain {
  abstract readonly id: string;
  abstract readonly name: string;

  protected readonly loader = new TestDefinitionLoader();

  abstract supports(context: BusinessContext): boolean;

  async getSuites(
    context: BusinessContext
  ): Promise<TestSuiteDefinition[]> {
    return this.loader.findSuitesForPage(
      context.moduleName,
      context.pageName,
      context.url
    );
  }

  protected matches(
    context: BusinessContext,
    patterns: RegExp[]
  ): boolean {
    const searchable = [
      context.moduleName,
      context.pageName,
      context.url
    ]
      .join(" ")
      .toLowerCase();

    return patterns.some(pattern => pattern.test(searchable));
  }
}
