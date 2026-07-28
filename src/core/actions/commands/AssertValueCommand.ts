import { expect } from "@playwright/test";

import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class AssertValueCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!context.current)
            throw new Error("No active element selected.");

        await expect(context.current).toHaveValue(
            action.value ?? ""
        );

        context.observations.push(
            "Value assertion passed"
        );

    }

}
