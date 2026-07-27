import { Page } from "playwright";
import { MODULES } from "../data/modules";
import { InventoryManager } from "../engine/InventoryManager";
import { AIRuntime } from "../engine/AIRuntime";

export class AutoRunner {

  static async run(page: Page) {

    console.log("\n====================================");
    console.log("AUTONOMOUS WORKFLOW STARTED");
    console.log("====================================");

    const base = (process.env.BASE_URL || "").replace(/\/+$/, "");

    for (const module of MODULES) {

      if (!module.enabled) continue;

      const url = `${base}${module.route}`;

      console.log("\n====================================");
      console.log(module.name);
      console.log(url);
      console.log("====================================");

      try {

        await page.goto(url,{
          waitUntil:"commit",
          timeout:60000
        }).catch(()=>{});

        await page.waitForTimeout(3000);

        if (!page.url().includes(module.route.split("?")[0])) {
          console.log("Skipping (redirected):", page.url());
          continue;
        }

        await page.waitForLoadState("networkidle").catch(()=>{});

        await AIRuntime.observe(page);
        await InventoryManager.save(page);
        await AIRuntime.plan(page);
        await AIRuntime.execute(page);

      } catch(err){

        console.error(err);
        continue;

      }

    }

    console.log("\n====================================");
    console.log("WORKFLOW COMPLETED");
    console.log("====================================");

  }

}
