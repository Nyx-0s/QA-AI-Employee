import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class FindElementCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        const selector =
            String(action.metadata?.selector ?? "*");

        const exact =
            Boolean(action.metadata?.exact);

        const target =
            (action.target ?? "").trim();

        const elements =
            context.page.locator(selector);

        const total = await elements.count();

        for (let i = 0; i < total; i++) {

            const element = elements.nth(i);

            if (!(await element.isVisible().catch(() => false)))
                continue;

            const text =
                ((await element.textContent().catch(() => "")) ?? "").trim();

            if (!target) {
                context.current = element;
                context.observations.push("Element located");
                return;
            }

            const matched =
                exact
                    ? text === target
                    : text.toLowerCase().includes(target.toLowerCase());

            if (matched) {
                context.current = element;
                context.observations.push(`Element located: ${target}`);
                return;
            }

        }

        throw new Error(`Element not found: ${target}`);

    }

}
