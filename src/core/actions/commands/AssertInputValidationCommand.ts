import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";
import type { IActionCommand } from "./IActionCommand";

export class AssertInputValidationCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        const messages = (context.variables[action.variable ?? "validationMessages"] ?? []) as string[];

        const invalid =
            await context.current?.evaluate((el: any) =>
                !!(
                    el.matches?.(":invalid") ||
                    el.getAttribute("aria-invalid") === "true" ||
                    el.classList.contains("is-invalid") ||
                    el.classList.contains("invalid")
                )
            ).catch(() => false);

        if (!invalid && messages.length === 0) {
            throw new Error("Input validation was not triggered.");
        }

        context.observations.push(
            `Validation OK (${messages.length} message(s))`
        );

    }

}
