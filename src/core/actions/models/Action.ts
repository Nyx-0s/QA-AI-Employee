import { ActionType } from "./ActionType";

export interface Action {

    type: ActionType;

    target?: string;

    value?: string;

    timeout?: number;

    metadata?: Record<string, unknown>;
}