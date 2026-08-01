import { ActionType } from "./models/ActionType";

import type { IActionCommand } from "./commands/IActionCommand";

import { FindFieldCommand } from "./commands/FindFieldCommand";
import { FindButtonCommand } from "./commands/FindButtonCommand";
import { FindElementCommand } from "./commands/FindElementCommand";
import { FindFormCommand } from "./commands/FindFormCommand";
import { TypeCommand } from "./commands/TypeCommand";
import { ClickCommand } from "./commands/ClickCommand";
import { BlurCommand } from "./commands/BlurCommand";
import { ClearCommand } from "./commands/ClearCommand";
import { AssertValueCommand } from "./commands/AssertValueCommand";
import { AssertInvalidCommand } from "./commands/AssertInvalidCommand";
import { AssertVisibleCommand } from "./commands/AssertVisibleCommand";
import { AssertTextCommand } from "./commands/AssertTextCommand";
import { SaveCommand } from "./commands/SaveCommand";
import { WaitCommand } from "./commands/WaitCommand";
import { LogCommand } from "./commands/LogCommand";
import { StoreCommand } from "./commands/StoreCommand";
import { ReadValueCommand } from "./commands/ReadValueCommand";
import { ReadTextCommand } from "./commands/ReadTextCommand";
import { ReadAttributeCommand } from "./commands/ReadAttributeCommand";
import { ReadPageTextCommand } from "./commands/ReadPageTextCommand";
import { ReadEnvCommand } from "./commands/ReadEnvCommand";
import { ReadValidationMessagesCommand } from "./commands/ReadValidationMessagesCommand";
import { AssertEqualsCommand } from "./commands/AssertEqualsCommand";
import { AssertContainsCommand } from "./commands/AssertContainsCommand";
import { AssertPageContainsCommand } from "./commands/AssertPageContainsCommand";
import { AssertPageContainsAnyCommand } from "./commands/AssertPageContainsAnyCommand";
import { IfCommand } from "./commands/IfCommand";
import { ElseCommand } from "./commands/ElseCommand";
import { EndIfCommand } from "./commands/EndIfCommand";

import { SetVariableCommand } from "./commands/SetVariableCommand";
import { CalculateCommand } from "./commands/CalculateCommand";

import { ReadNumberFromPageCommand } from "./commands/ReadNumberFromPageCommand";
import { AssertInputValidationCommand } from "./commands/AssertInputValidationCommand";
import { AssertRequiredFieldCommand } from "./commands/AssertRequiredFieldCommand";

export class GenericActionRegistry {

    private readonly commands =
        new Map<ActionType, IActionCommand>();

    constructor() {

        this.register(ActionType.FIND_FORM, new FindFormCommand());
        this.register(ActionType.FIND_FIELD, new FindFieldCommand());
        this.register(ActionType.FIND_BUTTON, new FindButtonCommand());
        this.register(ActionType.FIND_ELEMENT, new FindElementCommand());

        this.register(ActionType.TYPE, new TypeCommand());
        this.register(ActionType.CLICK, new ClickCommand());
        this.register(ActionType.BLUR, new BlurCommand());
        this.register(ActionType.CLEAR, new ClearCommand());

        this.register(ActionType.ASSERT_INVALID, new AssertInvalidCommand());
        this.register(ActionType.ASSERT_VISIBLE, new AssertVisibleCommand());
        this.register(ActionType.ASSERT_TEXT, new AssertTextCommand());
        this.register(ActionType.ASSERT_VALUE, new AssertValueCommand());

        this.register(ActionType.WAIT, new WaitCommand());
        this.register(ActionType.SAVE, new SaveCommand());
        this.register(ActionType.LOG, new LogCommand());
        this.register(ActionType.STORE, new StoreCommand());
        this.register(ActionType.READ_VALUE, new ReadValueCommand());
        this.register(ActionType.READ_TEXT, new ReadTextCommand());
        this.register(ActionType.READ_ATTRIBUTE, new ReadAttributeCommand());
        this.register(ActionType.READ_PAGE_TEXT, new ReadPageTextCommand());
        this.register(ActionType.READ_ENV, new ReadEnvCommand());

        this.register(ActionType.SET_VARIABLE, new SetVariableCommand());
        this.register(ActionType.CALCULATE, new CalculateCommand());

        this.register(ActionType.READ_NUMBER_FROM_PAGE, new ReadNumberFromPageCommand());
        this.register(ActionType.ASSERT_INPUT_VALIDATION, new AssertInputValidationCommand());
        this.register(ActionType.ASSERT_REQUIRED_FIELD, new AssertRequiredFieldCommand());
        this.register(ActionType.READ_VALIDATION_MESSAGES, new ReadValidationMessagesCommand());
        this.register(ActionType.ASSERT_EQUALS, new AssertEqualsCommand());
        this.register(ActionType.ASSERT_CONTAINS, new AssertContainsCommand());
        this.register(ActionType.ASSERT_PAGE_CONTAINS, new AssertPageContainsCommand());
        this.register(ActionType.ASSERT_PAGE_CONTAINS_ANY, new AssertPageContainsAnyCommand());

        this.register(ActionType.IF, new IfCommand());
        this.register(ActionType.ELSE, new ElseCommand());
        this.register(ActionType.END_IF, new EndIfCommand());

    }

    private register(
        type: ActionType,
        command: IActionCommand
    ): void {

        this.commands.set(type, command);

    }

    get(action: ActionType): IActionCommand {

        const command = this.commands.get(action);

        if (!command) {
            throw new Error(`Unsupported action: ${action}`);
        }

        return command;

    }

}
