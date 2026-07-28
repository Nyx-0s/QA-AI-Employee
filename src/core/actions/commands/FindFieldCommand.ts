import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class FindFieldCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        console.log(
            `Finding field: ${action.target}`
        );

    }

}
