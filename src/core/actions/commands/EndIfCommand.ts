import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

import type { IActionCommand } from "./IActionCommand";

export class EndIfCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        _action: Action
    ): Promise<void> {

        context.state ??= {};

        delete context.state.ifResult;

        context.observations.push("END_IF");

    }

}
