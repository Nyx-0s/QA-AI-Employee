import type { Page } from "playwright";
import type { IntelligentInput } from "../ElementTypes";

export class InputAnalyzer {
  async analyze(page: Page): Promise<IntelligentInput[]> {
    return page.locator(
      'input, textarea, [contenteditable="true"], [role="textbox"]'
    ).evaluateAll(elements =>
      elements.map((element, index) => {
        const htmlElement = element as HTMLElement;
        const input = element as HTMLInputElement;

        const id = input.id || "";
        const explicitLabel = id
          ? document.querySelector(`label[for="${CSS.escape(id)}"]`)
              ?.textContent?.trim() || ""
          : "";

        const parentLabel =
          element.closest("label")?.textContent?.trim() || "";

        const ariaLabel =
          element.getAttribute("aria-label") || "";

        const label =
          explicitLabel ||
          ariaLabel ||
          parentLabel;

        const style = window.getComputedStyle(htmlElement);

        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          htmlElement.getBoundingClientRect().width > 0 &&
          htmlElement.getBoundingClientRect().height > 0;

        const tag = element.tagName.toLowerCase();
        const type =
          tag === "textarea"
            ? "textarea"
            : input.type || tag;

        const disabled =
          input.disabled ||
          element.getAttribute("aria-disabled") === "true";

        const readonly =
          input.readOnly ||
          element.getAttribute("aria-readonly") === "true";

        const contentEditable =
          htmlElement.isContentEditable;

        return {
          index,
          tag,
          type,
          name: input.name || "",
          id,
          label,
          placeholder:
            input.placeholder ||
            element.getAttribute("placeholder") ||
            "",
          value:
            contentEditable
              ? htmlElement.textContent || ""
              : input.value || "",
          visible,
          enabled: !disabled,
          required:
            input.required ||
            element.getAttribute("aria-required") === "true",
          readonly,
          editable:
            visible &&
            !disabled &&
            !readonly &&
            (
              contentEditable ||
              ![
                "hidden",
                "submit",
                "button",
                "reset",
                "checkbox",
                "radio",
                "file"
              ].includes(type)
            ),
          autocomplete: input.autocomplete || "",
          minLength:
            typeof input.minLength === "number" &&
            input.minLength >= 0
              ? input.minLength
              : undefined,
          maxLength:
            typeof input.maxLength === "number" &&
            input.maxLength >= 0
              ? input.maxLength
              : undefined,
          pattern: input.pattern || ""
        };
      })
    );
  }
}
