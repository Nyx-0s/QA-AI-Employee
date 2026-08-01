import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class SetVariableCommand implements IActionCommand {
  async execute(
    context: ExecutionContext,
    action: Action
  ): Promise<void> {

    if (!action.variable) {
      throw new Error("SET_VARIABLE requires 'variable'.");
    }

    context.variables[action.variable] = action.value;

    console.log(
      `[SET_VARIABLE] ${action.variable} = ${String(action.value)}`
    );
  }
}
