import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class WaitCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        const timeout = action.timeout ?? 1000;

        await context.page.waitForTimeout(timeout);

        context.observations.push(
            `Waited ${timeout}ms`
        );

    }

}
