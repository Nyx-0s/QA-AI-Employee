import type { PageQAResult } from "../../qa/Types";
import type {
  QAFinding,
  QASeverity,
  QACategory
} from "../models/QAFinding";

export class FailureAnalyzer {

  analyze(result: PageQAResult): QAFinding[] {
    const findings: QAFinding[] = [];

    this.businessFailures(result, findings);
    this.networkFailures(result, findings);
    this.consoleFailures(result, findings);
    this.pageFailure(result, findings);

    return findings;
  }

  private businessFailures(
    result: PageQAResult,
    findings: QAFinding[]
  ): void {

    for (const execution of result.businessTests ?? []) {

      if (
        execution.status === "PASS" ||
        execution.status === "SKIPPED"
      ) {
        continue;
      }

      const test = execution.test;

      const evidence = [
        ...(execution.observed ?? []),
        ...(execution.error ? [execution.error] : [])
      ].filter(Boolean);

      findings.push({
        id: `${result.module}:${result.page}:${test.id}`,
        module: result.module,
        page: result.page,

        testId: test.id,

        title: `${test.id} - ${test.name}`,

        category: this.categoryFromTest(test.category),

        severity: this.severityFromRisk(test.risk),

        source: "BUSINESS_TEST",

        evidence,

        businessImpact:
          execution.status === "FAIL"
            ? `Expected business behaviour failed: ${test.name}`
            : `Business behaviour requires review: ${test.name}`,

        probableRootCause: [],

        reproductionSteps: [
          ...(test.preconditions ?? []).map(
            x => `Precondition: ${x}`
          ),
          ...(test.steps ?? [])
        ],

        recommendedFix: [],

        responsibleTeam: this.ownerFromCategory(test.category),

        confidence:
          execution.status === "FAIL"
            ? 95
            : execution.status === "WARNING"
              ? 75
              : 60
      });
    }
  }

  private networkFailures(
    result: PageQAResult,
    findings: QAFinding[]
  ): void {

    for (const issue of result.networkErrors ?? []) {

      findings.push({
        id: `${result.module}:${result.page}:network:${issue.status}:${issue.url}`,
        module: result.module,
        page: result.page,

        title: `Network request failed with HTTP ${issue.status}`,

        category: "NETWORK",
        severity:
          issue.status >= 500 ? "HIGH" : "MEDIUM",

        source: "NETWORK",

        evidence: [
          `${issue.method} ${issue.url}`,
          `HTTP ${issue.status} ${issue.statusText}`,
          `Resource type: ${issue.resourceType}`
        ],

        businessImpact:
          "A failed network request may prevent the page or business workflow from operating correctly.",

        probableRootCause: [],

        reproductionSteps: [
          `Open ${result.page}`,
          `Observe request to ${issue.url}`
        ],

        recommendedFix: [],

        responsibleTeam:
          issue.status >= 500 ? "BACKEND" : "FRONTEND",

        confidence: 90
      });
    }
  }

  private consoleFailures(
    result: PageQAResult,
    findings: QAFinding[]
  ): void {

    for (const issue of result.consoleErrors ?? []) {

      findings.push({
        id: `${result.module}:${result.page}:console:${findings.length + 1}`,
        module: result.module,
        page: result.page,

        title: "Browser console error detected",

        category: "CONSOLE",
        severity: "MEDIUM",

        source: "CONSOLE",

        evidence: [
          issue.text,
          ...(issue.location
            ? [`Location: ${issue.location}`]
            : [])
        ],

        businessImpact:
          "A browser runtime error may indicate broken frontend behaviour or an unstable user workflow.",

        probableRootCause: [],

        reproductionSteps: [
          `Open ${result.page}`,
          "Inspect the browser console"
        ],

        recommendedFix: [],

        responsibleTeam: "FRONTEND",

        confidence: 90
      });
    }
  }

  private pageFailure(
    result: PageQAResult,
    findings: QAFinding[]
  ): void {

    if (result.success || !result.error) {
      return;
    }

    findings.push({
      id: `${result.module}:${result.page}:page`,
      module: result.module,
      page: result.page,

      title: "Page QA execution failed",

      category: "FUNCTIONAL",
      severity: "HIGH",

      source: "PAGE",

      evidence: [result.error],

      businessImpact:
        "The QA engine could not successfully complete analysis of this page.",

      probableRootCause: [],

      reproductionSteps: [
        `Navigate to ${result.page}`,
        "Run the QA inspection workflow"
      ],

      recommendedFix: [],

      responsibleTeam: "UNKNOWN",

      confidence: 85
    });
  }

  private severityFromRisk(risk: string): QASeverity {
    switch (risk?.toUpperCase()) {
      case "CRITICAL":
        return "CRITICAL";

      case "HIGH":
        return "HIGH";

      case "MEDIUM":
        return "MEDIUM";

      default:
        return "LOW";
    }
  }

  private categoryFromTest(category: string): QACategory {
    const normalized = category?.toUpperCase();

    switch (normalized) {
      case "BUSINESS_RULE":
        return "BUSINESS_RULE";

      case "VALIDATION":
        return "VALIDATION";

      case "SECURITY":
        return "SECURITY";

      case "UI":
        return "UI";

      default:
        return "FUNCTIONAL";
    }
  }

  private ownerFromCategory(
    category: string
  ): QAFinding["responsibleTeam"] {

    switch (category?.toUpperCase()) {
      case "VALIDATION":
      case "UI":
        return "FRONTEND";

      case "BUSINESS_RULE":
        return "BACKEND";

      case "SECURITY":
        return "SECURITY";

      default:
        return "UNKNOWN";
    }
  }
}
