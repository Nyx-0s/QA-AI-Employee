import { ActionType } from "./ActionType";

export interface Action {

    type: ActionType;

    target?: string;

    value?: string;

    timeout?: number;

    metadata?: Record<string, unknown>;

    // Runtime

    variable?: string;

    expression?: string;

    condition?: string;

    retry?: number;

    optional?: boolean;

    continueOnFailure?: boolean;

    description?: string;

}
