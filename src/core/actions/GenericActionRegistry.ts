import { ActionType } from "./models/ActionType";

export class GenericActionRegistry {

    has(action: ActionType): boolean {

        switch(action){

            case ActionType.FIND_FIELD:
            case ActionType.TYPE:
            case ActionType.CLICK:
            case ActionType.BLUR:
            case ActionType.ASSERT_INVALID:

                return true;

            default:

                return false;

        }

    }

}
