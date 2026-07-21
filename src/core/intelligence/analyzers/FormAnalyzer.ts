import type { Page } from "playwright";
import type { IntelligentForm } from "../ElementTypes";

export class FormAnalyzer {
  async analyze(page: Page): Promise<IntelligentForm[]> {
    return page.locator("form").evaluateAll(forms =>
      forms.map((form, index) => {
        const htmlForm = form as HTMLFormElement;
        const style = window.getComputedStyle(htmlForm);

        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          htmlForm.getBoundingClientRect().width > 0 &&
          htmlForm.getBoundingClientRect().height > 0;

        return {
          index,
          id: htmlForm.id || "",
          name: htmlForm.name || "",
          action: htmlForm.action || "",
          method: htmlForm.method || "get",
          visible,
          inputCount: form.querySelectorAll(
            'input, textarea, select, [contenteditable="true"], [role="textbox"]'
          ).length,
          requiredInputCount: form.querySelectorAll(
            '[required], [aria-required="true"]'
          ).length,
          buttonCount: form.querySelectorAll(
            'button, input[type="submit"], input[type="button"], [role="button"]'
          ).length
        };
      })
    );
  }
}
