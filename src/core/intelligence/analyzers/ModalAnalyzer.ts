import type { Page } from "playwright";
import type { IntelligentModal } from "../ElementTypes";

export class ModalAnalyzer {
  async analyze(page: Page): Promise<IntelligentModal[]> {
    return page.locator(
      '[role="dialog"], [aria-modal="true"], dialog, .modal'
    ).evaluateAll(elements =>
      elements.map((element, index) => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);

        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          htmlElement.getBoundingClientRect().width > 0 &&
          htmlElement.getBoundingClientRect().height > 0;

        const heading = element.querySelector(
          "h1, h2, h3, h4, [role='heading'], .modal-title"
        );

        return {
          index,
          role:
            element.getAttribute("role") ||
            element.tagName.toLowerCase(),
          title:
            heading?.textContent?.trim() ||
            element.getAttribute("aria-label") ||
            "",
          visible,
          buttonCount: element.querySelectorAll(
            'button, [role="button"]'
          ).length,
          inputCount: element.querySelectorAll(
            'input, textarea, select, [role="textbox"], [role="combobox"]'
          ).length
        };
      })
    );
  }
}
