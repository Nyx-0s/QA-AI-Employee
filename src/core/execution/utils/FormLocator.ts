import type { Locator, Page } from "@playwright/test";

export class FormLocator {

  async findMainForm(
    page: Page
  ): Promise<Locator | null> {

    const selectors = [
      "form",
      "[role=form]",
      ".form",
      ".registration-form",
      "#registrationForm",
      "[id*=form]",
      "[class*=form]"
    ];

    for (const selector of selectors) {

      const locator = page.locator(selector).first();

      if (await locator.count() === 0)
        continue;

      if (!(await locator.isVisible()))
        continue;

      return locator;

    }

    return null;

  }

  async textInputs(
    form: Locator
  ): Promise<Locator[]> {

    const inputs = form.locator(
      "input[type=text],input[type=email],input[type=tel],textarea"
    );

    const total = await inputs.count();

    const result: Locator[] = [];

    for (let i = 0; i < total; i++) {

      const input = inputs.nth(i);

      if (!(await input.isVisible()))
        continue;

      if (!(await input.isEnabled()))
        continue;

      result.push(input);

    }

    return result;

  }

}
