import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

import type { IActionCommand } from "./IActionCommand";

export class LogCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        const message =
            action.value ??
            action.target ??
            action.description ??
            "LOG";

        context.observations.push(
            `[LOG] ${message}`
        );

        console.log(
            `[ACTION] ${message}`
        );

    }

}
