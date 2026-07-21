import fs from "fs-extra";
import path from "path";

import { BrowserManager } from "../browser/BrowserManager";
import { Config } from "../config/ConfigManager";
import { SessionManager } from "../session/SessionManager";
import { EvidenceManager } from "../evidence/EvidenceManager";
import { Reporter } from "../reporter/Reporter";
import { IntelligenceEngine } from "../intelligence-engine/IntelligenceEngine";
import { PageInspector } from "../intelligence/PageInspector";
import { PageScorer } from "../intelligence/PageScorer";
import { ElementIntelligence } from "../intelligence/ElementIntelligence";
import { BusinessTestRunner } from "../execution/BusinessTestRunner";

import { ConsoleMonitor } from "./ConsoleMonitor";
import { NetworkMonitor } from "./NetworkMonitor";
import { PerformanceMonitor } from "./PerformanceMonitor";
import { ScreenshotManager } from "./ScreenshotManager";

import type {
  NavigationGroup,
  NavigationItem,
  PageQAResult,
} from "./Types";

export class QAEngine {
  private readonly businessTestRunner = new BusinessTestRunner();
  private readonly elementIntelligence = new ElementIntelligence();
  private readonly browser = new BrowserManager();

  private readonly consoleMonitor = new ConsoleMonitor();
  private readonly networkMonitor = new NetworkMonitor();
  private readonly performanceMonitor = new PerformanceMonitor();

  private readonly screenshotManager = new ScreenshotManager(
    "screenshots/qa"
  );

  private readonly evidenceManager = new EvidenceManager(
    "reports/qa"
  );

  private readonly intelligenceEngine = new IntelligenceEngine();

  private readonly reporter = new Reporter(
    "reports/html"
  );

  private readonly navigationPath = path.resolve(
    process.cwd(),
    "knowledge/discovery/navigation-hierarchy.json"
  );

  async run(): Promise<void> {
    const startedAt = new Date();

    const results: PageQAResult[] = [];

    let skipped = 0;
    let browserStarted = false;

    console.log("🚀 Starting Autonomous QA Engine...");
    console.log("📖 Loading discovered pages...");

    try {
      const navigation = await this.loadNavigation();

      const totalDiscovered = navigation.reduce(
        (total, group) => total + group.items.length,
        0
      );

      console.log(
        `📚 Loaded ${navigation.length} modules and ${totalDiscovered} discovered pages.`
      );

      console.log("🌐 Initializing browser...");

      await this.browser.launch();
      browserStarted = true;

      const sessionManager = new SessionManager(this.browser);
      const restored = await sessionManager.restore();

      if (!restored) {
        throw new Error(
          "No saved authenticated session was found at runtime/storageState.json. Run the authentication command before QA."
        );
      }

      const page = this.browser.getPage();

      this.consoleMonitor.attach(page);
      this.networkMonitor.attach(page);

      await this.screenshotManager.initialize();
      await this.evidenceManager.initialize();

      console.log("✅ Browser and authenticated session initialized.");
      console.log("");
      console.log("========================================");
      console.log("           QA EXECUTION");
      console.log("========================================");
      console.log("");

      const visitedUrls = new Set<string>();

      for (const group of navigation) {
        console.log(`📦 Module: ${group.module}`);

        for (const item of group.items) {
          const resolvedUrl = this.resolveUrl(item.href);

          if (!resolvedUrl) {
            skipped += 1;

            console.log(
              `  ⏭️  Skipped: ${item.text || "Unnamed page"} — invalid or unsupported URL`
            );

            continue;
          }

          const normalizedUrl = this.normalizeUrl(resolvedUrl);

          if (visitedUrls.has(normalizedUrl)) {
            skipped += 1;

            console.log(
              `  ⏭️  Skipped duplicate: ${item.text || resolvedUrl}`
            );

            continue;
          }

          visitedUrls.add(normalizedUrl);

          const result = await this.testPage(
            group.module,
            item,
            resolvedUrl
          );

          results.push(result);

          const icon = result.success ? "✅" : "❌";

          console.log(
            `  ${icon} ${result.page} — ${result.performance.durationMs} ms`
          );

          if (result.consoleErrors.length > 0) {
            console.log(
              `     Console issues: ${result.consoleErrors.length}`
            );
          }

          if (result.networkErrors.length > 0) {
            console.log(
              `     Network issues: ${result.networkErrors.length}`
            );
          }

          if (result.error) {
            console.log(`     Error: ${result.error}`);
          }
        }

        console.log("");
      }

      console.log("💾 Saving JSON evidence...");

      const evidencePath = await this.evidenceManager.save(results);

      console.log("🧾 Generating HTML report...");

      const reportPath = await this.reporter.generate(results);

      const passed = results.filter(
        result => result.success
      ).length;

      const failed = results.length - passed;

      const finishedAt = new Date();
      const durationMs =
        finishedAt.getTime() - startedAt.getTime();

      console.log("");
      console.log("========================================");
      console.log("           QA RUN COMPLETE");
      console.log("========================================");
      console.log("");
      console.log(`Total tested : ${results.length}`);
      console.log(`Passed       : ${passed}`);
      console.log(`Failed       : ${failed}`);
      console.log(`Skipped      : ${skipped}`);
      console.log(`Duration     : ${durationMs} ms`);
      console.log("");
      console.log(`JSON report  : ${evidencePath}`);
      console.log(`HTML report  : ${reportPath}`);
      console.log("");
    } catch (error) {
      const message = this.errorMessage(error);

      console.error("");
      console.error("❌ QA Engine failed.");
      console.error(message);

      throw error;
    } finally {
      if (browserStarted) {
        console.log("🧹 Closing browser and saving trace...");

        await this.browser.close().catch(error => {
          console.error(
            `Could not close browser cleanly: ${this.errorMessage(error)}`
          );
        });
      }
    }
  }

