import type { ConsoleIssue, NetworkIssue } from "../qa/Types";
import type { PageInspection } from "./PageInspector";

export interface Finding {
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
}

export interface ScoreResult {
  score: number;
  status: "PASS" | "WARNING" | "FAIL";
  findings: Finding[];
}

export class PageScorer {

  score(
    inspection: PageInspection,
    consoleIssues: ConsoleIssue[],
    networkIssues: NetworkIssue[]
  ): ScoreResult {

    let score = 100;

    const findings: Finding[] = [];

    //
    // Forms
    //

    if (inspection.forms > 0) {

      findings.push({
        severity: "INFO",
        message: `${inspection.forms} form(s) detected`
      });

    }

    //
    // Tables
    //

    if (inspection.tables > 0) {

      findings.push({
        severity: "INFO",
        message: `${inspection.tables} table(s) detected`
      });

    }

    //
    // Inputs
    //

    if (inspection.inputs > 0) {

      findings.push({
        severity: "INFO",
        message: `${inspection.inputs} input(s) detected`
      });

    }

    //
    // Uploads
    //

    if (inspection.uploads > 0) {

      findings.push({
        severity: "INFO",
        message: `${inspection.uploads} upload control(s) detected`
      });

    }

    //
    // Empty state
    //

    if (inspection.emptyState) {

      score -= 5;

      findings.push({
        severity: "WARNING",
        message: "Page appears to be in an empty state."
      });

    }

    //
    // Permission issue
    //

    if (inspection.permissionDenied) {

      score -= 50;

      findings.push({
        severity: "CRITICAL",
        message: "Permission denied or access restricted."
      });

    }

    //
    // Console issues
    //

    for (const issue of consoleIssues) {

      const text = issue.text.toLowerCase();

      if (
        text.includes("referenceerror") ||
        text.includes("typeerror") ||
        text.includes("syntaxerror")
      ) {

        score -= 20;

        findings.push({
          severity: "CRITICAL",
          message: issue.text
        });

      } else {

        score -= 3;

        findings.push({
          severity: "WARNING",
          message: issue.text
        });

      }

    }

    //
    // Network issues
    //

    for (const issue of networkIssues) {

      //
      // Ignore common noise
      //

      if (
        issue.url.includes("google-analytics") ||
        issue.url.includes("googletagmanager") ||
        issue.url.includes("favicon") ||
        issue.url.includes("hotjar") ||
        issue.url.includes("sentry") ||
        issue.url.includes("clarity") ||
        issue.url.includes("facebook")
      ) {

        continue;

      }

      //
      // Server failures
      //

      if (issue.status >= 500) {

        score -= 20;

        findings.push({
          severity: "CRITICAL",
          message: `${issue.status} ${issue.statusText}`
        });

        continue;

      }

      //
      // Unauthorized
      //

      if (
        issue.status === 401 ||
        issue.status === 403
      ) {

        score -= 15;

        findings.push({
          severity: "CRITICAL",
          message: `${issue.status} ${issue.statusText}`
        });

        continue;

      }

      //
      // Not found
      //

      if (issue.status === 404) {

        score -= 5;

        findings.push({
          severity: "WARNING",
          message: `${issue.status} ${issue.url}`
        });

        continue;

      }

      //
      // Other client errors
      //

      if (issue.status >= 400) {

        score -= 4;

        findings.push({
          severity: "WARNING",
          message: `${issue.status} ${issue.statusText}`
        });

      }

    }

    //
    // Clamp score
    //

    if (score < 0) {

      score = 0;

    }

    let status: ScoreResult["status"];

    if (score >= 90) {

      status = "PASS";

    } else if (score >= 70) {

      status = "WARNING";

    } else {

      status = "FAIL";

    }

    return {

      score,

      status,

      findings

    };

  }

}
