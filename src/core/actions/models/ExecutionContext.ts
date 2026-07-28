import type { Locator, Page } from "@playwright/test";

export interface ExecutionContext {

    page: Page;

    current?: Locator;

    currentForm?: Locator;

    currentRow?: Locator;

    variables: Record<string, unknown>;

    observations: string[];

}
