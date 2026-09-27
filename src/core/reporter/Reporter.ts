import fs from "fs-extra";
import path from "path";

import type { PageQAResult } from "../qa/Types";
import type { TestExecutionResult } from "../execution/TestExecutionResult";
import type { QAFinding, QASeverity } from "../ai/models/QAFinding";
import { FailureAnalyzer } from "../ai/reasoner/FailureAnalyzer";

export class Reporter {

  constructor(
    private readonly outputDirectory = "reports/html"
  ) {}

  async generate(results: PageQAResult[]): Promise<string> {
    await fs.ensureDir(this.outputDirectory);

    const reportPath = path.resolve(
      this.outputDirectory,
      `qa-report-${this.timestamp()}.html`
    );

    const passed = results.filter(result => result.success).length;
    const failed = results.length - passed;

    const businessTests = results.flatMap(
      result => result.businessTests ?? []
    );

    const businessPassed = businessTests.filter(
      test => test.status === "PASS"
    ).length;

    const businessFailed = businessTests.filter(
      test => test.status === "FAIL"
    ).length;

    const businessWarning = businessTests.filter(
      test => test.status === "WARNING"
    ).length;

    const businessBlocked = businessTests.filter(
      test => test.status === "BLOCKED"
    ).length;

    const businessSkipped = businessTests.filter(
      test => test.status === "SKIPPED"
    ).length;

    const businessNotTested = businessTests.filter(
      test => test.status === "NOT_TESTED"
    ).length;

    const rows = results
      .map(result => this.renderPageRow(result))
      .join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>
<title>RFT Autonomous QA Report</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 32px;
  font-family: Arial, sans-serif;
  background: #f3f4f6;
  color: #111827;
}

.container {
  max-width: 1500px;
  margin: 0 auto;
}

h1 {
  margin-bottom: 8px;
}

.subtitle {
  color: #6b7280;
  margin-bottom: 24px;
}

.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 14px;
  margin-bottom: 24px;
}

.card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 16px;
}

.card-label {
  color: #6b7280;
  font-size: 13px;
  margin-bottom: 8px;
}

.card-value {
  font-size: 26px;
  font-weight: bold;
}

.table-wrapper {
  overflow-x: auto;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  border-bottom: 1px solid #e5e7eb;
  padding: 12px;
  text-align: left;
  vertical-align: top;
}

th {
  background: #111827;
  color: white;
  white-space: nowrap;
}

.page-pass {
  color: #15803d;
  font-weight: bold;
}

.page-fail {
  color: #b91c1c;
  font-weight: bold;
}

.test-pass {
  color: #15803d;
  font-weight: bold;
}

.test-fail {
  color: #b91c1c;
  font-weight: bold;
}

.test-not-tested {
  color: #b45309;
  font-weight: bold;
}

.test-skipped {
  color: #6b7280;
  font-weight: bold;
}

details {
  min-width: 360px;
}

summary {
  cursor: pointer;
  font-weight: bold;
}

.business-tests {
  margin-top: 12px;
}

