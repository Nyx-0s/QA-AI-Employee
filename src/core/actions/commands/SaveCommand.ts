import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class SaveCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        const label = action.target ?? "Save";

        const button = context.page.getByRole("button", {
            name: label
        });

        await button.click();

        context.observations.push(
            `Clicked '${label}' button`
        );

    }

}
