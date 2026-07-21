import type { Page } from "@playwright/test";

import type {
  BusinessTestDefinition,
  TestResultStatus
} from "../../tests/models/TestDefinition";

import type { TestExecutionResult } from "../TestExecutionResult";

interface ReadOnlyAssessment {
  status: TestResultStatus;
  observed: string[];
  error?: string;
}

export class ReadOnlyExecutor {
  async execute(
    page: Page,
    test: BusinessTestDefinition
  ): Promise<TestExecutionResult> {
    const started = Date.now();

    try {
      await page.waitForLoadState("domcontentloaded");

      const assessment =
        await this.assess(page, test);

      return {
        test,
        status: assessment.status,
        expected: test.expected.map(
          item => item.description
        ),
        observed: assessment.observed,
        durationMs: Date.now() - started,
        ...(assessment.error
          ? { error: assessment.error }
          : {})
      };
    } catch (error) {
      return {
        test,
        status: "FAIL",
        expected: test.expected.map(
          item => item.description
        ),
        observed: [],
        durationMs: Date.now() - started,
        error:
          error instanceof Error
            ? error.message
            : String(error)
      };
    }
  }

  private async assess(
    page: Page,
    test: BusinessTestDefinition
  ): Promise<ReadOnlyAssessment> {
    switch (test.id) {
      case "REG-001":
        return this.assessPageLoad(
          page,
          "Registration"
        );

      case "REG-002":
        return this.assessRegistrationForm(page);

      case "REG-007":
        return this.assessRegistrationDropdowns(
          page
        );

      case "FEE-001":
        return this.assessPageLoad(
          page,
          "Collect Fees"
        );

      case "FEE-009":
        return this.assessReceiptEvidence(page);

      default:
        return this.assessGenericReadOnly(
          page,
          test
        );
    }
  }

  private async assessPageLoad(
    page: Page,
    expectedPageName: string
  ): Promise<ReadOnlyAssessment> {
    const url = page.url();
    const title = await page.title();

    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");

    const authenticationRedirect =
      /login|sign-in|signin|authenticate/i.test(
        url
      );

    const blockingError =
      /internal server error|page not found|access denied|something went wrong|unexpected error/i.test(
        bodyText
      );

    const observed = [
      `Final URL: ${url}`,
      `Document title: ${title || "none"}`,
      `Body text detected: ${
        bodyText.trim().length
      } character(s)`,
      `Authentication redirect detected: ${
        authenticationRedirect ? "yes" : "no"
      }`,
      `Blocking error text detected: ${
        blockingError ? "yes" : "no"
      }`
    ];

    if (
      authenticationRedirect ||
      blockingError ||
      bodyText.trim().length === 0
    ) {
      return {
        status: "FAIL",
        observed,
        error:
          `${expectedPageName} did not satisfy ` +
          "read-only page-load assertions"
      };
    }

    return {
      status: "PASS",
      observed
    };
  }

