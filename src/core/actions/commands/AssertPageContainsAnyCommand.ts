import type { IActionCommand } from "./IActionCommand";
import type { ExecutionContext } from "../models/ExecutionContext";
import type { Action } from "../models/Action";

export class AssertPageContainsAnyCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        const text = String(
            context.variables[action.variable ?? "__pageText"] ?? ""
        ).toLowerCase();

        const values = (
            (action.metadata?.values as string[]) ?? []
        ).map(v => v.toLowerCase());

        const found = values.find(v => text.includes(v));

        if (!found) {
            throw new Error(
                `None of the expected values were found.`
            );
        }

        context.observations.push(
            `ASSERT_PAGE_CONTAINS_ANY passed (${found})`
        );

    }

}
