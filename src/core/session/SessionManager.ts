import fs from "fs-extra";
import { BrowserManager } from "../browser/BrowserManager";
import { Config } from "../config/ConfigManager";
import { AQWRuntime } from "../runtime/AQWRuntimeConfig";
import { Logger } from "../logger/Logger";

export class SessionManager {

    constructor(private browser: BrowserManager){}

    async restore(){

        if(!fs.existsSync("runtime/storageState.json")){

            Logger.warn("No saved session found.");

            return false;

        }

        Logger.info("Restoring saved session...");

        await this.browser.close();

        await this.browser.launch("runtime/storageState.json");

        const page=this.browser.getPage();

        const { baseUrl } = AQWRuntime.resolve();

        await page.goto(
            baseUrl.replace(/\/$/,""),
            {
                waitUntil:"networkidle",
                timeout:Config.TIMEOUT
            }
        );

        Logger.info("Session restored.");

        return true;

    }

}
