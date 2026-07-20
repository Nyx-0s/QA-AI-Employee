import fs from "fs-extra";
import { BrowserManager } from "./core/browser/BrowserManager";
import { AuthManager } from "./core/auth/AuthManager";
import { Logger } from "./core/logger/Logger";

async function main(){

    fs.ensureDirSync("runtime");

    const browser=new BrowserManager();

    await browser.launch();

    const auth=new AuthManager(browser);

    await auth.openLogin();

    await auth.login();

    await browser.getPage().waitForTimeout(5000);

    Logger.info("Logged in URL: " + browser.getPage().url());

    await auth.saveState();

    await browser.getPage().screenshot({
        path:"screenshots/after-login.png",
        fullPage:true
    });

    await browser.close();

}

main().catch(async(err)=>{

    console.error(err);

    process.exit(1);

});
