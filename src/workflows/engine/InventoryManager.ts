import fs from "fs";
import path from "path";
import { Page } from "playwright";
import { PageObserver } from "./PageObserver";

export class InventoryManager {

static slug(text:string){
return text
.replace(/[^\w\s-]/g,"")
.trim()
.replace(/\s+/g,"_")
.substring(0,80);
}

static async save(page:Page){

const data=await PageObserver.observe(page);

const folder=path.join(
"reports",
"inventory",
this.slug(data.title||"Unknown")
);

fs.mkdirSync(folder,{recursive:true});

fs.writeFileSync(
path.join(folder,"inventory.json"),
JSON.stringify(data,null,2)
);

await page.screenshot({
path:path.join(folder,"page.png"),
fullPage:true
});

fs.writeFileSync(
path.join(folder,"page.html"),
await page.content()
);

console.log("Saved:",folder);

}

}
