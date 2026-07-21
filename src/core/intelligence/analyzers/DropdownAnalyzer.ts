import type { Page } from "playwright";
import type { IntelligentDropdown } from "../ElementTypes";

export class DropdownAnalyzer {
  async analyze(page: Page): Promise<IntelligentDropdown[]> {
    return page.locator(
      'select, [role="combobox"], [aria-haspopup="listbox"]'
    ).evaluateAll(elements =>
      elements.map((element, index) => {
        const htmlElement = element as HTMLElement;
        const select = element as HTMLSelectElement;

        const id = htmlElement.id || "";

        const explicitLabel = id
          ? document.querySelector(`label[for="${CSS.escape(id)}"]`)
              ?.textContent?.trim() || ""
          : "";

        const style = window.getComputedStyle(htmlElement);

        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          htmlElement.getBoundingClientRect().width > 0 &&
          htmlElement.getBoundingClientRect().height > 0;

        const options =
          element.tagName.toLowerCase() === "select"
            ? select.options.length
            : element.querySelectorAll(
                '[role="option"], option'
              ).length;

        return {
          index,
          tag: element.tagName.toLowerCase(),
          id,
          name: select.name || "",
          label:
            explicitLabel ||
            element.getAttribute("aria-label") ||
            "",
          visible,
          enabled:
            !select.disabled &&
            element.getAttribute("aria-disabled") !== "true",
          optionCount: options,
          selectedValue:
            select.value ||
            element.getAttribute("aria-valuetext") ||
            ""
        };
      })
    );
  }
}
