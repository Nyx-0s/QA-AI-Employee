import type { IActionCommand } from "./IActionCommand";
import type { Action } from "../models/Action";
import type { ExecutionContext } from "../models/ExecutionContext";

import { FormLocator } from "../../execution/utils/FormLocator";

export class FindFormCommand implements IActionCommand {

    private readonly locator =
        new FormLocator();

    async execute(
        context: ExecutionContext,
        action: Action
    ): Promise<void> {

        const form =
            await this.locator.findMainForm(
                context.page
            );

        if (!form)
            throw new Error("Form not found.");

        context.currentForm = form;

        context.observations.push(
            "Form located"
        );

    }

}
