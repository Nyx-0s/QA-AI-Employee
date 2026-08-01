import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";
import type { IActionCommand } from "./IActionCommand";

export class ReadNumberFromPageCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        const text = await context.page.locator("body").innerText();

        const m = text.match(/-?\d+(?:,\d{3})*(?:\.\d+)?/);

        if (!m) {
            throw new Error("No numeric value found.");
        }

        context.variables[action.variable!] =
            Number(m[0].replace(/,/g, ""));

    }

}
