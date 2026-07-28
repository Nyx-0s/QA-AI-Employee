import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class FindButtonCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        const scope = context.currentForm ?? context.page.locator("body");

        const buttons = scope.locator(
            "button,input[type='submit'],input[type='button'],[role='button']"
        );

        const total = await buttons.count();

        const hints = (action.target ?? "")
            .toLowerCase()
            .split("|")
            .map(s => s.trim())
            .filter(Boolean);

        for (let i = 0; i < total; i++) {

            const button = buttons.nth(i);

            if (!(await button.isVisible().catch(() => false)))
                continue;

            if (!(await button.isEnabled().catch(() => false)))
                continue;

            const text = [
                await button.innerText().catch(() => ""),
                await button.getAttribute("value").catch(() => ""),
                await button.getAttribute("title").catch(() => ""),
                await button.getAttribute("aria-label").catch(() => ""),
                await button.getAttribute("name").catch(() => ""),
                await button.getAttribute("id").catch(() => "")
            ]
            .join(" ")
            .toLowerCase();

            if (!hints.length || hints.some(h => text.includes(h))) {
                context.current = button;
                context.observations.push("Button located");
                return;
            }

        }

        throw new Error("Button not found.");

    }

}
