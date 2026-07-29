import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

import type { IActionCommand } from "./IActionCommand";

export class ReadAttributeCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!context.current) {
            throw new Error("No active element.");
        }

        if (!action.variable) {
            throw new Error("READ_ATTRIBUTE requires 'variable'.");
        }

        if (!action.target) {
            throw new Error("READ_ATTRIBUTE requires 'target' (attribute name).");
        }

        const value =
            await context.current.getAttribute(action.target);

        context.variables[action.variable] =
            value;

        context.observations.push(
            `Read attribute '${action.target}' -> ${action.variable}`
        );

    }

}
