import { Page } from "playwright";
import { Navigator } from "./Navigator";
import { SemanticActions } from "./SemanticActions";
import { PageObserver } from "./PageObserver";

export class WorkflowExecutor{

constructor(private page:Page){
this.nav=new Navigator(page);
this.actions=new SemanticActions(page);
}

nav:Navigator;
actions:SemanticActions;

async inspect(){

console.log(
JSON.stringify(
await PageObserver.observe(this.page),
null,
2
)
);

}

}
