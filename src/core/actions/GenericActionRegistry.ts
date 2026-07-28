import { ActionType } from "./models/ActionType";

import type { IActionCommand } from "./commands/IActionCommand";

import { FindFieldCommand } from "./commands/FindFieldCommand";
import { TypeCommand } from "./commands/TypeCommand";

export class GenericActionRegistry {

    private readonly commands =
        new Map<ActionType, IActionCommand>();

    constructor() {

        this.commands.set(
            ActionType.FIND_FIELD,
            new FindFieldCommand()
        );

        this.commands.set(
            ActionType.TYPE,
            new TypeCommand()
        );

    }

    get(action: ActionType): IActionCommand {

        const command =
            this.commands.get(action);

        if (!command) {
            throw new Error(
                `Unsupported action: ${action}`
            );
        }

        return command;

    }

}
