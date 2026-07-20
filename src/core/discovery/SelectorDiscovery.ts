import { Page } from "@playwright/test";
import fs from "fs-extra";
import { Logger } from "../logger/Logger";

export class SelectorDiscovery {

    constructor(private page: Page) {}

    async discoverLoginPage() {

        await this.page.waitForTimeout(1500);

        const data = await this.page.evaluate(() => {

            const inputs = [...document.querySelectorAll("input")].map((e:any)=>({

                type:e.type,

                id:e.id,

                name:e.name,

                placeholder:e.placeholder,

                class:e.className

            }));

            const buttons=[...document.querySelectorAll("button")].map((e:any)=>({

                text:e.innerText.trim(),

                id:e.id,

                class:e.className

            }));

            return{

                title:document.title,

                url:location.href,

                inputs,

                buttons

            }

        });

        fs.writeJsonSync(
            "knowledge/login-page.json",
            data,
            {spaces:4}
        );

        Logger.info(`Discovered ${data.inputs.length} inputs.`);
        Logger.info(`Discovered ${data.buttons.length} buttons.`);

    }

}
