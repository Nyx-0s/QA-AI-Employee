import type { Locator } from "@playwright/test";

import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

import type { IActionCommand } from "./IActionCommand";

export class ReadValidationMessagesCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!context.current) {
            throw new Error("No active element.");
        }

        if (!action.variable) {
            throw new Error("READ_VALIDATION_MESSAGES requires 'variable'.");
        }

        const form =
            context.current.locator("xpath=ancestor::form[1]");

        const selectors = [
            "[role='alert']",
            "[aria-live='assertive']",
            ".error",
            ".errors",
            ".invalid-feedback",
            ".validation-error",
            ".field-error",
            ".text-danger",
            ".is-invalid"
        ];

        const messages: string[] = [];

        for (const selector of selectors) {

            const elements: Locator = form.locator(selector);

            const count =
                await elements.count().catch(() => 0);

            for (let i = 0; i < Math.min(count, 10); i++) {

                const item = elements.nth(i);

                if (!(await item.isVisible().catch(() => false))) {
                    continue;
                }

                const text =
                    (await item.innerText().catch(() => "")).trim();

                if (text) {
                    messages.push(text);
                }

            }

        }

        context.variables[action.variable] =
            [...new Set(messages)];

        context.observations.push(
            `Validation messages: ${messages.length}`
        );

    }

}
