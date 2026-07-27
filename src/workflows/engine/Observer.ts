import { Page } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

export class Observer {

static async observe(page:Page){

const js=await fs.readFile(
path.join(process.cwd(),"src/workflows/inventory/pageInventory.js"),
"utf8"
);

return await page.evaluate(js);

}

}
