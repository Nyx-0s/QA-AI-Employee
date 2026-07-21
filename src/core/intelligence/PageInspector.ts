import type { Page } from "@playwright/test";

export interface PageInspection {

  title:string;

  url:string;

  forms:number;

  buttons:number;

  inputs:number;

  dropdowns:number;

  tables:number;

  uploads:number;

  dialogs:number;

  emptyState:boolean;

  permissionDenied:boolean;

}

export class PageInspector {

  async inspect(page:Page):Promise<PageInspection>{

    const forms=await page.locator("form").count();

    const buttons=await page.locator("button").count();

    const inputs=await page.locator("input").count();

    const dropdowns=await page.locator("select").count();

    const tables=await page.locator("table").count();

    const uploads=await page.locator("input[type=file]").count();

    const dialogs=await page.locator("[role='dialog'],dialog").count();

    const body=(await page.locator("body").innerText()).toLowerCase();

    const permissionDenied=

        body.includes("permission denied") ||

        body.includes("access denied") ||

        body.includes("unauthorized") ||

        body.includes("forbidden");

    const emptyState=

        body.includes("no data") ||

        body.includes("no records") ||

        body.includes("nothing found") ||

        body.includes("empty");

    return{

        title:await page.title(),

        url:page.url(),

        forms,

        buttons,

        inputs,

        dropdowns,

        tables,

        uploads,

        dialogs,

        emptyState,

        permissionDenied

    };

  }

}
