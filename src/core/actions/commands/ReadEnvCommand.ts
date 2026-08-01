import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";
import type { IActionCommand } from "./IActionCommand";

export class ReadEnvCommand implements IActionCommand {

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        if (!action.variable) {
            throw new Error("READ_ENV requires 'variable'.");
        }

        const keys =
            Array.isArray(action.metadata?.keys)
                ? (action.metadata!.keys as string[])
                : action.target
                    ? [action.target]
                    : [];

        if (!keys.length) {
            throw new Error(
                "READ_ENV requires 'target' or metadata.keys."
            );
        }

        let resolvedKey: string | undefined;
        let value: string | undefined;

        for (const key of keys) {

            const candidate = process.env[key];

            if (candidate) {
                resolvedKey = key;
                value = candidate;
                break;
            }

        }

        if (!value) {
            throw new Error(
                `None of the environment variables are set: ${keys.join(", ")}`
            );
        }

        context.variables[action.variable] = value;

        context.observations.push(
            `Loaded env ${resolvedKey} -> ${action.variable}`
        );

    }

}
