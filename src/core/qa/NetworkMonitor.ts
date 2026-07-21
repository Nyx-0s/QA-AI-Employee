import { Page, Request, Response } from "@playwright/test";
import { NetworkIssue } from "./Types";

export class NetworkMonitor {
  private readonly issues: NetworkIssue[] = [];

  attach(page: Page): void {
    page.on("response", (response: Response) => {
      const status = response.status();

      if (status >= 400) {
        this.issues.push({
          url: response.url(),
          method: response.request().method(),
          status,
          statusText: response.statusText(),
          resourceType: response.request().resourceType(),
          timestamp: new Date().toISOString(),
        });
      }
    });

    page.on("requestfailed", (request: Request) => {
      this.issues.push({
        url: request.url(),
        method: request.method(),
        status: 0,
        statusText: request.failure()?.errorText ?? "Request Failed",
        resourceType: request.resourceType(),
        timestamp: new Date().toISOString(),
      });
    });
  }

  clear(): void {
    this.issues.length = 0;
  }

  getIssues(): NetworkIssue[] {
    return [...this.issues];
  }

  hasErrors(): boolean {
    return this.issues.length > 0;
  }

  count(): number {
    return this.issues.length;
  }
}