.business-test {
  padding: 12px;
  margin-bottom: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.business-test:last-child {
  margin-bottom: 0;
}

.test-title {
  margin-bottom: 8px;
  font-weight: bold;
}

.test-meta {
  font-size: 13px;
  color: #4b5563;
  margin-bottom: 6px;
}

.test-section {
  margin-top: 8px;
  font-size: 13px;
}

.test-section ul {
  margin: 5px 0 0 20px;
  padding: 0;
}

.error {
  color: #b91c1c;
  font-size: 13px;
  margin-top: 8px;
}

.screenshot {
  max-width: 240px;
  word-break: break-all;
  font-size: 12px;
}

.test-screenshots {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}

.test-screenshot {
  width: 190px;
}

.test-screenshot a {
  color: #2563eb;
  text-decoration: none;
  font-size: 12px;
  font-weight: bold;
}

.test-screenshot img {
  display: block;
  width: 100%;
  max-height: 125px;
  object-fit: cover;
  object-position: top;
  margin-top: 6px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
}
</style>
</head>

<body>
<div class="container">

<h1>RFT Autonomous QA Report</h1>

<p class="subtitle">
Generated: ${this.escape(new Date().toLocaleString())}
</p>

<div class="summary">
  ${this.summaryCard("Total Pages", results.length)}
  ${this.summaryCard("Pages Passed", passed)}
  ${this.summaryCard("Pages Failed", failed)}
  ${this.summaryCard("Business Tests", businessTests.length)}
  ${this.summaryCard("Tests Passed", businessPassed)}
  ${this.summaryCard("Tests Failed", businessFailed)}
  ${this.summaryCard("Warnings", businessWarning)}
  ${this.summaryCard("Blocked", businessBlocked)}
  ${this.summaryCard("Skipped", businessSkipped)}
  ${this.summaryCard("Not Executed", businessNotTested)}
</div>

<div class="table-wrapper">
<table>
<thead>
<tr>
  <th>Module</th>
  <th>Page</th>
  <th>Status</th>
  <th>Duration</th>
  <th>Console</th>
  <th>Network</th>
  <th>Element Intelligence</th>
  <th>Business Tests</th>
  <th>Findings</th>
  <th>AI Analysis</th>
  <th>Severity</th>
  <th>Category</th>
  <th>Owner</th>
  <th>Screenshot</th>
</tr>
</thead>

<tbody>
${rows}
</tbody>
</table>
</div>

</div>
</body>
</html>`;

    await fs.writeFile(reportPath, html, "utf8");

    return reportPath;
  }

  /**
   * Single-source page classification derived from the typed
   * FailureAnalyzer findings: worst-severity finding wins, ties
   * resolve to the first finding in deterministic analysis order.
   */
  private classify(findings: QAFinding[]): {
    severity: string;
    category: string;
    owner: string;
  } {
    if (findings.length === 0) {
      return { severity: "NONE", category: "NONE", owner: "NONE" };
    }

    const worst = findings.reduce((current, candidate) =>
      this.severityRank(candidate.severity) >
      this.severityRank(current.severity)
        ? candidate
        : current
    );

    return {
      severity: worst.severity,
      category: worst.category,
      owner: worst.responsibleTeam
    };
  }

  private severityRank(severity: QASeverity): number {
    switch (severity) {
      case "CRITICAL":
        return 4;
      case "HIGH":
        return 3;
      case "MEDIUM":
        return 2;
      default:
        return 1; // LOW
    }
  }

  private renderPageRow(result: PageQAResult): string {
    const businessTests = result.businessTests ?? [];
    const findings = new FailureAnalyzer().analyze(result);
    const classification = this.classify(findings);

    return `
<tr>
  <td>${this.escape(result.module)}</td>
  <td>${this.escape(result.page)}</td>
  <td class="${result.success ? "page-pass" : "page-fail"}">
    ${result.success ? "✅ PASS" : "❌ FAIL"}
  </td>
  <td>${result.performance.durationMs} ms</td>
  <td>${result.consoleErrors.length}</td>
  <td>${result.networkErrors.length}</td>
  <td>${this.renderElementIntelligence(result)}</td>
<td>${this.renderBusinessTests(businessTests)}</td>
<td>${this.renderFindings(findings)}</td>
<td>${this.renderAIAnalysis(result)}</td>
<td>${this.escape(classification.severity)}</td>
<td>${this.escape(classification.category)}</td>
<td>${this.escape(classification.owner)}</td>
<td class="screenshot">${this.escape(result.screenshot)}</td>
</tr>`;
  }

  private renderFindings(findings: QAFinding[]): string {

    if (findings.length === 0) {
      return "—";
    }

    const bySeverity = findings.reduce<Record<string, number>>(
      (counts, finding) => {
        counts[finding.severity] =
          (counts[finding.severity] ?? 0) + 1;
        return counts;
      },
      {}
    );

    const summary = Object.entries(bySeverity)
      .map(([severity, count]) => `${count} ${severity}`)
      .join(", ");

    return `
<details>
  <summary>
    ${findings.length} finding(s) — ${this.escape(summary)}
  </summary>

  <div class="business-tests">
    ${findings.map(finding => this.renderFinding(finding)).join("")}
  </div>
</details>`;
  }

  private renderFinding(finding: QAFinding): string {
    const meta = [
      finding.severity,
      finding.category,
      finding.responsibleTeam,
      `confidence ${finding.confidence}%`
    ].join(" · ");

    return `
<div class="business-test">
  <div class="test-title">${this.escape(finding.title)}</div>

  <div class="test-meta">${this.escape(meta)}</div>

  <div class="test-section">
    <b>Business impact</b><br>
    ${this.escape(finding.businessImpact)}
  </div>

  <div class="test-section">
    <b>Evidence</b>
    ${
      finding.evidence.length > 0
        ? this.renderList(finding.evidence)
        : "<span>None recorded</span>"
    }
  </div>

  <div class="test-section">
    <b>Probable root cause</b>
    ${
      finding.probableRootCause.length > 0
        ? this.renderList(finding.probableRootCause)
        : "<span>Not inferred</span>"
    }
  </div>

  <div class="test-section">
    <b>Reproduction steps</b>
    ${
      finding.reproductionSteps.length > 0
        ? this.renderList(finding.reproductionSteps)
        : "<span>Not recorded</span>"
    }
  </div>

  <div class="test-section">
    <b>Recommended fix</b>
    ${
      finding.recommendedFix.length > 0
        ? this.renderList(finding.recommendedFix)
        : "<span>Not proposed</span>"
    }
  </div>
</div>`;
  }

  private renderAIAnalysis(result: PageQAResult): string {
    const ai = result.aiAnalysis;

    if (!ai) {
      return "—";
    }

    const riskClass =
      ai.risk === "CRITICAL" || ai.risk === "HIGH"
        ? "page-fail"
        : ai.risk === "MEDIUM"
          ? "test-not-tested"
          : "page-pass";

    const category = ai.category
      ? ` · ${this.escape(ai.category)}`
      : "";

    const rootCauses = (ai.rootCauses ?? [])
      .map(rootCause => {
        const evidence =
          rootCause.evidence.length > 0
            ? ` <span class="test-meta">— ${this.escape(
                rootCause.evidence.join("; ")
              )}</span>`
            : "";

        return `<li>${this.escape(rootCause.cause)} <span class="test-meta">(confidence ${rootCause.confidence}%)</span>${evidence}</li>`;
      })
      .join("");

    const remediations = (ai.remediations ?? [])
      .map(
        remediation =>
          `<li><b>${this.escape(remediation.priority)}</b> · ${this.escape(
            remediation.team
          )}: ${this.escape(remediation.action)}</li>`
      )
      .join("");

    return `
<details>
  <summary>
    ${this.escape(ai.summary)} —
    <span class="${riskClass}">${this.escape(ai.risk)}</span>
    (${ai.confidence}%)
  </summary>

  <div class="business-tests">
    <div class="business-test">
      <div class="test-meta">
        Risk: ${this.escape(ai.risk)}${category} · confidence ${ai.confidence}%
      </div>

      <div class="test-section">
        <b>Probable root causes</b>
        <ul>${rootCauses || "<li>None inferred</li>"}</ul>
      </div>

      <div class="test-section">
        <b>Remediations</b>
        <ul>${remediations || "<li>None proposed</li>"}</ul>
      </div>
    </div>
  </div>
</details>`;
  }

  private renderElementIntelligence(
    result: PageQAResult
  ): string {
    const profile = result.elementIntelligence;

    if (!profile) {
      return "<span>Not collected</span>";
    }

    const totals = profile.totals;

    const complexity =
      totals.buttons >= 1000
        ? "EXTREME"
        : totals.buttons >= 300
          ? "HIGH"
          : totals.buttons >= 100
            ? "MODERATE"
            : "NORMAL";

    const uniqueButtonTypes =
      profile.buttons.length;

    const requiredInputs =
      profile.inputs
        .filter(input => input.required)
        .slice(0, 8)
        .map(input =>
          input.label ||
          input.placeholder ||
          input.name ||
          input.id ||
          `Input ${input.index + 1}`
        );

    const tableSummaries =
      profile.tables
        .slice(0, 4)
        .map(table => {
          const headers = table.headers
            .slice(0, 6)
            .join(", ");

          return [
            `${table.rowCount} row(s)`,
            `${table.columnCount} column(s)`,
            headers ? `Headers: ${headers}` : "",
          ]
            .filter(Boolean)
            .join(" — ");
        });

    return `
<details>
  <summary>
    ${totals.inputs} inputs,
    ${totals.buttons} buttons,
    ${totals.dropdowns} dropdowns,
    ${totals.tables} tables
  </summary>

  <div class="business-tests">
    <div class="business-test">
      <div class="test-section">
        <b>Complexity</b><br>
        ${this.escape(complexity)}
      </div>

      <div class="test-section">
        <b>Forms</b><br>
        ${totals.forms}
      </div>

      <div class="test-section">
        <b>Inputs</b><br>
        Total: ${totals.inputs}<br>
        Editable: ${totals.editableInputs}<br>
        Required: ${totals.requiredInputs}<br>
        Disabled: ${totals.disabledInputs}<br>
        Readonly: ${totals.readonlyInputs}
      </div>

      <div class="test-section">
        <b>Buttons</b><br>
        Total occurrences: ${totals.buttons}<br>
        Unique button types: ${uniqueButtonTypes}<br>
        Enabled occurrences: ${totals.enabledButtons}
      </div>

      <div class="test-section">
        <b>Dropdowns</b><br>
        Total: ${totals.dropdowns}<br>
        Empty: ${totals.emptyDropdowns}
      </div>

      <div class="test-section">
        <b>Tables</b><br>
        Total: ${totals.tables}<br>
        Empty: ${totals.emptyTables}
      </div>

      ${
        requiredInputs.length > 0
          ? `
      <div class="test-section">
        <b>Required fields</b>
        ${this.renderList(requiredInputs)}
      </div>`
          : ""
      }

      ${
        tableSummaries.length > 0
          ? `
      <div class="test-section">
        <b>Table structure</b>
        ${this.renderList(tableSummaries)}
      </div>`
          : ""
      }
    </div>
  </div>
</details>`;
  }

  private renderBusinessTests(
    tests: TestExecutionResult[]
  ): string {
    if (tests.length === 0) {
      return "—";
    }

    const passed = tests.filter(
      test => test.status === "PASS"
    ).length;

    const failed = tests.filter(
      test => test.status === "FAIL"
    ).length;

    const warning = tests.filter(
      test => test.status === "WARNING"
    ).length;

    const blocked = tests.filter(
      test => test.status === "BLOCKED"
    ).length;

    const skipped = tests.filter(
      test => test.status === "SKIPPED"
    ).length;

    const notTested = tests.filter(
      test => test.status === "NOT_TESTED"
    ).length;

    const renderedTests = tests
      .map(test => this.renderBusinessTest(test))
      .join("");

    return `
<details>
  <summary>
    ${tests.length} tests —
    ${passed} passed,
    ${failed} failed,
    ${warning} warnings,
    ${blocked} blocked,
    ${skipped} skipped,
    ${notTested} not executed
  </summary>

  <div class="business-tests">
    ${renderedTests}
  </div>
</details>`;
  }

  private renderBusinessTest(
    result: TestExecutionResult
  ): string {
    const label = this.businessTestLabel(result);
    const statusClass = this.statusClass(result.status);

    const expected = result.expected.length > 0
      ? this.renderList(result.expected)
      : "<span>Not specified</span>";

    const observed = result.observed.length > 0
      ? this.renderList(result.observed)
      : "<span>No observation recorded</span>";

    const error = result.error
      ? `<div class="error"><b>Error:</b> ${this.escape(result.error)}</div>`
      : "";

    const screenshots = this.renderTestScreenshots(result);

    return `
<div class="business-test">
  <div class="test-title">
    ${this.escape(label)}
  </div>

  <div class="${statusClass}">
    ${this.escape(result.status)}
  </div>

  <div class="test-meta">
    Duration: ${result.durationMs} ms
  </div>

  <div class="test-section">
    <b>Expected</b>
    ${expected}
  </div>

  <div class="test-section">
    <b>Observed</b>
    ${observed}
  </div>

  ${error}
  ${screenshots}
</div>`;
  }

  private renderTestScreenshots(
    result: TestExecutionResult
  ): string {
    const items: string[] = [];

    if (result.screenshotBefore) {
      items.push(
        this.renderTestScreenshot(
          "Before",
          result.screenshotBefore
        )
      );
    }

    if (result.screenshotAfter) {
      items.push(
        this.renderTestScreenshot(
          "After",
          result.screenshotAfter
        )
      );
    }

    if (items.length === 0) {
      return "";
    }

    return `
<div class="test-screenshots">
  ${items.join("")}
</div>`;
  }

  private renderTestScreenshot(
    label: string,
    screenshotPath: string
  ): string {
    const safePath = this.escape(screenshotPath);
    const fileUrl = this.escape(
      `file://${screenshotPath}`
    );

    return `
<div class="test-screenshot">
  <a href="${fileUrl}" target="_blank">
    ${this.escape(label)} screenshot
  </a>

  <a href="${fileUrl}" target="_blank">
    <img
      src="${fileUrl}"
      alt="${this.escape(label)} screenshot"
      loading="lazy"
    >
  </a>

  <div class="screenshot">${safePath}</div>
</div>`;
  }

  private businessTestLabel(
    result: TestExecutionResult
  ): string {
    const definition = result.test as unknown as Record<
      string,
      unknown
    >;

    const candidates = [
      definition.name,
      definition.title,
      definition.description,
      definition.id,
    ];

    for (const candidate of candidates) {
      if (
        typeof candidate === "string" &&
        candidate.trim().length > 0
      ) {
        return candidate.trim();
      }
    }

    return "Unnamed business test";
  }

  private statusClass(status: string): string {
    switch (status) {
      case "PASS":
        return "test-pass";

      case "FAIL":
        return "test-fail";

      case "SKIPPED":
        return "test-skipped";

      default:
        return "test-not-tested";
    }
  }

  private renderList(values: string[]): string {
    const items = values
      .map(value => `<li>${this.escape(value)}</li>`)
      .join("");

    return `<ul>${items}</ul>`;
  }

  private summaryCard(
    label: string,
    value: number
  ): string {
    return `
<div class="card">
  <div class="card-label">${this.escape(label)}</div>
  <div class="card-value">${value}</div>
</div>`;
  }

  private timestamp(): string {
    return new Date()
      .toISOString()
      .replace(/[:.]/g, "-");
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
