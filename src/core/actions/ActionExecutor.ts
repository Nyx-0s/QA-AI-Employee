import type { Action } from "./models/Action";
import type { ExecutionContext } from "./models/ExecutionContext";
import type { ExecutionResult } from "./models/ExecutionResult";

import { ActionType } from "./models/ActionType";
import { GenericActionRegistry } from "./GenericActionRegistry";

export class ActionExecutor {

    private readonly registry =
        new GenericActionRegistry();

    async execute(
        context: ExecutionContext,
        actions: Action[]
    ): Promise<ExecutionResult> {

        context.observations = [];
        context.state ??= {};
        context.variables ??= {};

        try {

            for (const action of actions) {

                if (!this.shouldExecute(context, action)) {
                    context.observations.push(
                        `Skipped ${action.type}`
                    );
                    continue;
                }

                const command =
                    this.registry.get(action.type);

                try {

                    await command.execute(
                        context,
                        action
                    );

                    context.observations.push(
                        `${action.type} completed`
                    );

                } catch (error) {

                    const message =
                        error instanceof Error
                            ? error.message
                            : String(error);

                    if (
                        action.optional ||
                        action.continueOnFailure
                    ) {

                        context.observations.push(
                            `${action.type} skipped: ${message}`
                        );

                        continue;

                    }

                    throw error;

                }

            }

            return {
                success: true,
                observations: context.observations
            };

        } catch (error) {

            return {
                success: false,
                observations: context.observations,
                error:
                    error instanceof Error
                        ? error.message
                        : String(error)
            };

        }

    }

    private shouldExecute(
        context: ExecutionContext,
        action: Action
    ): boolean {

        if (
            action.type === ActionType.IF ||
            action.type === ActionType.ELSE ||
            action.type === ActionType.END_IF
        ) {
            return true;
        }

        const active =
            context.state?.ifResult;

        if (active === undefined) {
            return true;
        }

        return Boolean(active);

    }

}
