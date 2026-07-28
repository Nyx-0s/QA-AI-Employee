import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class TypeCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!context.current) {
            throw new Error("No active field selected.");
        }

        await context.current.fill(action.value ?? "");

        context.observations.push(
            `Typed '${action.value ?? ""}'`
        );

    }

}
