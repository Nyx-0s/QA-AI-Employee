import type { IActionCommand } from "./IActionCommand";
import { VariableResolver } from "../utils/VariableResolver";
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

        await context.current.fill(
            VariableResolver.resolve(
                action.value,
                context.variables
            )
        );

        context.observations.push(
            `Typed '${action.value ?? ""}'`
        );

    }

}
