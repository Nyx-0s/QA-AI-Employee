import type { TestSuiteDefinition } from "../core/tests/models/TestDefinition";
import type { BusinessContext } from "./BusinessContext";

export interface BusinessBrain {
  readonly id: string;
  readonly name: string;

  supports(context: BusinessContext): boolean;

  getSuites(
    context: BusinessContext
  ): Promise<TestSuiteDefinition[]>;
}
