import { PageQAResult } from "../../core/qa/Types";

export class ContextBuilder {
  static build(result: PageQAResult) {
    return {
      module: result.module,
      page: result.page,
      score: result.score,
      success: result.success,
      businessTests: result.businessTests,
      consoleErrors: result.consoleErrors,
      networkErrors: result.networkErrors,
      performance: result.performance
    };
  }
}
