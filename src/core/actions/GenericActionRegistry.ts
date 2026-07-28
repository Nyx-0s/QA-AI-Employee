import { ActionType } from "./models/ActionType";

import type { IActionCommand } from "./commands/IActionCommand";

import { FindFieldCommand } from "./commands/FindFieldCommand";
import { TypeCommand } from "./commands/TypeCommand";
import { ClickCommand } from "./commands/ClickCommand";
import { BlurCommand } from "./commands/BlurCommand";
import { AssertInvalidCommand } from "./commands/AssertInvalidCommand";
import { AssertVisibleCommand } from "./commands/AssertVisibleCommand";
import { AssertTextCommand } from "./commands/AssertTextCommand";
import { SaveCommand } from "./commands/SaveCommand";
import { WaitCommand } from "./commands/WaitCommand";

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

        this.commands.set(
            ActionType.CLICK,
            new ClickCommand()
        );

        this.commands.set(
            ActionType.BLUR,
            new BlurCommand()
        );

        this.commands.set(
            ActionType.ASSERT_INVALID,
            new AssertInvalidCommand()
        );

        this.commands.set(
            ActionType.ASSERT_VISIBLE,
            new AssertVisibleCommand()
        );

        this.commands.set(
            ActionType.ASSERT_TEXT,
            new AssertTextCommand()
        );

        this.commands.set(
            ActionType.WAIT,
            new WaitCommand()
        );

        this.commands.set(
            ActionType.SAVE,
            new SaveCommand()
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
