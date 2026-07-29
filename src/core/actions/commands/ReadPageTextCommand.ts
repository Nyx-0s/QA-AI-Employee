import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";
import type { IActionCommand } from "./IActionCommand";

export class ReadPageTextCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!action.variable) {
            throw new Error("READ_PAGE_TEXT requires 'variable'.");
        }

        const text =
            await context.page.locator("body").innerText();

        context.variables[action.variable] = text;

        context.observations.push(
            `Read page text -> ${action.variable}`
        );

    }

}
