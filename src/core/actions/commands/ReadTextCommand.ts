import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

import type { IActionCommand } from "./IActionCommand";

export class ReadTextCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!context.current) {
            throw new Error("No active element.");
        }

        if (!action.variable) {
            throw new Error("READ_TEXT requires 'variable'.");
        }

        const text =
            (await context.current.textContent()) ?? "";

        context.variables[action.variable] =
            text.trim();

        context.observations.push(
            `Read text -> ${action.variable}`
        );

    }

}
