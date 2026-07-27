import { Page } from "playwright";

export interface Observation {
  title: string;
  url: string;
  buttons: string[];
  inputs: {
    type: string;
    placeholder: string;
    name: string;
  }[];
  selects: {
    name: string;
    options: number;
  }[];
  tables: number;
}

export class PageObserver {

  static async observe(page: Page): Promise<Observation> {

    const title = await page.title();
    const url = page.url();

    const buttons = (await page
      .locator("button,[role='button']")
      .evaluateAll((els) => {
        return els.map((e) => (e.textContent || "").replace(/\s+/g," ").trim())
.filter(Boolean)
.filter((v,i,a)=>a.indexOf(v)===i)
.slice(0,100);
      })) as string[];

    const inputs = await page
      .locator("input")
      .evaluateAll((els) => {
        return els.map((e: any) => ({
          type: e.type || "",
          placeholder: e.placeholder || "",
          name: e.name || ""
        }))
.filter((v,i,a)=>a.findIndex(x=>JSON.stringify(x)===JSON.stringify(v))===i)
.slice(0,100);
      });

    const selects = await page
      .locator("select")
      .evaluateAll((els) => {
        return els.map((e: any) => ({
          name: e.name || "",
          options: e.options.length
        }));
      });

    const tables = await page.locator("table").count();

    return {
      title,
      url,
      buttons,
      inputs,
      selects,
      tables
    };

  }

}
