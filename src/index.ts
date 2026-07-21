import { BrowserManager } from "./core/browser/BrowserManager";
import { SessionManager } from "./core/session/SessionManager";
import { Logger } from "./core/logger/Logger";

async function main(){

    const browser=new BrowserManager();

    await browser.launch();

    const session=new SessionManager(browser);

    const restored=await session.restore();

    Logger.info("Session Restored = "+restored);

    await browser.getPage().screenshot({

        path:"screenshots/restored-session.png",

        fullPage:true

    });

    Logger.info("Current URL = "+browser.getPage().url());

    await browser.close();

}

main().catch(console.error);
