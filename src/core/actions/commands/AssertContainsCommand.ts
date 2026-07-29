import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

import type { IActionCommand } from "./IActionCommand";

export class AssertContainsCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!action.variable) {
            throw new Error("ASSERT_CONTAINS requires 'variable'.");
        }

        const actual =
            String(context.variables[action.variable] ?? "");

        const expected =
            String(action.value ?? "");

        if (!actual.includes(expected)) {
            throw new Error(
                `Assertion failed: '${actual}' does not contain '${expected}'.`
            );
        }

        context.observations.push(
            `ASSERT_CONTAINS passed (${action.variable})`
        );

    }

}
