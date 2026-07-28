import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export interface IActionCommand {

    execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void>;

}