  private async testPage(
    moduleName: string,
    item: NavigationItem,
    url: string
  ): Promise<PageQAResult> {
    const page = this.browser.getPage();

    const pageName = item.text?.trim() || this.pageNameFromUrl(url);

    this.consoleMonitor.clear();
    this.networkMonitor.clear();
    this.performanceMonitor.reset();
    this.performanceMonitor.start();

    let finalUrl = url;
    let screenshot = "";
    let executionError: string | undefined;

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: Config.TIMEOUT,
      });

      await page
        .waitForLoadState("load", {
          timeout: Math.min(Config.TIMEOUT, 15000),
        })
        .catch(() => undefined);

      await page.waitForTimeout(1000);

      finalUrl = page.url();

      if (this.looksLikeLoginPage(finalUrl)) {
        throw new Error(
          `Authenticated session was redirected to a login page: ${finalUrl}`
        );
      }

      screenshot = await this.screenshotManager.capture(
        page,
        moduleName,
        pageName
      );
    } catch (error) {
      executionError = this.errorMessage(error);
      finalUrl = page.url() || url;

      screenshot = await this.screenshotManager
        .captureFailure(page, moduleName, pageName)
        .catch(() => "");
    }

    const performance = this.performanceMonitor.stop();
    const consoleErrors = this.consoleMonitor.getIssues();
    const networkErrors = this.networkMonitor.getIssues();

    const inspection = await new PageInspector().inspect(page);

    const elementIntelligence = await this.elementIntelligence.inspect(page);

    const score = new PageScorer().score(
      inspection,
      consoleErrors,
      networkErrors
    );

    const businessTests = await this.businessTestRunner.run(
      page,
      moduleName,
      pageName,
      finalUrl
    );

    const success =
      executionError === undefined &&
      score.status !== "FAIL";

    const result: PageQAResult = {
      module: moduleName,
      page: pageName,
      url,
      finalUrl,
      success,
      performance,
      consoleErrors,
      networkErrors,
      screenshot,
      inspection,
      elementIntelligence,
      score,
      businessTests,
    };

    if (executionError !== undefined) {
      result.error = executionError;
    }

    return result;
  }

  private async loadNavigation(): Promise<NavigationGroup[]> {
    if (!(await fs.pathExists(this.navigationPath))) {
      throw new Error(
        `Navigation hierarchy not found: ${this.navigationPath}. Run npm run inventory or the discovery command first.`
      );
    }

    const rawData: unknown = await fs.readJson(
      this.navigationPath
    );

    if (!Array.isArray(rawData)) {
      throw new Error(
        "Navigation hierarchy must contain a JSON array."
      );
    }

    const groups: NavigationGroup[] = [];

    for (const rawGroup of rawData) {
      if (!this.isRecord(rawGroup)) {
        continue;
      }

      const moduleName =
        typeof rawGroup.module === "string"
          ? rawGroup.module.trim()
          : "";

      if (!moduleName || !Array.isArray(rawGroup.items)) {
        continue;
      }

      const items: NavigationItem[] = [];

      for (const rawItem of rawGroup.items) {
        if (!this.isRecord(rawItem)) {
          continue;
        }

        const href =
          typeof rawItem.href === "string"
            ? rawItem.href.trim()
            : "";

        if (!href) {
          continue;
        }

        const item: NavigationItem = {
          text:
            typeof rawItem.text === "string" &&
            rawItem.text.trim()
              ? rawItem.text.trim()
              : this.pageNameFromUrl(href),
          href,
        };

        if (typeof rawItem.tag === "string") {
          item.tag = rawItem.tag;
        }

        if (typeof rawItem.visible === "boolean") {
          item.visible = rawItem.visible;
        }

        items.push(item);
      }

      if (items.length > 0) {
        groups.push({
          module: moduleName,
          items,
        });
      }
    }

    if (groups.length === 0) {
      throw new Error(
        "Navigation hierarchy contains no valid modules or page URLs."
      );
    }

    return groups;
  }

  private resolveUrl(href: string): string | null {
    const trimmed = href.trim();

    if (
      !trimmed ||
      trimmed === "#" ||
      trimmed.startsWith("javascript:") ||
      trimmed.startsWith("mailto:") ||
      trimmed.startsWith("tel:")
    ) {
      return null;
    }

    try {
      return new URL(trimmed, Config.BASE_URL).toString();
    } catch {
      return null;
    }
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);

      parsed.hash = "";

      return parsed.toString().replace(/\/$/, "");
    } catch {
      return url.replace(/\/$/, "");
    }
  }

  private looksLikeLoginPage(url: string): boolean {
    const normalized = url.toLowerCase();

    return (
      normalized.includes("/login") ||
      normalized.includes("/signin") ||
      normalized.includes("/sign-in")
    );
  }

  private pageNameFromUrl(url: string): string {
    try {
      const parsed = new URL(url, Config.BASE_URL);
      const segments = parsed.pathname
        .split("/")
        .filter(Boolean);

      return segments.at(-1) || "page";
    } catch {
      return "page";
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private isRecord(
    value: unknown
  ): value is Record<string, unknown> {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    );
  }
}
