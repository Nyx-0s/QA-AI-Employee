import type { Locator, Page } from "@playwright/test";

export interface ExecutionContext {

    page: Page;

    current?: Locator;

    variables: Record<string, unknown>;

}