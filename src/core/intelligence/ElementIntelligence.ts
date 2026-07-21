import type { Page } from "playwright";
import type { PageElementProfile } from "./ElementTypes";
import { PageAnalyzer } from "./PageAnalyzer";

export class ElementIntelligence {
  private readonly analyzer = new PageAnalyzer();

  async inspect(page: Page): Promise<PageElementProfile> {
    return this.analyzer.analyze(page);
  }
}
