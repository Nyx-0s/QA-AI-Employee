import fs from "fs-extra";
import path from "path";
import { Page } from "@playwright/test";
import { Logger } from "../logger/Logger";

export interface NavigationItem {
  text: string;
  href: string;
  tag: string;
  visible: boolean;
}

export interface NavigationGroup {
  module: string;
  items: NavigationItem[];
}

export class DiscoveryEngine {
  constructor(private readonly page: Page) {}

  private cleanText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  private async collectVisibleNavigation(): Promise<NavigationItem[]> {
    const items = await this.page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll(
          "aside a, aside button, nav a, nav button, [class*='sidebar'] a, [class*='sidebar'] button, [class*='menu'] a, [class*='menu'] button"
        )
      );

      return candidates.map((element) => {
        const htmlElement = element as HTMLElement;
        const anchor = element as HTMLAnchorElement;

        const style = window.getComputedStyle(htmlElement);
        const rect = htmlElement.getBoundingClientRect();

        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0;

        return {
          text: (htmlElement.innerText || htmlElement.textContent || "")
            .replace(/\s+/g, " ")
            .trim(),
          href: anchor.href || "",
          tag: element.tagName.toLowerCase(),
          visible,
        };
      });
    });

    const unique = new Map<string, NavigationItem>();

    for (const item of items) {
      const text = this.cleanText(item.text);

      if (!text || !item.visible) {
        continue;
      }

      const normalized: NavigationItem = {
        ...item,
        text,
      };

      const key = `${normalized.text}|${normalized.href}`;

      if (!unique.has(key)) {
        unique.set(key, normalized);
      }
    }

    return Array.from(unique.values());
  }

  async discoverSidebar(): Promise<NavigationItem[]> {
    Logger.info("Starting sidebar discovery...");

    await this.page.waitForTimeout(1500);

    const modules = await this.collectVisibleNavigation();

    fs.ensureDirSync("knowledge/discovery");

    fs.writeJsonSync(
      "knowledge/discovery/sidebar.json",
      modules,
      { spaces: 2 }
    );

    Logger.info(`Discovered ${modules.length} visible navigation items.`);

    return modules;
  }

  async discoverHierarchy(): Promise<NavigationGroup[]> {
    Logger.info("Starting hierarchical navigation discovery...");

    fs.ensureDirSync("knowledge/discovery");
    fs.ensureDirSync("screenshots/discovery");

    const initialItems = await this.collectVisibleNavigation();

    const expandableModules = initialItems.filter(
      (item) =>
        !item.href &&
        item.text.length > 1 &&
        !["Light", "Dark"].includes(item.text)
    );

    const hierarchy: NavigationGroup[] = [];

    for (let index = 0; index < expandableModules.length; index += 1) {
      const module = expandableModules[index];

      Logger.info(`Inspecting module: ${module.text}`);

      try {
        const locator = this.page
          .locator("button, a, [role='button']")
          .filter({ hasText: module.text })
          .first();

        if (!(await locator.isVisible().catch(() => false))) {
          Logger.warn(`Module control not visible: ${module.text}`);
          continue;
        }

        const before = await this.collectVisibleNavigation();

        await locator.click({
          timeout: 8000,
        });

        await this.page.waitForTimeout(800);

        const after = await this.collectVisibleNavigation();

        const beforeKeys = new Set(
          before.map((item) => `${item.text}|${item.href}`)
        );

        let discovered = after.filter(
          (item) => !beforeKeys.has(`${item.text}|${item.href}`)
        );

        if (discovered.length === 0) {
          discovered = after.filter(
            (item) =>
              item.href &&
              item.text !== module.text &&
              !initialItems.some(
                (initial) =>
                  initial.text === item.text &&
                  initial.href === item.href
              )
          );
        }

        const safeName = module.text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");

        await this.page.screenshot({
          path: path.join(
            "screenshots/discovery",
            `${String(index + 1).padStart(2, "0")}-${safeName}.png`
          ),
          fullPage: true,
        });

        hierarchy.push({
          module: module.text,
          items: discovered,
        });

        Logger.info(
          `${module.text}: discovered ${discovered.length} child items.`
        );

        await locator.click({ timeout: 5000 }).catch(() => undefined);
        await this.page.waitForTimeout(300);
      } catch (error) {
        Logger.warn(
          `Could not inspect ${module.text}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );

        hierarchy.push({
          module: module.text,
          items: [],
        });
      }
    }

    fs.writeJsonSync(
      "knowledge/discovery/navigation-hierarchy.json",
      hierarchy,
      { spaces: 2 }
    );

    Logger.info(
      `Hierarchy discovery completed for ${hierarchy.length} modules.`
    );

    return hierarchy;
  }
}
