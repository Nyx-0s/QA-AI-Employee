import fs from "fs-extra";
import path from "path";
import type { Page } from "@playwright/test";

export interface InventoryResult {
  title: string;
  requestedUrl: string;
  finalUrl: string;
  scannedAt: string;
  inputs: unknown[];
  buttons: unknown[];
  dropdowns: unknown[];
  uploads: unknown[];
  textareas: unknown[];
  tables: unknown;
  links: unknown[];
  dialogs: unknown[];
}

interface BrowserInventoryData {
  title: string;
  url: string;
  inputs: unknown[];
  buttons: unknown[];
  dropdowns: unknown[];
  uploads: unknown[];
  textareas: unknown[];
  links: unknown[];
  tables: unknown;
}

export class PageInventory {
  constructor(private readonly page: Page) {}

  private createSafeFilename(url: string): string {
    return url
      .replace(/^https?:\/\//, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 180);
  }

  async scan(url: string): Promise<InventoryResult> {
    fs.ensureDirSync("knowledge/pages");
    fs.ensureDirSync("screenshots/inventory");

    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await this.page
      .waitForLoadState("load", {
        timeout: 10000,
      })
      .catch(() => undefined);

    await this.page.waitForTimeout(2000);

    const scriptPath = path.resolve(
      process.cwd(),
      "browser/pageInventory.js"
    );

    if (!fs.existsSync(scriptPath)) {
      throw new Error(
        `Browser inventory script not found: ${scriptPath}`
      );
    }

    const browserScript = fs.readFileSync(scriptPath, "utf8");

    const browserData = (await this.page.evaluate(
      browserScript
    )) as BrowserInventoryData;

    const dialogs = await this.page
      .locator("[role='dialog'], dialog, [class*='modal']")
      .evaluateAll((elements) =>
        elements.map((element, index) => {
          const htmlElement = element as HTMLElement;
          const style = window.getComputedStyle(htmlElement);
          const rect = htmlElement.getBoundingClientRect();

          return {
            index,
            text: (htmlElement.textContent || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 1000),
            visible:
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number(style.opacity) !== 0 &&
              rect.width > 0 &&
              rect.height > 0,
          };
        })
      )
      .catch(() => []);

    const result: InventoryResult = {
      title: browserData.title,
      requestedUrl: url,
      finalUrl: browserData.url || this.page.url(),
      scannedAt: new Date().toISOString(),
      inputs: browserData.inputs || [],
      buttons: browserData.buttons || [],
      dropdowns: browserData.dropdowns || [],
      uploads: browserData.uploads || [],
      textareas: browserData.textareas || [],
      tables: browserData.tables,
      links: browserData.links || [],
      dialogs,
    };

    const filename = this.createSafeFilename(url);

    fs.writeJsonSync(
      path.join("knowledge/pages", `${filename}.json`),
      result,
      { spaces: 2 }
    );

    await this.page.screenshot({
      path: path.join(
        "screenshots/inventory",
        `${filename}.png`
      ),
      fullPage: true,
    });

    return result;
  }
}
