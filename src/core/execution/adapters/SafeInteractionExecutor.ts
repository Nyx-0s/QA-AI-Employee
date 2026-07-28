import type { Locator, Page } from "@playwright/test";

import type { BusinessTestDefinition } from "../../tests/models/TestDefinition";
import type { TestExecutionResult } from "../TestExecutionResult";
import { FormLocator } from "../utils/FormLocator";
import { ActionExecutor } from "../../actions/ActionExecutor";
import type { ExecutionContext } from "../../actions/models/ExecutionContext";

type ResultStatus = TestExecutionResult["status"];

export class SafeInteractionExecutor {
  private readonly formLocator = new FormLocator();
  private readonly actionExecutor = new ActionExecutor();

  async execute(
    page: Page,
    test: BusinessTestDefinition
  ): Promise<TestExecutionResult> {
    const started = Date.now();

    try {

      if (test.actions?.length) {

        const context: ExecutionContext = {
          page,
          variables: {},
          observations: []
        };

        const result =
          await this.actionExecutor.execute(
            context,
            test.actions
          );

        return this.result(
          test,
          result.success ? "PASS" : "FAIL",
          result.observations,
          Date.now() - started,
          result.error
        );

      }

      switch (test.id) {
        case "REG-003":
          return await this.testRequiredFields(page, test, started);

        case "REG-004":
          return await this.testInvalidEmail(page, test, started);

        case "REG-005":
          return await this.testInvalidPhone(page, test, started);

        case "REG-006":
          return await this.testTyping(page, test, started);

        case "FEE-002":
          return await this.testStudentSearchField(page, test, started);

        case "FEE-003":
          return await this.testUnknownStudent(page, test, started);

        case "FEE-004":
          return await this.testStudentFeeDetails(page, test, started);

        case "FEE-005":
          return await this.testNegativeAmount(page, test, started);

        case "FEE-006":
          return await this.testOverpayment(page, test, started);

        case "FEE-007":
          return await this.testPaymentModeRequired(page, test, started);

        default:
          return this.result(
            test,
            "NOT_TESTED",
            ["No safe executor implemented for this test yet"],
            Date.now() - started
          );
      }
    } catch (error) {
      return this.result(
        test,
        "FAIL",
        [],
        Date.now() - started,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async testRequiredFields(
    page: Page,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {
    const form = await this.requireForm(page, test, started);

    if ("status" in form) {
      return form;
    }

    const requiredFields = form.locator(
      [
        "input[required]",
        "textarea[required]",
        "select[required]",
        "[aria-required='true']"
      ].join(",")
    );

    const requiredCount = await this.visibleCount(requiredFields);
    const submit = await this.findAction(
      form,
      ["submit", "save", "register", "continue", "next"]
    );

    if (!submit) {
      return this.result(
        test,
        "BLOCKED",
        [`Required controls detected: ${requiredCount}`],
        Date.now() - started,
        "Primary submit action not found"
      );
    }

    const textInputs = await this.formLocator.textInputs(form);
    const nonEmptyValues: Array<{ input: Locator; value: string }> = [];

    for (const input of textInputs) {
      const value = await input.inputValue().catch(() => "");

      if (value.trim()) {
        nonEmptyValues.push({ input, value });
        await input.fill("");
      }
    }

    const urlBefore = page.url();
    let clickError = "";

    try {
      await submit.click({ timeout: 5000, noWaitAfter: true });
      await page.waitForTimeout(600);
    } catch (error) {
      clickError = error instanceof Error ? error.message : String(error);
    }

    const validation = await this.collectValidationEvidence(page, form);
    const urlAfter = page.url();

    for (const item of nonEmptyValues) {
      await item.input.fill(item.value).catch(() => undefined);
    }

    const submissionBlocked =
      urlAfter === urlBefore ||
      validation.length > 0 ||
      requiredCount > 0 ||
      clickError.length > 0;

    const observed = [
      `Required controls detected: ${requiredCount}`,
      `Primary action detected: yes`,
      `URL changed after empty submission: ${urlAfter !== urlBefore}`,
      ...validation.slice(0, 8)
    ];

    if (clickError) {
      observed.push(`Submit interaction response: ${clickError}`);
    }

    return this.result(
      test,
      submissionBlocked && (requiredCount > 0 || validation.length > 0)
        ? "PASS"
        : "WARNING",
      observed,
      Date.now() - started
    );
  }

  private async testInvalidEmail(
    page: Page,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {
    const form = await this.requireForm(page, test, started);

    if ("status" in form) {
      return form;
    }

    const input = await this.findField(form, [
      "email",
      "e-mail",
      "mail"
    ]);

    if (!input) {
      return this.result(
        test,
        "BLOCKED",
        [],
        Date.now() - started,
        "Email input not found"
      );
    }

    const original = await input.inputValue().catch(() => "");
    await input.fill("invalid-email");
    await input.blur();
    await page.waitForTimeout(250);

    const evidence = await this.inspectInputValidation(page, input);
    const acceptedValue = await input.inputValue().catch(() => "");

    await input.fill(original);

    const rejected =
      evidence.invalid ||
      evidence.validationText.length > 0 ||
      acceptedValue !== "invalid-email";

    return this.result(
      test,
      rejected ? "PASS" : "WARNING",
      [
        `Email field retained entered value: ${acceptedValue === "invalid-email"}`,
        `Input type: ${evidence.type || "unknown"}`,
        `Pattern: ${evidence.pattern || "none"}`,
        `aria-invalid: ${evidence.ariaInvalid || "not set"}`,
        ...evidence.validationText
      ],
      Date.now() - started
    );
  }

  private async testInvalidPhone(
    page: Page,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {
    const form = await this.requireForm(page, test, started);

    if ("status" in form) {
      return form;
    }

    const input = await this.findField(form, [
      "phone",
      "mobile",
      "contact",
      "telephone",
      "tel"
    ]);

    if (!input) {
      return this.result(
        test,
        "BLOCKED",
        [],
        Date.now() - started,
        "Phone input not found"
      );
    }

    const original = await input.inputValue().catch(() => "");
    await input.fill("123");
    await input.blur();
    await page.waitForTimeout(250);

    const evidence = await this.inspectInputValidation(page, input);
    const retained = await input.inputValue().catch(() => "");

    await input.fill(original);

    const minLength = Number(evidence.minLength || "-1");
    const structurallyRejected =
      evidence.invalid ||
      evidence.validationText.length > 0 ||
      (minLength > 3 && retained.length < minLength) ||
      retained !== "123";

    return this.result(
      test,
      structurallyRejected ? "PASS" : "WARNING",
      [
        `Phone field retained entered value: ${retained === "123"}`,
        `Input type: ${evidence.type || "unknown"}`,
        `minLength: ${evidence.minLength || "not set"}`,
        `Pattern: ${evidence.pattern || "none"}`,
        `aria-invalid: ${evidence.ariaInvalid || "not set"}`,
        ...evidence.validationText
      ],
      Date.now() - started
    );
  }

  private async testTyping(
    page: Page,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {
    const form = await this.requireForm(page, test, started);

    if ("status" in form) {
      return form;
    }

    const inputs = await this.formLocator.textInputs(form);

    if (inputs.length === 0) {
      return this.result(
        test,
        "BLOCKED",
        [],
        Date.now() - started,
        "No editable text inputs found"
      );
    }

    const observed: string[] = [];
    let passed = 0;

    for (let index = 0; index < Math.min(inputs.length, 5); index++) {
      const input = inputs[index];
      const original = await input.inputValue().catch(() => "");
      const marker = `AQW_TEST_${index + 1}`;

      await input.fill(marker);
      const retained = await input.inputValue().catch(() => "");

      if (retained === marker) {
        passed += 1;
        observed.push(`Input ${index + 1} accepted and retained text`);
      } else {
        observed.push(`Input ${index + 1} did not retain text`);
      }

      await input.fill(original);
    }

    return this.result(
      test,
      passed > 0 ? "PASS" : "FAIL",
      observed,
      Date.now() - started
    );
  }

  private async testStudentSearchField(
    page: Page,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {
    const field = await this.findStudentSearchField(page);

    if (!field) {
      return this.result(
        test,
        "BLOCKED",
        [],
        Date.now() - started,
        "Admission or registration search field not found"
      );
    }

    const original = await field.inputValue().catch(() => "");
    const marker = "AQW-SEARCH-TEST";

    await field.fill(marker);
    const retained = await field.inputValue().catch(() => "");
    await field.fill(original);

    return this.result(
      test,
      retained === marker ? "PASS" : "FAIL",
      [
        "Admission or registration search field detected",
        `Temporary value retained: ${retained === marker}`,
        "Original field value restored"
      ],
      Date.now() - started
    );
  }

  private async testUnknownStudent(
    page: Page,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {
    const field = await this.findStudentSearchField(page);

    if (!field) {
      return this.result(
        test,
        "BLOCKED",
        [],
        Date.now() - started,
        "Admission or registration search field not found"
      );
    }

    const original = await field.inputValue().catch(() => "");
    const invalidId =
      String(test.inputs?.[0]?.value || "AQW-NON-EXISTENT-999999");

    await field.fill(invalidId);

    const searchAction = await this.findSearchAction(page);

    if (!searchAction) {
      await field.fill(original);

      return this.result(
        test,
        "BLOCKED",
        ["Unknown student identifier entered safely"],
        Date.now() - started,
        "Search action not found"
      );
    }

    await searchAction.click({ timeout: 5000, noWaitAfter: true });
    await page.waitForTimeout(1200);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const lower = bodyText.toLowerCase();

    const noResultTerms = [
      "no record",
      "no records",
      "not found",
      "no student",
      "student not found",
      "no data",
      "no result",
      "no results",
      "does not exist",
      "invalid admission",
      "invalid registration"
    ];

    const matched = noResultTerms.filter(term => lower.includes(term));
    await field.fill(original).catch(() => undefined);

    return this.result(
      test,
      matched.length > 0 ? "PASS" : "WARNING",
      [
        `Unknown identifier searched: ${invalidId}`,
        `No-result indicators detected: ${matched.length}`,
        ...matched.map(term => `Detected response: ${term}`),
        "Original search value restored"
      ],
      Date.now() - started
    );
  }

  private async testStudentFeeDetails(
    page: Page,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {
    const studentId =
      process.env.AQW_QA_STUDENT_ID ||
      process.env.QA_STUDENT_ADMISSION_NUMBER ||
      process.env.QA_STUDENT_ID;

    if (!studentId) {
      return this.result(
        test,
        "BLOCKED",
        [
          "A valid student search requires an approved QA student identifier"
        ],
        Date.now() - started,
        "Set AQW_QA_STUDENT_ID in .env"
      );
    }

    const field = await this.findStudentSearchField(page);

    if (!field) {
      return this.result(
        test,
        "BLOCKED",
        [],
        Date.now() - started,
        "Admission or registration search field not found"
      );
    }

    const original = await field.inputValue().catch(() => "");
    await field.fill(studentId);

    const searchAction = await this.findSearchAction(page);

    if (!searchAction) {
      await field.fill(original);

      return this.result(
        test,
        "BLOCKED",
        [],
        Date.now() - started,
        "Search action not found"
      );
    }

    await searchAction.click({ timeout: 5000, noWaitAfter: true });
    await page.waitForTimeout(1500);

    const studentMatch = page.getByText(studentId, { exact: false }).first();

    if (await studentMatch.isVisible().catch(() => false)) {
      await studentMatch.click({ timeout: 3000, noWaitAfter: true })
        .catch(() => undefined);

      await page.waitForTimeout(900);
    }

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const lower = bodyText.toLowerCase();

    const studentTerms = [
      "student name",
      "admission",
      "registration",
      "class",
      "section"
    ].filter(term => lower.includes(term));

    const feeTerms = [
      "fee",
      "outstanding",
      "balance",
      "paid",
      "due",
      "amount",
      "installment",
      "receipt"
    ].filter(term => lower.includes(term));

    await field.fill(original).catch(() => undefined);

    const passed =
      lower.includes(studentId.toLowerCase()) &&
      studentTerms.length > 0 &&
      feeTerms.length >= 2;

    return this.result(
      test,
      passed ? "PASS" : "WARNING",
      [
        `Approved QA student searched: ${studentId}`,
        `Student-detail indicators detected: ${studentTerms.length}`,
        `Fee-detail indicators detected: ${feeTerms.length}`,
        ...studentTerms.map(term => `Student indicator: ${term}`),
        ...feeTerms.slice(0, 6).map(term => `Fee indicator: ${term}`),
        "Original search value restored"
      ],
      Date.now() - started
    );
  }

  private async testNegativeAmount(
    page: Page,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {
    const amount = await this.findAmountField(page);

    if (!amount) {
      return this.result(
        test,
        "BLOCKED",
        [],
        Date.now() - started,
        "Payment amount field not found"
      );
    }

    const original = await amount.inputValue().catch(() => "");
    await amount.fill("-100");
    await amount.blur();
    await page.waitForTimeout(300);

    const evidence = await this.inspectInputValidation(page, amount);
    const retained = await amount.inputValue().catch(() => "");
    const min = Number(evidence.min || "NaN");

    await amount.fill(original);

    const rejected =
      retained !== "-100" ||
      evidence.invalid ||
      evidence.validationText.length > 0 ||
      (!Number.isNaN(min) && min >= 0);

    return this.result(
      test,
      rejected ? "PASS" : "WARNING",
      [
        `Negative amount retained: ${retained === "-100"}`,
        `Configured minimum: ${evidence.min || "not set"}`,
        `aria-invalid: ${evidence.ariaInvalid || "not set"}`,
        ...evidence.validationText,
        "Original amount restored"
      ],
      Date.now() - started
    );
  }

  private async testOverpayment(
    page: Page,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {
    const amount = await this.findAmountField(page);

    if (!amount) {
      return this.result(
        test,
        "BLOCKED",
        [],
        Date.now() - started,
        "Payment amount field not found"
      );
    }

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const balance = this.extractOutstandingBalance(bodyText);

    if (balance === null) {
      return this.result(
        test,
        "BLOCKED",
        ["Payment amount field detected"],
        Date.now() - started,
        "Outstanding balance could not be identified safely"
      );
    }

    const original = await amount.inputValue().catch(() => "");
    const overpayment = balance + Math.max(100, Math.ceil(balance * 0.1));

    await amount.fill(String(overpayment));
    await amount.blur();
    await page.waitForTimeout(300);

    const evidence = await this.inspectInputValidation(page, amount);
    const max = Number(evidence.max || "NaN");

    await amount.fill(original);

    const handled =
      evidence.invalid ||
      evidence.validationText.length > 0 ||
      (!Number.isNaN(max) && max <= balance);

    return this.result(
      test,
      handled ? "PASS" : "WARNING",
      [
        `Outstanding balance detected: ${balance}`,
        `Temporary overpayment entered: ${overpayment}`,
        `Configured maximum: ${evidence.max || "not set"}`,
        `aria-invalid: ${evidence.ariaInvalid || "not set"}`,
        ...evidence.validationText,
        "No payment submission was performed",
        "Original amount restored"
      ],
      Date.now() - started
    );
  }

  private async testPaymentModeRequired(
    page: Page,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {
    const mode = await this.findPaymentModeControl(page);

    if (!mode) {
      return this.result(
        test,
        "BLOCKED",
        [],
        Date.now() - started,
        "Payment mode control not found"
      );
    }

    const required = await mode.getAttribute("required");
    const ariaRequired = await mode.getAttribute("aria-required");
    const ariaInvalid = await mode.getAttribute("aria-invalid");

    const paymentAction = await this.findAction(
      page.locator("body"),
      ["pay", "collect", "proceed", "continue", "submit"]
    );

    const actionDisabled = paymentAction
      ? !(await paymentAction.isEnabled().catch(() => true))
      : false;

    const labels = await this.nearbyText(mode);
    const requiredLabel =
      labels.toLowerCase().includes("required") ||
      labels.includes("*");

    const protectedByValidation =
      required !== null ||
      ariaRequired === "true" ||
      ariaInvalid === "true" ||
      actionDisabled ||
      requiredLabel;

    return this.result(
      test,
      protectedByValidation ? "PASS" : "WARNING",
      [
        "Payment mode control detected",
        `required attribute present: ${required !== null}`,
        `aria-required: ${ariaRequired || "not set"}`,
        `aria-invalid: ${ariaInvalid || "not set"}`,
        `Payment action disabled without mode: ${actionDisabled}`,
        `Required-field label indicator detected: ${requiredLabel}`,
        "No payment submission was performed"
      ],
      Date.now() - started
    );
  }

  private async requireForm(
    page: Page,
    test: BusinessTestDefinition,
    started: number
  ): Promise<Locator | TestExecutionResult> {
    const form = await this.formLocator.findMainForm(page);

    if (form) {
      return form;
    }

    return this.result(
      test,
      "BLOCKED",
      [],
      Date.now() - started,
      "No visible form found"
    );
  }

  private async findStudentSearchField(
    page: Page
  ): Promise<Locator | null> {
    const scopes = [
      page.locator("form").first(),
      page.locator("body")
    ];

    for (const scope of scopes) {
      const field = await this.findField(scope, [
        "admission",
        "registration",
        "enrollment",
        "student id",
        "student code",
        "roll number",
        "roll no"
      ]);

      if (field) {
        return field;
      }
    }

    return null;
  }

  private async findAmountField(
    page: Page
  ): Promise<Locator | null> {
    const scopes = [
      page.locator("form").first(),
      page.locator("body")
    ];

    for (const scope of scopes) {
      const field = await this.findField(scope, [
        "amount",
        "payment amount",
        "pay amount",
        "paid amount",
        "collect amount",
        "fee amount"
      ]);

      if (field) {
        return field;
      }
    }

    return null;
  }

  private async findPaymentModeControl(
    page: Page
  ): Promise<Locator | null> {
    const controls = page.locator(
      [
        "select",
        "[role='combobox']",
        "input[type='radio']",
        "button[aria-haspopup='listbox']"
      ].join(",")
    );

    const total = await controls.count();

    for (let index = 0; index < total; index++) {
      const control = controls.nth(index);

      if (!(await control.isVisible().catch(() => false))) {
        continue;
      }

      if (!(await control.isEnabled().catch(() => false))) {
        continue;
      }

      const attributes = await this.elementIdentity(control);
      const nearby = await this.nearbyText(control);
      const haystack = `${attributes} ${nearby}`.toLowerCase();

      if (
        haystack.includes("payment mode") ||
        haystack.includes("mode of payment") ||
        haystack.includes("payment method") ||
        haystack.includes("pay mode")
      ) {
        return control;
      }
    }

    return null;
  }

  private async findSearchAction(
    page: Page
  ): Promise<Locator | null> {
    return this.findAction(
      page.locator("body"),
      ["search", "find", "lookup", "go", "fetch"]
    );
  }

  private async findAction(
    scope: Locator,
    hints: string[]
  ): Promise<Locator | null> {
    const actions = scope.locator(
      [
        "button",
        "input[type='submit']",
        "input[type='button']",
        "[role='button']"
      ].join(",")
    );

    const total = await actions.count();

    for (let index = 0; index < total; index++) {
      const action = actions.nth(index);

      if (!(await action.isVisible().catch(() => false))) {
        continue;
      }

      if (!(await action.isEnabled().catch(() => false))) {
        continue;
      }

      const text = await action.innerText().catch(() => "");
      const value = await action.getAttribute("value").catch(() => "");
      const title = await action.getAttribute("title").catch(() => "");
      const aria = await action.getAttribute("aria-label").catch(() => "");
      const name = await action.getAttribute("name").catch(() => "");
      const id = await action.getAttribute("id").catch(() => "");

      const haystack = [
        text,
        value || "",
        title || "",
        aria || "",
        name || "",
        id || ""
      ]
        .join(" ")
        .toLowerCase();

      if (hints.some(hint => haystack.includes(hint.toLowerCase()))) {
        return action;
      }
    }

    return null;
  }

  private async findField(
    scope: Locator,
    hints: string[]
  ): Promise<Locator | null> {
    const inputs = scope.locator(
      [
        "input:not([type='hidden'])",
        "textarea"
      ].join(",")
    );

    const total = await inputs.count();

    for (let index = 0; index < total; index++) {
      const input = inputs.nth(index);

      if (!(await input.isVisible().catch(() => false))) {
        continue;
      }

      if (!(await input.isEnabled().catch(() => false))) {
        continue;
      }

      const identity = await this.elementIdentity(input);
      const nearby = await this.nearbyText(input);
      const haystack = `${identity} ${nearby}`.toLowerCase();

      if (hints.some(hint => haystack.includes(hint.toLowerCase()))) {
        return input;
      }
    }

    return null;
  }

  private async inspectInputValidation(
    page: Page,
    input: Locator
  ): Promise<{
    invalid: boolean;
    ariaInvalid: string | null;
    type: string | null;
    pattern: string | null;
    minLength: string | null;
    min: string | null;
    max: string | null;
    validationText: string[];
  }> {
    const ariaInvalid = await input.getAttribute("aria-invalid");
    const type = await input.getAttribute("type");
    const pattern = await input.getAttribute("pattern");
    const minLength = await input.getAttribute("minlength");
    const min = await input.getAttribute("min");
    const max = await input.getAttribute("max");
    const className = await input.getAttribute("class");

    const validationText = await this.collectValidationEvidence(
      page,
      input.locator("xpath=ancestor::form[1]")
    );

    const invalid =
      ariaInvalid === "true" ||
      Boolean(className?.toLowerCase().includes("invalid")) ||
      validationText.length > 0;

    return {
      invalid,
      ariaInvalid,
      type,
      pattern,
      minLength,
      min,
      max,
      validationText
    };
  }

  private async collectValidationEvidence(
    page: Page,
    scope: Locator
  ): Promise<string[]> {
    const selectors = [
      "[role='alert']",
      "[aria-live='assertive']",
      "[aria-invalid='true']",
      ".error",
      ".errors",
      ".invalid-feedback",
      ".validation-error",
      ".field-error",
      ".text-danger",
      ".is-invalid"
    ];

    const messages: string[] = [];

    for (const selector of selectors) {
      const matches = scope.locator(selector);
      const total = await matches.count().catch(() => 0);

      for (let index = 0; index < Math.min(total, 10); index++) {
        const item = matches.nth(index);

        if (!(await item.isVisible().catch(() => false))) {
          continue;
        }

        const text = (await item.innerText().catch(() => "")).trim();

        if (text) {
          messages.push(`Validation: ${text}`);
        }
      }
    }

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const lower = bodyText.toLowerCase();

    const phrases = [
      "field is required",
      "required field",
      "please enter",
      "please select",
      "invalid email",
      "invalid phone",
      "invalid mobile",
      "invalid amount",
      "must be greater",
      "cannot exceed",
      "not allowed"
    ];

    for (const phrase of phrases) {
      if (lower.includes(phrase)) {
        messages.push(`Validation phrase detected: ${phrase}`);
      }
    }

    return [...new Set(messages)];
  }

  private async elementIdentity(
    element: Locator
  ): Promise<string> {
    const attributes = await Promise.all([
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("type"),
      element.getAttribute("placeholder"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid")
    ]);

    return attributes.filter(Boolean).join(" ");
  }

  private async nearbyText(
    element: Locator
  ): Promise<string> {
    const id = await element.getAttribute("id");

    let labelText = "";

    if (id) {
      labelText = await element
        .page()
        .locator(`label[for="${this.escapeAttribute(id)}"]`)
        .first()
        .innerText()
        .catch(() => "");
    }

    const parentText = await element
      .locator("xpath=ancestor::*[self::label or self::div or self::td][1]")
      .innerText()
      .catch(() => "");

    return `${labelText} ${parentText}`.trim();
  }

  private escapeAttribute(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private async visibleCount(
    locator: Locator
  ): Promise<number> {
    const total = await locator.count();
    let visible = 0;

    for (let index = 0; index < total; index++) {
      if (await locator.nth(index).isVisible().catch(() => false)) {
        visible += 1;
      }
    }

    return visible;
  }

  private extractOutstandingBalance(
    text: string
  ): number | null {
    const normalized = text.replace(/,/g, "");

    const patterns = [
      /outstanding(?:\s+balance)?\s*[:₹rs.inr-]*\s*(\d+(?:\.\d+)?)/i,
      /balance(?:\s+due)?\s*[:₹rs.inr-]*\s*(\d+(?:\.\d+)?)/i,
      /amount\s+due\s*[:₹rs.inr-]*\s*(\d+(?:\.\d+)?)/i,
      /due\s+amount\s*[:₹rs.inr-]*\s*(\d+(?:\.\d+)?)/i
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);

      if (!match) {
        continue;
      }

      const value = Number(match[1]);

      if (Number.isFinite(value) && value >= 0) {
        return value;
      }
    }

    return null;
  }

  private result(
    test: BusinessTestDefinition,
    status: ResultStatus,
    observed: string[],
    durationMs: number,
    error?: string
  ): TestExecutionResult {
    return {
      test,
      status,
      expected: test.expected.map(item => item.description),
      observed,
      durationMs,
      ...(error ? { error } : {})
    };
  }
}
