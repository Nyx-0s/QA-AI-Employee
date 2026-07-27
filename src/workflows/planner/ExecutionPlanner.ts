import { Observation } from "../engine/PageObserver";

export interface Step{
  id:string;
  type:string;
  target:string;
}

export class ExecutionPlanner{

  static build(obs:Observation):Step[]{

    const steps:Step[]=[];

    for(const b of obs.buttons){
      steps.push({
        id:crypto.randomUUID(),
        type:"button",
        target:b
      });
    }

    for(const i of obs.inputs){
      steps.push({
        id:crypto.randomUUID(),
        type:"input",
        target:i.placeholder||i.name||i.type
      });
    }

    return steps;
  }

}
