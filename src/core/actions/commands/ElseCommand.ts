import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

import type { IActionCommand } from "./IActionCommand";

export class ElseCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        _action: Action
    ): Promise<void> {

        context.state ??= {};

        const current =
            Boolean(context.state.ifResult);

        context.state.ifResult = !current;

        context.observations.push("ELSE");

    }

}
