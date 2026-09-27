import fs from "fs-extra";
import type { Page } from "@playwright/test";

import { BrowserManager } from "../core/browser/BrowserManager";
import { SessionManager } from "../core/session/SessionManager";
import { PageInventory } from "../core/inventory/PageInventory";

interface NavigationItem {
  text: string;
  href: string;
}

interface NavigationGroup {
  module: string;
  items: NavigationItem[];
}

export async function inventoryCommand(): Promise<void> {
  const hierarchyPath =
    "knowledge/discovery/navigation-hierarchy.json";

  if (!fs.existsSync(hierarchyPath)) {
    console.error("Run npm run discover first.");
    process.exitCode = 1;
    return;
  }

  const hierarchy =
    fs.readJsonSync(hierarchyPath) as NavigationGroup[];

  const browser = new BrowserManager();

  let scanned = 0;
  let failed = 0;
  let skipped = 0;

  const processedUrls = new Set<string>();
  const failures: Array<{
    module: string;
    page: string;
    url: string;
    error: string;
  }> = [];

  try {
    await browser.launch();

    const session = new SessionManager(browser);
    const restored = await session.restore();

    if (!restored) {
      throw new Error(
        "Session could not be restored. Run `npm run auth`."
      );
    }

    const page = browser.getPage();

    if (await looksLikeLoginPage(page)) {
      throw new Error(
        `Saved session redirected to a login page (${page.url()}). ` +
          "The session may be expired. Run `npm run auth` to refresh it."
      );
    }

    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);

    const inventory = new PageInventory(page);

    for (const group of hierarchy) {
      console.log("");
      console.log("================================");
      console.log(group.module);
      console.log("================================");

      for (const item of group.items) {
        if (!item.href) {
          skipped += 1;
          continue;
        }

        if (processedUrls.has(item.href)) {
          console.log("Skipping duplicate:", item.text);
          skipped += 1;
          continue;
        }

        processedUrls.add(item.href);

        try {
          console.log("Scanning:", item.text);
          console.log("URL:", item.href);

          const result = await inventory.scan(item.href);

          scanned += 1;

          console.log("Success:", result.finalUrl);
        } catch (error) {
          failed += 1;

          const message =
            error instanceof Error
              ? error.message
              : String(error);

          failures.push({
            module: group.module,
            page: item.text,
            url: item.href,
            error: message,
          });

          console.error("Failed:", item.text);
          console.error("Reason:", message);

          await page
            .screenshot({
              path: `screenshots/inventory/failure-${failed}.png`,
              fullPage: false,
            })
            .catch(() => undefined);
        }
      }
    }

    fs.ensureDirSync("reports");

    fs.writeJsonSync(
      "reports/inventory-summary.json",
      {
        completedAt: new Date().toISOString(),
        scanned,
        failed,
        skipped,
        totalUniqueUrls: processedUrls.size,
        failures,
      },
      { spaces: 2 }
    );

    console.log("");
    console.log("================================");
    console.log("INVENTORY COMPLETE");
    console.log("================================");
    console.log("SCANNED:", scanned);
    console.log("FAILED:", failed);
    console.log("SKIPPED:", skipped);
    console.log("================================");
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
