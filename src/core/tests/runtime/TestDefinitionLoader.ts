import fs from "fs-extra";
import path from "node:path";

import type {
  BusinessTestDefinition,
  TestSuiteDefinition,
} from "../models/TestDefinition";

export class TestDefinitionLoader {
  constructor(
    private readonly definitionsDirectory = path.resolve(
      process.cwd(),
      "src/core/tests/definitions"
    )
  ) {}

  async loadAll(): Promise<TestSuiteDefinition[]> {
    if (!(await fs.pathExists(this.definitionsDirectory))) {
      return [];
    }

    const files = (await fs.readdir(this.definitionsDirectory))
      .filter(file => file.endsWith(".json"))
      .sort();

    const suites: TestSuiteDefinition[] = [];

    for (const file of files) {
      const filePath = path.join(this.definitionsDirectory, file);
      const raw: unknown = await fs.readJson(filePath);

      const suite = this.validateSuite(raw, file);
      suites.push(suite);
    }

    return suites;
  }

  async findSuitesForPage(
    moduleName: string,
    pageName: string,
    url: string
  ): Promise<TestSuiteDefinition[]> {
    const suites = await this.loadAll();

    const normalizedModule = this.normalize(moduleName);
    const normalizedPage = this.normalize(pageName);
    const normalizedUrl = this.normalize(url);

    return suites.filter(suite => {
      const moduleMatches =
        this.normalize(suite.module) === normalizedModule;

      const featureMatches =
        normalizedPage.includes(this.normalize(suite.feature)) ||
        this.normalize(suite.feature).includes(normalizedPage);

      const routeMatches = suite.routeHints.some(routeHint =>
        normalizedUrl.includes(this.normalize(routeHint))
      );

      return moduleMatches && (featureMatches || routeMatches);
    });
  }

  getEnabledTests(
    suite: TestSuiteDefinition
  ): BusinessTestDefinition[] {
    return suite.tests.filter(test => test.enabled);
  }

  private validateSuite(
    raw: unknown,
    sourceFile: string
  ): TestSuiteDefinition {
    if (!this.isRecord(raw)) {
      throw new Error(
        `Invalid test suite in ${sourceFile}: expected an object.`
      );
    }

    const requiredStrings = [
      "id",
      "name",
      "module",
      "feature",
      "description",
    ];

    for (const key of requiredStrings) {
      if (typeof raw[key] !== "string" || raw[key].trim() === "") {
        throw new Error(
          `Invalid test suite in ${sourceFile}: "${key}" is required.`
        );
      }
    }

    if (!Array.isArray(raw.routeHints)) {
      throw new Error(
        `Invalid test suite in ${sourceFile}: routeHints must be an array.`
      );
    }

    if (!Array.isArray(raw.tests)) {
      throw new Error(
        `Invalid test suite in ${sourceFile}: tests must be an array.`
      );
    }

    return raw as unknown as TestSuiteDefinition;
  }

  private normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    );
  }
}
