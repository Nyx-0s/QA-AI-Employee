import { Page, ConsoleMessage } from "@playwright/test";
import { ConsoleIssue } from "./Types";

export class ConsoleMonitor {
  private readonly issues: ConsoleIssue[] = [];

  attach(page: Page): void {
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() !== "error") {
        return;
      }

      const location = msg.location();

      this.issues.push({
        type: msg.type(),
        text: msg.text(),
        location:
          location.url && location.lineNumber !== undefined
            ? `${location.url}:${location.lineNumber}`
            : undefined,
        timestamp: new Date().toISOString(),
      });
    });

    page.on("pageerror", (error: Error) => {
      this.issues.push({
        type: "pageerror",
        text: error.message,
        timestamp: new Date().toISOString(),
      });
    });
  }

  clear(): void {
    this.issues.length = 0;
  }

  getIssues(): ConsoleIssue[] {
    return [...this.issues];
  }

  hasErrors(): boolean {
    return this.issues.length > 0;
  }

  count(): number {
    return this.issues.length;
  }
}
