import type { PageQAResult } from "../qa/Types";
import type { Evidence } from "./models/Evidence";

export class EvidenceCollector {

  collect(results: PageQAResult[]): Evidence[] {

    const evidence: Evidence[] = [];

    for (const page of results) {

      evidence.push({
        id: `${page.module}:${page.page}:PAGE`,
        type: "PAGE",
        module: page.module,
        page: page.page,
        url: page.finalUrl,
        severity: "INFO",
        summary: page.success
          ? "Page executed successfully"
          : "Page execution failed",
        screenshot: page.screenshot,
        metadata: {
          durationMs: page.performance.durationMs,
          success: page.success
        }
      });

      for (const issue of page.consoleErrors) {
        evidence.push({
          id: crypto.randomUUID(),
          type: "CONSOLE",
          module: page.module,
          page: page.page,
          url: page.finalUrl,
          severity: "INFO",
          summary: issue.text,
          screenshot: page.screenshot,
          metadata: { ...issue }
        });
      }

      for (const issue of page.networkErrors) {
        evidence.push({
          id: crypto.randomUUID(),
          type: "NETWORK",
          module: page.module,
          page: page.page,
          url: page.finalUrl,
          severity: "INFO",
          summary:
            `${issue.status} ${issue.method} ${issue.url}`,
          screenshot: page.screenshot,
          metadata: { ...issue }
        });
      }

      for (const test of page.businessTests ?? []) {

        evidence.push({
          id: test.test.id,
          type: "BUSINESS_TEST",
          module: page.module,
          page: page.page,
          url: page.finalUrl,
          severity: "INFO",
          summary:
            `${test.test.id} : ${test.status}`,
          screenshot:
            test.screenshotAfter ??
            test.screenshotBefore,
          metadata: {
            status: test.status,
            expected: test.expected,
            observed: test.observed,
            durationMs: test.durationMs,
            error: test.error
          }
        });

      }

    }

    return evidence;

  }

}
