import { expect } from "@playwright/test";

import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class AssertTextCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!context.current) {
            throw new Error("No active element selected.");
        }

        if (!action.value) {
            throw new Error("ASSERT_TEXT requires a value.");
        }

        await expect(context.current).toContainText(
            action.value
        );

        context.observations.push(
            `Verified text '${action.value}'`
        );

    }

}
