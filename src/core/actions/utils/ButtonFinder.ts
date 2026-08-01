import type { Locator } from "@playwright/test";

export class ButtonFinder {

  async find(
    scope: Locator,
    hints: string[]
  ): Promise<Locator | null> {

    const actions = scope.locator(
      [
        "button",
        "input[type='submit']",
        "input[type='button']",
        "[role='button']"
      ].join(",")
    );

    const total = await actions.count();

    for (let index = 0; index < total; index++) {

      const action = actions.nth(index);

      if (!(await action.isVisible().catch(() => false))) {
        continue;
      }

      if (!(await action.isEnabled().catch(() => false))) {
        continue;
      }

      const text = await action.innerText().catch(() => "");
      const value = await action.getAttribute("value").catch(() => "");
      const title = await action.getAttribute("title").catch(() => "");
      const aria = await action.getAttribute("aria-label").catch(() => "");
      const name = await action.getAttribute("name").catch(() => "");
      const id = await action.getAttribute("id").catch(() => "");

      const haystack = [
        text,
        value || "",
        title || "",
        aria || "",
        name || "",
        id || ""
      ]
        .join(" ")
        .toLowerCase();

      if (
        hints.some(h =>
          haystack.includes(h.toLowerCase())
        )
      ) {
        return action;
      }
    }

    return null;
  }

}
