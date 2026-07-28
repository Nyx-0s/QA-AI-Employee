import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class FindFieldCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!action.target) {
            throw new Error("FIND_FIELD requires a target.");
        }

        const locator = context.page.getByLabel(action.target);

        if (await locator.count() === 0) {
            throw new Error(`Field not found: ${action.target}`);
        }

        context.current = locator.first();

        context.observations.push(
            `Located field: ${action.target}`
        );

    }

}
