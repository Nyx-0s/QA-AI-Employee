import type { Page } from "playwright";
import type { IntelligentButton } from "../ElementTypes";

interface RawButton {
  text: string;
  type: string;
  id: string;
  name: string;
  ariaLabel: string;
  title: string;
  visible: boolean;
  enabled: boolean;
}

export class ButtonAnalyzer {
  async analyze(page: Page): Promise<IntelligentButton[]> {
    const rawButtons = await page
      .locator(
        [
          "button",
          'input[type="button"]',
          'input[type="submit"]',
          'input[type="reset"]',
          '[role="button"]',
        ].join(", ")
      )
      .evaluateAll((elements): RawButton[] =>
        elements.map(element => {
          const htmlElement = element as HTMLElement;
          const input = element as HTMLInputElement;
          const button = element as HTMLButtonElement;

          const style = window.getComputedStyle(htmlElement);
          const rect = htmlElement.getBoundingClientRect();

          const visible =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            rect.width > 0 &&
            rect.height > 0;

          const disabled =
            button.disabled ||
            input.disabled ||
            element.getAttribute("aria-disabled") === "true";

          const rawText =
            htmlElement.innerText ||
            input.value ||
            element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            "";

          const normalizedText = rawText
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 180);

          return {
            text: normalizedText,
            type:
              button.type ||
              input.type ||
              element.getAttribute("role") ||
              "button",
            id: htmlElement.id || "",
            name: input.name || "",
            ariaLabel:
              element.getAttribute("aria-label") || "",
            title:
              element.getAttribute("title") || "",
            visible,
            enabled: !disabled,
          };
        })
      );

    const visibleButtons = rawButtons.filter(
      button => button.visible
    );

    const grouped = new Map<
      string,
      Omit<IntelligentButton, "index">
    >();

    for (const button of visibleButtons) {
      const key = this.signature(button);
      const existing = grouped.get(key);

      if (existing) {
        existing.occurrences += 1;
        continue;
      }

      grouped.set(key, {
        ...button,
        occurrences: 1,
      });
    }

    return Array.from(grouped.values()).map(
      (button, index) => ({
        index,
        ...button,
      })
    );
  }

  private signature(button: RawButton): string {
    return [
      button.text.toLowerCase(),
      button.type.toLowerCase(),
      button.ariaLabel.toLowerCase(),
      button.title.toLowerCase(),
      button.enabled ? "enabled" : "disabled",
    ].join("|");
  }
}
