import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";
import type { IActionCommand } from "./IActionCommand";

export class AssertRequiredFieldCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!context.current) {
            throw new Error("No active element.");
        }

        const required =
            await context.current.evaluate((el: any) =>
                el.required === true ||
                el.getAttribute("required") !== null ||
                el.getAttribute("aria-required") === "true"
            );

        if (!required) {
            throw new Error("Field is not required.");
        }

        context.observations.push("Required field verified.");

    }

}
