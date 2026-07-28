import type { ExecutionContext } from "./models/ExecutionContext";
import type { Action } from "./models/Action";
import type { ExecutionResult } from "./models/ExecutionResult";

export class ActionExecutor {

    async execute(
        context: ExecutionContext,
        actions: Action[]
    ): Promise<ExecutionResult> {

        const observations: string[] = [];

        for (const action of actions) {

            observations.push(
                `Executing ${action.type}`
            );

        }

        return {
            success: true,
            observations
        };

    }

}