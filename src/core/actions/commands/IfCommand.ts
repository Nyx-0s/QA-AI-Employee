import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

import type { IActionCommand } from "./IActionCommand";

export class IfCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!action.condition) {
            throw new Error("IF requires 'condition'.");
        }

        const match =
            action.condition.match(/^\s*([A-Za-z0-9_.-]+)\s*(==|!=)\s*(.+?)\s*$/);

        if (!match) {
            throw new Error(`Invalid IF condition: ${action.condition}`);
        }

        const [, variable, operator, expected] = match;

        const actual =
            String(context.variables[variable] ?? "");

        const result =
            operator === "=="
                ? actual === expected
                : actual !== expected;

        context.state ??= {};
        context.state.ifResult = result;

        context.observations.push(
            `IF (${action.condition}) => ${result}`
        );

    }

}
