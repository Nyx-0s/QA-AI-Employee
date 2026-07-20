import { chromium, Browser, BrowserContext, Page } from "@playwright/test";
import { Config } from "../config/ConfigManager";
import { Logger } from "../logger/Logger";
import fs from "fs-extra";

export class BrowserManager {
    private browser!: Browser;
    private context!: BrowserContext;
    private page!: Page;

    async launch() {
        Logger.info("Launching Chromium...");

        fs.ensureDirSync("videos");
        fs.ensureDirSync("traces");

        this.browser = await chromium.launch({
            headless: Config.HEADLESS,
            slowMo: Config.SLOWMO,
        });

        this.context = await this.browser.newContext({
            viewport: {
                width: 1600,
                height: 900,
            },
            recordVideo: {
                dir: Config.VIDEO_DIR,
            },
        });

        await this.context.tracing.start({
            screenshots: true,
            snapshots: true,
        });

        this.page = await this.context.newPage();

        Logger.info("Browser launched successfully.");
    }

    getPage() {
        return this.page;
    }

    async close() {
        Logger.info("Stopping trace...");

        await this.context.tracing.stop({
            path: `${Config.TRACE_DIR}/trace.zip`,
        });

        Logger.info("Closing browser...");

        await this.browser.close();

        Logger.info("Browser closed.");
    }
}
