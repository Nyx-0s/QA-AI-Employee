import path from "path";
import fs from "fs-extra";
import type { Page } from "@playwright/test";

export class ScreenshotManager {
  constructor(
    private readonly outputDirectory: string = "screenshots/qa"
  ) {}

  async initialize(): Promise<void> {
    await fs.ensureDir(this.outputDirectory);
  }

  async capture(
    page: Page,
    moduleName: string,
    pageName: string
  ): Promise<string> {
    await this.initialize();

    const modulePart = this.sanitize(moduleName);
    const pagePart = this.sanitize(pageName);
    const timestamp = this.createTimestamp();

    const filename = `${modulePart}__${pagePart}__${timestamp}.png`;
    const absolutePath = path.resolve(this.outputDirectory, filename);

    await page.screenshot({
      path: absolutePath,
      fullPage: true,
    });

    return absolutePath;
  }

  async captureBusinessTest(
    page: Page,
    moduleName: string,
    pageName: string,
    testId: string,
    phase: "before" | "after"
  ): Promise<string> {
    await this.initialize();

    const modulePart = this.sanitize(moduleName);
    const pagePart = this.sanitize(pageName);
    const testPart = this.sanitize(testId);
    const timestamp = this.createTimestamp();

    const filename =
      `${modulePart}__${pagePart}__${testPart}__${phase}__${timestamp}.png`;

    const absolutePath = path.resolve(
      this.outputDirectory,
      "business-tests",
      filename
    );

    await fs.ensureDir(path.dirname(absolutePath));

    await page.screenshot({
      path: absolutePath,
      fullPage: true,
    });

    return absolutePath;
  }

  async captureFailure(
    page: Page,
    moduleName: string,
    pageName: string
  ): Promise<string> {
    await this.initialize();

    const modulePart = this.sanitize(moduleName);
    const pagePart = this.sanitize(pageName);
    const timestamp = this.createTimestamp();

    const filename = `${modulePart}__${pagePart}__FAILED__${timestamp}.png`;
    const absolutePath = path.resolve(this.outputDirectory, filename);

    await page.screenshot({
      path: absolutePath,
      fullPage: true,
    });

    return absolutePath;
  }

  private sanitize(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown";
  }

  private createTimestamp(): string {
    return new Date()
      .toISOString()
      .replace(/[:.]/g, "-");
  }
}
