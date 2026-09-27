import fs from "fs-extra";
import type { Page } from "@playwright/test";
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
      throw new Error(
        "No saved session found. Run `npm run auth` first."
      );
    }

    const page = browser.getPage();

    if (await looksLikeLoginPage(page)) {
      throw new Error(
        `Saved session redirected to a login page (${page.url()}). ` +
          "The session may be expired. Run `npm run auth` to refresh it."
      );
    }

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

async function looksLikeLoginPage(page: Page): Promise<boolean> {
  const url = page.url();

  if (/\/login|\/signin|\/sign-in|loginpage|log-in/i.test(url)) {
    return true;
  }

  const body = await page
    .locator("body")
    .innerText()
    .catch(() => "");

  return /choose your login type|sign in to access your|log in to access your|select your login type|please sign in|login to continue/i.test(
    body
  );
}
