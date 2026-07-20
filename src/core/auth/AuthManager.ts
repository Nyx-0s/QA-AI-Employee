import { BrowserManager } from "../browser/BrowserManager";
import { Config } from "../config/ConfigManager";
import { Logger } from "../logger/Logger";
import fs from "fs-extra";

interface LoginKnowledge {
    inputs: {
        id: string;
        name: string;
        type: string;
    }[];
    buttons: {
        text: string;
        class: string;
    }[];
}

export class AuthManager {

    constructor(private browser: BrowserManager) {}

    async openLogin() {

        const page = this.browser.getPage();

        Logger.info("Opening landing page...");

        await page.goto(Config.BASE_URL,{
            waitUntil:"networkidle",
            timeout:Config.TIMEOUT
        });

        await page
            .locator("button")
            .filter({hasText:"Institute Login"})
            .click();

        await page.waitForLoadState("networkidle");

        Logger.info("Institute login page opened.");

    }

    async login(){

        const page=this.browser.getPage();

        const knowledge:LoginKnowledge=fs.readJsonSync(
            "knowledge/login-page.json"
        );

        const emailInput=knowledge.inputs.find(i=>i.type==="email");
        const passwordInput=knowledge.inputs.find(i=>i.type==="password");

        if(!emailInput || !passwordInput){

            throw new Error("Login selectors missing.");

        }

        Logger.info("Typing username...");

        await page.locator(`#${emailInput.id}`).fill(Config.USERNAME);

        Logger.info("Typing password...");

        await page.locator(`#${passwordInput.id}`).fill(Config.PASSWORD);

        Logger.info("Submitting login...");

        await page
            .locator("button")
            .filter({hasText:/sign in/i})
            .click();

        await page.waitForLoadState("networkidle");

        Logger.info("Login submitted.");

    }

    async saveState(){

        fs.ensureDirSync("runtime");

        await this.browser
            .getPage()
            .context()
            .storageState({
                path:"runtime/storageState.json"
            });

        Logger.info("Storage state saved.");

    }

}
