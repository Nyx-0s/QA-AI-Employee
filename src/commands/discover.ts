import fs from "fs-extra";
import { BrowserManager } from "../core/browser/BrowserManager";
import { SessionManager } from "../core/session/SessionManager";
import { DiscoveryEngine } from "../core/discovery/DiscoveryEngine";
import { Logger } from "../core/logger/Logger";

export async function discoverCommand(): Promise<void> {
  fs.ensureDirSync("knowledge/discovery");
  fs.ensureDirSync("screenshots/discovery");

  const browser = new BrowserManager();

  try {
    await browser.launch();

    const session = new SessionManager(browser);
    const restored = await session.restore();

    if (!restored) {
      throw new Error("No saved session found. Run npm run auth first.");
    }

    const page = browser.getPage();

    Logger.info(`Discovery starting from ${page.url()}`);

    const discovery = new DiscoveryEngine(page);

    await discovery.discoverSidebar();
    await discovery.discoverHierarchy();

    await page.screenshot({
      path: "screenshots/discovery/final-state.png",
      fullPage: true,
    });

    Logger.info("Discovery command completed.");
  } finally {
    await browser.close().catch(() => undefined);
  }
}
