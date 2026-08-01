import type { Locator } from "@playwright/test";

export class FieldFinder {

  async find(
    scope: Locator,
    hints: string[]
  ): Promise<Locator | null> {

    const inputs = scope.locator(
      [
        "input:not([type='hidden'])",
        "textarea"
      ].join(",")
    );

    const total = await inputs.count();

    for (let index = 0; index < total; index++) {

      const input = inputs.nth(index);

      if (!(await input.isVisible().catch(() => false))) {
        continue;
      }

      if (!(await input.isEnabled().catch(() => false))) {
        continue;
      }

      const identity = await this.elementIdentity(input);
      const nearby = await this.nearbyText(input);

      const haystack =
        `${identity} ${nearby}`.toLowerCase();

      if (
        hints.some(h =>
          haystack.includes(h.toLowerCase())
        )
      ) {
        return input;
      }
    }

    return null;
  }

  async elementIdentity(
    element: Locator
  ): Promise<string> {

    const attributes = await Promise.all([
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("type"),
      element.getAttribute("placeholder"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid")
    ]);

    return attributes
      .filter(Boolean)
      .join(" ");
  }

  async nearbyText(
    element: Locator
  ): Promise<string> {

    const id =
      await element.getAttribute("id");

    let labelText = "";

    if (id) {
      labelText = await element
        .page()
        .locator(
          `label[for="${this.escapeAttribute(id)}"]`
        )
        .first()
        .innerText()
        .catch(() => "");
    }

    const parentText = await element
      .locator(
        "xpath=ancestor::*[self::label or self::div or self::td][1]"
      )
      .innerText()
      .catch(() => "");

    return `${labelText} ${parentText}`.trim();
  }

  private escapeAttribute(
    value: string
  ): string {

    return value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  }

}
