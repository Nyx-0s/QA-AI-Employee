import { Page } from "@playwright/test";
import { Observer } from "./Observer";

export class ActionEngine{

static async snapshot(page:Page){

const ui=await Observer.observe(page);

console.log(JSON.stringify(ui,null,2));

return ui;

}

}
