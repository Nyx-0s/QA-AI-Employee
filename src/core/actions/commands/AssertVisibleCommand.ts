import { expect } from "@playwright/test";

import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class AssertVisibleCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!context.current) {
            throw new Error("No active element selected.");
        }

        await expect(context.current).toBeVisible();

        context.observations.push(
            "Element is visible"
        );

    }

}
