import type { Action } from "./models/Action";
import type { ExecutionContext } from "./models/ExecutionContext";
import type { ExecutionResult } from "./models/ExecutionResult";

import { GenericActionRegistry } from "./GenericActionRegistry";

export class ActionExecutor {

    private readonly registry =
        new GenericActionRegistry();

    async execute(
        context: ExecutionContext,
        actions: Action[]
    ): Promise<ExecutionResult>{

        const observations:string[]=[];

        try{

            for(const action of actions){

                const command =
                    this.registry.get(action.type);

                await command.execute(
                    context,
                    action
                );

                observations.push(
                    `${action.type} completed`
                );

            }

            return{

                success:true,

                observations

            };

        }catch(error){

            return{

                success:false,

                observations,

                error:
                    error instanceof Error
                        ? error.message
                        : String(error)

            };

        }

    }

}
