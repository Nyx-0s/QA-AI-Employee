import type { IActionCommand } from "./IActionCommand";
import { VariableResolver } from "../utils/VariableResolver";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

export class CalculateCommand implements IActionCommand {
  async execute(
    context: ExecutionContext,
    action: Action
  ): Promise<void> {

    if (!action.variable) {
      throw new Error("CALCULATE requires 'variable'.");
    }

    const expression = VariableResolver.resolve(
      String(action.value),
      context.variables
    );

    context.variables[action.variable] = Function(
      `"use strict"; return (${expression})`
    )();

    console.log(
      `[CALCULATE] ${action.variable} = ${context.variables[action.variable]}`
    );
  }
}
