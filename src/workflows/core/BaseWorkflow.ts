import { Page } from "@playwright/test";

export abstract class BaseWorkflow {
    abstract name:string;
    abstract run(page:Page):Promise<boolean>;
}
