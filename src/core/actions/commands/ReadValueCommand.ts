import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

import type { IActionCommand } from "./IActionCommand";

export class ReadValueCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!context.current) {
            throw new Error("No active element.");
        }

        if (!action.variable) {
            throw new Error("READ_VALUE requires 'variable'.");
        }

        const value =
            await context.current.inputValue();

        context.variables[action.variable] =
            value;

        context.observations.push(
            `Read value -> ${action.variable}`
        );

    }

}
