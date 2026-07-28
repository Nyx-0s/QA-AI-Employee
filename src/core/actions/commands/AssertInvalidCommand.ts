import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class AssertInvalidCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!context.current) {
            throw new Error("No active element selected.");
        }

        const invalid =
            await context.current.evaluate((element) => {

                const input = element as HTMLInputElement;

                if (typeof input.checkValidity === "function") {
                    return !input.checkValidity();
                }

                return (
                    input.getAttribute("aria-invalid") === "true"
                );

            });

        if (!invalid) {
            throw new Error("Element is not invalid.");
        }

        context.observations.push(
            "Element is invalid"
        );

    }

}