  private async assessRegistrationForm(
    page: Page
  ): Promise<ReadOnlyAssessment> {
    const visibleForms =
      await this.visibleCount(
        page.locator("form")
      );

    const visibleInputs =
      await this.visibleCount(
        page.locator(
          [
            "input:not([type='hidden'])",
            "textarea",
            "select",
            "[contenteditable='true']",
            "[role='textbox']",
            "[role='combobox']"
          ].join(", ")
        )
      );

    const editableInputs =
      await this.visibleCount(
        page.locator(
          [
            "input:not([type='hidden'])",
            "textarea",
            "select",
            "[contenteditable='true']",
            "[role='textbox']",
            "[role='combobox']"
          ].join(", ")
        ).filter({
          hasNot: page.locator(
            "[disabled], [readonly], " +
            "[aria-disabled='true'], " +
            "[aria-readonly='true']"
          )
        })
      ).catch(() => 0);

    const requiredControls =
      await this.visibleCount(
        page.locator(
          "[required], [aria-required='true']"
        )
      );

    const actionCandidates =
      page.locator(
        [
          "button",
          "input[type='submit']",
          "[role='button']"
        ].join(", ")
      );

    const actionCount =
      await actionCandidates.count();

    const primaryActions: string[] = [];

    for (
      let index = 0;
      index < actionCount;
      index += 1
    ) {
      const action =
        actionCandidates.nth(index);

      if (!(await action.isVisible().catch(
        () => false
      ))) {
        continue;
      }

      if (!(await action.isEnabled().catch(
        () => false
      ))) {
        continue;
      }

      const text = (
        (await action.innerText().catch(
          () => ""
        )) ||
        (await action.getAttribute("value")) ||
        (await action.getAttribute(
          "aria-label"
        )) ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();

      if (
        /save|register|submit|continue|create|next/i.test(
          text
        )
      ) {
        primaryActions.push(
          text || "unnamed submit action"
        );
      }
    }

    const observed = [
      `Visible forms detected: ${visibleForms}`,
      `Visible input controls detected: ${visibleInputs}`,
      `Editable input controls detected: ${editableInputs}`,
      `Required controls detected: ${requiredControls}`,
      `Primary form actions detected: ${
        primaryActions.length
      }`,
      ...primaryActions
        .slice(0, 5)
        .map(
          action =>
            `Primary action: ${action}`
        )
    ];

    const formStructureDetected =
      visibleForms > 0 ||
      visibleInputs >= 5;

    const usableControlsDetected =
      editableInputs > 0 ||
      visibleInputs > 0;

    const submitActionDetected =
      primaryActions.length > 0;

    if (
      formStructureDetected &&
      usableControlsDetected &&
      submitActionDetected
    ) {
      return {
        status: "PASS",
        observed
      };
    }

    return {
      status: "FAIL",
      observed,
      error:
        "Registration form structure did not " +
        "satisfy the configured expectations"
    };
  }

  private async assessRegistrationDropdowns(
    page: Page
  ): Promise<ReadOnlyAssessment> {
    const dropdowns = page.locator(
      [
        "select",
        "[role='combobox']",
        "[aria-haspopup='listbox']"
      ].join(", ")
    );

    const count = await dropdowns.count();

    let visible = 0;
    let enabled = 0;
    let populated = 0;
    let empty = 0;

    const observed: string[] = [];

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const dropdown = dropdowns.nth(index);

      if (!(await dropdown.isVisible().catch(
        () => false
      ))) {
        continue;
      }

      visible += 1;

      const isEnabled =
        await dropdown.isEnabled().catch(
          () => false
        );

      if (isEnabled) {
        enabled += 1;
      }

      const tagName =
        await dropdown.evaluate(
          element =>
            element.tagName.toLowerCase()
        );

      let optionCount = 0;

      if (tagName === "select") {
        optionCount =
          await dropdown.locator(
            "option"
          ).count();
      } else {
        optionCount =
          await dropdown.locator(
            "[role='option']"
          ).count();
      }

      if (optionCount > 1) {
        populated += 1;
      } else {
        empty += 1;
      }

      const label =
        (await dropdown.getAttribute(
          "aria-label"
        )) ||
        (await dropdown.getAttribute(
          "name"
        )) ||
        (await dropdown.getAttribute("id")) ||
        `Dropdown ${index + 1}`;

      observed.push(
        `${label}: enabled=${
          isEnabled ? "yes" : "no"
        }, options=${optionCount}`
      );
    }

    observed.unshift(
      `Visible dropdowns detected: ${visible}`,
      `Enabled dropdowns detected: ${enabled}`,
      `Populated dropdowns detected: ${populated}`,
      `Empty dropdowns detected: ${empty}`
    );

    if (
      visible > 0 &&
      enabled > 0 &&
      populated > 0
    ) {
      return {
        status: "PASS",
        observed
      };
    }

    return {
      status: "FAIL",
      observed,
      error:
        "No usable populated registration " +
        "dropdown was detected"
    };
  }

