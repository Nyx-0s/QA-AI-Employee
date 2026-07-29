import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

import type { IActionCommand } from "./IActionCommand";

export class StoreCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!action.variable) {
            throw new Error("STORE requires 'variable'");
        }

        context.variables[action.variable] =
            action.value;

        context.observations.push(
            `Stored ${action.variable}`
        );

    }

}
