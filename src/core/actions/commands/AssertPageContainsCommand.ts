import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";
import type { IActionCommand } from "./IActionCommand";

export class AssertPageContainsCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        const text = String(
            context.variables[action.variable ?? "__pageText"] ?? ""
        ).toLowerCase();

        const expected = String(action.value ?? "").toLowerCase();

        if (!text.includes(expected)) {
            throw new Error(
                `Page does not contain '${expected}'.`
            );
        }

        context.observations.push(
            `ASSERT_PAGE_CONTAINS passed (${expected})`
        );

    }

}
