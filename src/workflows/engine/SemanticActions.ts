import { Page } from "playwright";

export class SemanticActions {

  constructor(private page: Page) {}

  async click(text: string) {
    await this.page
      .getByRole("button", {
        name: new RegExp(text, "i")
      })
      .first()
      .click();
  }

  async fill(placeholder: string, value: string) {
    await this.page
      .getByPlaceholder(new RegExp(placeholder, "i"))
      .fill(value);
  }

  async select(index: number, label: string) {
    await this.page
      .locator("select")
      .nth(index)
      .selectOption({ label });
  }

}
