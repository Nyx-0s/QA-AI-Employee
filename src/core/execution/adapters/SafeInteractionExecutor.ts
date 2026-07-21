import type { Locator, Page } from "@playwright/test";

import type { BusinessTestDefinition } from "../../tests/models/TestDefinition";
import type { TestExecutionResult } from "../TestExecutionResult";

import { FormLocator } from "../utils/FormLocator";

export class SafeInteractionExecutor {

  private readonly formLocator = new FormLocator();

  async execute(
    page: Page,
    test: BusinessTestDefinition
  ): Promise<TestExecutionResult> {

    const started = Date.now();

    try {
      const form = await this.formLocator.findMainForm(page);

      if (!form) {
        return this.result(
          test,
          "BLOCKED",
          [],
          Date.now() - started,
          "No visible form found"
        );
      }

      if (test.id === "REG-004") {
        return await this.testInvalidEmail(
          form,
          test,
          started
        );
      }

      if (test.id === "REG-005") {
        return await this.testInvalidPhone(
          form,
          test,
          started
        );
      }

      if (test.id === "REG-006") {
        return await this.testTyping(
          form,
          test,
          started
        );
      }

      return this.result(
        test,
        "NOT_TESTED",
        ["No safe executor implemented for this test yet"],
        Date.now() - started
      );

    } catch (error) {
      return this.result(
        test,
        "FAIL",
        [],
        Date.now() - started,
        error instanceof Error
          ? error.message
          : String(error)
      );
    }
  }

  private async testInvalidEmail(
    form: Locator,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {

    const input = await this.findField(
      form,
      ["email", "e-mail", "mail"]
    );

    if (!input) {
      return this.result(
        test,
        "BLOCKED",
        [],
        Date.now() - started,
        "Email input not found"
      );
    }

    await input.fill("invalid-email");
    await input.blur();

    const validity = await input.evaluate(
      (element: HTMLInputElement) => ({
        valid: element.checkValidity(),
        message: element.validationMessage,
        value: element.value
      })
    );

    await input.fill("");

    const rejected =
      validity.valid === false ||
      validity.message.trim().length > 0;

    return this.result(
      test,
      rejected ? "PASS" : "WARNING",
      [
        `Email field accepted value: ${validity.value}`,
        rejected
          ? `Validation detected: ${validity.message || "invalid value"}`
          : "No browser validation detected"
      ],
      Date.now() - started
    );
  }

  private async testInvalidPhone(
    form: Locator,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {

    const input = await this.findField(
      form,
      ["phone", "mobile", "contact", "telephone", "tel"]
    );

    if (!input) {
      return this.result(
        test,
        "BLOCKED",
        [],
        Date.now() - started,
        "Phone input not found"
      );
    }

    await input.fill("123");
    await input.blur();

    const validity = await input.evaluate(
      (element: HTMLInputElement) => ({
        valid: element.checkValidity(),
        message: element.validationMessage,
        value: element.value,
        minLength: element.minLength,
        pattern: element.pattern
      })
    );

    await input.fill("");

    const rejected =
      validity.valid === false ||
      validity.message.trim().length > 0;

    return this.result(
      test,
      rejected ? "PASS" : "WARNING",
      [
        `Phone field accepted value: ${validity.value}`,
        `minLength: ${validity.minLength}`,
        `pattern: ${validity.pattern || "none"}`,
        rejected
          ? `Validation detected: ${validity.message || "invalid value"}`
          : "No browser validation detected"
      ],
      Date.now() - started
    );
  }

  private async testTyping(
    form: Locator,
    test: BusinessTestDefinition,
    started: number
  ): Promise<TestExecutionResult> {

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

    for (let i = 0; i < Math.min(inputs.length, 5); i++) {
      const input = inputs[i];
      const original = await input.inputValue();
      const marker = `AQW_TEST_${i + 1}`;

      await input.fill(marker);

      const retained = await input.inputValue();

      if (retained === marker) {
        passed += 1;
        observed.push(`Input ${i + 1} accepted and retained text`);
      } else {
        observed.push(`Input ${i + 1} did not retain text`);
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

  private async findField(
    form: Locator,
    hints: string[]
  ): Promise<Locator | null> {

    const inputs = form.locator(
      "input, textarea"
    );

    const total = await inputs.count();

    for (let i = 0; i < total; i++) {
      const input = inputs.nth(i);

      if (!(await input.isVisible())) continue;
      if (!(await input.isEnabled())) continue;

      const attributes = await input.evaluate(
        (element: HTMLInputElement | HTMLTextAreaElement) => ({
          name: element.getAttribute("name") || "",
          id: element.getAttribute("id") || "",
          type: element.getAttribute("type") || "",
          placeholder: element.getAttribute("placeholder") || "",
          ariaLabel: element.getAttribute("aria-label") || ""
        })
      );

      const haystack = Object.values(attributes)
        .join(" ")
        .toLowerCase();

      if (
        hints.some(
          hint => haystack.includes(hint.toLowerCase())
        )
      ) {
        return input;
      }
    }

    return null;
  }

  private result(
    test: BusinessTestDefinition,
    status: TestExecutionResult["status"],
    observed: string[],
    durationMs: number,
    error?: string
  ): TestExecutionResult {

    return {
      test,
      status,
      expected: test.expected.map(
        item => item.description
      ),
      observed,
      durationMs,
      ...(error ? { error } : {})
    };
  }
}