  private async assessReceiptEvidence(
    page: Page
  ): Promise<ReadOnlyAssessment> {
    const actionCandidates =
      page.locator(
        [
          "a",
          "button",
          "[role='button']"
        ].join(", ")
      );

    const actionCount =
      await actionCandidates.count();

    const receiptActions: string[] = [];

    for (
      let index = 0;
      index < actionCount;
      index += 1
    ) {
      const candidate =
        actionCandidates.nth(index);

      const visible =
        await candidate.isVisible().catch(
          () => false
        );

      if (!visible) {
        continue;
      }

      const tagName =
        await candidate
          .getAttribute("tagName")
          .catch(() => null);

      const role =
        (await candidate.getAttribute(
          "role"
        )) || "";

      const href =
        (await candidate.getAttribute(
          "href"
        )) || "";

      const ariaLabel =
        (await candidate.getAttribute(
          "aria-label"
        )) || "";

      const title =
        (await candidate.getAttribute(
          "title"
        )) || "";

      const innerText =
        await candidate
          .innerText()
          .catch(() => "");

      const text = (
        innerText ||
        ariaLabel ||
        title ||
        href
      )
        .replace(/\s+/g, " ")
        .trim();

      const genericReceiptTab =
        /^(receipt|receipts)$/i.test(
          text
        );

      const explicitReceiptAction =
        /^(view|open|print|download|show)?\s*(fee\s*)?(payment\s*)?receipt(\s*(number|no|details))?/i.test(
          text
        );

      const receiptHref =
        /receipt|invoice|payment-slip|fee-slip/i.test(
          href
        );

      const actionable =
        role === "button" ||
        href.length > 0 ||
        await candidate
          .evaluate(
            element =>
              element.tagName === "BUTTON"
          )
          .catch(() => false);

      if (
        actionable &&
        !genericReceiptTab &&
        (
          explicitReceiptAction ||
          receiptHref
        )
      ) {
        receiptActions.push(
          text || href
        );
      }
    }

    const dialogCandidates =
      page.locator(
        [
          "[role='dialog']",
          "[aria-modal='true']",
          ".modal"
        ].join(", ")
      );

    const dialogCount =
      await dialogCandidates.count();

    let receiptDialogCount = 0;
    const receiptDialogEvidence: string[] =
      [];

    for (
      let index = 0;
      index < dialogCount;
      index += 1
    ) {
      const dialog =
        dialogCandidates.nth(index);

      const visible =
        await dialog.isVisible().catch(
          () => false
        );

      if (!visible) {
        continue;
      }

      const dialogText = (
        await dialog
          .innerText()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .trim();

      const evidenceCount = [
        /receipt/i.test(dialogText),
        /student|admission|registration/i.test(
          dialogText
        ),
        /amount|paid|balance|₹|\brs\.?\b/i.test(
          dialogText
        ),
        /payment mode|mode of payment|cash|card|upi|online|cheque|bank transfer/i.test(
          dialogText
        ),
        /date|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/i.test(
          dialogText
        )
      ].filter(Boolean).length;

      if (evidenceCount >= 4) {
        receiptDialogCount += 1;

        receiptDialogEvidence.push(
          dialogText.slice(0, 240)
        );
      }
    }

    const tables =
      page.locator("table");

    const tableCount =
      await tables.count();

    let qualifyingReceiptRows = 0;

    const tableDescriptions: string[] =
      [];

    for (
      let index = 0;
      index < tableCount;
      index += 1
    ) {
      const table = tables.nth(index);

      const visible =
        await table.isVisible().catch(
          () => false
        );

      if (!visible) {
        continue;
      }

      const headers =
        await table
          .locator("thead th")
          .allInnerTexts()
          .catch(() => []);

      const normalizedHeaders =
        headers
          .map(header =>
            header
              .replace(/\s+/g, " ")
              .trim()
          )
          .filter(Boolean);

      const headerText =
        normalizedHeaders.join(" | ");

      const fieldMatches = [
        /receipt|invoice/i.test(
          headerText
        ),
        /student|admission|registration/i.test(
          headerText
        ),
        /amount|paid|balance/i.test(
          headerText
        ),
        /payment mode|mode/i.test(
          headerText
        ),
        /date/i.test(headerText)
      ].filter(Boolean).length;

      const rows =
        table.locator("tbody tr");

      const rowCount =
        await rows.count();

      let visibleRows = 0;

      for (
        let rowIndex = 0;
        rowIndex < rowCount;
        rowIndex += 1
      ) {
        const rowVisible =
          await rows
            .nth(rowIndex)
            .isVisible()
            .catch(() => false);

        if (rowVisible) {
          visibleRows += 1;
        }
      }

      if (
        fieldMatches >= 3 &&
        visibleRows > 0
      ) {
        qualifyingReceiptRows +=
          visibleRows;

        tableDescriptions.push(
          `${visibleRows} receipt row(s), ` +
          `headers: ${headerText}`
        );
      }
    }

    const bodyText = (
      await page
        .locator("body")
        .innerText()
        .catch(() => "")
    )
      .replace(/\s+/g, " ")
      .trim();

    const contextualFields = [
      /student|admission|registration/i.test(
        bodyText
      ),
      /amount|paid|balance|₹|\brs\.?\b/i.test(
        bodyText
      ),
      /payment mode|mode of payment|cash|card|upi|online|cheque|bank transfer/i.test(
        bodyText
      ),
      /date|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/i.test(
        bodyText
      )
    ].filter(Boolean).length;

    const observed = [
      `Explicit receipt actions detected: ${
        receiptActions.length
      }`,
      `Receipt dialogs detected: ${
        receiptDialogCount
      }`,
      `Qualifying receipt rows detected: ${
        qualifyingReceiptRows
      }`,
      `Receipt-context fields detected: ${
        contextualFields
      } of 4`,
      ...receiptActions
        .slice(0, 5)
        .map(
          action =>
            `Receipt action: ${action}`
        ),
      ...receiptDialogEvidence
        .slice(0, 3)
        .map(
          evidence =>
            `Receipt dialog evidence: ${evidence}`
        ),
      ...tableDescriptions
        .slice(0, 3)
        .map(
          description =>
            `Receipt table: ${description}`
        )
    ];

    const receiptOpened =
      receiptDialogCount > 0;

    const existingReceiptAvailable =
      qualifyingReceiptRows > 0 &&
      receiptActions.length > 0;

    if (
      receiptOpened ||
      existingReceiptAvailable
    ) {
      return {
        status: "PASS",
        observed
      };
    }

    return {
      status: "NOT_TESTED",
      observed: [
        ...observed,
        "No opened receipt or qualifying " +
          "existing receipt record was detected",
        "The Receipts tab alone is not accepted " +
          "as proof that a receipt was generated"
      ]
    };
  }

  private async assessGenericReadOnly(
    page: Page,
    test: BusinessTestDefinition
  ): Promise<ReadOnlyAssessment> {
    const url = page.url();

    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");

    const visibleControls =
      await this.visibleCount(
        page.locator(
          [
            "input:not([type='hidden'])",
            "textarea",
            "select",
            "button",
            "table",
            "[role='button']",
            "[role='dialog']",
            "[role='grid']"
          ].join(", ")
        )
      );

    const authenticationRedirect =
      /login|sign-in|signin|authenticate/i.test(
        url
      );

    const blockingError =
      /internal server error|page not found|access denied|something went wrong|unexpected error/i.test(
        bodyText
      );

    const observed = [
      `Test ID: ${test.id}`,
      `Final URL: ${url}`,
      `Visible interactive or structural controls: ${visibleControls}`,
      `Authentication redirect detected: ${
        authenticationRedirect ? "yes" : "no"
      }`,
      `Blocking error text detected: ${
        blockingError ? "yes" : "no"
      }`
    ];

    if (
      authenticationRedirect ||
      blockingError ||
      bodyText.trim().length === 0
    ) {
      return {
        status: "FAIL",
        observed,
        error:
          "Generic read-only page assertions failed"
      };
    }

    return {
      status: "PASS",
      observed
    };
  }

  private async visibleCount(
    locator: ReturnType<Page["locator"]>
  ): Promise<number> {
    const count = await locator.count();
    let visible = 0;

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      if (
        await locator
          .nth(index)
          .isVisible()
          .catch(() => false)
      ) {
        visible += 1;
      }
    }

    return visible;
  }
}
