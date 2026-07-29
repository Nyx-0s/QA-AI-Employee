import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

import type { IActionCommand } from "./IActionCommand";

export class AssertEqualsCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!action.variable) {
            throw new Error("ASSERT_EQUALS requires 'variable'.");
        }

        const actual =
            String(context.variables[action.variable] ?? "");

        const expected =
            String(action.value ?? "");

        if (actual !== expected) {
            throw new Error(
                `Assertion failed: expected '${expected}' but found '${actual}'.`
            );
        }

        context.observations.push(
            `ASSERT_EQUALS passed (${action.variable})`
        );

    }

}
