import { Page } from "playwright";
import { PageObserver } from "./PageObserver";
import { Executor } from "../executor/Executor";

export class AIRuntime {

  static async observe(page: Page) {
    const obs = await PageObserver.observe(page);
    console.log(JSON.stringify(obs, null, 2));
    return obs;
  }

  static async plan(page: Page) {
    const obs = await PageObserver.observe(page);

    console.log("\nGenerating execution plan...\n");
    console.log({
      title: obs.title,
      url: obs.url,
      buttons: obs.buttons.length,
      inputs: obs.inputs.length,
      tables: obs.tables
    });
  }

  static async execute(page: Page) {
    await Executor.run(page);
  }

}
